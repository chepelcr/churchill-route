// Landmark drawers: the faro scene, green spaces, the estadios, fountains,
// pools, the Parque Marino and the sponsored lotes, behind drawLandmark().
import { floraSolar, paintTree } from "./flora.js";
import {
  paintAt, paintParts, resolveAssetFormulaMap, scatterPlacements,
} from "./shapes.js";
import { evalOn } from "../vehicleShapes.js";
import { drawFieldTowers } from "./lights.js";
import PROPS from "../../assets/world-props.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import FLORA from "../../assets/flora.json" with { type: "json" };
import { paintSceneParts } from "./sceneShapes.js";
import { WORLD2D as W } from "../../world2d/index.js";
import { PX_PER_M } from "../../domain/units.js";
import { content } from "../../content/remote.js";
import { areaLabel, ctx, hash01, label, lastT, parcelFrame, polyBBox, roundRect, upright } from "./gfx.js";
import { drawParada, paintProp, propParts } from "./props.js";
import { shadowInk, sunShadow } from "./shadows.js";

// El Faro at La Punta — paved plaza on the rocky point: riprap armor on the
// water side, red crescent shade benches, palms and the red/white tower.
function drawFaroScene(lm) {
  const x = lm.x, y = lm.y;
  // La Punta plaza: the GRAY esplanade GROUND is drawn by the tile plaza layer
  // (an "esplanade" fill following the real sand shape — no circle, no sand
  // under it). Here we only add the on-plaza decoration: riprap rimming the
  // shape, the iconic RED comma "islands" (spread across the plaza by the
  // build), palms and the tower.
  //
  // `lm.rim` is WORLD GEOMETRY — the build measured it against the real
  // sand/water edge — so it is not a knob and never will be. Everything else
  // here comes from the catalog.
  const rim = (lm.rim || []).map(([rx, ry]) => [rx - x, ry - y]);
  ctx.save();
  ctx.translate(x, y);
  paintSceneParts(ctx, PROPS, "faro", {
    X: (value) => value || 0, Y: (value) => value || 0, S: (value) => value || 0,
    vars: { rim, seed: lm.x, flora: FLORA, solar: floraSolar(), timeMs: lastT }, timeMs: lastT,
  });
  ctx.restore();
}

