// LOS SONIDOS, COMO ARCHIVOS.
//
//   node tools/render-audio.mjs <outDir> [devUrl]        write WAVs + hashes
//   node tools/render-audio.mjs --hashes <out.json> [url] hashes only
//
// This game ships no audio assets — every sound is synthesised at runtime, so
// the whole soundtrack costs zero bytes of download. That is worth keeping, and
// it leaves two things missing that this tool provides from the same source:
//
//   * FILES you can drop into a trailer, a store listing or a video. Rendered
//     from the game's own recipes, so the sound in the clip is the sound in the
//     game and cannot drift from it.
//   * A REGRESSION GATE. Audio is the one thing in this repo that had no
//     equivalent of a pixel diff — you cannot compare a sound that only exists
//     while it plays. Rendered to PCM and hashed, it has one.
//
// The render is deterministic because `renderOffline` seeds the noise buffer
// (the live one is `Math.random()`). Same recipe, same bytes, every time.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const hashesOnly = process.argv[2] === "--hashes";
const out = process.argv[3 - (hashesOnly ? 0 : 1)] || (hashesOnly ? "audio.json" : "audio-out");
const url = process.argv[hashesOnly ? 4 : 3] || "http://localhost:8734/";

/** 16-bit mono PCM WAV around a Float32Array. */
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

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.Game, null, { timeout: 25000 });

const rendered = await page.evaluate(async (hashesOnly) => {
  const audio = await import("/src/game/audio.js");
  const AUDIO = await (await fetch("/src/assets/audio.json")).json();
  const names = Object.keys(AUDIO.recipes).filter((k) => !k.startsWith("_"));
  names.push("horn", "combo");                    // the two that keep their code
  const out = [];
  for (const name of names) {
    // A FIXED WINDOW FOR THE FINGERPRINT, a tight one for the file.
    // `renderOffline` sizes the buffer to the recipe, which makes a better WAV
    // — but the envelope is 64 buckets ACROSS THE BUFFER, so comparing a
    // 0.8-second render against a 2.5-second one reports a difference that is
    // entirely the window. Pin it here and the gate compares sound to sound.
    // `combo` is the one recipe that takes an ARGUMENT — its pitch rises with
    // the streak — so rendering it means choosing a streak. 4 is a combo a
    // player actually reaches, and pinning it is what makes the fingerprint
    // reproducible; at the default 2 the export would not represent the sound
    // anybody associates with a combo.
    const arg = name === "combo" ? 4 : undefined;
    // ONE WINDOW FOR EVERY FINGERPRINT. The envelope is 64 buckets across the
    // buffer, so two recipes rendered over different lengths are not comparable
    // and neither are two renders of the SAME recipe. 2.5 s covers the longest
    // (the ferry horn's two blasts) with room to spare.
    const pcm = await audio.renderOffline(name, arg, hashesOnly ? 2.5 : null);
    if (!pcm) continue;
    // Peak and RMS travel with the samples: a hash says "different", these say
    // "louder" or "silent", which is the first thing you want to know.
    let peak = 0, sum = 0;
    for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; sum += pcm[i] * pcm[i]; }
    // THE FINGERPRINT IS AN ENVELOPE, NOT A HASH — measured, not assumed.
    // Rendering the same recipe twice in the same page gives bit-identical PCM
    // for some (`delivery`: 0) and NOT for others (`coin`: 7.5e-9, `horn`:
    // 6.0e-8): WebAudio's band-limited oscillators are not reproducible to the
    // last bit. A sha256 of the samples therefore reports a difference for two
    // runs of identical code, which is a gate that cries wolf — the same trap
    // as pixel-diffing an animated scene.
    // 64 RMS buckets at 6 decimals is ~4 orders of magnitude above that noise
    // and still catches any real change: a moved note, a retuned gain, a
    // dropped step all move a bucket.
    const BUCKETS = 64, per = Math.ceil(pcm.length / BUCKETS);
    const env = [];
    for (let b = 0; b < BUCKETS; b++) {
      let s2 = 0, n = 0;
      for (let i = b * per; i < Math.min(pcm.length, (b + 1) * per); i++) { s2 += pcm[i] * pcm[i]; n++; }
      env.push(Math.sqrt(s2 / Math.max(1, n)).toFixed(6));
    }
    out.push({ name, samples: Array.from(pcm), peak, rms: Math.sqrt(sum / pcm.length), env });
  }
  return out;
}, hashesOnly);
await browser.close();
if (errors.length) { console.error(`[audio] page errors: ${errors.join(" | ")}`); process.exit(1); }

const summary = { all: {} };
for (const r of rendered) {
  const pcm = Float32Array.from(r.samples);
  summary.all[`audio::${r.name}`] = {
    envelope: r.env.join(" "),
    peak: r.peak.toFixed(5),
    rms: r.rms.toFixed(5),
    silent: String(r.peak < 1e-6),
  };
  if (!hashesOnly) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, `${r.name}.wav`), wav(pcm));
  }
}
summary.screens = Object.keys(summary.all);
summary.elements = rendered.length;

// A SILENT RENDER IS NOT A PASS. Two silent buffers hash the same, and this
// repo has twice believed a comparison of two blank things.
const silent = rendered.filter((r) => r.peak < 1e-6).map((r) => r.name);
if (silent.length) {
  console.error(`[FAIL] these rendered SILENT: ${silent.join(", ")} — a hash of `
    + `silence matches any other silence, so do not trust a diff of this.`);
  process.exit(1);
}

if (hashesOnly) writeFileSync(out, JSON.stringify(summary, null, 1));
console.log(`[audio] ${rendered.length} recipes rendered`
  + (hashesOnly ? ` -> ${out}` : ` -> ${out}/*.wav`));
for (const r of rendered) {
  console.log(`  ${r.name.padEnd(13)} peak ${r.peak.toFixed(3)}  rms ${r.rms.toFixed(4)}`);
}
