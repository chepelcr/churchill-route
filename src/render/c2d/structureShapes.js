// STRUCTURES AS DATA — finite mechanics for recipes fitted to world geometry.
//
// The world owns a footprint/polyline.  `materials.json` owns everything that
// appears inside that host: ordered layers, dimensions, spacing and inks.  This
// module executes the few loops that cannot honestly be expanded into hundreds
// of JSON rectangles (suspension hangers, lattice braces, pier seams and posts).
import { paintParts } from "./shapes.js";
import { upright } from "./primitives.js";

export const STRUCTURE_FAMILY_VERBS = Object.freeze([
  "bridge-hangers", "bridge-tower", "bridge-sign",
  "pier-seams", "pier-posts",
]);

const FAMILY = Object.freeze({
  "bridge-hangers"(g, part, frame) {
    const v = frame.vars;
    const x0 = Number(v[part.from]), x1 = Number(v[part.to]);
    const top = Number(v[part.top]), sag = Number(v[part.sag]);
    g.strokeStyle = frame.color(part.stroke);
    g.lineWidth = Number(part.width);
    for (let x = x0 + Number(part.gap); x < x1; x += Number(part.gap)) {
      const t = (x - x0) / (x1 - x0 || 1);
      const y = (1 - t) * (1 - t) * top + 2 * t * (1 - t) * sag + t * t * top;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, Number(v[part.deck])); g.stroke();
    }
  },

  "bridge-tower"(g, part, frame) {
    const v = frame.vars;
    const x = Number(v[part.x]), top = Number(v[part.top]), h = Number(v[part.height]);
    const legGap = Number(part.legGap), legW = Number(part.legWidth);
    g.fillStyle = frame.color(part.legFill);
    g.fillRect(x - legGap, top, legW, h + Number(part.legFoot));
    g.fillRect(x + legGap - legW, top, legW, h + Number(part.legFoot));
    g.fillStyle = frame.color(part.capFill);
    g.fillRect(x - Number(part.capHalf), top - Number(part.capHeight),
      Number(part.capHalf) * 2, Number(part.capHeight));
    g.strokeStyle = frame.color(part.braceStroke);
    g.lineWidth = Number(part.braceWidth);
    const n = Number(part.panels), step = (h + Number(part.legFoot)) / n;
    for (let i = 0; i < n; i++) {
      const y0 = top + i * step, y1 = y0 + step;
      g.beginPath();
      g.moveTo(x - Number(part.braceHalf), y0); g.lineTo(x + Number(part.braceHalf), y1);
      g.moveTo(x + Number(part.braceHalf), y0); g.lineTo(x - Number(part.braceHalf), y1);
      g.stroke();
    }
  },

  // The bridge's name board. Like every other sign, it stands up against a
  // rolled camera — see `upright` in `primitives.js`.
  "bridge-sign"(g, part, frame) {
    const v = frame.vars;
    const text = String(v[part.text] ?? part.fallback ?? "");
    const x = Number(v[part.x]), y = Number(v[part.y]);
    const stood = upright(g, x, y);
    const bx = stood ? 0 : x, by = stood ? 0 : y;
    g.font = part.font;
    g.textAlign = "center";
    const w = g.measureText(text).width + Number(part.padX) * 2;
    g.fillStyle = frame.color(part.bg);
    g.fillRect(bx - w / 2, by, w, Number(part.height));
    g.fillStyle = frame.color(part.fg);
    g.fillText(text, bx, by + Number(part.baseline));
    if (stood) g.restore();
  },

  "pier-seams"(g, part, frame) {
    const v = frame.vars;
    const len = Number(v.len), hw = Number(v.hw), run = Number(v.run);
    const gap = Number(v.seamGap);
    g.strokeStyle = frame.color(v.seam);
    g.lineWidth = Number(part.width);
    for (let s = gap - (run % gap); s < len; s += gap) {
      g.beginPath(); g.moveTo(s, -hw + Number(part.inset));
      g.lineTo(s, hw - Number(part.inset)); g.stroke();
    }
  },

  "pier-posts"(g, part, frame) {
    const v = frame.vars;
    const len = Number(v.len), hw = Number(v.hw), run = Number(v.run);
    const gap = Number(v.posts);
    g.fillStyle = frame.color(part.fill);
    for (let s = Number(part.start) - (run % gap); s < len; s += gap) {
      g.fillRect(s, -hw - 1, Number(part.size), Number(part.size));
      g.fillRect(s, hw - 2, Number(part.size), Number(part.size));
    }
  },

});

export function paintStructureParts(g, parts, frame) {
  paintParts(g, parts, {
    ...frame,
    family: (gg, part, familyFrame) => {
      const verb = FAMILY[part.verb];
      if (!verb) throw new Error(`unknown structure family verb "${part.verb}"`);
      verb(gg, part, familyFrame);
    },
  });
}
