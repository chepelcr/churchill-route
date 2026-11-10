// LA RADIO — the stations you hear while driving.
//
// THE STATION IS DATA, THE BAND IS CODE. `src/assets/audio.json → stations`
// says the tempo, the key, the chord walk and, per instrument, which VERB plays
// it and on which steps. This file is the band: what a `kick` or a `pad` IS in
// oscillators, and the little bit of musicianship no JSON should hold — which
// note a lead walks to next, when a bar becomes a fill. A registry with a rule
// in it would stop being a registry, so the data only picks and tunes.
//
// Same contract as `recipe.js`: no DOM, no `window`, no imports. It takes the
// AudioContext, the destination and the noise buffer, so the live game and an
// OfflineAudioContext render (`tools/render-audio.mjs station:<id>`) run the
// SAME code — which is the only way to listen to a station outside the game.
//
// SCHEDULED ONE BAR AHEAD, like DJ Urtech's set, and for the same reason: a
// queued note must be droppable. Every bar plays into its OWN gain node, so a
// pause or a station change fades exactly what is already queued instead of
// letting it ring out over the next screen.
//
// THE VARIETY IS A HASH OF THE BAR NUMBER, never `Math.random`. Two reasons:
// an offline render is reproducible (so it can be compared), and music needs
// REPETITION to read as music — the lead is seeded per phrase, so bars 1–4
// come back as bars 5–8 and only the next phrase walks somewhere new.

/** Every instrument verb a station may name. `tests/test_audio.py` reads this. */
export const RADIO_VERBS = [
  "kick", "snare", "clap", "hat", "shaker", "bass", "arp", "lead", "pad", "pluck",
];

const DRUMS = new Set(["kick", "snare", "clap", "hat", "shaker"]);

/** Deterministic 0..1 from integers. */
function hash01(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Scale degree (may run past the scale, either way) -> semitones from root. */
function degreeSemis(scale, d) {
  const n = scale.length;
  const oct = Math.floor(d / n);
  return scale[((d % n) + n) % n] + 12 * oct;
}

// ---- voices -----------------------------------------------------------------
//
// One oscillator with an attack, a decay to a sustain level and a release, into
// an optional filter. The recipe interpreter's `tone` has no attack (every
// one-shot is percussive), and a pad without an attack is a beep.
function osc(ctx, dest, t0, hz, o) {
  const {
    type = "sine", dur = 0.2, gain = 0.1, attack = 0.005, release = 0.05,
    sustain = 1, filterHz = null, q = 0.7, detune = 0, toHz = null, sweep = false,
  } = o;
  const v = ctx.createOscillator();
  v.type = type;
  v.frequency.setValueAtTime(hz, t0);
  if (toHz) v.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t0 + dur);
  if (detune) v.detune.setValueAtTime(detune, t0);
  const g = ctx.createGain();
  const peak = Math.max(0.0002, gain);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  const hold = Math.max(attack, dur - release);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * sustain), t0 + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let head = v;
  if (filterHz) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = q;
    f.frequency.setValueAtTime(filterHz, t0);
    // the filter closing over the note is what makes a saw a bass and not a buzz
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, filterHz * 0.18), t0 + dur);
    v.connect(f); head = f;
  }
  head.connect(g); g.connect(dest);
  v.start(t0); v.stop(t0 + dur + 0.03);
}

function burst(ctx, dest, buf, t0, o) {
  const { dur = 0.05, gain = 0.1, band = null, high = null, q = 1 } = o;
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let head = s;
  if (band || high) {
    const f = ctx.createBiquadFilter();
    f.type = high ? "highpass" : "bandpass";
    f.frequency.value = high || band; f.Q.value = q;
    s.connect(f); head = f;
  }
  head.connect(g); g.connect(dest);
  // a random start into the buffer, so two hats in a row are not the same hat
  s.start(t0, (t0 * 7.31) % 0.8); s.stop(t0 + dur + 0.02);
}

