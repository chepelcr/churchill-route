// Procedural WebAudio SFX — no asset files. Every call on `sfx` is a safe
// no-op until the AudioContext unlocks on the first user gesture (autoplay
// policy) and when imported outside a browser (inventory script safety).
//
// One-shots build tiny throwaway node graphs; the continuous engine and
// drift voices are created once and steered with setTargetAtTime.

const MUTE_KEY = "churchill_muted_v1";
const VOL_KEY = "churchill_volume_v1";
const BROWSER = typeof window !== "undefined";

let ctx = null;         // AudioContext, created on first gesture
let master = null;      // master gain (mute = 0)
let noiseBuf = null;    // shared 1s white-noise buffer
let engineV = null;     // { oscA, oscB, filter, gain }
let driftV = null;      // { src, filter, gain }
let fountainV = null;   // { src, filter, gain } — park fountain water burble

function loadMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
function saveMuted(m) {
  try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* private mode */ }
}
function loadVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY));
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  } catch { return 1; }
}
function saveVolume(v) {
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* private mode */ }
}

function unlock() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = sfx.muted ? 0 : sfx.volume;
  master.connect(ctx.destination);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // Engine: two detuned saws through a lowpass, silent until sfx.engine()
  const oscA = ctx.createOscillator(), oscB = ctx.createOscillator();
  oscA.type = "sawtooth"; oscB.type = "sawtooth";
  oscA.frequency.value = 42; oscB.frequency.value = 42; oscB.detune.value = 6;
  const ef = ctx.createBiquadFilter();
  ef.type = "lowpass"; ef.frequency.value = 500; ef.Q.value = 0.7;
  const eg = ctx.createGain(); eg.gain.value = 0;
  oscA.connect(ef); oscB.connect(ef); ef.connect(eg); eg.connect(master);
  oscA.start(); oscB.start();
  engineV = { oscA, oscB, filter: ef, gain: eg };

  // Drift: looped noise through a bandpass, silent until sfx.drift()
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const df = ctx.createBiquadFilter();
  df.type = "bandpass"; df.frequency.value = 1400; df.Q.value = 1.2;
  const dg = ctx.createGain(); dg.gain.value = 0;
  src.connect(df); df.connect(dg); dg.connect(master);
  src.start();
  driftV = { src, filter: df, gain: dg };

  // Fountain: gentle water burble — looped noise through a lowpass with a slow
  // LFO wobble on the cutoff; silent until sfx.fountain(level) near a park.
  const fs = ctx.createBufferSource();
  fs.buffer = noiseBuf; fs.loop = true;
  const ff = ctx.createBiquadFilter();
  ff.type = "lowpass"; ff.frequency.value = 900; ff.Q.value = 0.7;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 3.2;
  const lfoG = ctx.createGain(); lfoG.gain.value = 320;
  lfo.connect(lfoG); lfoG.connect(ff.frequency);
  const fg = ctx.createGain(); fg.gain.value = 0;
  fs.connect(ff); ff.connect(fg); fg.connect(master);
  fs.start(); lfo.start();
  fountainV = { src: fs, filter: ff, gain: fg };
}

