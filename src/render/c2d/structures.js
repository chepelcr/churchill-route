// Hand-drawn set pieces: buildings, the two muelles and the Mata de Limón
// suspension bridge. The painterly tile pass doesn't cover these.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import LIGHTS_REG from "../../assets/lights.json" with { type: "json" };
const LIGHT_TYPES = LIGHTS_REG.types;
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, flatPath, label, mixColor, textureScale } from "./gfx.js";
import { overlayTexture } from "./materials.js";
import { ferries } from "../../game/ferries.js";
import { buildingHeightM, sunShadow } from "./shadows.js";
import { roundedPath } from "./curves.js";
import { facingEdges, liftPoint, paintSweep, parallaxOffset } from "./depth.js";
import { resolveAssetFormulaMap } from "./shapes.js";
import { paintStructureParts } from "./structureShapes.js";
import { paintLight } from "./lights.js";
import { buildingStyle } from "./buildingStyle.js";
import { districtBuildingStyle } from "./districts.js";
import { lightLevel } from "../../game/daynight.js";
import { registerLampSource } from "./nightlights.js";
import { makeRig, withShadowLayer } from "./rig3d.js";
import { ferryForm } from "./vesselRigs.js";
import { bodyAt, queueBody, queueBodyLike } from "./bodies.js";
import { drawBridgeTower3d, drawRaisedStroke3d } from "./furniture3d.js";
import { SURFACE } from "../../domain/vocabulary.generated.js";
import PROPS from "../../assets/world-props.json" with { type: "json" };
import STYLES from "../../assets/building-styles.json" with { type: "json" };
import { area2, bbox, wound } from "./bodyGeometry.js";

// ───────────── UNA HUELLA DE OSM, LEVANTADA COMO LOS EDIFICIOS NUEVOS ─────────────
// Las reglas son DATA (`building-styles.json → body3d`); acá queda la geometría: el rectángulo
// que mejor la contiene (para saber si es rectangular y dónde corre su eje largo), la cumbrera y
// los pisos. El cuerpo se arma UNA vez por huella y se guarda en ella; lo pinta `bodies.js` con
// la misma cola, la misma sombra y el mismo pinhole que el centro cívico.
const BODY3D = STYLES.body3d || {};

/** El rectángulo de área mínima que contiene la huella: centro, eje largo y semiejes (px). */
function minRect(pts) {
  const n = pts.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, dx = pts[2 * j] - pts[2 * i], dy = pts[2 * j + 1] - pts[2 * i + 1], L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const ux = dx / L, uy = dy / L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = pts[2 * k], y = pts[2 * k + 1], u = x * ux + y * uy, v = -x * uy + y * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      best = { area, cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, ux, uy, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2 };
    }
  }
  if (!best) return null;
  // el eje LARGO va en `u`
  if (best.hv > best.hu) best = { ...best, ux: -best.uy, uy: best.ux, hu: best.hv, hv: best.hu };
  return best;
}

// LA HUELLA SIMPLIFICADA (Douglas–Peucker, tolerancia en px): un techo con cumbrera sube cada arista a
// la punta más cercana, y sobre una huella de veinte escalones eso es un abanico de caras. Sólo para el
// CUERPO dibujado — la colisión sigue con la huella entera
function simplified(pts, tol) {
  const P = []; for (let i = 0; i < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
  const keep = new Array(P.length).fill(false); keep[0] = keep[P.length - 1] = true;
  const rec = (a, b) => {
    let best = -1, bd = tol;
    const [ax, ay] = P[a], [bx, by] = P[b], L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - P[i][1]) - (ax - P[i][0]) * (by - ay)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = true; rec(a, best); rec(best, b); }
  };
  // el anillo se abre en el vértice más lejano del primero, para que el corte no caiga en una arista recta
  let far = 0, fd = -1;
  for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[far] = true; rec(0, far);
  P.push(P[0]); keep.push(true); rec(far, P.length - 1);
  const out = P.slice(0, -1).filter((_, i) => keep[i]).flat();
  return out.length >= 6 ? out : pts;
}

function buildingBody(b, wall, roof, st, src = b.pts) {
  if (b._body && b._bodyKey === wall + roof) return b._body;
  if (st && st.simplifyM) src = simplified(src, st.simplifyM * W.PX_PER_M);
  const B = BODY3D, ppm = W.PX_PER_M, pts = wound(src), n = pts.length / 2;
  const heightM = (st && st.heightM) || buildingHeightM(b), R = minRect(pts);
  const areaPx = Math.abs(area2(pts)) / 2, areaM2 = areaPx / (ppm * ppm);
  const rect = R ? areaPx / R.area : 0;
  const P = B.pitched || {};
  const shapeOk = R && rect >= P.minRect && n <= P.maxVerts && areaM2 <= P.maxAreaM2;
  const kind = st && st.roofKind ? st.roofKind
    : !shapeOk ? "flat" : R.hu / Math.max(1e-6, R.hv) >= P.gableRatio ? "gable" : "hip";
  const pitched = kind !== "flat" && R;
  const rise = pitched ? Math.max(B.minRiseM, Math.min(B.maxRiseM, (R.hv / ppm) * B.riseK)) : 0;
  const storeys = (st && st.storeys) || Math.max(1, Math.min(B.maxStoreys, Math.round(heightM / EFFECTS.buildingHeight.storeyM)));
  const wnd = Boolean(st && st.wnd !== undefined ? st.wnd : b.wnd), W3 = B.windows;
  const tiers = [];
  for (let k = 0; k < storeys; k++) {
    const z0 = (heightM * k) / storeys, z1 = (heightM * (k + 1)) / storeys, last = k === storeys - 1;
    const T = { pts, z0, z1, wall: "$wall", cap: last ? (pitched ? "$roof2" : "$flat") : "$wall" };
    const bands = [];
    if (k === 0) bands.push([0, B.plinthK * storeys, "$trim"]);
    if (last) bands.push([1 - B.eaveK * storeys, 1, "$trim"]);
    if (bands.length) T.bands = bands;
    if (wnd) T.windows = { everyM: W3.everyM, wM: W3.wM, z: [z0 + (z1 - z0) * W3.zK[0], z0 + (z1 - z0) * W3.zK[1]], ink: "$window" };
    if (last && !pitched) T.edge = "$roof2";
    if (last && pitched) {
      // la cumbrera sobre el eje largo: a dos aguas de punta a punta, a cuatro aguas recortada medio fondo
      const half = kind === "gable" ? R.hu : Math.max(0, R.hu - R.hv);
      T.roof = {
        kind, rise, ink: "$roof", ink2: "$roof2", seams: B.seamsM * ppm,
        ridge: [R.cx - R.ux * half, R.cy - R.uy * half, R.cx + R.ux * half, R.cy + R.uy * half],
      };
    }
    tiers.push(T);
  }
  const box = bbox(pts);
  b._body = {
    x: R ? R.cx : (box.x0 + box.x1) / 2, y: R ? R.cy : (box.y0 + box.y1) / 2, zMax: heightM + rise,
    x0: Math.floor(box.x0), y0: Math.floor(box.y0), x1: Math.ceil(box.x1), y1: Math.ceil(box.y1), tiers,
  };
  b._bodyVars = {
    wall, roof,
    roof2: mixColor(roof, B.roofShade.to, B.roofShade.mix),
    trim: mixColor(wall, B.trim.to, B.trim.mix),
    flat: mixColor(roof, B.flatCap.to, B.flatCap.mix),
  };
  b._bodyKey = wall + roof;
  return b._body;
}

