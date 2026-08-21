// LOS SISTEMAS VISUALES QUE NECESITAN UN ESCENARIO.
//
// Un árbol o un edificio se puede previsualizar alrededor de su ancla. El mar,
// la lluvia, un faro, la estela de un vehículo y una intersección no: necesitan
// tiempo, viewport, velocidad o paths. Antes esa diferencia dejaba dos malas
// opciones al editor: no mostrarlos, o reimplementar una imitación que podía
// divergir del juego.
//
// Este módulo es la costura común. Sólo contiene los algoritmos Canvas y recibe
// documentos/estado/paths por argumento; no importa `state`, el mundo, el DOM ni
// un catálogo concreto. Así el runtime le pasa el JSON guardado y el editor el
// JSON todavía sin guardar. Una perilla que se mueve acá mueve el mismo pintor
// que después dibuja el juego.

import { hash01 } from "./primitives.js";

const TAU = Math.PI * 2;
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const waterScratch = new Float64Array(256);

function rgbOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return BLACK;
  if (value.startsWith("#")) {
    const n = parseInt(value.slice(1), 16);
    if (value.length === 4) {
      return [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17];
    }
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const open = value.indexOf("(");
  const close = value.lastIndexOf(")");
  if (open >= 0 && close > open) return value.slice(open + 1, close).split(",").slice(0, 3).map(Number);
  return BLACK;
}

