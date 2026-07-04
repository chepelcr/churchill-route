// La Ruta del Churchill — Game engine v2 (high-fidelity peninsula)
// Exposes window.Game

(function () {
  const W = window.WORLD;

  // ----- Vehicle stats -----------------------------------------------------
  const VEHICLES = {
    bici:    { name: "Bicicleta + cooler",  accel: 240, top: 270, turn: 3.5, grip: 0.86, melt: 0.7, color: "#2e8bd6", roof: "#ffe6b3", w: 22, h: 14, kind:"bike" },
    scooter: { name: "Scooter retro",        accel: 330, top: 350, turn: 3.1, grip: 0.78, melt: 1.0, color: "#e85d75", roof: "#fff",    w: 24, h: 14, kind:"bike" },
    tuktuk:  { name: "Tuk-tuk porteño",      accel: 290, top: 320, turn: 2.8, grip: 0.74, melt: 0.9, color: "#f3c969", roof: "#3a3a48", w: 28, h: 18, kind:"car"  },
    cart:    { name: "Mini carrito helado",  accel: 260, top: 290, turn: 2.5, grip: 0.7,  melt: 0.55,color: "#fff",    roof: "#e85d75", w: 30, h: 18, kind:"car"  },
    pickup:  { name: "Pickup pescador",      accel: 370, top: 410, turn: 2.4, grip: 0.68, melt: 1.1, color: "#6fbf99", roof: "#4a3a2a", w: 34, h: 20, kind:"car"  },
    turbo:   { name: "Turbo Churchill Kart", accel: 500, top: 540, turn: 3.2, grip: 0.62, melt: 1.3, color: "#ff3d80", roof: "#fff36b", w: 26, h: 16, kind:"car"  },
  };

  // ----- State -------------------------------------------------------------
  const state = {
    running: false, paused: false, over: false, won: false,
    mode: "arcade",           // arcade | story | freeplay
    stageIdx: 0,              // index into WORLD.STAGES
    weather: "sunny",
    timeOfDay: 0.55,
    vehicleKey: "scooter", veh: VEHICLES.scooter,
    p: { x: 1500, y: 760, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 },
    cam: { x: 1500, y: 760, shake: 0 },
    carrying: null,
    pendingOrder: null,
    score: 0, combo: 1, comboTimer: 0,
    deliveries: 0, perfect: 0,
    timeLeft: 180,
    storyTip: "",
    particles: [], floats: [],
    rainT: 0,
    // Active stage data
    stage: null,
    stageDeliveries: 0,
    stageTarget: 0,
  };

  // ----- Progression / unlocks (persisted in localStorage) ----------------
  const STORAGE_KEY = "churchill_progress_v1";
  function loadProgress() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (!s) return { unlocked: ["faro", "carmen"], clearedStages: [], best: 0 };
      const o = JSON.parse(s);
      if (!o.unlocked || !o.unlocked.length) o.unlocked = ["faro", "carmen"];
      return o;
    } catch (e) { return { unlocked: ["faro", "carmen"], clearedStages: [], best: 0 }; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); } catch (e) {}
  }
  function unlockDistrict(id) {
    if (!state.progress.unlocked.includes(id)) {
      state.progress.unlocked.push(id);
      saveProgress();
      pushFloat(state.p.x, state.p.y - 50, `¡${id.toUpperCase()} DESBLOQUEADO!`, "#ffe06b");
    }
  }
  function markStageCleared(stageId, score) {
    if (!state.progress.clearedStages.includes(stageId)) state.progress.clearedStages.push(stageId);
    state.progress.best = Math.max(state.progress.best || 0, score);
    saveProgress();
  }
  // build barrier list for explore mode based on locked districts
  function rebuildBarriers() {
    state.barriers = [];
    if (state.mode !== "explore") return;
    for (let i = 0; i < W.DISTRICTS.length; i++) {
      const d = W.DISTRICTS[i];
      if (state.progress.unlocked.includes(d.id)) continue;
      // place a barrier at the district's western edge
      state.barriers.push({
        x: d.x0 + 4,
        district: d.id,
        requiredStage: i, // since unlocks are added per stage cleared
      });
    }
  }
  state.progress = loadProgress();
  const keys = {};
  const input = { up: 0, down: 0, left: 0, right: 0, brake: 0, boost: 0 };
  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
  let touchJoy = { active: false, dx: 0, dy: 0 };
  let touchGas = false, touchBrake = false;

  function readInput() {
    input.up    = (keys.w || keys.arrowup) ? 1 : 0;
    input.down  = (keys.s || keys.arrowdown) ? 1 : 0;
    input.left  = (keys.a || keys.arrowleft) ? 1 : 0;
    input.right = (keys.d || keys.arrowright) ? 1 : 0;
    input.brake = (keys[" "] || keys.shift) ? 1 : 0;
    input.boost = (keys.x) ? 1 : 0;
    if (touchJoy.active) {
      const dx = touchJoy.dx, dy = touchJoy.dy;
      if (Math.abs(dx) > 6) { if (dx > 0) input.right = Math.min(1, dx / 40); else input.left = Math.min(1, -dx / 40); }
      if (Math.abs(dy) > 6) { if (dy < 0) input.up = Math.min(1, -dy / 40); else input.down = Math.min(1, dy / 40); }
    }
    if (touchGas) input.up = 1;
    if (touchBrake) input.brake = 1;
  }
  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const lx = p.axes[0] || 0, ly = p.axes[1] || 0;
      if (Math.abs(lx) > 0.15) { if (lx > 0) input.right = Math.max(input.right, lx); else input.left = Math.max(input.left, -lx); }
      if (Math.abs(ly) > 0.15) { if (ly < 0) input.up = Math.max(input.up, -ly); else input.down = Math.max(input.down, ly); }
      if (p.buttons[0] && p.buttons[0].pressed) input.up = 1;
      if (p.buttons[2] && p.buttons[2].pressed) input.brake = 1;
      if (p.buttons[7] && p.buttons[7].value) input.up = Math.max(input.up, p.buttons[7].value);
      if (p.buttons[5] && p.buttons[5].pressed) input.boost = 1;
      break;
    }
  }

  // ----- World entities ----------------------------------------------------
  const traffic = [];
  const pedestrians = [];
  const gulls = [];
  const boats = [];

  function spawnTraffic() {
    traffic.length = 0;
    const palette = ["#9bc4d4", "#f4d77a", "#e85d75", "#6fbf99", "#caa089", "#fff", "#3a3a48", "#f08a5d"];
    // Ruta 17 (main road) — densest
    const ruta = W.AVENIDAS[1];
    for (let x = 60; x < W.W; x += 140 + Math.random() * 120) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const lane = dir > 0 ? -10 : 10;
      traffic.push({
        x, y: W.avenidaYAt(ruta, x) + lane,
        vx: dir * (100 + Math.random() * 60),
        color: palette[Math.floor(Math.random() * palette.length)],
        w: 30, h: 14, road: ruta, lane, dir,
        kind: Math.random() < 0.18 ? "truck" : "car",
      });
    }
    // Av 2 and Av 3 (lighter)
    for (const av of [W.AVENIDAS[0], W.AVENIDAS[2]]) {
      for (let x = 100; x < W.W; x += 260 + Math.random() * 200) {
        if (W.botY(x) - W.topY(x) < 80) continue;
        const dir = Math.random() < 0.5 ? 1 : -1;
        traffic.push({
          x, y: W.avenidaYAt(av, x),
          vx: dir * (70 + Math.random() * 40),
          color: palette[Math.floor(Math.random() * palette.length)],
          w: 26, h: 13, road: av, lane: 0, dir, kind: "car",
        });
      }
    }
  }
  function spawnPedestrians() {
    pedestrians.length = 0;
    const av4 = W.AVENIDAS[3];
    for (let x = 1100; x < 3400; x += 30 + Math.random() * 50) {
      const y = W.avenidaYAt(av4, x) + (Math.random() < 0.5 ? -6 : 14);
      pedestrians.push({ x, y, vx: (Math.random() < 0.5 ? 1 : -1) * (16 + Math.random() * 14), hue: Math.floor(Math.random() * 360), ph: Math.random() * Math.PI * 2 });
    }
  }
  function spawnGulls() {
    gulls.length = 0;
    for (let i = 0; i < 26; i++) {
      gulls.push({
        x: Math.random() * W.W,
        y: (Math.random() < 0.5 ? -40 - Math.random() * 200 : W.H + Math.random() * 200),
        vx: (Math.random() < 0.5 ? 1 : -1) * (40 + Math.random() * 50),
        vy: (Math.random() - 0.5) * 20,
        ph: Math.random() * Math.PI * 2,
      });
    }
    // map them to actual water above/below peninsula at draw time
    for (const g of gulls) {
      const top = W.topY(g.x);
      const bot = W.botY(g.x);
      if (g.y < top) g.y = Math.max(0, top - 30 - Math.random() * 200);
      else g.y = Math.min(W.H, bot + 30 + Math.random() * 200);
    }
  }
  function spawnBoats() {
    boats.length = 0;
    // Ferries / pangas in Gulf and Estero
    for (let i = 0; i < 6; i++) {
      boats.push({
        x: 400 + Math.random() * (W.W - 800),
        y: W.botY(2000) + 80 + Math.random() * 200,
        vx: (Math.random() < 0.5 ? 1 : -1) * (12 + Math.random() * 14),
        kind: i < 2 ? "ferry" : "panga",
        wake: 0,
      });
    }
    for (let i = 0; i < 5; i++) {
      boats.push({
        x: 200 + Math.random() * (W.W - 400),
        y: W.topY(2000) - 60 - Math.random() * 150,
        vx: (Math.random() < 0.5 ? 1 : -1) * (8 + Math.random() * 10),
        kind: "panga", wake: 0,
      });
    }
  }

  // ----- Delivery ----------------------------------------------------------
  function activeKiosks() {
    // If stage is active, only those kiosks are valid
    if (state.stage) {
      return state.stage.kiosks.map(id => W.landmarkById(id)).filter(Boolean);
    }
    return W.LANDMARKS.filter(l => l.type === "kiosk");
  }
  function activeCustomers() {
    if (state.stage) return state.stage.customers.map(id => W.customerById(id)).filter(Boolean);
    return W.CUSTOMERS;
  }
  function nearestKiosk(p) {
    let best = null, bd = Infinity;
    for (const lm of activeKiosks()) {
      const d = Math.hypot(p.x - lm.x, p.y - lm.y);
      if (d < bd) { bd = d; best = lm; }
    }
    return { lm: best, d: bd };
  }
  function pickCustomer() {
    const pool = activeCustomers();
    state.pendingOrder = pool[Math.floor(Math.random() * pool.length)];
  }
  function pickUpChurchill(kioskLm) {
    if (!state.pendingOrder) pickCustomer();
    const dist = Math.hypot(state.pendingOrder.x - kioskLm.x, state.pendingOrder.y - kioskLm.y);
    const base = Math.max(18, dist / 110);
    state.carrying = { kioskId: kioskLm.id, customer: state.pendingOrder, melt: 0, total: base };
    state.pendingOrder = null;
    state.storyTip = `Llevale a ${state.carrying.customer.name}.`;
    pushFloat(kioskLm.x, kioskLm.y - 24, "+ CHURCHILL", "#fff");
  }
  function deliverChurchill() {
    const c = state.carrying;
    const meltPct = c.melt / c.total;
    const base = 250;
    const speedBonus = Math.round(state.p.speed * 0.4);
    const meltBonus = Math.round((1 - meltPct) * 500);
    const total = Math.round((base + speedBonus + meltBonus) * state.combo);
    state.score += total;
    state.deliveries += 1;
    state.stageDeliveries += 1;
    if (meltPct < 0.25) state.perfect += 1;
    state.combo = Math.min(8, state.combo + (meltPct < 0.4 ? 1 : 0));
    state.comboTimer = 7;
    pushFloat(state.p.x, state.p.y - 24, `+${total}`, meltPct < 0.25 ? "#ffe06b" : "#fff");
    if (meltPct < 0.25) pushFloat(state.p.x, state.p.y - 44, "PERFECTO!", "#ff3d80");
    pushFloat(c.customer.x, c.customer.y - 22, c.customer.line.slice(0, 26), "#fff");
    state.carrying = null;
    state.storyTip = "¡Pura vida! Volvé al kiosco.";
    if (state.mode === "arcade") state.timeLeft += meltPct < 0.4 ? 10 : 5;
    if (state.mode === "explore") state.timeLeft += meltPct < 0.4 ? 12 : 6;
    // stage clear check
    if (state.stage && state.stageDeliveries >= state.stageTarget) {
      state.won = true;
      state.over = true;
      // Unlock the next district + record progress
      markStageCleared(state.stage.id, state.score);
      if (state.stage.unlock) unlockDistrict(state.stage.unlock);
      // also unlock the next stage's district as a stretch
      const nextS = W.STAGES[state.stageIdx + 1];
      if (nextS && nextS.unlock) unlockDistrict(nextS.unlock);
    } else {
      pickCustomer();
    }
  }
  function dropChurchill() {
    pushFloat(state.p.x, state.p.y - 18, "¡SE DERRITIÓ!", "#ff3d80");
    state.carrying = null;
    state.combo = 1;
    state.storyTip = "Volvé al kiosco por otro Churchill.";
  }
  function pushFloat(x, y, text, color) { state.floats.push({ x, y, text, color, t: 0, ttl: 1.6 }); }

  // ----- Update -------------------------------------------------------------
  let lastT = 0;
  function update(dt) {
    if (state.paused || state.over) return;
    readInput(); pollGamepad();

    const p = state.p; const veh = state.veh;
    const onRoad = W.onRoad(p.x, p.y);
    const onPaseo = W.onPaseo(p.x, p.y);
    const inWater = W.inWater(p.x, p.y);
    const onBeach = W.onBeach(p.x, p.y);
    const surfaceMul = inWater ? 0.35 : onRoad ? 1.0 : onPaseo ? 0.55 : onBeach ? 0.7 : 0.78;
    const wetMul = state.weather === "storm" ? 0.85 : 1;

    // turning
    const turning = input.right - input.left;
    const turnRate = veh.turn * (0.4 + Math.min(1, Math.abs(p.speed) / veh.top) * 0.9);
    p.a += turning * turnRate * dt * (input.brake ? 1.35 : 1);

    // acceleration
    const throttle = input.up - input.down * 0.6;
    p.vx += Math.cos(p.a) * veh.accel * throttle * dt;
    p.vy += Math.sin(p.a) * veh.accel * throttle * dt;
    if (input.boost) { p.vx *= 1 + 0.7 * dt; p.vy *= 1 + 0.7 * dt; }

    // grip (kill lateral)
    const heading = { x: Math.cos(p.a), y: Math.sin(p.a) };
    const fwd = p.vx * heading.x + p.vy * heading.y;
    const side = -p.vx * heading.y + p.vy * heading.x;
    const grip = veh.grip * (input.brake ? 0.55 : 1) * wetMul;
    const kept = side * (1 - Math.min(1, grip * dt * 6));
    p.vx = heading.x * fwd - heading.y * kept;
    p.vy = heading.y * fwd + heading.x * kept;
    p.drift = Math.abs(side) > 60 ? Math.min(1, p.drift + dt * 3) : Math.max(0, p.drift - dt * 2);

    // rolling friction
    const fric = (input.up || input.down) ? 0.4 : 1.8;
    const sp2 = Math.hypot(p.vx, p.vy);
    if (sp2 > 0.1) {
      const k = Math.max(0, sp2 - fric * (1 / surfaceMul) * dt * 60) / sp2;
      p.vx *= k; p.vy *= k;
    }
    const top = veh.top * surfaceMul * (input.boost ? 1.35 : 1) * wetMul;
    const sp3 = Math.hypot(p.vx, p.vy);
    if (sp3 > top) { p.vx *= top / sp3; p.vy *= top / sp3; }

    p.x += p.vx * dt; p.y += p.vy * dt;
    p.speed = Math.hypot(p.vx, p.vy);

    // Peninsula bounds: push back into land if we slid in water too far
    const topY = W.topY(p.x), botY = W.botY(p.x);
    if (p.y < topY - 30) { p.y = topY - 30; p.vy = Math.abs(p.vy) * 0.4; }
    if (p.y > botY + 30) { p.y = botY + 30; p.vy = -Math.abs(p.vy) * 0.4; }
    if (p.x < 12) { p.x = 12; p.vx = Math.abs(p.vx) * 0.3; }
    if (p.x > W.W - 12) { p.x = W.W - 12; p.vx = -Math.abs(p.vx) * 0.3; }
    if (inWater && Math.random() < 0.1) state.cam.shake = Math.max(state.cam.shake, 4);

    // Building collisions
    for (const b of W.BUILDINGS) {
      if (p.x > b.x - 8 && p.x < b.x + b.w + 8 && p.y > b.y - 6 && p.y < b.y + b.h + 6) {
        const dxL = (p.x - b.x), dxR = (b.x + b.w) - p.x;
        const dyT = (p.y - b.y), dyB = (b.y + b.h) - p.y;
        const m = Math.min(dxL, dxR, dyT, dyB);
        if (m === dxL) p.x = b.x - 9;
        else if (m === dxR) p.x = b.x + b.w + 9;
        else if (m === dyT) p.y = b.y - 7;
        else p.y = b.y + b.h + 7;
        p.vx *= -0.25; p.vy *= -0.25;
        state.cam.shake = Math.max(state.cam.shake, 6);
        if (state.carrying && Math.random() < 0.06) dropChurchill();
      }
    }

    // Barrier collisions (explore mode locked districts)
    if (state.barriers && state.barriers.length) {
      for (const br of state.barriers) {
        if (Math.abs(p.x - br.x) < 14) {
          if (p.x > br.x - 14 && p.x < br.x) {
            p.x = br.x - 14; p.vx = -Math.abs(p.vx) * 0.4;
            state.cam.shake = Math.max(state.cam.shake, 8);
            state.storyTip = `Etapa ${br.requiredStage} requerida para entrar a ${br.district.toUpperCase()}.`;
          } else if (p.x > br.x && p.x < br.x + 14) {
            // can re-enter going west: allow
          }
        }
      }
    }

    // Drift sparks
    if (p.drift > 0.4 && p.speed > 80) {
      state.particles.push({
        x: p.x - Math.cos(p.a) * 10 + (Math.random() - 0.5) * 6,
        y: p.y - Math.sin(p.a) * 10 + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
        life: 0.9, r: 5 + Math.random() * 4, c: "rgba(240,220,180,0.55)",
      });
    }

    // Pickup / delivery
    const nk = nearestKiosk(p);
    if (!state.carrying && nk.lm && nk.d < 38 && p.speed < 60) {
      if (!state.pendingOrder) pickCustomer();
      pickUpChurchill(nk.lm);
    }
    if (state.carrying) {
      const c = state.carrying.customer;
      const dc = Math.hypot(p.x - c.x, p.y - c.y);
      if (dc < 36 && p.speed < 80) deliverChurchill();
    }
    if (state.carrying) {
      const heat = state.weather === "sunset" ? 0.9 : state.weather === "storm" ? 1.05 : state.weather === "night" ? 0.7 : 1.0;
      const meltRate = state.veh.melt * (onRoad ? 1.0 : 1.25) * heat;
      state.carrying.melt += dt * meltRate;
      if (state.carrying.melt >= state.carrying.total) dropChurchill();
    }

    // Camera follow with lookahead
    const look = 70;
    const tx = p.x + Math.cos(p.a) * look;
    const ty = p.y + Math.sin(p.a) * look;
    state.cam.x += (tx - state.cam.x) * Math.min(1, dt * 4);
    state.cam.y += (ty - state.cam.y) * Math.min(1, dt * 4);
    state.cam.shake = Math.max(0, state.cam.shake - dt * 22);

    // Combo decay
    if (state.combo > 1) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 1;
    }

    // Floats / particles
    for (const f of state.floats) { f.t += dt; f.y -= 16 * dt; }
    state.floats = state.floats.filter(f => f.t < f.ttl);
    for (const pt of state.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt; }
    state.particles = state.particles.filter(pt => pt.life > 0);

    // Traffic
    for (const t of traffic) {
      t.x += t.vx * dt;
      if (t.x < -60) t.x = W.W + 30;
      if (t.x > W.W + 60) t.x = -30;
      t.y = W.avenidaYAt(t.road, t.x) + (t.lane || 0);
      if (Math.abs(t.x - p.x) < 20 && Math.abs(t.y - p.y) < 14) {
        p.vx -= (t.x - p.x) * 0.8; p.vy -= (t.y - p.y) * 0.8;
        state.cam.shake = Math.max(state.cam.shake, 10);
        if (state.carrying && Math.random() < 0.18) dropChurchill();
      }
    }

    // Pedestrians
    for (const pe of pedestrians) {
      pe.x += pe.vx * dt; pe.ph += dt * 6;
      const av4y = W.avenidaYAt(W.AVENIDAS[3], pe.x);
      if (pe.y < av4y - 16) pe.y += 8 * dt;
      if (pe.y > av4y + 16) pe.y -= 8 * dt;
      if (pe.x < 1080) pe.vx = Math.abs(pe.vx);
      if (pe.x > 3400) pe.vx = -Math.abs(pe.vx);
      if (Math.abs(pe.x - p.x) < 14 && Math.abs(pe.y - p.y) < 12 && p.speed > 40) {
        for (let i = 0; i < 6; i++) state.particles.push({ x: pe.x, y: pe.y, vx: (Math.random()-0.5)*180, vy: (Math.random()-0.5)*180, life: 0.7, r: 3, c: "#fff" });
        pe.x += (pe.x - p.x) * 0.3;
      }
    }

    // Gulls
    for (const g of gulls) {
      g.x += g.vx * dt; g.y += g.vy * dt; g.ph += dt * 8;
      if (g.x < 0) g.x = W.W; if (g.x > W.W) g.x = 0;
      const top = W.topY(g.x), bot = W.botY(g.x);
      if (g.y > top - 20 && g.y < bot + 20) g.vy = (g.y < (top+bot)/2 ? -1 : 1) * Math.abs(g.vy || 20);
      if (state.carrying && Math.hypot(g.x - p.x, g.y - p.y) < 70 && Math.random() < 0.005) {
        if (Math.random() < 0.3) dropChurchill();
      }
    }
    // Boats drift
    for (const b of boats) {
      b.x += b.vx * dt; b.wake += dt;
      if (b.x < -120) b.x = W.W + 80;
      if (b.x > W.W + 120) b.x = -80;
    }

    if (state.weather === "storm") state.rainT += dt;

    // Arcade timer (also stage timer)
    if (state.mode === "arcade" || state.mode === "story") {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) { state.timeLeft = 0; state.over = true; state.won = false; }
    }
    if (state.mode === "explore") {
      // Long, generous timer — encourages cruising
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) state.timeLeft = 999;
    }
  }

  // ----- Render -------------------------------------------------------------
  let canvas, ctx, dpr = 1;
  function setupCanvas(c) {
    canvas = c; ctx = c.getContext("2d");
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    };
    resize(); window.addEventListener("resize", resize);
  }

  function weatherColors() {
    const w = state.weather;
    if (w === "storm")  return { sky1: "#3a4a5e", sky2: "#5a6a7e", waterTop: "#3b6f7a", waterBot: "#244b56", sand: "#a89870", land: "#8a9c70", tint: "rgba(40,55,80,0.35)" };
    if (w === "sunset") return { sky1: "#ff8b5a", sky2: "#ff3d80", waterTop: "#d28a6a", waterBot: "#7a4060", sand: "#f4c98b", land: "#cda06a", tint: "rgba(255,80,80,0.12)" };
    if (w === "night")  return { sky1: "#0e1530", sky2: "#222244", waterTop: "#1a2a44", waterBot: "#0a1428", sand: "#6a5a48", land: "#4a5040", tint: "rgba(10,10,30,0.45)" };
    return                   { sky1: "#9fd9ec", sky2: "#ffe6b3", waterTop: "#62c2c9", waterBot: "#2e8090", sand: "#f1d29a", land: "#cfb27a", tint: "rgba(255,235,200,0.04)" };
  }

  // ---- Drawing helpers ----
  function roundRect(c, x, y, w, h, r, fill, stroke) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r); c.closePath();
    if (fill) c.fill(); if (stroke) c.stroke();
  }

  function drawWaterAll(view, t) {
    // Full background = water
    const C = weatherColors();
    const g = ctx.createLinearGradient(0, view.y0, 0, view.y1);
    g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
    ctx.fillStyle = g;
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    // Shimmer lines
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    const tt = t * 0.0006;
    for (let yy = view.y0; yy < view.y1; yy += 26) {
      ctx.beginPath();
      for (let xx = view.x0; xx < view.x1; xx += 20) {
        const yo = Math.sin(tt + xx * 0.04 + yy * 0.03) * 2.2;
        if (xx === view.x0) ctx.moveTo(xx, yy + yo);
        else ctx.lineTo(xx, yy + yo);
      }
      ctx.stroke();
    }
  }

  function drawLand(view) {
    const C = weatherColors();
    // Beach sand outline (slightly larger than land)
    const xs = Math.max(0, view.x0 - 40);
    const xe = Math.min(W.W, view.x1 + 40);
    ctx.fillStyle = C.sand;
    ctx.beginPath();
    let started = false;
    for (let x = xs; x <= xe; x += 6) {
      const y = W.topY(x) - 12;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    for (let x = xe; x >= xs; x -= 6) {
      const y = W.botY(x) + 12;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    // Land polygon
    ctx.fillStyle = C.land;
    ctx.beginPath();
    started = false;
    for (let x = xs; x <= xe; x += 6) {
      const y = W.topY(x);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    for (let x = xe; x >= xs; x -= 6) {
      ctx.lineTo(x, W.botY(x));
    }
    ctx.closePath();
    ctx.fill();
    // Subtle district tone
    for (const d of W.DISTRICTS) {
      if (d.x1 < view.x0 || d.x0 > view.x1) continue;
      ctx.save();
      ctx.beginPath();
      const x0 = Math.max(xs, d.x0), x1 = Math.min(xe, d.x1);
      let s = false;
      for (let x = x0; x <= x1; x += 6) {
        const y = W.topY(x);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      }
      for (let x = x1; x >= x0; x -= 6) {
        ctx.lineTo(x, W.botY(x));
      }
      ctx.closePath();
      ctx.fillStyle = d.tone; ctx.globalAlpha = 0.12; ctx.fill();
      ctx.restore();
    }
    // Coastline stroke
    ctx.strokeStyle = "rgba(40,30,20,0.35)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = xs; x <= xe; x += 6) {
      const y = W.topY(x);
      if (x === xs) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let x = xs; x <= xe; x += 6) {
      const y = W.botY(x);
      if (x === xs) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawStreets(view) {
    // Avenidas
    for (const av of W.AVENIDAS) {
      const xs = Math.max(0, view.x0 - 20), xe = Math.min(W.W, view.x1 + 20);
      ctx.fillStyle = av.paseo ? "#f4dca3" : "#3a3540";
      ctx.beginPath();
      let s = false;
      for (let x = xs; x <= xe; x += 6) {
        const y = W.avenidaYAt(av, x) - av.w / 2;
        if (W.topY(x) > y - 4) continue;
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      }
      for (let x = xe; x >= xs; x -= 6) {
        const y = W.avenidaYAt(av, x) + av.w / 2;
        if (W.botY(x) < y + 4) continue;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      // Paseo: coral stripes
      if (av.paseo) {
        ctx.fillStyle = "rgba(232,93,117,0.22)";
        for (let x = xs; x < xe; x += 50) {
          const y = W.avenidaYAt(av, x);
          ctx.fillRect(x, y - 10, 26, 4);
          ctx.fillRect(x + 10, y + 6, 26, 4);
        }
      }
      // Lane lines (primary)
      if (av.primary) {
        ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([18, 18]);
        ctx.beginPath();
        for (let x = xs; x <= xe; x += 6) {
          const y = W.avenidaYAt(av, x);
          if (W.topY(x) > y || W.botY(x) < y) continue;
          if (x === xs) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      } else if (av.dashed) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1; ctx.setLineDash([8, 14]);
        ctx.beginPath();
        for (let x = xs; x <= xe; x += 6) {
          const y = W.avenidaYAt(av, x);
          if (x === xs) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // Calles
    for (const c of W.CALLES) {
      if (c.x + 20 < view.x0 || c.x - 20 > view.x1) continue;
      const yT = W.topY(c.x) + 4;
      const yB = W.botY(c.x) - 4;
      ctx.fillStyle = "#3a3540";
      ctx.fillRect(c.x - c.w / 2, yT, c.w, yB - yT);
      // dashed center
      ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([6, 10]);
      ctx.beginPath(); ctx.moveTo(c.x, yT); ctx.lineTo(c.x, yB); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function drawStreetLabels(view) {
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    // Avenida names — place every ~1200px along its length
    for (const av of W.AVENIDAS) {
      const labelXs = [800, 2000, 3200, 4400, 5600];
      for (const lx of labelXs) {
        if (lx < view.x0 - 80 || lx > view.x1 + 80) continue;
        if (W.botY(lx) - W.topY(lx) < 80) continue;
        const ly = W.avenidaYAt(av, lx);
        const lbl = av.name.split(" · ")[0];
        const w = ctx.measureText(lbl).width + 10;
        ctx.fillStyle = "rgba(20,16,40,0.78)"; ctx.fillRect(lx - w/2, ly - 6, w, 12);
        ctx.fillStyle = "#fff"; ctx.fillText(lbl, lx, ly + 3);
      }
    }
    // Calle names — only in centro (denser, like the real map)
    for (const c of W.CALLES) {
      if (c.x < view.x0 - 60 || c.x > view.x1 + 60) continue;
      if (c.x < 2400 || c.x > 3600) continue;
      const ly = W.botY(c.x) - 22;
      const lbl = c.name;
      const w = ctx.measureText(lbl).width + 8;
      ctx.fillStyle = "rgba(20,16,40,0.65)"; ctx.fillRect(c.x - w/2, ly - 6, w, 12);
      ctx.fillStyle = "#fff"; ctx.fillText(lbl, c.x, ly + 3);
    }
  }

  function drawBuildings(view) {
    for (const b of W.BUILDINGS) {
      if (b.x + b.w < view.x0 || b.x > view.x1) continue;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(b.x + 4, b.y + 4, b.w, b.h);
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x, b.y, b.w, Math.max(3, b.h * 0.3));
      if (b.wnd) {
        ctx.fillStyle = state.weather === "night" ? "rgba(255,220,140,0.7)" : "rgba(255,255,255,0.55)";
        const wn = Math.max(1, Math.floor(b.w / 16));
        for (let i = 0; i < wn; i++) ctx.fillRect(b.x + 4 + i * (b.w / wn), b.y + b.h * 0.55, 4, 3);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    }
  }

  function drawPalms(view, t) {
    for (const pa of W.PALMS) {
      if (pa.x < view.x0 - 30 || pa.x > view.x1 + 30) continue;
      const sway = Math.sin(t * 0.001 + pa.sway) * 2;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(pa.x + 6, pa.y + 5, 12 * pa.s, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#7a4f2a"; ctx.lineWidth = 3 * pa.s;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y + 4); ctx.lineTo(pa.x + sway, pa.y - 16 * pa.s); ctx.stroke();
      ctx.fillStyle = "#3aa45b";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + sway * 0.06;
        const fx = pa.x + sway + Math.cos(a) * 11 * pa.s;
        const fy = pa.y - 16 * pa.s + Math.sin(a) * 5 * pa.s;
        ctx.beginPath(); ctx.ellipse(fx, fy, 9 * pa.s, 3.2 * pa.s, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#2e7d44";
      ctx.beginPath(); ctx.arc(pa.x + sway, pa.y - 16 * pa.s, 2.5 * pa.s, 0, Math.PI * 2); ctx.fill();
    }
  }

  function label(x, y, text, fg, bg) {
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg; ctx.fillRect(x - w/2, y - 8, w, 12);
    ctx.fillStyle = fg; ctx.fillText(text, x, y + 1);
  }

  function drawLandmark(lm) {
    const x = lm.x, y = lm.y;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(x + 4, y + 8, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    switch (lm.type) {
      case "kiosk": {
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 16, y - 8, 32, 18);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? "#fff" : "#e85d75"; ctx.fillRect(x - 16 + i * 8, y - 14, 8, 6); }
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(x - 4, y - 4, 8, 12);
        ctx.fillStyle = "#ff3d80"; ctx.fillRect(x - 4, y, 8, 6);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 4, y - 4, 8, 3);
        label(x, y - 22, "CHURCHILL", "#fff", "#e85d75"); break;
      }
      case "ferry":
      case "cruise": {
        ctx.fillStyle = lm.type === "cruise" ? "#fff" : "#3a6f8a";
        ctx.fillRect(x - 28, y - 10, 56, 22);
        ctx.fillStyle = "#f4d77a"; ctx.fillRect(x - 28, y - 14, 56, 4);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 22, 12, 8);
        label(x, y - 28, lm.type === "cruise" ? "MUELLE" : "FERRY", "#fff", "#3a6f8a"); break;
      }
      case "lighthouse": {
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 5, y - 32, 10, 34);
        ctx.fillStyle = "#e85d75"; for (let i=0;i<4;i++) ctx.fillRect(x-5, y - 30 + i*9, 10, 4);
        ctx.fillStyle = "#ffe06b"; ctx.beginPath(); ctx.arc(x, y - 34, 6, 0, Math.PI * 2); ctx.fill();
        label(x, y - 46, "FARO", "#fff", "#3a3540"); break;
      }
      case "church":
      case "cathedral": {
        ctx.fillStyle = "#caa089"; ctx.fillRect(x - 20, y - 12, 40, 24);
        ctx.fillStyle = "#9e6f4a"; ctx.beginPath(); ctx.moveTo(x - 6, y - 12); ctx.lineTo(x, y - 26); ctx.lineTo(x + 6, y - 12); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 0.5, y - 22, 1.5, 6); ctx.fillRect(x - 3, y - 19, 7, 1.5);
        label(x, y - 30, lm.type === "cathedral" ? "CATEDRAL" : "IGLESIA", "#fff", "#9e6f4a"); break;
      }
      case "market": {
        ctx.fillStyle = "#f3c969"; ctx.fillRect(x - 24, y - 12, 48, 24);
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? "#fff" : "#6fbf99"; ctx.fillRect(x - 24 + i * 8, y - 16, 8, 4); }
        label(x, y - 22, "MERCADO", "#fff", "#3a3540"); break;
      }
      case "super": {
        ctx.fillStyle = "#ffec70"; ctx.fillRect(x - 18, y - 12, 36, 22);
        ctx.fillStyle = "#e85d75"; ctx.fillRect(x - 18, y - 16, 36, 4);
        label(x, y - 22, "SÚPER", "#fff", "#e85d75"); break;
      }
      case "hotel": {
        ctx.fillStyle = "#5fb0d6"; ctx.fillRect(x - 16, y - 22, 32, 32);
        for (let r = 0; r < 4; r++) for (let cc = 0; cc < 3; cc++) {
          ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillRect(x - 14 + cc * 10, y - 20 + r * 8, 5, 4);
        }
        label(x, y - 30, lm.name.split(" ")[1] ? lm.name.split(" ")[1].toUpperCase() : "HOTEL", "#fff", "#3a6f8a"); break;
      }
      case "park":
      case "civic":
      case "museum": {
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 20, y - 10, 40, 22);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 6, 12, 12);
        const tag = lm.type === "park" ? "PARQUE" : lm.type === "civic" ? "CULTURA" : "MUSEO";
        label(x, y - 18, tag, "#fff", "#2e7d44"); break;
      }
      case "stadium": {
        ctx.fillStyle = "#3a3540"; ctx.fillRect(x - 24, y - 14, 48, 26);
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 22, y - 12, 44, 22);
        ctx.strokeStyle = "#fff"; ctx.strokeRect(x - 18, y - 8, 36, 14);
        label(x, y - 22, "ESTADIO", "#fff", "#3a3540"); break;
      }
      case "marina": {
        ctx.fillStyle = "#5fb0d6"; ctx.fillRect(x - 18, y - 8, 36, 16);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 4, y - 18, 2, 10); ctx.beginPath(); ctx.moveTo(x - 4, y - 18); ctx.lineTo(x + 6, y - 12); ctx.lineTo(x - 4, y - 8); ctx.fill();
        label(x, y - 24, "YACHT", "#fff", "#3a6f8a"); break;
      }
      case "house": {
        ctx.fillStyle = "#c084d6"; ctx.fillRect(x - 14, y - 10, 28, 20);
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(x - 16, y - 10); ctx.lineTo(x, y - 22); ctx.lineTo(x + 16, y - 10); ctx.fill();
        label(x, y - 26, "CASA FAIT", "#fff", "#c084d6"); break;
      }
      case "estuary": {
        ctx.fillStyle = "#3a6f8a"; ctx.fillRect(x - 16, y - 6, 32, 12);
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 16, y - 12, 8, 8); ctx.fillRect(x + 8, y - 12, 8, 8);
        label(x, y - 20, "MATA LIMÓN", "#fff", "#2e7d44"); break;
      }
      case "restaurant": {
        ctx.fillStyle = "#e85d75"; ctx.fillRect(x - 14, y - 10, 28, 20);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 4, 12, 6);
        label(x, y - 18, "MARISQ.", "#fff", "#e85d75"); break;
      }
      case "beachsign": {
        ctx.strokeStyle = "#3a3540"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14); ctx.stroke();
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 22, y - 18, 44, 8);
        label(x, y - 24, "PLAYA", "#fff", "#2e7d44"); break;
      }
      case "trainstation": {
        ctx.fillStyle = "#caa089"; ctx.fillRect(x - 20, y - 14, 40, 24);
        ctx.fillStyle = "#3a3540"; ctx.fillRect(x - 22, y + 10, 44, 4);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 8, 12, 6);
        label(x, y - 22, "TREN", "#fff", "#9e6f4a"); break;
      }
      case "port": {
        ctx.fillStyle = "#5fb0d6"; ctx.fillRect(x - 28, y - 8, 56, 18);
        // crane
        ctx.strokeStyle = "#f4d77a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 18, y - 22); ctx.lineTo(x - 18, y - 8);
        ctx.moveTo(x - 18, y - 22); ctx.lineTo(x + 6, y - 22);
        ctx.lineTo(x + 6, y - 16);
        ctx.stroke();
        // containers
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = ["#e85d75","#f3c969","#6fbf99","#5fb0d6"][i];
          ctx.fillRect(x - 24 + i * 12, y - 3, 10, 8);
        }
        label(x, y - 30, "PUERTO", "#fff", "#3a6f8a"); break;
      }
      case "sign": {
        ctx.strokeStyle = "#3a3540"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18); ctx.stroke();
        ctx.fillStyle = "#3a6f8a"; ctx.fillRect(x - 30, y - 24, 60, 12);
        ctx.fillStyle = "#fff"; ctx.font = "bold 8px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
        ctx.fillText("BULEVAR", x, y - 15); break;
      }
      case "village": {
        // cluster of three small houses
        for (let i = 0; i < 3; i++) {
          const px = x + (i - 1) * 14;
          ctx.fillStyle = ["#e85d75","#f3c969","#6fbf99"][i];
          ctx.fillRect(px - 6, y - 6, 12, 10);
          ctx.fillStyle = "#9e6f4a";
          ctx.beginPath(); ctx.moveTo(px - 7, y - 6); ctx.lineTo(px, y - 12); ctx.lineTo(px + 7, y - 6); ctx.fill();
        }
        label(x, y - 18, "VILLA", "#fff", "#9e6f4a"); break;
      }
      case "highway": {
        ctx.fillStyle = "#3a6f8a"; ctx.fillRect(x - 18, y - 12, 36, 22);
        ctx.fillStyle = "#fff"; ctx.font = "bold 12px 'Bungee', sans-serif"; ctx.textAlign = "center";
        ctx.fillText("27", x, y + 2);
        label(x, y - 18, "RUTA 27", "#fff", "#3a3540"); break;
      }
      case "bridge": {
        /* drawn separately by drawBridge */ break;
      }
    }
  }

  function drawPed(pe) {
    const bob = Math.sin(pe.ph) * 1.4;
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(pe.x + 1, pe.y + 5, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `hsl(${pe.hue} 70% 60%)`; ctx.fillRect(pe.x - 2, pe.y - 3 + bob, 4, 6);
    ctx.fillStyle = "#f1c8a4"; ctx.beginPath(); ctx.arc(pe.x, pe.y - 5 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  function drawCar(c) {
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(c.x - c.w/2 + 3, c.y - c.h/2 + 3, c.w, c.h);
    ctx.fillStyle = c.color; ctx.fillRect(c.x - c.w/2, c.y - c.h/2, c.w, c.h);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(c.x - c.w/2 + 4, c.y - c.h/2 + 2, c.w - 8, c.h - 4);
    ctx.fillStyle = "#222"; ctx.fillRect(c.x - c.w/2, c.y - c.h/2 - 1, 3, c.h + 2); ctx.fillRect(c.x + c.w/2 - 3, c.y - c.h/2 - 1, 3, c.h + 2);
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

  // Hills behind Mata de Limón / Caldera (drawn in water area before land)
  function drawHills(view) {
    if (!W.HILLS) return;
    for (const h of W.HILLS) {
      if (h.x1 < view.x0 || h.x0 > view.x1) continue;
      const C = weatherColors();
      const tint = state.weather === "night" ? "#1f2c1f" : state.weather === "storm" ? "#3e5a4a" : h.color;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.moveTo(h.x0, h.baseY + 80);
      for (let x = h.x0; x <= h.x1; x += 18) {
        const y = h.baseY + Math.sin((x - h.x0) * 0.012) * 22 + Math.cos((x - h.x0) * 0.006) * 18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(h.x1, h.baseY + 80);
      ctx.closePath();
      ctx.fill();
      // tree texture
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      for (let x = h.x0 + 12; x < h.x1; x += 16) {
        const y = h.baseY + Math.sin((x - h.x0) * 0.012) * 22 + Math.cos((x - h.x0) * 0.006) * 18;
        ctx.beginPath(); ctx.arc(x, y + 4, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Mata de Limón mangrove lagoon — water body inside the land
  function drawEstuary(view) {
    if (!W.ESTUARY) return;
    const E = W.ESTUARY;
    if (E.cx + E.rx < view.x0 || E.cx - E.rx > view.x1) return;
    const C = weatherColors();
    const g = ctx.createRadialGradient(E.cx, E.cy, 10, E.cx, E.cy, Math.max(E.rx, E.ry));
    g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(E.cx, E.cy, E.rx, E.ry, 0, 0, Math.PI * 2); ctx.fill();
    // ripples
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
    for (let r = 24; r < E.rx; r += 24) {
      ctx.beginPath(); ctx.ellipse(E.cx, E.cy, r, r * E.ry / E.rx, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // inlet narrow channel connecting to gulf — draw small notch
    ctx.fillStyle = C.waterBot;
    ctx.fillRect(E.cx - 20, E.cy + E.ry - 6, 40, 30);
  }

  // Mangrove dots around the estuary
  function drawMangroves(view) {
    if (!W.MANGROVES) return;
    for (const m of W.MANGROVES) {
      if (m.x < view.x0 - 20 || m.x > view.x1 + 20) continue;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.arc(m.x + 1, m.y + 2, m.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2e5d3a";
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4a7a4a";
      ctx.beginPath(); ctx.arc(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Suspension bridge — towers, cables, deck, rails
  function drawBridge(view) {
    if (!W.BRIDGE) return;
    const B = W.BRIDGE;
    if (B.x1 < view.x0 || B.x0 > view.x1) return;
    // approach ramps
    ctx.fillStyle = "#7a6a55";
    ctx.fillRect(B.x0 - 32, B.cy - B.deckW/2 - 4, 32, B.deckW + 8);
    ctx.fillRect(B.x1, B.cy - B.deckW/2 - 4, 32, B.deckW + 8);
    // Deck base
    ctx.fillStyle = "#cfc3a3";
    ctx.fillRect(B.x0, B.cy - B.deckW/2 - 4, B.x1 - B.x0, B.deckW + 8);
    // Asphalt
    ctx.fillStyle = "#3a3540";
    ctx.fillRect(B.x0, B.cy - B.deckW/2 + 2, B.x1 - B.x0, B.deckW - 4);
    // Lane dashes
    ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([14, 14]);
    ctx.beginPath(); ctx.moveTo(B.x0 + 4, B.cy); ctx.lineTo(B.x1 - 4, B.cy); ctx.stroke();
    ctx.setLineDash([]);
    // Rails
    ctx.fillStyle = "#a8b0b8";
    ctx.fillRect(B.x0, B.cy - B.deckW/2 - 2, B.x1 - B.x0, 2);
    ctx.fillRect(B.x0, B.cy + B.deckW/2, B.x1 - B.x0, 2);
    // Cables (catenary)
    const [tx0, tx1] = B.towers;
    const towerTop = B.cy - B.towerH;
    const sagY = B.cy - 14;
    ctx.strokeStyle = "#d8dce0"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx0, towerTop);
    ctx.quadraticCurveTo((tx0 + tx1) / 2, sagY, tx1, towerTop);
    ctx.stroke();
    // Side anchor cables
    ctx.beginPath();
    ctx.moveTo(B.x0 - 28, B.cy + 4); ctx.lineTo(tx0, towerTop);
    ctx.moveTo(B.x1 + 28, B.cy + 4); ctx.lineTo(tx1, towerTop);
    ctx.stroke();
    // Vertical hangers
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(220,225,230,0.85)";
    for (let xx = tx0 + 6; xx < tx1; xx += 8) {
      const t = (xx - tx0) / (tx1 - tx0);
      const ty = (1-t)*(1-t)*towerTop + 2*t*(1-t)*sagY + t*t*towerTop;
      ctx.beginPath(); ctx.moveTo(xx, ty); ctx.lineTo(xx, B.cy - 4); ctx.stroke();
    }
    // Towers
    for (const tx of B.towers) {
      ctx.fillStyle = "#9aa3ad";
      ctx.fillRect(tx - 4, towerTop, 3, B.towerH + 4);
      ctx.fillRect(tx + 1, towerTop, 3, B.towerH + 4);
      ctx.fillStyle = "#6a737d";
      ctx.fillRect(tx - 6, towerTop - 4, 12, 4);
      ctx.strokeStyle = "#6a737d"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx - 4, B.cy - B.towerH * 0.5); ctx.lineTo(tx + 4, B.cy - B.towerH * 0.55);
      ctx.stroke();
    }
    // Sign
    ctx.font = "bold 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
    const lbl = "PUENTE MATA LIMÓN";
    const wlbl = ctx.measureText(lbl).width + 10;
    const mx = (B.x0 + B.x1) / 2;
    ctx.fillStyle = "rgba(20,16,40,0.78)"; ctx.fillRect(mx - wlbl/2, B.cy + B.deckW/2 + 14, wlbl, 12);
    ctx.fillStyle = "#fff"; ctx.fillText(lbl, mx, B.cy + B.deckW/2 + 23);
  }

  // District lock barriers (free-roam mode)
  function drawBarriers(view) {
    if (state.mode !== "explore" || !state.barriers) return;
    for (const br of state.barriers) {
      if (br.x < view.x0 - 30 || br.x > view.x1 + 30) continue;
      const yTop = W.topY(br.x), yBot = W.botY(br.x);
      // striped barrier sign + cones
      const segH = 12;
      for (let y = yTop + 6; y < yBot - 6; y += segH) {
        ctx.fillStyle = ((y / segH) | 0) % 2 ? "#f3c969" : "#3a3540";
        ctx.fillRect(br.x - 4, y, 8, segH);
      }
      // sign
      ctx.fillStyle = "rgba(20,16,40,0.85)";
      const sw = 120;
      const sy = (yTop + yBot) / 2;
      ctx.fillRect(br.x - sw/2, sy - 14, sw, 28);
      ctx.fillStyle = "#ff3d80"; ctx.font = "bold 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      ctx.fillText("⛔ BLOQUEADO", br.x, sy - 3);
      ctx.fillStyle = "#fff";
      ctx.fillText("ETAPA " + (br.requiredStage || "—"), br.x, sy + 9);
      // cones
      for (let cy = yTop + 14; cy < yBot - 14; cy += 26) {
        ctx.fillStyle = "#ff8b3d"; ctx.beginPath();
        ctx.moveTo(br.x - 16, cy + 6); ctx.lineTo(br.x - 13, cy - 6); ctx.lineTo(br.x - 10, cy + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(br.x - 15, cy - 2, 4, 1.5);
        ctx.fillStyle = "#ff8b3d"; ctx.beginPath();
        ctx.moveTo(br.x + 10, cy + 6); ctx.lineTo(br.x + 13, cy - 6); ctx.lineTo(br.x + 16, cy + 6); ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawPlayer(p, veh) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.save(); ctx.translate(p.x + 4, p.y + 6); ctx.rotate(p.a); ctx.fillRect(-veh.w/2, -veh.h/2, veh.w, veh.h); ctx.restore();
    ctx.translate(p.x, p.y); ctx.rotate(p.a);
    ctx.fillStyle = veh.color;
    roundRect(ctx, -veh.w/2, -veh.h/2, veh.w, veh.h, 3, true, false);
    ctx.fillStyle = veh.roof;
    ctx.fillRect(-veh.w/2 + 2, -veh.h/2 + 2, veh.w - 4, veh.h * 0.5);
    ctx.fillStyle = "rgba(20,40,60,0.6)";
    ctx.fillRect(veh.w/2 - 7, -veh.h/2 + 2, 4, veh.h - 4);
    ctx.fillStyle = "#fffbe8";
    ctx.fillRect(veh.w/2 - 2, -veh.h/2 + 1, 2, 3); ctx.fillRect(veh.w/2 - 2, veh.h/2 - 4, 2, 3);
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

  function drawObjectiveArrow() {
    const p = state.p;
    let target = state.carrying ? state.carrying.customer : nearestKiosk(p).lm;
    if (!target) return;
    const dx = target.x - p.x, dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 40) return;
    const a = Math.atan2(dy, dx);
    const ax = p.x + Math.cos(a) * 40, ay = p.y + Math.sin(a) * 40;
    ctx.save();
    ctx.translate(ax, ay); ctx.rotate(a);
    ctx.fillStyle = state.carrying ? "#ff3d80" : "#ffe06b";
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  function drawRain(vw, vh, t) {
    ctx.strokeStyle = "rgba(180,210,240,0.5)"; ctx.lineWidth = 1;
    for (let i = 0; i < 240; i++) {
      const x = (i * 73 + t * 0.4) % vw, y = (i * 137 + t * 0.9) % vh;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 10); ctx.stroke();
    }
  }
  function drawNightVignette(vw, vh) {
    const g = ctx.createRadialGradient(vw/2, vh/2, vh*0.15, vw/2, vh/2, vh*0.8);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,10,0.6)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
  }

  function drawMinimap(vw, vh) {
    const mw = 320, mh = 64;
    const mx = vw - mw - 18, my = 18;
    ctx.fillStyle = "rgba(20,16,40,0.78)";
    roundRect(ctx, mx, my, mw, mh, 10, true, false);
    // Water bg
    ctx.fillStyle = "#3a8a99"; ctx.fillRect(mx + 4, my + 4, mw - 8, mh - 8);
    // Peninsula silhouette
    ctx.fillStyle = "#caa56a";
    ctx.beginPath();
    const innerW = mw - 12; const innerX = mx + 6;
    const innerY = my + mh / 2;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const wx = t * W.W;
      const hw = W.halfWidthAt(wx);
      const sx = innerX + t * innerW;
      const sy = innerY - (hw / 320) * (mh / 2 - 6);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    for (let i = 60; i >= 0; i--) {
      const t = i / 60;
      const wx = t * W.W;
      const hw = W.halfWidthAt(wx);
      const sx = innerX + t * innerW;
      const sy = innerY + (hw / 320) * (mh / 2 - 6);
      ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    // district markers
    ctx.font = "8px 'JetBrains Mono', monospace"; ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.textAlign = "center";
    for (const d of W.DISTRICTS) {
      const xa = innerX + ((d.x0 + d.x1) / 2 / W.W) * innerW;
      ctx.fillText(d.short.toUpperCase(), xa, my + mh - 6);
    }
    // player dot
    const px = innerX + (state.p.x / W.W) * innerW;
    ctx.fillStyle = "#ffe06b"; ctx.beginPath(); ctx.arc(px, innerY, 4, 0, Math.PI * 2); ctx.fill();
    // target
    const tgt = state.carrying ? state.carrying.customer : nearestKiosk(state.p).lm;
    if (tgt) {
      const tx = innerX + (tgt.x / W.W) * innerW;
      const ty = innerY + ((tgt.y - 700) / 320) * (mh / 2 - 6);
      ctx.fillStyle = state.carrying ? "#ff3d80" : "#fff";
      ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; roundRect(ctx, mx, my, mw, mh, 10, false, true);
  }

  // ---- Main render --------------------------------------------------------
  function render(t) {
    if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    const vw = cw / dpr, vh = ch / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    // Camera
    const shake = state.cam.shake;
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    const cam = { x: state.cam.x + sx, y: state.cam.y + sy };
    const view = { x0: cam.x - vw/2 - 40, x1: cam.x + vw/2 + 40, y0: cam.y - vh/2 - 40, y1: cam.y + vh/2 + 40 };

    // World transform
    ctx.translate(vw/2 - cam.x, vh/2 - cam.y);

    // Sky/water everywhere (drawn in world coords across viewport)
    drawWaterAll(view, t);
    // Hills behind Mata de Limón mainland (over the water, before land)
    drawHills(view);
    // Boats (behind land)
    for (const b of boats) {
      if (b.x < view.x0 - 80 || b.x > view.x1 + 80) continue;
      drawBoat(b);
    }
    drawLand(view);
    // Estuary (water hole inside the mainland) + mangroves
    drawEstuary(view);
    drawMangroves(view);
    drawStreets(view);
    drawBridge(view);
    drawStreetLabels(view);
    drawPalms(view, t);
    drawBuildings(view);
    drawBarriers(view);
    // Landmarks (the bridge has its own drawer)
    for (const lm of W.LANDMARKS) {
      if (lm.x < view.x0 - 60 || lm.x > view.x1 + 60) continue;
      if (lm.type === "bridge") continue;
      drawLandmark(lm);
    }
    // Pedestrians, traffic
    for (const pe of pedestrians) {
      if (pe.x < view.x0 - 20 || pe.x > view.x1 + 20) continue;
      drawPed(pe);
    }
    for (const car of traffic) {
      if (car.x < view.x0 - 20 || car.x > view.x1 + 20) continue;
      drawCar(car);
    }
    // Particles
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.c;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Player
    drawPlayer(state.p, state.veh);
    // Gulls above
    for (const g of gulls) {
      if (g.x < view.x0 - 30 || g.x > view.x1 + 30) continue;
      drawGull(g);
    }
    drawObjectiveArrow();
    // Floats
    for (const f of state.floats) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.ttl);
      ctx.fillStyle = f.color;
      ctx.font = "bold 12px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    // Overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = weatherColors();
    ctx.fillStyle = C.tint; ctx.fillRect(0, 0, vw, vh);
    if (state.weather === "storm") drawRain(vw, vh, t);
    if (state.weather === "night") drawNightVignette(vw, vh);

    drawMinimap(vw, vh);

    if (state.p.speed > 240) {
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const y = Math.random() * vh, len = 40 + Math.random() * 60;
        ctx.beginPath(); ctx.moveTo(vw - 20 - len, y); ctx.lineTo(vw - 20, y); ctx.stroke();
      }
    }
  }

  // ----- Loop --------------------------------------------------------------
  function loop(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (state.running) update(dt);
    render(t);
    requestAnimationFrame(loop);
  }

  // ----- Public API --------------------------------------------------------
  function startStage(stageIdx, vehicleKey) {
    const stg = W.STAGES[stageIdx];
    state.stage = stg;
    state.stageIdx = stageIdx;
    state.mode = "story";
    state.weather = stg.weather;
    state.timeLeft = stg.timeLimit;
    state.stageDeliveries = 0;
    state.stageTarget = stg.targetDeliveries;
    state.vehicleKey = vehicleKey || state.vehicleKey;
    state.veh = VEHICLES[state.vehicleKey];
    state.score = 0; state.combo = 1; state.comboTimer = 0;
    state.deliveries = 0; state.perfect = 0;
    state.carrying = null; state.pendingOrder = null;
    state.floats = []; state.particles = [];
    state.over = false; state.won = false; state.running = true; state.paused = false;
    // place player near first kiosk of stage
    const k = W.landmarkById(stg.kiosks[0]);
    state.p = { x: k.x - 60, y: k.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
    state.cam = { x: state.p.x, y: state.p.y, shake: 0 };
    state.storyTip = stg.brief;
    state.barriers = [];
    spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
    pickCustomer();
  }
  function startArcade(opts = {}) {
    state.stage = null;
    state.stageIdx = 0;
    state.mode = "arcade";
    state.weather = opts.weather || "sunny";
    state.timeLeft = 180;
    state.vehicleKey = opts.vehicleKey || state.vehicleKey;
    state.veh = VEHICLES[state.vehicleKey];
    state.score = 0; state.combo = 1; state.comboTimer = 0;
    state.deliveries = 0; state.perfect = 0;
    state.carrying = null; state.pendingOrder = null;
    state.floats = []; state.particles = [];
    state.over = false; state.won = false; state.running = true; state.paused = false;
    state.p = { x: 1500, y: 760, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
    state.cam = { x: state.p.x, y: state.p.y, shake: 0 };
    state.storyTip = "Modo Arcade: cantidad y velocidad. Combo no decae si seguís entregando.";
    state.barriers = [];
    spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
    pickCustomer();
  }

  function startExplore(opts = {}) {
    state.stage = null;
    state.stageIdx = 0;
    state.mode = "explore";
    state.weather = opts.weather || "sunny";
    state.timeLeft = 999;
    state.vehicleKey = opts.vehicleKey || state.vehicleKey;
    state.veh = VEHICLES[state.vehicleKey];
    state.score = 0; state.combo = 1; state.comboTimer = 0;
    state.deliveries = 0; state.perfect = 0;
    state.carrying = null; state.pendingOrder = null;
    state.floats = []; state.particles = [];
    state.over = false; state.won = false; state.running = true; state.paused = false;
    // Spawn at El Faro start
    state.p = { x: 380, y: 700, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
    state.cam = { x: state.p.x, y: state.p.y, shake: 0 };
    const unlockedNames = state.progress.unlocked.length;
    state.storyTip = `Modo Recorrer · ${unlockedNames} zonas desbloqueadas. Limpiá etapas para abrir más.`;
    rebuildBarriers();
    spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
    pickCustomer();
  }
  function setWeather(w) { state.weather = w; }
  function setVehicle(k) { state.vehicleKey = k; state.veh = VEHICLES[k]; }
  let attached = false;
  function attachCanvas(c) {
    if (attached) return;
    attached = true;
    setupCanvas(c);
    requestAnimationFrame((t) => { lastT = t; loop(t); });
  }
  function attachTouch(joyEl, gasEl, brakeEl) {
    if (joyEl) {
      const upd = (e) => {
        const t = e.touches ? e.touches[0] : e;
        if (!t) return;
        const r = joyEl.getBoundingClientRect();
        touchJoy.active = true;
        touchJoy.dx = t.clientX - (r.left + r.width/2);
        touchJoy.dy = t.clientY - (r.top + r.height/2);
      };
      joyEl.addEventListener("touchstart", upd); joyEl.addEventListener("touchmove", upd);
      joyEl.addEventListener("touchend", () => { touchJoy.active = false; touchJoy.dx = touchJoy.dy = 0; });
    }
    if (gasEl) { gasEl.addEventListener("touchstart", () => touchGas = true); gasEl.addEventListener("touchend", () => touchGas = false); }
    if (brakeEl) { brakeEl.addEventListener("touchstart", () => touchBrake = true); brakeEl.addEventListener("touchend", () => touchBrake = false); }
  }

  window.Game = {
    state, VEHICLES, startArcade, startStage, startExplore, setWeather, setVehicle,
    attachCanvas, attachTouch,
    pause: () => { state.paused = !state.paused; },
    quit: () => { state.running = false; state.over = false; state.won = false; },
    resetProgress: () => {
      state.progress = { unlocked: ["faro", "carmen"], clearedStages: [], best: 0 };
      saveProgress(); rebuildBarriers();
    },
  };
})();
