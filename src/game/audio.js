// Procedural WebAudio SFX — no asset files. Every call on `sfx` is a safe
// no-op until the AudioContext unlocks on the first user gesture (autoplay
// policy) and when imported outside a browser (inventory script safety).
//
// One-shots build tiny throwaway node graphs; the continuous engine and
// drift voices are created once and steered with setTargetAtTime.
import { ENGINE_VOICES } from "./vehicles.js";
import AUDIO from "../assets/audio.json" with { type: "json" };
import {
  encodeWav, noise as noiseStep, playRecipe, recipeDuration, renderRecipe,
  seededNoise, tone as toneStep,
} from "../audio/recipe.js";

const MUTE_KEY = "churchill_muted_v1";
const VOL_KEY = "churchill_volume_v1";
const BROWSER = typeof window !== "undefined";

let ctx = null;         // AudioContext, created on first gesture
let master = null;      // master gain (mute = 0)
// THE BUSES. There was exactly ONE gain node in this game until 2026-08-14 —
// the master — so mixing was not something you could do badly, it was something
// you could not do at all: ambience could not be set quieter than the SFX.
// Every bus ships at 1.0 and a gain of 1 in series is arithmetically
// transparent, so the balance is unchanged by their existence.
//   voice -> bus -> master -> destination
// `master` is what mute and the volume slider drive; the buses are the mix.
const buses = {};       // { sfx, engine, ambience, music }
let noiseBuf = null;    // shared 1s white-noise buffer (seeded in renderOffline)
let engineV = null;     // { oscA, oscB, filter, gain }
let driftV = null;      // { src, filter, gain }
let fountainV = null;   // { jet, spray, body, level } — a PARK fountain
let poolV = null;       // { lap, edge, level }        — the Balneario
let wavesV = null;      // { swell, foam, lfo*, level } — surf out on the muelles
let iceCreamV = null;   // { gain, nextAt } — cart melody while carrying
let djV = null;         // { gain, filter, nextAt, bar } — DJ Urtech on the Paseo

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

  for (const [id, spec] of Object.entries(AUDIO.mixer.buses)) {
    if (id.startsWith("_")) continue;
    const g = ctx.createGain();
    g.gain.value = spec.gain;
    g.connect(master);
    buses[id] = g;
  }

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

  // FUENTE — a park fountain. THREE noise beds, because that is what separates
  // a fountain from generic water: the JET (a narrow, resonant hiss where the
  // stream leaves the nozzle), the SPLASH the jet makes landing in the basin,
  // and the basin's own BODY. The old voice had only the last two and read as
  // shower noise. On top of them go the irregular droplet "plips" fired in
  // sfx.fountain() — irregular TIMING is what the ear reads as water, which is
  // why none of this is on a periodic LFO the way the surf is.
  const wJet = ctx.createBufferSource();
  wJet.buffer = noiseBuf; wJet.loop = true;
  const wJetF = ctx.createBiquadFilter();
  wJetF.type = "bandpass"; wJetF.frequency.value = 5200; wJetF.Q.value = 2.2;
  const wJetG = ctx.createGain(); wJetG.gain.value = 0;
  wJet.connect(wJetF); wJetF.connect(wJetG); wJetG.connect(master);
  wJet.start();
  const wSpray = ctx.createBufferSource();
  wSpray.buffer = noiseBuf; wSpray.loop = true;
  const wSprayF = ctx.createBiquadFilter();
  wSprayF.type = "bandpass"; wSprayF.frequency.value = 2400; wSprayF.Q.value = 0.6;
  const wSprayG = ctx.createGain(); wSprayG.gain.value = 0;
  wSpray.connect(wSprayF); wSprayF.connect(wSprayG); wSprayG.connect(master);
  wSpray.start();
  const wBody = ctx.createBufferSource();
  wBody.buffer = noiseBuf; wBody.loop = true;
  const wBodyF = ctx.createBiquadFilter();
  wBodyF.type = "lowpass"; wBodyF.frequency.value = 620; wBodyF.Q.value = 0.5;
  const wBodyG = ctx.createGain(); wBodyG.gain.value = 0;
  wBody.connect(wBodyF); wBodyF.connect(wBodyG); wBodyG.connect(master);
  wBody.start();
  // …and the one periodic thing a fountain DOES have: the jet flutters. Fast
  // and shallow (2.6 Hz, tiny depth) — enough that the bed is not frozen, far
  // from the 3.2 Hz wobble on a dark lowpass that used to read as an engine.
  const jetLfo = ctx.createOscillator();
  jetLfo.type = "sine"; jetLfo.frequency.value = 2.6;
  const jetLfoG = ctx.createGain(); jetLfoG.gain.value = 0;
  jetLfo.connect(jetLfoG); jetLfoG.connect(wJetG.gain);
  jetLfo.start();
  fountainV = { jet: wJetG, jetLfo: jetLfoG, spray: wSprayG, body: wBodyG, level: 0 };

  // PISCINA — the Balneario. It is not a fountain and it should not sound like
  // one: nothing is falling. It is a body of SEA WATER in a cuadra, lapping at
  // its kerb, with people in it. So a dark lap bed on a slow LFO (0.35 Hz — a
  // pool slops faster than the open gulf breathes but far slower than a jet
  // flutters), a quiet bright edge for the wet-tile shimmer, and the splashes
  // that make it a balneario fired as one-shots in sfx.pool().
  const pLap = ctx.createBufferSource();
  pLap.buffer = noiseBuf; pLap.loop = true;
  const pLapF = ctx.createBiquadFilter();
  pLapF.type = "lowpass"; pLapF.frequency.value = 520; pLapF.Q.value = 0.7;
  const pLapG = ctx.createGain(); pLapG.gain.value = 0;
  pLap.connect(pLapF); pLapF.connect(pLapG); pLapG.connect(master);
  pLap.start();
  const pEdge = ctx.createBufferSource();
  pEdge.buffer = noiseBuf; pEdge.loop = true;
  const pEdgeF = ctx.createBiquadFilter();
  pEdgeF.type = "bandpass"; pEdgeF.frequency.value = 1800; pEdgeF.Q.value = 1.1;
  const pEdgeG = ctx.createGain(); pEdgeG.gain.value = 0;
  pEdge.connect(pEdgeF); pEdgeF.connect(pEdgeG); pEdgeG.connect(master);
  pEdge.start();
  const lapLfo = ctx.createOscillator();
  lapLfo.type = "sine"; lapLfo.frequency.value = 0.35;
  const lapLfoG = ctx.createGain(); lapLfoG.gain.value = 0;
  lapLfo.connect(lapLfoG); lapLfoG.connect(pLapG.gain);
  lapLfo.start();
  poolV = { lap: pLapG, lapLfo: lapLfoG, edge: pEdgeG, level: 0 };

  // OLAS — the surf under a muelle. Same idea as the fountain (two noise beds,
  // silent until sfx.waves(level)), but the shape of the sound is the opposite:
  // a fountain is constant and busy, surf BREATHES. So a very slow LFO (0.11 Hz
  // ~ a nine-second swell) is summed into both gains, which is what turns a
  // noise bed into waves instead of static. It is meant to be a calm moment out
  // over the water, so it stays quiet.
  const sSwell = ctx.createBufferSource();
  sSwell.buffer = noiseBuf; sSwell.loop = true;
  const sSwellF = ctx.createBiquadFilter();
  sSwellF.type = "lowpass"; sSwellF.frequency.value = 380; sSwellF.Q.value = 0.4;
  const sSwellG = ctx.createGain(); sSwellG.gain.value = 0;
  sSwell.connect(sSwellF); sSwellF.connect(sSwellG); sSwellG.connect(master);
  sSwell.start();
  const sFoam = ctx.createBufferSource();
  sFoam.buffer = noiseBuf; sFoam.loop = true;
  const sFoamF = ctx.createBiquadFilter();
  sFoamF.type = "bandpass"; sFoamF.frequency.value = 1500; sFoamF.Q.value = 0.5;
  const sFoamG = ctx.createGain(); sFoamG.gain.value = 0;
  sFoam.connect(sFoamF); sFoamF.connect(sFoamG); sFoamG.connect(master);
  sFoam.start();
  const lfo = ctx.createOscillator();
  lfo.type = "sine"; lfo.frequency.value = 0.11;
  const lfoSwell = ctx.createGain(); lfoSwell.gain.value = 0;
  const lfoFoam = ctx.createGain(); lfoFoam.gain.value = 0;
  lfo.connect(lfoSwell); lfo.connect(lfoFoam);
  lfoSwell.connect(sSwellG.gain);      // summed onto the base gain, not replacing it
  lfoFoam.connect(sFoamG.gain);
  lfo.start();
  wavesV = { swell: sSwellG, foam: sFoamG, lfoSwell, lfoFoam, level: 0 };

  // DJ URTECH — the set outside La Takería, on the Paseo.
  //
  // Everything else in this file is AMBIENCE; this is MUSIC, and the difference
  // is that music has a clock. So the voice owns a bar counter and schedules a
  // bar at a time (like `iceCream`, and for the same reason: a scheduled note
  // must be droppable the instant the player drives away). What it is: a
  // four-on-the-floor kick, an offbeat hat, and a filtered saw bassline.
  //
  // DISTANCE IS A FILTER, NOT A FADER. A sound system heard from two blocks
  // away is not quieter techno, it is the kick and nothing else — so the level
  // opens `djF`'s cutoff as well as the gain, and the bass and hats arrive as
  // you get close. That is what makes driving toward it feel like arriving.
  const djG = ctx.createGain(); djG.gain.value = 0;
  const djF = ctx.createBiquadFilter();
  djF.type = "lowpass"; djF.frequency.value = 260; djF.Q.value = 0.9;
  djF.connect(djG); djG.connect(master);
  djV = { gain: djG, filter: djF, nextAt: 0, bar: 0, level: 0 };

  // ICE-CREAM CART — its music-box speaker is silent unless the cart is
  // carrying a churchill. Notes are scheduled into this dedicated gain so a
  // delivery, spill, pause or vehicle swap can silence an in-flight phrase
  // immediately instead of waiting for the last scheduled note to finish.
  const iceCreamG = ctx.createGain();
  iceCreamG.gain.value = 0;
  iceCreamG.connect(master);
  iceCreamV = { gain: iceCreamG, nextAt: 0 };
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