// ───────────── LAS HUELLAS QUE SE PISAN Y LAS QUE SE TOCAN ─────────────
// Una vez por huella (`FIT`, por su llave): se descarta, se encoge o se deja como vino. Lo decide la
// MAYOR de cada par, y las mayores se resuelven primero, así una menor se mide contra lo que la mayor
// ya quedó. Las llaves cubren las huellas que llegan repetidas en dos tiles (cruzan el borde).
const FIT = new Map();
const keyOf = (b) => (b.osmId != null ? `o${b.osmId}` : `${b.pts[0]},${b.pts[1]},${b.pts.length}`);
function areaOf(pts) { return Math.abs(area2(pts)) / 2; }
function insidePoly(x, y, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function overlapArea(a, ba, b, bb, step) {
  const x0 = Math.max(ba.x0, bb.x0), y0 = Math.max(ba.y0, bb.y0), x1 = Math.min(ba.x1, bb.x1), y1 = Math.min(ba.y1, bb.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
    if (insidePoly(x, y, a) && insidePoly(x, y, b)) n++;
  }
  return n * step * step;
}
function scaled(pts, k) {
  let cx = 0, cy = 0; const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i] / n; cy += pts[i + 1] / n; }
  return pts.map((v, i) => (i % 2 ? cy + (v - cy) * k : cx + (v - cx) * k));
}
function fitFootprints(list) {
  const O = BODY3D.overlap || {}, step = O.samplePx || 2;
  const todo = list.filter((b) => !FIT.has(keyOf(b)));
  if (!todo.length) return;
  const all = list.map((b) => ({ b, key: keyOf(b), area: areaOf(b.pts) }))
    .sort((p, q) => q.area - p.area || (p.key < q.key ? -1 : 1));
  const placed = [];
  for (const it of all) {
    let fit = FIT.get(it.key);
    if (!fit) {
      let pts = it.b.pts, box = bbox(pts), drop = false;
      const bigger = placed.filter((q) => q.box.x1 > box.x0 && q.box.x0 < box.x1 && q.box.y1 > box.y0 && q.box.y0 < box.y1);
      const over = (p, bx) => bigger.reduce((s2, q) => s2 + overlapArea(p, bx, q.pts, q.box, step), 0);
      const o = over(pts, box);
      if (o > 0) {
        if (o >= (O.dropK ?? 0.4) * it.area) drop = true;
        else {
          drop = true;
          for (const k of O.shrink || []) {
            const sp = scaled(it.b.pts, k), sb = bbox(sp);
            if (over(sp, sb) === 0) { pts = sp; box = sb; drop = false; break; }
          }
        }
      }
      fit = { drop, pts, box };
      FIT.set(it.key, fit);
    }
    if (!fit.drop) placed.push(fit);
  }
}

/**
 * LAS HUELLAS CON NOMBRE EN VISTA, levantadas como cuerpos. Cada una UNA vez aunque venga en dos
 * tiles, sin pisarse con sus vecinas (`fitFootprints`) y, las que se tocan, inclinadas como un grupo:
 * el vector por metro del centro del grupo a la altura de su más alta, con el mismo tope que todo lo
 * demás (`parallax.maxOffsetPx`).
 */
function paintBuildingsInView(list, pool = list) {
  if (!BODY3D.enabled) { for (const b of list) paintBuilding(b); return; }
  fitFootprints(pool);
  const seen = new Set(), kept = [];
  for (const b of list) {
    const key = keyOf(b), fit = FIT.get(key);
    if (seen.has(key) || !fit || fit.drop) continue;
    seen.add(key);
    const st = buildingStyle(b) || districtBuildingStyle(b);
    const wall = (st && st.color) || b.color || S.building.fallback;
    const roof = (st && st.roof) || b.roof || S.roof;
    kept.push({ b, S: buildingBody(b, wall, roof, st, fit.pts), box: fit.box });
  }
  // los grupos: union-find sobre las cajas que se tocan
  const touch = (BODY3D.overlap || {}).touchPx ?? 4, parent = kept.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    const a = kept[i].box, c = kept[j].box;
    if (a.x1 + touch >= c.x0 && c.x1 + touch >= a.x0 && a.y1 + touch >= c.y0 && c.y1 + touch >= a.y0) parent[find(i)] = find(j);
  }
  const groups = new Map();
  kept.forEach((k, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); });
  const ppm = W.PX_PER_M;
  // LAS VENTANAS SE PRENDEN DE NOCHE, como en la caja de antes: del vidrio oscuro de los cuerpos
  // (`centro.inks.window`) a la luz cálida de `structure.building.windowsNight`, con la luz del día
  const windowInk = mixColor(MATERIALS.centro.inks.window, S.building.windowsNight, lightLevel());
  for (const g of groups.values()) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, H = 0;
    for (const k of g) { x0 = Math.min(x0, k.box.x0); y0 = Math.min(y0, k.box.y0); x1 = Math.max(x1, k.box.x1); y1 = Math.max(y1, k.box.y1); H = Math.max(H, k.S.zMax); }
    const o = parallaxOffset(state.cam, (x0 + x1) / 2, (y0 + y1) / 2, H, ppm);
    const lean = { dx: o.dx / (H || 1), dy: o.dy / (H || 1) };
    for (const k of g) { k.S.leanPerM = lean; k.b._bodyVars.window = windowInk; queueBody(k.S, k.b._bodyVars); }
  }
}