function mixRgb(a, b, k) {
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

export function rgba(rgb, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;
}

/** Derive every sea ink from the active weather material and water.json. */
export function deriveWaterPalette(water, weatherColors) {
  const named = { white: WHITE, black: BLACK };
  const channel = (name) => named[name] || rgbOf(weatherColors[name]);
  const palette = {};
  for (const [name, recipe] of Object.entries(water.derive || {})) {
    if (name.startsWith("_")) continue;
    palette[name] = mixRgb(channel(recipe.from), channel(recipe.toward), recipe.k);
  }
  return palette;
}

function paintCrests(g, cx, cy, radius, t, options, palette) {
  const step = Math.max(12, options.step || 22, (2 * radius) / (waterScratch.length - 2));
  const count = Math.floor((2 * radius) / step) + 2;
  g.save();
  g.translate(cx, cy);
  g.rotate(options.ang);
  g.lineCap = "butt";
  g.lineJoin = "round";
  const offset = -((t * options.speed) % options.len);
  const first = Math.ceil((-radius - offset) / options.len);
  const last = Math.floor((radius - offset) / options.len);
  const sheenWidth = options.len * 0.17;
  const troughWidth = options.len * 0.30;
  const sheen = rgba(palette.sheen, options.sheen);
  const crest = rgba(palette.crest, options.crest);
  const trough = rgba(palette.trough, options.trough);
  for (let k = first; k <= last; k += 1) {
    const y = k * options.len + offset;
    for (let j = 0; j < count; j += 1) {
      const x = -radius + j * step;
      waterScratch[j] = Math.sin(x * 0.0115 + t * 0.9 + k * 1.7) * options.amp
        + Math.sin(x * 0.031 - t * 1.35 + k * 0.6) * options.amp * 0.42;
    }
    if (options.trough > 0.004) {
      g.beginPath();
      for (let j = 0; j < count; j += 1) {
        const x = -radius + j * step;
        const yy = y + waterScratch[j] + options.len * 0.44;
        if (j) g.lineTo(x, yy); else g.moveTo(x, yy);
      }
      g.strokeStyle = trough;
      g.lineWidth = troughWidth;
      g.stroke();
    }
    g.beginPath();
    for (let j = 0; j < count; j += 1) {
      const x = -radius + j * step;
      const yy = y + waterScratch[j];
      if (j) g.lineTo(x, yy); else g.moveTo(x, yy);
    }
    g.strokeStyle = sheen;
    g.lineWidth = sheenWidth;
    g.stroke();
    g.strokeStyle = crest;
    g.lineWidth = 1.4;
    g.stroke();
    if (options.caps > 0.01) {
      g.strokeStyle = rgba(palette.cap, options.caps);
      g.lineWidth = 2.4;
      g.lineCap = "round";
      for (let j = 1; j < count - 1; j += 2) {
        const seed = k * 37.1 + j * 7.3;
        const life = (t * 0.85 + hash01(seed)) % 1;
        if (life > 0.5) continue;
        const x = -radius + j * step;
        const fade = Math.sin((life / 0.5) * Math.PI);
        const half = (5 + hash01(seed * 3.7) * 9) * fade;
        if (half < 1.2) continue;
        g.beginPath();
        g.moveTo(x - half, y + waterScratch[j]);
        g.lineTo(x + half, y + waterScratch[j] + 1.2);
        g.stroke();
      }
      g.lineCap = "butt";
    }
  }
  g.restore();
}

/** The exact open-water swell used by the game, over an arbitrary fixture. */
export function paintWaterSwell(g, box, t, {
  water, weatherColors, weather = "sunny", intensity = 1, shelter = 0,
} = {}) {
  const cfg = water?.swell?.[weather] || water?.swell?.sunny;
  if (!cfg) return;
  const palette = deriveWaterPalette(water, weatherColors);
  const wi = Math.max(0.15, Math.min(2, Number(intensity) || 1));
  const sheltered = Math.max(0, Math.min(1, Number(shelter) || 0));
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w <= 0 || h <= 0) return;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const scale = 1 - 0.55 * sheltered;
  const len = cfg.len * (1 - 0.42 * sheltered);
  const radius = Math.hypot(w, h) / 2 + len;
  const angle = water.direction.swellTurns * TAU;
  paintCrests(g, cx, cy, radius, t, {
    ang: angle,
    len,
    amp: cfg.amp * scale * wi,
    speed: cfg.speed * scale,
    crest: cfg.crest * wi,
    sheen: cfg.sheen * wi,
    trough: cfg.trough * (1 - 0.5 * sheltered),
    caps: cfg.caps * wi * (1 - sheltered),
    step: 22,
  }, palette);
  paintCrests(g, cx, cy, radius, t * 1.21, {
    ang: angle + water.direction.crossOffsetRad,
    len: len * 0.56,
    amp: cfg.amp * 0.45 * scale * wi,
    speed: cfg.speed * 0.62 * scale,
    crest: cfg.crest * 0.5 * wi,
    sheen: cfg.sheen * 0.5 * wi,
    trough: cfg.trough * 0.35,
    caps: 0,
    step: 22 * 0.8,
  }, palette);
}