if (BROWSER) {
  // PERSISTENT gesture listeners (not {once}): iOS Safari / mobile Chrome can
  // keep (or re-put) the context "suspended" after creation, and resume() only
  // works inside a user gesture — so every tap re-kicks it until it runs.
  const kick = () => {
    unlock();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", kick);
  window.addEventListener("touchend", kick); // iOS honors resume best on touchend
  window.addEventListener("keydown", kick);
}

// ---- one-shot builders -----------------------------------------------------

function tone({ type = "square", from = 440, to = null, dur = 0.08, gain = 0.15, at = 0, filterHz = null }) {
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  if (to !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  let head = o;
  if (filterHz) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(filterHz, t0);
    f.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    o.connect(f); head = f;
  }
  head.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noiseHit({ dur = 0.05, gain = 0.1, at = 0, band = null }) {
  const t0 = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  let head = s;
  if (band) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = band; f.Q.value = 1;
    s.connect(f); head = f;
  }
  head.connect(g); g.connect(master);
  s.start(t0); s.stop(t0 + dur + 0.02);
}

// Per-vehicle engine character: oscillator flavor, pitch range (base..base+span
// Hz over the speed range), filter opening and loudness. The bici is nearly
// silent — a freewheel whir, not a motor.
const ENGINE_VOICES = {
  bici:    { type: "triangle", base: 190, span: 150, filter: 1300, gain: 0.022, detune: 3 },
  scooter: { type: "sawtooth", base: 68,  span: 110, filter: 720,  gain: 0.075, detune: 9 },
  tuktuk:  { type: "square",   base: 36,  span: 50,  filter: 420,  gain: 0.06,  detune: 5 },
  cart:    { type: "triangle", base: 55,  span: 70,  filter: 520,  gain: 0.05,  detune: 6 },
  pickup:  { type: "sawtooth", base: 30,  span: 55,  filter: 380,  gain: 0.075, detune: 6 },
  turbo:   { type: "sawtooth", base: 50,  span: 130, filter: 950,  gain: 0.085, detune: 12 },
};
const DEFAULT_VOICE = ENGINE_VOICES.scooter;

const RECIPES = {
  menu_move:   () => tone({ from: 660, dur: 0.06, gain: 0.12 }),
  menu_select: () => { tone({ from: 523, dur: 0.07, gain: 0.14 }); tone({ from: 784, dur: 0.09, gain: 0.14, at: 0.07 }); },
  menu_denied: () => tone({ from: 180, to: 140, dur: 0.09, gain: 0.14 }),
  pickup:      () => { tone({ type: "sine", from: 440, to: 880, dur: 0.09, gain: 0.18 }); noiseHit({ dur: 0.03, gain: 0.08, band: 4000 }); },
  delivery:    () => [523, 659, 784].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.09, gain: 0.16, at: i * 0.07 })),
  perfect:     () => {
    [523, 659, 784].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.09, gain: 0.16, at: i * 0.07 }));
    tone({ type: "triangle", from: 1046, dur: 0.16, gain: 0.18, at: 0.21 });
    tone({ type: "sine", from: 1052, dur: 0.16, gain: 0.08, at: 0.21 });
  },
  combo:       (n = 2) => tone({ from: 520 * (1 + 0.09 * Math.min(8, n)), dur: 0.08, gain: 0.14 }),
  melt_fail:   () => { tone({ type: "sawtooth", from: 300, to: 80, dur: 0.4, gain: 0.18, filterHz: 900 }); noiseHit({ dur: 0.25, gain: 0.07, at: 0.05, band: 300 }); },
};

// ---- public facade ---------------------------------------------------------

export const sfx = {
  muted: BROWSER ? loadMuted() : true,
  volume: BROWSER ? loadVolume() : 1,

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    saveVolume(this.volume);
    if (master && ctx && !this.muted) master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.02);
    return this.volume;
  },

  play(name, arg) {
    if (!ctx || this.muted || ctx.state !== "running") return;
    const r = RECIPES[name];
    if (r) r(arg);
  },

  // continuous voices — call every physics frame
  engine(speedRatio, boosting, vehicleKey) {
    if (!engineV || !ctx || ctx.state !== "running") return;
    const v = ENGINE_VOICES[vehicleKey] || DEFAULT_VOICE;
    const r = Math.max(0, Math.min(1.2, speedRatio || 0));
    const f = (v.base + r * v.span) * (boosting ? 1.3 : 1);
    const t = ctx.currentTime;
    if (engineV.oscA.type !== v.type) { engineV.oscA.type = v.type; engineV.oscB.type = v.type; }
    engineV.oscB.detune.setTargetAtTime(v.detune, t, 0.1);
    engineV.oscA.frequency.setTargetAtTime(f, t, 0.08);
    engineV.oscB.frequency.setTargetAtTime(f, t, 0.08);
    engineV.filter.frequency.setTargetAtTime(boosting ? v.filter * 2 : v.filter * 0.7 + r * v.filter * 0.6, t, 0.1);
    engineV.gain.gain.setTargetAtTime(r > 0.02 ? v.gain * (0.6 + 0.5 * r) : 0, t, 0.09);
  },
  drift(amount) {
    if (!driftV || !ctx || ctx.state !== "running") return;
    driftV.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, amount)) * 0.12, ctx.currentTime, 0.06);
  },

  // Fountain water: 0..1 by nearness to the closest park fountain.
  fountain(amount) {
    if (!fountainV || !ctx || ctx.state !== "running") return;
    fountainV.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, amount)) * 0.10, ctx.currentTime, 0.12);
  },

  // silence the continuous voices (menus, pause, results) but keep the
  // context alive so menu blips still play
  quiet() {
    if (!ctx) return;
    if (engineV) engineV.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    if (driftV) driftV.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    if (fountainV) fountainV.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  },
  // the OS/browser suspends the context in the background; revive it
  resume() {
    if (ctx && ctx.state === "suspended") ctx.resume();
  },

  toggleMuted() {
    this.muted = !this.muted;
    saveMuted(this.muted);
    if (master && ctx) master.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 0.02);
    return this.muted;
  },
};