// One building: drop shadow, body, roof band + windows (clipped), outline.
function paintBuilding(b) {
  // CON `body3d` LA HUELLA ES UN CUERPO, como el centro cívico: lo arma `buildingBody` y lo pinta la
  // cola de `bodies.js` (sombra, paredes, ventanas y techo). Sin él, la caja de siempre de aquí abajo.
  if (BODY3D.enabled) {
    const st = buildingStyle(b) || districtBuildingStyle(b);
    const wall = (st && st.color) || b.color || S.building.fallback;
    const roof = (st && st.roof) || b.roof || S.roof;
    queueBody(buildingBody(b, wall, roof, st), b._bodyVars);
    return;
  }
  // LA HUELLA REDONDEADA, cacheada igual que la recta. `roundedPath` recorta el
  // VÉRTICE y deja las aristas donde estaban, así que la casa sigue tocando su
  // acera en todo el frente y sólo se despega en la esquina — que es lo que se
  // ve bien y lo que evita las costuras que abre encoger el polígono entero.
  // Con `buildingCornerPx: 0` devuelve el camino recto de siempre.
  const a = b.aabb, path = (b._path || (b._path = roundedPath(b.pts, ORGANIC.buildingCornerPx, true)));
  const bw = a.x1 - a.x0, bh = a.y1 - a.y0;
  // LA SOMBRA SIGUE AL SOL Y CRECE CON LA ALTURA. Era `translate(4, 4)`: abajo y
  // a la derecha, a las tres de la tarde y a las seis igual, y del mismo largo
  // para una casa que para el mercado. La altura se infiere de la huella porque
  // nada en el mundo emitido la trae — ver `buildingHeightM`.
  const heightM = buildingHeightM(b);
  const sh = sunShadow(heightM);
  // LA SOMBRA DE UN SÓLIDO ES SU BARRIDO, no una copia despegada. Esto era la
  // huella corrida y nada más, lo que en un edificio alto deja un HUECO entre
  // el cuerpo y su propia sombra — el sol no alcanza a colarse por debajo de
  // una bodega. Se pinta la base, la copia corrida y los costados que unen las
  // dos, que es la misma clasificación de aristas que decide las paredes, con
  // el vector del sol en vez del radial.
  ctx.save();
  ctx.globalAlpha = sh.alpha;
  ctx.fillStyle = S.building.shadow;
  paintSweep(ctx, b.pts, sh.dx, sh.dy, facingEdges(b.pts, -sh.dx, -sh.dy));
  ctx.fill(path);
  ctx.translate(sh.dx, sh.dy);
  ctx.fill(path);
  ctx.restore();
  // …Y EL COLOR SALE DE LO QUE EL EDIFICIO ES, si se sabe. El respaldo es el
  // color que el build emitió, así que una huella sin categoría se ve igual que
  // siempre: es lo que hace la migración demostrable edificio por edificio.
  // …Y SI NO SE SABE QUÉ ES, AL MENOS SE SABE DÓNDE ESTÁ. El orden es
  // deliberado: lo que un edificio ES gana sobre dónde está, porque una iglesia
  // es una iglesia en El Cocal y en Esparza y teñirla del color del barrio
  // borraría la señal que `building-styles.json` existe para dar. El barrio
  // sólo tiñe lo que no tiene categoría — que es la mayoría del tejido, o sea
  // la casa de al lado, que es justo lo que hacía que los doce barrios se
  // vieran iguales.
  const st = buildingStyle(b) || districtBuildingStyle(b);
  const body = (st && st.color) || b.color || S.building.fallback;

  // LAS PAREDES. La tapa se corre HACIA AFUERA en proporción a lo excéntrico
  // que esté el edificio —el pinhole de siempre— y entre la huella y la tapa
  // quedan los costados. Sólo se dibujan los que miran AL CENTRO: los de afuera
  // los tapa la propia tapa, que va encima.
  //
  // Se lee `state.cam` y no el marco de la cámara a propósito: el marco lleva
  // la SACUDIDA sumada, y unas paredes que tiemblan con cada golpe se leen como
  // un error de dibujo y no como un golpe.
  const ro = parallaxOffset(state.cam, (a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2,
                            heightM, W.PX_PER_M);
  if (ro.dx || ro.dy) {
    const wall = new Set(facingEdges(b.pts, ro.dx, ro.dy));
    // …Y CADA PARED SABE SI LE DA EL SOL. Es casi gratis —la misma
    // clasificación con el vector del sol— y es lo que separa un cuerpo de un
    // bloque: sin esto las cuatro caras salen del mismo gris y el edificio
    // vuelve a leerse plano, sólo que más alto.
    const sunlit = new Set(facingEdges(b.pts, sh.dx, sh.dy));
    const lit = [...wall].filter((i) => sunlit.has(i));
    const dark = [...wall].filter((i) => !sunlit.has(i));
    // LA PARED TIENE QUE CONTRASTAR CON EL TECHO O NO ES UNA PARED. La primera
    // versión mezclaba un 28 % y el resultado era del mismo color que el
    // cuerpo: el edificio salía corrido, no levantado.
    ctx.fillStyle = mixColor(body, S.building.wallDark, PAR.wallMixDark ?? 0);
    paintSweep(ctx, b.pts, ro.dx, ro.dy, dark);
    ctx.fillStyle = mixColor(body, S.building.wallLit, PAR.wallMixLit ?? 0);
    paintSweep(ctx, b.pts, ro.dx, ro.dy, lit);
    ctx.save();
    ctx.translate(ro.dx, ro.dy);
  } else {
    ctx.save();   // el cuerpo va a plomo: se está justo bajo la cámara
  }
  ctx.fillStyle = body; ctx.fill(path);
  // EL TECHO SE GASTA. Una mota clara y una oscura sobre el mismo cuerpo: es lo
  // que separa un zinc de veinte años de un rectángulo de color. Va antes del
  // recorte para que las partes autoradas —la banda del alero, las ventanas—
  // sigan pintándose sobre él y no debajo.
  overlayTexture(ctx, "roof", textureScale(), () => ctx.fill(path));
  ctx.save(); ctx.clip(path);
  ctx.translate(a.x0, a.y0);
  const vars = resolveAssetFormulaMap(S.building.values, {
    bw, bh, roof: (st && st.roof) || b.roof || S.roof,
    windows: Boolean(st && st.wnd !== undefined ? st.wnd : b.wnd),
    windowInk: mixColor(S.building.windowsDay, S.building.windowsNight, lightLevel()),
  });
  paintStructureParts(ctx, S.building.parts, {
    X: (value) => value || 0,
    Y: (value) => value || 0,
    vars,
    color: (spec) => structureColor(S.building, spec, vars),
  });
  ctx.restore();
  ctx.strokeStyle = S.building.outline; ctx.lineWidth = 1; ctx.stroke(path);
  ctx.restore();   // cierra el translate de la tapa
}

// Per-tile Ferrocarril rail pieces: ballast bed + ties + two steel rails.
// Decorative (not drivable), drawn on the ground over the roads.

// MUELLES. A pier is a polyline with a width and a style — a road that is
// allowed to leave the land (churchill/world/service/pier.py) — so both the
// Muelle Nacional and the faro's wooden jetty are drawn by the same pass, each
// segment in its own frame. That is what lets the editor bend one, extend it,
// or draw a third without a new draw function.
//: The deck recipe per PierStyle, from the shared material registry. Not just
//: a colour — seams, rails, lamps, and whether the deck lies on the ground.
//: EVERY style the builder can emit must have a row: `malecon` shipped for a
//: week without one and four beach ramps were drawn as concrete quays, with
//: blue railings and lamps, lying on the sand. `tests/test_materials.py`.
const PIER_STYLES = MATERIALS.pier;
// …y el resto de la paleta de las estructuras, al lado de esas recetas. El
// puente de Mata y el casco del ferry eran las dos últimas piezas grandes del
// mundo dibujadas con los colores escritos adentro de su propia función.
const S = MATERIALS.structure;
const ORGANIC = EFFECTS.organic || {};
const PAR = EFFECTS.parallax || {};

function structureColor(palette, spec, vars = {}) {
  if (typeof spec === "string" && spec.startsWith("$")) {
    return vars[spec.slice(1)] ?? palette[spec.slice(1)] ?? spec;
  }
  return spec;
}

/** Cuánto baja el PIE del poste de una luz respecto de su punto (el dibujo de `lights.json` la para encima
 *  de él): para que el pilote de la baranda quede debajo del poste y no a media asta. */
function lampFoot(type) {
  const spec = LIGHT_TYPES[type];
  let foot = 0;
  for (const part of (spec && spec.parts) || []) for (const p of part.pts || []) foot = Math.max(foot, Number(p[1]) || 0);
  return foot;
}

function pierInView(P, view, pad = 0) {
  const pts = P.pts, m = P.w / 2 + 40 + pad;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return !(x1 + m < view.x0 || x0 - m > view.x1 || y1 + m < view.y0 || y0 - m > view.y1);
}

// EL MUELLE EN 3D (`materials.json → pier._3d`). La cubierta se queda A RAS —el carro anda encima y se
// dibuja en el suelo—, así que lo que da la profundidad va HACIA ABAJO: el canto de la cubierta y los
// pilotes que se hunden en el agua, que se ven del lado que da a la cámara (lo que baja se corre hacia
// ella; del otro lado queda debajo de la cubierta, que se pinta después y lo tapa). Arriba, la baranda
// a su altura sobre sus postes. Los muelles a ras del suelo (las rampas de asfalto) no llevan nada.
const PIER3D = PIER_STYLES._3d;
function edgeRuns(P) {
  // las dos orillas de la cubierta (±hw por la normal de cada vértice) y la punta del mar
  const p = P.pts, n = p.length / 2, hw = P.w / 2, L = [], R = [];
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1], d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    L.push([p[k * 2] + nx * hw, p[k * 2 + 1] + ny * hw]); R.push([p[k * 2] - nx * hw, p[k * 2 + 1] - ny * hw]);
  }
  return { L, R };
}
function pierBelow(P, style) {
  const cam = state.cam, D = PIER3D, { L, R } = P._edges || (P._edges = edgeRuns(P));
  const down = (q, z) => liftPoint(cam, q[0], q[1], z);
  // los pilotes, de la cubierta al agua, cada `pileEveryM` por cada orilla
  const every = D.pileEveryM * W.PX_PER_M;
  ctx.strokeStyle = style.pile || D.pile; ctx.lineWidth = D.pileWM * W.PX_PER_M; ctx.lineCap = "butt";
  ctx.beginPath();
  for (const E of [L, R]) {
    let run = every / 2;
    for (let k = 0; k + 1 < E.length; k++) {
      const [ax, ay] = E[k], [bx, by] = E[k + 1], len = Math.hypot(bx - ax, by - ay);
      for (; run < len; run += every) {
        const q = [ax + (bx - ax) * run / len, ay + (by - ay) * run / len], t = down(q, -D.fasciaM), b = down(q, -D.pileM);
        ctx.moveTo(t[0], t[1]); ctx.lineTo(b[0], b[1]);
      }
      run -= len;
    }
  }
  ctx.stroke();
  // el canto de la cubierta, de la orilla a `fasciaM` abajo, por las dos orillas y la punta
  ctx.fillStyle = style.cap || D.fascia;
  const face = (a, b) => { const a2 = down(a, -D.fasciaM), b2 = down(b, -D.fasciaM); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(a2[0], a2[1]); ctx.closePath(); };
  ctx.beginPath();
  for (const E of [L, R]) for (let k = 0; k + 1 < E.length; k++) face(E[k], E[k + 1]);
  face(L[L.length - 1], R[R.length - 1]);
  ctx.fill();
}
function pierRail(P, style) {
  const cam = state.cam, D = PIER3D, ppm = W.PX_PER_M, hw = P.w / 2, p = P.pts;
  const up = (x, y, z) => { const o = parallaxOffset(cam, x, y, z, ppm); return [x + o.dx, y + o.dy]; };
  const gap = style.posts, start = style.postsAtLamps && style.lamp ? style.lamp.start + lampFoot(style.lamp.type) : (style.postStart ?? 10);
  for (const side of [1, -1]) {
    const line = [], posts = [];
    let run = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3], len = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy * side * (hw - 1), ny = ux * side * (hw - 1);
      if (!i) line.push([ax + nx, ay + ny]);
      line.push([bx + nx, by + ny]);
      if (gap) for (let s0 = start - (run % gap); s0 < len; s0 += gap) if (s0 >= 0) posts.push([ax + ux * s0 + nx, ay + uy * s0 + ny]);
      run += len;
    }
    // los postes, del piso a la baranda
    ctx.strokeStyle = style.pile || D.pile; ctx.lineWidth = Math.max(1, (style.postSize || 3) * 0.6); ctx.lineCap = "round";
    ctx.beginPath();
    for (const [x, y] of posts) { const t = up(x, y, D.railM); ctx.moveTo(x, y); ctx.lineTo(t[0], t[1]); }
    ctx.stroke();
    // la baranda, arriba
    ctx.strokeStyle = style.rail; ctx.lineWidth = D.railWM * ppm; ctx.lineJoin = "round";
    ctx.beginPath();
    line.forEach(([x, y], k) => { const t = up(x, y, D.railM); k ? ctx.lineTo(t[0], t[1]) : ctx.moveTo(t[0], t[1]); });
    ctx.stroke();
  }
}