/** The long current filaments that accompany the swell. */
export function paintWaterCurrents(g, box, t, {
  water, weatherColors, intensity = 1,
} = {}) {
  const palette = deriveWaterPalette(water, weatherColors);
  const wi = Math.max(0.15, Math.min(2, Number(intensity) || 1));
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w <= 0 || h <= 0) return;
  const gap = 150;
  const radius = Math.hypot(w, h) / 2 + gap;
  g.save();
  g.translate((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
  g.rotate(-0.16);
  g.lineCap = "round";
  g.setLineDash([250, 470]);
  g.lineDashOffset = -(t * 8) % 720;
  const drift = Math.sin(t * 0.05) * 22;
  for (let k = Math.ceil(-radius / gap); k <= Math.floor(radius / gap); k += 1) {
    const y = k * gap + drift;
    g.beginPath();
    for (let x = -radius; x <= radius; x += 44) {
      const yy = y + Math.sin(x * 0.0034 + k * 2.1 + t * 0.11) * 15;
      if (x === -radius) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.strokeStyle = rgba(palette.sheen, 0.045 * wi);
    g.lineWidth = 11;
    g.stroke();
    g.strokeStyle = rgba(palette.crest, 0.032 * wi);
    g.lineWidth = 2.6;
    g.stroke();
  }
  g.setLineDash([]);
  g.restore();
}

export function paintTurnWind(g, player, vehicle, t, config, elevationPx = 0) {
  const rate = Math.abs(player.av || 0);
  if (rate < config.minRate) return;
  const direction = Math.sign(player.av);
  const strength = Math.min(1, (rate - config.minRate) / config.rampRate);
  const radius = Math.max(vehicle.w, vehicle.h) * config.radiusK + config.radiusPad;
  g.save();
  g.translate(player.x, player.y - elevationPx);
  g.lineCap = "round";
  for (let i = 0; i < config.arcs; i += 1) {
    const base = player.a + direction * (0.5 + i * 0.7) + t * config.drift * direction;
    const span = config.span + strength * config.spanK;
    g.beginPath();
    g.arc(0, 0, radius + i * config.arcGap, base, base + direction * span, direction < 0);
    g.strokeStyle = `rgba(${config.color},${(config.alpha + strength * config.alphaK).toFixed(3)})`;
    g.lineWidth = config.width;
    g.stroke();
  }
  g.restore();
}

export function paintWake(g, player, vehicle, timeMs, config) {
  const speed = Math.min(1, (player.speed || 0) / config.refSpeed);
  if (speed < config.minSpeed) return;
  const halfLength = vehicle.w / 2;
  const spread = vehicle.h * (config.spread + speed * config.spreadK);
  const length = config.length + speed * config.lengthK;
  g.save();
  g.translate(player.x, player.y);
  g.rotate(player.a);
  g.fillStyle = `rgba(${config.color},${(config.alpha + speed * config.alphaK).toFixed(3)})`;
  g.beginPath();
  g.moveTo(-halfLength, -vehicle.h * config.mouth);
  g.lineTo(-halfLength - length, -spread);
  g.lineTo(-halfLength - length, spread);
  g.lineTo(-halfLength, vehicle.h * config.mouth);
  g.closePath();
  g.fill();
  g.fillStyle = `rgba(${config.color},${(config.churnAlpha + speed * config.churnAlphaK).toFixed(3)})`;
  const phase = timeMs * config.churnRate;
  for (let i = 0; i < config.churn; i += 1) {
    const distance = config.churnLead + i * config.churnGap + (phase % config.churnGap);
    g.beginPath();
    g.arc(-halfLength - distance,
      Math.sin(phase + i * config.churnPhase) * vehicle.h * config.churnSpread,
      config.churnR - i * config.churnTaper, 0, TAU);
    g.fill();
  }
  g.restore();
}

export function paintHeadlights(g, halfWidth, halfHeight, config) {
  const reach = halfWidth + config.beam;
  const halfBeam = Math.tan(config.spread) * config.beam;
  const gradient = g.createLinearGradient(halfWidth, 0, reach, 0);
  gradient.addColorStop(0, `rgba(${config.color},${config.alpha})`);
  gradient.addColorStop(1, `rgba(${config.color},0)`);
  g.fillStyle = gradient;
  for (const side of [-1, 1]) {
    const y0 = side * halfHeight * 0.55;
    g.beginPath();
    g.moveTo(halfWidth - 1, y0);
    g.lineTo(reach, y0 - halfBeam * 0.5);
    g.lineTo(reach, y0 + halfBeam * 0.5);
    g.closePath();
    g.fill();
  }
  g.fillStyle = `rgba(${config.color},${config.lampAlpha})`;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(halfWidth - 1, side * halfHeight * 0.55, config.lampR, 0, TAU);
    g.fill();
  }
  g.fillStyle = `rgba(${config.tailColor},${config.tailAlpha})`;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(-halfWidth + 1, side * halfHeight * 0.55, config.lampR * 0.85, 0, TAU);
    g.fill();
  }
}

