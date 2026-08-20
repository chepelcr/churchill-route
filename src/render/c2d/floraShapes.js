// THE FLORA RECIPE INTERPRETER.
//
// This module is the engine half of `src/assets/flora.json` v2. It owns the
// finite maths vocabulary — ragged crowns, explicit tier stacks, branch crowns,
// two palm families and tidal root architectures — while the registry owns
// every authored number. It is
// deliberately independent of the world, mutable game state, DOM and gfx's
// shared context so the world editor can import THIS painter for a truthful
// unsaved preview.
//
// Keep the boundary sharp: data may compose these verbs, but it never contains
// expressions or arbitrary Canvas commands. Placement, culling, tide and clock
// evolution remain in their game modules and arrive through `frame`.
import { hash01 } from "./primitives.js";

const TAU = Math.PI * 2;
const _bx = [];
const _by = [];

/** Stable per-instance variation. A plant carries its position for life. */
export function floraSeed(x, y) {
  return hash01(x * 0.0173 + y * 0.0131);
}

/** A soft ragged closed blob, shared by every leafy generator. */
export function floraCanopyPath(g, cx, cy, radius, seed, wobble = 0.22, points = 13,
  scaleY = 0.86, scaleX = 1) {
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * TAU + seed * 0.7;
    const rr = radius * (1 - wobble + wobble * 2 * hash01(seed * 91.7 + i * 3.13));
    _bx[i] = cx + Math.cos(angle) * rr * scaleX;
    _by[i] = cy + Math.sin(angle) * rr * scaleY;
  }
  g.beginPath();
  g.moveTo((_bx[points - 1] + _bx[0]) / 2, (_by[points - 1] + _by[0]) / 2);
  for (let i = 0; i < points; i += 1) {
    const next = (i + 1) % points;
    g.quadraticCurveTo(
      _bx[i], _by[i],
      (_bx[i] + _bx[next]) / 2,
      (_by[i] + _by[next]) / 2,
    );
  }
  g.closePath();
}

function tone(palette, index) {
  return palette[Math.max(0, Math.min(palette.length - 1, index))];
}

function solarShadow(g, x, y, radius, recipe, frame) {
  if (frame.showShadow === false || !recipe) return;
  const solar = frame.solar;
  if (!solar?.sun || !solar?.model) {
    throw new Error("flora shadow requires frame.solar = {sun, model}");
  }
  const { sun, model } = solar;
  const reach = radius * (model.reachAtNoon + (1 - sun.alt) * model.reachAtDusk);
  const previousAlpha = g.globalAlpha;
  g.fillStyle = `rgba(${model.color},${recipe.alpha})`;
  g.globalAlpha = previousAlpha * (model.alphaAtDusk
    + sun.alt * (model.alphaAtNoon - model.alphaAtDusk));
  g.beginPath();
  g.ellipse(
    x + sun.x * reach,
    y + sun.y * reach * model.squashY,
    radius * recipe.rxR,
    radius * recipe.ryR,
    0, 0, TAU,
  );
  g.fill();
  g.globalAlpha = previousAlpha;
}

function paintCrownStack(g, species, form, frame) {
  const { x, y, s, seed } = frame;
  const radius = species.r * s;
  const shadow = form.shadow;
  solarShadow(
    g,
    x,
    y + shadow.baseYPx,
    radius * shadow.radiusR,
    shadow,
    frame,
  );

  const trunk = form.trunk;
  g.strokeStyle = species.trunk;
  g.lineWidth = trunk.widthPx * s;
  g.lineCap = trunk.cap;
  g.beginPath();
  g.moveTo(x, y + trunk.baseYPx);
  g.lineTo(x, y - species.trunkH * s);
  g.stroke();

  const crown = form.crown;
  const jitterX = (hash01(seed * 7.7) - 0.5) * radius * crown.jitterXR;
  const jitterY = (hash01(seed * 11.3) - 0.5) * radius * crown.jitterYR;
  const crownX = x + jitterX;
  const crownY = y - (species.trunkH + trunk.crownGapPx) * s + jitterY;
  for (const layer of crown.layers) {
    g.fillStyle = tone(species.canopy, layer.tone);
    floraCanopyPath(
      g,
      crownX + layer.xR * radius,
      crownY + layer.yR * radius,
      layer.radiusR * radius,
      seed + layer.seedOffset,
      layer.wobble,
      layer.points,
      layer.scaleY ?? crown.scaleY,
      layer.scaleX ?? crown.scaleX,
    );
    g.fill();
  }
}