function drawPier(P, view) {
  if (!pierInView(P, view)) return;
  const style = PIER_STYLES[P.style] || PIER_STYLES.concrete;
  const hw = P.w / 2, pts = P.pts;
  const deep = PIER3D && !style.ground && !style.round;
  if (deep) pierBelow(P, style);
  let run = 0;                       // arclength so far, so seams and lamps
  for (let i = 0; i < pts.length - 2; i += 2) {   // never restart at a bend
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const len = Math.hypot(bx - ax, by - ay);
    const last = i === pts.length - 4;
    ctx.save();
    ctx.translate(ax, ay); ctx.rotate(Math.atan2(by - ay, bx - ax));
    const vars = {
      len, hw, negHw: -hw, width: P.w, run, last,
      round: Boolean(style.round), shadowVisible: !style.round && !deep,
      deck: style.deck, seam: style.seam, seamGap: style.seamGap,
      cap: style.cap, capVisible: Boolean(style.cap && last), rail: deep ? null : style.rail,
      centre: style.centre, centreStart: run ? 0 : 6, centreEnd: last ? len - 6 : len,
      posts: deep ? null : style.posts, postStart: style.postsAtLamps && style.lamp ? style.lamp.start + lampFoot(style.lamp.type) : style.postStart, postSize: style.postSize, pile: style.pile,
    };
    paintStructureParts(ctx, S.pierDeck.parts, {
      X: (value) => value || 0,
      Y: (value) => value || 0,
      vars,
      color: (spec) => structureColor(S.pierDeck, spec, vars),
    });
    ctx.restore();
    run += len;
  }
  if (deep && style.rail) pierRail(P, style);
  for (const L of pierLamps(P)) paintLight(L.type, L.x, L.y, { night: false, ang: L.ang, lamp: L });
  if (style.hut) drawPierHut(P, hw);
}

