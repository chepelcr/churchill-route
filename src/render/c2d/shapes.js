// THE SHAPE INTERPRETER — the engine's half of every art catalog in this game.
//
// `src/assets/vehicles.json` and `src/assets/world-props.json` describe what a
// thing looks like as an ordered list of PARTS; this walks that list. The
// vocabulary below is finite and closed on purpose: data composes these, it
// never invents one, which is the line `docs/inventory.md` §12 draws between an
// asset and a Canvas command stream.
//
// One interpreter, two catalogs, because the alternative is what this replaced:
// `paintVehicle` and `drawLandmark` were separate if/else chains that solved the
// same problem twice and drifted apart in the details — the vehicle chain used
// `fillRect`, the landmark one `ctx.fillRect`, and neither could reuse the
// other's stripes or gable.
//
// THE FRAME IS THE CALLER'S. A vehicle measures in half-extents of its own
// body, a landmark in pixels around its anchor, so the caller passes `X`/`Y`
// evaluators and this never has to know which. Same reason `color` is passed
// in: a vehicle resolves `$color` against its paint, a prop against nothing.
// NOTHING FROM `gfx.js`. This file is importable on its own — the editor loads
// it to preview the very record it is editing, and `gfx.js` would drag the world
// accessor, `state`, the day cycle, `tuning` and `materials.json` in with it.
// `primitives.js` holds the four helpers that used to come from there; the only
// thing genuinely tied to the running renderer is the DEFAULT context, which
// `paintProp` resolves lazily so a caller that passes its own `g` never touches
// the game at all.
import { PATHS, evalOn as evalScalar } from "../vehicleShapes.js";
import { areaLabel, hash01, label } from "./primitives.js";
import { spriteImage, spriteRecord } from "./sprites.js";

const TAU = Math.PI * 2;

// A TINY, CLOSED FORMULA VOCABULARY FOR ASSET FRAMES.
//
// A cathedral recipe may depend on both half-extents of its host parcel. That
// dependency is authored content too: leaving `min(hh, hw * .62)` in a
// `drawCathedral` function means the JSON still does not own the cathedral's
// proportions. These expressions are explicit JSON trees, never source text;
// the engine supplies only this finite arithmetic vocabulary and host facts.
// There is no property lookup, function call or Canvas access in the language.
export const ASSET_FORMULA_OPS = Object.freeze([
  "add", "sub", "mul", "div", "min", "max", "abs", "clamp",
  "round", "floor", "ceil", "gt", "gte", "lt", "lte", "eq",
  "and", "or", "not", "if",
]);
const FORMULA_OPS = new Set(ASSET_FORMULA_OPS);

function formulaNumber(value, where) {
  if (!Number.isFinite(value)) throw new Error(`${where} resolved to a non-finite number`);
  return value;
}

/** Evaluate one declarative asset formula against a flat scope. */
export function evaluateAssetFormula(node, scope = {}, where = "formula") {
  if (node === null || typeof node === "number" || typeof node === "boolean"
      || typeof node === "string") return node;
  if (Array.isArray(node) || typeof node !== "object") {
    throw new Error(`${where} must be a literal, {ref}, or {op,args} formula`);
  }
  if (Object.hasOwn(node, "ref")) {
    if (typeof node.ref !== "string" || !Object.hasOwn(scope, node.ref)) {
      throw new Error(`${where} references unknown value "${node.ref}"`);
    }
    return scope[node.ref];
  }
  const { op, args } = node;
  if (!FORMULA_OPS.has(op) || !Array.isArray(args)) {
    throw new Error(`${where} uses an unknown asset formula operation "${op}"`);
  }
  const at = (index) => evaluateAssetFormula(args[index], scope, `${where}.${op}[${index}]`);
  const all = () => args.map((_arg, index) => at(index));
  switch (op) {
    case "if": return at(0) ? at(1) : at(2);
    case "and": return args.every((_arg, index) => Boolean(at(index)));
    case "or": return args.some((_arg, index) => Boolean(at(index)));
    case "not": return !at(0);
    case "eq": return at(0) === at(1);
    case "gt": return Number(at(0)) > Number(at(1));
    case "gte": return Number(at(0)) >= Number(at(1));
    case "lt": return Number(at(0)) < Number(at(1));
    case "lte": return Number(at(0)) <= Number(at(1));
    case "add": return formulaNumber(all().reduce((sum, value) => sum + Number(value), 0), where);
    case "sub": return formulaNumber(Number(at(0)) - Number(at(1)), where);
    case "mul": return formulaNumber(all().reduce((product, value) => product * Number(value), 1), where);
    case "div": return formulaNumber(Number(at(0)) / Number(at(1)), where);
    case "min": return formulaNumber(Math.min(...all().map(Number)), where);
    case "max": return formulaNumber(Math.max(...all().map(Number)), where);
    case "abs": return formulaNumber(Math.abs(Number(at(0))), where);
    case "clamp": return formulaNumber(Math.max(Number(at(1)), Math.min(Number(at(2)), Number(at(0)))), where);
    case "round": return formulaNumber(Math.round(Number(at(0))), where);
    case "floor": return formulaNumber(Math.floor(Number(at(0))), where);
    case "ceil": return formulaNumber(Math.ceil(Number(at(0))), where);
    default: throw new Error(`${where} uses unsupported operation "${op}"`);
  }
}