function paintTierStack(g, species, form, frame) {
  const { x, y, s, seed } = frame;
  const radius = species.r * s;
  const shadow = form.shadow;
  solarShadow(g, x, y + shadow.baseYPx, radius * shadow.radiusR, shadow, frame);

  const trunk = form.trunk;
  g.strokeStyle = species.trunk;
  g.lineWidth = trunk.widthPx * s;
  g.lineCap = trunk.cap;
  g.beginPath();
  g.moveTo(x, y + trunk.baseYPx);
  g.lineTo(x, y - species.trunkH * s);
  g.stroke();

  const recipe = form.tiers;
  for (const layer of recipe.layers) {
    g.fillStyle = tone(species.canopy, layer.tone);
    floraCanopyPath(
      g,
      x + layer.xR * radius,
      y - (species.trunkH + recipe.startPx) * s + layer.yR * radius,
      radius * layer.radiusR,
      seed + layer.seedOffset,
      layer.wobble,
      layer.points,
      layer.scaleY,
      layer.scaleX,
    );
    g.fill();
  }
}

function paintColumnStack(g, species, form, frame) {
  const { x, y, s, seed } = frame;
  const radius = species.r * s;
  const shadow = form.shadow;
  solarShadow(g, x, y + shadow.baseYPx, radius * shadow.radiusR, shadow, frame);
  const trunk = form.trunk;
  g.strokeStyle = species.trunk;
  g.lineWidth = trunk.widthPx * s;
  g.lineCap = trunk.cap;
  g.beginPath();
  g.moveTo(x, y + trunk.baseYPx);
  g.lineTo(x, y - species.trunkH * s);
  g.stroke();
  const recipe = form.column;
  for (const layer of recipe.layers) {
    g.fillStyle = tone(species.canopy, layer.tone);
    floraCanopyPath(
      g,
      x + layer.xR * radius,
      y - species.trunkH * s + layer.yR * radius,
      radius * layer.radiusR,
      seed + layer.seedOffset,
      layer.wobble,
      layer.points,
      layer.scaleY,
      layer.scaleX,
    );
    g.fill();
  }
}

function paintBranchCrown(g, species, form, frame) {
  const { x, y, s, seed } = frame;
  const height = species.trunkH * s;
  const radius = species.r * s;
  const shadow = form.shadow;
  solarShadow(g, x, y + shadow.baseYPx, radius * shadow.radiusR, shadow, frame);
  const trunk = form.trunk;
  g.strokeStyle = species.trunk;
  g.lineCap = trunk.cap;
  g.lineWidth = trunk.widthPx * s;
  g.beginPath();
  g.moveTo(x, y + trunk.baseYPx);
  g.lineTo(x, y - height);
  g.stroke();

  const recipe = form.branches;
  const count = recipe.count;
  g.lineWidth = trunk.branchWidthPx * s;
  g.beginPath();
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2
      + (hash01(seed * 13.7 + i * 2.9) - 0.5) * recipe.angleSpread;
    const length = radius * (recipe.lengthMinR
      + hash01(seed * 23.3 + i) * recipe.lengthRangeR);
    const bx = x + Math.cos(angle) * length;
    const by = y - height + Math.sin(angle) * length * recipe.verticalScale;
    g.moveTo(
      x,
      y - height * (recipe.startMinH
        + hash01(seed * 5.1 + i) * recipe.startRangeH),
    );
    g.lineTo(bx, by);
    const forkAngle = angle
      + (hash01(seed * 31.1 + i) - 0.5) * recipe.forkAngleSpread;
    g.lineTo(
      bx + Math.cos(forkAngle) * length * recipe.forkLength,
      by + Math.sin(forkAngle) * length * recipe.forkVerticalScale,
    );
  }
  g.stroke();
}