/**
 * LAS LÁMPARAS DE UN MUELLE, en coordenadas del mundo.
 *
 * Una lámpara de muelle ES UNA LUZ y no un adorno del entablado. Vivía dentro
 * de la receta del deck como el verbo de familia `pier-lamps`, con su propio
 * poste, su propio bombillo y sus dos colores día/noche escritos aparte — es
 * decir, un SEGUNDO sistema de alumbrado al lado de `lights.json`, que ya traía
 * `amber` descrito como «la del muelle» y jamás se usó. Se veía en que las del
 * muelle no prendían: la noche es un velo que las lámparas PERFORAN, y sólo
 * perforan las que el compositor conoce.
 *
 * Así que acá queda lo único que es del muelle —DÓNDE se para cada una, que sale
 * de la geometría de su propio deck— y el resto lo contesta el registro. La
 * misma función la usa el compositor de noche para abrir el pozo, de modo que la
 * lámpara dibujada y la luz que da son literalmente la misma.
 */
export function pierLamps(P) {
  const style = PIER_STYLES[P.style] || PIER_STYLES.concrete;
  const spec = style.lamp;
  if (!spec) return [];
  const gap = spec.gap, hw = P.w / 2, pts = P.pts, out = [];
  let run = 0;
  for (let i = 0; i < pts.length - 2; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / (len || 1), uy = (by - ay) / (len || 1);
    const nx = -uy, ny = ux;
    for (let d = spec.start - (run % gap); d < len - spec.endInset; d += gap) {
      if (d < 0) continue;
      // De lado y lado alternando, que es como está alumbrado un muelle de
      // verdad: dos hileras enfrentadas costarían el doble de postes para
      // alumbrar lo mismo.
      const side = spec.alternate === false ? -1
        : ((((run + d) / gap) | 0) % 2 ? 1 : -1);
      const off = side * (hw - spec.sideInset);
      out.push({
        x: ax + ux * d + nx * off, y: ay + uy * d + ny * off,
        type: spec.type, ang: Math.atan2(uy, ux),
      });
    }
    run += len;
  }
  return out;
}

/** Las de todos los muelles que alcanzan la vista — lo que el compositor de
 *  noche necesita para abrirles el pozo. */
export function pierLampsIn(view, pad = 0) {
  const out = [];
  for (const P of W.PIERS || []) {
    if (!pierInView(P, view, pad)) continue;
    for (const L of pierLamps(P)) {
      if (L.x < view.x0 - pad || L.x > view.x1 + pad
        || L.y < view.y0 - pad || L.y > view.y1 + pad) continue;
      out.push(L);
    }
  }
  return out;
}

