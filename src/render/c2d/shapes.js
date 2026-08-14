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
import { PATHS } from "../vehicleShapes.js";
import { areaLabel, ctx as sharedCtx, label } from "./gfx.js";

const TAU = Math.PI * 2;

/** Pick from a palette by index, wrapping — how a striped awning alternates and
 *  how the port's four containers get four colours from one part. */
function pick(palette, i) {
  return palette[i % palette.length];
}

/** The canvas-only shapes, on top of the three path verbs both backends share.
 *  None of these can be a silhouette contour, which is exactly why the split
 *  between this file and `vehicleShapes.js` falls where it does. */
const EXTRA = {
  ellipse(g, p, X, Y) {
    g.ellipse(X(p.cx), Y(p.cy), p.rx, p.ry, 0, 0, Math.PI * 2);
  },
  disc(g, p, X, Y) {
    g.arc(X(p.cx), Y(p.cy), p.r, 0, Math.PI * 2);
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
  polyN(g, p, X, Y) {
    const cx = X(p.cx), cy = Y(p.cy), rot = (p.rot || 0) * Math.PI * 2;
    for (let i = 0; i < p.n; i++) {
      const a = rot + (i / p.n) * Math.PI * 2;
      const px = cx + Math.cos(a) * p.r, py = cy + Math.sin(a) * p.r;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
  },
};

const SHAPES = { ...PATHS, ...EXTRA };

/** Every shape name the interpreter implements — the list the catalogs are
 *  checked against, so a part naming anything else fails a test instead of
 *  silently drawing nothing. */
export const SHAPE_NAMES = Object.freeze([
  ...Object.keys(SHAPES), "rect", "stripes", "stroke", "strokeRect",
  "text", "label", "areaLabel", "repeat", "grid", "ring", "prop",
]);

/**
 * Draw `parts` in the frame the caller describes.
 *
 * @param {object} g       the 2D context
 * @param {Array}  parts   the catalog's part list
 * @param {object} frame
 *   @param {function} frame.X      evaluate a part's x value
 *   @param {function} frame.Y      evaluate a part's y value
 *   @param {function} [frame.color] resolve a colour spec (placeholders)
 *   @param {function} [frame.skip]  drop a part before it is drawn
 *   @param {object}   [frame.vars]  `$name` substitutions for text
 */
export function paintParts(g, parts, frame) {
  const { X: rawX, Y: rawY, color = (c) => c, skip = () => false, vars = {}, prop } = frame;
  const paint = (spec) => color(spec);
  const str = (v) => (typeof v === "string" && v.startsWith("$") ? (vars[v.slice(1)] ?? "") : v);
  // A `$name` may stand in a NUMERIC slot too, not just in text — the balneario's
  // area label is `w: "$w"`, sized from the landmark's own extent. Resolving it
  // only for text is how that label came out at NaN and drew nothing: no error,
  // no warning, just a missing pill on the one landmark whose art IS the pill.
  const X = (v) => rawX(str(v));
  const Y = (v) => rawY(str(v));

  for (const part of parts) {
    if (skip(part)) continue;

    // MOTION IS PART OF THE PART. The verbs are the feria's, verbatim —
    // `attractions.js` has animated its rides from data since the campo ferial
    // shipped, which meant the carrusel was more editable than the player's own
    // car. `src/assets/effects.json` -> `partMotion` documents them; the units
    // are TURNS per second, never radians, so a catalog holds no irrational
    // literal (a power-of-two turn times TAU is exact in binary floating point).
    //
    // A part with no motion pays ONE property lookup and takes no save/restore,
    // which is why every existing catalog draws pixel for pixel as before.
    const moved = part.spin || part.bob || part.swing || part.pump;
    if (moved) {
      g.save();
      const t = (frame.t ?? 0), ph = (part.phase || 0) * TAU;
      if (part.spin) g.rotate(t * part.spin * TAU + ph);
      if (part.swing) g.rotate(Math.sin(t * part.swing.speed * TAU + ph) * part.swing.amp);
      if (part.bob) g.translate(0, Math.sin(t * part.bob.speed * TAU + ph) * part.bob.amp);
      if (part.pump) {
        const k = 1 + Math.sin(t * part.pump.speed * TAU + ph) * part.pump.amp;
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
        g.lineWidth = part.width;
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
        g.lineWidth = part.width;
        if (part.cap) g.lineCap = part.cap;
        g.beginPath();
        g.arc(X(part.cx), Y(part.cy), part.r, 0, Math.PI * 2);
        g.stroke();
        if (part.cap) g.lineCap = "butt";
        break;

      case "stroke":
        g.strokeStyle = paint(part.stroke);
        g.lineWidth = part.width;
        if (part.cap) g.lineCap = part.cap;
        if (part.join) g.lineJoin = part.join;
        g.beginPath();
        for (const run of (part.runs || [part.pts])) {
          run.forEach((pt, i) => {
            if (pt.q) g.quadraticCurveTo(X(pt.q[0]), Y(pt.q[1]), X(pt.to[0]), Y(pt.to[1]));
            else if (i) g.lineTo(X(pt[0]), Y(pt[1]));
            else g.moveTo(X(pt[0]), Y(pt[1]));
          });
        }
        g.stroke();
        if (part.cap) g.lineCap = "butt";
        if (part.join) g.lineJoin = "miter";
        break;

      // The name pill every landmark wears, and the one that spans an area.
      case "label":
        label(X(part.x), Y(part.y), str(part.text), part.fg, part.bg);
        break;
      case "areaLabel": {
        const hw = (X(part.w) - X(0)) / 2, hh = (Y(part.h) - Y(0)) / 2;
        areaLabel(X(0) - hw, Y(0) - hh, X(0) + hw, Y(0) + hh, str(part.text), part.fg, part.bg);
        break;
      }

      // Free text INSIDE the art — a route shield's number, a bulevar sign's
      // word. Not a label: no pill, and the font is the part's own.
      case "text":
        g.fillStyle = paint(part.fill);
        g.font = part.font;
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

      // n copies of a sub-list, stepped by (dx, dy). `$i` in a palette index
      // picks per copy, which is how the village gets three coloured houses and
      // the muelle four coloured containers from one part.
      case "repeat":
        for (let i = 0; i < part.n; i++) {
          const dx = (part.dx || 0) * i, dy = (part.dy || 0) * i;
          paintParts(g, part.parts, {
            X: (v) => X(v) + dx,
            Y: (v) => Y(v) + dy,
            color: (spec) => (Array.isArray(spec) ? paint(pick(spec, i)) : paint(spec)),
            skip, vars, prop,
          });
        }
        break;

      // A block of small rects — a hotel's lit windows. Rows and columns rather
      // than a nested `repeat`, because that is what it is.
      case "grid":
        g.fillStyle = paint(part.fill);
        for (let r = 0; r < part.rows; r++) {
          for (let c = 0; c < part.cols; c++) {
            g.fillRect(X(part.x) + c * part.dx, Y(part.y) + r * part.dy,
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
        build(g, part, X, Y);
        if (!stroked || part.fill !== undefined) { g.fillStyle = paint(part.fill); g.fill(); }
        if (stroked) {
          g.strokeStyle = paint(part.stroke);
          g.lineWidth = part.width;
          g.stroke();
        }
      }
    }

    if (moved) g.restore();
  }
}

/** Paint a prop anchored at world (x, y), in plain pixel offsets. */
export function paintAt(parts, x, y, opts = {}) {
  paintParts(opts.g || sharedCtx, parts, {
    X: (v) => x + (v || 0),
    Y: (v) => y + (v || 0),
    ...opts,
  });
}