// The two builders are the SHARED interpreter now (`src/audio/recipe.js`),
// bound to this module's live context and default destination. They stay as
// local names because the coded recipes below and the continuous voices call
// them dozens of times, and because the destination default — the sfx bus,
// falling back to the master before the buses exist — is this module's policy
// rather than the interpreter's.
function tone(opts) {
  const { destination, ...step } = opts;
  toneStep(ctx, destination || buses.sfx || master, step);
}

function noiseHit(opts) {
  const { destination, ...step } = opts;
  noiseStep(ctx, destination || buses.sfx || master, noiseBuf, step);
}

// Per-vehicle engine character — oscillator flavour, pitch range (base..base+
// span Hz over the speed range), filter opening and loudness — read from the
// vehicle's own record in `src/assets/vehicles.json`. The synthesis below is
// engine; WHICH voice a vehicle has is part of what that vehicle IS, and
// keeping it here meant adding a vehicle in one file and hearing it in another.
// The bici is nearly silent on purpose: a freewheel whir, not a motor.
//
// THE THREE LANCHAS HAVE NO VOICE and fall back to the scooter's, so an
// outboard currently sounds like a moped. That is the behaviour as shipped, not
// a gap opened by moving the table — kept deliberately, because giving them one
// is an audio change rather than a migration.
const DEFAULT_VOICE = ENGINE_VOICES.scooter;