// The guard hut at the shore entrance, beside the deck — drawn in the pier's
// frame so it follows a muelle that was moved or turned.
// LA CASETA at the muelle's landward end.
//
// It used to be drawn INSIDE the pier's rotation, so on the Muelle Nacional —
// which runs due south — the whole building was laid on its side: a roof facing
// west and a box that read as a house knocked over. Everything else built in
// this world is drawn axis-aligned from above (see `paintBuilding`), because
// that is what "seen from the sky" looks like; only the POSITION should come
// from the pier.
//
// So: the pier gives us where to stand it — at the landward end, pushed off the
// deck by its own normal — and the caseta itself is drawn upright in world
// axes, with its door on the side that faces the deck.
function drawPierHut(P, hw) {
  const [ax, ay, bx, by] = P.pts;
  const a = Math.atan2(by - ay, bx - ax);
  const ux = Math.cos(a), uy = Math.sin(a);        // along the pier, seaward
  const nx = -Math.sin(a), ny = Math.cos(a);       // off the deck, to one side
  // `hutAt`: el mundo puede decir dónde va la caseta (la del Muelle de Cruceros va sobre el malecón)
  const cx = P.hutAt ? P.hutAt[0] : ax + nx * (hw + 13) + ux * 18;
  const cy = P.hutAt ? P.hutAt[1] : ay + ny * (hw + 13) + uy * 18;
  // LA CASETA ES UN CUERPO (`world-props.json → bodies.pierHut`), con su puerta hacia la cubierta
  if (PROPS.bodies.pierHut) { queueBody(bodyAt(PROPS.bodies.pierHut, cx, cy, Math.atan2(-ny, -nx), "pierHut")); return; }
  const vars = resolveAssetFormulaMap(S.pierHut.values, { nx, ny });
  ctx.save();
  ctx.translate(cx, cy);
  paintStructureParts(ctx, S.pierHut.parts, {
    X: (value) => value || 0,
    Y: (value) => value || 0,
    vars,
    color: (spec) => structureColor(S.pierHut, spec, vars),
  });
  ctx.restore();
}

// Two passes, because a muelle and a ramp sit at different heights in the
// frame. A deck over the sea is drawn with the set pieces, above the water; an
// APRON is asphalt lying on the ground, so it goes down with the other paved
// connectors — before the buildings and the flora, or the terminal's palms
// would end up underneath it.
function drawPiers(view, ground = false) {
  for (const P of W.PIERS) {
    const style = PIER_STYLES[P.style] || PIER_STYLES.concrete;
    if (Boolean(style.ground) !== ground) continue;
    drawPier(P, view);
  }
}

// EL PUENTE COLGANTE DE MATA DE LIMÓN, EN 3D — sobre la vía de verdad.
//
// Era un ALZADO: el dibujo de costado del puente (torres paradas hacia arriba de
// la pantalla) pintado en horizontal entre `x0` y `x1`, cuando la vía que cruza
// el estero corre de norte a sur. Ahora todo sigue `B.pts`:
//   * el TRAMO COLGANTE es el que cruza el agua, y lo dice el suelo (a cada lado
//     del tablero), no un número: se mide una vez, con los tiles ya cargados;
//   * las torres en H (`furniture3d.js → drawBridgeTower3d`), los dos cables con
//     su flecha bajando a sus anclajes, las péndolas y las barandas se levantan
//     con el pinhole de los edificios;
//   * el tablero va a ras (el carro anda sobre él) y tira sobre el agua la
//     sombra de uno en alto: es lo que hace que se lea como un puente.
const BV = S.bridge.view3d;
const UNCAPPED = { ...(EFFECTS.parallax || {}), maxOffsetPx: 0 };

/** Muestras de la vía cada `step` px: punto, tangente y largo acumulado. */
function bridgeSamples(pts, step) {
  const out = [];
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const L = Math.hypot(bx - ax, by - ay) || 1, tx = (bx - ax) / L, ty = (by - ay) / L;
    for (let d = 0; d < L; d += step) out.push({ x: ax + tx * d, y: ay + ty * d, tx, ty, s: run + d });
    run += L;
  }
  const n = pts.length;
  const last = out[out.length - 1] || { tx: 1, ty: 0 };
  out.push({ x: pts[n - 2], y: pts[n - 1], tx: last.tx, ty: last.ty, s: run });
  return out;
}

/**
 * EL TABLERO Y EL TRAMO SOBRE EL AGUA, medidos del suelo: desde cada muestra de
 * la vía se camina hacia afuera hasta dejar la calzada (puente o calle) y se
 * mira qué hay: agua de los dos lados es el tramo colgante. El medio ancho es la
 * mediana de esas distancias — `deckW` del build es más angosto que la calzada
 * estampada, y una baranda ahí quedaba adentro del asfalto. null hasta que los
 * tiles estén cargados (`surfaceAt` contesta agua para uno que no llegó).
 */
function bridgeMeasure(B) {
  if (B._measure !== undefined) return B._measure;
  const smp = bridgeSamples(B.pts, 4), reach = 160, deckish = new Set([SURFACE.BRIDGE, SURFACE.ROAD]);
  const edges = [], wet = [];
  for (const q of smp) {
    if (!W.tileResident(q.x, q.y)) return null;
    const nx = -q.ty, ny = q.tx;
    let both = true;
    for (const sg of [-1, 1]) {
      let r = 2, c = W.surfaceAt(q.x, q.y);
      while (r < reach && deckish.has(c)) { r += 2; c = W.surfaceAt(q.x + nx * r * sg, q.y + ny * r * sg); }
      if (r < reach) edges.push(r);
      if (c !== SURFACE.WATER) both = false;
    }
    wet.push(both);
  }
  let best = null, cur = null;
  smp.forEach((q, i) => {
    if (wet[i]) { cur = cur || { s0: q.s, s1: q.s }; cur.s1 = q.s; if (!best || cur.s1 - cur.s0 > best.s1 - best.s0) best = cur; }
    else cur = null;
  });
  edges.sort((a, b) => a - b);
  const half = edges.length ? edges[Math.floor(edges.length / 2)] - 1 : B.deckW / 2;
  const span = best && best.s1 - best.s0 > 20 ? best : { s0: 0, s1: smp[smp.length - 1].s };
  B._measure = { half, span };
  return B._measure;
}

