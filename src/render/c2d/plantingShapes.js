// LAS SIEMBRAS — el intérprete geométrico compartido por juego y editor.
//
// La especie vive en flora.json y un árbol individual vive en el mundo. Entre
// ambos faltaba el objeto que una persona realmente diseña: el cantero. Este
// módulo ejecuta el lenguaje finito `form × align` del mismo JSON y devuelve
// posiciones; no conoce el DOM, el estado global, el raster ni un color.
//
// Dos runtimes lo consumen:
//   * el editor dibuja estas posiciones inmediatamente, con el documento aún
//     sin guardar;
//   * el builder Python refleja el mismo contrato al emitir árboles y estampar
//     CLS_ACERA cuando `blocks` es verdadero.
//
// Los METROS entran como propiedades y `pxPerM` es del llamador. Eso mantiene
// la receta válida cuando cambie la escala del mundo.

import { hash01 } from './primitives.js';

export const PLANTING_FORM_NAMES = Object.freeze([
  'strip', 'disc', 'triangle', 'square', 'free',
]);
export const PLANTING_ALIGN_NAMES = Object.freeze([
  'street', 'horizontal', 'vertical', 'free',
]);
export const DERIVED_PLANTING_STRATEGY_NAMES = Object.freeze([
  'paseo-crossing-runs',
  'leon-corner-window',
  'elevated-road-shoulder',
  'divided-avenue-midline',
]);

// A derived strategy is an engine verb, so its required arguments belong beside
// that verb rather than in a second editor-only schema. The authored VALUES stay
// in flora.json; this only says which values the finite interpreter needs.
export const DERIVED_PLANTING_STRATEGY_CONTRACTS = Object.freeze({
  'paseo-crossing-runs': Object.freeze({
    form: 'strip', align: 'street', treeKind: 'palm', blocks: true,
    strings: Object.freeze(['streetName']),
    positiveM: Object.freeze([
      'widthM', 'collisionPadM', 'spacingM', 'endMarginM', 'sampleStepM',
      'minimumRunM', 'gapMarginM',
    ]),
    vectorsM: Object.freeze(['anchorOffsetM']),
  }),
  'leon-corner-window': Object.freeze({
    form: 'strip', align: 'street', treeKind: 'tree', blocks: true,
    strings: Object.freeze(['streetName']),
    positiveM: Object.freeze([
      'widthM', 'collisionPadM', 'spacingM', 'endMarginM', 'sampleStepM',
      'cornerProbeStepM', 'cornerSearchM', 'stopClearM',
    ]),
  }),
  'elevated-road-shoulder': Object.freeze({
    form: 'strip', align: 'street', treeKind: 'tree', blocks: false,
    strings: Object.freeze(['streetSelector']),
    enums: Object.freeze({ side: Object.freeze(['north', 'south']) }),
    positiveM: Object.freeze([
      'widthM', 'spacingM', 'roadEdgeOffsetM', 'crossingRadiusM',
    ]),
  }),
  'divided-avenue-midline': Object.freeze({
    form: 'strip', align: 'street', treeKind: 'tree', blocks: false,
    stringLists: Object.freeze({ streetNames: 2 }),
    positiveM: Object.freeze([
      'widthM', 'spacingM', 'sampleStepM', 'matchToleranceM', 'maxSeparationM',
    ]),
  }),
});

const MAX_PLANTS = 20000;

function pointsOf(feature) {
  const geometry = feature?.geometry || {};
  if (geometry.kind === 'point') return geometry.point ? [geometry.point] : [];
  return Array.isArray(geometry.points) ? geometry.points : [];
}

function centroid(points) {
  if (!points.length) return [0, 0];
  const [x, y] = points.reduce(([sx, sy], point) =>
    [sx + point[0], sy + point[1]], [0, 0]);
  return [x / points.length, y / points.length];
}

function lineLength(points) {
  let length = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    length += Math.hypot(points[i + 1][0] - points[i][0],
      points[i + 1][1] - points[i][1]);
  }
  return length;
}

function alignedLine(points, align) {
  if (!['horizontal', 'vertical'].includes(align) || points.length < 2) return points;
  const [cx, cy] = centroid(points);
  const half = lineLength(points) / 2;
  return align === 'horizontal'
    ? [[cx - half, cy], [cx + half, cy]]
    : [[cx, cy - half], [cx, cy + half]];
}