// THE STEP LIST IS DATA, THE PLAYER IS CODE — `src/assets/audio.json`.
//
// A one-shot is an ordered list of `tone` and `noise` steps with an offset, so
// a three-note arpeggio is three steps rather than three hand-written timers.
// `bus` names which mixer bus it lands on.
//
// TWO RECIPES KEEP THEIR CODE and say so in the registry: `horn` loops over an
// interval table doubling each note with a twin detuned 0.6 % so the pair
// BEATS — that beating is what makes a horn read as air rather than a bass note
// — and `combo` is a function of the streak, not a fixed list. Expressing
// either as JSON would be arithmetic in JSON.
function playSteps(spec) {
  playRecipe(ctx, buses[spec.bus] || master, noiseBuf, spec);
}

// SONIDOS PERSONALIZADOS. A recipe authored in the world editor lands here at
// runtime, exactly the way `theme` and `strings` do — so a new sound ships
// without a rebuild and without an app release. It is the same step vocabulary
// the built-ins use, which is the whole reason this was worth making data: an
// authored sound is not a second kind of thing.
//
// AUTHORED WINS over a built-in of the same id, so a custom `coin` replaces the
// stock one; that is what makes it a customisation rather than an addition
// nobody can reach. Anything the sanitiser rejects simply never arrives, and
// `sfx.play` on an unknown id has always been a no-op.
const AUTHORED = {};