export function paintVehicleShadow(g, player, vehicle, config, elevationPx, trace) {
  g.save();
  g.translate(
    player.x + config.offX + elevationPx * config.liftX,
    player.y + config.offY + elevationPx * config.liftY,
  );
  g.rotate(player.a);
  const alpha = Math.max(0, config.alpha - elevationPx * config.liftFade);
  g.fillStyle = `rgba(${config.color},${alpha.toFixed(3)})`;
  trace(g, vehicle);
  g.fill();
  g.restore();
}

export function applyVehicleHeel(g, player, vehicle, timeMs, config) {
  const heel = Math.max(-1, Math.min(1, (player.av || 0) / config.maxRate));
  const swell = Math.sin(timeMs * config.swellRate
    + (player.x + player.y) * config.swellSpace);
  g.translate(0, heel * vehicle.h * config.shift + swell * config.swellShift);
  g.scale(1, 1 - Math.abs(heel) * config.squash + swell * config.swellSquash);
}

export function paintSpeedLines(g, width, height, config, speed = Infinity, random = Math.random) {
  if (speed <= config.minSpeed) return;
  g.strokeStyle = `rgba(${config.color},${config.alpha})`;
  g.lineWidth = config.width;
  const edge = config.edge === "left" ? config.margin : width - config.margin;
  const direction = config.edge === "left" ? 1 : -1;
  for (let i = 0; i < config.count; i += 1) {
    const y = random() * height;
    const length = config.length + random() * config.lengthSpread;
    g.beginPath();
    g.moveTo(edge + direction * length, y);
    g.lineTo(edge, y);
    g.stroke();
  }
}

/** Paint a light body + optional halo. `paintPartsAt` is the real interpreter. */
export function paintLuminaire(g, lights, type, x, y, opts, paintPartsAt) {
  const spec = lights.types[type] || lights.types.warm;
  const limits = lights.limits;
  const intensity = Math.max(0, Math.min(limits.intensityMax, Number(opts?.intensity) || 1));
  const radius = Math.max(limits.radiusMin,
    Math.min(limits.radiusMax, Number(opts?.radius) || spec.radius));
  paintPartsAt(spec.parts, x, y, spec);
  if (!opts?.night || intensity <= 0) return;
  const [hx, hy] = spec.haloAt;
  const halo = g.createRadialGradient(x + hx, y + hy, 0, x + hx, y + hy, radius);
  halo.addColorStop(0, rgba(spec.halo,
    Math.min(lights.haloAlpha.max, intensity * lights.haloAlpha.perUnit)));
  halo.addColorStop(1, rgba(spec.halo, 0));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(x + hx, y + hy, radius, 0, TAU);
  g.fill();
}

export function paintLightPoolMask(g, lights, radius) {
  const gradient = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  for (const [offset, alpha] of lights.poolMask.stops) {
    gradient.addColorStop(offset, rgba(lights.poolMask.rgb, alpha));
  }
  g.fillStyle = gradient;
  g.fillRect(0, 0, radius * 2, radius * 2);
}

export function paintLightWarmPool(g, lights, spec, x, y, radius) {
  const gradient = g.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgba(spec.halo, lights.poolMask.warmAlpha));
  gradient.addColorStop(1, rgba(spec.halo, 0));
  g.fillStyle = gradient;
  g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/**
 * LO QUE REVIENTA EN EL PARABRISAS.
 *
 * La lluvia eran RAYAS y nada más, y una raya no moja. Lo que hace leer un
 * aguacero es la gota que estalla encima de uno y se queda un momento
 * corriéndose por el vidrio — por eso esto vive en el espacio de la CÁMARA y no
 * del mundo: es agua sobre el parabrisas, no sobre el suelo.
 *
 * Cada gota tiene su propia vida dentro de un ciclo, sacada de `hash01` y no de
 * `Math.random`, así que el mismo instante dibuja el mismo cuadro y el vidrio no
 * hierve.
 */
