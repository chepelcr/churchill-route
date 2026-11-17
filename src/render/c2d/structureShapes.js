// STRUCTURES AS DATA — finite mechanics for recipes fitted to world geometry.
//
// The world owns a footprint/polyline.  `materials.json` owns everything that
// appears inside that host: ordered layers, dimensions, spacing and inks.  This
// module executes the few loops that cannot honestly be expanded into hundreds
// of JSON rectangles (pier seams and posts).
import { paintParts } from "./shapes.js";

export const STRUCTURE_FAMILY_VERBS = Object.freeze([
  "pier-seams", "pier-posts",
]);

const FAMILY = Object.freeze({
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
    // un estilo puede pedir pilotes CENTRADOS sobre la baranda, de su tamaño y desde su arranque (el de la
    // receta de luces, así cada luz y cada bandera quedan paradas sobre uno); sin eso, como siempre
    if (v.postSize != null) {
      const size = Number(v.postSize), h = size / 2;
      for (let s = Number(v.postStart) - (run % gap); s < len + h; s += gap) {
        if (s < -h) continue;
        g.fillRect(s - h, -hw + 1 - h, size, size);
        g.fillRect(s - h, hw - 1 - h, size, size);
      }
      return;
    }
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
