// Moving things + the player: peds, swimmers, traffic, trains, gulls, boats,
// vendors, animals, the delivery target, arcade coins and the vehicle sprite.
import { state } from "../../game/state.js";
import { traceVehicleSilhouette } from "../vehicleShapes.js";
import { ctx, lastT, roundRect } from "./gfx.js";

// THE HULL EVERY BOAT IN THIS PORT IS DRAWN FROM. It used to live inside
// `drawBoat`, which meant the estero's pangas were a second, hand-drawn boat —
// a flat trapezoid — and a panga you met on the gulf and a panga you met in the
// channel were visibly different objects for no reason a player could name.
// One helper, one boat: a soft shadow on the water, a white sheer curving to
// the bow, and the red boot-top at the waterline. Drawn at the origin, bow to
// +x, in whatever transform the caller has already set up — so she leans and
// bobs with her owner. The caller adds what makes her HERS: a wake if she is
// travelling, a fisher if she is working, a funnel if she is a ferry.
function traceHull(g, L, H) {
  g.beginPath();
  g.moveTo(L, 0);
  g.quadraticCurveTo(L * 0.55, -H, -L * 0.7, -H * 0.9);
  g.quadraticCurveTo(-L, -H * 0.5, -L, 0);
  g.quadraticCurveTo(-L, H * 0.6, -L * 0.7, H * 0.9);
  g.quadraticCurveTo(L * 0.55, H, L, 0);
  g.closePath();
}
function paintHull(g, L, H, topsides = "#f6f2e8") {
  g.fillStyle = "rgba(0,0,0,0.20)";        // hull shadow on the water
  g.beginPath();
  g.ellipse(1, H * 0.7, L * 0.95, H * 0.8, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = topsides;                  // white hull, sheer curving to the bow
  traceHull(g, L, H); g.fill();
  g.fillStyle = "#e2503f";                 // the red boot-top at the waterline
  g.beginPath();
  g.moveTo(L * 0.92, 0);
  g.quadraticCurveTo(L * 0.5, H, -L * 0.7, H * 0.88);
  g.quadraticCurveTo(-L, H * 0.55, -L, 0);
  g.closePath(); g.fill();
}

// A collectable churchill coin lying on the street (arcade): a disc that spins
// (squash on X) and bobs, with a shadow + ₡ mark so it reads as loot.
// GOLD is the ordinary street coin. SILVER is the estadio coin rain — bigger,
// worth many times a street coin, and a different metal so the player can tell
// at a glance that the burst on the pitch is not just more of the same.
const COIN_GOLD   = { rim: "#c8992f", face: "#f3c969", mark: "#a97b1e", r: 7 };
const COIN_SILVER = { rim: "#8e9bab", face: "#dfe6ef", mark: "#5b6675", r: 9 };
const COIN_TYPES = {
  gold: COIN_GOLD,
  silver: COIN_SILVER,
  bonus: { rim: "#7b3fc6", face: "#c58cff", mark: "#5d259f", r: 9 },
  frozen: { rim: "#4a9fbd", face: "#a9edff", mark: "#24738f", r: 8 },
};
function drawArcadeCoin(c, t) {
  const ph = (c.t || 0) + t * 0.004;
  const sx = Math.abs(Math.cos(ph * 2.2));           // spin → horizontal squash
  const bob = Math.sin(ph * 3) * 1.6;                // gentle hover
  const M = c.palette || COIN_TYPES[c.coinType] || (c.silver ? COIN_SILVER : COIN_GOLD);
  const R = M.r;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 5, R - 1, R * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  const cy = c.y - bob;
  ctx.fillStyle = M.rim;
  ctx.beginPath(); ctx.ellipse(c.x, cy, R * sx + 0.6, R + 0.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = M.face;
  ctx.beginPath(); ctx.ellipse(c.x, cy, R * sx, R, 0, 0, Math.PI * 2); ctx.fill();
  if (sx > 0.35) {                                    // ₡ mark only when facing us
    ctx.fillStyle = M.mark;
    ctx.font = `bold ${Math.round((c.silver ? 11 : 9) * sx + 3)}px 'Space Grotesk', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("₡", c.x, cy + 0.5);
    ctx.textBaseline = "alphabetic";
  }
}

function drawPed(pe) {
  // The ART, not the kind. `npcTypes.json` lets an authored type choose an
  // existing look (`art`), which is what makes the registry worth having —
  // picking a built-in art means accepting the built-in drawing, colour and
  // all, and the four person styles keep the authored colour/scale.
  const art = pe.editorNpc ? (pe.drawStyle || "person") : (pe.kind || "walker");
  if (art === "swimmer") { drawSwimmer(pe); return; }
  if (art === "passenger") { drawPassenger(pe); return; }
  if (art === "fisher") { drawFisher(pe); return; }
  if (pe.editorNpc && ["person", "vendor", "worker", "mascot"].includes(art)) {
    drawEditorNpc(pe); return;
  }
  // FANS celebrate: a bigger, faster bounce plus a side-to-side shake and two
  // raised arms, so the crowd around the estadio and la plaza reads as a crowd
  // rather than commuters who happen to be walking in a circle.
  const fan = art === "fan";
  const bob = fan ? Math.abs(Math.sin(pe.ph * 1.7)) * -3.2 : Math.sin(pe.ph) * 1.4;
  const sway = fan ? Math.sin(pe.ph * 2.3) * 1.1 : 0;
  const x = pe.x + sway;
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(pe.x + 1, pe.y + 5, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `hsl(${pe.hue} 70% 60%)`; ctx.fillRect(x - 2, pe.y - 3 + bob, 4, 6);
  if (fan) {                                       // arms up
    ctx.strokeStyle = "#f1c8a4"; ctx.lineWidth = 1.2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - 2, pe.y - 2 + bob); ctx.lineTo(x - 4, pe.y - 6 + bob);
    ctx.moveTo(x + 2, pe.y - 2 + bob); ctx.lineTo(x + 4, pe.y - 6 + bob);
    ctx.stroke();
  }
  ctx.fillStyle = "#f1c8a4"; ctx.beginPath(); ctx.arc(x, pe.y - 5 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
}

function drawEditorNpc(pe) {
  const scale = pe.scale || 1;
  const bob = pe.stationary ? Math.sin(pe.ph) * 0.35 : Math.sin(pe.ph) * 1.2;
  ctx.save();
  ctx.translate(pe.x, pe.y + bob);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(1, 5, 4.5, 1.7, 0, 0, Math.PI * 2); ctx.fill();
  if (pe.drawStyle === "mascot") {
    ctx.fillStyle = pe.color;
    ctx.beginPath(); ctx.arc(0, -1, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(-1.7, -2, 1, 0, Math.PI * 2); ctx.arc(1.7, -2, 1, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = pe.color;
    if (pe.drawStyle === "vendor") {
      roundRect(ctx, -4, -3, 8, 7, 1.5, true, false);
      ctx.fillStyle = "#f4d77a"; ctx.fillRect(-5, -5, 10, 2);
    } else {
      ctx.fillRect(-2.5, -3, 5, 7);
      if (pe.drawStyle === "worker") {
        ctx.fillStyle = "#f4d77a"; ctx.fillRect(-3.2, -6.5, 6.4, 1.6);
      }
    }
    ctx.fillStyle = "#e8b98a";
    ctx.beginPath(); ctx.arc(0, -5.2, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
// Somebody at a parada. The whole point of the type is the WAITING: standing
// still with a bag, looking down the street the bus comes from, which is what
// tells you at a glance that the caseta is in use. Once they are moving — to
// the door, or off it and down the acera — they are drawn as the walker they
// are about to become, so the handover to `advancePed` has no visible seam.
// This branch is TEMPORARY per person: `joinTheSidewalk` drops the kind.
function drawPassenger(pe) {
  const waiting = pe.phase === "wait";
  const bob = waiting ? Math.sin(pe.ph) * 0.5 : Math.sin(pe.ph) * 1.4;
  const y = pe.y + bob;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.ellipse(pe.x + 1, pe.y + 5, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `hsl(${pe.hue} 70% 60%)`;
  ctx.fillRect(pe.x - 2, y - 3, 4, 6);
  if (waiting) {                                   // the bolso, held at the hip
    ctx.fillStyle = "#7a5c3a";
    ctx.fillRect(pe.x + 2, y + 0.6, 2.2, 2.6);
  }
  ctx.fillStyle = "#f1c8a4";
  ctx.beginPath(); ctx.arc(pe.x, y - 5, 2.2, 0, Math.PI * 2); ctx.fill();
}
// EL PESCADOR. He is the same person as everyone else in the puerto — the same
// narrow body in his own `hue`, the same 2.2 px head, the same soft shadow —
// SITTING DOWN: the body is shorter and the head rides lower, because he is on
// a thwart and not on his feet. What makes him a fisher is only what he carries:
// the sombrero against the sun (from above you see the hat first and the back of
// his head behind it), the caña out over the bow, and a line whose ripple ring
// moves with the swell.
//
// He is drawn in HIS BOAT'S FRAME, not on a surface — the panga leans and bobs
// and he goes with her — which is why his registry host is `water` and his
// movement `stationary`. `pe.x`/`pe.y` are therefore boat-local when the estero
// draws him, and world coordinates when he is an authored NPC; the drawing is
// the same either way, and the caller owns the transform.
function drawFisher(pe) {
  const hue = Number.isFinite(pe.hue) ? pe.hue : 28;
  const x = pe.x, y = pe.y;
  const ph = pe.ph || 0;
  const bob = Math.sin(ph) * 0.5;                     // seated: he barely moves
  const dip = Math.sin(ph * 0.8) * 1.6;               // where the line breaks the surface
  ctx.save();
  ctx.lineCap = "round";
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(x + 1, y + 4, 3.6, 1.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.30)";         // the ring the line makes
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(x + 15, y + 5 + dip, 3 + Math.sin(ph) * 0.8, 1.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";         // the line, into the water
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + 10, y - 5.5);
  ctx.quadraticCurveTo(x + 13.6, y - 1, x + 15, y + 5 + dip);
  ctx.stroke();
  ctx.fillStyle = `hsl(${hue} 70% 60%)`;              // the body, seated
  ctx.fillRect(x - 2, y - 2 + bob, 4, 5);
  ctx.strokeStyle = "#f1c8a4";                        // the arm on the caña
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x + 1.4, y - 1 + bob); ctx.lineTo(x + 3.4, y - 2.6 + bob); ctx.stroke();
  ctx.strokeStyle = "#8a5f33";                        // la caña
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 2.4, y - 1.4 + bob); ctx.lineTo(x + 10, y - 5.5); ctx.stroke();
  ctx.fillStyle = "#f1c8a4";                          // the head
  ctx.beginPath(); ctx.arc(x, y - 4.2 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e0cf9e";                          // el sombrero: brim, tipped forward
  ctx.beginPath(); ctx.ellipse(x + 0.7, y - 4.4 + bob, 3.5, 2.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f4d77a";                          // …and its crown
  ctx.beginPath(); ctx.arc(x + 0.5, y - 4.7 + bob, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// A swimmer: a head just above the water with a ripple wake + stroking arms.
function drawSwimmer(pe) {
  const t = pe.ph;
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1;               // wake ring
  ctx.beginPath(); ctx.ellipse(pe.x, pe.y + 1, 6 + Math.sin(t) * 1.5, 3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `hsl(${pe.hue} 55% 55%)`; ctx.lineWidth = 1.6;            // stroking arms
  ctx.beginPath();
  ctx.moveTo(pe.x - 3, pe.y + Math.sin(t) * 1.2);
  ctx.lineTo(pe.x + 3, pe.y - Math.sin(t) * 1.2);
  ctx.stroke();
  ctx.fillStyle = "#f1c8a4"; ctx.beginPath(); ctx.arc(pe.x, pe.y, 2.3, 0, Math.PI * 2); ctx.fill(); // head
}
function drawCar(c) {
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.ang || 0);
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-c.w/2 + 3, -c.h/2 + 3, c.w, c.h);
  if (c.kind === "truck") {
    // cab + boxy trailer
    ctx.fillStyle = c.color; ctx.fillRect(c.w/2 - 9, -c.h/2, 9, c.h);
    ctx.fillStyle = "#e8e4da"; ctx.fillRect(-c.w/2, -c.h/2, c.w - 10, c.h);
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(c.w/2 - 10, -c.h/2, 1.5, c.h);
  } else if (c.kind === "bus") {
    ctx.fillStyle = c.color; ctx.fillRect(-c.w/2, -c.h/2, c.w, c.h);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let wx = -c.w/2 + 4; wx < c.w/2 - 5; wx += 6) ctx.fillRect(wx, -c.h/2 + 2, 4, 3);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let wx = -c.w/2 + 4; wx < c.w/2 - 5; wx += 6) ctx.fillRect(wx, c.h/2 - 5, 4, 3);
  } else {
    ctx.fillStyle = c.color; ctx.fillRect(-c.w/2, -c.h/2, c.w, c.h);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-c.w/2 + 4, -c.h/2 + 2, c.w - 8, c.h - 4);
  }
  ctx.fillStyle = "#222"; ctx.fillRect(-c.w/2, -c.h/2 - 1, 3, c.h + 2); ctx.fillRect(c.w/2 - 3, -c.h/2 - 1, 3, c.h + 2);
  ctx.restore();
}
// The Ferrocarril heritage train: red loco + two cream wagons, each posed
// on the rail by spawns.js (tr.cars[0] = loco).
function drawTrain(tr, t) {
  for (let k = tr.cars.length - 1; k >= 0; k--) {
    const c = tr.cars[k];
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.ang);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-17, -6, 34, 13);
    if (k === 0) {
      ctx.fillStyle = "#a83232"; ctx.fillRect(-18, -7, 36, 14);   // loco body
      ctx.fillStyle = "#7d2424"; ctx.fillRect(-18, -7, 10, 14);   // cab
      ctx.fillStyle = "#26222c"; ctx.fillRect(12, -4, 5, 8);      // smokebox
      ctx.fillStyle = "#ffe06b"; ctx.fillRect(16, -2, 2, 4);      // lamp
    } else {
      ctx.fillStyle = "#e8dcc0"; ctx.fillRect(-16, -6, 32, 12);   // wagon
      ctx.fillStyle = "#a83232"; ctx.fillRect(-16, -6, 32, 3);    // stripe
      ctx.fillStyle = "rgba(20,40,60,0.5)";
      for (let wx = -11; wx <= 9; wx += 7) ctx.fillRect(wx, -2, 4, 4); // windows
    }
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
    ctx.strokeRect(k === 0 ? -18 : -16, k === 0 ? -7 : -6, k === 0 ? 36 : 32, k === 0 ? 14 : 12);
    ctx.restore();
  }
  // chimney smoke puffs drifting off the loco
  const l = tr.cars[0];
  ctx.fillStyle = "rgba(230,230,230,0.35)";
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.0012 + i * 0.33) % 1;
    ctx.beginPath();
    ctx.arc(l.x + Math.cos(l.ang) * 14 - ph * 16, l.y + Math.sin(l.ang) * 14 - 8 - ph * 14, 2 + ph * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGull(g) {
  ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(g.x, g.y + 14, 6, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  const f = Math.sin(g.ph) * 4;
  ctx.beginPath();
  ctx.moveTo(g.x - 7, g.y + f); ctx.quadraticCurveTo(g.x - 3, g.y - 3 + f, g.x, g.y + f);
  ctx.quadraticCurveTo(g.x + 3, g.y - 3 + f, g.x + 7, g.y + f); ctx.stroke();
}
// The boats on the water. Both were flat rectangles seen from directly above,
// which is not how anything else in this game is drawn: the loading screen's
// little lancha has a white hull, a red boot-top and a cabin, and that is the
// boat people expect to find when they get out on the gulf. This is that boat,
// at world scale — a curved hull, a stripe at the waterline, a wake that knows
// which way she is going.
function drawBoat(b) {
  const dir = Math.sign(b.vx) || 1;
  const t = lastT * 0.001;
  const bob = Math.sin(t * 1.5 + (b.x + b.y) * 0.01) * 1.2;
  ctx.save();
  ctx.translate(b.x, b.y + bob);
  ctx.scale(dir, 1);                       // she faces the way she is travelling
  const big = b.kind === "ferry";
  const L = big ? 30 : 15, H = big ? 8 : 5;
  // wake: a widening V behind her, brighter the faster she runs
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.beginPath();
  ctx.moveTo(-L, -H * 0.5); ctx.lineTo(-L - 26, -H * 1.6);
  ctx.lineTo(-L - 26, H * 1.6); ctx.lineTo(-L, H * 0.5);
  ctx.closePath(); ctx.fill();
  paintHull(ctx, L, H);                    // shadow + white sheer + red boot-top
  ctx.fillStyle = "#3a6f8a";               // cabin
  roundRect(ctx, -L * 0.35, -H * 0.85, L * (big ? 0.5 : 0.42), H * 1.2, 2, true, false);
  ctx.fillStyle = "#f4d77a";
  ctx.fillRect(-L * 0.28, -H * 0.35, L * (big ? 0.34 : 0.26), 2);
  if (big) {
    ctx.fillStyle = "#e85d75";             // funnel on the bigger one
    ctx.beginPath(); ctx.arc(-L * 0.6, -H * 0.2, 3.2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = "#8a5f33";           // an outboard on the panga
    ctx.lineWidth = 1.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-L + 1, -1); ctx.lineTo(-L - 3, 3); ctx.stroke();
  }
  ctx.restore();
}

// Street vendor cart: box cart with a striped parasol
function drawVendor(vn, t) {
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(vn.x + 2, vn.y + 5, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillRect(vn.x - 7, vn.y - 4, 14, 9);
  ctx.fillStyle = `hsl(${vn.hue} 70% 55%)`; ctx.fillRect(vn.x - 7, vn.y - 4, 14, 3);
  ctx.fillStyle = "#26222c";
  ctx.beginPath(); ctx.arc(vn.x - 5, vn.y + 6, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(vn.x + 5, vn.y + 6, 1.6, 0, Math.PI * 2); ctx.fill();
  // parasol with a gentle sway
  const sway = Math.sin(t * 0.001 + vn.ph) * 1.2;
  ctx.strokeStyle = "#8a7355"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(vn.x + 4, vn.y - 2); ctx.lineTo(vn.x + 4 + sway, vn.y - 14); ctx.stroke();
  ctx.fillStyle = `hsl(${vn.hue} 75% 60%)`;
  ctx.beginPath(); ctx.arc(vn.x + 4 + sway, vn.y - 14, 9, Math.PI, 0); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.arc(vn.x + 4 + sway, vn.y - 14, 9, Math.PI + 0.5, Math.PI + 1.1); ctx.lineTo(vn.x + 4 + sway, vn.y - 14); ctx.fill();
}

// Stray dog / cat ambling around the streets
function drawAnimal(an) {
  const bob = Math.sin(an.ph) * 0.8;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(an.x + 1, an.y + 3, 4, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = an.cat ? "#4a4046" : "#a5763f";
  ctx.fillRect(an.x - 4, an.y - 2 + bob, 8, 4);                     // body
  ctx.fillRect(an.x + 3, an.y - 4 + bob, 3.4, 3.4);                 // head
  ctx.fillRect(an.x - 6, an.y - 3 + bob, 2, 2);                     // tail
  if (an.cat) { ctx.fillRect(an.x + 3.4, an.y - 5.4 + bob, 1.2, 1.6); ctx.fillRect(an.x + 5.2, an.y - 5.4 + bob, 1.2, 1.6); } // ears
}

// The active delivery target: a waiting customer on a concrete pad, waving.
function drawTargetCustomer(t) {
  if (!state.carrying) return;
  const c = state.carrying.customer;
  ctx.fillStyle = "#cec7b2";                                 // pad
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
  const pulse = 10 + Math.sin(t * 0.005) * 3;                // pulse ring
  ctx.strokeStyle = "rgba(255,61,128,0.8)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c.x, c.y, pulse + 8, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.25)";                        // shadow
  ctx.beginPath(); ctx.ellipse(c.x + 2, c.y + 6, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a6f8a";                                 // body
  roundRect(ctx, c.x - 3, c.y - 6, 6, 11, 2, true, false);
  ctx.fillStyle = "#e8b98a";                                 // head
  ctx.beginPath(); ctx.arc(c.x, c.y - 9, 3.4, 0, Math.PI * 2); ctx.fill();
  const wave = Math.sin(t * 0.012) * 3;                      // waving arm
  ctx.strokeStyle = "#e8b98a"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c.x + 3, c.y - 4); ctx.lineTo(c.x + 7, c.y - 10 - wave); ctx.stroke();
}

// The player's lancha, drawn from the same parts as the port's own boats
// (drawBoat above): a white sheer curving to the bow, the red boot-top at the
// waterline, a cabin or console, an outboard on the transom. What differs is
// that the HULL takes veh.color, because the paint swatches have to read at a
// glance — so the boot-top and the trim stay constant and carry the boat idiom
// while the topsides carry the player's choice.
function paintBoat(ctx, key, veh) {
  const L = veh.w / 2, H = veh.h / 2;
  ctx.fillStyle = "rgba(255,255,255,0.22)";           // bow wave off the stem
  ctx.beginPath();
  ctx.moveTo(L, 0); ctx.lineTo(L - 5, -H - 3); ctx.lineTo(L + 5, 0); ctx.lineTo(L - 5, H + 3);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = veh.color;                          // topsides
  ctx.beginPath();
  ctx.moveTo(L, 0);
  ctx.quadraticCurveTo(L * 0.2, -H, -L + 2, -H + 1);
  ctx.lineTo(-L, -H + 1); ctx.lineTo(-L, H - 1); ctx.lineTo(-L + 2, H - 1);
  ctx.quadraticCurveTo(L * 0.2, H, L, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e2503f";                          // the boot-top, always red
  ctx.beginPath();
  ctx.moveTo(L * 0.94, 0);
  ctx.quadraticCurveTo(L * 0.2, H, -L + 2, H - 1);
  ctx.lineTo(-L, H - 1); ctx.lineTo(-L, H - 3);
  ctx.quadraticCurveTo(L * 0.2, H - 2.5, L * 0.94, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";            // the sheer highlight
  ctx.fillRect(-L + 3, -H + 1.5, veh.w - 7, 1);
  if (key === "deslizador") {
    ctx.fillStyle = veh.roof;                         // low wraparound screen
    ctx.beginPath();
    ctx.moveTo(L * 0.34, -H + 2); ctx.lineTo(L * 0.06, -H + 2);
    ctx.lineTo(L * 0.06, H - 2); ctx.lineTo(L * 0.34, H - 2);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = veh.roof;                         // console / cabin
    roundRect(ctx, -L * 0.2, -H + 2, veh.w * (key === "panga" ? 0.26 : 0.3), veh.h - 4, 2, true, false);
  }
  ctx.strokeStyle = "#8a5f33";                        // the outboard on her transom
  ctx.lineWidth = 1.8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-L + 1, 0); ctx.lineTo(-L - 3.5, 0); ctx.stroke();
  ctx.fillStyle = "#26222c";
  ctx.beginPath(); ctx.arc(-L - 4, 0, 1.8, 0, Math.PI * 2); ctx.fill();
}

// Vehicle sprite painter, reused by the in-game player draw and the UI
// vehicle preview (StageSelect). Draws centered at (0,0) facing +x.
function paintVehicle(g, key, veh) {
  const ctx = g;
  if (veh.kind === "boat") {
    paintBoat(ctx, key, veh);
  } else if (veh.kind === "bike") {
    // two-wheeler: wheels, frame, rider with helmet
    ctx.fillStyle = "#26222c";
    ctx.beginPath(); ctx.ellipse(-veh.w/2 + 3, 0, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(veh.w/2 - 3, 0, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = veh.color;
    if (key === "scooter") {
      roundRect(ctx, -veh.w/2 + 3, -3, veh.w - 6, 6, 2.5, true, false);   // deck + leg shield
      ctx.fillRect(veh.w/2 - 7, -4, 3, 8);
    } else {
      roundRect(ctx, -veh.w/2 + 4, -1.5, veh.w - 8, 3, 1.5, true, false); // thin bici frame
      ctx.strokeStyle = "rgba(38,34,44,0.72)";              // empty rear cargo rack
      ctx.lineWidth = 1;
      ctx.strokeRect(-veh.w/2 + 2, -3.5, 5, 7);
    }
    ctx.fillStyle = "rgba(20,40,60,0.6)";                  // handlebar
    ctx.fillRect(veh.w/2 - 6, -veh.h/2 + 2, 2, veh.h - 4);
    ctx.fillStyle = veh.roof;                               // rider helmet
    ctx.beginPath(); ctx.arc(-1, 0, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fffbe8";                              // headlight
    ctx.fillRect(veh.w/2 - 2, -1.5, 2, 3);
  } else if (key === "tuktuk") {
    // three-wheeler: single front wheel, cabin with canopy
    ctx.fillStyle = "#26222c";
    ctx.beginPath(); ctx.ellipse(veh.w/2 - 2, 0, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-veh.w/2 + 4, -veh.h/2 + 1, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-veh.w/2 + 4, veh.h/2 - 1, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = veh.color;
    ctx.beginPath();                                        // teardrop body
    ctx.moveTo(veh.w/2, 0);
    ctx.quadraticCurveTo(veh.w/2 - 4, -veh.h/2, -veh.w/2 + 2, -veh.h/2 + 1);
    ctx.lineTo(-veh.w/2 + 2, veh.h/2 - 1);
    ctx.quadraticCurveTo(veh.w/2 - 4, veh.h/2, veh.w/2, 0);
    ctx.fill();
    ctx.fillStyle = veh.roof;                               // canopy
    roundRect(ctx, -veh.w/2 + 3, -veh.h/2 + 2.5, veh.w * 0.6, veh.h - 5, 2, true, false);
    ctx.fillStyle = "#fffbe8"; ctx.fillRect(veh.w/2 - 2, -1.5, 2, 3);
  } else if (key === "cart") {
    // ice-cream cart: white box, striped canopy, small wheels
    ctx.fillStyle = "#26222c";
    ctx.fillRect(-veh.w/2 + 3, -veh.h/2 - 1, 4, 2); ctx.fillRect(-veh.w/2 + 3, veh.h/2 - 1, 4, 2);
    ctx.fillRect(veh.w/2 - 7, -veh.h/2 - 1, 4, 2); ctx.fillRect(veh.w/2 - 7, veh.h/2 - 1, 4, 2);
    ctx.fillStyle = veh.color;
    roundRect(ctx, -veh.w/2, -veh.h/2, veh.w, veh.h, 3, true, false);
    for (let i = 0; i < 4; i++) {                           // striped canopy
      ctx.fillStyle = i % 2 ? "#fff" : veh.roof;
      ctx.fillRect(-veh.w/2 + 2 + i * (veh.w - 4) / 4, -veh.h/2 + 1, (veh.w - 4) / 4, veh.h * 0.45);
    }
    ctx.fillStyle = "#5fb0d6"; ctx.fillRect(-veh.w/2 + 4, veh.h/2 - 6, veh.w - 8, 3); // freezer lid
  } else if (key === "pickup") {
    // pickup: cab up front, open cargo bed behind
    ctx.fillStyle = veh.color;
    roundRect(ctx, -veh.w/2, -veh.h/2, veh.w, veh.h, 3, true, false);
    ctx.fillStyle = veh.roof;                               // cab roof
    ctx.fillRect(veh.w/2 - 14, -veh.h/2 + 2, 9, veh.h - 4);
    ctx.fillStyle = "rgba(30,25,20,0.55)";                  // bed
    ctx.fillRect(-veh.w/2 + 2, -veh.h/2 + 2, veh.w/2 + 2, veh.h - 4);
    ctx.fillStyle = "#e8e4da";                              // cooler in the bed
    ctx.fillRect(-veh.w/2 + 5, -3, 7, 6);
    ctx.fillStyle = "#fffbe8";
    ctx.fillRect(veh.w/2 - 2, -veh.h/2 + 1, 2, 3); ctx.fillRect(veh.w/2 - 2, veh.h/2 - 4, 2, 3);
  } else if (key === "turbo") {
    // kart: low body, exposed wheels, rear spoiler
    ctx.fillStyle = "#26222c";
    ctx.fillRect(-veh.w/2 + 1, -veh.h/2 - 2, 5, 3); ctx.fillRect(-veh.w/2 + 1, veh.h/2 - 1, 5, 3);
    ctx.fillRect(veh.w/2 - 6, -veh.h/2 - 2, 5, 3); ctx.fillRect(veh.w/2 - 6, veh.h/2 - 1, 5, 3);
    ctx.fillStyle = veh.color;                              // narrow hull
    roundRect(ctx, -veh.w/2, -veh.h/2 + 3, veh.w, veh.h - 6, 3, true, false);
    ctx.fillStyle = veh.roof;                               // driver
    ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = veh.color;                              // spoiler
    ctx.fillRect(-veh.w/2 - 2, -veh.h/2 + 1, 3, veh.h - 2);
    ctx.fillStyle = "#fffbe8"; ctx.fillRect(veh.w/2 - 2, -1.5, 2, 3);
  } else {
    ctx.fillStyle = veh.color;
    roundRect(ctx, -veh.w/2, -veh.h/2, veh.w, veh.h, 3, true, false);
    ctx.fillStyle = veh.roof;
    ctx.fillRect(-veh.w/2 + 2, -veh.h/2 + 2, veh.w - 4, veh.h * 0.5);
    ctx.fillStyle = "rgba(20,40,60,0.6)";
    ctx.fillRect(veh.w/2 - 7, -veh.h/2 + 2, 4, veh.h - 4);
    ctx.fillStyle = "#fffbe8";
    ctx.fillRect(veh.w/2 - 2, -veh.h/2 + 1, 2, 3); ctx.fillRect(veh.w/2 - 2, veh.h/2 - 4, 2, 3);
  }
}

// Insulated delivery backpacks for the courier-style vehicles. Coordinates are
// in vehicle-local space (+x is the nose). On the two-wheelers and kart the
// straps reach forward over the rider, so the bag reads as worn rather than as
// a box bolted onto the chassis. The tuk-tuk carries the same bag in its rear
// passenger compartment.
const DELIVERY_BAG_MOUNTS = {
  bici:    { x: -4.2, y: 0, scale: 0.72, straps: true },
  scooter: { x: -4.6, y: 0, scale: 0.76, straps: true },
  tuktuk:  { x: -7.0, y: 0, scale: 0.92, straps: false },
  turbo:   { x: -4.5, y: 0, scale: 0.72, straps: true },
};

function drawDeliveryBag(g, mount, carrying) {
  const m = Math.max(0, Math.min(1, carrying.melt / carrying.total));
  g.save();
  g.translate(mount.x, mount.y);
  g.scale(mount.scale, mount.scale);
  if (mount.straps) {
    g.strokeStyle = "#171820";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(2.5, -2.4); g.lineTo(6, -2);
    g.moveTo(2.5,  2.4); g.lineTo(6,  2);
    g.stroke();
  }
  g.fillStyle = "#20242b";
  roundRect(g, -4, -4, 8, 8, 1.5, true, false);
  g.strokeStyle = "#67d39a";
  g.lineWidth = 1;
  g.strokeRect(-3.5, -3.5, 7, 7);
  g.fillStyle = "#67d39a";                              // insulated lid seam
  g.fillRect(-3.5, -3.5, 1.2, 7);
  g.fillStyle = `oklch(0.66 0.20 ${30 + m * 18})`;       // Churchill badge
  g.fillRect(-1.4, -2.2, 2.8, 3.4);
  g.fillStyle = "#fff";
  g.fillRect(-1.4, -2.8, 2.8, 1);
  g.restore();
}

function drawPickupCooler(g, carrying) {
  const m = Math.max(0, Math.min(1, carrying.melt / carrying.total));
  const hRed = 6 * (1 - m * 0.5);
  g.save();
  g.translate(-8, 0);
  g.fillStyle = "#fff";
  g.fillRect(-3, -4, 6, 8);
  g.fillStyle = `oklch(0.62 0.22 ${25 + m * 20})`;
  g.fillRect(-3, -4 + (6 - hRed), 6, hRed);
  g.fillStyle = "#fff";
  g.fillRect(-3, -5, 6, 2);
  g.restore();
}

function drawCartFreezerLoad(g, veh, carrying) {
  const m = Math.max(0, Math.min(1, carrying.melt / carrying.total));
  const x = -veh.w / 2 + 4;
  const y = veh.h / 2 - 6;
  const w = veh.w - 8;
  g.fillStyle = "#dff7ff";                              // open, icy freezer lid
  roundRect(g, x, y, w, 3, 1, true, false);
  g.fillStyle = `oklch(0.68 0.18 ${210 - m * 170})`;     // cold-to-melting gauge
  g.fillRect(x + 1, y + 1, Math.max(2, (w - 2) * (1 - m * 0.55)), 1);
  g.fillStyle = "#31576a";                              // recessed lid handle
  g.fillRect(-2, y - 0.8, 4, 1);
}

function drawCarriedCargo(g, key, veh, carrying) {
  if (key === "pickup") {
    drawPickupCooler(g, carrying);
  } else if (key === "cart") {
    drawCartFreezerLoad(g, veh, carrying);
  } else {
    const mount = DELIVERY_BAG_MOUNTS[key] ||
      { x: -veh.w * 0.2, y: 0, scale: 0.8, straps: false };
    drawDeliveryBag(g, mount, carrying);
  }
}

// Wind swirl: arc streaks whipping around the car, in the direction it's
// turning, opacity/length scaled by angular speed — sells a fast pivot.
function drawTurnWind(p, veh, t) {
  const w = Math.abs(p.av || 0);
  if (w < 1.2) return;                       // only when whipping around
  const dir = Math.sign(p.av);
  const strength = Math.min(1, (w - 1.2) / 4);
  const r = Math.max(veh.w, veh.h) * 0.75 + 6;
  ctx.save();
  ctx.translate(p.x, p.y - (state.elev || 0) * 7);
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const base = p.a + dir * (0.5 + i * 0.7) + t * 0.02 * dir;
    const span = (0.7 + strength * 0.8);
    ctx.beginPath();
    ctx.arc(0, 0, r + i * 3, base, base + dir * span, dir < 0);
    ctx.strokeStyle = `rgba(255,255,255,${(0.10 + strength * 0.22).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

// The player's wake: a widening V astern, longer and brighter the faster she
// runs. It replaces the wind swirls on the water — swirls read as air whipping
// past a kart, and the thing a boat actually leaves behind is her wash. Drawn
// in WORLD space (before the body's rotate) so it trails her heading.
function drawWake(p, veh) {
  const sp = Math.min(1, (p.speed || 0) / 260);
  if (sp < 0.08) return;
  const L = veh.w / 2, spread = veh.h * (0.7 + sp * 1.1), len = 14 + sp * 46;
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.a);
  ctx.fillStyle = `rgba(255,255,255,${(0.10 + sp * 0.22).toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(-L, -veh.h * 0.4);
  ctx.lineTo(-L - len, -spread);
  ctx.lineTo(-L - len, spread);
  ctx.lineTo(-L, veh.h * 0.4);
  ctx.closePath(); ctx.fill();
  // the churn right at the transom, where the outboard is actually working
  ctx.fillStyle = `rgba(255,255,255,${(0.18 + sp * 0.3).toFixed(3)})`;
  const ph = lastT * 0.012;
  for (let i = 0; i < 4; i++) {
    const d = 3 + i * 5 + (ph % 5);
    ctx.beginPath();
    ctx.arc(-L - d, Math.sin(ph + i * 1.7) * veh.h * 0.3, 2.2 - i * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(p, veh) {
  const lift = (state.elev || 0) * 7;   // the barro avenue rides ~1 m up
  const afloat = veh.medium === "water";
  ctx.save();
  if (afloat) drawWake(p, veh);
  else drawTurnWind(p, veh, lastT);
  // ground shadow — the body's own silhouette, dropped further behind and
  // faded as the car climbs the ramp. A HULL SITS IN THE WATER, so hers is
  // tucked almost underneath and much softer: the same offset that reads as a
  // car above tarmac reads as a boat flying above the sea.
  const sx = afloat ? 1.5 : 4 + lift * 0.6, sy = afloat ? 2 : 6 + lift;
  ctx.save(); ctx.translate(p.x + sx, p.y + sy); ctx.rotate(p.a);
  ctx.fillStyle = afloat ? "rgba(12,40,58,0.28)"
    : `rgba(0,0,0,${(0.35 - lift * 0.02).toFixed(3)})`;
  traceVehicleSilhouette(ctx, state.vehicleKey, veh); ctx.fill(); ctx.restore();
  ctx.translate(p.x, p.y - lift); ctx.rotate(p.a);
  paintVehicle(ctx, state.vehicleKey, veh);
  if (state.carrying) drawCarriedCargo(ctx, state.vehicleKey, veh, state.carrying);
  ctx.restore();
}

// Hybrid overlay: Pixi owns the player body/shadow; this draws only the
// carried delivery bag / cooler / freezer state (game-critical UI, not bodywork).
function drawPlayerCarrying(p, veh) {
  if (!state.carrying) return;
  const lift = (state.elev || 0) * 7;
  ctx.save();
  ctx.translate(p.x, p.y - lift); ctx.rotate(p.a);
  drawCarriedCargo(ctx, state.vehicleKey, veh, state.carrying);
  ctx.restore();
}

export { drawAnimal, drawArcadeCoin, drawBoat, drawCar, drawFisher, drawGull, drawPed, drawPlayer, drawPlayerCarrying, drawSwimmer, drawTargetCustomer, drawTrain, drawTurnWind, drawVendor, paintHull, paintVehicle };
