import FLAGS from "../../assets/cruise-flags.json";

const poly = (ink, ...points) => ({ ink, points });
const rect = (ink, x = 0, y = 0, w = 1, h = 1) =>
  poly(ink, [x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const bands = (colors, vertical = false) => colors.map((ink, i) => {
  const step = 1 / colors.length;
  return vertical ? rect(ink, i * step, 0, step, 1) : rect(ink, 0, i * step, 1, step);
});
const circle = (ink, x, y, r) => poly(ink, ...Array.from({ length: 24 }, (_, i) => {
  const angle = i * Math.PI / 12;
  return [x + Math.cos(angle) * r, y + Math.sin(angle) * r * 1.7];
}));
const star = (ink, x, y, r, points = 5) => poly(ink, ...Array.from({ length: points * 2 }, (_, i) => {
  const angle = i * Math.PI / points - Math.PI / 2;
  const radius = i % 2 ? r * 0.42 : r;
  return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 1.7];
}));

const shapes = { rect, bands, poly: (ink, points) => poly(ink, ...points), circle, star };
export const CRUISE_FLAGS = Object.fromEntries(Object.entries(FLAGS.countries).map(([country, artwork]) =>
  [country, artwork.flatMap(([shape, ...args]) => shapes[shape](...args))]
));

const outline = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function traceFlagShape(ctx, project, segments, points = outline) {
  ctx.beginPath();
  ctx.moveTo(...project(...points[0]));
  for (let i = 0; i < points.length; i++) {
    const [u, v] = points[i], [u2, v2] = points[(i + 1) % points.length];
    const steps = Math.max(1, Math.ceil(Math.abs(u2 - u) * segments));
    for (let step = 1; step <= steps; step++) {
      const f = step / steps;
      ctx.lineTo(...project(u + (u2 - u) * f, v + (v2 - v) * f));
    }
  }
  ctx.closePath();
}