/** Install authored recipes (from `content.ui.sounds`). Replaces the previous
 *  set rather than merging, so clearing a sound in the editor restores the
 *  built-in — the same rule `applyTheme` follows for a cleared token. */
export function applySounds(sounds = {}) {
  for (const id of Object.keys(AUTHORED)) {
    delete AUTHORED[id];
    if (BUILT_IN[id]) RECIPES[id] = BUILT_IN[id];
    else delete RECIPES[id];
  }
  for (const [id, spec] of Object.entries(sounds || {})) {
    AUTHORED[id] = spec;
    RECIPES[id] = () => playSteps(spec);
  }
  return Object.keys(AUTHORED);
}

const RECIPES = Object.fromEntries(
  Object.entries(AUDIO.recipes)
    .filter(([id]) => !id.startsWith("_"))
    .map(([id, spec]) => [id, () => playSteps(spec)]),
);

Object.assign(RECIPES, {
  // Ferry horn — the "chu… chuuu" of the Paquera boat pulling out of the
  // muelle. A short blast then a long one, each a low pair beating slightly
  // against itself (that beat is what makes a horn sound like a horn and not a
  // bass note), under a lowpass so it reads as air, not as a synth.
  horn: () => {
    const blast = (at, dur, gain) => {
      for (const f of [104, 156, 131]) {                    // root, fifth, third
        tone({ type: "sawtooth", from: f, to: f * 0.97, dur, gain: gain * (f === 104 ? 1 : 0.5),
               at, filterHz: 700 });

        tone({ type: "sawtooth", from: f * 1.006, to: f * 0.976, dur, gain: gain * 0.35,
               at, filterHz: 700 });                        // detuned twin → beating
      }
      noiseHit({ dur: dur * 0.5, gain: gain * 0.10, at, band: 500 });  // breath
    };
    blast(0, 0.42, 0.16);
    blast(0.62, 1.15, 0.19);
  },
  combo:       (n = 2) => tone({ from: 520 * (1 + 0.09 * Math.min(8, n)), dur: 0.08, gain: 0.14 }),
});

//: The stock set, snapshotted AFTER the coded recipes join it. `applySounds`
//: restores from here when an authored sound is cleared, so clearing a custom
//: `coin` in the editor puts the real one back rather than leaving silence.
const BUILT_IN = { ...RECIPES };