function roadPoints(road) {
  const source = road?.geometry?.points || road?.points || road?.pts || [];
  if (!source.length) return [];
  if (Array.isArray(source[0])) return source;
  const out = [];
  for (let index = 0; index < source.length - 1; index += 2) {
    out.push([source[index], source[index + 1]]);
  }
  return out;
}

function nearestOnSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2
    ? Math.max(0, Math.min(1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
    : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}

function streetLine(points, properties, roads) {
  const wanted = String(properties.streetName || '').trim().toLowerCase();
  if (!wanted || points.length < 2 || !roads?.length) return points;
  const segments = [];
  for (const road of roads) {
    const name = String(road?.name || road?.properties?.name
      || road?.source?.name || '').toLowerCase();
    if (!name.includes(wanted)) continue;
    const path = roadPoints(road);
    for (let index = 0; index < path.length - 1; index += 1) {
      segments.push([path[index], path[index + 1]]);
    }
  }
  if (!segments.length) return points;
  const samples = sampleLine(points,
    Math.max(1, Number(properties.sampleStepPx) || 4));
  const snapped = [];
  for (const sample of samples) {
    const point = [sample.x, sample.y];
    let best = null;
    let bestDistance = Infinity;
    for (const [a, b] of segments) {
      const candidate = nearestOnSegment(point, a, b);
      const distance = (candidate[0] - point[0]) ** 2
        + (candidate[1] - point[1]) ** 2;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best && (!snapped.length
        || Math.hypot(best[0] - snapped.at(-1)[0], best[1] - snapped.at(-1)[1]) > 0.1)) {
      snapped.push(best);
    }
  }
  return snapped.length >= 2 ? snapped : points;
}

function sampleLine(points, spacing) {
  const out = [];
  let next = 0;
  let walked = 0;
  for (let index = 0; index < points.length - 1 && out.length < MAX_PLANTS; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    while (next <= walked + length + 1e-9 && out.length < MAX_PLANTS) {
      const t = Math.max(0, Math.min(1, (next - walked) / length));
      out.push({ x: a[0] + dx * t, y: a[1] + dy * t,
        tx: dx / length, ty: dy / length });
      next += spacing;
    }
    walked += length;
  }
  if (!out.length && points.length) {
    const point = points[0];
    out.push({ x: point[0], y: point[1], tx: 1, ty: 0 });
  }
  return out;
}

function inside(point, polygon) {
  const [x, y] = point;
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y)
        && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) yes = !yes;
  }
  return yes;
}

function basisAngle(points, align) {
  if (align === 'horizontal') return 0;
  if (align === 'vertical') return Math.PI / 2;
  if (points.length > 1) {
    return Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]);
  }
  return 0;
}

