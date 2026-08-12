// LA FERIA DEL PASEO — drawn from a catalog, not from thirteen functions.
//
// The world says WHERE each ride stands (`manifest.attractions`, seated inside
// the campo ferial by `service/attraction.py`); `feriaAssets.json` says WHAT IT
// LOOKS LIKE; and this file is the small interpreter between them. That split
// is the point, and it is the same one the repo already makes for the design
// tokens and the i18n catalogs: the art is the part a person is going to want
// to change, and changing it should not mean editing a render function. An
// engine or the world editor can read the JSON, build a form from it, draw a
// preview and write it back — none of which is possible against a switch
// statement full of `ctx.arc`.
//
// A kind is a list of PARTS, drawn from the ride's centre outward in order, in
// the ride's own frame. Lengths are fractions of `r` unless the field ends in
// `Px`. A part may carry ONE animation — `spin` (turns/sec), `swing` (a
// pendulum about the centre) or `bob` — because a ride that does two things at
// once reads as a glitch at this scale.
//
// Everything here is DRAWN, NEVER STAMPED. The ground under it is the campo
// ferial's packed earth and that is what the car interacts with; a ride is
// scenery you drive around, like a vendor's cart or a parada.
import { WORLD2D as W } from "../../world2d/index.js";
import { ctx, hash01, label, roundRect } from "./gfx.js";
import ASSETS from "./feriaAssets.json";

const TAU = Math.PI * 2;

// Deterministic per-ride phase, so two chocones do not pulse in lockstep and
// nothing shimmers between frames.
function phaseOf(A) { return hash01(A.x * 0.013 + A.y * 0.017) * TAU; }

function pick(palette, i) {
  if (!palette || !palette.length) return "#dfe5ec";
  return palette[i % palette.length];
}

// ---- the shapes ------------------------------------------------------------
// Each takes (part, r, t, ph) with the canvas already translated to the ride's
// centre and rotated into its frame; `r` is the ride's radius in px.

