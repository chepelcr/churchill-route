// PROCEDURAL SCENES AS DATA.
//
// A fountain needs a clock, a pool needs a clip and the Faro's tower needs a
// tapered mask.  Those are finite mechanics, not identities hidden in a
// drawFountain/drawPool switch.  Their complete recipes live in
// world-props.json; this module is shared by the game and the editor.
import { paintParts } from "./shapes.js";
import { hash01 } from "./primitives.js";
import { paintFloraSpecies } from "./floraShapes.js";

const TAU = Math.PI * 2;

export const SCENE_FAMILY_VERBS = Object.freeze([
  "riprap", "flora-placements", "lighthouse-tower", "fountain-water", "pool-water",
]);

function sceneInk(registry, scene, vars, spec) {
  if (typeof spec !== "string" || !spec.startsWith("$")) return spec;
  let value = vars[spec.slice(1)] ?? scene.palette?.[spec.slice(1)];
  if (typeof value === "string" && value.startsWith("@")) {
    const [other, key] = value.slice(1).split(".");
    value = registry.scenes?.[other]?.palette?.[key];
  }
  return value;
}

const FAMILY = Object.freeze({
  riprap(g, part, frame) {
    const rim = frame.vars.rim || [];
    const seed = Number(frame.vars.seed || 0);
    for (let i = 0; i < rim.length; i++) {
      const [x, y] = rim[i];
      const r = Number(part.minR) + hash01(seed * Number(part.seedMul) + i * Number(part.step))
        * Number(part.radiusRange);
      g.fillStyle = frame.color(i % Number(part.darkEvery) ? part.dark : part.light);
      g.beginPath();
      g.ellipse(x, y, r + Number(part.stretch), r,
        hash01(i * Number(part.rotStep) + seed) * Math.PI, 0, TAU);
      g.fill();
    }
  },

  "flora-placements"(g, part, frame) {
    const registry = frame.vars.flora;
    const species = registry?.species?.[part.species];
    const form = species && registry.forms?.[species.form];
    if (!species || !form) throw new Error(`unknown scene flora species "${part.species}"`);
    for (const [x, y] of part.positions || []) {
      paintFloraSpecies(g, species, form, {
        x, y, s: Number(part.scale ?? 1), seed: Number(part.seed ?? 0) + x * 0.013 + y * 0.021,
        phase: Number(frame.vars.timeMs || 0) * 0.001,
        tMs: Number(frame.vars.timeMs || 0),
        solar: frame.vars.solar,
        showShadow: part.shadow !== false,
      });
    }
  },

  // EL FARO SE VE DESDE ARRIBA, como todo lo construido en este mundo: la torre es
  // un cilindro que se angosta, tendido hacia el norte por su altura, y sus franjas
  // son anillos. Era un alzado plano —una torre de perfil parada sobre un mapa—,
  // que es la única cosa del juego que se dibujaba así.
  "lighthouse-tower"(g, part, frame) {
    const p = part, H = Number(p.height) * Number(p.lean), R0 = Number(p.baseHalf), R1 = Number(p.topHalf);
    g.fillStyle = frame.color(p.shadow);
    g.beginPath(); g.ellipse(Number(p.shadowDx), Number(p.shadowDy), Number(p.shadowRx), Number(p.shadowRy), 0, 0, TAU); g.fill();
    const steps = Number(p.steps), bands = p.bandsAt || [];
    for (let k = 0; k <= steps; k++) {
      const f = k / steps, banded = bands.some(([a, b]) => f >= a && f < b);
      g.fillStyle = frame.color(banded ? p.band : p.body);
      g.beginPath(); g.arc(0, -H * f, R0 + (R1 - R0) * f, 0, TAU); g.fill();
    }
    g.strokeStyle = frame.color(p.edge); g.lineWidth = Number(p.edgeWidth);
    g.beginPath(); g.arc(0, -H, R1, 0, TAU); g.stroke();
    // la galería con su baranda, la linterna de vidrio y el techo
    g.fillStyle = frame.color(p.gallery);
    g.beginPath(); g.arc(0, -H - Number(p.galleryH), Number(p.galleryW) / 2, 0, TAU); g.fill();
    g.fillStyle = frame.color(p.body);
    g.beginPath(); g.arc(0, -H - Number(p.galleryH), Number(p.galleryW) / 2 - Number(p.railW), 0, TAU); g.fill();
    g.fillStyle = frame.color(p.lantern);
    g.beginPath(); g.arc(0, -H - Number(p.lanternY), Number(p.lanternR), 0, TAU); g.fill();
    g.fillStyle = frame.color(p.gallery);
    g.beginPath(); g.arc(0, -H - Number(p.finialY), Number(p.finialW) / 2, 0, TAU); g.fill();
  },

  "fountain-water"(g, part, frame) {
    const t = Number(frame.vars.timeMs || 0) * Number(part.rippleSpeed);
    const r = Number(part.waterR);
    g.save(); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
    g.fillStyle = frame.color(part.water); g.fillRect(-r, -r, r * 2, r * 2);
    g.strokeStyle = frame.color(part.ripple); g.lineWidth = Number(part.rippleWidth);
    for (let i = 0; i < Number(part.ripples); i++) {
      const rr = ((t + i / Number(part.ripples)) % 1) * r;
      g.globalAlpha = Math.max(0, 1 - rr / r);
      g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke();
    }
    g.restore();
    const jetH = Number(part.jetBase) + Math.sin(t * Number(part.jetSpeed)) * Number(part.jetBob);
    g.fillStyle = frame.color(part.jet);
    g.beginPath(); g.ellipse(0, -jetH / 2, Number(part.jetHalfW), jetH / 2, 0, 0, TAU); g.fill();
    for (let i = 0; i < Number(part.droplets); i++) {
      const a = (i / Number(part.droplets)) * TAU + t * Number(part.dropletSpin);
      const rr = Number(part.dropletBase)
        + ((t * Number(part.dropletSpeed) + i * Number(part.dropletPhase))
          % Number(part.dropletSpread));
      g.beginPath();
      g.arc(Math.cos(a) * rr, -jetH + Math.sin(a) * Number(part.dropletRise),
        Number(part.dropletR), 0, TAU);
      g.fill();
    }
  },

  "pool-water"(g, part, frame) {
    const t = Number(frame.vars.timeMs || 0) * Number(part.speed);
    const rx = Number(part.waterRx), ry = Number(part.waterRy);
    g.save(); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.clip();
    g.fillStyle = frame.color(part.water); g.fillRect(-rx - 4, -ry - 4, rx * 2 + 8, ry * 2 + 8);
    g.fillStyle = frame.color(part.deep);
    g.beginPath(); g.ellipse(Number(part.deepX), Number(part.deepY),
      Number(part.deepRx), Number(part.deepRy), 0, 0, TAU); g.fill();
    g.fillStyle = frame.color(part.shallow);
    g.beginPath(); g.ellipse(Number(part.shallowX), Number(part.shallowY),
      Number(part.shallowRx), Number(part.shallowRy), 0, 0, TAU); g.fill();
    g.strokeStyle = frame.color(part.shimmer); g.lineWidth = Number(part.shimmerWidth);
    for (let i = 0; i < Number(part.shimmerLines); i++) {
      const y = Number(part.shimmerTop) + i * Number(part.shimmerGap)
        + Math.sin(t * Number(part.shimmerSpeedA) + i) * Number(part.shimmerAmp);
      g.beginPath();
      for (let x = -rx; x <= rx; x += Number(part.shimmerStep)) {
        g.lineTo(x, y + Math.sin(x * Number(part.shimmerFreq)
          + t * Number(part.shimmerSpeedB) + i) * Number(part.shimmerWave));
      }
      g.stroke();
    }
    g.restore();
  },
});

export function paintSceneParts(g, registry, sceneId, frame = {}) {
  const scene = registry.scenes?.[sceneId];
  if (!scene?.parts) throw new Error(`scene "${sceneId}" has no parts`);
  const vars = { ...(frame.vars || {}), timeMs: frame.timeMs ?? frame.vars?.timeMs ?? 0 };
  paintParts(g, scene.parts, {
    ...frame,
    vars,
    color: (spec) => sceneInk(registry, scene, vars, spec),
    family: (gg, part, familyFrame) => {
      const verb = FAMILY[part.verb];
      if (!verb) throw new Error(`unknown scene family verb "${part.verb}"`);
      verb(gg, part, familyFrame);
    },
  });
}