export function paintRainSplash(g, width, height, t, spec, intensity = 1) {
  const force = Math.max(0.1, Math.min(2, Number(intensity) || 1));
  const drops = Math.round(spec.drops + spec.dropsPerIntensity * force);
  const life = spec.life;
  for (let i = 0; i < drops; i += 1) {
    // …cada gota en su propia fase del ciclo, para que no revienten todas a la vez
    const seed = i * 2.399;
    const phase = (t / life + hash01(seed)) % 1;
    const x = hash01(seed + 11.3) * width;
    const y = hash01(seed + 27.7) * height;
    // nace de golpe y se apaga: `1 - phase` al cuadrado se lee como evaporarse
    const fade = (1 - phase) * (1 - phase);
    const r = spec.rMin + (spec.rMax - spec.rMin) * hash01(seed + 5.1);
    const run = phase * spec.streak;          // se corre hacia abajo mientras vive
    g.fillStyle = rgba(spec.rgb, spec.alpha * fade * Math.min(1, force));
    g.beginPath();
    g.ellipse(x, y + run, r * (1 - phase * 0.35), r, 0, 0, TAU);
    g.fill();
  }
}

export function paintRain(g, width, height, t, rain, intensity = 1) {
  const force = Math.max(0.1, Math.min(2, Number(intensity) || 1));
  const alpha = Math.min(rain.alphaCap,
    rain.alphaBase + force * rain.alphaPerIntensity);
  g.strokeStyle = rgba(rain.rgb, alpha);
  g.lineWidth = force > rain.thickAt ? rain.thickWidth : rain.thinWidth;
  const drops = Math.round(rain.dropsPerIntensity * force);
  const length = rain.lengthBase + force * rain.lengthPerIntensity;
  for (let i = 0; i < drops; i += 1) {
    const x = (i * rain.xStride + t * (rain.xSpeedBase + force * rain.xSpeedPerIntensity)) % width;
    const y = (i * rain.yStride + t * (rain.ySpeedBase + force * rain.ySpeedPerIntensity)) % height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - length * rain.slant, y + length);
    g.stroke();
  }
}

export function paintGullBlind(g, width, height, t, gull, secondsLeft) {
  if (!(secondsLeft > 0)) return;
  const strength = Math.min(1, secondsLeft / gull.duration);
  const pass = 1 - strength;
  g.save();
  g.fillStyle = rgba(gull.shadowRgb, gull.shadowAlpha * strength);
  g.fillRect(0, 0, width, height);
  g.strokeStyle = rgba(gull.wingRgb, gull.wingAlphaBase + strength * gull.wingAlphaRange);
  g.lineCap = "round";
  const count = gull.countBase + Math.round(strength * gull.countRange);
  for (let i = 0; i < count; i += 1) {
    const h1 = hash01(i * 12.9898 + 1.7);
    const h2 = hash01(i * 78.233 + 4.1);
    const progress = pass + h1 * 0.6;
    const x = (h1 * 1.3 - 0.15 + progress * 0.7) * width;
    const y = (h2 * 1.3 - 0.2 - progress * 0.45) * height;
    const size = gull.sizeBase + h2 * gull.sizeRange;
    const flap = Math.sin(t * gull.flapSpeed + i * 1.7) * size * gull.flapScale;
    g.lineWidth = gull.lineWidthBase + h1 * gull.lineWidthRange;
    g.beginPath();
    g.moveTo(x - size, y + flap);
    g.quadraticCurveTo(x - size * 0.42, y - size * 0.34 + flap, x, y);
    g.quadraticCurveTo(x + size * 0.42, y - size * 0.34 + flap, x + size, y + flap);
    g.stroke();
  }
  g.restore();
}