// What each verb IS. `tr` is the track record (its tuning wins over these
// defaults); `ch` is the pattern character, so an accent or an open hat is a
// letter in the data rather than another track.
const PLAY = {
  kick(c, d, b, t, tr, ch) {
    const g = (tr.gain ?? 0.5) * (ch === "X" ? 1.15 : 1);
    osc(c, d, t, tr.hz ?? 140, { type: "sine", toHz: tr.toHz ?? 44, dur: tr.dur ?? 0.22, gain: g, attack: 0.002, release: 0.12 });
    if (tr.click !== false) osc(c, d, t, 1200, { type: "square", toHz: 250, dur: 0.018, gain: g * 0.18, attack: 0.001, release: 0.01 });
  },
  snare(c, d, b, t, tr, ch) {
    const g = (tr.gain ?? 0.22) * (ch === "X" ? 1.2 : ch === "g" ? 0.35 : 1);
    burst(c, d, b, t, { dur: tr.dur ?? 0.16, gain: g, band: tr.band ?? 1900, q: 0.6 });
    osc(c, d, t, tr.hz ?? 190, { type: "triangle", toHz: (tr.hz ?? 190) * 0.6, dur: 0.09, gain: g * 0.8, attack: 0.001, release: 0.06 });
  },
  clap(c, d, b, t, tr) {
    const g = tr.gain ?? 0.2;
    for (const off of [0, 0.011, 0.022]) burst(c, d, b, t + off, { dur: 0.02, gain: g * 0.7, band: 1400, q: 0.8 });
    burst(c, d, b, t + 0.03, { dur: tr.dur ?? 0.14, gain: g, band: 1300, q: 0.7 });
  },
  hat(c, d, b, t, tr, ch) {
    const open = ch === "o";
    burst(c, d, b, t, { dur: open ? (tr.openDur ?? 0.22) : (tr.dur ?? 0.035),
      gain: (tr.gain ?? 0.07) * (ch === "X" ? 1.4 : 1), high: tr.high ?? 7000, q: 0.7 });
  },
  shaker(c, d, b, t, tr, ch) {
    burst(c, d, b, t, { dur: tr.dur ?? 0.06, gain: (tr.gain ?? 0.05) * (ch === "X" ? 1.5 : 1),
      band: tr.band ?? 5200, q: 1.4 });
  },
  bass(c, d, b, t, tr, ch, m) {
    osc(c, d, t, midiHz(m.note), { type: tr.osc ?? "sawtooth", dur: m.len, gain: tr.gain ?? 0.16,
      attack: 0.004, release: Math.min(0.08, m.len * 0.4), sustain: tr.sustain ?? 0.6,
      filterHz: tr.filterHz ?? 700, q: tr.q ?? 4, sweep: tr.sweep ?? true });
  },
  arp(c, d, b, t, tr, ch, m) {
    osc(c, d, t, midiHz(m.note), { type: tr.osc ?? "square", dur: m.len, gain: tr.gain ?? 0.05,
      attack: 0.003, release: m.len * 0.6, sustain: 0.4, filterHz: tr.filterHz ?? 2600, q: 1, sweep: true });
  },
  lead(c, d, b, t, tr, ch, m) {
    const o = { type: tr.osc ?? "square", dur: m.len, gain: tr.gain ?? 0.05, attack: tr.attack ?? 0.01,
      release: m.len * 0.5, sustain: 0.7, filterHz: tr.filterHz ?? 3200, q: 0.8 };
    osc(c, d, t, midiHz(m.note), o);
    if (tr.detune) osc(c, d, t, midiHz(m.note), { ...o, detune: tr.detune, gain: o.gain * 0.6 });
  },
  pad(c, d, b, t, tr, ch, m) {
    for (const n of m.chord) {
      for (const det of [-(tr.detune ?? 8), tr.detune ?? 8]) {
        osc(c, d, t, midiHz(n), { type: tr.osc ?? "sawtooth", dur: m.len, gain: (tr.gain ?? 0.025) / 2,
          attack: tr.attack ?? 0.35, release: tr.release ?? 0.4, sustain: 0.85,
          filterHz: tr.filterHz ?? 1200, q: 0.5, detune: det });
      }
    }
  },
  pluck(c, d, b, t, tr, ch, m) {
    // a marimba-ish pluck: the fundamental plus a quiet fourth partial, both
    // dying fast — wood, not a synth
    const len = Math.min(m.len, tr.dur ?? 0.35);
    osc(c, d, t, midiHz(m.note), { type: "sine", dur: len, gain: tr.gain ?? 0.09, attack: 0.002, release: len * 0.9, sustain: 0.3 });
    osc(c, d, t, midiHz(m.note) * 4, { type: "sine", dur: len * 0.3, gain: (tr.gain ?? 0.09) * 0.18, attack: 0.001, release: len * 0.25, sustain: 0.2 });
  },
};

