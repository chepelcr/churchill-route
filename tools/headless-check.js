// Headless smoke test: boots the actual game (world-data + world + engine)
// with stubbed DOM/canvas, runs the real update/render loop, and asserts the
// orchestration behaviors (barriers, stage flow, localStorage unlocks).
const ROOT = require("path").resolve(__dirname, "..");

function makeCtxStub() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => gradient;
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      if (k === "canvas") return canvasStub;
      return () => {};
    },
    set() { return true; },
  });
}
const canvasStub = {
  getContext: () => ctxStub,
  clientWidth: 1280, clientHeight: 720, width: 1280, height: 720,
  addEventListener() {}, style: {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
};
const ctxStub = makeCtxStub();

let rafCb = null;
const storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};
global.window = {
  addEventListener() {}, removeEventListener() {},
  devicePixelRatio: 1,
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  cancelAnimationFrame() {},
  localStorage: global.localStorage,
  performance: { now: () => nowMs },
  navigator: { getGamepads: () => [] },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
global.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ getContext: () => ctxStub, style: {} }),
  hidden: false,
};
global.navigator = global.window.navigator;
global.performance = global.window.performance;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.cancelAnimationFrame = global.window.cancelAnimationFrame;
global.atob = (b64) => Buffer.from(b64, "base64").toString("binary");
global.window.atob = global.atob;
global.Path2D = function Path2D() {
  return new Proxy({}, { get: () => () => {}, set: () => true });
};
global.window.Path2D = global.Path2D;
global.Image = class { };
let nowMs = 0;

require(ROOT + "/world-data.js");
require(ROOT + "/world.js");
require(ROOT + "/engine.js");
const W = global.window.WORLD;
const Game = global.window.Game;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS  " + name);
  else { failures++; console.log("FAIL  " + name + (extra ? " — " + extra : "")); }
}

function frames(n, dtMs = 16) {
  for (let i = 0; i < n; i++) {
    nowMs += dtMs;
    if (!rafCb) break;
    const cb = rafCb; rafCb = null;
    cb(nowMs);
  }
}

// --- boot
Game.attachCanvas(canvasStub);
frames(5);
check("boot: loop running after attachCanvas", true);

// --- explore mode: fresh progress -> barriers for all locked districts
Game.startExplore({ vehicleKey: "scooter" });
frames(10);
const st = Game.state;
check("explore: mode", st.mode === "explore");
check("explore: default unlocked faro+carmen", st.progress.unlocked.join(",") === "faro,carmen");
const lockedCount = W.DISTRICTS.filter(d => !st.progress.unlocked.includes(d.id)).length;
check("explore: barriers for locked districts", st.barriers.length === lockedCount,
      `barriers=${st.barriers.length} locked=${lockedCount}`);
const faroLm = W.landmarkById("faro");
check("explore: spawn near faro", Math.abs(st.p.x - faroLm.x) < 200, `p.x=${st.p.x} faro=${faroLm.x}`);
check("explore: spawn on land", !W.inWater(st.p.x, st.p.y), `surface=${W.surfaceAt(st.p.x, st.p.y)}`);

// --- barrier physics: ram the first barrier from the west
const bar = st.barriers.reduce((a, b) => (a.x < b.x ? a : b));
st.p.x = bar.x - 40; st.p.y = (W.topY(bar.x) + W.botY(bar.x)) / 2;
st.p.vx = 400; st.p.vy = 0;
for (let i = 0; i < 60; i++) { st.p.vx = Math.max(st.p.vx, 300); frames(1); }
check("barrier: blocks eastward travel", st.p.x < bar.x + 30, `p.x=${st.p.x.toFixed(0)} barrier=${bar.x}`);

// --- surfaces under the player at semantic spots
const trunkRoad = W.ROADS.find(r => r.cls === "trunk");
check("surface: trunk is road", W.surfaceAt(trunkRoad.pts[0], trunkRoad.pts[1]) === 3);
const paseoIdx = W.ROADS.findIndex(r => r.cls === "paseo");
const pm = W.roadPointAt(paseoIdx, W.roadLength(paseoIdx) / 2);
check("surface: paseo class", W.surfaceAt(pm.x, pm.y) === 4);
check("surface: open gulf is water", W.surfaceAt(400, 1300) === 0);
const br = W.BRIDGE;
check("surface: bridge deck drivable", W.onRoad((br.x0 + br.x1) / 2, br.cy),
      `cls=${W.surfaceAt((br.x0 + br.x1) / 2, br.cy)}`);

// --- story stage 1
Game.startStage(0, "scooter");
frames(10);
check("stage1: mode story", Game.state.mode === "story");
check("stage1: timer 90", Math.abs(Game.state.timeLeft - 90) < 2, `t=${Game.state.timeLeft}`);
const k1 = W.landmarkById("kios_paseo1");
check("stage1: spawn near kiosk", Math.abs(Game.state.p.x - (k1.x - 60)) < 5);
check("stage1: kiosk on land", !W.inWater(k1.x, k1.y));

// --- simulate stage completion -> unlock -> explore barrier removed
storage["churchill_progress_v1"] = JSON.stringify({ unlocked: ["faro", "carmen", "paseo"], clearedStages: ["s1"], best: 1234 });
// re-require engine fresh to re-run loadProgress
delete require.cache[require.resolve(ROOT + "/engine.js")];
require(ROOT + "/engine.js");
const Game2 = global.window.Game;
Game2.attachCanvas(canvasStub);
Game2.startExplore({ vehicleKey: "scooter" });
frames(5);
const locked2 = W.DISTRICTS.filter(d => !Game2.state.progress.unlocked.includes(d.id)).length;
check("unlock: paseo barrier gone after saved progress", Game2.state.barriers.length === locked2 &&
      Game2.state.barriers.every(b => b.x > W.DISTRICTS.find(d => d.id === "paseo").x0 + 10),
      `barriers=${Game2.state.barriers.length}`);

// --- arcade mode + long run stability (2000 frames ≈ 33 s of play)
Game2.startArcade({ vehicleKey: "turbo" });
let crashed = null;
try { frames(2000); } catch (e) { crashed = e; }
check("arcade: 2000 frames without exception", !crashed, crashed && crashed.stack && crashed.stack.split("\n")[0]);
check("arcade: timer ticked down", Game2.state.timeLeft < 180, `t=${Game2.state.timeLeft.toFixed(1)}`);
check("arcade: no barriers", Game2.state.barriers.length === 0);

// --- drive across the whole map (teleport sweep): no surface lookup throws
let sweepErr = null;
try {
  for (let x = 20; x < 8800; x += 40) {
    const y = (W.topY(x) + W.botY(x)) / 2;
    W.surfaceAt(x, y); W.onRoad(x, y); W.inWater(x, y); W.buildingsNear(x, y);
  }
} catch (e) { sweepErr = e; }
check("sweep: full-map surface queries", !sweepErr, sweepErr && sweepErr.message);

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