function paintFrondRing(g, species, form, frame) {
  const { x, y, s, seed, tMs = 0, phase = 0 } = frame;
  const radius = species.r * s;
  const trunk = form.trunk;
  const sway = Math.sin(tMs * trunk.swaySpeed + phase) * trunk.swayPx;
  const shadow = form.shadow;
  solarShadow(g, x, y + shadow.baseYPx, radius * shadow.radiusR, shadow, frame);
  g.strokeStyle = species.trunk;
  g.lineWidth = trunk.widthPx * s;
  g.lineCap = trunk.cap;
  g.beginPath();
  g.moveTo(x, y + trunk.baseYPx);
  g.lineTo(x + sway, y - species.trunkH * s);
  g.stroke();

  const cx = x + sway;
  const cy = y - species.trunkH * s;
  const fronds = form.fronds;
  const count = fronds.count;
  g.fillStyle = tone(species.canopy, fronds.tone);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU + sway * fronds.angleSway
      + (hash01(seed * 31.1 + i) - 0.5) * fronds.angleJitter;
    const length = radius * (fronds.lengthMinR
      + hash01(seed * 17.9 + i * 2.7) * fronds.lengthRangeR);
    g.beginPath();
    g.ellipse(
      cx + Math.cos(angle) * length,
      cy + Math.sin(angle) * length * fronds.radialYSquash,
      fronds.widthPx * s,
      fronds.heightPx * s,
      angle, 0, TAU,
    );
    g.fill();
  }
  const core = form.core;
  g.fillStyle = tone(species.canopy, core.tone);
  floraCanopyPath(
    g, cx, cy, core.radiusPx * s, seed + core.seedOffset,
    core.wobble, core.points,
  );
  g.fill();
}

function paintFanRing(g, species, form, frame) {
  const { x, y, s, seed, tMs = 0, phase = 0 } = frame;
  const radius = species.r * s;
  const trunk = form.trunk;
  const sway = Math.sin(tMs * trunk.swaySpeed + phase) * trunk.swayPx;
  const shadow = form.shadow;
  solarShadow(g, x, y + shadow.baseYPx, radius * shadow.radiusR, shadow, frame);
  g.strokeStyle = species.trunk;
  g.lineWidth = trunk.widthPx * s;
  g.lineCap = trunk.cap;
  g.beginPath();
  g.moveTo(x, y + trunk.baseYPx);
  g.lineTo(x + sway, y - species.trunkH * s);
  g.stroke();

  const cx = x + sway;
  const cy = y - species.trunkH * s;
  const fans = form.fans;
  for (let i = 0; i < fans.count; i += 1) {
    const angle = (i / fans.count) * TAU + sway * fans.angleSway
      + (hash01(seed * fans.angleSeed + i) - 0.5) * fans.angleJitter;
    const length = radius * (fans.lengthMinR
      + hash01(seed * fans.lengthSeed + i * fans.lengthStep) * fans.lengthRangeR);
    const half = fans.halfAngle;
    const ax = Math.cos(angle - half);
    const ay = Math.sin(angle - half) * fans.radialYSquash;
    const bx = Math.cos(angle + half);
    const by = Math.sin(angle + half) * fans.radialYSquash;
    const tx = Math.cos(angle);
    const ty = Math.sin(angle) * fans.radialYSquash;
    g.fillStyle = tone(species.canopy, fans.tone);
    g.beginPath();
    g.moveTo(
      cx + tx * length * fans.baseR,
      cy + ty * length * fans.baseR,
    );
    g.lineTo(cx + ax * length, cy + ay * length);
    g.quadraticCurveTo(
      cx + tx * length * fans.tipBulgeR,
      cy + ty * length * fans.tipBulgeR,
      cx + bx * length,
      cy + by * length,
    );
    g.closePath();
    g.fill();
  }
  const core = form.core;
  g.fillStyle = tone(species.canopy, core.tone);
  floraCanopyPath(
    g, cx, cy, core.radiusPx * s, seed + core.seedOffset,
    core.wobble, core.points, core.scaleY, core.scaleX,
  );
  g.fill();
}

