// EL INTÉRPRETE DE RECETAS — the one place a sound is built from its steps.
//
// Pure and context-agnostic on purpose: it takes the AudioContext, the
// destination node and the noise buffer, so the SAME code renders the live
// sound in the game, the offline render that writes a WAV for a trailer, and
// the preview button in the world editor.
//
// That last one is why this file exists at all. The editor is a separate repo
// that reads the game's DATA and never its modules, so an export button there
// would have meant a second implementation of `tone`/`noise` — and a second
// implementation is the thing this whole migration has been removing. It
// imports this module through a Vite alias instead.
//
// No DOM, no `window`, no imports: `tools/render-audio.mjs` and the editor both
// load it outside the game's own module graph.

/**
 * One oscillator with an optional glide and a lowpass that closes as it decays.
 *
 * The filter sweeping DOWN to 120 Hz over the note is what stops a square wave
 * reading as a beep — it is the difference between a menu blip and a click.
 */
export function tone(ctx, dest, {
  type = "square", from = 440, to = null, dur = 0.08, gain = 0.15,
  at = 0, filterHz = null,
} = {}) {
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  if (to !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  // exponential, never linear: a linear fade to zero is audible as a click,
  // and 0.001 rather than 0 because an exponential ramp cannot reach it.
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  let head = o;
  if (filterHz) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(filterHz, t0);
    f.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    o.connect(f); head = f;
  }
  head.connect(g); g.connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/** A burst of the shared white-noise buffer, optionally through a bandpass. */
export function noise(ctx, dest, buffer, { dur = 0.05, gain = 0.1, at = 0, band = null } = {}) {
  const t0 = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  let head = s;
  if (band) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = band; f.Q.value = 1;
    s.connect(f); head = f;
  }
  head.connect(g); g.connect(dest);
  s.start(t0); s.stop(t0 + dur + 0.02);
}

/** Play a recipe's `steps` into `dest`. Unknown step kinds are skipped. */
export function playRecipe(ctx, dest, buffer, spec) {
  for (const step of (spec?.steps || [])) {
    if (step.tone) tone(ctx, dest, step.tone);
    else if (step.noise) noise(ctx, dest, buffer, step.noise);
  }
}

/** How long a recipe runs, in seconds — the last step's end, plus a tail. */
export function recipeDuration(spec, tail = 0.4) {
  let end = 0;
  for (const step of (spec?.steps || [])) {
    const s = step.tone || step.noise || {};
    end = Math.max(end, (s.at || 0) + (s.dur || 0));
  }
  return end + tail;
}

/** A deterministic white-noise buffer.
 *
 *  THE SEED IS THE POINT. The live buffer is `Math.random()`, so two renders of
 *  the same recipe never agree and a comparison of them means nothing. White
 *  noise is white noise either way — this one is just reproducible, which is
 *  what makes an audio regression gate possible at all. */
export function seededNoise(ctx, seconds = 1, seed = 0x2f6e2b1) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.ceil(rate * seconds), rate);
  const d = buf.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 0x80000000) - 1;
  }
  return buf;
}

/**
 * Render a recipe offline and return the mono PCM.
 *
 * `buses` is the mixer, applied so an export sounds like the game does. Pass
 * `{}` to render dry.
 */
export async function renderRecipe(OfflineCtx, spec, { buses = {}, seconds = null, rate = 44100 } = {}) {
  const dur = seconds || recipeDuration(spec);
  const ctx = new OfflineCtx(1, Math.ceil(rate * dur), rate);
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  let dest = master;
  const busGain = buses[spec?.bus];
  if (busGain !== undefined) {
    const g = ctx.createGain();
    g.gain.value = busGain;
    g.connect(master);
    dest = g;
  }
  playRecipe(ctx, dest, seededNoise(ctx), spec);
  const buffer = await ctx.startRendering();
  return buffer.getChannelData(0);
}

/** 16-bit mono PCM WAV around a Float32Array — for export. */
export function encodeWav(samples, rate = 44100) {
  const n = samples.length;
  const out = new ArrayBuffer(44 + n * 2);
  const v = new DataView(out);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(x * 32767), true);
  }
  return out;
}