export function paintNightVignette(g, width, height, vignette) {
  const gradient = g.createRadialGradient(
    width / 2, height / 2, height * 0.15,
    width / 2, height / 2, height * 0.8,
  );
  gradient.addColorStop(0, vignette.inner);
  gradient.addColorStop(1, vignette.outer);
  g.fillStyle = gradient;
  g.fillRect(0, 0, width, height);
}

export function paintCompassDial(g, compass, x, y, angle, mode = "idle") {
  g.save();
  g.fillStyle = compass.panel;
  g.beginPath();
  g.arc(x, y, compass.radius, 0, TAU);
  g.fill();
  g.strokeStyle = compass.ring;
  g.lineWidth = 1;
  g.stroke();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = compass.needle[mode] || compass.needle.idle;
  g.beginPath();
  const points = compass.needle.points;
  points.forEach(([px, py], index) => {
    if (index) g.lineTo(px, py); else g.moveTo(px, py);
  });
  g.closePath();
  g.fill();
  g.strokeStyle = compass.outline;
  g.lineWidth = compass.needle.outlineWidth;
  g.stroke();
  g.restore();
}

export function paintMinimapFixture(g, minimap, x, y, angle, drawWorld) {
  const radius = minimap.radius;
  g.save();
  g.beginPath();
  g.arc(x, y, radius, 0, TAU);
  g.fillStyle = minimap.panel;
  g.fill();
  g.clip();
  drawWorld?.(g, x, y, radius, minimap.range);
  g.restore();
  paintMinimapPlayer(g, minimap, x, y, angle);
  paintMinimapRim(g, minimap, x, y);
}

