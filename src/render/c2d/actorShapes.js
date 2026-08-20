// ACTORS AS DATA — the shared painter used by the game and the world editor.
//
// `actors.json` owns bodies, poses, palette roles and animation curves. This
// module owns only the finite mechanics needed to execute them: six waveforms,
// formula resolution, token lookup and the two deterministic procedural verbs
// that are genuinely algorithms (train smoke and a tuna boil). There is no
// branch on `walker`, `gull`, `boat` or any other asset identity here.
import { paintParts, resolveAssetFormulaMap } from "./shapes.js";
import { hash01 } from "./primitives.js";

const TAU = Math.PI * 2;

export const ACTOR_WAVES = Object.freeze([
  "sin", "cos", "abs-sin", "abs-cos", "saw", "triangle", "constant",
]);

export const ACTOR_FAMILY_VERBS = Object.freeze([
  "cycle-puffs", "boil-arcs", "swirl-flashes", "fish-flashes",
  "root-fan", "whirlpool-rings", "whirlpool-foam", "wake-rings",
]);

function pathValue(root, path) {
  let value = root;
  for (const key of String(path).split(".")) value = value?.[key];
  return value;
}

function mergeRecord(base, overlay) {
  if (!overlay) return base || {};
  return {
    ...(base || {}), ...overlay,
    values: { ...(base?.values || {}), ...(overlay.values || {}) },
    animations: { ...(base?.animations || {}), ...(overlay.animations || {}) },
    palette: { ...(base?.palette || {}), ...(overlay.palette || {}) },
  };
}

function actorRecord(registry, id, active = new Set()) {
  const record = registry.actors?.[id];
  if (!record) throw new Error(`unknown actor "${id}"`);
  if (!record.sameAs) return record;
  if (active.has(id)) throw new Error(`actor alias cycle at "${id}"`);
  active.add(id);
  const merged = mergeRecord(actorRecord(registry, record.sameAs, active), record);
  active.delete(id);
  return merged;
}

/** Resolved metadata for callers that compose state (pose rules, height, roles). */
export function resolveActorRecord(registry, id) {
  return actorRecord(registry, id);
}

function selectedPatch(record, frame) {
  const pose = frame.pose && record.poses?.[frame.pose];
  const variant = frame.variant && record.variants?.[frame.variant];
  const patch = variant ?? pose;
  return typeof patch === "string" ? { form: patch } : patch;
}

function wave(kind, phase) {
  switch (kind) {
    case "sin": return Math.sin(phase);
    case "cos": return Math.cos(phase);
    case "abs-sin": return Math.abs(Math.sin(phase));
    case "abs-cos": return Math.abs(Math.cos(phase));
    case "saw": return ((phase % 1) + 1) % 1;
    case "triangle": {
      const u = ((phase % 1) + 1) % 1;
      return 1 - Math.abs(u * 2 - 1);
    }
    case "constant": return 1;
    default: throw new Error(`unknown actor wave "${kind}"`);
  }
}

/** Resolve every authored animation channel into a flat formula scope. */
export function actorAnimationValues(animations = {}, source = {}) {
  const values = { ...source };
  for (const [name, spec] of Object.entries(animations)) {
    if (!spec || typeof spec !== "object") continue;
    const terms = spec.sources || [{ ref: spec.source || "phase", scale: 1 }];
    let phase = Number(spec.phase || 0);
    for (const term of terms) phase += Number(values[term.ref] || 0) * Number(term.scale ?? 1);
    const raw = wave(spec.wave || "sin", phase * Number(spec.rate ?? 1));
    values[name] = Number(spec.offset || 0) + raw * Number(spec.amplitude ?? 1);
  }
  return values;
}

function actorInk(registry, actor, form, vars, spec) {
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    if (spec.model === "oklch") {
      const at = Math.max(0, Math.min(1, Number(vars[spec.at] || 0)));
      const hue = Number(spec.h?.[0] || 0) + at * (Number(spec.h?.[1] || 0) - Number(spec.h?.[0] || 0));
      return `oklch(${Number(spec.l)} ${Number(spec.c)} ${hue})`;
    }
    return spec;
  }
  let value = spec;
  if (typeof value === "string" && value.startsWith("@")) value = pathValue(registry, value.slice(1));
  if (typeof value === "string" && value.startsWith("$")) {
    const key = value.slice(1);
    value = vars[key] ?? actor.palette?.[key] ?? actor[key]
      ?? form.palette?.[key] ?? form[key];
    if (typeof value === "string" && value.startsWith("@")) value = pathValue(registry, value.slice(1));
  }
  if (Array.isArray(value) && value.length === 2) {
    return `hsl(${Number(vars.hue ?? 200)} ${value[0]}% ${value[1]}%)`;
  }
  if (Array.isArray(value) && value.length === 3) return `rgb(${value.join(",")})`;
  return value;
}

function rgba(rgb, alpha) {
  return `rgba(${Array.isArray(rgb) ? rgb.join(",") : rgb},${Number(alpha).toFixed(2)})`;
}