const ROOT_ARCHITECTURES = Object.freeze({
  prop(g, species, roots, frame, radius, wet) {
    const { x, y, seed } = frame;
    const count = roots.count.min + Math.round(hash01(seed * 13.7) * roots.count.range);
    const recipe = roots.prop;
    const rootRadius = radius * (recipe.radiusMinR + recipe.radiusDryGainR * (1 - wet));
    g.strokeStyle = `rgba(${species.roots},${(roots.stroke.alphaDry
      - roots.stroke.alphaWetLoss * wet).toFixed(3)})`;
    g.lineWidth = roots.stroke.widthPx;
    g.lineCap = roots.stroke.cap;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + seed * recipe.angleSeed;
      const rr = rootRadius * (recipe.lengthMin
        + hash01(seed * recipe.lengthSeed + i * recipe.lengthStep) * recipe.lengthRange);
      g.beginPath();
      g.moveTo(
        x + Math.cos(angle) * radius * recipe.startR,
        y + Math.sin(angle) * radius * recipe.startYR,
      );
      g.quadraticCurveTo(
        x + Math.cos(angle) * rr * recipe.control,
        y + Math.sin(angle) * rr * recipe.controlY,
        x + Math.cos(angle) * rr,
        y + Math.sin(angle) * rr * recipe.endY,
      );
      g.stroke();
    }
  },
  spike(g, species, roots, frame, radius, wet) {
    const { x, y, seed } = frame;
    const count = roots.count.min + Math.round(hash01(seed * 13.7) * roots.count.range);
    const recipe = roots.spike;
    g.strokeStyle = `rgba(${species.roots},${(roots.stroke.alphaDry
      - roots.stroke.alphaWetLoss * wet).toFixed(3)})`;
    g.lineWidth = roots.stroke.widthPx;
    g.lineCap = roots.stroke.cap;
    for (let i = 0; i < count; i += 1) {
      const unit = hash01(seed * recipe.radiusSeed + i * recipe.radiusStep);
      const angle = (i / count) * TAU + seed * recipe.angleSeed;
      const rr = radius * (recipe.radiusMinR + unit * recipe.radiusRangeR);
      const height = radius * (recipe.heightMinR
        + hash01(seed * recipe.heightSeed + i * recipe.heightStep) * recipe.heightRangeR);
      const px = x + Math.cos(angle) * rr;
      const py = y + Math.sin(angle) * rr * recipe.radialYSquash;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(angle) * height * recipe.leanR, py - height * (1 - wet));
      g.stroke();
    }
  },
  buttress(g, species, roots, frame, radius, wet) {
    const { x, y, seed } = frame;
    const count = roots.count.min + Math.round(hash01(seed * 13.7) * roots.count.range);
    const recipe = roots.buttress;
    g.fillStyle = `rgba(${species.roots},${(roots.fill.alphaDry
      - roots.fill.alphaWetLoss * wet).toFixed(3)})`;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + seed * recipe.angleSeed;
      const endR = radius * (recipe.endMinR
        + hash01(seed * recipe.lengthSeed + i * recipe.lengthStep) * recipe.endRangeR);
      const half = recipe.halfAngle;
      g.beginPath();
      g.moveTo(
        x + Math.cos(angle - half) * radius * recipe.startR,
        y + Math.sin(angle - half) * radius * recipe.startYR,
      );
      g.lineTo(
        x + Math.cos(angle) * endR,
        y + Math.sin(angle) * endR * recipe.endY,
      );
      g.lineTo(
        x + Math.cos(angle + half) * radius * recipe.startR,
        y + Math.sin(angle + half) * radius * recipe.startYR,
      );
      g.closePath();
      g.fill();
    }
  },
  collar(g, species, roots, frame, radius, wet) {
    const recipe = roots.collar;
    g.fillStyle = `rgba(${species.roots},${(roots.fill.alphaDry
      - roots.fill.alphaWetLoss * wet).toFixed(3)})`;
    floraCanopyPath(
      g,
      frame.x,
      frame.y + radius * recipe.yR,
      radius * recipe.radiusR,
      frame.seed + recipe.seedOffset,
      recipe.wobble,
      recipe.points,
      recipe.scaleY,
      recipe.scaleX,
    );
    g.fill();
  },
});