export function paintMinimapPlayer(g, minimap, x, y, angle) {
  g.save();
  g.translate(x, y);
  g.rotate(angle + Math.PI / 2);
  g.fillStyle = minimap.player;
  g.strokeStyle = minimap.playerRing;
  g.lineWidth = minimap.playerOutlineWidth;
  g.beginPath();
  minimap.playerPoints.forEach(([px, py], index) => {
    if (index) g.lineTo(px, py); else g.moveTo(px, py);
  });
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

export function paintMinimapRim(g, minimap, x, y) {
  const radius = minimap.radius;
  g.strokeStyle = minimap.viewport;
  g.lineWidth = minimap.rimWidth;
  g.beginPath();
  g.arc(x, y, radius, 0, TAU);
  g.stroke();
}

function endpointDiscs(g, road, color, radius) {
  const points = road.pts;
  const last = points.length;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(points[0] + radius, points[1]);
  g.arc(points[0], points[1], radius, 0, TAU);
  g.moveTo(points[last - 2] + radius, points[last - 1]);
  g.arc(points[last - 2], points[last - 1], radius, 0, TAU);
  g.fill();
}

/** The game's complete multi-pass road/intersection ribbon. */
export function paintRoadNetwork(g, roads, {
  materials, sidewalkPx, canoPx, pathFor, dashPathFor,
  beforeAcera, afterAcera,
} = {}) {
  const street = materials.street;
  const roadway = materials.streets.roadway;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = roadway.casing;
  for (const road of roads) {
    if (!road.elev) continue;
    g.save();
    g.translate(0, 3.5);
    g.lineWidth = road.w + 2 * sidewalkPx + 3;
    g.stroke(pathFor(road));
    g.restore();
  }
  beforeAcera?.();
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = street.acera;
  for (const road of roads) {
    if (road.bridge || road.cls === "bridge") continue;
    g.lineWidth = road.w + 2 * sidewalkPx;
    g.stroke(pathFor(road));
  }
  for (const road of roads) {
    if (road.bridge || road.cls === "bridge") continue;
    endpointDiscs(g, road, street.acera, road.w / 2 + sidewalkPx);
  }
  afterAcera?.();
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = roadway.kerbLine;
  for (const road of roads) {
    if (!road.barro && !road.gravel) continue;
    g.lineWidth = road.w + 2 * sidewalkPx;
    g.stroke(pathFor(road));
  }
  g.strokeStyle = roadway.kerbFace;
  for (const road of roads) {
    if (!road.bridge) continue;
    g.lineWidth = road.w + 10;
    g.stroke(pathFor(road));
  }
  g.lineCap = "butt";
  g.strokeStyle = roadway.cano;
  for (const road of roads) {
    g.lineWidth = road.w + 4;
    g.stroke(pathFor(road));
  }
  g.strokeStyle = street.cano;
  for (const road of roads) {
    if (road.bridge || road.cls === "bridge" || road.barro || road.gravel) continue;
    g.lineWidth = road.w + 2 * canoPx;
    g.stroke(pathFor(road));
  }
  for (const road of roads) {
    // UNA CALLE PEATONAL NO ES ASFALTO. `Surface.BOULEVARD` sólo salía de una
    // parcela, así que el Bulevar de la Catedral se dibujaba en piedra y el de
    // la Casa de la Cultura —el mismo bulevar, pero emitido como CALLE— salía
    // negro justo al lado. El build ya lo estampa transitable-pero-lento; lo
    // que faltaba era que se viera.
    const color = road.barro ? roadway.barro : road.gravel ? roadway.gravel
      : road.cls === "paseo" ? roadway.paseo
      : road.cls === "pedestrian" ? roadway.boulevard : roadway.asphalt;
    g.strokeStyle = color;
    g.lineWidth = road.w;
    g.stroke(pathFor(road));
    endpointDiscs(g, road, color, road.w / 2 - 0.4);
  }
  for (const road of roads) {
    if (road.barro || road.gravel) continue;
    const major = ["trunk", "trunk_link", "primary", "primary_link"].includes(road.cls);
    const minor = ["secondary", "tertiary", "tertiary_link", "residential", "unclassified"].includes(road.cls);
    if (!major && !minor) continue;
    g.strokeStyle = major ? street.majorDash : street.minorDash;
    g.lineWidth = major ? 2 : 1;
    g.setLineDash(major ? [18, 18] : [6, 10]);
    const path = dashPathFor(road);
    if (path) g.stroke(path);
    g.setLineDash([]);
  }
  g.lineCap = "butt";
}

/** The clipped baldosa mosaic shared by the real malecón and its fixture. */
export function paintMaleconPattern(g, band, view, colors, path, tileSize = 14) {
  const angle = band.ang || 0;
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const cx = (band.x0 + band.x1) / 2;
  const cy = (band.y0 + band.y1) / 2;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, y] of [[view.x0, view.y0], [view.x1, view.y0],
    [view.x0, view.y1], [view.x1, view.y1]]) {
    const dx = x - cx;
    const dy = y - cy;
    const u = dx * ca - dy * sa;
    const v = dx * sa + dy * ca;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  u0 = Math.floor(u0 / tileSize) * tileSize;
  v0 = Math.floor(v0 / tileSize) * tileSize;
  g.save();
  g.clip(path, "evenodd");
  g.translate(cx, cy);
  g.rotate(angle);
  g.strokeStyle = colors.joint;
  g.lineWidth = 1;
  g.beginPath();
  for (let u = u0; u <= u1 + tileSize; u += tileSize) {
    g.moveTo(u, v0);
    g.lineTo(u, v1 + tileSize);
  }
  for (let v = v0; v <= v1 + tileSize; v += tileSize) {
    g.moveTo(u0, v);
    g.lineTo(u1 + tileSize, v);
  }
  g.stroke();
  g.fillStyle = colors.inlay;
  for (let v = v0; v <= v1 + tileSize; v += tileSize) {
    for (let u = u0; u <= u1 + tileSize; u += tileSize) {
      if (hash01(u * 0.37 + v * 0.11) > 0.88) {
        g.fillRect(u + 1, v + 1, tileSize - 2, tileSize - 2);
      }
    }
  }
  g.restore();
}