/** Resolve a named formula map, including references between authored values. */
export function resolveAssetFormulaMap(definitions = {}, source = {}) {
  const values = { ...source };
  const active = new Set();
  const resolve = (name) => {
    if (Object.hasOwn(values, name)) return values[name];
    if (!Object.hasOwn(definitions, name)) throw new Error(`unknown asset value "${name}"`);
    if (active.has(name)) throw new Error(`asset formula cycle at "${name}"`);
    active.add(name);
    const scope = new Proxy(values, {
      has: (_target, key) => Object.hasOwn(values, key) || Object.hasOwn(definitions, key),
      get: (_target, key) => (typeof key === "string" ? resolve(key) : undefined),
      getOwnPropertyDescriptor: (_target, key) => ((Object.hasOwn(values, key)
        || Object.hasOwn(definitions, key)) ? { configurable: true, enumerable: true } : undefined),
    });
    values[name] = evaluateAssetFormula(definitions[name], scope, `values.${name}`);
    active.delete(name);
    return values[name];
  };
  for (const name of Object.keys(definitions)) resolve(name);
  return values;
}

/** Pick from a palette by index, wrapping — how a striped awning alternates and
 *  how the port's four containers get four colours from one part. */
function pick(palette, i) {
  return palette[i % palette.length];
}

/** The canvas-only shapes, on top of the three path verbs both backends share.
 *  None of these can be a silhouette contour, which is exactly why the split
 *  between this file and `vehicleShapes.js` falls where it does. */