export const FLORA_ROOT_ARCHITECTURES = Object.freeze(Object.keys(ROOT_ARCHITECTURES));

function paintTidalRootCrown(g, species, form, frame) {
  const { x, y, seed, tide = 0.5, tMs = 0 } = frame;
  const radius = frame.radius ?? species.r * frame.s;
  const wet = Math.max(0, Math.min(1, tide));
  const crownRecipe = form.crown;
  const sway = Math.sin(tMs * crownRecipe.swaySpeed + seed * crownRecipe.swaySeed)
    * crownRecipe.swayPx;

  const mud = form.mud;
  if (wet < mud.visibleBelowTide) {
    g.fillStyle = `rgba(${species.mud},${(mud.alpha * (1 - wet)).toFixed(3)})`;
    floraCanopyPath(g, x, y + 1, radius * mud.radiusR, seed + mud.seedOffset, mud.wobble);
    g.fill();
  }

  const shadow = form.shadow;
  if (frame.showShadow !== false) {
    const model = frame.shadowModel || frame.solar?.model;
    if (!model?.color) throw new Error("mangrove shadow requires a JSON shadow model");
    g.fillStyle = `rgba(${model.color},${shadow.alpha})`;
    floraCanopyPath(
      g, x + shadow.xPx, y + shadow.yPx,
      radius * shadow.radiusR, seed, shadow.wobble,
    );
    g.fill();
  }

  const roots = form.roots;
  const rootPainter = ROOT_ARCHITECTURES[roots.architecture];
  if (!rootPainter) throw new Error(`unknown flora root architecture: ${roots.architecture}`);
  rootPainter(g, species, roots, frame, radius, wet);

  const water = form.water;
  g.fillStyle = `rgba(${species.shallow},${(water.alpha
    + water.wetAlphaGain * wet).toFixed(3)})`;
  floraCanopyPath(
    g, x, y + 1,
    radius * (water.radiusR + water.wetGainR * wet),
    seed + water.seedOffset, water.wobble,
  );
  g.fill();

  const crownRadius = radius * (crownRecipe.radiusR
    + crownRecipe.wetRadiusGainR * wet);
  const crownY = y - radius * crownRecipe.dryLiftR * (1 - wet);
  for (const layer of crownRecipe.layers) {
    g.fillStyle = tone(species.canopy, layer.tone);
    floraCanopyPath(
      g,
      x + layer.xR * crownRadius + sway * layer.sway,
      crownY + layer.yR * crownRadius,
      crownRadius * layer.radiusR,
      seed + layer.seedOffset,
      layer.wobble,
      layer.points,
      layer.scaleY ?? crownRecipe.scaleY,
      layer.scaleX ?? crownRecipe.scaleX,
    );
    g.fill();
  }
}

export const FLORA_GENERATORS = Object.freeze({
  "crown-stack": paintCrownStack,
  "tier-stack": paintTierStack,
  "column-stack": paintColumnStack,
  "branch-crown": paintBranchCrown,
  "frond-ring": paintFrondRing,
  "fan-ring": paintFanRing,
  "tidal-root-crown": paintTidalRootCrown,
});