/** The pattern a track plays on bar `bar`: a variant by phrase, a fill at the end. */
function patternFor(station, tr, ti, bar) {
  const every = station.fillEvery || 8;
  if (tr.fill && bar % every === every - 1) return tr.fill;
  const pats = tr.patterns;
  if (pats.length === 1) return pats[0];
  // the variant changes with the PHRASE (4 bars), not with every bar, or the
  // groove never settles long enough to be one
  return pats[Math.floor(hash01(Math.floor(bar / 4), ti, 17) * pats.length)];
}

/**
 * Schedule one bar of `station` into `dest` starting at absolute time `t0`.
 * `state` carries the lead's last note across bars. Exported so the offline
 * render can drive it without the live wrapper.
 */
export function scheduleBar(ctx, dest, noiseBuf, station, bar, t0, state = {}) {
  const step = 60 / station.bpm / 4;                        // a 16th
  const scale = station.scale;
  const prog = station.progression;
  const degree = prog[bar % prog.length];
  const root = station.root;
  const chordDeg = [degree, degree + 2, degree + 4];
  const swing = station.swing || 0;

  station.tracks.forEach((tr, ti) => {
    const pat = patternFor(station, tr, ti, bar);
    const oct = 12 * (tr.octave || 0);
    const chord = chordDeg.map((d) => root + oct + degreeSemis(scale, d));
    // the lead is seeded by the PHRASE and the bar within it, so a phrase
    // repeats once before the next one walks somewhere else
    const phrase = Math.floor(bar / 8);
    const inPhrase = bar % 4;
    let arpI = 0;
    if (tr.verb === "lead" && state[ti] === undefined) state[ti] = degree + 4;
    for (let i = 0; i < 16; i++) {
      const ch = pat[i];
      if (ch === "." || ch === "-" || ch === undefined) continue;
      if (tr.density !== undefined && hash01(phrase, inPhrase * 16 + i, ti + 3) > tr.density) continue;
      // a held note runs until the next hit; `-` extends it
      let n = 1;
      while (i + n < 16 && pat[i + n] === "-") n++;
      const len = n * step * (tr.gate ?? 0.9);
      const t = t0 + i * step + (i % 2 ? swing * step : 0);
      const m = { len, chord };
      if (DRUMS.has(tr.verb)) {
        // nothing to pick
      } else if (tr.verb === "bass") {
        // x = the chord's root, 3 = its third, 5 = a fifth above, 8 = the octave
        m.note = ch === "3" ? chord[1] : chord[0] + (ch === "5" ? 7 : ch === "8" ? 12 : 0);
      } else if (tr.verb === "arp") {
        const seq = tr.order || [0, 1, 2, 1];
        const k = seq[arpI++ % seq.length];
        m.note = chord[k % 3] + 12 * Math.floor(k / 3);
      } else if (tr.verb === "lead") {
        // a walk on the scale: mostly steps, sometimes a leap, and on the
        // downbeats it lands on a chord tone so the line agrees with the bass
        const r = hash01(phrase, inPhrase * 16 + i, ti);
        let d = state[ti] + (r < 0.3 ? -1 : r < 0.6 ? 1 : r < 0.75 ? 2 : r < 0.9 ? -2 : 0);
        if (i % 4 === 0) {
          d = chordDeg.reduce((best, c) => {
            const L = scale.length;
            const cc = c + L * Math.round((d - c) / L);
            return Math.abs(cc - d) < Math.abs(best - d) ? cc : best;
          }, d + 99);
        }
        const lo = tr.low ?? 0, hi = tr.high ?? 11;
        d = Math.max(lo, Math.min(hi, d));
        state[ti] = d;
        m.note = root + oct + degreeSemis(scale, d);
      } else if (tr.verb === "pluck") {
        const k = Math.floor(hash01(phrase, inPhrase * 16 + i, ti + 9) * 4);
        m.note = chord[k % 3] + (k === 3 ? 12 : 0);
      } else if (tr.verb === "pad") {
        m.chord = chord;
      }
      const play = PLAY[tr.verb];
      if (play) play(ctx, dest, noiseBuf, t, tr, ch, m);
    }
  });
  return 16 * step;
}

