// Landmark drawers: the faro scene, green spaces, the estadios, fountains,
// pools, the Parque Marino and the sponsored lotes, behind drawLandmark().
import { paintPalm, paintTree } from "./flora.js";
import { paintAt, paintParts } from "./shapes.js";
import { evalOn } from "../vehicleShapes.js";
import { drawFieldTowers } from "./lights.js";
import PROPS from "../../assets/world-props.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { PX_PER_M } from "../../domain/units.js";
import { content } from "../../content/remote.js";
import { areaLabel, ctx, hash01, label, lastT, parcelFrame, polyBBox, roundRect } from "./gfx.js";
import { drawParada, paintProp, propParts } from "./props.js";

// El Faro at La Punta — paved plaza on the rocky point: riprap armor on the
// water side, red crescent shade benches, palms and the red/white tower.
function drawFaroScene(lm) {
  const x = lm.x, y = lm.y;
  const { palette: C, params: P } = PROPS.scenes.faro;
  // La Punta plaza: the GRAY esplanade GROUND is drawn by the tile plaza layer
  // (an "esplanade" fill following the real sand shape — no circle, no sand
  // under it). Here we only add the on-plaza decoration: riprap rimming the
  // shape, the iconic RED comma "islands" (spread across the plaza by the
  // build), palms and the tower.
  //
  // `lm.rim` is WORLD GEOMETRY — the build measured it against the real
  // sand/water edge — so it is not a knob and never will be. Everything else
  // here comes from the catalog.
  const rim = lm.rim;
  if (rim) {
    for (let i = 0; i < rim.length; i++) {
      const rx = rim[i][0], ry = rim[i][1];
      const r0 = P.rockMinR + hash01(lm.x * 7.13 + i * 12.9) * P.rockVarR;
      ctx.fillStyle = i % P.rockDarkEvery ? C.rockDark : C.rockLight;
      ctx.beginPath();
      ctx.ellipse(rx, ry, r0 + P.rockStretch, r0, hash01(i * 9.4 + lm.x) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // (the red comma "islands" are drawn in the GROUND layer — drawFaroCommas —
  // so the trees sit on top of them, not the other way around)
  for (const [ox, oy] of P.palms) {
    const px = x + ox, py = y + oy, sc = P.palmScale;
    ctx.fillStyle = C.palmShadow;
    ctx.beginPath(); ctx.ellipse(px + 5, py + 4, 10 * sc, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.palmTrunk; ctx.lineWidth = 3 * sc;
    ctx.beginPath(); ctx.moveTo(px, py + 4); ctx.lineTo(px, py - P.trunkH * sc); ctx.stroke();
    ctx.fillStyle = C.frond;
    for (let k = 0; k < P.fronds; k++) {
      const a = (k / P.fronds) * Math.PI * 2;
      const fx = px + Math.cos(a) * P.frondR * sc;
      const fy = py - P.trunkH * sc + Math.sin(a) * P.frondRy * sc;
      ctx.beginPath(); ctx.ellipse(fx, fy, 9 * sc, 3.2 * sc, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = C.crown;
    ctx.beginPath(); ctx.arc(px, py - P.trunkH * sc, 2.5 * sc, 0, Math.PI * 2); ctx.fill();
  }
  // Tower — white with red bands, slight taper, gallery ring, yellow lantern
  ctx.fillStyle = C.towerShadow;
  ctx.beginPath(); ctx.ellipse(x + 5, y + 4, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  const tw = new Path2D();
  tw.moveTo(x - P.towerBaseHalf, y + P.towerFoot); tw.lineTo(x - P.towerTopHalf, y - P.towerHeight);
  tw.lineTo(x + P.towerTopHalf, y - P.towerHeight); tw.lineTo(x + P.towerBaseHalf, y + P.towerFoot);
  tw.closePath();
  ctx.fillStyle = C.towerBody; ctx.fill(tw);
  ctx.save();
  ctx.clip(tw);
  ctx.fillStyle = C.towerBand;
  for (let i = 0; i < P.bands; i++)
    ctx.fillRect(x - P.towerBaseHalf - 1, y - P.bandTop + i * P.bandGap, P.towerBaseHalf * 2 + 2, P.bandH);
  ctx.restore();
  ctx.strokeStyle = C.towerEdge; ctx.lineWidth = 1; ctx.stroke(tw);
  // Gallery ring + lantern
  ctx.fillStyle = C.gallery; ctx.fillRect(x - P.galleryW / 2, y - P.galleryY, P.galleryW, P.galleryH);
  ctx.fillStyle = C.lantern; ctx.beginPath(); ctx.arc(x, y - P.lanternY, P.lanternR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.gallery; ctx.fillRect(x - 3, y - P.finialY, 6, 2);
  label(x, y - P.labelY, P.label, C.pillFg, C.pillBg);
}

// A green space (park / stadium field): grass with mow stripes, a ring of
// trees around the edge, and optionally a central fountain (animated water)
// or a faint sports-pitch outline. Non-drivable — the surface under it is a
// wall; this just paints it green instead of bare sand.
function drawGreenSpace(lm, w, h, opts = {}) {
  const x = lm.x, y = lm.y;
  const { palette: C, params: P } = PROPS.scenes.greenSpace;
  // Parks (opts.ground === false): the green GROUND is painted by the block
  // footprint (plaza-green) so it can never overlap streets and follows the
  // block orientation — here we only add the fountain, a small tight tree
  // cluster near the centre, and the label. Stadium/standalone keep the
  // legacy self-drawn grass rect + pitch outline.
  if (opts.ground === false) {
    // Trees hug the park perimeter (well clear of the central fountain), so
    // the ring reads as shade trees around the plaza, not a clump on the jet.
    const rx = Math.max(P.parkMinRx, w / 2 - P.parkInset);
    const ry = Math.max(P.parkMinRy, h / 2 - P.parkInset);
    const n = Math.max(P.parkTreesMin, Math.round((w + h) / P.parkTreesPer));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(i + lm.x) * P.parkJitter;
      const f = P.parkRadiusBase + hash01(i * 5 + lm.y) * P.parkRadiusVar;
      paintTree({ x: x + Math.cos(a) * rx * f, y: y + Math.sin(a) * ry * f,
                  s: P.treeScaleBase + hash01(i + lm.x) * P.treeScaleVar });
    }
    if (opts.fountain) drawFountain(x, y);
    return;
  }
  ctx.fillStyle = C.shadow;
  roundRect(ctx, x - w / 2 + P.shadowDx, y - h / 2 + P.shadowDy, w, h, P.corner, true, false);
  ctx.fillStyle = C.grass;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, P.corner, true, false);
  ctx.strokeStyle = C.gravelPath; ctx.lineWidth = P.pathWidth;
  roundRect(ctx, x - w / 2 + P.pathInset, y - h / 2 + P.pathInset,
            w - P.pathInset * 2, h - P.pathInset * 2, P.pathCorner, false, true);
  if (opts.pitch) {
    ctx.strokeStyle = C.pitchLine; ctx.lineWidth = P.pitchLineWidth;
    ctx.strokeRect(x - w / 2 + P.pitchInsetX, y - h / 2 + P.pitchInsetY,
                   w - P.pitchInsetX * 2, h - P.pitchInsetY * 2);
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2 + P.pitchInsetY); ctx.lineTo(x, y + h / 2 - P.pitchInsetY);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, P.centreCircle, 0, Math.PI * 2); ctx.stroke();
  }
  // tree ring around the perimeter (deterministic scatter)
  const n = Math.round((w + h) / P.ringTreesPer);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rx = w / 2 - P.ringInset - hash01(i * 3 + lm.x) * P.ringJitter;
    const ry = h / 2 - P.ringInset - hash01(i * 7 + lm.y) * P.ringJitter;
    paintTree({ x: x + Math.cos(a) * rx, y: y + Math.sin(a) * ry,
                s: P.treeScaleBase + hash01(i + lm.x) * P.ringScaleVar });
  }
  if (opts.fountain) drawFountain(x, y);
}

// Estadio — NAME PILL ONLY. The stadium itself (grey graderías on the block's
// real sidewalk + the pitch and its markings) is painted inside the acera pass,
// paintStadiumCuadras in ./streets.js: it's a colour choice on ground that
// already exists, not a structure stacked on a later layer. Drawing it here is
// what used to bury the street name pills under the block.
/**
 * LA GRADERÍA — fitted to one EDGE of the stadium's own traced footprint.
 *
 * The side is named (`west`) and resolved against the polygon, never against
 * the screen: a cuadra here is not square to the viewport and not even square
 * to itself — by El Carmen the avenidas run at -5.4° and the calles at 82.3° —
 * so "the west side" has to mean an edge, and a `strokeRect` off the bbox would
 * put a straight stand on a slanted block. Same rule `P.ang` follows for
 * everything else drawn on a parcel.
 *
 * It is built OUTWARD from that edge onto the cuadra's acera ring, because that
 * grey band IS a whole-cuadra stadium's sidewalk and it is where a stand
 * physically goes.
 */
function standEdge(pts, side) {
  // pts is a flat [x,y,…] ring. Pick the edge whose midpoint is furthest in the
  // named direction — the polygon's own answer, not the bounding box's.
  const n = pts.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
  cx /= n; cy /= n;
  const score = {
    west: (mx) => -mx, east: (mx) => mx,
    north: (mx, my) => -my, south: (mx, my) => my,
  }[side] || ((mx) => -mx);
  let best = null;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const s = score(mx, my);
    if (!best || s > best.s) best = { s, ax, ay, bx, by, mx, my };
  }
  // The outward normal is the one pointing AWAY from the centre; picking the
  // wrong one builds the stand across the pitch.
  const dx = best.bx - best.ax, dy = best.by - best.ay;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  if ((best.mx - cx) * nx + (best.my - cy) * ny < 0) { nx = -nx; ny = -ny; }
  return { ...best, nx, ny, len };
}

function drawStands(lm, spec) {
  const pts = lm.footprint;
  if (!pts || pts.length < 6) return;
  // LA GRADERÍA VIENE CON EL ESTADIO. Estaba llaveada por hito en el registro
  // de arte, o sea aparte del estadio a la que pertenece; ahora el mundo la
  // emite sobre el landmark desde `content/world/blocks.json`. Lo que sigue
  // acá es la RECETA — fondo, escalones, rake, roofFrom, paleta base.
  const own = lm.stands;
  if (!own) return;                       // only the stadiums that have one
  const P = { ...spec.palette, ...(own.palette || {}) };
  const e = standEdge(pts, own.side);
  const D = spec.depth;
  const ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len;
  // The back is narrower than the front — a bank seen from above is a
  // trapezoid, and that taper is what says "raked seating" rather than "a
  // painted rectangle beside the pitch". Alternating the whole tiers at full
  // saturation instead reads as a barcode; it was tried.
  const cut = spec.rake * D;
  const front = (t) => [e.ax + ux * 0 + e.nx * t, e.ay + uy * 0 + e.ny * t];
  const quad = (t0, t1, c0, c1) => {
    ctx.beginPath();
    ctx.moveTo(e.ax + ux * c0 + e.nx * t0, e.ay + uy * c0 + e.ny * t0);
    ctx.lineTo(e.bx - ux * c0 + e.nx * t0, e.by - uy * c0 + e.ny * t0);
    ctx.lineTo(e.bx - ux * c1 + e.nx * t1, e.by - uy * c1 + e.ny * t1);
    ctx.lineTo(e.ax + ux * c1 + e.nx * t1, e.ay + uy * c1 + e.ny * t1);
    ctx.closePath();
  };

  ctx.save();
  // the shadow it throws back onto the pitch
  ctx.fillStyle = P.shadow;
  quad(-3, 0, 0, 0); ctx.fill();

  // THE SEATING BLOCK. Two tones, split by DEPTH rather than striped: the front
  // rows are in the open and the back ones are under the roof, which is what
  // you actually see of a grandstand from above. Alternating whole tiers, or
  // ruling a row line every few pixels, both read as a barcode at play zoom —
  // each was tried and each is why this is written down.
  ctx.fillStyle = P.tierA;
  quad(0, D, 0, cut); ctx.fill();
  ctx.fillStyle = P.tierB;
  quad(D * spec.roofFrom, D, cut * spec.roofFrom, cut); ctx.fill();

  // …and the rows, barely: one hairline per tier at low contrast, so the
  // texture is there when you drive past and never competes with the pitch.
  ctx.save();
  quad(0, D, 0, cut); ctx.clip();
  ctx.strokeStyle = P.row;
  ctx.lineWidth = 1;
  for (let i = 1; i <= spec.tiers; i++) {
    const t = (D * i) / (spec.tiers + 1);
    const c = (cut * i) / (spec.tiers + 1);
    ctx.beginPath();
    ctx.moveTo(e.ax + ux * c + e.nx * t, e.ay + uy * c + e.ny * t);
    ctx.lineTo(e.bx - ux * c + e.nx * t, e.by - uy * c + e.ny * t);
    ctx.stroke();
  }
  ctx.restore();

  // the back wall — the tallest thing, so it takes the structure colour
  ctx.strokeStyle = P.structure;
  ctx.lineWidth = Math.max(2, D * 0.14);
  ctx.beginPath();
  ctx.moveTo(e.ax + ux * cut + e.nx * D, e.ay + uy * cut + e.ny * D);
  ctx.lineTo(e.bx - ux * cut + e.nx * D, e.by - uy * cut + e.ny * D);
  ctx.stroke();
  // and the rail along the pitch
  ctx.strokeStyle = P.rail; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by); ctx.stroke();
  ctx.restore();
}

function drawStadium(lm) {
  const C = PROPS.scenes.stadium.palette;
  const pts = lm.footprint;
  if (!pts || pts.length < 6) {                       // no traced cuadra: legacy rect
    const w = lm.w || 156, h = lm.h || 122;
    drawGreenSpace(lm, w, h, { pitch: true });
    areaLabel(lm.x - w / 2, lm.y - h / 2, lm.x + w / 2, lm.y + h / 2, "ESTADIO", C.pillFg, C.pillBg);
    return;
  }
  // The stand goes down BEFORE the pill, so the name still reads over it.
  const stands = PROPS.scenes.stadium.stands;
  if (stands) drawStands(lm, stands);
  // …and the masts after it: a corner tower stands OUTSIDE the stand's back
  // wall, so drawing it first would put the seating on top of the pole.
  drawFieldTowers(lm, PROPS.scenes.stadium.towers);
  const b = polyBBox(pts);
  areaLabel(b.x0, b.y0, b.x1, b.y1, (lm.name || "Estadio").toUpperCase(), C.pillFg, C.pillBg);
}

// Central fountain with living (animated) water: stone basin, rippling pool,
// a bobbing central jet and droplets. Animated off lastT.
function drawFountain(x, y) {
  const { palette: C, params: P } = PROPS.scenes.fountain;
  const tt = lastT * P.rippleSpeed;
  ctx.fillStyle = C.rim; ctx.beginPath(); ctx.arc(x, y, P.rimR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.kerb; ctx.beginPath(); ctx.arc(x, y, P.kerbR, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, P.waterR, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = C.water;
  ctx.fillRect(x - P.waterR, y - P.waterR, P.waterR * 2, P.waterR * 2);
  ctx.strokeStyle = C.ripple; ctx.lineWidth = 1;
  for (let k = 0; k < P.ripples; k++) {
    const rr = ((tt + k / P.ripples) % 1) * P.waterR;
    ctx.globalAlpha = Math.max(0, 1 - rr / P.waterR);
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  const jh = P.jetBase + Math.sin(tt * P.jetSpeed) * P.jetBob;
  ctx.fillStyle = C.jet;
  ctx.beginPath(); ctx.ellipse(x, y - jh / 2, P.jetHalfW, jh / 2, 0, 0, Math.PI * 2); ctx.fill();
  for (let d = 0; d < P.droplets; d++) {
    const a = (d / P.droplets) * Math.PI * 2 + tt * P.dropletSpin;
    const rr = P.dropletBase + ((tt * P.dropletSpeed + d * P.dropletPhase) % P.dropletSpread);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rr, y - jh + Math.sin(a) * P.dropletRise, P.dropletR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A landscaped pool: tiled concrete deck, animated shimmering water with
// moving highlights, a shallow end + slide. Reused for the Balneario and for
// the Parque Marino's aquarium tanks. `s` scales it; `palms` frames it.
function drawPool(x, y, rot, s = 1, palms = true) {
  const { palette: C, params: P } = PROPS.scenes.pool;
  const tt = lastT * P.speed;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = C.deck;
  ctx.beginPath(); ctx.ellipse(0, 0, P.deckRx, P.deckRy, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.coping; ctx.lineWidth = P.copingWidth;
  ctx.beginPath(); ctx.ellipse(0, 0, P.copingRx, P.copingRy, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, 0, P.waterRx, P.waterRy, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = C.water;
  ctx.fillRect(-P.waterRx - 4, -P.waterRy - 4, P.waterRx * 2 + 8, P.waterRy * 2 + 8);
  ctx.fillStyle = C.deep;
  ctx.beginPath(); ctx.ellipse(P.deepX, P.deepY, P.deepRx, P.deepRy, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.shallow;
  ctx.beginPath();
  ctx.ellipse(P.shallowX, P.shallowY, P.shallowRx, P.shallowRy, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.shimmer; ctx.lineWidth = P.shimmerWidth;
  for (let i = 0; i < P.shimmerLines; i++) {
    const yy = P.shimmerTop + i * P.shimmerGap + Math.sin(tt * P.shimmerSpeedA + i) * P.shimmerAmp;
    ctx.beginPath();
    for (let xx = -P.waterRx; xx <= P.waterRx; xx += P.shimmerStep)
      ctx.lineTo(xx, yy + Math.sin(xx * P.shimmerFreq + tt * P.shimmerSpeedB + i) * P.shimmerWave);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = C.slide;
  ctx.beginPath(); ctx.arc(P.slideX, P.slideY, P.slideR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (palms) {
    for (const [ox, oy] of P.palms) {
      paintPalm({ x: x + ox * s, y: y + oy * s, s: P.palmScale * Math.max(P.palmScale, s) }, lastT);
    }
  }
}

// Parque Marino del Pacífico: its green is the cuadra's RESIDUAL after the UNA
// campus, every mapped building lot and the eastern station parcel take their
// space. The build hands us pool points whose complete ownership disks stay in
// that residual and clear of streets and the rail corridor.
function drawMarinePark(lm) {
  const C = PROPS.scenes.marinePark.palette;
  const pools = lm.pools || [];
  const poolScale = lm.poolScale || 0.32;
  for (let i = 0; i < pools.length; i++)
    drawPool(pools[i][0], pools[i][1], i % 2 ? 0.18 : -0.14, poolScale, false);
  const mw = lm.w || 240, mh = lm.h || 120;
  areaLabel(lm.x - mw / 2, lm.y - mh / 2, lm.x + mw / 2, lm.y + mh / 2,
            "PARQUE MARINO", C.pillFg, C.pillBg);
}

// AREA landmarks draw no object at their anchor — the plaza, the pool and the
// park ARE their ground. The generic drop shadow below would be a dark ellipse
// floating in the middle of the grass / the water with nothing casting it.
const NO_SHADOW = new Set(["stadium", "pool", "park"]);

// PARCEL structures + the sponsor slot. The ground is painted in the acera
// pass (paintParcels); here we add what STANDS on it — the Parroquia's nave and
// tower — and, if a remote `lote` has claimed this parcel by id, its art inside
// the parcel's own `slot` rect. A defined footprint means a sponsor's logo
// always has a known place and size instead of floating over the map.
// WHAT A USE MEANS is data (`parcels` in world-props.json): the prop a lot
// draws, whether it wears its own name, and in what ink.
//
// A parcel whose whole point is the GROUND gets no name pill (`label: false`):
// the parks beside the catedral, the parroquia's garden and the two arms of the
// calle peatonal are read by what is drawn on them — the river and its
// footbridge, the Virgen, the tree scatter, the stone paving — and a caption
// sitting in the middle of each one covered exactly that. Buildings and the
// sports plazas keep theirs; they are places you are sent to, so their name is
// the point. The `tone` makes a name read as what it names: green for a field,
// blue for a school, and the default brown for everything built.
const PARCELS = PROPS.parcels;
const PARCEL_USES = PARCELS.uses;
const NO_USE = {};
function drawParcels(view) {
  const arr = W.PARCELS;
  if (!arr || !arr.length) return;
  for (const P of arr) {
    if (P.x1 + 60 < view.x0 || P.x0 - 60 > view.x1 || P.y1 + 60 < view.y0 || P.y0 - 60 > view.y1) continue;
    const U = PARCEL_USES[P.use] || NO_USE;
    // A catalog prop scaled to the lot — the parroquia. `fit` is the half-width
    // the drawing is authored at, so a smaller manzana shrinks it and a larger
    // one does not blow it up past its natural size.
    if (U.prop) {
      const F = parcelFrame(P);
      paintProp(U.prop, F.cx, F.cy, { ang: F.ang, scale: Math.min(1, F.hw / U.fit) });
    }
    // …and the buildings that are still SCENES: every one of them sizes itself
    // from the parcel through clamps and counts. See `_parcelScenes`.
    if (P.use === "cathedral") drawCathedral(P);
    if (P.use === "civic") drawCivicBuilding(P);
    if (P.use === "school" || P.use === "kinder" || P.use === "campus") drawSchool(P);
    if (P.use === "fuel") drawFuel(P);
    if ((P.use === "garden" || P.use === "park") &&
        P.decor !== false && !P.whole) drawGarden(P);
    // Civic furniture the WORLD declared on this parcel. The build only says
    // which parcel has a river / a statue / a paradita and roughly where; what
    // each looks like is the catalog's, or — for the two that are drawn from
    // the parcel's own extents — this file's.
    if (P.river) drawParkRiver(P);
    if (P.kiosco) drawKiosco(P);
    if (P.statue) drawDecorProp(P, "statue");
    if (P.bus) drawBusStop(P);
    const lote = content.lotes && content.lotes.find((l) => l.parcel === P.id);
    if (lote) drawSponsorSlot(P, lote);
    // a whole-cuadra field already carries the estadio's own name pill, a
    // parcel that IS a landmark gets one from the landmark pass (`P.lm`), and
    // a parcel that is pure GROUND gets none at all — `label: false`
    if (P.label !== false && !P.whole && !P.lm && U.label !== false) {
      areaLabel(P.x0, P.y0, P.x1, P.y1, (P.name || "").toUpperCase(), "#fff",
                U.tone || PARCELS.defaultTone);
    }
  }
}
// A catalog prop the world put ON a parcel, at a fraction of the lot's bbox.
// The Virgen stands at her park's edge NEAREST the catedral (its north edge),
// not in the middle — WHERE is the world's business, WHAT is the catalog's.
function drawDecorProp(P, key) {
  const D = PARCELS.decor[key];
  if (!D) return;
  paintProp(D.prop, P.x0 + (P.x1 - P.x0) * D.at[0], P.y0 + (P.y1 - P.y0) * D.at[1],
            { ang: P.ang || 0 });
}
// A sponsor's art fills the parcel's slot: a plate with its name, sized and
// placed by the WORLD, not by the content entry — so nothing a sponsor sends
// can cover the street or dwarf the block.
function drawSponsorSlot(P, lote) {
  const [sx, sy, sw, sh] = P.slot;
  // the plate lies FLAT on the parcel, so it turns with the manzana too
  ctx.save();
  if (P.ang) { ctx.translate(sx + sw / 2, sy + sh / 2); ctx.rotate(P.ang); ctx.translate(-sx - sw / 2, -sy - sh / 2); }
  ctx.fillStyle = "rgba(12,10,22,0.55)";
  roundRect(ctx, sx, sy, sw, sh, 3, true, false);
  ctx.fillStyle = lote.tone || "#f3c969";
  roundRect(ctx, sx + 2, sy + 2, sw - 4, sh - 4, 2, true, false);
  ctx.fillStyle = "#26222c";
  ctx.font = `bold ${Math.max(5, Math.round(sh * 0.34))}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  ctx.fillText((lote.label || lote.name || "").slice(0, 14), sx + sw / 2, sy + sh / 2 + sh * 0.12);
  ctx.restore();
}
// A garden parcel: shade trees scattered across its grass, on a deterministic
// hash so they never crawl between frames. Scattered in the parcel's OWN frame
// (P.ang, the manzana's angle) and inset from its edge, so on a slanted cuadra
// no canopy drifts off the corner that the bbox overshoots.
function drawGarden(P) {
  const F = parcelFrame(P);
  const ca = Math.cos(F.ang), sa = Math.sin(F.ang);
  const cx = F.cx, cy = F.cy;
  const w = F.hw * 2, h = F.hh * 2;
  const n = Math.max(3, Math.round((w + h) / 26));
  // KEEP THE MIDDLE CLEAR for whatever the world put there. A kiosco, a statue
  // or a fountain stands at the parcel centre, and a canopy dropped on top of it
  // hides the thing the park is known for — the Parque Victoria's bandstand had
  // trees growing through its roof.
  const clear = (P.kiosco || P.statue || P.fountain)
    ? Math.max(14, Math.min(F.hw, F.hh) * 0.62) : 0;
  for (let i = 0; i < n; i++) {
    let u = (hash01(i * 3.7 + P.x0) - 0.5) * w * 0.7;        // along the avenidas
    let v = (hash01(i * 8.1 + P.y0) - 0.5) * h * 0.62;       // along the calles
    if (clear) {
      // push it out of the clear zone along its own bearing, so the scatter
      // still reads as scattered instead of collapsing onto a ring
      const d = Math.hypot(u, v) || 1;
      if (d < clear) { u = u / d * clear; v = v / d * clear; }
      // …and if that pushed it off the lot, drop the tree rather than clip it
      if (Math.abs(u) > F.hw * 0.92 || Math.abs(v) > F.hh * 0.92) continue;
    }
    paintTree({ x: cx + u * ca - v * sa, y: cy + u * sa + v * ca,
                s: 0.7 + hash01(i + P.x0) * 0.35 });
  }
}

// The Parroquia used to be drawn here, as a second copy of the `church`
// landmark's own art. It is `props.churchLot` in world-props.json now — the
// SHARED `props.church` building on a ground shadow — and `drawParcels` puts it
// on the lot at the manzana's angle and scaled to the lot's own half-width. The
// Parroquia del Carmen faces its avenida, not the screen.

// The CATEDRAL de Puntarenas — stone, not stucco, and as big as its parcel
// allows. It is a placeholder for a proper mockup, so everything is derived
// from the parcel rather than hard-coded: it is drawn in the manzana's own
// frame (P.ang), sized off the parcel's half-extents, and FACES EAST onto the
// calle peatonal in front of it, which is where its towers and steps go.
//
// The 0.86 on the half-extents is the bbox overshoot: a parcel poly is
// raster-traced on a block that is not square to the screen, so its bbox is
// slightly larger than the block in the block's own frame.
const STONE_WALL = PROPS.scenes.cathedral.palette.stone;
const STONE_DARK = PROPS.scenes.cathedral.palette.stoneDark;
const STONE_LITE = PROPS.scenes.cathedral.palette.stoneLite;
function drawCathedral(P) {
  const C = PROPS.scenes.cathedral.palette;
  const F = parcelFrame(P);
  const hw = F.hw * 0.86, hh = F.hh * 0.86;
  const cx = F.cx, cy = F.cy;
  ctx.save();
  ctx.translate(cx, cy); if (P.ang) ctx.rotate(P.ang);
  // +u is EAST (the facade, onto the bulevar), +v is SOUTH
  const L = hw, W2 = Math.min(hh, hw * 0.62);       // nave half-length / half-width
  ctx.fillStyle = C.shadow;
  roundRect(ctx, -L + 3, -W2 + 5, L * 2, W2 * 2, 4, true, false);
  // nave
  ctx.fillStyle = STONE_WALL;
  roundRect(ctx, -L, -W2, L * 2, W2 * 2, 3, true, false);
  // transept: the cross arms, a third of the way back from the facade
  const tx = L * 0.05, tw = Math.max(10, L * 0.26), th = Math.min(hh, W2 * 1.45);
  roundRect(ctx, tx - tw, -th, tw * 2, th * 2, 3, true, false);
  // roof ridges (a lighter stone strip down the nave and across the transept)
  ctx.fillStyle = STONE_LITE;
  ctx.fillRect(-L + 2, -W2 * 0.30, L * 2 - 4, W2 * 0.60);
  ctx.fillRect(tx - tw * 0.34, -th + 2, tw * 0.68, th * 2 - 4);
  // crossing dome
  ctx.fillStyle = STONE_DARK;
  ctx.beginPath(); ctx.arc(tx, 0, Math.min(W2 * 0.72, tw * 0.9), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = STONE_LITE;
  ctx.beginPath(); ctx.arc(tx, 0, Math.min(W2 * 0.72, tw * 0.9) * 0.62, 0, Math.PI * 2); ctx.fill();
  // apse: a rounded end at the WEST (the back)
  ctx.fillStyle = STONE_WALL;
  ctx.beginPath(); ctx.arc(-L, 0, W2 * 0.9, 0, Math.PI * 2); ctx.fill();
  // EAST facade: two bell towers flanking the door, onto the calle peatonal
  const tr = Math.max(5, W2 * 0.42);
  for (const s of [-1, 1]) {
    ctx.fillStyle = STONE_DARK;
    ctx.beginPath(); ctx.arc(L - tr * 0.5, s * (W2 - tr * 0.7), tr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = STONE_LITE;
    ctx.beginPath(); ctx.arc(L - tr * 0.5, s * (W2 - tr * 0.7), tr * 0.55, 0, Math.PI * 2); ctx.fill();
  }
  // atrio: pale steps spilling out of the door toward the bulevar
  ctx.fillStyle = C.step;
  roundRect(ctx, L - 1, -W2 * 0.42, Math.max(6, L * 0.12), W2 * 0.84, 2, true, false);
  // the cross on the roof ridge, at the crossing
  ctx.fillStyle = C.cross;
  ctx.fillRect(tx - 1, -W2 * 0.14, 2, W2 * 0.28);
  ctx.fillRect(tx - W2 * 0.11, -1, W2 * 0.22, 2);
  ctx.restore();
}

// A `civic` parcel IS a public building — the Casa de la Cultura, the
// Biblioteca. The block was laid out by hand, which cleared the OSM footprints
// that used to stand on it, so the parcel has to draw its own: a colonnaded
// front on the calle peatonal, inset from the parcel edge so the acera band
// still shows around it.
/**
 * UNA ESCENA DE PARCELA, DIBUJADA DESDE SU REGISTRO.
 *
 * Las siete escenas de parcela estaban en código y `_parcelScenes` explicaba por
 * qué: «se dimensionan desde las medio-extensiones de la parcela POR CLAMPS Y
 * CUENTAS», y ni un clamp ni una cuenta se podían escribir en un catálogo. Eso
 * dejó de ser cierto: `fit` deriva una cuenta de un largo y un paso, y la forma
 * `{k, px, min, max}` de `evalOn` declara un tope. La nota había podrido.
 *
 * EL MARCO, que es lo único que esta función decide:
 *
 *   * `X`/`Y` miden en MEDIO-EXTENSIONES del lote, ya reducidas por el `inset` de
 *     la escena — así `[-1, 4]` es «el borde izquierdo más cuatro píxeles», que es
 *     literalmente lo que decía `-w / 2 + 4`.
 *   * `S` mide en la dimensión CARACTERÍSTICA de la escena. La elige el llamador y
 *     no el JSON, porque es la única parte que de verdad es distinta entre una
 *     catedral (cuya espina es `min(hh, hw·0.62)`) y una Casa de la Cultura. Un
 *     `min` entre ejes no cabe en un evaluador de un eje, y meterlo en el JSON
 *     sería aritmética en el registro.
 *   * el ÁNGULO es el de la manzana (`P.ang`), nunca un ajuste: la cuadrícula no
 *     es cuadrada ni consigo misma, y un ajuste de eje principal en un bloque
 *     casi cuadrado salta a la diagonal contraria.
 */
function paintParcelScene(P, name, opts = {}) {
  const scene = PROPS.scenes[name];
  if (!scene || !scene.parts) return false;
  const F = parcelFrame(P);
  const inset = scene.inset ?? 1;
  const hw = F.hw * inset, hh = F.hh * inset;
  const s = opts.size ?? Math.min(hw, hh);
  ctx.save();
  ctx.translate(F.cx, F.cy);
  if (F.ang) ctx.rotate(F.ang);
  if (opts.rotate) ctx.rotate(opts.rotate);
  paintParts(ctx, scene.parts, {
    X: (v) => evalOn(v, hw),
    Y: (v) => evalOn(v, hh),
    S: (v) => evalOn(v, s),
    pxPerM: PX_PER_M,
    color: (spec) => scenePaint(scene, spec),
    vars: opts.vars,
    t: lastT / 1000,
  });
  ctx.restore();
  return true;
}

/** `$name` contra la paleta de la escena, con UN salto a otra escena.
 *
 *  `@otraEscena.clave` existe porque el gris de piedra vive en la paleta de la
 *  catedral y tres escenas lo usan: el código ya lo leía de allí. Copiar el hex en
 *  cada una sería el duplicado que este proyecto lleva semanas quitando —
 *  `materials.street.majorDash` y `paintRoads` tenían cada uno el suyo, y mover la
 *  perilla cambiaba todos los guiones del juego menos los de la calle. Un salto y
 *  sólo uno: no se persiguen cadenas. */
function scenePaint(scene, spec) {
  if (typeof spec !== "string" || !spec.startsWith("$")) return spec;
  let v = scene.palette?.[spec.slice(1)];
  if (typeof v === "string" && v.startsWith("@")) {
    const [other, key] = v.slice(1).split(".");
    v = PROPS.scenes[other]?.palette?.[key];
  }
  return v ?? spec;
}

// LA CASA DE LA CULTURA ES DATA. Era la escena más simple de las siete y la que
// mejor mostraba por qué las siete estaban en código: una banda de techo con un
// `Math.max(3, …)` y una fila de columnas con un `Math.round(h / 12)`. Ninguna de
// las dos cosas se podía escribir en un catálogo — hasta que existieron `fit` (la
// cuenta sale del largo y el paso) y la forma acotada de `evalOn` (`{k, px, min}`).
// Ahora es `scenes.civicBuilding.parts` y esta función es su llamador.
function drawCivicBuilding(P) {
  paintParcelScene(P, "civicBuilding");
}

// A SCHOOL parcel: the pavilion along the parcel's back edge, the patio in
// front of it, and the flagpole every escuela in the port has by its gate.
// Drawn in the manzana's frame (P.ang) like everything else on a parcel — the
// cuadrícula is not square to the screen, so a strokeRect off P.x0..P.x1 would
// put a straight school on a slanted block.
//
// `kinder` (jardín de niños / CEN-CINAI) is the same building at a smaller
// scale with a play patio; `campus` (colegio / universidad) is several
// pavilions on open grounds instead of one.
function drawSchool(P) {
  const C = PROPS.scenes.school.palette;
  const F = parcelFrame(P);
  //: The three palettes are the use's own, in the catalog beside its pill ink.
  const wall = (PARCEL_USES[P.use] || NO_USE).wall || PARCEL_USES.school.wall;
  const roof = (PARCEL_USES[P.use] || NO_USE).roof || PARCEL_USES.school.roof;
  // pavilions run along the parcel's LONG axis, so a narrow lot gets a narrow
  // block rather than one that spills over its own kerb
  const along = F.hw >= F.hh;
  const L = (along ? F.hw : F.hh) * 1.64, D = (along ? F.hh : F.hw) * 0.62;
  const n = P.use === "campus" ? Math.max(2, Math.min(4, Math.round(L / 46))) : 1;
  ctx.save();
  ctx.translate(F.cx, F.cy); if (F.ang) ctx.rotate(F.ang);
  if (!along) ctx.rotate(Math.PI / 2);               // work in "along x" space
  // THE PATIO IS GROUND, NOT AN OUTLINE. This used to stroke an empty white
  // rectangle over every school on the map — 85 of them — which is exactly the
  // stray white box the map was showing. A yard is swept concrete with a court
  // painted on it, and only when there is room for one.
  const py0 = -D * 0.10, ph = D * 0.95;
  ctx.fillStyle = C.yard;
  ctx.fillRect(-L * 0.42, py0, L * 0.84, ph);        // the swept patio
  if (L > 70 && ph > 22) {                           // a marked court fits
    ctx.strokeStyle = C.court; ctx.lineWidth = 1;
    const cw = L * 0.52, ch = ph * 0.62, cy0 = py0 + (ph - ch) / 2;
    ctx.strokeRect(-cw / 2, cy0, cw, ch);
    ctx.beginPath(); ctx.moveTo(0, cy0); ctx.lineTo(0, cy0 + ch); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, cy0 + ch / 2, Math.min(cw, ch) * 0.2, 0, Math.PI * 2); ctx.stroke();
  }
  const bw = (L - (n - 1) * 6) / n;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + i * (bw + 6);
    ctx.fillStyle = C.shadow;
    roundRect(ctx, x + 2, -D - 1, bw, D, 2, true, false);
    ctx.fillStyle = wall;
    roundRect(ctx, x, -D - 3, bw, D, 2, true, false);
    ctx.fillStyle = roof;                            // zinc roof band
    ctx.fillRect(x, -D - 3, bw, Math.max(2, D * 0.28));
    // classroom doors along the corridor
    ctx.fillStyle = C.courtLine;
    const doors = Math.max(1, Math.round(bw / 11));
    for (let d = 0; d < doors; d++) {
      ctx.fillRect(x + bw * ((d + 0.5) / doors) - 1.4, -3 - D * 0.34, 2.8, D * 0.3);
    }
  }
  // the flagpole, at the yard's edge
  ctx.strokeStyle = C.pavilion; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(L * 0.44, D * 0.2); ctx.lineTo(L * 0.44, -D * 0.5); ctx.stroke();
  ctx.fillStyle = C.roof;
  ctx.fillRect(L * 0.44, -D * 0.5, Math.max(3, L * 0.05), 2.6);
  ctx.restore();
}

// A GASOLINERA: the canopy over the islands, a pump on each, and the shop off
// to one side. Every one of the map's 12 stations is a real OSM `amenity=fuel`
// area — they used to reach the client as a name on a pastel box.
function drawFuel(P) {
  const C = PROPS.scenes.fuel.palette;
  const F = parcelFrame(P);
  const along = F.hw >= F.hh;
  const L = (along ? F.hw : F.hh) * 2, D = (along ? F.hh : F.hw) * 2;
  ctx.save();
  ctx.translate(F.cx, F.cy); if (F.ang) ctx.rotate(F.ang);
  if (!along) ctx.rotate(Math.PI / 2);
  // the shop, along the back edge
  const sw = L * 0.34, sh = D * 0.30;
  ctx.fillStyle = C.shadow;
  roundRect(ctx, -L / 2 + 2, -D / 2 + 2, sw, sh, 2, true, false);
  ctx.fillStyle = C.canopy;
  roundRect(ctx, -L / 2 + 1, -D / 2 + 1, sw, sh, 2, true, false);
  ctx.fillStyle = C.band;                                  // the fascia band
  ctx.fillRect(-L / 2 + 1, -D / 2 + 1, sw, Math.max(1.6, sh * 0.30));
  // the canopy: a slab on four posts, over the islands
  const cw = L * 0.56, ch = D * 0.56;
  const cx0 = L / 2 - cw - 2, cy0 = -ch / 2;
  ctx.fillStyle = C.canopyShadow;
  roundRect(ctx, cx0 + 2, cy0 + 2.5, cw, ch, 2, true, false);
  ctx.fillStyle = C.shop;
  roundRect(ctx, cx0, cy0, cw, ch, 2, true, false);
  ctx.fillStyle = C.band;
  ctx.fillRect(cx0, cy0, cw, Math.max(1.4, ch * 0.18));       // the branded edge
  ctx.fillStyle = C.pump;                                   // posts
  for (const px of [cx0 + 2.5, cx0 + cw - 3.5])
    for (const py of [cy0 + 2, cy0 + ch - 3]) ctx.fillRect(px, py, 1.6, 1.6);
  ctx.fillStyle = C.pumpDark;                                   // the pumps
  const n = Math.max(1, Math.min(3, Math.round(cw / 16)));
  for (let i = 0; i < n; i++) {
    const px = cx0 + cw * ((i + 0.5) / n) - 1.4;
    ctx.fillRect(px, cy0 + ch * 0.42, 2.8, Math.max(2.4, ch * 0.2));
  }
  ctx.restore();
}

// The old round KIOSCO of a parque central: stepped base, a ring of columns,
// a conical zinc roof and a finial. Declared by the world (content.SITE_DECOR)
// on the parcels that have one — OSM records the park, not what stands in it.
function drawKiosco(P) {
  const C = PROPS.scenes.kiosco.palette;
  const F = parcelFrame(P);
  const r = Math.max(7, Math.min(15, Math.min(F.hw, F.hh) * 0.42));
  const x = F.cx, y = F.cy;
  ctx.fillStyle = C.shadow;                                   // shadow
  ctx.beginPath(); ctx.ellipse(x + 2, y + r * 0.5, r * 1.12, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.base;                                            // stepped base
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.3, r * 1.1, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.wall;
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.16, r * 0.9, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.step; ctx.lineWidth = 1.4;                     // columns
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cxp = x + Math.cos(a) * r * 0.78, cyp = y + Math.sin(a) * r * 0.34;
    ctx.beginPath(); ctx.moveTo(cxp, cyp); ctx.lineTo(cxp, cyp - r * 0.62); ctx.stroke();
  }
  ctx.fillStyle = C.roof;                                            // conical roof
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.35);
  ctx.lineTo(x + r * 1.05, y - r * 0.5);
  ctx.lineTo(x - r * 1.05, y - r * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.highlight;                             // lit side
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.35); ctx.lineTo(x + r * 1.05, y - r * 0.5); ctx.lineTo(x, y - r * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.post; ctx.lineWidth = 1;                       // finial
  ctx.beginPath(); ctx.moveTo(x, y - r * 1.35); ctx.lineTo(x, y - r * 1.7); ctx.stroke();
}

// A stream crossing a park, with a stone footbridge over its middle. Drawn in
// the parcel's frame: the water runs across the SHORT axis so a wide, shallow
// park still reads as "a park with a river through it".
function drawParkRiver(P) {
  const C = PROPS.scenes.parkRiver.palette;
  const F = parcelFrame(P);
  const hw = F.hw * 0.86, hh = F.hh * 0.86;
  const cx = F.cx, cy = F.cy;
  ctx.save();
  ctx.translate(cx, cy); if (P.ang) ctx.rotate(P.ang);
  ctx.lineCap = "round";
  const w = Math.max(7, Math.min(13, hh * 0.34));
  // a lazy S across the park, from the west edge to the east edge
  const bed = new Path2D();
  bed.moveTo(-hw, -hh * 0.42);
  bed.bezierCurveTo(-hw * 0.3, hh * 0.55, hw * 0.3, -hh * 0.55, hw, hh * 0.42);
  ctx.strokeStyle = C.bank; ctx.lineWidth = w + 5; ctx.stroke(bed);   // damp bank
  ctx.strokeStyle = C.water; ctx.lineWidth = w; ctx.stroke(bed);       // water
  ctx.strokeStyle = C.sheen; ctx.lineWidth = w * 0.28; ctx.stroke(bed);
  // stone footbridge over the middle of the stream, across the flow
  const bw = w + 12, bh = Math.max(5, w * 0.55);
  ctx.fillStyle = C.shadow;
  roundRect(ctx, -bh / 2 + 1, -bw / 2 + 2, bh, bw, 2, true, false);
  ctx.fillStyle = STONE_LITE;
  roundRect(ctx, -bh / 2, -bw / 2, bh, bw, 2, true, false);
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(-bh / 2, -bw / 2, bh, 1.6);
  ctx.fillRect(-bh / 2, bw / 2 - 1.6, bh, 1.6);
  ctx.restore();
}

// The Virgen used to be drawn here too. She is `props.statue` in the catalog
// now, placed by `drawDecorProp` — art in the catalog, position in the world.

// The paradita on the acera outside the parcel. `P.bus` is [x, y, w, h] in
// world px, placed by the build — the only thing this stop has that a mapped
// one does not is its own size. The caseta itself is `props.parada`, shared
// with the 87 stops that come from OSM: which list a parada came out of is not
// something the player can see.
function drawBusStop(P) {
  const [bx, by, bw, bh] = P.bus;
  drawParada(bx + bw / 2, by + bh / 2, P.ang || 0, bw, bh);
}

// A parcel that carries `lm` IS that landmark: the block layout already drew
// the building (drawCathedral / drawCivicBuilding) at the parcel's own size and
// angle. The landmark pass must not draw its generic art on top — that is what
// put a 40 px stucco church in the middle of the stone catedral, and a green
// civic box in the middle of the Casa de la Cultura. What the landmark still
// owns is its NAME PILL, which a parcel has no equivalent for.
let _ownedByParcel = null;
function ownedByParcel() {
  if (_ownedByParcel) return _ownedByParcel;
  _ownedByParcel = new Map();
  for (const P of W.PARCELS || []) if (P.lm) _ownedByParcel.set(P.lm, P);
  return _ownedByParcel;
}
function drawParcelLandmarkPill(lm, P) {
  //: The word and its ink are the USE's, in the catalog — `pill` there, which is
  //: a different question from `tone` (the ink a parcel's OWN name is set in).
  const pill = (PARCEL_USES[lm.type] || NO_USE).pill;
  const txt = pill ? pill.text : (lm.name || "").toUpperCase();
  label(lm.x, P.y0 - 10, txt, "#fff", pill ? pill.tone : PARCELS.defaultTone);
}

// A parcel that DRAWS THE BUILDING replaces the landmark's own art; a parcel
// that is only its GROUND does not. Every building landmark owns a lot now
// (`place_landmark_lots`), and suppressing the icon for all of them would have
// deleted the hotel, the súper and the mercado from the map and left three name
// pills on bare plots. So: the church/cathedral/civic/market parcels draw their
// own building and keep the early return; a `lot` is ground, and the landmark
// still stands on it.
// `market` deliberately does NOT carry `drawsBuilding` yet: the Mercado owns
// its manzana now, but nothing draws a market hall on it, so suppressing the
// landmark art would leave bare ground under a MERCADO pill. Give the `market`
// use a `prop` in world-props.json (the parroquia's hook) or a drawer beside
// drawCivicBuilding, then set the flag — that is where it plugs in.
function drawLandmark(lm) {
  const owner = ownedByParcel().get(lm.id);
  if (owner && (PARCEL_USES[owner.use] || NO_USE).drawsBuilding) {
    drawParcelLandmarkPill(lm, owner); return;
  }
  const x = lm.x, y = lm.y;
  if (!NO_SHADOW.has(lm.type)) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(x + 4, y + 8, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  // THE ART IS DATA NOW. What used to be here: a 26-branch `switch` of raw
  // Canvas calls, one per landmark type. What is here: a walk over that type's
  // `parts` in `src/assets/world-props.json`, through the same interpreter the
  // vehicle catalog uses (c2d/shapes.js).
  //
  // THREE TYPES ESCAPE, and they are not an oversight — they are the line §12
  // draws. A scene is not art: `drawFaroScene` sweeps a beam on the clock,
  // `drawStadium` clips grass and stands to a footprint the BUILD emitted, and
  // `drawMarinePark` fills a multi-ring even-odd residual. Turning those into
  // JSON would mean inventing a Canvas command stream with unrestricted
  // operations, which is exactly what the register says not to do.
  if (lm.type === "lighthouse") { drawFaroScene(lm); return; }
  if (lm.type === "stadium") { drawStadium(lm); return; }
  if (lm.type === "park") {
    const pw = lm.w || 116, ph = lm.h || 90;
    if (lm.marine) { drawMarinePark(lm, pw, ph); return; }
    drawGreenSpace(lm, pw, ph, { fountain: true, ground: false });
  }

  const prop = propFor(lm.type);
  if (!prop) return;
  paintAt(prop.parts, x, y, { g: ctx, pxPerM: PX_PER_M, prop: propParts, vars: propVars(lm, prop) });
}

/** The catalog record for a type, following `sameAs` — the cathedral is the
 *  same building as the church and differs only in the word on its pill. */
function propFor(type) {
  const rec = PROPS.landmarks[type];
  if (!rec) return null;
  return rec.sameAs ? { ...PROPS.landmarks[rec.sameAs], ...rec } : rec;
}

/** The `$name` substitutions a prop's text may ask for. Kept small and explicit
 *  rather than handing the whole landmark to the interpreter: a catalog that can
 *  read any field of any record is a catalog that can break on a world change. */
function propVars(lm, prop) {
  return {
    label: prop.label || "",
    // A hotel's pill takes the SECOND word of its real name — `Hotel Tioga`
    // reads TIOGA — and falls back to the generic word when there is not one.
    second: lm.name?.split(" ")[1]?.toUpperCase() || "HOTEL",
    w: lm.w || prop.defaultW || 116,
    h: lm.h || prop.defaultH || 90,
  };
}

// Sponsored lotes (remote content): real Puntarenas businesses claim a spot
// and appear as a branded billboard or storefront — pure data, no release.
function drawLote(lo) {
  const C = PROPS.scenes.lote.palette;
  const x = lo.x, y = lo.y;
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(x + 3, y + 6, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (lo.kind === "store") {
    // small branded storefront: body, awning in the sponsor tone, label
    ctx.fillStyle = C.storeBody; ctx.fillRect(x - 16, y - 10, 32, 18);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? C.awningLight : lo.tone; ctx.fillRect(x - 16 + i * 8, y - 15, 8, 5); }
    ctx.fillStyle = C.door; ctx.fillRect(x - 4, y - 2, 8, 10);   // door
    ctx.fillStyle = C.window; ctx.fillRect(x - 13, y - 6, 7, 5); // window
    label(x, y - 22, lo.label, C.awningLight, lo.tone);
  } else {
    // billboard: two posts + panel in the sponsor tone with the label
    ctx.strokeStyle = C.post; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 10, y + 4); ctx.lineTo(x - 10, y - 12);
    ctx.moveTo(x + 10, y + 4); ctx.lineTo(x + 10, y - 12); ctx.stroke();
    ctx.fillStyle = C.awningLight; ctx.fillRect(x - 17, y - 26, 34, 15);
    ctx.fillStyle = lo.tone; ctx.fillRect(x - 15, y - 24, 30, 11);
    label(x, y - 30, lo.label, C.awningLight, C.billboardPill);
  }
}

export { drawParcels, drawFaroScene, drawFountain, drawGreenSpace, drawLandmark, drawLote, drawMarinePark, drawPool, drawStadium };