const FAMILY = Object.freeze({
  "cycle-puffs"(g, part, frame) {
    const v = frame.vars;
    const t = Number(v.timeMs || 0);
    const angle = Number(v.angle || 0);
    for (let i = 0; i < Number(part.n || 0); i++) {
      const phase = ((t * Number(part.rate) + i * Number(part.phaseStep)) % 1 + 1) % 1;
      g.beginPath();
      g.arc(
        frame.X(part.cx || 0) + Math.cos(angle) * Number(part.forward || 0) - phase * Number(part.driftX || 0),
        frame.Y(part.cy || 0) + Math.sin(angle) * Number(part.forward || 0)
          + Number(part.lift || 0) - phase * Number(part.driftY || 0),
        Number(part.r || 0) + phase * Number(part.rGrow || 0), 0, TAU,
      );
      g.fillStyle = frame.color(part.fill);
      g.fill();
    }
  },

  "boil-arcs"(g, part, frame) {
    const v = frame.vars;
    const phase = Number(v.phase || 0), t = Number(v.timeMs || 0);
    g.strokeStyle = frame.color(part.stroke);
    g.lineWidth = Number(part.width || 1);
    for (let i = 0; i < Number(part.n || 0); i++) {
      const h = hash01(i * Number(part.hashStep) + phase);
      const a0 = phase * Number(part.phaseRate) + i * Number(part.step)
        + Math.sin(t * Number(part.breatheRate) + i) * Number(part.breatheAmp);
      g.beginPath();
      g.arc(frame.X(part.cx || 0), frame.Y(part.cy || 0), Number(v.radius)
        * (Number(part.radiusBase) + h * Number(part.radiusRange)),
      a0, a0 + Number(part.spanBase) + h * Number(part.spanRange));
      g.stroke();
    }
  },

  "swirl-flashes"(g, part, frame) {
    const v = frame.vars;
    const phase = Number(v.phase || 0), t = Number(v.timeMs || 0), radius = Number(v.radius || 0);
    const rgb = pathValue(v.registry, String(part.rgb).replace(/^@/, ""));
    for (let i = 0; i < Number(part.n || 0); i++) {
      const h1 = hash01(i * Number(part.hashX) + phase);
      const h2 = hash01(i * Number(part.hashY) + phase);
      const a = h1 * TAU + t * Number(part.spinRate) * (h2 > Number(part.reverseAt) ? 1 : -1);
      const rr = radius * (Number(part.radiusBase) + h2 * Number(part.radiusRange));
      g.save();
      g.translate(frame.X(part.cx || 0) + Math.cos(a) * rr,
        frame.Y(part.cy || 0) + Math.sin(a) * rr);
      g.rotate(a + Number(part.turnOffset || 0) * TAU);
      g.fillStyle = rgba(rgb, Number(part.alphaBase) + h1 * Number(part.alphaRange));
      g.beginPath();
      g.ellipse(0, 0, Number(part.rxBase) + h2 * Number(part.rxRange),
        Number(part.ryBase) + h1 * Number(part.ryRange), 0, 0, TAU);
      g.fill();
      g.restore();
    }
  },

  "fish-flashes"(g, part, frame) {
    const v = frame.vars;
    if (v.taken) return;
    const phase = Number(v.phase || 0), t = Number(v.timeMs || 0);
    g.fillStyle = frame.color(part.fill);
    for (let i = 0; i < Number(part.n || 0); i++) {
      const a = phase + i * Number(part.step) + t * Number(part.rate);
      const rr = Number(part.radiusBase) + (i % Number(part.radiusCycle)) * Number(part.radiusStep);
      g.save();
      g.translate(Math.cos(a) * rr, Math.sin(a) * rr * Number(part.yScale));
      g.rotate(a);
      g.beginPath();
      g.ellipse(0, 0, Number(part.rx), Number(part.ry), 0, 0, TAU);
      g.fill();
      g.restore();
    }
  },

  "root-fan"(g, part, frame) {
    const v = frame.vars;
    const t = Number(v.timeMs || 0), phase = Number(v.phase || 0);
    g.strokeStyle = frame.color(part.stroke);
    g.lineWidth = Number(part.width);
    g.lineCap = part.cap || "round";
    const n = Number(part.n), middle = (n - 1) / 2;
    for (let j = 0; j < n; j++) {
      const i = j - middle;
      const h = Number(part.heightBase)
        + (j % Number(part.heightCycle)) * Number(part.heightStep)
        + Math.sin(t * Number(part.swayRate) + phase + i) * Number(part.swayAmp);
      const x = i * Number(part.gap);
      g.beginPath();
      g.moveTo(x, Number(part.baseY));
      g.quadraticCurveTo(x + Number(part.controlDx), -h * Number(part.controlY),
        x + (i % 2 ? Number(part.tipDx) : -Number(part.tipDx)), -h);
      g.stroke();
    }
    g.lineCap = "butt";
  },

  "whirlpool-rings"(g, part, frame) {
    const radius = Number(frame.vars.radius || 0);
    g.strokeStyle = frame.color(part.stroke);
    g.lineCap = part.cap || "round";
    for (let i = 0; i < Number(part.n); i++) {
      g.lineWidth = Number(part.widthBase) - i * Number(part.widthStep);
      g.beginPath();
      g.arc(0, 0, radius * (Number(part.radiusBase) + i * Number(part.radiusStep)),
        i * Number(part.startStep), i * Number(part.startStep) + Number(part.span));
      g.stroke();
    }
    g.lineCap = "butt";
  },

  "whirlpool-foam"(g, part, frame) {
    const radius = Number(frame.vars.radius || 0);
    g.fillStyle = frame.color(part.fill);
    for (let i = 0; i < Number(part.n); i++) {
      const a = i * Number(part.step);
      const rr = radius * (Number(part.radiusBase) + (i % Number(part.radiusCycle))
        * Number(part.radiusStep));
      g.beginPath();
      g.arc(Math.cos(a) * rr, Math.sin(a) * rr, Number(part.r), 0, TAU);
      g.fill();
    }
  },

  "wake-rings"(g, part, frame) {
    const v = frame.vars;
    const pulse = Math.sin(Number(v.timeMs || 0) * Number(part.rate) + Number(v.phase || 0))
      * Number(part.pulse);
    g.strokeStyle = frame.color(part.stroke);
    g.lineWidth = Number(part.width);
    for (const offset of part.offsets || []) {
      g.beginPath();
      g.arc(0, 0, Number(v.radius || 0) + Number(offset) + pulse, 0, TAU);
      g.stroke();
    }
  },
});