const EXTRA = {
  ellipse(g, p, X, Y, S) {
    const rot = p.rotRad !== undefined ? Number(p.rotRad) : Number(p.rot || 0) * TAU;
    g.ellipse(X(p.cx), Y(p.cy), S(p.rx), S(p.ry), rot, 0, Math.PI * 2);
  },
  disc(g, p, X, Y, S) {
    g.arc(X(p.cx), Y(p.cy), S(p.r), 0, Math.PI * 2);
  },
  // A finite arc, filled or stroked by the ordinary part rules. Angles are
  // authored in TURNS (or supplied as `startRad`/`endRad` by a state frame), so
  // a parasol, cap or gauge never has to smuggle `Math.PI` into JSON.
  arc(g, p, X, Y, S) {
    const start = p.startRad !== undefined ? Number(p.startRad) : Number(p.start || 0) * TAU;
    const end = p.endRad !== undefined ? Number(p.endRad) : Number(p.end ?? 1) * TAU;
    g.arc(X(p.cx), Y(p.cy), S(p.r), start, end, Boolean(p.ccw));
    if (p.toCenter) g.lineTo(X(p.cx), Y(p.cy));
  },
  //: A gable, a pediment, a sail. Canvas closes an unclosed path when it fills,
  //: so this is `poly` without the `closePath` — kept apart because the two
  //: produce different results when the same points are STROKED.
  fan(g, p, X, Y) {
    p.pts.forEach((pt, i) => (i ? g.lineTo(X(pt[0]), Y(pt[1])) : g.moveTo(X(pt[0]), Y(pt[1]))));
  },
  //: A REGULAR n-gon: the ALTO's octagon, and any other sign the Manual
  //: Centroamericano specifies by its number of sides. `rot` is in TURNS, not
  //: radians, so an octagon stood on a flat side is `0.0625` (half a facet)
  //: instead of an irrational literal in a JSON file. A power of two times TAU
  //: is exact, so this is the same double the hand-written `Math.PI / 8` was.
  polyN(g, p, X, Y, S) {
    const cx = X(p.cx), cy = Y(p.cy), rot = (p.rot || 0) * Math.PI * 2;
    for (let i = 0; i < p.n; i++) {
      const a = rot + (i / p.n) * Math.PI * 2;
      const rr = S(p.r);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
  },
};

const SHAPES = { ...PATHS, ...EXTRA };

// ---- THE GENERATORS ---------------------------------------------------------
//
// Three verbs that make an ALGORITHMIC drawing expressible as parts. They exist
// because the alternative did not survive contact: a tuna boil is 22 fish on a
// position hash and seven broken arcs, and writing that as data means either a
// loop-and-arithmetic language in JSON — which is a worse language than the JS
// it would replace, and the line `docs/inventory.md` §12 draws — or a verb the
// ENGINE implements and the catalog invokes. The feria settled this argument
// years earlier with `bulbs` and `spokes`; these are the general form.
//
// Two rules they all obey:
//
//   * **TURNS, NEVER RADIANS.** A power-of-two turn times TAU is exact in binary
//     floating point, so a catalog holds no irrational literal — the same rule
//     `polyN`'s `rot` and every motion verb follow.
//   * **THE HASH IS THE ONE `flora.js` USES** (`hash01` from gfx). That is what
//     makes a fish stay in the same place frame after frame; a `Math.random()`
//     here would make the shoal boil and, worse, make every art sheet
//     un-diffable.
//
// `seed` shifts the whole pattern, so two schools drawn from one record are not
// the same school.
/** Place a deterministic scatter without deciding what each copy paints.
 *
 * The ordinary form is the ellipse the catalogs already use. `layout:"box"`
 * is the garden form: independent x/y hashes inside a rectangle, optionally
 * pushed out of a centre clearance and dropped if that push leaves the lot.
 * `fit` derives its count from a declared length and pitch — the same contract
 * as the `fit` shape, applied to a placement generator instead of a row.
 */
export function scatterPlacements(p, frame, draw) {
  const { X = (v) => v, Y = (v) => v, vars = {} } = frame;
  const value = (v) => (typeof v === "string" && v.startsWith("$") ? (vars[v.slice(1)] ?? 0) : v);
  const xSize = (v) => Math.abs(X(value(v)) - X(0));
  const ySize = (v) => Math.abs(Y(value(v)) - Y(0));
  let n = Number(value(p.n)) | 0;
  if (p.fit) {
    const length = Math.abs(Number(value(p.fit.length))) || 0;
    const pitch = Math.abs(Number(value(p.fit.pitch))) || 1;
    const raw = p.fit.mode === "floor" ? Math.floor(length / pitch) : Math.round(length / pitch);
    n = Math.max(p.fit.min ?? 1, Math.min(p.fit.max ?? Infinity, raw));
  }
  const seed = Number(value(p.seed)) || 0;
  const rx = xSize(p.rx ?? p.r ?? 0), ry = ySize(p.ry ?? p.r ?? 0);
  for (let i = 0; i < n; i++) {
    if (p.layout === "box") {
      const seedX = Number(value(p.seedX)) || 0, seedY = Number(value(p.seedY)) || 0;
      const h1 = hash01(i * (p.xStep ?? 12.9898) + seedX);
      const h2 = hash01(i * (p.yStep ?? 78.233) + seedY);
      // The garden historically multiplied full extent and inset in this
      // order. Keep it: re-associating the equivalent expression moves two
      // antialiased pixels by one channel level on the golden sheet.
      let dx = p.width === undefined
        ? (h1 - 0.5) * rx * 2
        : (h1 - 0.5) * xSize(p.width) * (p.xMul ?? 1);
      let dy = p.height === undefined
        ? (h2 - 0.5) * ry * 2
        : (h2 - 0.5) * ySize(p.height) * (p.yMul ?? 1);
      const clear = Number(value(p.clear)) || 0;
      if (clear) {
        const d = Math.hypot(dx, dy) || 1;
        if (d < clear) { dx = dx / d * clear; dy = dy / d * clear; }
        if ((p.boundX !== undefined && Math.abs(dx) > xSize(p.boundX)) ||
            (p.boundY !== undefined && Math.abs(dy) > ySize(p.boundY))) continue;
      }
      const scaleSeed = Number(value(p.scaleSeed)) || 0;
      draw(i, {
        dx, dy, rot: p.rotate ? h1 * TAU : 0,
        scale: (p.scaleMin ?? 1) + hash01(i * (p.scaleStep ?? 5.17) + scaleSeed) * (p.scaleRange ?? 0),
      });
      continue;
    }
    const h1 = hash01(i * 12.9898 + seed), h2 = hash01(i * 78.233 + seed);
    const a = h1 * TAU;
    // sqrt keeps the scatter EVEN over the area; without it everything piles
    // into the middle, which reads as a clump rather than a shoal.
    const rr = Math.sqrt(h2);
    draw(i, {
      dx: Math.cos(a) * rx * rr,
      dy: Math.sin(a) * ry * rr,
      rot: p.rotate ? h1 * TAU : 0,
      scale: p.scaleVar ? 1 - p.scaleVar + hash01(i * 5.17 + seed) * p.scaleVar * 2 : 1,
    });
  }
}

const GENERATORS = {
  /** n copies on a position hash inside an ellipse — a shoal, a wood, a patio. */
  scatter(g, p, X, Y, draw) {
    scatterPlacements(p, { X, Y }, draw);
  },

  /** n copies around a circle, optionally turning with the clock. */
  orbit(g, p, X, Y, draw, t) {
    const n = p.n | 0, seed = p.seed || 0;
    const spin = (p.spin || 0) * (t || 0) * TAU;
    for (let i = 0; i < n; i++) {
      const h = hash01(i * 7.13 + seed);
      const a = (i / n) * TAU + spin + (p.jitter ? (h - 0.5) * p.jitter * TAU : 0);
      const rr = (p.r || 0) * (p.rVar ? 1 - p.rVar + h * p.rVar * 2 : 1);
      draw(i, {
        dx: Math.cos(a) * rr, dy: Math.sin(a) * rr,
        // `face` turns each copy to follow the circle — a fish swims along it,
        // a gondola does not.
        rot: p.face ? a + TAU / 4 : 0,
        scale: 1,
      });
    }
  },
};

/** n arc segments on a hash around a centre — a broken, breathing rim. */
function drawArcs(g, p, X, Y, t) {
  const n = p.n | 0, seed = p.seed || 0;
  g.lineWidth = p.width ?? 2;
  for (let i = 0; i < n; i++) {
    const h = hash01(i * 7.13 + seed);
    const a0 = (p.spin || 0) * (t || 0) * TAU + i * (p.step ?? 0.9)
      + (p.breathe ? Math.sin((t || 0) * p.breathe * TAU + i) * (p.breatheAmp ?? 0.2) : 0);
    const span = ((p.span ?? 0.08) + h * (p.spanVar ?? 0.06)) * TAU;
    const rr = (p.r || 0) * (1 - (p.rVar ?? 0) + h * (p.rVar ?? 0) * 2);
    g.beginPath();
    g.arc(X(p.cx ?? 0), Y(p.cy ?? 0), rr, a0, a0 + span);
    g.stroke();
  }
}

/** Every shape name the interpreter implements — the list the catalogs are
 *  checked against, so a part naming anything else fails a test instead of
 *  silently drawing nothing. */
export const SHAPE_NAMES = Object.freeze([
  ...Object.keys(SHAPES), ...Object.keys(GENERATORS), "arcs",
  "stripes", "stroke", "strokeRect",
  "text", "label", "areaLabel", "repeat", "fit", "grid", "ring", "prop",
  "sprite", "group", "family",
]);

/**
 * Draw `parts` in the frame the caller describes.
 *
 * @param {object} g       the 2D context
 * @param {Array}  parts   the catalog's part list
 * @param {object} frame
 *   @param {function} frame.X      evaluate a part's x value
 *   @param {function} frame.Y      evaluate a part's y value
 *   @param {function} [frame.S]    evaluate a SIZE — a radius, a stroke width, a
 *                                  step. Defaults to identity, which is exactly
 *                                  what every catalog did before it existed.
 *   @param {function} [frame.color] resolve a colour spec (placeholders)
 *   @param {function} [frame.skip]  drop a part before it is drawn
 *   @param {object}   [frame.vars]  `$name` substitutions for text
 *   @param {function} [frame.sprite] resolve `{record,image}` for unsaved rows
 */
/**
 * WHICH PARTS CAST, AND AT WHAT HEIGHT — one pass over the tree, grouped.
 *
 * `heightM` and `castsShadow` are INHERITED downward, so a scene states its
 * height once and a part only says what differs. A part that casts is taken
 * WHOLE, subtree and all: that is what makes a group throw ONE silhouette
 * instead of one per child, which is the difference between a cathedral with a
 * shadow and a cathedral with a pile of shadows.
 *
 * Returns `[heightM, allow]` pairs. `allow` holds the casting parts AND their
 * ancestors, because the traversal has to reach a nested part through the
 * groups that establish its frame.
 */
function shadowPasses(parts, baseH, baseCast) {
  const out = new Map();
  const walk = (list, inhH, inhCast, ancestors) => {
    for (const part of list) {
      if (!part || typeof part !== "object") continue;
      const h = part.heightM ?? inhH;
      const casts = part.castsShadow ?? inhCast;
      if (casts && h > 0) {
        if (!out.has(h)) out.set(h, new Set());
        const allow = out.get(h);
        allow.add(part);
        for (const a of ancestors) allow.add(a);
      } else if (Array.isArray(part.parts)) {
        walk(part.parts, h, casts, [...ancestors, part]);
      }
    }
  };
  walk(parts, baseH, baseCast, []);
  return out;
}

export function paintParts(g, parts, frame) {
  const {
    X: rawX, Y: rawY, S: rawS, color = (c) => c, skip = () => false, vars = {}, prop,
    family, sprite,
  } = frame;
  // LA SOMBRA ES UNA PRIMERA PASADA SOBRE LAS MISMAS PARTES, no una silueta
  // duplicada en el JSON. El sol entra POR EL FRAME —como ya entran `X`, `Y`,
  // `color` y `skip`— porque este archivo no puede importar `shadows.js`:
  // arrastraría `daynight.js` y con él el juego entero, y
  // `tests/test_shape_interpreter.py` fija esa lista. El juego pasa el sol de
  // verdad; el editor, uno fijo de mediodía. Sin `frame.shadow` no hay pasada y
  // el cuadro sale idéntico al de antes, que es lo que hace la migración
  // demostrable pixel a pixel.
  //
  // Y EL DESPLAZAMIENTO VA EN LOS EVALUADORES, NO EN UN `translate`, por la
  // misma razón medida que documenta el verbo `group`: Canvas no rasteriza
  // igual un camino absoluto y el mismo camino bajo un `translate` fraccionario.
  // Sumarlo en `X`/`Y` deja las coordenadas absolutas — y como todo ancho se
  // calcula `X(w) - X(0)`, un offset constante se cancela y no deforma nada.
  // LA TINTA LA TRAE EL LLAMADOR, SIEMPRE. Un valor por defecto aquí sería un
  // color autorado dentro del intérprete, que es justo lo que
  // `test_world_props.test_interpreters_do_not_own_asset_colours` prohíbe — y
  // con razón: la sombra del mundo vive en `effects.json -> sunShadow.color`,
  // y una segunda copia aquí se despegaría de ella sin que nadie lo notara.
  // Sin las DOS cosas no hay pasada.
  if (frame.shadow && frame.shadowInk && !frame._shadowPass) {
    const passes = shadowPasses(parts, frame.heightM, frame.castsShadow);
    for (const [h, allow] of passes) {
      const sh = frame.shadow(h);
      if (!sh) continue;
      const prevAlpha = g.globalAlpha;
      g.globalAlpha = prevAlpha * (sh.alpha ?? 1);
      paintParts(g, parts, {
        ...frame,
        _shadowPass: true,
        X: (v) => rawX(v) + sh.dx,
        Y: (v) => rawY(v) + sh.dy,
        color: () => frame.shadowInk,
        skip: (part) => !allow.has(part) || skip(part),
      });
      g.globalAlpha = prevAlpha;
    }
  }
  const resolveSprite = sprite || ((id) => ({
    record: spriteRecord(id), image: spriteImage(id),
  }));
  const paint = (spec) => color(spec);
  const str = (v) => {
    if (typeof v === "string" && v.startsWith("$")) return vars[v.slice(1)] ?? "";
    // Formula trees are the only object values evaluated here. Coordinate
    // records (`{k,px,min,max}`) remain intact for `evalOn`.
    if (v && typeof v === "object" && !Array.isArray(v)
        && (Object.hasOwn(v, "ref") || Object.hasOwn(v, "op"))) {
      return evaluateAssetFormula(v, vars, "part formula");
    }
    return v;
  };
  // A `$name` may stand in a NUMERIC slot too, not just in text — the balneario's
  // area label is `w: "$w"`, sized from the landmark's own extent. Resolving it
  // only for text is how that label came out at NaN and drew nothing: no error,
  // no warning, just a missing pill on the one landmark whose art IS the pill.
  const X = (v) => rawX(str(v));
  const Y = (v) => rawY(str(v));
  // UN TAMAÑO NO ES UNA POSICIÓN, y por eso necesita su propio evaluador.
  //
  // `X`/`Y` son AFINES: los anchos se calculan como diferencias (`X(w) - X(0)`),
  // así que el desplazamiento del marco se cancela. Un radio no tiene de dónde
  // restar — pasarlo por `X` le sumaría el origen del marco y pondría el círculo
  // en otro lado, con otro tamaño. De ahí `S`.
  //
  // **El defecto es la identidad, y eso no es pereza: es la garantía.** Todo
  // catálogo de hoy dibuja `part.r` tal cual, así que con `S` identidad sale
  // píxel por píxel lo mismo — y las diez hojas de arte lo comprueban. Un marco
  // que QUIERE radios proporcionales pasa el suyo, y ahí sí cambia, a propósito.
  const S = rawS ? (v) => rawS(str(v)) : (v) => str(v) || 0;
  // PÍXELES POR METRO, del LLAMADOR. Un sprite se mide en metros —como todo largo
  // que dos runtimes comparten— y la escala de este build vive en el manifest del
  // mundo. Traerla acá con un `import` rompería lo único que hace este archivo
  // cargable solo, que es no saber nada del mundo: `domain/units.js` la saca del
  // accesor. Así que la trae el marco, igual que `X`, `Y` y `S`.
  //
  // El defecto es 1, y es a propósito que sea ABSURDO: un sprite dibujado a un
  // píxel por metro sale del tamaño de una uña, o sea SE VE que el llamador se
  // olvidó. Un defecto plausible lo dejaría del tamaño equivocado en silencio.
  const pxPerM = frame.pxPerM ?? 1;

  for (const part of parts) {
    if (skip(part)) continue;
    if (part.when !== undefined && !str(part.when)) continue;
    if (part.unless !== undefined && str(part.unless)) continue;

    // MOTION IS PART OF THE PART. The verbs are the feria's, verbatim —
    // `attractions.js` has animated its rides from data since the campo ferial
    // shipped, which meant the carrusel was more editable than the player's own
    // car. `src/assets/effects.json` -> `partMotion` documents them; the units
    // are TURNS per second, never radians, so a catalog holds no irrational
    // literal (a power-of-two turn times TAU is exact in binary floating point).
    //
    // A part with no motion pays ONE property lookup and takes no save/restore,
    // which is why every existing catalog draws pixel for pixel as before.
    const moved = part.spin || part.bob || part.swing || part.pump
      || part.alpha !== undefined;
    if (moved) {
      g.save();
      const t = (frame.t ?? 0), ph = (part.phase || 0) * TAU;
      if (part.alpha !== undefined) g.globalAlpha *= Number(str(part.alpha));
      if (part.spin) g.rotate(t * Number(str(part.spin)) * TAU + ph);
      if (part.swing) g.rotate(Math.sin(t * Number(str(part.swing.speed)) * TAU + ph)
        * Number(str(part.swing.amp)));
      if (part.bob) g.translate(0, Math.sin(t * Number(str(part.bob.speed)) * TAU + ph)
        * Number(str(part.bob.amp)));
      if (part.pump) {
        const k = 1 + Math.sin(t * Number(str(part.pump.speed)) * TAU + ph)
          * Number(str(part.pump.amp));
        g.scale(k, k);
      }
    }

    switch (part.shape) {
      // `fillRect`, NOT beginPath+rect+fill. They are not the same rasteriser
      // on fractional coordinates — see the note in c2d/entities.js, where
      // getting this wrong moved 562 pixels by one channel level.
      case "rect":
        g.fillStyle = paint(part.fill);
        g.fillRect(X(part.x), Y(part.y), X(part.w) - X(0), Y(part.h) - Y(0));
        break;

      case "strokeRect":
        g.strokeStyle = paint(part.stroke);
        g.lineWidth = S(part.width);
        g.strokeRect(X(part.x), Y(part.y), X(part.w) - X(0), Y(part.h) - Y(0));
        break;

      // A run of n bands across one rect, alternating a palette: the heladero's
      // awning, a kiosk's, a market's. Its own shape because the alternation is
      // the idea rather than a repetition of rectangles.
      case "stripes": {
        const x0 = X(part.x), band = (X(part.w) - X(0)) / part.n;
        for (let i = 0; i < part.n; i++) {
          g.fillStyle = paint(pick(part.palette, i));
          g.fillRect(x0 + i * band, Y(part.y), band, Y(part.h) - Y(0));
        }
        break;
      }

      // A stroked circle — an anchor's ring, a rim. Not `disc`, which fills.
      case "ring":
        g.strokeStyle = paint(part.stroke);
        g.lineWidth = S(part.width);
        if (part.cap) g.lineCap = part.cap;
        g.beginPath();
        g.arc(X(part.cx), Y(part.cy), S(part.r), 0, Math.PI * 2);
        g.stroke();
        if (part.cap) g.lineCap = "butt";
        break;

      case "stroke":
        g.strokeStyle = paint(part.stroke);
        g.lineWidth = S(part.width);
        if (part.cap) g.lineCap = part.cap;
        if (part.join) g.lineJoin = part.join;
        if (part.dash) g.setLineDash(part.dash.map((v) => S(v)));
        g.beginPath();
        for (const run of (part.runs || [part.pts])) {
          run.forEach((pt, i) => {
            if (pt.c) g.bezierCurveTo(X(pt.c[0][0]), Y(pt.c[0][1]),
                                      X(pt.c[1][0]), Y(pt.c[1][1]),
                                      X(pt.to[0]), Y(pt.to[1]));
            else if (pt.q) g.quadraticCurveTo(X(pt.q[0]), Y(pt.q[1]), X(pt.to[0]), Y(pt.to[1]));
            else if (i) g.lineTo(X(pt[0]), Y(pt[1]));
            else g.moveTo(X(pt[0]), Y(pt[1]));
          });
        }
        g.stroke();
        if (part.dash) g.setLineDash([]);
        if (part.cap) g.lineCap = "butt";
        if (part.join) g.lineJoin = "miter";
        break;

      // The name pill every landmark wears, and the one that spans an area.
      // BOTH GO TO `g`, the surface this call was handed. They used to go to
      // `gfx`'s shared `ctx` regardless, so a caller drawing onto its own canvas
      // got the parts on one surface and the pill on another.
      case "label":
        label(g, X(part.x), Y(part.y), str(part.text), paint(part.fg), paint(part.bg));
        break;
      case "areaLabel": {
        const hw = (X(part.w) - X(0)) / 2, hh = (Y(part.h) - Y(0)) / 2;
        areaLabel(g, X(0) - hw, Y(0) - hh, X(0) + hw, Y(0) + hh,
          str(part.text), paint(part.fg), paint(part.bg));
        break;
      }

      // Free text INSIDE the art — a route shield's number, a bulevar sign's
      // word. Not a label: no pill, and the font is the part's own.
      case "text":
        g.fillStyle = paint(part.fill);
        if (part.font && typeof part.font === "object") {
          g.font = `${part.font.weight || "normal"} ${Number(str(part.font.size))}px `
            + `${part.font.family || "sans-serif"}`;
        } else g.font = str(part.font);
        g.textAlign = part.align || "center";
        // A pavement marking is centred on its own ring, so it asks for
        // `middle`. Canvas keeps the baseline until somebody changes it, so put
        // it back — the speed-limit numeral used to do exactly this by hand, and
        // leaving it set would have moved every label drawn after it.
        if (part.baseline) g.textBaseline = part.baseline;
        g.fillText(str(part.text), X(part.x), Y(part.y));
        if (part.baseline) g.textBaseline = "alphabetic";
        break;

      // ANOTHER RECORD'S PARTS, INLINED HERE. The same church is the `church`
      // landmark's art AND the building a `church` parcel draws on its lot; the
      // same caseta is the `bus` sign AND the paradita the civic block puts on
      // the Parque de la Virgen. Written twice they would drift, which is the
      // whole reason this file exists. Inlining draws them in the caller's own
      // order and frame, so it is not a second drawing of anything.
      case "prop": {
        const sub = prop && prop(part.ref);
        if (sub) paintParts(g, sub, frame);
        break;
      }

      // A FAMILY-SPECIFIC FINITE VERB. Actors need a deterministic school of
      // flashes; water needs a crest field. Those algorithms belong in their
      // family interpreter, while z-order and every authored knob stay in this
      // parts list. `verb` is validated by that family and an absent handler is
      // deliberately a no-op, just like an unmounted provider.
      case "family":
        family?.(g, part, { X, Y, S, color: paint, vars, t: frame.t ?? 0 });
        break;

      // THE GENERATORS: n copies of a sub-list, placed by a rule the engine
      // owns. `repeat` steps them on a line; these two place them on a hash and
      // on a circle. A copy may be turned and scaled, so the sub-list is
      // written ONCE in its own frame and the verb puts it where it goes.
      case "scatter":
      case "orbit": {
        const place = GENERATORS[part.shape];
        const placeCopy = (i, at) => {
          g.save();
          g.translate(X(part.cx ?? 0) + at.dx, Y(part.cy ?? 0) + at.dy);
          if (at.rot) g.rotate(at.rot);
          if (at.scale !== 1) g.scale(at.scale, at.scale);
          paintParts(g, part.parts, {
            X: (v) => rawX(str(v)) - rawX(0),   // the copy draws about its own
            Y: (v) => rawY(str(v)) - rawY(0),   // origin, not the parent anchor
            color: (spec) => (Array.isArray(spec) ? paint(pick(spec, i)) : paint(spec)),
            S: rawS, skip, vars: { ...vars, i }, prop, family, sprite,
            t: frame.t, pxPerM,
          });
          g.restore();
        };
        if (part.shape === "scatter") scatterPlacements(part, { X, Y, S, vars }, placeCopy);
        else place(g, part, X, Y, placeCopy, frame.t);
        break;
      }

      // n arc segments on a hash — a rim that is broken and breathing rather
      // than a circle, which is the whole difference between a shoal working
      // the surface and a painted disc.
      case "arcs":
        g.strokeStyle = paint(part.stroke);
        drawArcs(g, part, X, Y, frame.t);
        break;

      // n copies of a sub-list, stepped by (dx, dy). `$i` in a palette index
      // picks per copy, which is how the village gets three coloured houses and
      // the muelle four coloured containers from one part.
      case "repeat":
        for (let i = 0; i < Number(str(part.n)); i++) {
          const dx = S(part.dx || 0) * i, dy = S(part.dy || 0) * i;
          paintParts(g, part.parts, {
            X: (v) => X(v) + dx,
            Y: (v) => Y(v) + dy,
            // `S` y `t` SE PASAN. Sin ellos una parte anidada perdía el marco de
            // tamaños y, peor, el reloj: un `spin` dentro de un `repeat`
            // simplemente no se movía. Hoy ningún catálogo lo hace —se midió— así
            // que cerrarlo no cambia un píxel; el día que alguien lo escriba,
            // funciona en vez de fallar en silencio.
            S: rawS, color: (spec) => (Array.isArray(spec) ? paint(pick(spec, i)) : paint(spec)),
            skip, vars: { ...vars, i }, prop, family, sprite,
            t: frame.t, pxPerM,
          });
        }
        break;

      // EL VERBO QUE FALTABA: LA CUENTA SALE DEL TAMAÑO.
      //
      // `repeat` toma una cuenta autorada; `stripes` toma una cuenta autorada y
      // divide un ancho entre ella. NINGUNO de los dos hace lo que el arte de
      // este juego pide todo el tiempo, que es lo INVERSO: dado un largo y un
      // PASO, cuántos caben.
      //
      // Es la forma de doce de los dieciocho pintores que todavía están en
      // código — las ventanas de un edificio (`Math.max(1, Math.floor(bw / 16))`),
      // las columnas de la Casa de la Cultura (`Math.max(3, Math.round(h / 12))`),
      // los pabellones de una escuela (`Math.round(L / 46)`), los tensores del
      // puente, las juntas de un muelle, las bandas de una valla.
      //
      // **El JSON da el PASO y el motor cuenta**, que es de qué lado de la línea
      // de `docs/inventory.md` §12 cae esto: el catálogo no hace la división, la
      // invoca. Un `n` calculado en JSON sería una expresión, o sea un lenguaje
      // de programación peor escondido en un registro.
      //
      // `pitch` es un TAMAÑO, así que pasa por `S`: en un marco proporcional el
      // paso se estira con el resto y la cuenta se mantiene, que es lo que uno
      // quiere de una fila de ventanas al doble de tamaño.
      case "fit": {
        const along = part.along === "y" ? Y : X;
        const span = Math.abs(along(part.length) - along(0));
        const pitch = Math.abs(S(part.pitch)) || 1;
        // `round` por omisión, y se puede pedir `floor`: una fila de ventanas
        // prefiere no desbordar su pared, un tramo de juntas prefiere repartir.
        const raw = part.mode === "floor" ? Math.floor(span / pitch) : Math.round(span / pitch);
        const min = part.min === undefined ? 1 : Number(str(part.min));
        const max = part.max === undefined ? Infinity : Number(str(part.max));
        const n = Math.max(min, Math.min(max, raw));
        // El paso REAL reparte el largo entre los que cupieron, para que la fila
        // quede centrada en su hueco en vez de sobrar por la derecha.
        // Una escuela cuenta pabellones sobre L pero reparte sus vanos sobre
        // L+gap; `spreadLength` declara ese segundo largo sin convertir el JSON
        // en una expresión. `gap` deja el ancho útil de cada vano disponible a
        // las partes anidadas como `$fitWidth`.
        const spreadSpan = part.spreadLength === undefined
          ? span : Math.abs(along(part.spreadLength) - along(0));
        const step = part.spread === false ? pitch : spreadSpan / n;
        const fitWidth = step - (part.gap || 0);
        for (let i = 0; i < n; i++) {
          const d = (i + (part.spread === false || part.anchor === "start" ? 0 : 0.5)) * step;
          const dx = part.along === "y" ? 0 : d, dy = part.along === "y" ? d : 0;
          paintParts(g, part.parts, {
            X: (v) => X(v) + dx,
            Y: (v) => Y(v) + dy,
            S: rawS,
            color: (spec) => (Array.isArray(spec) ? paint(pick(spec, i)) : paint(spec)),
            skip, vars: { ...vars, fitWidth }, prop, family, sprite,
            t: frame.t, pxPerM,
          });
        }
        break;
      }

      // UN GRUPO CON SU PROPIO MARCO — un sistema de coordenadas anidado.
      //
      // Es el verbo que le faltaba al intérprete para que una escena compuesta
      // fuera data, y el caso que lo pidió es la catedral: su crucero se mide en
      // `tw`/`th` (dos escalares DERIVADOS, cada uno un `min`/`max` entre ejes) y
      // dentro de él todo es una fracción de ésos — `tw * 0.34`, `th * 2 - 4`. Con
      // un solo evaluador de tamaños por escena eso no se puede escribir, y
      // meterlo en el JSON como `0.26 * hw` sería aritmética en el registro.
      //
      // Con un grupo se escribe como lo que es: «acá adentro, el ancho es `tw`»,
      // y las partes hijas vuelven a hablar en `[k, px]` sobre eso. Es lo que hace
      // cualquier formato vectorial de verdad con un transform anidado, y es
      // exactamente la misma idea que `scatter`/`orbit` ya usaban para re-derivar
      // el marco de sus copias.
      //
      // `hw`/`hh` se resuelven en los ejes del PADRE; `hwS`/`hhS` permiten que
      // ambos salgan de su dimensión CARACTERÍSTICA. Así un kiosco declara una
      // sola `r` acotada para x/y/S y el caller conserva únicamente el
      // `min(hw,hh)` entre ejes que el evaluador no puede ver.
      case "group": {
        const gx = X(part.x ?? 0), gy = Y(part.y ?? 0);
        const ghw = part.hwS !== undefined
          ? Math.abs(S(part.hwS)) * (part.hwScale ?? 1)
          : part.hw !== undefined ? Math.abs(X(part.hw) - X(0)) : null;
        const ghh = part.hhS !== undefined
          ? Math.abs(S(part.hhS)) * (part.hhScale ?? 1)
          : part.hh !== undefined ? Math.abs(Y(part.hh) - Y(0)) : null;
        const gs = part.s !== undefined ? Math.abs(S(part.s)) : null;
        // EL DESPLAZAMIENTO VA EN LOS EVALUADORES, NO EN UN `translate`, y esto
        // costó 207 píxeles medirlo. Canvas no rasteriza igual un camino en
        // coordenadas absolutas y el mismo camino relativo bajo un `translate`
        // fraccionario: el crucero de la catedral se traslada 3,4 px y las
        // esquinas redondeadas caían un nivel de canal distinto. Es la misma clase
        // de diferencia que `fillRect` contra `beginPath`+`rect`+`fill`.
        //
        // Un marco anidado sólo NECESITA una transformación para ROTAR. Sin
        // rotación, sumar el offset en `X`/`Y` deja las coordenadas absolutas y el
        // resultado es idéntico al del código que reemplaza.
        const turn = part.rotateRad !== undefined
          ? Number(str(part.rotateRad)) : Number(str(part.rotate || 0)) * TAU;
        const scaleX = Number(str(part.scaleX ?? part.scale ?? 1));
        const scaleY = Number(str(part.scaleY ?? part.scale ?? 1));
        const transformed = Boolean(turn) || scaleX !== 1 || scaleY !== 1;
        const ox = transformed ? 0 : gx, oy = transformed ? 0 : gy;
        const child = {
          X: ghw === null ? (v) => X(v) - X(0) + ox : (v) => evalScalar(str(v), ghw) + ox,
          Y: ghh === null ? (v) => Y(v) - Y(0) + oy : (v) => evalScalar(str(v), ghh) + oy,
          S: gs === null ? rawS : (v) => evalScalar(str(v), gs),
          color, skip, vars, prop, family, sprite, t: frame.t, pxPerM,
        };
        if (!transformed) { paintParts(g, part.parts, child); break; }
        g.save();
        g.translate(gx, gy);
        g.rotate(turn);
        g.scale(scaleX, scaleY);
        paintParts(g, part.parts, child);
        g.restore();
        break;
      }

      // UN LUGAR PUEDE USAR UNA IMAGEN EN VEZ DE DIBUJARSE.
      //
      // El único verbo que no compone las primitivas del motor, y está bien que
      // exista: hay un caso que el vector no cubre, y es un lugar CONCRETO que uno
      // quiere que se vea como es. La Catedral de Puntarenas no es «una catedral
      // del tamaño de su lote», es ese edificio.
      //
      // **El tamaño sale del REGISTRO, en metros, no de la parte.** Así una misma
      // imagen mide lo mismo en todo el mundo y sobrevive un reescalado — y así el
      // catálogo no puede estirar un edificio para que quepa, que es cómo se ve
      // mal una imagen. La parte dice DÓNDE y, si quiere, con qué escala relativa.
      //
      // **Y si la imagen no está, se pinta su `placeholder`.** Un sprite que nunca
      // carga tiene que VERSE —un bloque liso donde debería estar el edificio— en
      // vez de dejar un hueco que parece que ahí no había nada.
      case "sprite": {
        const id = str(part.src);
        const resolved = resolveSprite(id) || {};
        const rec = resolved.record || null;
        if (!rec) break;                       // un id que el registro no tiene
        const k = part.scale ?? 1;
        const w = rec.wM * pxPerM * k, h = rec.hM * pxPerM * k;
        const ax = (rec.anchor?.[0] ?? 0.5) * w, ay = (rec.anchor?.[1] ?? 0.5) * h;
        const x = X(part.x) - ax, y = Y(part.y) - ay;
        const img = resolved.image || null;
        if (img) g.drawImage(img, x, y, w, h);
        else { g.fillStyle = paint(part.fill ?? rec.placeholder); g.fillRect(x, y, w, h); }
        break;
      }

      // A block of small rects — a hotel's lit windows. Rows and columns rather
      // than a nested `repeat`, because that is what it is.
      case "grid":
        g.fillStyle = paint(part.fill);
        for (let r = 0; r < part.rows; r++) {
          for (let c = 0; c < part.cols; c++) {
            g.fillRect(X(part.x) + c * S(part.dx), Y(part.y) + r * S(part.dy),
                       X(part.w) - X(0), Y(part.h) - Y(0));
          }
        }
        break;

      // ONE PATH MAY BE FILLED, STROKED, OR BOTH — and both is not the same as
      // two parts. A CEDA EL PASO is a white triangle with a red border built
      // from a single `closePath`; splitting it in two would stroke a SECOND
      // path over the first and composite the antialiased border twice, which is
      // the anchor's lesson (see world-props.json's `strokeNote`) from the other
      // side. Fill stays unconditional when there is no stroke, so nothing in
      // the catalogs that predates this changes.
      default: {
        const build = SHAPES[part.shape];
        if (!build) break;
        const stroked = part.stroke !== undefined;
        g.beginPath();
        build(g, part, X, Y, S);
        if (!stroked || part.fill !== undefined) { g.fillStyle = paint(part.fill); g.fill(); }
        if (stroked) {
          g.strokeStyle = paint(part.stroke);
          g.lineWidth = S(part.width);
          g.stroke();
        }
      }
    }

    if (moved) g.restore();
  }
}

/** Paint a prop anchored at world (x, y), in plain pixel offsets.
 *
 *  `opts.g` IS REQUIRED. It used to fall back to `gfx`'s shared `ctx`, which was
 *  the last thread tying this file to the running renderer — and a silent one:
 *  a caller that forgot `g` drew on the game's canvas instead of its own, which
 *  is a bug that looks like nothing happened. The three callers are all inside
 *  the renderer and all already hold `ctx`, so saying so costs a word each. */
export function paintAt(parts, x, y, opts = {}) {
  paintParts(opts.g, parts, {
    X: (v) => x + (v || 0),
    Y: (v) => y + (v || 0),
    ...opts,
  });
}