function lattice(polygon, spacing, angle, accept = () => true) {
  const centre = centroid(polygon);
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const local = polygon.map(([x, y]) => {
    const dx = x - centre[0];
    const dy = y - centre[1];
    return [dx * ca - dy * sa, dx * sa + dy * ca];
  });
  const xs = local.map((point) => point[0]);
  const ys = local.map((point) => point[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const forwardCa = Math.cos(angle);
  const forwardSa = Math.sin(angle);
  const out = [];
  const x0 = Math.ceil(minX / spacing);
  const x1 = Math.floor(maxX / spacing);
  const y0 = Math.ceil(minY / spacing);
  const y1 = Math.floor(maxY / spacing);
  for (let gy = y0; gy <= y1 && out.length < MAX_PLANTS; gy += 1) {
    for (let gx = x0; gx <= x1 && out.length < MAX_PLANTS; gx += 1) {
      const lx = gx * spacing;
      const ly = gy * spacing;
      const point = [
        centre[0] + lx * forwardCa - ly * forwardSa,
        centre[1] + lx * forwardSa + ly * forwardCa,
      ];
      if (inside(point, polygon) && accept(point)) out.push({ x: point[0], y: point[1] });
    }
  }
  if (!out.length && inside(centre, polygon) && accept(centre)) {
    out.push({ x: centre[0], y: centre[1] });
  }
  return out;
}

function mixRows(flora, mixId) {
  const mix = flora?.plantings?.[mixId] || flora?.mixes?.[mixId]
    || flora?.mangroveMixes?.[mixId];
  const source = mix?.weights || mix?.species || [];
  if (Array.isArray(source)) {
    return source.map((row) => Array.isArray(row)
      ? [row[0], Number(row[1] ?? 1)]
      : [row?.species || row, Number(row?.weight ?? 1)])
      .filter(([id, weight]) => flora?.species?.[id] && weight > 0);
  }
  return Object.entries(source).map(([id, weight]) => [id, Number(weight)])
    .filter(([id, weight]) => flora?.species?.[id] && weight > 0);
}

export function plantingSpecies(flora, mixId, x, y, fallback) {
  const rows = mixRows(flora, mixId);
  if (!rows.length) return fallback || flora?.defaults?.treeSpecies;
  let roll = hash01(x * 12.9898 + y * 78.233) * rows.reduce((sum, row) => sum + row[1], 0);
  for (const [id, weight] of rows) {
    roll -= weight;
    if (roll <= 0) return id;
  }
  return rows.at(-1)[0];
}

export function resolvePlanting(feature, flora, pxPerM = 1, roads = []) {
  const defaults = flora?.plantingSchema?.defaults || {};
  const properties = { ...defaults, ...(feature?.properties || {}) };
  const form = properties.form || 'strip';
  const align = properties.align || 'free';
  let points = pointsOf(feature);
  if (form === 'strip') {
    points = alignedLine(points, align);
    if (align === 'street') {
      properties.sampleStepPx = Number(properties.sampleStepM || 1.6) * pxPerM;
      points = streetLine(points, properties, roads);
    }
  }
  return {
    ...properties,
    form,
    align,
    widthPx: Math.max(0.1, Number(properties.widthM ?? defaults.widthM ?? 4) * pxPerM),
    radiusPx: Math.max(0.1, Number(properties.radiusM ?? defaults.radiusM ?? 8) * pxPerM),
    spacingPx: Math.max(0.1, Number(properties.spacingM ?? defaults.spacingM ?? 10.4) * pxPerM),
    points,
  };
}

/** Return deterministic plants for one authored bed. */
export function plantingPlacements(feature, flora, pxPerM = 1, roads = []) {
  const spec = resolvePlanting(feature, flora, pxPerM, roads);
  let placements = [];
  if (spec.form === 'strip') {
    const samples = sampleLine(spec.points, spec.spacingPx);
    const rows = Math.max(1, Math.floor(spec.widthPx / spec.spacingPx));
    for (const sample of samples) {
      for (let row = 0; row < rows; row += 1) {
        const offset = (row - (rows - 1) / 2) * spec.spacingPx;
        placements.push({ x: sample.x - sample.ty * offset,
          y: sample.y + sample.tx * offset });
        if (placements.length >= MAX_PLANTS) break;
      }
      if (placements.length >= MAX_PLANTS) break;
    }
  } else if (spec.form === 'disc') {
    const centre = spec.points[0] || [0, 0];
    const polygon = [];
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      polygon.push([centre[0] + Math.cos(angle) * spec.radiusPx,
        centre[1] + Math.sin(angle) * spec.radiusPx]);
    }
    placements = lattice(polygon, spec.spacingPx, basisAngle(spec.points, spec.align),
      ([x, y]) => Math.hypot(x - centre[0], y - centre[1]) <= spec.radiusPx);
  } else {
    placements = lattice(spec.points, spec.spacingPx,
      basisAngle(spec.points, spec.align));
  }
  const scaleRange = Array.isArray(spec.scale) ? spec.scale : [Number(spec.scale) || 1, Number(spec.scale) || 1];
  return placements.map(({ x, y }) => ({
    x, y,
    speciesId: plantingSpecies(flora, spec.mix, x, y,
      spec.treeKind === 'palm' ? flora?.defaults?.palmSpecies : flora?.defaults?.treeSpecies),
    scale: scaleRange[0] + hash01(x * 4.137 + y * 9.731) * (scaleRange[1] - scaleRange[0]),
  }));
}
