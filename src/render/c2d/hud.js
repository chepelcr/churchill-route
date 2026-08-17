// Screen-space overlays: the objective compass, minimap, rain, night vignette
// and the debug coordinate grid + real-world POI names.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { nearestKiosk } from "../../game/delivery.js";
import { ensureRenderCache, roadPath } from "./cache.js";
import { tuning } from "../../game/tuning.js";
import { CUAD, aabbInView, ctx, flatMultiPath, flatPath, hash01, label, polyBBox } from "./gfx.js";
import { ferries } from "../../game/ferries.js";
import { crossingTarget } from "../../game/crossing.js";
import { tideName } from "../../game/tides.js";
import { t as tr } from "../../i18n/index.js";
import HUD from "../../assets/hud.json" with { type: "json" };
import SIM from "../../content/simulation.json" with { type: "json" };
import { moonPhase, moonlight } from "../../game/daynight.js";
//: …y su bloque de paleta. El minimapa, la brújula y las etiquetas de POI ya
//: leían de este archivo; la tarjeta de la Travesía y la barra de marea eran lo
//: último que quedaba con los colores escritos adentro de su propia función.
const HP = HUD.palette;
//: El techo de opacidad de la lluvia — ver `rainCapNote` en simulation.json.
const RAIN_CAP = SIM.day.rainCapAlpha;

// Every named real place OSM knows about (1160 of them), drawn ONLY under the
// debug toggle: at play zoom they'd be a wall of text, but flying over the map
// with them on is how you check a business is where it really is in Puntarenas.
// Colour by category so the kind of place reads at a glance.
// ONE TONE PER OSM CATEGORY — `src/assets/hud.json`. The colour is the only
// thing saying what kind of place a tag is, since there is no room for an icon.
const POI_TONE = Object.fromEntries(
  Object.entries(HUD.poiTags).filter(([k]) => !k.startsWith("_")));
// In-game POI tags: the real business names at a SCREEN-CONSTANT size, so the
// puerto reads as the real place without the labels competing with driving.
// No pill, just an outlined name above the spot.
function drawPoiTags(view, zoom) {
  const pois = W.POIS;
  if (!pois || !pois.length || !tuning.poiNames) return;
  ctx.font = `${(11 / zoom).toFixed(2)}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  ctx.lineWidth = 2.6 / zoom;
  ctx.strokeStyle = HP.poi.tagStroke;
  ctx.fillStyle = HP.poi.tagFill;
  for (const p of pois) {
    if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
    const ty = p.y - 8 / zoom;
    ctx.strokeText(p.name, p.x, ty);
    ctx.fillText(p.name, p.x, ty);
  }
}

function drawPoiNames(view, zoom) {
  const pois = W.POIS;
  if (!pois || !pois.length) return;
  ctx.font = `${Math.round(80 / zoom) / 10}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  const pad = 40;
  for (const p of pois) {
    if (p.x < view.x0 - pad || p.x > view.x1 + pad || p.y < view.y0 - pad || p.y > view.y1 + pad) continue;
    const tone = POI_TONE[p.cat.split("=")[0]] || HP.poi.nameFallback;
    ctx.fillStyle = tone;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = HP.poi.nameBg;
    const w = ctx.measureText(p.name).width + 6 / zoom;
    ctx.fillRect(p.x - w / 2, p.y - 15 / zoom, w, 11 / zoom);
    ctx.fillStyle = tone;
    ctx.fillText(p.name, p.x, p.y - 7 / zoom);
  }
}