const SHAPES = {
  disc(p, r) {
    ctx.fillStyle = p.fill || "#dfe5ec";
    ctx.beginPath();
    ctx.arc(0, p.dyPx || 0, (p.r || 1) * r, 0, TAU);
    ctx.fill();
  },

  ring(p, r) {
    ctx.strokeStyle = p.stroke || "#dfe5ec";
    ctx.lineWidth = p.widthPx || 2;
    ctx.beginPath();
    ctx.arc(0, p.dyPx || 0, (p.r || 1) * r, 0, TAU);
    ctx.stroke();
  },

  spokes(p, r) {
    ctx.strokeStyle = p.stroke || "#b6bdc7";
    ctx.lineWidth = p.widthPx || 1.5;
    const n = p.n || 8, r0 = (p.r0 || 0) * r, r1 = (p.r1 || 1) * r, dy = p.dyPx || 0;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.moveTo(Math.cos(a) * r0, dy + Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, dy + Math.sin(a) * r1);
    }
    ctx.stroke();
  },

  // arms with a car on the end — el pulpo, las sillas, los caballitos
  arms(p, r) {
    const n = p.n || 8, len = (p.r || 1) * r;
    ctx.strokeStyle = p.stroke || "#c7ccd3";
    ctx.lineWidth = p.widthPx || 3;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    }
    ctx.stroke();
    if (!p.cap) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.fillStyle = pick(p.cap.palette, i);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * len, Math.sin(a) * len, p.cap.radiusPx || 4, 0, TAU);
      ctx.fill();
    }
  },

  // boxes round a circle — gondolas, the tagada's riders, the gusanito's train
  cabins(p, r, t, ph, A, spec, spinA) {
    const n = p.n || 8, rad = (p.r || 1) * r;
    const w = p.wPx || 8, h = p.hPx || 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      ctx.save();
      ctx.translate(x, y);
      // A GONDOLA HANGS. It stays level however far round the wheel it has got,
      // and the frame is turning under it — so it is counter-rotated by exactly
      // the spin this part was drawn under. Without it the cabins cartwheel with
      // the rim, which is the one thing a Ferris wheel visibly does not do.
      if (p.hang) ctx.rotate(-spinA);
      ctx.fillStyle = pick(p.palette, i);
      roundRect(ctx, -w / 2, -h / 2, w, h, 2, true, false);
      ctx.restore();
    }
  },

  box(p, r) {
    ctx.fillStyle = p.fill || "#3b4250";
    roundRect(ctx, (p.x || 0) * r, (p.y || 0) * r, (p.w || 1) * r, (p.h || 1) * r,
      p.roundPx || 2, true, false);
  },

  legs(p, r) {
    ctx.strokeStyle = p.stroke || "#8d949e";
    ctx.lineWidth = p.widthPx || 4;
    const s = (p.spread || 0.7) * r, d = (p.drop || 0.6) * r;
    ctx.beginPath();
    ctx.moveTo(-s, d); ctx.lineTo(0, 0); ctx.lineTo(s, d);
    ctx.stroke();
  },

  mast(p) {
    ctx.fillStyle = p.fill || "#9aa3ae";
    const w = p.widthPx || 6, h = p.hPx || 26;
    ctx.fillRect(-w / 2, -h, w, h);
  },

  // el martillo: an arm about the centre with a cabin on the end
  pendulum(p, r, t) {
    const sw = p.swing || { amp: 2.6, speed: 0.25 };
    const a = Math.sin(t * sw.speed * TAU + (p.phase || 0)) * sw.amp - Math.PI / 2;
    const len = (p.len || 0.9) * r;
    ctx.strokeStyle = p.stroke || "#c7ccd3";
    ctx.lineWidth = p.widthPx || 5;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
    if (!p.cab) return;
    ctx.save();
    ctx.translate(Math.cos(a) * len, Math.sin(a) * len);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = p.cab.fill || "#e85d75";
    roundRect(ctx, -(p.cab.wPx || 10) / 2, -(p.cab.hPx || 8) / 2,
      p.cab.wPx || 10, p.cab.hPx || 8, 2, true, false);
    ctx.restore();
  },

  dish(p, r) {
    ctx.fillStyle = p.fill || "#2f3a4a";
    ctx.beginPath(); ctx.arc(0, 0, (p.r || 1) * r, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.rim || "#e0483f";
    ctx.lineWidth = p.rimPx || 5;
    ctx.beginPath(); ctx.arc(0, 0, (p.r || 1) * r, 0, TAU); ctx.stroke();
  },

  // el carrusel's striped roof
  canopy(p, r) {
    const n = p.n || 12, rad = (p.r || 1) * r;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = pick(p.palette, i);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, rad, (i / n) * TAU, ((i + 1) / n) * TAU);
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  boat(p, r, t) {
    const sw = p.swing || { amp: 0.7, speed: 0.2 };
    const a = Math.sin(t * sw.speed * TAU) * sw.amp;
    const piv = (p.pivot || 0.9) * r;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, piv);
    const w = (p.w || 1.4) * r, h = (p.h || 0.5) * r;
    ctx.fillStyle = p.fill || "#8a5a35";
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.quadraticCurveTo(0, h * 0.9, w / 2, -h / 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = p.trim || "#f3c969";
    ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  },

  track(p, r) {
    ctx.strokeStyle = p.stroke || "#6a7280";
    ctx.lineWidth = p.widthPx || 5;
    ctx.beginPath(); ctx.arc(0, 0, (p.r || 1) * r, 0, TAU); ctx.stroke();
  },

  facade(p, r) {
    const w = (p.w || 1.6) * r, h = (p.h || 1.1) * r;
    ctx.fillStyle = p.fill || "#3a2a4a";
    roundRect(ctx, -w / 2, -h / 2, w, h, 3, true, false);
    ctx.strokeStyle = p.trim || "#6b2f8f";
    ctx.lineWidth = 2; ctx.stroke();
    if (!p.door) return;
    const dw = (p.door.w || 0.3) * r, dh = (p.door.h || 0.6) * r;
    ctx.fillStyle = p.door.fill || "#0d0a12";
    ctx.fillRect(-dw / 2, h / 2 - dh, dw, dh);
  },

  counter(p, r) {
    const w = (p.w || 1.5) * r, h = (p.h || 0.6) * r, dy = (p.dy || 0) * r;
    ctx.fillStyle = p.fill || "#b8875a";
    roundRect(ctx, -w / 2, dy - h / 2, w, h, 2, true, false);
    ctx.fillStyle = p.top || "#f6e7c8";
    ctx.fillRect(-w / 2, dy - h / 2, w, Math.max(2, h * 0.3));
    // the stainless rail along the front — the bright line under the food
    if (p.trim) {
      ctx.strokeStyle = p.trim;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-w / 2, dy + h / 2 - 1); ctx.lineTo(w / 2, dy + h / 2 - 1);
      ctx.stroke();
    }
  },

  // LA LONA. Seen from above the chinamos' roof is one long blue tarp pitched
  // in gables over each bay — the ridge catches the light, the eaves fall away
  // dark. Drawn as one module so a row of them butts into a continuous roof.
  tarp(p, r) {
    const w = (p.w || 1.8) * r, h = (p.h || 0.8) * r, bays = p.bays || 3;
    ctx.fillStyle = p.eave || "#0e2258";
    roundRect(ctx, -w / 2, -h / 2, w, h, 2, true, false);
    const seg = w / bays;
    for (let i = 0; i < bays; i++) {
      const x0 = -w / 2 + i * seg;
      // each bay: a lit ridge running front-to-back, darker to either side
      const g = ctx.createLinearGradient(x0, 0, x0 + seg, 0);
      g.addColorStop(0, p.eave || "#0e2258");
      g.addColorStop(0.5, p.ridge || "#2f6fc0");
      g.addColorStop(1, p.eave || "#0e2258");
      ctx.fillStyle = g;
      ctx.fillRect(x0 + 1, -h / 2 + 1, seg - 2, h - 2);
      // the gable's front point
      ctx.fillStyle = p.fill || "#17357f";
      ctx.beginPath();
      ctx.moveTo(x0 + 1, h / 2 - 1);
      ctx.lineTo(x0 + seg / 2, h / 2 + h * 0.14);
      ctx.lineTo(x0 + seg - 1, h / 2 - 1);
      ctx.closePath(); ctx.fill();
    }
  },

  // EL ANDAMIO. White scaffold pipe with those bulbous cast joints, which is
  // what makes the row read as built rather than as a tent.
  frame(p, r) {
    const w = (p.w || 1.8) * r, h = (p.h || 0.8) * r, n = p.n || 4;
    ctx.strokeStyle = p.stroke || "#e8ecef";
    ctx.lineWidth = p.widthPx || 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i / (n - 1)) * w;
      ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2 + h * 0.12);
    }
    ctx.moveTo(-w / 2, h / 2); ctx.lineTo(w / 2, h / 2);
    ctx.stroke();
    ctx.fillStyle = p.stroke || "#e8ecef";
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i / (n - 1)) * w;
      ctx.beginPath(); ctx.arc(x, h / 2, p.jointPx || 2.2, 0, TAU); ctx.fill();
    }
  },

  // LOS BANDERINES. The neon pennant line along the front of the row, and the
  // thing that says "feria" from further away than anything else here.
  banderines(p, r, t, ph) {
    const w = (p.w || 2.0) * r, n = p.n || 10, dy = (p.dy || 0.7) * r;
    const s = p.sizePx || 5;
    const seg = w / n;
    ctx.strokeStyle = "rgba(240,244,248,0.7)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-w / 2, dy);
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + i * seg;
      ctx.lineTo(x, dy + Math.sin(i * 0.9 + ph) * 1.2);
    }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * seg;
      const sag = Math.sin(i * 0.9 + ph) * 1.2;
      // they flutter — a slow shear, deterministic per pennant
      const lean = Math.sin(t * 1.6 + i * 0.7 + ph) * 0.28;
      ctx.fillStyle = pick(p.palette, i);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.45, dy + sag);
      ctx.lineTo(x + s * 0.45, dy + sag);
      ctx.lineTo(x + lean * s, dy + sag + s);
      ctx.closePath(); ctx.fill();
    }
  },

  // EL TECHO DE ZINC. Corrugated sheet, dark, ribbed along the row's length,
  // with the eaves catching a little light. From above this is most of the
  // chinamo's footprint and it should read as METAL, not as cloth.
  zinc(p, r) {
    const w = (p.w || 1.9) * r, h = (p.h || 0.8) * r, ribs = p.ribs || 12;
    ctx.fillStyle = p.fill || "#3a3b42";
    roundRect(ctx, -w / 2, -h / 2, w, h, 1.5, true, false);
    ctx.strokeStyle = p.rib || "#4d4f58";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < ribs; i++) {
      const x = -w / 2 + (i / ribs) * w;
      ctx.moveTo(x, -h / 2 + 1); ctx.lineTo(x, h / 2 - 1);
    }
    ctx.stroke();
    ctx.strokeStyle = p.edge || "#24252a";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2); ctx.lineTo(w / 2, h / 2);
    ctx.stroke();
  },

  // LA MANTA IMPRESA — and this is the chinamo, seen from above. A band of
  // printed panels on a dark ground: the product photograph, then the name in
  // saturated ink, repeated down the row. It is the brightest thing in the
  // fairground and the reason you can read the food from across the Paseo.
  banner(p, r, t, ph, A, spec) {
    const food = spec.foods && spec.foods[A.food];
    const w = (p.w || 1.8) * r, h = (p.h || 0.3) * r, dy = (p.dy || 0.35) * r;
    const n = p.panels || 3;
    ctx.fillStyle = p.ground || "#2b1b4d";
    roundRect(ctx, -w / 2, dy - h / 2, w, h, 1.5, true, false);
    const seg = w / n;
    const ink = (food && food.ink) || "#ffd400";
    const accent = (food && food.accent) || "#c8102e";
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + i * seg;
      // the photograph: a block of the food's own colour, bled to the panel edge
      ctx.fillStyle = accent;
      ctx.fillRect(x0 + 1.5, dy - h / 2 + 1.5, seg * 0.42, h - 3);
      // the lettering: two bars of ink, because at this zoom a word IS two bars
      ctx.fillStyle = ink;
      ctx.fillRect(x0 + seg * 0.5, dy - h * 0.28, seg * 0.42, h * 0.2);
      ctx.fillRect(x0 + seg * 0.5, dy + h * 0.04, seg * 0.3, h * 0.16);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-w / 2, dy - h / 2, w, h);
  },

  // EL RÓTULO DE NEÓN. Lit tube lettering over the counter, not a label pill:
  // a glowing bar with the word on it. Kept for the rows that have it — the
  // blue-tarp chinamos on the Paseo do, the printed-banner ones do not.
  neon(p, r, t, ph, A, spec) {
    const food = spec.foods && spec.foods[A.food];
    const col = (food && food.neon) || p.color || "#7dff5a";
    const w = (p.w || 1.4) * r, dy = (p.dy || 0.2) * r;
    const flicker = 0.82 + 0.18 * Math.sin(t * 7 + ph * 3);
    ctx.save();
    ctx.globalAlpha = flicker;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.shadowColor = col; ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(-w / 2, dy); ctx.lineTo(w / 2, dy);
    ctx.stroke();
    ctx.restore();
  },

  // the striped toldo over a chinamo — the thing that makes it a chinamo
  awning(p, r) {
    const w = (p.w || 1.7) * r, h = (p.h || 0.42) * r, n = p.n || 7;
    const seg = w / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = pick(p.stripes, i);
      ctx.beginPath();
      ctx.moveTo(-w / 2 + i * seg, -h);
      ctx.lineTo(-w / 2 + (i + 1) * seg, -h);
      ctx.lineTo(-w / 2 + (i + 1) * seg, 0);
      ctx.lineTo(-w / 2 + i * seg, 0);
      ctx.closePath(); ctx.fill();
    }
    // the scalloped edge
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(-w / 2 + (i + 0.5) * seg, 0, seg * 0.5, 0, Math.PI);
      ctx.fill();
    }
  },

  // what is on the counter: churros standing in their cup, manzanas on sticks
  goods(p, r, t, ph, A, spec) {
    const food = spec.foods && spec.foods[A.food];
    const palette = (food && food.goods) || ["#e8c07a"];
    const n = p.n || 5, w = (p.w || 1.3) * r;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = pick(palette, i);
      ctx.beginPath();
      ctx.arc(-w / 2 + (i + 0.5) * (w / n), -r * 0.36, p.radiusPx || 3, 0, TAU);
      ctx.fill();
    }
  },

  prizes(p, r) {
    const n = p.n || 7, w = (p.w || 1.5) * r;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = pick(p.palette, i);
      ctx.beginPath();
      ctx.arc(-w / 2 + (i + 0.5) * (w / n), -r * 0.5, p.radiusPx || 3.4, 0, TAU);
      ctx.fill();
    }
  },

  cars(p, r, t, ph) {
    const n = p.n || 6, w = (p.areaW || 1.6) * r, h = (p.areaH || 0.9) * r;
    for (let i = 0; i < n; i++) {
      const s = hash01(i * 3.7 + ph) * TAU;
      const x = Math.cos(t * (p.speed || 0.5) + s) * w * 0.4;
      const y = Math.sin(t * (p.speed || 0.5) * 1.3 + s * 1.7) * h * 0.34;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 0.7 + s) * 0.9);
      ctx.fillStyle = pick(p.palette, i);
      roundRect(ctx, -(p.wPx || 9) / 2, -(p.hPx || 6) / 2, p.wPx || 9, p.hPx || 6, 2, true, false);
      ctx.restore();
    }
  },

  speakers(p, r, t) {
    const off = (p.offset || 0.7) * r, w = p.wPx || 7, h = p.hPx || 12;
    const pump = p.pump ? 1 + Math.sin(t * (p.pump.speed || 2) * TAU) * p.pump.amp : 1;
    for (const side of [-1, 1]) {
      ctx.fillStyle = p.fill || "#1d1826";
      roundRect(ctx, side * off - w / 2, -h / 2, w, h, 1.5, true, false);
      ctx.fillStyle = p.cone || "#5a5170";
      ctx.beginPath();
      ctx.arc(side * off, -h * 0.18, w * 0.3 * pump, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.arc(side * off, h * 0.24, w * 0.22 * pump, 0, TAU); ctx.fill();
    }
  },

  // LAS LUCES. A feria at night IS its bulbs, so they are their own shape and
  // they twinkle on a deterministic phase rather than at random.
  bulbs(p, r, t, ph) {
    const n = p.n || 12;
    for (let i = 0; i < n; i++) {
      let x, y;
      if (p.rect) {
        // strung round a rectangle: walk its perimeter
        const w = p.rect.w * r, h = p.rect.h * r;
        const per = (i / n) * (2 * (w + h));
        if (per < w) { x = -w / 2 + per; y = -h / 2; }
        else if (per < w + h) { x = w / 2; y = -h / 2 + (per - w); }
        else if (per < 2 * w + h) { x = w / 2 - (per - w - h); y = h / 2; }
        else { x = -w / 2; y = h / 2 - (per - 2 * w - h); }
      } else {
        const a = (i / n) * TAU;
        x = Math.cos(a) * (p.r || 1) * r;
        y = Math.sin(a) * (p.r || 1) * r;
      }
      const tw = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7 + ph);
      ctx.globalAlpha = tw;
      ctx.fillStyle = pick(p.palette, i);
      ctx.beginPath(); ctx.arc(x, y, p.radiusPx || 1.4, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  sign(p, r, t, ph, A, spec) {
    let text = p.text, fill = p.fill || "#fff", bg = p.bg || "#b3243b";
    if (p.fromFood) {
      const food = spec.foods && spec.foods[A.food];
      if (!food) return;
      text = food.label; fill = food.fill; bg = food.bg;
    }
    if (!text) return;
    label(0, (p.dyPx || -1.4) * r, text, fill, bg);
  },
};

// ---- one attraction --------------------------------------------------------
function drawAttraction(A, t) {
  const spec = ASSETS[A.kind];
  if (!spec || !spec.parts) return;
  const r = A.r || 24;
  const ph = phaseOf(A);
  ctx.save();
  ctx.translate(A.x, A.y);
  // the ground shadow, so nothing floats over the barro
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath(); ctx.ellipse(1, r * 0.28, r * 0.95, r * 0.4, 0, 0, TAU); ctx.fill();
  for (const part of spec.parts) {
    const draw = SHAPES[part.shape];
    if (!draw) {
      // A catalog this file cannot draw is the failure mode of making the art
      // data: someone adds a shape to the JSON (or the editor writes one) and
      // it silently does not appear. Say so, once per shape, and carry on
      // drawing the rest of the ride.
      if (!drawAttraction._warned) drawAttraction._warned = new Set();
      if (!drawAttraction._warned.has(part.shape)) {
        drawAttraction._warned.add(part.shape);
        console.warn(`[feria] no drawer for shape "${part.shape}" (kind ${A.kind})`);
      }
      continue;
    }
    ctx.save();
    const spinA = part.spin ? t * part.spin * TAU + ph : 0;
    if (spinA) ctx.rotate(spinA);
    if (part.bob) ctx.translate(0, Math.sin(t * part.bob.speed * TAU + ph) * part.bob.amp);
    draw(part, r, t, ph, A, spec, spinA);
    ctx.restore();
  }
  ctx.restore();
}

// ---- el campo ferial: the ground itself -------------------------------------
// Packed earth, stamped by the build (`Surface.BARRO`) so the car feels it, and
// drawn here so it READS as a fairground: the tierra, the tyre-worn ring the
// crowd walks, and a rope of bulbs round the whole lot.
function bandPath(F) {
  if (!F._path) {
    const p = new Path2D();
    for (const poly of F.polys || []) {
      if (!poly || poly.length < 6) continue;
      p.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) p.lineTo(poly[i], poly[i + 1]);
      p.closePath();
    }
    F._path = p;
  }
  return F._path;
}

function drawFeriaGround(view, t) {
  const arr = W.FERIA;
  if (!arr || !arr.length) return;
  for (const F of arr) {
    if (F.x1 < view.x0 || F.x0 > view.x1 || F.y1 < view.y0 || F.y0 > view.y1) continue;
    const path = bandPath(F);
    ctx.save();
    ctx.fillStyle = "#a8845c";                      // la tierra del campo ferial
    ctx.fill(path, "evenodd");
    // scuffed patches, deterministic so they never crawl
    ctx.save();
    ctx.clip(path, "evenodd");
    ctx.fillStyle = "rgba(120,92,60,0.35)";
    for (let i = 0; i < 40; i++) {
      const hx = F.x0 + hash01(i * 1.7 + F.x0) * (F.x1 - F.x0);
      const hy = F.y0 + hash01(i * 2.9 + F.y0) * (F.y1 - F.y0);
      ctx.beginPath();
      ctx.ellipse(hx, hy, 10 + hash01(i * 3.1) * 16, 5 + hash01(i * 4.3) * 8,
        hash01(i * 5.7) * Math.PI, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(90,68,44,0.8)";
    ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();
  }
}

function drawAttractions(view, t) {
  drawFeriaGround(view, t);
  const arr = W.ATTRACTIONS;
  if (!arr || !arr.length) return;
  for (const A of arr) {
    const pad = (A.r || 24) * 2 + 30;
    if (A.x + pad < view.x0 || A.x - pad > view.x1
      || A.y + pad < view.y0 || A.y - pad > view.y1) continue;
    drawAttraction(A, t);
  }
}

export { drawAttractions };