export const FLORA_GENERATOR_NAMES = Object.freeze(Object.keys(FLORA_GENERATORS));

/** Resolve a weighted JSON mix from a stable unit value in [0, 1). */
export function resolveFloraMixSpecies(weights, unit) {
  if (!Array.isArray(weights) || !weights.length) {
    throw new Error("flora mix requires at least one [species, weight] row");
  }
  let total = 0;
  for (const [, weight] of weights) total += Math.max(0, Number(weight) || 0);
  if (!(total > 0)) throw new Error("flora mix requires a positive total weight");
  let cursor = Math.max(0, Math.min(0.999999999, Number(unit) || 0)) * total;
  for (const [speciesId, weight] of weights) {
    cursor -= Math.max(0, Number(weight) || 0);
    if (cursor <= 0) return speciesId;
  }
  return weights[weights.length - 1][0];
}

// The schema-facing half of each generator. The editor imports this rather than
// maintaining a second list of accepted overrides or required recipe blocks.
// If a painter grows a new authored knob, its contract changes in the same file
// and every validator sees it immediately.
export const FLORA_GENERATOR_CONTRACTS = Object.freeze({
  "crown-stack": Object.freeze({
    fields: Object.freeze(["shadow", "trunk", "crown"]),
    paletteRoles: Object.freeze(["canopy", "trunk"]),
    overrides: Object.freeze([]),
  }),
  "tier-stack": Object.freeze({
    fields: Object.freeze(["shadow", "trunk", "tiers"]),
    paletteRoles: Object.freeze(["canopy", "trunk"]),
    overrides: Object.freeze([]),
  }),
  "column-stack": Object.freeze({
    fields: Object.freeze(["shadow", "trunk", "column"]),
    paletteRoles: Object.freeze(["canopy", "trunk"]),
    overrides: Object.freeze([]),
  }),
  "branch-crown": Object.freeze({
    fields: Object.freeze(["shadow", "trunk", "branches"]),
    paletteRoles: Object.freeze(["trunk"]),
    overrides: Object.freeze([]),
  }),
  "frond-ring": Object.freeze({
    fields: Object.freeze(["shadow", "trunk", "fronds", "core"]),
    paletteRoles: Object.freeze(["canopy", "trunk"]),
    overrides: Object.freeze([]),
  }),
  "fan-ring": Object.freeze({
    fields: Object.freeze(["shadow", "trunk", "fans", "core"]),
    paletteRoles: Object.freeze(["canopy", "trunk"]),
    overrides: Object.freeze([]),
  }),
  "tidal-root-crown": Object.freeze({
    fields: Object.freeze(["mud", "shadow", "roots", "water", "crown"]),
    paletteRoles: Object.freeze(["canopy", "roots", "mud", "shallow"]),
    overrides: Object.freeze([]),
  }),
});

/** Paint one already-resolved species/form record. */
export function paintFloraSpecies(g, species, form, frame = {}) {
  if (!g) throw new Error("paintFloraSpecies requires a Canvas2D context");
  if (!species || !form) throw new Error("paintFloraSpecies requires species and form");
  const generator = FLORA_GENERATORS[form.generator];
  if (!generator) throw new Error(`unknown flora generator: ${form.generator}`);
  const normalized = {
    x: 0,
    y: 0,
    s: 1,
    seed: frame.seed ?? floraSeed(frame.x ?? 0, frame.y ?? 0),
    ...frame,
  };
  generator(g, species, form, normalized);
}

/** Paint a species from the complete unsaved document — the editor entrypoint. */
export function paintFloraPreview(g, registry, speciesId, options = {}) {
  const species = registry?.species?.[speciesId];
  if (!species) throw new Error(`unknown flora species: ${speciesId}`);
  const form = registry?.forms?.[species.form];
  if (!form) throw new Error(`unknown flora form: ${species.form}`);
  paintFloraSpecies(g, species, form, options);
}