/**
 * The live radio: owns an output gain into `dest` and schedules bars as
 * `tick()` is called. `stations` is the registry block.
 */
export function createRadio(ctx, dest, noiseBuf, stations) {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  let station = null, stationId = null;
  let bar = 0, nextAt = 0, state = {};
  let live = [];                 // [{ gain, end }] — the bars in flight

  function dropQueued(fade = 0.08) {
    const now = ctx.currentTime;
    for (const b of live) {
      b.gain.gain.cancelScheduledValues(now);
      b.gain.gain.setTargetAtTime(0, now, fade / 3);
      const g = b.gain;
      setTimeout(() => { try { g.disconnect(); } catch { /* gone */ } }, (fade + 0.3) * 1000);
    }
    live = [];
  }

  return {
    get station() { return stationId; },
    setStation(id) {
      if (id === stationId) return;
      dropQueued(0.5);           // the crossfade: the old bar fades as the new starts
      stationId = id;
      station = (id && stations[id] && !id.startsWith("_")) ? stations[id] : null;
      bar = 0; state = {}; nextAt = ctx.currentTime + 0.05;
    },
    /** `level` 0..1 — call every frame while the radio should be heard. */
    tick(level) {
      const now = ctx.currentTime;
      out.gain.setTargetAtTime(Math.max(0, level), now, 0.25);
      live = live.filter((b) => b.end > now - 1);
      if (!station || level <= 0.001) { nextAt = Math.max(nextAt, now + 0.05); return; }
      if (now < nextAt - 0.3) return;                    // the next bar is queued
      const t0 = Math.max(now + 0.05, nextAt);
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(out);
      const len = scheduleBar(ctx, g, noiseBuf, station, bar, t0, state);
      live.push({ gain: g, end: t0 + len + 1 });
      bar++;
      nextAt = t0 + len;
    },
    /** Silence now and forget what was queued (pause, menus). */
    stop() {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      dropQueued(0.06);
      nextAt = ctx.currentTime;
    },
    get level() { return out.gain.value; },
  };
}

/** Render `seconds` of a station offline; returns the mono PCM. */
export async function renderStation(OfflineCtx, station, noiseFn, { seconds = 20, rate = 44100, gain = 1 } = {}) {
  const ctx = new OfflineCtx(1, Math.ceil(rate * seconds), rate);
  const g = ctx.createGain();
  g.gain.value = gain;
  g.connect(ctx.destination);
  const buf = noiseFn(ctx);
  const state = {};
  let t = 0.02, bar = 0;
  while (t < seconds) { t += scheduleBar(ctx, g, buf, station, bar++, t, state); }
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}
