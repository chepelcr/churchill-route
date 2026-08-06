// LA FERIA DEL MALECÓN — the turno that lives on the Paseo de los Turistas.
//
// Four mechanical rides and a DJ. They are drawn, never stamped: the promenade
// is 60 px deep and it is the only way to the two Paseo kiosks, so a carrusel
// that blocked would take a delivery target off the network with it. What the
// world owns is where each one stands and how big it is; everything below is
// what it looks like turning.
//
// ONE RULE, borrowed from `flora.js` and worth repeating: no `Math.random` in a
// draw call. Every ride's variation comes from `hash01` seeded on its own id
// and every motion from the frame clock, so a carrusel turns instead of
// shimmering.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, hash01, label, roundRect } from "./gfx.js";

const FERIA = ["#e85d75", "#f4d77a", "#6fbf99", "#5fb0d6", "#f08a5d", "#c084d6"];
// Everything that spins does so on ONE clock, in seconds, so the rides on a
// stretch of malecón look like one feria rather than four independent toys.
function turn(t, rpm) { return (t / 1000) * rpm * Math.PI * 2 / 60; }

function seedOf(A) {
  let h = 0;
  for (let i = 0; i < A.id.length; i++) h = (h * 31 + A.id.charCodeAt(i)) % 9973;
  return h;
}

