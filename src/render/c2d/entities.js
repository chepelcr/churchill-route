// Moving things + the player: peds, swimmers, traffic, trains, gulls, boats,
// vendors, animals, the delivery target, arcade coins and the vehicle sprite.
import { state } from "../../game/state.js";
import { traceVehicleSilhouette } from "../vehicleShapes.js";
import { ctx, lastT, roundRect } from "./gfx.js";

// A collectable churchill coin lying on the street (arcade): a disc that spins
// (squash on X) and bobs, with a shadow + ₡ mark so it reads as loot.
// GOLD is the ordinary street coin. SILVER is the estadio coin rain — bigger,
// worth many times a street coin, and a different metal so the player can tell
// at a glance that the burst on the pitch is not just more of the same.
const COIN_GOLD   = { rim: "#c8992f", face: "#f3c969", mark: "#a97b1e", r: 7 };
const COIN_SILVER = { rim: "#8e9bab", face: "#dfe6ef", mark: "#5b6675", r: 9 };
function drawArcadeCoin(c, t) {
  const ph = (c.t || 0) + t * 0.004;
  const sx = Math.abs(Math.cos(ph * 2.2));           // spin → horizontal squash
  const bob = Math.sin(ph * 3) * 1.6;                // gentle hover
  const M = c.silver ? COIN_SILVER : COIN_GOLD;
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
  if (pe.kind === "swimmer") { drawSwimmer(pe); return; }
  if (pe.kind === "passenger") { drawPassenger(pe); return; }
  // FANS celebrate: a bigger, faster bounce plus a side-to-side shake and two
  // raised arms, so the crowd around the estadio and la plaza reads as a crowd
  // rather than commuters who happen to be walking in a circle.
  const fan = pe.kind === "fan";
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
function drawBoat(b) {
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(b.x - 40 - Math.sign(b.vx) * 12, b.y + 4, 32, 2);
  if (b.kind === "ferry") {
    ctx.fillStyle = "#fff"; ctx.fillRect(b.x - 28, b.y - 6, 56, 10);
    ctx.fillStyle = "#3a3540"; ctx.fillRect(b.x - 28, b.y + 2, 56, 4);
    ctx.fillStyle = "#e85d75"; ctx.fillRect(b.x - 4, b.y - 14, 6, 10);
  } else {
    ctx.fillStyle = "#caa089"; ctx.beginPath();
    ctx.moveTo(b.x - 14, b.y); ctx.lineTo(b.x + 14, b.y);
    ctx.lineTo(b.x + 10, b.y + 4); ctx.lineTo(b.x - 10, b.y + 4); ctx.closePath(); ctx.fill();
  }
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

// Vehicle sprite painter, reused by the in-game player draw and the UI
// vehicle preview (StageSelect). Draws centered at (0,0) facing +x.
function paintVehicle(g, key, veh) {
  const ctx = g;
  if (veh.kind === "bike") {
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
      ctx.fillStyle = "#e8e4da"; ctx.fillRect(-veh.w/2 + 2, -4, 5, 8);    // cooler box on the back
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

function drawPlayer(p, veh) {
  const lift = (state.elev || 0) * 7;   // the barro avenue rides ~1 m up
  ctx.save();
  drawTurnWind(p, veh, lastT);
  // ground shadow — the body's own silhouette, dropped further behind and
  // faded as the car climbs the ramp
  ctx.save(); ctx.translate(p.x + 4 + lift * 0.6, p.y + 6 + lift); ctx.rotate(p.a);
  ctx.fillStyle = `rgba(0,0,0,${(0.35 - lift * 0.02).toFixed(3)})`;
  traceVehicleSilhouette(ctx, state.vehicleKey, veh); ctx.fill(); ctx.restore();
  ctx.translate(p.x, p.y - lift); ctx.rotate(p.a);
  paintVehicle(ctx, state.vehicleKey, veh);
  if (state.carrying) {
    const m = state.carrying.melt / state.carrying.total;
    ctx.fillStyle = "#fff"; ctx.fillRect(-3, -veh.h/2 - 6, 6, 8);
    const hRed = 6 * (1 - m * 0.5);
    ctx.fillStyle = `oklch(0.62 0.22 ${25 + m * 20})`;
    ctx.fillRect(-3, -veh.h/2 - 6 + (6 - hRed), 6, hRed);
    ctx.fillStyle = "#fff"; ctx.fillRect(-3, -veh.h/2 - 7, 6, 2);
  }
  ctx.restore();
}

// Hybrid overlay: Pixi owns the player body/shadow; this draws only the
// churchill melt bar riding above the car (game-critical UI, not bodywork).
function drawPlayerCarrying(p, veh) {
  if (!state.carrying) return;
  const lift = (state.elev || 0) * 7;
  ctx.save();
  ctx.translate(p.x, p.y - lift); ctx.rotate(p.a);
  const m = state.carrying.melt / state.carrying.total;
  ctx.fillStyle = "#fff"; ctx.fillRect(-3, -veh.h/2 - 6, 6, 8);
  const hRed = 6 * (1 - m * 0.5);
  ctx.fillStyle = `oklch(0.62 0.22 ${25 + m * 20})`;
  ctx.fillRect(-3, -veh.h/2 - 6 + (6 - hRed), 6, hRed);
  ctx.fillStyle = "#fff"; ctx.fillRect(-3, -veh.h/2 - 7, 6, 2);
  ctx.restore();
}

export { drawAnimal, drawArcadeCoin, drawBoat, drawCar, drawGull, drawPed, drawPlayer, drawPlayerCarrying, drawSwimmer, drawTargetCustomer, drawTrain, drawTurnWind, drawVendor, paintVehicle };