// ---- offline render: the sounds AS FILES ------------------------------------
//
// This game synthesises everything at runtime and ships no audio assets, which
// is why its whole soundtrack costs zero bytes of download. But a procedural
// sound cannot be dropped into a trailer, and it cannot be REGRESSION-TESTED
// either — you cannot diff a thing that only exists while it is playing.
//
// `renderOffline` fixes both with one move: it re-runs a recipe into an
// `OfflineAudioContext` and hands back the PCM. `tools/render-audio.mjs` writes
// those out as WAVs for video editing, and the same buffer hashed is the audio
// equivalent of the pixel diff every art change in this repo has to pass.
//
// THE NOISE BUFFER IS SEEDED HERE, and that is the whole reason the hash is
// worth anything: the live one is `Math.random()`, so two renders of the same
// recipe would never agree and a diff of them would mean nothing. A fixed LCG
// gives the same white noise every time — the same SOUND, since white noise is
// white noise, but a reproducible one.
export async function renderOffline(name, arg, seconds = null, rate = 44100) {
  const OAC = typeof window !== "undefined"
    && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return null;
  // AUTHORED FIRST. An export or a preview has to show what the game will
  // actually play, and a custom sound REPLACES the built-in of the same id —
  // reading the static registry here would export the stock `coin` while the
  // game plays somebody else's.
  const spec = AUTHORED[name] || AUDIO.recipes[name];
  const busGains = Object.fromEntries(
    Object.entries(AUDIO.mixer.buses)
      .filter(([id]) => !id.startsWith("_"))
      .map(([id, b]) => [id, b.gain]));

  // A DATA recipe renders straight through the shared interpreter. A CODED one
  // (`horn`, `combo`) has to be run, so the module's own context is swapped for
  // the offline one and put back — the only reason this function is not two
  // lines. `buses` is rebuilt in the offline graph so an export is mixed the
  // way the game is.
  if (spec) return renderRecipe(OAC, spec, { buses: busGains, seconds, rate });

  const dur = seconds || 2.5;
  const off = new OAC(1, Math.ceil(rate * dur), rate);
  const saved = { ctx, master, noiseBuf, buses: { ...buses } };
  ctx = off;
  master = off.createGain();
  master.gain.value = 1;
  master.connect(off.destination);
  for (const [id, gain] of Object.entries(busGains)) {
    const g = off.createGain();
    g.gain.value = gain;
    g.connect(master);
    buses[id] = g;
  }
  noiseBuf = seededNoise(off);
  try {
    RECIPES[name]?.(arg);
    const buffer = await off.startRendering();
    return buffer.getChannelData(0);
  } finally {
    ctx = saved.ctx; master = saved.master; noiseBuf = saved.noiseBuf;
    for (const k of Object.keys(buses)) delete buses[k];
    Object.assign(buses, saved.buses);
  }
}

/** Every sound the game can play, for a catalog or an export. */
export function soundCatalog() {
  return Object.keys(RECIPES).map((id) => ({
    id,
    bus: AUDIO.recipes[id]?.bus || "sfx",
    authored: !!AUTHORED[id],
    coded: !AUDIO.recipes[id] && !AUTHORED[id],
    seconds: (AUTHORED[id] || AUDIO.recipes[id])
      ? recipeDuration(AUTHORED[id] || AUDIO.recipes[id]) : null,
  }));
}

