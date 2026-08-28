// Hand-drawn set pieces: buildings, the two muelles and the Mata de Limón
// suspension bridge. The painterly tile pass doesn't cover these.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, flatPath, label, mixColor, textureScale } from "./gfx.js";
import { overlayTexture } from "./materials.js";
import { ferries } from "../../game/ferries.js";
import { buildingHeightM, sunShadow } from "./shadows.js";
import { roundedPath } from "./curves.js";
import { facingEdges, paintSweep, parallaxOffset } from "./depth.js";
import { resolveAssetFormulaMap } from "./shapes.js";
import { paintStructureParts } from "./structureShapes.js";
import { paintLight } from "./lights.js";
import { buildingStyle } from "./buildingStyle.js";
import { districtBuildingStyle } from "./districts.js";
import { lightsOn } from "../../game/daynight.js";
import { registerLampSource } from "./nightlights.js";

// One building: drop shadow, body, roof band + windows (clipped), outline.
function paintBuilding(b) {
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
    // LO PREGUNTA `lightsOn()`, que es el dueño. Era `state.weather === "night"`:
    // una tormenta a mediodía cierra el cielo y prende el alumbrado de la ciudad,
    // pero las ventanas de los edificios se quedaban apagadas — dos umbrales
    // para una sola pregunta, que es exactamente el error que la noche ya tuvo
    // una vez con las lámparas.
    windowInk: lightsOn() ? S.building.windowsNight : S.building.windowsDay,
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

function pierInView(P, view, pad = 0) {
  const pts = P.pts, m = P.w / 2 + 40 + pad;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return !(x1 + m < view.x0 || x0 - m > view.x1 || y1 + m < view.y0 || y0 - m > view.y1);
}

function drawPier(P, view) {
  if (!pierInView(P, view)) return;
  const style = PIER_STYLES[P.style] || PIER_STYLES.concrete;
  const hw = P.w / 2, pts = P.pts;
  let run = 0;                       // arclength so far, so seams and lamps
  for (let i = 0; i < pts.length - 2; i += 2) {   // never restart at a bend
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const len = Math.hypot(bx - ax, by - ay);
    const last = i === pts.length - 4;
    ctx.save();
    ctx.translate(ax, ay); ctx.rotate(Math.atan2(by - ay, bx - ax));
    const vars = {
      len, hw, negHw: -hw, width: P.w, run, last,
      round: Boolean(style.round), shadowVisible: !style.round,
      deck: style.deck, seam: style.seam, seamGap: style.seamGap,
      cap: style.cap, capVisible: Boolean(style.cap && last), rail: style.rail,
      centre: style.centre, centreStart: run ? 0 : 6, centreEnd: last ? len - 6 : len,
      posts: style.posts,
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
  for (const L of pierLamps(P)) paintLight(L.type, L.x, L.y, { night: false });
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
        type: spec.type,
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
  const cx = ax + nx * (hw + 13) + ux * 18;
  const cy = ay + ny * (hw + 13) + uy * 18;
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

// Suspension bridge — towers, cables, deck, rails
function drawBridge(view) {
  if (!W.BRIDGE) return;
  const B = W.BRIDGE;
  if (B.x1 < view.x0 || B.x0 > view.x1) return;
  const [tx0, tx1] = B.towers;
  const vars = resolveAssetFormulaMap(S.bridge.values, {
    len: B.x1 - B.x0,
    deckW: B.deckW,
    tower0: tx0 - B.x0,
    tower1: tx1 - B.x0,
    towerH: B.towerH,
    labelText: "PUENTE MATA LIMÓN",
  });
  ctx.save();
  ctx.translate(B.x0, B.cy);
  paintStructureParts(ctx, S.bridge.parts, {
    X: (value) => value || 0,
    Y: (value) => value || 0,
    vars,
    color: (spec) => structureColor(S.bridge, spec, vars),
  });
  ctx.restore();
}

// The two ferries and their berths. Everything is drawn in the ferry's own
// frame, so a berth on a diagonal quay and a hull mid-crossing are the same
// code — and the DECK RECT drawn here is exactly the rect `deckAt` tests, which
// is what keeps "looks like I am on it" and "am I on it" the same thing.
function drawFerry(f, view) {
  const R = f.dl / 2 + 40;
  if (f.x + R < view.x0 || f.x - R > view.x1 || f.y + R < view.y0 || f.y - R > view.y1) return;
  const L = f.dl / 2, B = f.dw / 2;
  ctx.save();
  ctx.translate(f.x, f.y); ctx.rotate(f.a);
  const sh = sunShadow(S.ferry.heightM);
  paintStructureParts(ctx, S.ferry.parts, {
    X: (value) => value || 0,
    Y: (value) => value || 0,
    vars: {
      L, B,
      moving: f.phase === "out" || f.phase === "back",
      travelDir: f.phase === "back" ? -1 : 1,
      doubleEnded: f.doubleEnded,
      shadowDx: sh.dx, shadowDy: sh.dy, shadowAlpha: sh.alpha,
    },
    color: (spec) => structureColor(S.ferry, spec),
  });
  ctx.restore();
  label(f.x, f.y - f.dw / 2 - 14, (f.vesselName || f.name).toUpperCase(),
        S.ferry.nameFg, S.ferry.nameBg);
}
// The berth she sails from: a concrete apron at the quay, so an empty berth
// still reads as a place a ferry belongs rather than a gap in the sea wall.
function drawBerth(f, view) {
  const bx = f.pts[0].x, by = f.pts[0].y;
  if (bx + 90 < view.x0 || bx - 90 > view.x1 || by + 90 < view.y0 || by - 90 > view.y1) return;
  ctx.save();
  ctx.translate(bx, by); ctx.rotate(f.pts.length > 1
    ? Math.atan2(f.pts[1].y - by, f.pts[1].x - bx) : 0);
  const B = f.dw / 2;
  paintStructureParts(ctx, S.berth.parts, {
    X: (value) => value || 0,
    Y: (value) => value || 0,
    vars: { dw: f.dw, negB: -B, apronY: -B - 6, apronH: f.dw + 12 },
    color: (spec) => structureColor(S.berth, spec),
  });
  ctx.restore();
}
function drawFerries(view) {
  for (const f of ferries()) { drawBerth(f, view); drawFerry(f, view); }
}

export { drawBridge, drawFerries, drawPiers, paintBuilding };

// Y QUE LA NOCHE LAS CONOZCA. Sin esto se dibujan y no alumbran: el velo de la
// noche se pinta encima y sólo lo perforan las lámparas que el compositor tiene
// en su lista.
registerLampSource(pierLampsIn);