// Debug coordinate grid (world space). Minor lines every cuadrícula, bold
// labelled lines every 10 — so you can read off world (x,y) anywhere.
function drawDebugGrid(view, zoom) {
  const minor = CUAD, major = CUAD * 10;
  const x0 = Math.floor(view.x0 / minor) * minor, x1 = Math.ceil(view.x1 / minor) * minor;
  const y0 = Math.floor(view.y0 / minor) * minor, y1 = Math.ceil(view.y1 / minor) * minor;
  ctx.lineWidth = 1 / zoom;
  // minor grid
  ctx.strokeStyle = HP.debugGrid.fine;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += minor) { ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1); }
  for (let y = y0; y <= y1; y += minor) { ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y); }
  ctx.stroke();
  // major grid
  ctx.strokeStyle = HP.debugGrid.coarse;
  ctx.beginPath();
  for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) { ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1); }
  for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) { ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y); }
  ctx.stroke();
  // labels at major intersections
  ctx.fillStyle = HP.debugGrid.text;
  ctx.font = `${Math.round(9 / zoom * 10) / 10}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "left";
  for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
    for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) {
      ctx.fillText(`${x},${y}`, x + 2 / zoom, y - 2 / zoom);
    }
  }
}

// Objective compass: pinned at the top-center of the SCREEN (never lost
// off-view), rotating to point at the target. Screen angle = world angle
// (the camera transform is uniform scale + translate).
function drawCompass(vw, vh) {
  const p = state.p;
  // ON THE ESTERO THE ARROW POINTS AT THE NEXT PAIR OF BUOYS. The crossing used
  // to refuse a compass on principle — the estuary was meant to be read
  // diegetically, off the marks and the water — and that held while the boat
  // was on a rail. Freed, the same 7 km read as a corridor, because the only
  // thing keeping you on the channel was a drag that punished you for leaving
  // it. The drag is gone and this took its place: you can wander the whole
  // estuary and still find your way back to the line.
  //
  // It aims at the MOUTH of the gate, never at a buoy — steering at a mark
  // steers you into it. In Recorrer `crossingTarget()` answers null, because
  // there the estero is a place, not a course.
  const C = HUD.compass;
  const cross = crossingTarget();
  const target = cross || (state.carrying ? state.carrying.customer : nearestKiosk(p).lm);
  if (!target) return;
  const dx = target.x - p.x, dy = target.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < C.minDistance) return;
  const a = Math.atan2(dy, dx);
  const cx = vw / 2, cy = C.centreY;
  ctx.save();
  ctx.fillStyle = C.panel;
  ctx.beginPath(); ctx.arc(cx, cy, C.radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.ring; ctx.lineWidth = 1; ctx.stroke();
  ctx.translate(cx, cy); ctx.rotate(a);
  ctx.fillStyle = cross ? C.needle.crossing : state.carrying ? C.needle.carrying : C.needle.idle;
  ctx.beginPath();
  ctx.moveTo(17, 0); ctx.lineTo(-9, -11); ctx.lineTo(-4, 0); ctx.lineTo(-9, 11);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.outline; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  const meters = Math.round(d / ((W.META && W.META.pxPerMeter) || 1.3));
  ctx.font = "bold 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = C.panel;
  // On the water the distance is worth less than WHICH MARK you are running to,
  // so the label carries the gate number and the metres together.
  const label = cross
    ? (cross.finish ? `${tr("crossing.finish")} · ${meters} m`
      : `${cross.gate}/${cross.gates} · ${meters} m`)
    : `${meters} m`;
  const lw = ctx.measureText(label).width + 10;
  ctx.fillRect(cx - lw / 2, cy + 28, lw, 15);
  ctx.fillStyle = cross ? C.needle.crossing : state.carrying ? C.needle.carrying : C.needle.idle;
  ctx.fillText(label, cx, cy + 39);
}

function drawRain(vw, vh, t, force = 1) {
  // `force` es la rampa POR la fuerza de la tormenta: el agua arrecia en vez de
  // aparecer, y un aguacero cae distinto que un chubasco. Multiplica la
  // intensidad autorada en vez de reemplazarla, así que una etapa que pidió
  // lluvia fuerte sigue teniéndola — sólo que ahora llega.
  const intensity = Math.max(0.1, Math.min(2, (state.weatherIntensity || 1) * force));
  // EL TECHO DE LEGIBILIDAD, y es lo que hace jugable una tormenta fuerte. La
  // lluvia arrecia, pero su opacidad NO pasa de acá: una pantalla que no deja
  // ver la calle no es difícil, es injusta — y este juego se maneja mirando dos
  // cuadras adelante. Las gotas se hacen más, más largas y más rápidas; lo que
  // no se hace es más OPACO.
  const alpha = Math.min(RAIN_CAP, 0.16 + intensity * 0.2);
  ctx.strokeStyle = `rgba(180,210,240,${alpha.toFixed(3)})`;
  ctx.lineWidth = intensity > 1.1 ? 1.4 : 1;
  const drops = Math.round(150 * intensity);
  const len = 8 + intensity * 7;
  for (let i = 0; i < drops; i++) {
    const x = (i * 73 + t * (0.4 + intensity * 0.35)) % vw;
    const y = (i * 137 + t * (0.9 + intensity * 0.7)) % vh;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * 0.6, y + len); ctx.stroke();
  }
}
// LA HORDA DE GAVIOTAS, from where the pilot is sitting. The flock in the
// estero is supposed to "take the view away for a moment without touching you",
// and until now nothing drew it: `crossing.js` set `state.gullBlind`, physics
// decayed it, and the player never saw a bird. This is that second — a flurry
// of wings across the CAMERA, not across the world, because these are the birds
// that went OVER you, not birds you are looking at.
//
// The timer runs ~1.1s → 0, and it is read here and never written: whoever owns
// the sim owns the clock. Wing positions come off `hash01`, never `Math.random`,
// so the same instant of the pass draws the same frame.
function drawGullBlind(vw, vh, t) {
  const left = state.gullBlind || 0;
  if (left <= 0) return;
  const k = Math.min(1, left / 1.1);            // 1 as they cross, 0 as it clears
  const pass = 1 - k;                            // how far through the frame they are
  ctx.save();
  ctx.fillStyle = `rgba(18,28,38,${(0.13 * k).toFixed(3)})`;   // the flock's shadow
  ctx.fillRect(0, 0, vw, vh);
  ctx.strokeStyle = `rgba(255,255,255,${(0.55 + k * 0.4).toFixed(3)})`;
  ctx.lineCap = "round";
  const n = 14 + Math.round(k * 12);
  for (let i = 0; i < n; i++) {
    const h1 = hash01(i * 12.9898 + 1.7), h2 = hash01(i * 78.233 + 4.1);
    // they cross on a diagonal and are gone by the time the timer is
    const p = pass + h1 * 0.6;
    const x = (h1 * 1.3 - 0.15 + p * 0.7) * vw;
    const y = (h2 * 1.3 - 0.2 - p * 0.45) * vh;
    const s = 12 + h2 * 30;
    const flap = Math.sin(t * 0.022 + i * 1.7) * s * 0.4;
    ctx.lineWidth = 1.6 + h1 * 2.4;
    ctx.beginPath();
    ctx.moveTo(x - s, y + flap);
    ctx.quadraticCurveTo(x - s * 0.42, y - s * 0.34 + flap, x, y);
    ctx.quadraticCurveTo(x + s * 0.42, y - s * 0.34 + flap, x + s, y + flap);
    ctx.stroke();
  }
  ctx.restore();
}
function drawNightVignette(vw, vh) {
  const g = ctx.createRadialGradient(vw/2, vh/2, vh*0.15, vw/2, vh/2, vh*0.8);
  g.addColorStop(0, HP.vignette.inner); g.addColorStop(1, HP.vignette.outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
}

// NFS-style minimap: a circular NORTH-UP dial of the streets around the
// car (resident tile road polylines), the player as a heading arrow in the
// center, and the delivery target as a red blip (clamped to the rim when
// it's beyond the dial's range).
// THE MINIMAP HAS ITS OWN PALETTE and not the world's: it is read in a fifth
// of a second at a tenth of the size, so it needs contrast the painted world
// does not. See `src/assets/hud.json`. The barro, lastre, rail, ferry, bridge,
// pier and median inks below still come from `materials.json` — the minimap
// once held its own copy of two pier decks with a comment pointing at the very
// file it had copied them from.
const MINI = HUD.minimap;
const MINI_CASING = MINI.casing;   // outline under every road, one tone
const MINI_STREET = MINI.street;   // the whole network, calles and avenidas alike
const MINI_PASEO  = MINI.paseo;    // the Paseo de los Turistas, drawn last
const MINI_WATER  = MINI.water;    // the gulf, the estero and the balneario inlet
const MINI_LAND   = MINI.land;     // the peninsula itself, under the street network
const MINI_SAND   = MINI.sand;     // the beach — drivable, so it is not land-dark
const MINI_PARK   = MINI.park;     // a green cuadra you cannot drive into
// The SAME green the median is drawn with, read rather than restated — this
// was a fourth copy of it, like the two pier decks above.
const MINI_MEDIAN = MATERIALS.median.grass;   // planted, and a WALL
const MINI_FIELD  = MINI.field;    // an estadio / plaza you CAN — brighter on purpose
const MINI_BULE   = MINI.boulevard;  // calle peatonal: stone, the lightest ink
const MINI_MALECON = MINI.malecon;   // the sea front: warm baldosa, not town stone
// The muelles keep the material they are drawn in out in the world, so the dial
// and the map agree: the Muelle Nacional is concrete, the faro jetty is timber,
// and a bridge deck is the pale deck base its asphalt is laid on.
const MINI_BARRO  = MATERIALS.minimap.barro;    // calle de barro / terraplén
const MINI_LASTRE = MATERIALS.minimap.lastre;   // calle de lastre (gravel)
const MINI_RAIL   = MATERIALS.minimap.rail;     // the Ferrocarril's ballast bed
const MINI_FERRY  = MATERIALS.minimap.ferry;    // a ferry deck
// These two are not "the same colour as" the muelles — they ARE the muelles'
// decks, read from the one recipe the structures are drawn with.
const MINI_PIER   = MATERIALS.pier.concrete.deck;  // Muelle Nacional
const MINI_JETTY  = MATERIALS.pier.timber.deck;    // muelle del Faro
const MINI_BRIDGE = MATERIALS.minimap.bridge;   // bridge / causeway deck base

// One or more flat [x,y,…] rings, cached as a Path2D + union AABB on the object
// they came from. `_m*` keys of their own so nothing collides with the world
// painter's caches: the same polygon is drawn at two very different scales.
function miniShape(o, pts) {
  if (!o._mpath) {
    const polys = o.polys && o.polys.length ? o.polys : [pts];
    o._mpath = flatMultiPath(polys);
    o._mbb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of polys) {
      const b = polyBBox(p);
      if (b.x0 < o._mbb.x0) o._mbb.x0 = b.x0;
      if (b.y0 < o._mbb.y0) o._mbb.y0 = b.y0;
      if (b.x1 > o._mbb.x1) o._mbb.x1 = b.x1;
      if (b.y1 > o._mbb.y1) o._mbb.y1 = b.y1;
    }
  }
  return o;
}
// TERRAIN at the very bottom, so the dial says where the peninsula ENDS —
// until now land and sea were both the dial's dark backdrop, and the street
// network just stopped at the coast with nothing to say why.
//
// The composition is the world's, not the reverse of it: THE SEA IS THE
// BACKGROUND (`drawWaterAll` fills the whole view) and `landPolys` are the
// traced land contours drawn on top of it. `waters` is not the gulf — it is
// the INLAND bodies, the estero and the balneario inlet, which go back on top
// of the land. Filling `waters` alone, as the first cut of this did, painted
// the lagoons and left the gulf the same colour as the town.
//
// The paths come from the world's own render cache: that mainland contour is
// 15152 vertices and there is no reason to hold a second Path2D for it.
function miniTerrain(mv) {
  const rc = ensureRenderCache();
  ctx.fillStyle = MINI_WATER;
  ctx.fillRect(mv.x0, mv.y0, mv.x1 - mv.x0, mv.y1 - mv.y0);
  ctx.fillStyle = MINI_LAND;
  for (const l of rc.land) if (aabbInView(l.aabb, mv, 4)) ctx.fill(l.path);
  ctx.fillStyle = MINI_SAND;                    // the sand fringe, over the land
  for (const b of rc.beach) if (aabbInView(b.aabb, mv, 4)) ctx.fill(b.path);
  ctx.fillStyle = MINI_WATER;
  for (const w of rc.water) if (aabbInView(w.aabb, mv, 4)) ctx.fill(w.path);
}
// The FERROCARRIL's track. Not drivable and not a road — it is its own per-tile
// geometry — so the dial had nothing where the heritage line runs. Drawn as the
// ballast bed alone: at this scale the ties and the two steel rails the world
// draws would be one smudge, and the brown ribbon is what makes the line read.
function miniRails(vts, mv) {
  ctx.strokeStyle = MINI_RAIL; ctx.lineWidth = 14; ctx.lineCap = "round";
  for (const tile of vts) {
    for (const rl of tile.rails || []) {
      if (!rl._mpath) { rl._mpath = flatPath(rl.pts, false); rl._mbb = polyBBox(rl.pts); }
      if (!aabbInView(rl._mbb, mv, 14)) continue;
      ctx.stroke(rl._mpath);
    }
  }
}
// The Paseo's palm median: planted ground down the middle of the boulevard and
// a WALL in physics, with periodic gaps to cross. Drawn on top of the paseo
// ribbon, because what it tells you is exactly that the paseo is two one-way
// halves and you cannot turn across it wherever you like.
function miniMedians(vts, mv) {
  ctx.strokeStyle = MINI_MEDIAN; ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const tile of vts) {
    for (const m of tile.medians || []) {
      if (!m._mpath) { m._mpath = flatPath(m.pts, false); m._mbb = polyBBox(m.pts); }
      if (!aabbInView(m._mbb, mv, m.w + 6)) continue;
      ctx.lineWidth = Math.max(m.w, 14);      // thin by nature; readable at dial scale
      ctx.stroke(m._mpath);
    }
  }
}
// GREEN SPACES first, under the streets: parks and the marine park as dark
// green, the estadios and the open plazas brighter, because those you drive
// into and the dial should say so. A field's cuadra has no cross-streets left
// (the build clips them), so nothing paints over it afterwards.
function miniGreens(mv) {
  for (const g of W.GREENS || []) {
    miniShape(g, g.pts);
    if (!aabbInView(g._mbb, mv, 8)) continue;
    ctx.fillStyle = g.type === "stadium" ? MINI_FIELD : MINI_PARK;
    ctx.fill(g._mpath, "evenodd");
  }
  // …and the greens that are PARTS of a cuadra rather than the whole of it,
  // which live in `parcels`, not in `greens`: the canchas (Plaza Deportes El
  // Carmen and every OSM "Plaza Deportes") bright, because you drive into
  // them, and the real parks — Parque Victoria, Mora y Cañas — dark, like the
  // block greens they sit beside.
  for (const P of W.PARCELS || []) {
    const field = P.use === "plaza" || P.use === "stadium";
    if (!field && P.use !== "park" && P.use !== "garden") continue;
    if (P.whole) continue;                      // already in GREENS as its cuadra
    miniShape(P, P.poly);
    if (!aabbInView(P._mbb, mv, 8)) continue;
    ctx.fillStyle = field ? MINI_FIELD : MINI_PARK;
    ctx.fill(P._mpath, "evenodd");
  }
}
// The calles peatonales. A bulevar is NOT in the road list — it is a parcel —
// but it is part of the network you can drive, so it gets the same casing +
// fill the streets get, in the lightest ink on the dial: stone, so it reads as
// paving rather than as another calle. Drawn after the street fill so the
// junction where it meets the avenida is clean.
function miniBoulevards(mv) {
  const arr = (W.PARCELS || []).filter((P) => P.use === "boulevard");
  if (!arr.length) return;
  const vis = [];
  for (const P of arr) {
    miniShape(P, P.poly);
    if (aabbInView(P._mbb, mv, 8)) vis.push(P);
  }
  ctx.strokeStyle = MINI_CASING; ctx.lineWidth = 10;
  for (const P of vis) ctx.stroke(P._mpath);
  ctx.fillStyle = MINI_BULE;
  for (const P of vis) ctx.fill(P._mpath, "evenodd");
}
// EL MALECÓN, drawn with the bulevares and for the same reason: it is ground
// you drive that is not in the road list. Warmer than the stone, because on a
// dial the one line the player is looking for down there is the sea front.
function miniMalecon(mv) {
  const arr = W.MALECON || [];
  if (!arr.length) return;
  const vis = [];
  for (const B of arr) {
    miniShape(B, B.poly);
    if (aabbInView(B._mbb, mv, 8)) vis.push(B);
  }
  ctx.strokeStyle = MINI_CASING; ctx.lineWidth = 8;
  for (const B of vis) ctx.stroke(B._mpath);
  ctx.fillStyle = MINI_MALECON;
  for (const B of vis) ctx.fill(B._mpath, "evenodd");
}
// MUELLES over the streets, because a deck is the one road that runs out over
// water: the Muelle Nacional (an axis rect), the faro jetty (a rotated deck
// along its segment), the Mata de Limón bridge, and every road the build
// flagged as a deck.
function miniMuelles(mv, roads) {
  // decks that carry the street network first: the causeways and the Mata de
  // Limón bridge, pale under the traffic they take
  ctx.strokeStyle = MINI_BRIDGE;
  for (const r of roads) {
    if (!r.bridge && r.cls !== "bridge") continue;
    ctx.lineWidth = Math.max(r.w, 26);
    ctx.stroke(roadPath(r));
  }
  const B = W.BRIDGE;
  if (B && B.pts && aabbInView(polyBBox(B.pts), mv, B.deckW)) {
    ctx.lineWidth = B.deckW;
    ctx.stroke(miniShape(B, B.pts)._mpath);
  }
  // the two ferries: deck-coloured, wherever they happen to be. Out mid-gulf
  // that little rectangle is the only thing on the dial that is not sea, which
  // is exactly the information you want while you are standing on it.
  ctx.fillStyle = MINI_FERRY;
  for (const f of ferries()) {
    const R = f.dl / 2 + 8;
    if (!aabbInView({ x0: f.x - R, x1: f.x + R, y0: f.y - R, y1: f.y + R }, mv, 4)) continue;
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(f.a);
    ctx.fillRect(-f.dl / 2, -f.dw / 2, f.dl, f.dw);
    ctx.restore();
  }
  // …then the muelles proper, each stroked in its own material. They are
  // polylines, so one loop covers both — and any the editor adds.
  for (const P of W.PIERS) {
    const pts = P.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
    }
    if (!aabbInView({ x0, x1, y0, y1 }, mv, P.w)) continue;
    // An apron is a piece of the street network, not a muelle: on the dial it
    // belongs to the ribbons, which have already been drawn.
    if (P.style === "apron") continue;
    ctx.strokeStyle = P.style === "timber" ? MINI_JETTY : MINI_PIER;
    ctx.lineWidth = P.w; ctx.lineCap = "butt"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  }
}
// Every drivable RIBBON on the dial, as one list, so the casing and the fill
// stay two full passes over all of them — which is the whole reason crossings
// look clean.
//
// It is not just the road polylines. The build also carves a short paved
// connector from each churchill stand, and from the end of the faro muelle,
// out to the nearest street (`kioskPaths`). Those are stamped drivable but are
// not roads, so the dial had them missing: every kiosk — the thing you are
// actually being sent to — looked cut off from the network.
// Each ribbon carries a RANK, and the fill pass walks them in rank order. That
// is what decides who wins a crossing, and it has to be importance — not tile
// order, and not "whoever is drawn last". A calle de barro painted after the
// grey fill put a brown bite through every avenida it crossed, which is the
// same bug the per-class single pass had, just with a nicer colour.
const RIBBON_RANK = {
  service: 1, pedestrian: 1, living_street: 1,
  residential: 2, unclassified: 2,
  tertiary: 3, tertiary_link: 3, secondary: 3,
  primary: 4, primary_link: 4, trunk: 5, trunk_link: 5,
};
function miniRibbons(mv, roads) {
  const out = [];
  for (const r of roads) {
    out.push({
      p: roadPath(r), w: Math.max(r.w, 26),
      // unpaved sits BELOW every paved street: a dirt calle never cuts an avenida
      rank: (r.barro || r.gravel) ? 0 : (RIBBON_RANK[r.cls] || 2),
      col: r.barro ? MINI_BARRO : r.gravel ? MINI_LASTRE : MINI_STREET,
    });
  }
  for (const kp of W.KIOSK_PATHS || []) {
    const [x0, y0, x1, y1] = kp.pts;
    if (!aabbInView({ x0: Math.min(x0, x1), x1: Math.max(x0, x1),
                      y0: Math.min(y0, y1), y1: Math.max(y0, y1) }, mv, 30)) continue;
    if (!kp._mpath) kp._mpath = flatPath(kp.pts, false);
    // a connector is a spur off the street it joins, so it goes under it
    out.push({ p: kp._mpath, w: 28, rank: 1, col: MINI_STREET });
  }
  // The ferry ramps are the same kind of spur, and are piers now.
  for (const P of W.PIERS) {
    if (P.style !== "apron") continue;
    const pts = P.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
    }
    if (!aabbInView({ x0, x1, y0, y1 }, mv, P.w)) continue;
    if (!P._mpath) P._mpath = flatPath(pts, false);
    out.push({ p: P._mpath, w: P.w, rank: 1, col: MINI_STREET });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

// The crossing's own readout: hull, fish and elapsed. Screen-space, beside the
// dial, and only while a travesía is running — the delivery HUD keeps its
// corner, because you are still carrying a churchill.
// A GATE COUNT AND A PROGRESS BAR ARE OPTIONAL. The crossing is becoming a
// gated race, and its state grows `gates` / `gateIndex` / `progress` on its own
// schedule — so each is read defensively and a field that is ABSENT draws
// nothing at all. The card even keeps its old height until there is a bar to
// put in it, so this is correct before and after the sim catches up.
function crossingRace(c) {
  const gates = Array.isArray(c.gates) ? c.gates.length
    : Number.isFinite(c.gates) ? c.gates : null;
  const gate = Number.isFinite(c.gateIndex) ? Math.max(0, c.gateIndex) : null;
  const prog = Number.isFinite(c.progress) ? Math.max(0, Math.min(1, c.progress)) : null;
  return { gates, gate, prog };
}

// LA MAREA, on the card. Two things a pilot wants and the number alone gives
// neither: whether the bancos are OUT (a level, read against the bed) and which
// way the water is going (a rising tide covers the bar you are looking at, a
// falling one is about to hand you another). So the gauge is drawn as the
// estuary in section — a sandy column with the water standing in it — and the
// arrow beside the name says which way it is moving.
//
// The level comes off the CROSSING when there is one, because that is the tide
// the race is being sailed at, and off `state` otherwise. Never recomputed.
const TIDE_ROW_H = 24;
const TIDE_GW = 6, TIDE_GH = 20;
function crossingTide(c) {
  const level = Number.isFinite(c.tide) ? c.tide
    : Number.isFinite(state.tide) ? state.tide : null;
  if (level === null) return null;
  const v = Math.max(0, Math.min(1, level));
  return { level: v, rising: !!state.tideRising, name: tr(`tide.${tideName(v)}`) };
}

function drawTideGauge(x, y, tide) {
  const gx = x, gy = y, gw = TIDE_GW, gh = TIDE_GH;
  // el fondo: the bed the water stands on — what is showing IS the sand
  ctx.fillStyle = HP.tide.sand;
  ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, 3); ctx.fill();
  const wh = Math.max(1.5, gh * tide.level);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, 3); ctx.clip();
  ctx.fillStyle = HP.tide.water;
  ctx.fillRect(gx, gy + gh - wh, gw, wh);
  ctx.fillStyle = HP.tide.waterline;                      // the waterline itself
  ctx.fillRect(gx, gy + gh - wh, gw, 1.2);
  ctx.restore();
  ctx.strokeStyle = HP.tide.ticks; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1, 3); ctx.stroke();
  // LA LUNA, al lado de la marea porque es su CAUSA. La barra dice cuánta agua
  // hay; el disco dice por qué el rango es el que es. Sin él el jugador nota que
  // la Travesía cambió de dificultad y no tiene con qué explicárselo.
  drawMoon(gx + gw / 2, gy - 8, 4.2);
}

/**
 * La luna como un disco con su terminador: llena, nueva, o un gajo.
 *
 * Se dibuja el disco oscuro completo y encima la parte iluminada, así que la
 * luna nueva es un círculo apenas visible y no un hueco — que es lo que se ve
 * en el cielo, y lo que dice «hay luna, no la estás viendo».
 */
function drawMoon(cx, cy, r) {
  const phase = moonPhase();
  const lit = moonlight();
  ctx.fillStyle = HP.tide.moonDark;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  if (lit <= 0.02) return;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = HP.tide.moonLit;
  if (lit > 0.97) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  } else {
    // El gajo: media luna llena recortada por una elipse cuyo ancho es lo que
    // falta para llenarla, y el lado depende de si crece o mengua.
    const waxing = phase < 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing);
    ctx.ellipse(cx, cy, r * (1 - lit * 2 < 0 ? lit * 2 - 1 : 1 - lit * 2), r,
                0, Math.PI / 2, -Math.PI / 2, lit > 0.5 ? !waxing : waxing);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// A filled triangle rather than a glyph: an arrow that depends on the font
// having ▲ is an arrow that can come out as a box on somebody's phone.
function tideArrow(x, y, rising, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  if (rising) { ctx.moveTo(x + 3.5, y - 6); ctx.lineTo(x + 7, y - 0.5); ctx.lineTo(x, y - 0.5); }
  else { ctx.moveTo(x + 3.5, y - 0.5); ctx.lineTo(x + 7, y - 6); ctx.lineTo(x, y - 6); }
  ctx.closePath(); ctx.fill();
}

function drawCrossingHud(vw, vh) {
  const c = state.crossing;
  if (!c?.active) return;
  const { gates, gate, prog } = crossingRace(c);
  const tide = crossingTide(c);
  ctx.save();
  // the alignment is OURS: drawCompass leaves it centred, and it returns early
  // when there is no target, so without this the card's text moved on its own.
  ctx.textAlign = "left";
  // THE CARD IS SIZED TO ITS CONTENTS, not to a constant. At a fixed 132 px the
  // title and the gate counter overlapped into "ESTUARY CROSSING2" — and the
  // number that would have made it fit in English is the wrong number in
  // Spanish, where the same title is "TRAVESÍA DEL ESTERO", three characters
  // longer. Measure both, then lay the card out around them.
  const title = tr("crossing.title").toUpperCase();
  const counter = gates !== null ? `${Math.min(gate ?? 0, gates)}/${gates} ⛵` : "";
  ctx.font = "600 9px 'Space Mono', monospace";
  const titleW = ctx.measureText(title).width;
  const counterW = counter ? ctx.measureText(counter).width : 0;
  const PAD = 10, GAP = 12;
  // the tide row is measured the same way the title row is: its own two strings,
  // in their own two sizes, so "Marea bajando" cannot run out of the card in one
  // language while it fits in another.
  const tideCap = tide ? tr("crossing.tide").toUpperCase() : "";
  let tideW = 0;
  if (tide) {
    ctx.font = "600 7px 'Space Mono', monospace";
    const capW = ctx.measureText(tideCap).width;
    ctx.font = "600 9px 'Space Mono', monospace";
    const nameW = ctx.measureText(tide.name).width;
    tideW = PAD + TIDE_GW + 7 + Math.max(capW, 11 + nameW) + PAD;
    ctx.font = "600 9px 'Space Mono', monospace";
  }
  const w = Math.max(132, PAD + titleW + (counter ? GAP + counterW : 0) + PAD, tideW);
  // EL IMPULSO gets its own row, because it is now the thing the level runs on:
  // you earn it by going close and you spend it on the turbo, and a meter you
  // cannot see is a mechanic you will not use.
  const boostRow = c.level ? 12 : 0;
  const h = 44 + boostRow + (tide ? TIDE_ROW_H : 0) + (prog !== null ? 10 : 0);
  const x = vw - w - 18, y = 108;
  ctx.fillStyle = HP.crossing.card;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
  ctx.fillStyle = HP.crossing.title;
  ctx.fillText(title, x + PAD, y + 15);
  if (counter) {                           // …y por cuál boya vas
    ctx.textAlign = "right";
    ctx.fillStyle = HP.crossing.counter;
    ctx.fillText(counter, x + w - PAD, y + 15);
    ctx.textAlign = "left";
  }
  // hull: three pips, one per knock left. In Recorrer there is no damage, so
  // the pips simply do not appear.
  if (c.level) {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < 3 - c.knocks ? HP.crossing.hullOk : HP.crossing.hullGone;
      ctx.beginPath(); ctx.arc(x + 14 + i * 12, y + 30, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = HP.crossing.value;
  ctx.font = "600 11px 'Space Mono', monospace";
  ctx.fillText(`${c.fish} 🐟`, x + (c.level ? 58 : 12), y + 34);
  ctx.fillStyle = HP.crossing.text;
  ctx.fillText(`${c.t.toFixed(0)}s`, x + w - 34, y + 34);
  // EL IMPULSO: a bar that fills as you brush things, and a streak beside it.
  if (boostRow) {
    const by0 = y + 41, bw0 = w - 20;
    const boost = Math.max(0, Math.min(1, c.boost || 0));
    ctx.fillStyle = HP.crossing.meterBg;
    ctx.beginPath(); ctx.roundRect(x + 10, by0, bw0, 5, 2.5); ctx.fill();
    ctx.fillStyle = boost >= 1 ? HP.crossing.boostFull : HP.crossing.boost;
    ctx.beginPath();
    ctx.roundRect(x + 10, by0, Math.max(2, bw0 * boost), 5, 2.5); ctx.fill();
    if (c.streak > 1) {
      ctx.textAlign = "right";
      ctx.font = "600 8px 'Space Mono', monospace";
      ctx.fillStyle = HP.crossing.boostFull;
      ctx.fillText(`x${c.streak}`, x + w - PAD, by0 - 2);
      ctx.textAlign = "left";
      ctx.font = "600 9px 'Space Mono', monospace";
    }
  }
  // LA MAREA: the gauge, then the name of the hour and which way it is going.
  // Sandy while the banks are out, because that is when the level is news.
  if (tide) {
    const gy = y + 42 + boostRow;
    drawTideGauge(x + PAD, gy, tide);
    const tx = x + PAD + TIDE_GW + 7;
    const col = tide.level < 0.35 ? HP.crossing.tideLow : HP.crossing.tideHigh;
    ctx.font = "600 7px 'Space Mono', monospace";
    ctx.fillStyle = HP.crossing.tideCaption;
    ctx.fillText(tideCap, tx, gy + 6);
    tideArrow(tx, gy + 18, tide.rising, col);
    ctx.font = "600 9px 'Space Mono', monospace";
    ctx.fillStyle = col;
    ctx.fillText(tide.name, tx + 11, gy + 18);
  }
  if (prog !== null) {                     // how much estero is left, as a track
    const bx = x + 10, by = y + h - 9, bw = w - 20;
    ctx.fillStyle = HP.crossing.meterBg;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, 4, 2); ctx.fill();
    ctx.fillStyle = HP.crossing.progress;
    ctx.beginPath(); ctx.roundRect(bx, by, Math.max(3, bw * prog), 4, 2); ctx.fill();
  }
  ctx.restore();
}

function drawMinimap(vw, vh, t) {
  const R = 76;                          // dial radius on screen (px)
  const cx = vw - R - 18, cy = R + 18;
  const RANGE = 460;                     // world px from car to dial edge
  const s = R / RANGE;
  const p = state.p;

  // dial background + clip
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = HP.minimap.panel;
  ctx.fill();
  ctx.clip();

  // world → dial transform (north up, car at center)
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-p.x, -p.y);

  const M = RANGE * 1.05;
  const mv = { x0: p.x - M, x1: p.x + M, y0: p.y - M, y1: p.y + M };
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const vts = W.visibleTiles(mv.x0, mv.y0, mv.x1, mv.y1);
  const roads = [];
  for (const tile of vts)
    for (const r of tile.roads)
      if (aabbInView(r.aabb, mv, r.w)) roads.push(r);
  // ONE colour for the whole street network, in two FULL passes — a casing for
  // every road, then a fill for every road — the same multi-pass shape the
  // world painter uses.
  //
  // Colouring by class inside a single pass is what looked broken: an avenida
  // was drawn lighter than a calle, and every calle drawn AFTER it cut a notch
  // out of it at the crossing. At dial scale a 36 px residential ribbon over a
  // 72 px primary is a visible bite, and the order it happens in is just tile
  // and array order, so the avenue came out dashed. Same ink everywhere makes
  // a crossing invisible; the HIERARCHY rides on WIDTH, which is what it means
  // on a map anyway.
  miniTerrain(mv);                              // sea + land, under everything
  miniGreens(mv);                               // green ground, under the streets
  const ribbons = miniRibbons(mv, roads);       // roads + kiosk access paths
  ctx.strokeStyle = MINI_CASING;
  for (const b of ribbons) { ctx.lineWidth = b.w + 10; ctx.stroke(b.p); }
  // …then ONE fill pass, walked in RANK order: a barro calle lays down first
  // and the avenida it crosses paints over it, instead of the other way round.
  let col = null;
  for (const b of ribbons) {
    if (b.col !== col) { col = b.col; ctx.strokeStyle = col; }
    ctx.lineWidth = b.w; ctx.stroke(b.p);
  }
  miniBoulevards(mv);                           // calles peatonales, into the network
  miniMalecon(mv);                              // …and the sea front beside them
  miniMuelles(mv, roads);                       // decks, over the streets
  miniRails(vts, mv);                           // the Ferrocarril, over the ground
  // the Paseo is the one street that keeps a colour of its own, and it goes
  // LAST so nothing can cross back over it
  ctx.strokeStyle = MINI_PASEO;
  for (const r of roads) {
    if (r.cls !== "paseo") continue;
    ctx.lineWidth = Math.max(r.w, 26); ctx.stroke(roadPath(r));
  }
  miniMedians(vts, mv);                         // …and the palm median splitting it
  ctx.restore();

  // target blip in screen space (north-up: plain scaled offset)
  const tgt = state.carrying ? state.carrying.customer : nearestKiosk(p).lm;
  if (tgt) {
    let mx = (tgt.x - p.x) * s;
    let my = (tgt.y - p.y) * s;
    const d = Math.hypot(mx, my), lim = R - 9;
    if (d > lim) { mx *= lim / d; my *= lim / d; }   // pin to the rim when far
    const pulse = 3.4 + Math.sin(t * 0.006) * 1.1;
    ctx.fillStyle = state.carrying ? HP.minimap.target : HP.minimap.npc; // NPC / target = red
    ctx.beginPath(); ctx.arc(cx + mx, cy + my, pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = HP.minimap.targetRing; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx + mx, cy + my, pulse, 0, Math.PI * 2); ctx.stroke();
  }

  // the car: gold arrow in the center, rotated to the travel heading
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.a + Math.PI / 2); // arrow art points up = -y
  ctx.fillStyle = HP.minimap.player;
  ctx.strokeStyle = HP.minimap.playerRing; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  // rim
  ctx.strokeStyle = HP.minimap.viewport; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
}

export { drawCompass, drawCrossingHud, drawDebugGrid, drawGullBlind, drawMinimap, drawNightVignette, drawPoiNames, drawPoiTags, drawRain };