function drawBridge(view) {
  if (!W.BRIDGE) return;
  const B = W.BRIDGE, V = BV, ppm = W.PX_PER_M, I = V.inks;
  const xs = B.pts.filter((_, i) => i % 2 === 0), ys = B.pts.filter((_, i) => i % 2 === 1);
  const pad = 300;
  if (Math.max(...xs) < view.x0 - pad || Math.min(...xs) > view.x1 + pad
    || Math.max(...ys) < view.y0 - pad || Math.min(...ys) > view.y1 + pad) return;
  const M = bridgeMeasure(B);
  if (!M) return;
  const half = M.half, halfM = half / ppm, span = M.span;
  const smp = bridgeSamples(B.pts, 3);
  const at = (s) => {
    let k = 0;
    while (k + 1 < smp.length && smp[k + 1].s < s) k++;
    const a = smp[k], b = smp[Math.min(k + 1, smp.length - 1)], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: a.tx, ty: a.ty };
  };
  const L = span.s1 - span.s0;
  const t0 = span.s0 + L * V.towersK[0], t1 = span.s0 + L * V.towersK[1];
  const a0 = Math.max(0, span.s0 - V.anchorOutM * ppm), a1 = Math.min(smp[smp.length - 1].s, span.s1 + V.anchorOutM * ppm);
  const H = V.towerHM, low = V.railHM + V.sagM;
  // la altura del cable en el largo `s`: sube del anclaje a la torre, cuelga entre las dos
  const cableZ = (s) => {
    if (s <= t0) return V.anchorHM + (H - V.anchorHM) * (s - a0) / Math.max(1, t0 - a0);
    if (s >= t1) return V.anchorHM + (H - V.anchorHM) * (a1 - s) / Math.max(1, a1 - t1);
    const u = (2 * s - t0 - t1) / (t1 - t0);
    return low + (H - low) * u * u;
  };
  // EL MISMO TOPE QUE LAS TORRES: el aparejo encoge su altura entera cuando el
  // corrimiento pasa del tope, así que el cable se encoge con la torre más cercana
  const cap = (EFFECTS.parallax || {}).maxOffsetPx || 0;
  const squashAt = (x, y) => {
    const o = parallaxOffset(state.cam, x, y, H, ppm, UNCAPPED), len = Math.hypot(o.dx, o.dy);
    return cap > 0 && len > cap ? cap / len : 1;
  };
  const P0 = at(t0), P1 = at(t1), k0 = squashAt(P0.x, P0.y), k1 = squashAt(P1.x, P1.y);
  const up = (x, y, h, s) => {
    if (!(h > 0)) return [x, y];
    const o = parallaxOffset(state.cam, x, y, h, ppm, UNCAPPED), k = Math.abs(s - t0) < Math.abs(s - t1) ? k0 : k1;
    return [x + o.dx * k, y + o.dy * k];
  };
  const sun = sunShadow(1);
  const side = (q, sg, out = 0) => { const r = (half + out) * sg; return [q.x - q.ty * r, q.y + q.tx * r]; };
  const line = (P, w, ink) => {
    ctx.strokeStyle = ink; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); P.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  };
  const cableS = []; for (let s = a0; s <= a1; s += 4) cableS.push(s); cableS.push(a1);
  const legOut = V.legOutM * ppm;

  // LA SOMBRA DEL TABLERO SOBRE EL AGUA, fuera del tablero mismo
  if (sun.alpha > 0) {
    const deck = [], back = [];
    for (let s = span.s0; s <= span.s1; s += 4) { const q = at(s); deck.push(side(q, -1)); back.push(side(q, 1)); }
    const poly = deck.concat(back.reverse());
    const d = sunShadow(V.deckShadowM);
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.x0 - pad, view.y0 - pad, view.x1 - view.x0 + 2 * pad, view.y1 - view.y0 + 2 * pad);
    poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip("evenodd");
    ctx.globalAlpha = sun.alpha * V.deckShadowK;
    ctx.fillStyle = I.shadow;
    ctx.beginPath();
    poly.forEach(([x, y], k) => (k ? ctx.lineTo(x + d.dx, y + d.dy) : ctx.moveTo(x + d.dx, y + d.dy)));
    ctx.closePath(); ctx.fill();
    // …y la de los cables, en el agua también
    ctx.globalAlpha = sun.alpha * 0.45;
    for (const sg of [-1, 1]) {
      line(cableS.map((s) => { const q = at(s), [x, y] = side(q, sg, legOut / 1); const z = cableZ(s), o = sunShadow(z); return [x + o.dx, y + o.dy]; }),
        V.cableWM * ppm, I.shadow);
    }
    ctx.restore();
  }

  // LAS BARANDAS, a lo largo del tablero entero
  for (const sg of [-1, 1]) {
    const edge = [];
    for (let s = 0; s <= smp[smp.length - 1].s; s += 6) { const [x, y] = side(at(s), sg); edge.push(x, y); }
    drawRaisedStroke3d(edge, V.railWM * ppm, V.railHM, { side: I.railSide, top: I.rail, shadow: I.shadow },
      { everyM: V.railPostEveryM, wM: V.railWM });
  }

  // LAS TORRES
  for (const q of [P0, P1]) drawBridgeTower3d(q.x, q.y, Math.atan2(q.ty, q.tx), halfM, V);

  // LOS CABLES Y LAS PÉNDOLAS, encima de lo que pase por el tablero
  queueBodyLike({ x: (P0.x + P1.x) / 2, y: (P0.y + P1.y) / 2, paint: () => {
    for (const sg of [-1, 1]) {
      ctx.save(); ctx.strokeStyle = I.hanger; ctx.lineWidth = Math.max(0.6, V.hangerWM * ppm); ctx.beginPath();
      for (let s = t0 + V.hangerEveryM * ppm; s < t1 - 1; s += V.hangerEveryM * ppm) {
        const q = at(s), [x, y] = side(q, sg, legOut);
        const b = up(x, y, V.railHM, s), c = up(x, y, cableZ(s), s);
        ctx.moveTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
      }
      ctx.stroke(); ctx.restore();
      line(cableS.map((s) => { const q = at(s), [x, y] = side(q, sg, legOut); return up(x, y, cableZ(s), s); }),
        V.cableWM * ppm, I.cable);
    }
  } });

  // el nombre, a un costado del medio del tramo
  const mid = at((span.s0 + span.s1) / 2), [lx, ly] = side(mid, 1, V.labelOutM * ppm);
  label(lx, ly, "PUENTE MATA LIMÓN", S.bridge.signFg, S.bridge.signBg);
}

