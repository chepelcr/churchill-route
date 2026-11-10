// LAS EMISORAS, COMO ARCHIVOS.
//
//   node tools/render-stations.mjs <outDir> [devUrl] [seconds]
//
// The radio is procedural, so a station only exists while it plays — this is
// the one way to LISTEN to one outside the game, and the one way to check it
// without ears. It renders each station through the game's own band
// (`src/audio/radio.js → renderStation`) into an OfflineAudioContext, writes a
// WAV, and prints three numbers per station:
//
//   * peak / rms — silent is a failure, and a peak over 1 is clipping;
//   * the TEMPO it measured from the onsets, against the bpm the station
//     declares. A station that plays at the wrong speed, or not in time, shows
//     up here and nowhere else.
//
// Like every tool that imports source modules, run it against a FRESH dev
// server (`pnpm dev --port 8736 --strictPort`) — see CLAUDE.md on HMR splits.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const out = process.argv[2] || "stations-out";
const url = process.argv[3] || "http://localhost:8736/";
const seconds = +(process.argv[4] || 24);

function wav(samples, rate = 44100) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/** Tempo from the onset envelope: autocorrelation over 60..180 BPM. */
function measureBpm(pcm, rate) {
  const hop = Math.round(rate * 0.01);                      // 10 ms frames
  const env = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += pcm[j] * pcm[j];
    env.push(Math.sqrt(s / hop));
  }
  const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] || 0)));
  let best = 0, bestLag = 0;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = 6000 / bpm;                                 // frames per beat
    let s = 0;
    for (let i = 0; i + lag < flux.length; i++) {
      const k = i + lag, k0 = Math.floor(k), f = k - k0;
      s += flux[i] * ((flux[k0] || 0) * (1 - f) + (flux[k0 + 1] || 0) * f);
    }
    if (s > best) { best = s; bestLag = bpm; }
  }
  return bestLag;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.Game, null, { timeout: 25000 });

const rendered = await page.evaluate(async (seconds) => {
  const radio = await import("/src/audio/radio.js");
  const recipe = await import("/src/audio/recipe.js");
  const AUDIO = await (await fetch("/src/assets/audio.json")).json();
  const res = [];
  for (const id of AUDIO.radio.order) {
    const st = AUDIO.stations[id];
    const pcm = await radio.renderStation(window.OfflineAudioContext, st,
      (ctx) => recipe.seededNoise(ctx), { seconds, gain: (st.level ?? 1) * AUDIO.radio.level });
    res.push({ id, bpm: st.bpm, samples: Array.from(pcm) });
  }
  return res;
}, seconds);
await browser.close();
if (errors.length) { console.error(`[stations] page errors: ${errors.join(" | ")}`); process.exit(1); }

mkdirSync(out, { recursive: true });
let fail = false;
for (const r of rendered) {
  const pcm = Float32Array.from(r.samples);
  let peak = 0, sum = 0;
  for (const v of pcm) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
  const rms = Math.sqrt(sum / pcm.length);
  const bpm = measureBpm(pcm, 44100);
  // a measured tempo of half or double the declared one is still in time
  const ratio = bpm / r.bpm;
  const inTime = [0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.04);
  const bad = peak < 1e-4 || peak > 1 || !inTime;
  if (bad) fail = true;
  writeFileSync(path.join(out, `${r.id}.wav`), wav(pcm));
  console.log(`  ${(bad ? "FAIL " : "ok   ") + r.id.padEnd(10)} peak ${peak.toFixed(3)}  rms ${rms.toFixed(4)}  `
    + `tempo ${bpm} measured / ${r.bpm} declared`);
}
console.log(`[stations] ${rendered.length} stations -> ${out}/*.wav`);
process.exit(fail ? 1 : 0);
