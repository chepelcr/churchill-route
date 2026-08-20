// Hand-drawn set pieces: buildings, the two muelles and the Mata de Limón
// suspension bridge. The painterly tile pass doesn't cover these.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, flatPath, label } from "./gfx.js";
import { ferries } from "../../game/ferries.js";
import { buildingHeightM, sunShadow } from "./shadows.js";
import { resolveAssetFormulaMap } from "./shapes.js";
import { paintStructureParts } from "./structureShapes.js";

// One building: drop shadow, body, roof band + windows (clipped), outline.
function paintBuilding(b) {
  const a = b.aabb, path = (b._path || (b._path = flatPath(b.pts, true)));
  const bw = a.x1 - a.x0, bh = a.y1 - a.y0;
  // LA SOMBRA SIGUE AL SOL Y CRECE CON LA ALTURA. Era `translate(4, 4)`: abajo y
  // a la derecha, a las tres de la tarde y a las seis igual, y del mismo largo
  // para una casa que para el mercado. La altura se infiere de la huella porque
  // nada en el mundo emitido la trae — ver `buildingHeightM`.
  const sh = sunShadow(buildingHeightM(b));
  ctx.save();
  ctx.translate(sh.dx, sh.dy);
  ctx.globalAlpha = sh.alpha;
  ctx.fillStyle = S.building.shadow;
  ctx.fill(path);
  ctx.restore();
  ctx.fillStyle = b.color || S.building.fallback; ctx.fill(path);
  ctx.save(); ctx.clip(path);
  ctx.translate(a.x0, a.y0);
  const vars = resolveAssetFormulaMap(S.building.values, {
    bw, bh, roof: b.roof || S.roof,
    windows: Boolean(b.wnd),
    windowInk: state.weather === "night" ? S.building.windowsNight : S.building.windowsDay,
  });
  paintStructureParts(ctx, S.building.parts, {
    X: (value) => value || 0,
    Y: (value) => value || 0,
    vars,
    color: (spec) => structureColor(S.building, spec, vars),
  });
  ctx.restore();
  ctx.strokeStyle = S.building.outline; ctx.lineWidth = 1; ctx.stroke(path);
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

function structureColor(palette, spec, vars = {}) {
  if (typeof spec === "string" && spec.startsWith("$")) {
    return vars[spec.slice(1)] ?? palette[spec.slice(1)] ?? spec;
  }
  return spec;
}

function pierInView(P, view) {
  const pts = P.pts, m = P.w / 2 + 40;
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
      posts: style.posts, lamps: style.lamps, night: state.weather === "night",
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
  if (style.hut) drawPierHut(P, hw);
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