function paintResolvedActor(g, registry, actorId, actor, frame = {}) {
  const formId = actor.form || actorId;
  const form = registry.forms?.[formId];
  if (!form?.parts) throw new Error(`actor ${actorId} names missing form "${formId}"`);
  const animations = { ...(form.animations || {}), ...(actor.animations || {}) };
  let vars = actorAnimationValues(animations, {
    phase: 0, timeMs: 0, hue: 200, shadowDx: 0, shadowDy: 0, shadowAlpha: 1,
    ...frame.vars, ...frame,
  });
  vars = resolveAssetFormulaMap({ ...(form.values || {}), ...(actor.values || {}) }, vars);
  vars.registry = registry;
  const root = { ...(form.root || {}), ...(actor.root || {}) };
  const rootValue = (name, fallback) => {
    const ref = root[name];
    if (typeof ref === "string" && ref.startsWith("$")) return Number(vars[ref.slice(1)] ?? fallback);
    return ref === undefined ? fallback : Number(ref);
  };
  const rotation = Number(frame.rotation || 0) + rootValue("rotation", 0);
  const scale = Number(frame.scale || 1) * rootValue("scale", 1);
  const scaleX = Number(frame.scaleX ?? 1) * rootValue("scaleX", 1);
  const scaleY = Number(frame.scaleY ?? 1) * rootValue("scaleY", 1);
  g.save();
  g.translate(Number(frame.x || 0) + rootValue("x", 0),
    Number(frame.y || 0) + rootValue("y", 0));
  if (rotation) g.rotate(rotation);
  if (scale !== 1 || scaleX !== 1 || scaleY !== 1) g.scale(scale * scaleX, scale * scaleY);
  paintParts(g, form.parts, {
    X: (v) => v || 0,
    Y: (v) => v || 0,
    S: (v) => v || 0,
    vars,
    t: Number(frame.timeMs || 0) / 1000,
    color: (spec) => actorInk(registry, actor, form, vars, spec),
    prop: (id) => registry.forms?.[id]?.parts,
    family: (gg, part, familyFrame) => {
      const verb = FAMILY[part.verb];
      if (!verb) throw new Error(`unknown actor family verb "${part.verb}"`);
      verb(gg, part, familyFrame);
    },
  });
  g.restore();
  return { actor, form, vars };
}

/** Paint one actor record from the complete, possibly-unsaved registry. */
export function paintActor(g, registry, actorId, frame = {}) {
  let actor = actorRecord(registry, actorId);
  actor = mergeRecord(actor, selectedPatch(actor, frame));
  return paintResolvedActor(g, registry, actorId, actor, frame);
}

/** Paint a reusable form used inside a composed actor (wagon, smoke, cargo). */
export function paintActorForm(g, registry, formId, frame = {}, actor = {}) {
  return paintResolvedActor(g, registry, formId, { ...actor, form: formId }, frame);
}

/** Stable preview pose shared by the editor and art sheets. */
export function paintActorPreview(g, registry, actorId, options = {}) {
  return paintActor(g, registry, actorId, {
    phase: 1.1,
    timeMs: 1234,
    hue: 200,
    shadowDx: 0.7,
    shadowDy: 0.8,
    shadowAlpha: 0.72,
    ...options,
  });
}