export { encodeWav };

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

  // A short original music-box phrase, repeated with breathing room like a
  // neighborhood ice-cream cart. It is active only for the cart + churchill
  // combination; calling with false also cuts off already-scheduled notes.
  iceCream(active) {
    if (!iceCreamV || !ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (!active) {
      iceCreamV.gain.gain.setTargetAtTime(0, now, 0.035);
      iceCreamV.nextAt = now;
      return;
    }
    iceCreamV.gain.gain.setTargetAtTime(1, now, 0.12);
    if (now < iceCreamV.nextAt) return;
    const phrase = [
      [659, 0.00, 0.22], [784, 0.25, 0.22], [988, 0.50, 0.34],
      [784, 0.88, 0.22], [698, 1.14, 0.22], [880, 1.40, 0.34],
      [587, 1.84, 0.22], [698, 2.10, 0.22], [880, 2.36, 0.22],
      [784, 2.62, 0.42],
    ];
    for (const [f, at, dur] of phrase) {
      tone({ type: "sine", from: f, dur, gain: 0.055, at: at + 0.04,
             destination: iceCreamV.gain });
      tone({ type: "triangle", from: f * 2, dur: dur * 0.72, gain: 0.016,
             at: at + 0.04, destination: iceCreamV.gain });
    }
    iceCreamV.nextAt = now + 7.2;
  },

  // FUENTE: 0..1 by nearness to the closest PARK fountain. Jet + splash + basin
  // body, plus randomly-timed droplet "plips" — the irregular transients, not a
  // periodic LFO, are what make it read as water.
  fountain(amount) {
    if (!fountainV || !ctx || ctx.state !== "running") return;
    const a = Math.max(0, Math.min(1, amount));
    fountainV.level = a;
    const now = ctx.currentTime;
    fountainV.jet.gain.setTargetAtTime(a * 0.016, now, 0.12);
    fountainV.jetLfo.gain.setTargetAtTime(a * 0.006, now, 0.12);
    fountainV.spray.gain.setTargetAtTime(a * 0.04, now, 0.12);
    fountainV.body.gain.setTargetAtTime(a * 0.055, now, 0.12);
    if (a > 0.05 && Math.random() < a * 0.26) {
      // one droplet: random pitch + irregular timing = trickling water
      const roll = Math.random();
      if (roll < 0.6) {
        const f0 = 700 + Math.random() * 900;
        tone({ type: "sine", from: f0, to: f0 * (0.45 + Math.random() * 0.2),
               dur: 0.045 + Math.random() * 0.07, gain: 0.015 + a * 0.02, filterHz: 3200 });
      } else if (roll < 0.85) {
        noiseHit({ dur: 0.03 + Math.random() * 0.03, gain: 0.02 + a * 0.015,
                   band: 2600 + Math.random() * 1400 });
      } else {
        // an occasional deeper "bloop" — a bigger drop into the basin. Without
        // it every plip lives in the same octave and the trickle sounds fake.
        const f0 = 240 + Math.random() * 200;
        tone({ type: "sine", from: f0 * 1.7, to: f0,
               dur: 0.10 + Math.random() * 0.06, gain: 0.012 + a * 0.014, filterHz: 1400 });
      }
    }
  },

  // PISCINA: 0..1 by nearness to the Balneario. Its own voice, NOT the
  // fountain's — nothing there is falling, so a jet and droplets are the wrong
  // sound entirely. A slow dark lap against the kerb, a faint bright edge, and
  // occasional SPLASHES: a swimmer moving, which is a broadband hit that decays
  // downward, not a droplet that decays upward.
  pool(amount) {
    if (!poolV || !ctx || ctx.state !== "running") return;
    const a = Math.max(0, Math.min(1, amount));
    poolV.level = a;
    const now = ctx.currentTime;
    poolV.lap.gain.setTargetAtTime(a * 0.05, now, 0.5);
    poolV.lapLfo.gain.setTargetAtTime(a * 0.03, now, 0.5);
    poolV.edge.gain.setTargetAtTime(a * 0.012, now, 0.5);
    if (a > 0.08 && Math.random() < a * 0.05) {
      // a splash: two overlapping noise hits, the second darker and longer, so
      // it reads as the water closing over rather than as a single click
      noiseHit({ dur: 0.09 + Math.random() * 0.07, gain: 0.030 + a * 0.02,
                 band: 1500 + Math.random() * 900 });
      noiseHit({ dur: 0.16 + Math.random() * 0.10, gain: 0.020 + a * 0.015,
                 at: 0.03 + Math.random() * 0.03, band: 520 + Math.random() * 300 });
    }
  },

  // OLAS: 0..1, the surf you hear once you are out over the water on a muelle.
  // A long ramp (1.4 s) on purpose — the point is a calm moment, and a surf bed
  // that snapped on at the kerb would read as a sound effect instead of as the
  // sea having been there all along. The LFO depth rides the level too, so the
  // swell gets deeper the further out you are rather than just louder.
  waves(amount) {
    if (!wavesV || !ctx || ctx.state !== "running") return;
    const a = Math.max(0, Math.min(1, amount));
    wavesV.level = a;
    const now = ctx.currentTime;
    wavesV.swell.gain.setTargetAtTime(a * 0.05, now, 1.4);
    wavesV.foam.gain.setTargetAtTime(a * 0.022, now, 1.4);
    wavesV.lfoSwell.gain.setTargetAtTime(a * 0.034, now, 1.4);
    wavesV.lfoFoam.gain.setTargetAtTime(a * 0.018, now, 1.4);
  },

  // DJ URTECH: 0..1 by distance, called every physics frame.
  //
  // The level does two things at once. It rides the GAIN, as every other voice
  // does — and it opens the LOWPASS from 260 Hz to ~4 kHz, which is what turns
  // "quieter" into "closer": from down the Paseo you get the kick through the
  // wall of the night, and only at the booth do the hats and the bassline
  // arrive. One bar is scheduled at a time so driving away silences the set on
  // the next beat instead of playing out whatever was queued.
  dj(amount) {
    if (!djV || !ctx || ctx.state !== "running") return;
    const a = Math.max(0, Math.min(1, amount));
    djV.level = a;
    const now = ctx.currentTime;
    djV.gain.gain.setTargetAtTime(a * 0.5, now, 0.25);
    djV.filter.frequency.setTargetAtTime(260 + a * a * 3800, now, 0.3);
    if (a <= 0.01) { djV.nextAt = Math.max(djV.nextAt, now); return; }
    const BPM = 128, beat = 60 / BPM, bar = beat * 4;
    if (now < djV.nextAt - bar * 0.5) return;      // this bar is already queued
    const t0 = Math.max(now + 0.05, djV.nextAt);
    const bass = [55, 55, 82.4, 55, 65.4, 55, 73.4, 82.4];   // A1 … a two-bar walk
    for (let i = 0; i < 4; i++) {
      // el bombo — a pitch-swept sine is a kick; a click on top is the beater
      tone({ type: "sine", from: 130, to: 44, dur: 0.20, gain: 0.42,
             at: t0 - now + i * beat, destination: djV.filter });
      tone({ type: "square", from: 1100, to: 240, dur: 0.02, gain: 0.10,
             at: t0 - now + i * beat, destination: djV.filter });
      // el hi-hat, a contratiempo
      tone({ type: "square", from: 8200, to: 7000, dur: 0.035, gain: 0.06,
             at: t0 - now + i * beat + beat / 2, destination: djV.filter });
      // el bajo, dos notas por tiempo
      for (const half of [0, 0.5]) {
        const n = bass[(djV.bar * 4 + i * 2 + half * 2) % bass.length];
        tone({ type: "sawtooth", from: n, dur: beat * 0.42, gain: 0.16,
               at: t0 - now + (i + half) * beat, filterHz: 900,
               destination: djV.filter });
      }
    }
    djV.bar = (djV.bar + 1) % 2;
    djV.nextAt = t0 + bar;
  },

  // silence the continuous voices (menus, pause, results) but keep the
  // context alive so menu blips still play
  quiet() {
    if (!ctx) return;
    if (engineV) engineV.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    if (driftV) driftV.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    if (iceCreamV) {
      iceCreamV.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      iceCreamV.nextAt = ctx.currentTime;
    }
    if (fountainV) {
      fountainV.spray.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      fountainV.body.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    }
    if (djV) {
      djV.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      djV.nextAt = ctx.currentTime;
    }
  },
  // Has the AudioContext actually unlocked? A one-shot fired before the first
  // gesture is silently dropped by the autoplay policy, so the boot horn needs
  // to know whether to arm itself for the next tap instead.
  get ready() { return !!ctx && ctx.state === "running"; },
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