// The two ferries and their berths. Everything is drawn in the ferry's own
// frame, so a berth on a diagonal quay and a hull mid-crossing are the same
// code — and the DECK RECT drawn here is exactly the rect `deckAt` tests, which
// is what keeps "looks like I am on it" and "am I on it" the same thing.
function drawFerry(f, view) {
  const R0 = f.dl / 2 + 40;
  if (f.x + R0 < view.x0 || f.x - R0 > view.x1 || f.y + R0 < view.y0 || f.y - R0 > view.y1) return;
  const L = f.dl / 2, B = f.dw / 2, M = S.ferry.model, ppm = W.PX_PER_M;
  const vars = { L, B, moving: f.phase === "out" || f.phase === "back", travelDir: f.phase === "back" ? -1 : 1, doubleEnded: f.doubleEnded, shadowAlpha: 0 };
  // la estela sigue siendo la del registro (la primera parte de la receta plana): va en el agua
  ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
  paintStructureParts(ctx, S.ferry.parts.slice(0, 1), { X: (v) => v || 0, Y: (v) => v || 0, vars, color: (spec) => structureColor(S.ferry, spec) });
  ctx.restore();
  // EL FERRY ES UN CUERPO (`vesselRigs.js`): la sombra entera de una vez, el casco y la cubierta a ras
  // del suelo (el carro sube a ella), y lo que se levanta sobre la cubierta, con los cuerpos
  const dims = { L: L / ppm, B: B / ppm, M };
  const run = (g, mode, keep) => { const R = makeRig(g, f.x, f.y, f.a, ppm, state.cam, mode, M.shade, M.gantryM + M.mastM); ferryForm(R, dims); R.flush(keep); };
  const sun = sunShadow(1);
  if (sun.alpha > 0) withShadowLayer(ctx, f.x, f.y, (L + M.rampM * ppm) * 1.7, sun.alpha * M.shadowAlpha, (g) => run(g, "sun"));
  run(ctx, "cam", (h) => h <= M.splitM);
  // LA CUBIERTA DE PASAJEROS (`model.upper`) se desvanece cuando el jugador va abajo con su carro:
  // se pinta opaca en su propia capa y se compone a `fadeK`, así no se transparenta pieza contra pieza
  const fadeFrom = M.superTopM + 0.02, under = M.upper && state.aboard != null && state.aboard === f.id;
  queueBodyLike({ x: f.x, y: f.y, paint: () => {
    run(ctx, "cam", (h) => h > M.splitM && (!under || h < fadeFrom));
    if (under) withShadowLayer(ctx, f.x, f.y, (L + M.rampM * ppm) * 1.7, M.upper.fadeK, (g) => run(g, "cam", (h) => h >= fadeFrom));
    label(f.x, f.y - f.dw / 2 - 14, (f.vesselName || f.name).toUpperCase(), S.ferry.nameFg, S.ferry.nameBg);
  } });
}
// The berth she sails from: a concrete apron at the quay, so an empty berth
// still reads as a place a ferry belongs rather than a gap in the sea wall.
// EL ATRACADERO EN 3D (`structure.berth._3d`): la losa se queda a ras —el carro sube por ella a la
// rampa—, y lo que la hace muelle va hacia abajo y hacia arriba: su canto hundiéndose en el agua por
// los tres lados del mar y dos bolardos en las esquinas donde se amarra el ferry.
function berthDepth(px, py, pa, dw) {
  const D = S.berth._3d, ppm = W.PX_PER_M, cam = state.cam, c = Math.cos(pa), s = Math.sin(pa);
  const at = (u, v) => [px + u * c - v * s, py + u * s + v * c];
  const x0 = -14, x1 = 32, y0 = -dw / 2 - 6, y1 = dw / 2 + 6;
  const corners = [at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
  ctx.fillStyle = D.fascia; ctx.beginPath();
  for (const [a, b] of [[corners[3], corners[0]], [corners[0], corners[1]], [corners[1], corners[2]]]) {
    const a2 = liftPoint(cam, a[0], a[1], -D.fasciaM), b2 = liftPoint(cam, b[0], b[1], -D.fasciaM);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(a2[0], a2[1]); ctx.closePath();
  }
  ctx.fill();
  return () => {
    for (const v of [y0 + 3, y1 - 3]) {
      const [bx, by] = at(x1 - 3, v), o = parallaxOffset(cam, bx, by, D.bollardM, ppm), r = D.bollardRM * ppm;
      ctx.strokeStyle = D.bollardSide; ctx.lineWidth = r * 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + o.dx, by + o.dy); ctx.stroke();
      ctx.fillStyle = D.bollard; ctx.beginPath(); ctx.arc(bx + o.dx, by + o.dy, r, 0, Math.PI * 2); ctx.fill();
    }
  };
}

function drawBerth(f, view) {
  // `berthPose` [x, y, ang]: el mundo puede poner la plataforma donde va la rampa
  // de verdad —a lo largo de su calle— en vez de en el arranque de la ruta
  if (f.berthPose) {
    const [px, py, pa] = f.berthPose;
    if (px + 90 < view.x0 || px - 90 > view.x1 || py + 90 < view.y0 || py - 90 > view.y1) return;
    const top = S.berth._3d ? berthDepth(px, py, pa, f.dw) : null;
    ctx.save(); ctx.translate(px, py); ctx.rotate(pa);
    const B = f.dw / 2;
    paintStructureParts(ctx, S.berth.parts, { X: (v) => v || 0, Y: (v) => v || 0,
      vars: { dw: f.dw, negB: -B, apronY: -B - 6, apronH: f.dw + 12 }, color: (spec) => structureColor(S.berth, spec) });
    ctx.restore();
    if (top) top();
    return;
  }
  const bx = f.pts[0].x, by = f.pts[0].y;
  if (bx + 90 < view.x0 || bx - 90 > view.x1 || by + 90 < view.y0 || by - 90 > view.y1) return;
  const ba = f.pts.length > 1 ? Math.atan2(f.pts[1].y - by, f.pts[1].x - bx) : 0;
  const top = S.berth._3d ? berthDepth(bx, by, ba, f.dw) : null;
  ctx.save();
  ctx.translate(bx, by); ctx.rotate(ba);
  const B = f.dw / 2;
  paintStructureParts(ctx, S.berth.parts, {
    X: (value) => value || 0,
    Y: (value) => value || 0,
    vars: { dw: f.dw, negB: -B, apronY: -B - 6, apronH: f.dw + 12 },
    color: (spec) => structureColor(S.berth, spec),
  });
  ctx.restore();
  if (top) top();
}
function drawFerries(view) {
  for (const f of ferries()) { drawBerth(f, view); drawFerry(f, view); }
}

export { drawBridge, drawFerries, drawPiers, paintBuilding, paintBuildingsInView };

// Y QUE LA NOCHE LAS CONOZCA. Sin esto se dibujan y no alumbran: el velo de la
// noche se pinta encima y sólo lo perforan las lámparas que el compositor tiene
// en su lista.
registerLampSource(pierLampsIn);