// EL CARRUSEL: a striped conical toldo over a ring of horses. From above the
// toldo is what you see, so the horses ride at its rim and the pole is the hub.
function drawCarrusel(A, t) {
  const a = turn(t, 4);
  const r = A.r;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(A.x + 3, A.y + 5, r * 0.95, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#efe6d2";                      // la plataforma
  ctx.beginPath(); ctx.arc(A.x, A.y, r * 0.92, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 8; i++) {                   // los caballitos, girando
    const b = a + (i / 8) * Math.PI * 2;
    const hx = A.x + Math.cos(b) * r * 0.66, hy = A.y + Math.sin(b) * r * 0.66;
    ctx.fillStyle = "#fff";
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(b + Math.PI / 2);
    roundRect(ctx, -3, -2, 6, 4, 1.5, true, false);
    ctx.restore();
  }
  for (let i = 0; i < 12; i++) {                  // el toldo a rayas
    const b0 = a * 0.6 + (i / 12) * Math.PI * 2, b1 = b0 + Math.PI / 12;
    ctx.fillStyle = i % 2 ? "#fff" : "#e85d75";
    ctx.beginPath(); ctx.moveTo(A.x, A.y);
    ctx.arc(A.x, A.y, r, b0, b1); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#f4d77a";                      // el mástil
  ctx.beginPath(); ctx.arc(A.x, A.y, r * 0.14, 0, Math.PI * 2); ctx.fill();
}

// LA RUEDA DE CHICAGO: spokes that turn and cabins that do NOT — a cabin that
// rotated with the wheel would read as a pinwheel, which is the one thing a
// ferris wheel must not look like.
function drawRueda(A, t) {
  const a = turn(t, 2.2);
  const r = A.r, seed = seedOf(A);
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.beginPath(); ctx.ellipse(A.x + 3, A.y + 6, r * 0.5, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#8a929c"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
  ctx.beginPath();                                 // la torre
  ctx.moveTo(A.x - r * 0.42, A.y + r * 0.5); ctx.lineTo(A.x, A.y);
  ctx.lineTo(A.x + r * 0.42, A.y + r * 0.5);
  ctx.stroke();
  ctx.strokeStyle = "#cfd6dd"; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(A.x, A.y, r * 0.82, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 10; i++) {
    const b = a + (i / 10) * Math.PI * 2;
    const cx = A.x + Math.cos(b) * r * 0.82, cy = A.y + Math.sin(b) * r * 0.82;
    ctx.strokeStyle = "rgba(207,214,221,0.8)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(cx, cy); ctx.stroke();
    ctx.fillStyle = FERIA[(i + seed) % FERIA.length];
    roundRect(ctx, cx - 2.6, cy - 2, 5.2, 4.2, 1.4, true, false);   // upright
  }
  ctx.fillStyle = "#8a929c";
  ctx.beginPath(); ctx.arc(A.x, A.y, 2.4, 0, Math.PI * 2); ctx.fill();
}

// LOS CHOCONES: a rink with little cars going round and bumping. The floor is
// the ride — a bumper car alone is just a car — so it is drawn as a bordered
// pista with a rubber kerb.
function drawChocones(A, t) {
  const r = A.r, seed = seedOf(A);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(ctx, A.x - r + 3, A.y - r * 0.7 + 4, r * 2, r * 1.4, 5, true, false);
  ctx.fillStyle = "#3a3540";                       // la pista
  roundRect(ctx, A.x - r, A.y - r * 0.7, r * 2, r * 1.4, 5, true, false);
  ctx.strokeStyle = "#f4d77a"; ctx.lineWidth = 2;  // el borde de hule
  roundRect(ctx, A.x - r + 1, A.y - r * 0.7 + 1, r * 2 - 2, r * 1.4 - 2, 4, false, true);
  for (let i = 0; i < 5; i++) {
    const s = hash01(seed + i * 7.1);
    const a = turn(t, 9 + s * 6) * (s > 0.5 ? 1 : -1) + i * 1.26;
    const cx = A.x + Math.cos(a) * r * (0.35 + s * 0.4);
    const cy = A.y + Math.sin(a) * r * 0.42 * (0.5 + s * 0.6);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = FERIA[(i + seed) % FERIA.length];
    roundRect(ctx, -3.4, -2.4, 6.8, 4.8, 2, true, false);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(-1.4, -1.2, 2.8, 2);
    ctx.restore();
  }
}

// LA TÓMBOLA: the fortune wheel on its stand, with the flapper at the top. It
// spins DOWN — fast, then slowing — which is the whole drama of the thing.
function drawTombola(A, t) {
  const r = A.r;
  const cycle = ((t / 1000) % 9) / 9;              // one spin every nine seconds
  const a = Math.PI * 2 * (1 - (1 - cycle) ** 3) * 3;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath(); ctx.ellipse(A.x + 2, A.y + 5, r * 0.8, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a6a45";                       // el puesto
  roundRect(ctx, A.x - r * 0.6, A.y + r * 0.3, r * 1.2, r * 0.5, 2, true, false);
  for (let i = 0; i < 12; i++) {                   // la rueda por gajos
    const b0 = a + (i / 12) * Math.PI * 2, b1 = b0 + Math.PI / 6;
    ctx.fillStyle = i % 2 ? "#fff" : FERIA[i % FERIA.length];
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.arc(A.x, A.y, r * 0.78, b0, b1);
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = "#3a3540"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(A.x, A.y, r * 0.78, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#e85d75";                       // la aguja
  ctx.beginPath();
  ctx.moveTo(A.x, A.y - r * 0.9); ctx.lineTo(A.x - 2.4, A.y - r * 0.68);
  ctx.lineTo(A.x + 2.4, A.y - r * 0.68); ctx.closePath(); ctx.fill();
}

// DJ URTECH. A booth, two stacks, and a light cone that pulses ON THE BEAT —
// the same 128 bpm the audio voice runs at, so what you see and what you hear
// are the same event rather than two things happening near each other.
const DJ_BPM = 128;
function drawDJ(A, t) {
  const beat = ((t / 1000) * (DJ_BPM / 60)) % 1;
  const kick = (1 - beat) ** 2;                    // hard on the one, decaying
  const r = A.r;
  const night = state.weather === "night";
  ctx.save();
  ctx.globalAlpha = 0.10 + kick * (night ? 0.34 : 0.16);
  ctx.fillStyle = "#c084d6";                       // el cono de luz
  ctx.beginPath(); ctx.arc(A.x, A.y, r * (1.7 + kick * 0.5), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  roundRect(ctx, A.x - r * 0.5 + 2, A.y - 2, r, 9, 2, true, false);
  ctx.fillStyle = "#2b2f36";                       // las torres de sonido
  for (const sx of [-r * 0.72, r * 0.72]) {
    roundRect(ctx, A.x + sx - 3, A.y - 9 - kick * 1.2, 6, 15, 1.5, true, false);
    ctx.fillStyle = "#5b6470";
    ctx.beginPath(); ctx.arc(A.x + sx, A.y - 4, 2.1 + kick * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2b2f36";
  }
  ctx.fillStyle = "#3a3540";                       // la cabina
  roundRect(ctx, A.x - r * 0.5, A.y - 4, r, 9, 2, true, false);
  ctx.fillStyle = "#f4d77a";
  ctx.fillRect(A.x - r * 0.4, A.y - 2.4, r * 0.8, 1.6);
  ctx.fillStyle = "#f1c8a4";                       // él, detrás de los platos
  ctx.beginPath(); ctx.arc(A.x, A.y - 8, 2.4, 0, Math.PI * 2); ctx.fill();
  label(A.x, A.y - 18, "DJ URTECH", "#fff", "#7b3fa0");
}

const DRAW = { carrusel: drawCarrusel, rueda: drawRueda, chocones: drawChocones,
               tombola: drawTombola, dj: drawDJ };

function drawAttractions(view, t) {
  const arr = W.ATTRACTIONS;
  if (!arr || !arr.length) return;
  for (const A of arr) {
    const pad = A.r * 2 + 30;
    if (A.x + pad < view.x0 || A.x - pad > view.x1
      || A.y + pad < view.y0 || A.y - pad > view.y1) continue;
    const draw = DRAW[A.kind];
    if (draw) draw(A, t);
  }
}

export { drawAttractions };