// A green space (park / stadium field): grass with mow stripes, a ring of
// trees around the edge, and optionally a central fountain (animated water)
// or a faint sports-pitch outline. Non-drivable — the surface under it is a
// wall; this just paints it green instead of bare sand.
function drawGreenSpace(lm, w, h, opts = {}) {
  const x = lm.x, y = lm.y;
  const { params: P } = PROPS.scenes.greenSpace;
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
  const vars = resolveAssetFormulaMap(PROPS.scenes.greenSpace.values, {
    hw: w / 2, hh: h / 2, pitch: Boolean(opts.pitch), timeMs: lastT,
  });
  ctx.save(); ctx.translate(x, y);
  paintSceneParts(ctx, PROPS, "greenSpace", {
    X: (value) => value || 0, Y: (value) => value || 0, S: (value) => value || 0,
    vars, timeMs: lastT,
  });
  ctx.restore();
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
/** Legacy fallback for worlds emitted before stand quads joined the contract.
 * New worlds resolve this edge in `FieldService.place_stadium`, then ship the
 * exact geometry that was stamped into collision. Keeping the fallback makes
 * the singular `side` format loadable during a rolling deploy.
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

function legacyStandQuad(pts, side, spec) {
  const e = standEdge(pts, side);
  const D = spec.depth;
  const ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len;
  const cut = spec.rake * D;
  return [e.ax, e.ay, e.bx, e.by,
    e.bx - ux * cut + e.nx * D, e.by - uy * cut + e.ny * D,
    e.ax + ux * cut + e.nx * D, e.ay + uy * cut + e.ny * D];
}

function standQuads(lm, spec) {
  const own = lm.stands;
  if (!own) return [];
  if (own.quads?.length) return own.quads.filter((quad) => quad?.length === 8);
  const pts = lm.footprint;
  if (!pts || pts.length < 6) return [];
  const sides = own.sides || (own.side ? [own.side] : []);
  return sides.map((side) => legacyStandQuad(pts, side, spec));
}

function drawStandQuad(points, spec, P) {
  // p0/p1 are the rail at the pitch; p3/p2 are the narrower back wall. Every
  // tier is an interpolation across the EMITTED trapezoid, not a fresh guess.
  const at = (a, b, t) => [
    points[a] + (points[b] - points[a]) * t,
    points[a + 1] + (points[b + 1] - points[a + 1]) * t,
  ];
  const band = (t0, t1) => {
    const l0 = at(0, 6, t0), r0 = at(2, 4, t0);
    const l1 = at(0, 6, t1), r1 = at(2, 4, t1);
    ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(r0[0], r0[1]);
    ctx.lineTo(r1[0], r1[1]); ctx.lineTo(l1[0], l1[1]); ctx.closePath();
  };

  ctx.save();
  // THE SHADOW IS THE STAND'S OWN SILHOUETTE. Its old fixed three-pixel band
  // always fell onto the pitch and knew neither height nor time of day.
  const sh = sunShadow(spec.heightM);
  // Lito Perez is read from its north-side cast shadow. The shared sun model's
  // world-Y component is south-positive all day, so this scene deliberately
  // mirrors only that component northward; east/west sweep, length and alpha
  // remain the real `sunShadow(heightM)` answer.
  ctx.save(); ctx.translate(sh.dx, -Math.abs(sh.dy));
  ctx.fillStyle = shadowInk(sh.alpha); band(0, 1); ctx.fill(); ctx.restore();

  // THE SEATING BLOCK. Two tones, split by DEPTH rather than striped: the front
  // rows are in the open and the back ones are under the roof, which is what
  // you actually see of a grandstand from above. Alternating whole tiers, or
  // ruling a row line every few pixels, both read as a barcode at play zoom —
  // each was tried and each is why this is written down.
  ctx.fillStyle = P.tierA;
  band(0, 1); ctx.fill();
  ctx.fillStyle = P.tierB;
  band(spec.roofFrom, 1); ctx.fill();

  // …and the rows, barely: one hairline per tier at low contrast, so the
  // texture is there when you drive past and never competes with the pitch.
  ctx.save();
  band(0, 1); ctx.clip();
  ctx.strokeStyle = P.row;
  ctx.lineWidth = 1;
  for (let i = 1; i <= spec.tiers; i++) {
    const t = i / (spec.tiers + 1);
    const l = at(0, 6, t), r = at(2, 4, t);
    ctx.beginPath();
    ctx.moveTo(l[0], l[1]); ctx.lineTo(r[0], r[1]);
    ctx.stroke();
  }
  ctx.restore();

  // the back wall — the tallest thing, so it takes the structure colour
  ctx.strokeStyle = P.structure;
  const depth = (Math.hypot(points[6] - points[0], points[7] - points[1])
    + Math.hypot(points[4] - points[2], points[5] - points[3])) / 2;
  ctx.lineWidth = Math.max(2, depth * 0.14);
  ctx.beginPath();
  ctx.moveTo(points[6], points[7]); ctx.lineTo(points[4], points[5]);
  ctx.stroke();
  // and the rail along the pitch
  ctx.strokeStyle = P.rail; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(points[0], points[1]);
  ctx.lineTo(points[2], points[3]); ctx.stroke();
  ctx.restore();
}

function drawStands(lm, spec) {
  const own = lm.stands;
  if (!own) return;
  const P = { ...spec.palette, ...(own.palette || {}) };
  for (const quad of standQuads(lm, spec)) drawStandQuad(quad, spec, P);
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
  ctx.save(); ctx.translate(x, y);
  paintSceneParts(ctx, PROPS, "fountain", {
    X: (value) => value || 0, Y: (value) => value || 0, S: (value) => value || 0,
    vars: { timeMs: lastT }, timeMs: lastT,
  });
  ctx.restore();
}

// A landscaped pool: tiled concrete deck, animated shimmering water with
// moving highlights, a shallow end + slide. Reused for the Balneario and for
// the Parque Marino's aquarium tanks. `s` scales it; `palms` frames it.
function drawPool(x, y, rot, s = 1, palms = true) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  paintSceneParts(ctx, PROPS, "pool", {
    X: (value) => value || 0, Y: (value) => value || 0, S: (value) => value || 0,
    vars: { palms, flora: FLORA, solar: floraSolar(), timeMs: lastT }, timeMs: lastT,
  });
  ctx.restore();
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
const NO_SHADOW = new Set(PROPS.defaults.noLandmarkShadow);

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
const PARCEL_DECOR = PARCELS.decor;
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
    // The use names its scene; the scene owns BOTH its parts and its complete
    // host-to-frame recipe. No cathedral/school/fuel identity branch lives in
    // this renderer anymore.
    if (U.scene) paintParcelScene(P, U.scene);
    // Civic furniture the WORLD declared on this parcel. The build only says
    // which parcel has a river / a statue / a paradita and roughly where; what
    // each looks like is the catalog's; the caller only supplies derived frame
    // scalars when the recipe combines both parcel axes.
    for (const [key, decor] of Object.entries(PARCEL_DECOR)) {
      if (decor.scene && P[key]) paintParcelScene(P, decor.scene);
    }
    if (P.statue) drawDecorProp(P, "statue");
    if (P.bus) drawBusStop(P);
    const lote = content.lotes && content.lotes.find((l) => l.parcel === P.id);
    if (lote) drawSponsorSlot(P, lote);
    // a whole-cuadra field already carries the estadio's own name pill, a
    // parcel that IS a landmark gets one from the landmark pass (`P.lm`), and
    // a parcel that is pure GROUND gets none at all — `label: false`
    if (P.label !== false && !P.whole && !P.lm && U.label !== false) {
      areaLabel(P.x0, P.y0, P.x1, P.y1, (P.name || "").toUpperCase(), PARCELS.labelFg,
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
  ctx.fillStyle = PARCELS.sponsor.plate;
  roundRect(ctx, sx, sy, sw, sh, 3, true, false);
  ctx.fillStyle = lote.tone || PARCELS.sponsor.defaultTone;
  roundRect(ctx, sx + 2, sy + 2, sw - 4, sh - 4, 2, true, false);
  ctx.fillStyle = PARCELS.sponsor.text;
  ctx.font = `bold ${Math.max(5, Math.round(sh * 0.34))}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  // THE PLATE lies flat on the parcel and turns with the manzana; THE NAME on it
  // does not. And the name has to undo BOTH turns — the camera's and `P.ang`'s —
  // which is exactly why `upright` reads the matrix instead of the compositor's
  // `__worldRot`: that only ever knew about the first one.
  const cx = sx + sw / 2, cy = sy + sh / 2 + sh * 0.12;
  const stood = upright(cx, cy);
  ctx.fillText((lote.label || lote.name || "").slice(0, 14),
               stood ? 0 : cx, stood ? 0 : cy);
  if (stood) ctx.restore();
  ctx.restore();
}
// The Parroquia used to be drawn here, as a second copy of the `church`
// landmark's own art. It is `props.churchLot` in world-props.json now — the
// SHARED `props.church` building on a ground shadow — and `drawParcels` puts it
// on the lot at the manzana's angle and scaled to the lot's own half-width. The
// Parroquia del Carmen faces its avenida, not the screen.

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
 * EL MARCO TAMBIÉN ES DATA. `scene.values` es un árbol de fórmulas JSON con un
 * vocabulario cerrado (`min`, `max`, `mul`, comparaciones, `if`...). El engine
 * sólo entrega hechos del host (`hw`, `hh`, uso, decoraciones) y ejecuta ese
 * árbol. Así la espina, crucero, torres y giro de la catedral pertenecen al
 * mismo registro que sus partes; no queda una función `drawCathedral` que sea
 * la autoridad artística escondida.
 */
function paintParcelScene(P, name) {
  const scene = PROPS.scenes[name];
  if (!scene || !scene.parts) return false;
  const F = parcelFrame(P);
  const use = PARCEL_USES[P.use] || NO_USE;
  const values = resolveAssetFormulaMap(scene.values || {}, {
    hw: F.hw,
    hh: F.hh,
    cx: F.cx,
    cy: F.cy,
    x0: P.x0,
    y0: P.y0,
    use: P.use,
    whole: Boolean(P.whole),
    decor: P.decor !== false,
    hasKiosco: Boolean(P.kiosco),
    hasStatue: Boolean(P.statue),
    hasFountain: Boolean(P.fountain),
  });
  if (values.visible === false) return false;
  const inset = scene.inset ?? 1;
  const hw = values.frameHw ?? F.hw * inset;
  const hh = values.frameHh ?? F.hh * inset;
  const s = values.frameSize ?? Math.min(hw, hh);
  const frame = {
    X: (v) => evalOn(v, hw),
    Y: (v) => evalOn(v, hh),
    S: (v) => evalOn(v, s),
    pxPerM: PX_PER_M,
    color: (spec) => scenePaint(scene, spec, {
      useWall: use.wall,
      useRoof: use.roof,
    }),
    skip: (part) => Boolean(part.when && !values[part.when]),
    vars: values,
    t: lastT / 1000,
    // EL SOL ENTRA POR EL FRAME. `shapes.js` no puede importarlo (arrastraría
    // el juego entero), así que la escena declara ALTURAS EN METROS y quien
    // pinta dice qué hora es. `heightM`/`castsShadow` se heredan hacia adentro,
    // de modo que una escena sin ellos no tiene primera pasada y sale idéntica.
    heightM: scene.heightM,
    castsShadow: scene.castsShadow,
    shadow: scene.heightM || scene.castsShadow ? sunShadow : null,
    shadowInk: shadowInk(1),
  };
  // A garden's PLACEMENT is scene data; a tree's SILHOUETTE deliberately is
  // not. `paintTree` remains the renderer's perturbed spline, while `scatter`
  // supplies local points that are turned into world coordinates here, before
  // the parcel transform, so the crowns stay screen-oriented exactly as before.
  const procedural = scene.parts.filter((part) => part.shape === "scatter" && part.paint === "tree");
  if (procedural.length) {
    const ca = Math.cos(F.ang), sa = Math.sin(F.ang);
    for (const part of procedural) {
      scatterPlacements(part, frame, (_i, at) => {
        paintTree({
          x: F.cx + at.dx * ca - at.dy * sa,
          y: F.cy + at.dx * sa + at.dy * ca,
          s: at.scale,
          k: part.species,
        });
      });
    }
  }
  const parts = procedural.length ? scene.parts.filter((part) => !procedural.includes(part)) : scene.parts;
  if (!parts.length) return true;
  // Un templete radial no hereda el giro de la manzana. Dibujarlo en
  // coordenadas absolutas, además de conservar esa orientación, conserva el
  // rasterizador del pintor original: un `translate` fraccionario no produce
  // exactamente los mismos bordes antialias que la misma ruta absoluta.
  if (scene.turn === false) {
    paintParts(ctx, parts, {
      ...frame,
      X: (v) => F.cx + evalOn(v, hw),
      Y: (v) => F.cy + evalOn(v, hh),
    });
    return true;
  }
  ctx.save();
  ctx.translate(F.cx, F.cy);
  if (F.ang) ctx.rotate(F.ang);
  if (values.rotateTurns) ctx.rotate(values.rotateTurns * Math.PI * 2);
  paintParts(ctx, parts, frame);
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
function scenePaint(scene, spec, colors = {}) {
  if (typeof spec !== "string" || !spec.startsWith("$")) return spec;
  let v = colors?.[spec.slice(1)] ?? scene.palette?.[spec.slice(1)];
  if (typeof v === "string" && v.startsWith("@")) {
    const [other, key] = v.slice(1).split(".");
    v = PROPS.scenes[other]?.palette?.[key];
  }
  if (v === undefined) {
    // UN `$name` QUE NO RESUELVE NO PUEDE PASAR CALLADO, y ésta es la razón:
    // devolver el propio `"$stone"` como `fillStyle` no lanza — Canvas descarta
    // el valor inválido y SIGUE PINTANDO CON EL COLOR ANTERIOR. Al transcribir la
    // catedral escribí `$stoneWall` donde la paleta dice `stone` y el resultado
    // fueron 7 540 píxeles del color de la parte de antes: un edificio con la
    // silueta correcta y los colores de otro. Nada lo reportó.
    //
    // Así que se avisa una vez y se devuelve un color IMPOSIBLE de no ver. Un
    // fallo de arte tiene que verse en la primera captura, no en la revisión.
    if (!scenePaint._warned) scenePaint._warned = new Set();
    const key = `${scene.name || "scene"}${spec}`;
    if (!scenePaint._warned.has(key)) {
      scenePaint._warned.add(key);
      console.warn(`[scene] ${spec} no está en la paleta de esta escena`);
    }
    return EFFECTS.assetPreview.missingColor;
  }
  return v;
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
// the use's JSON scene at the parcel's own size and
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
  label(lm.x, P.y0 - 10, txt, PARCELS.labelFg, pill ? pill.tone : PARCELS.defaultTone);
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
// use a `prop` or `scene` in world-props.json, then set the flag — that is where
// it plugs in.
function drawLandmark(lm) {
  const owner = ownedByParcel().get(lm.id);
  if (owner && (PARCEL_USES[owner.use] || NO_USE).drawsBuilding) {
    drawParcelLandmarkPill(lm, owner); return;
  }
  const x = lm.x, y = lm.y;
  if (!NO_SHADOW.has(lm.type)) {
    paintAt(PROPS.defaults.landmarkShadow.parts, x, y, { g: ctx });
  }
  // THE ART IS DATA NOW. What used to be here: a 26-branch `switch` of raw
  // Canvas calls, one per landmark type. What is here: a walk over that type's
  // `parts` in `src/assets/world-props.json`, through the same interpreter the
  // vehicle catalog uses (c2d/shapes.js).
  //
  // THREE TYPES SELECT A WORLD SCENE, rather than a pin. Their authored shapes,
  // colours and motion are data now; these branches only supply facts no asset
  // can own: the Faro's mapped shoreline rim, the stadium's traced footprint,
  // and the marine park's emitted pool anchors. The shared scene interpreter is
  // deliberately finite, so this dispatch never becomes a hidden Canvas asset.
  if (lm.type === "lighthouse") { drawFaroScene(lm); return; }
  if (lm.type === "stadium") { drawStadium(lm); return; }
  if (lm.type === "park") {
    const pw = lm.w || 116, ph = lm.h || 90;
    if (lm.marine) { drawMarinePark(lm, pw, ph); return; }
    drawGreenSpace(lm, pw, ph, { fountain: true, ground: false });
  }

  // …Y UN PUESTO SE PARECE A LO QUE VENDE. Entre el id y el tipo entra el
  // PRODUCTO: los 17 kioscos son puntos de recogida de cinco comidas distintas
  // y los diecisiete se dibujaban como el puesto de churchill, con la palabra
  // CHURCHILL en el rótulo — un vigorón, un ceviche y una papicarne incluidos.
  // Sigue siendo la misma escalera de siempre (lo específico gana) y un
  // producto sin arte propio cae al puesto genérico, así que agregar una comida
  // no obliga a dibujarla el mismo día.
  const prop = landmarkProp(lm);
  if (!prop) return;
  paintAt(prop.parts, x, y, { g: ctx, pxPerM: PX_PER_M, prop: propParts, vars: propVars(lm, prop) });
}

/** LA ESCALERA DE RESOLUCIÓN, con nombre y exportada — id, luego tipo:producto,
 *  luego tipo. Está afuera porque quien quiera PREVISUALIZAR un registro (una
 *  hoja de arte, el inspector del editor) tiene que resolverlo igual que el
 *  juego; una herramienta que se escriba su propia escalera es la misma deriva
 *  que ya se cerró cuando el editor dibujaba un `park` en un verde distinto al
 *  del juego. */
export function landmarkProp(lm) {
  return propFor(lm.id)
    || (lm.product && propFor(`${lm.type}:${lm.product}`))
    || propFor(lm.type);
}

export { propVars };

/** The catalog record for a key, following `sameAs` — the cathedral is the
 *  same building as the church and differs only in the word on its pill.
 *
 *  THE KEY IS TRIED AS AN ID FIRST, THEN AS A TYPE. A `type` is what a place
 *  IS; it cannot be what a place LOOKS LIKE, because a type is shared: every
 *  hotel in the world drew the same blue box with the same window grid, so the
 *  Tioga — a long wine-coloured block across a whole cuadra — and Las Brisas —
 *  white, two storeys, on a corner — were the same building with a different
 *  word on the pill. An id-keyed record lets one PLACE be itself while every
 *  other hotel keeps the generic look, and `sameAs` means it only has to state
 *  what differs.
 *
 *  Ids and types share one namespace, so `tests/test_world_props.py` fails if a
 *  landmark id ever equals a type name — otherwise a new landmark called
 *  `house` would silently repaint every house in the world. */
function propFor(key) {
  const rec = PROPS.landmarks[key];
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
  const x = lo.x, y = lo.y;
  ctx.save(); ctx.translate(x, y);
  paintSceneParts(ctx, PROPS, "lote", {
    X: (value) => value || 0, Y: (value) => value || 0, S: (value) => value || 0,
    vars: { store: lo.kind === "store", tone: lo.tone, label: lo.label, timeMs: lastT },
    timeMs: lastT,
  });
  ctx.restore();
}

export { drawParcels, drawFaroScene, drawFountain, drawGreenSpace, drawLandmark, drawLote, drawMarinePark, drawPool, drawStadium };
