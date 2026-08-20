// THE DRAWING PRIMITIVES THAT NEED NOTHING BUT A CONTEXT.
//
// This file exists so `shapes.js` — the shape interpreter, the engine's half of
// every art catalog — can be imported WITHOUT importing the game. It used to
// take four things from `gfx.js`, and `gfx.js` is the bottom of the renderer:
// it pulls in the world accessor, the mutable `state`, the day cycle, the player
// tuning, `units` and `materials.json`. So the interpreter could not be loaded
// by anything that is not the running game — which is exactly what the world
// editor needs to do to draw a preview of the record it is editing.
//
// The editor previewing an asset with its OWN drawing code is not an option:
// that already happened once, and the editor showed a `park` as `#5ba362` while
// the game painted `#4f9d5b`. One interpreter or the preview is a lie.
//
// THE RULE FOR THIS FILE: a function belongs here only if the CALLER hands it
// everything it needs. No module-level `ctx`, no `state`, no registries, no
// imports at all. That is what makes it loadable outside a browser tab, and the
// moment something in here reaches for a shared binding the property is gone.

/** Deterministic 0..1 hash for scene scatter (no `Math.random` in draw paths).
 *
 *  THE SAME ONE `flora.js` PLANTS TREES WITH, on purpose — a scatter that is
 *  stable across frames is the whole reason it is a hash and not a random, and
 *  two hashes would mean two different stabilities. It is shared, never copied. */
export function hash01(n) {
  const v = Math.sin(n) * 43758.5453;
  return v - Math.floor(v);
}

/** Attach a runtime alpha to an authored RGB triplet.
 *
 * Effects ramp opacity every frame, so storing a complete rgba() string would
 * make its alpha a dead knob. `rgb` is data (`"r,g,b"` or `[r,g,b]`); only the
 * clamping and CSS composition are engine behaviour. */
export function alphaColor(rgb, alpha) {
  const channels = Array.isArray(rgb) ? rgb.join(",") : rgb;
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${channels},${a})`;
}

/** A rounded rectangle on `c`. Takes its context as an argument, which is why it
 *  could move here unchanged. */
export function roundRect(c, x, y, w, h, r, fill, stroke) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r); c.closePath();
  if (fill) c.fill(); if (stroke) c.stroke();
}

/** A point landmark's name pill.
 *
 *  `g` IS NOW THE FIRST ARGUMENT, and that is the one real change in this lift.
 *  It used to draw on `gfx`'s shared `ctx` no matter who called it, so a caller
 *  that passed its own canvas — an art sheet, and soon the editor's preview —
 *  got its parts on one surface and its labels on another. */
export function label(g, x, y, text, fg, bg, size = 10) {
  // UN RÓTULO DE LADO NO ES UN RÓTULO. Cuando la cámara del nivel va girada, el
  // mundo gira con ella y el texto también — así que la placa se contragira
  // sobre su propia ancla. El ángulo viaja en el CONTEXTO porque este módulo no
  // importa nada por contrato (`test_shape_interpreter`), y el contexto es lo
  // único que ya recibe.
  const rot = g.__worldRot || 0;
  if (rot) { g.save(); g.translate(x, y); g.rotate(-rot); x = 0; y = 0; }
  g.font = `bold ${size}px 'JetBrains Mono', monospace`;
  g.textAlign = "center";
  const w = g.measureText(text).width + size;
  const h = size + 4;
  g.fillStyle = bg; roundRect(g, x - w / 2, y - h * 0.64, w, h, 4, true, false);
  g.fillStyle = fg; g.fillText(text, x, y + size * 0.1);
  if (rot) g.restore();
}

// Tag for an AREA landmark (park, estadio, plaza, parcel). Three rules the
// long real names forced: the type is SMALLER than a point-landmark pill (a
// full "Parroquia Nuestra Señora de El Carmen" at pill size swamps its own
// cuadra), a long name WRAPS to two lines at the space nearest its middle
// rather than running off the block, and the stack sits nearer the centre of
// the area than its top edge — pinned to the top it read as floating off.
const AREA_WRAP = 15;          // chars before a name is split in two
const AREA_ALPHA = 0.62;       // semi-transparent: an area tag sits ON its own
                               // artwork (the church, the garden trees), so it
                               // has to be readable WITHOUT hiding what it names
export function areaLabel(g, x0, y0, x1, y1, text, fg, bg) {
  const cx = (x0 + x1) / 2;
  let lines = [text];
  if (text.length > AREA_WRAP) {
    // break at the space closest to the middle, so both lines read evenly
    const mid = text.length / 2;
    let best = -1;
    for (let i = 0; i < text.length; i++)
      if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    if (best > 0) lines = [text.slice(0, best), text.slice(best + 1)];
  }
  const lh = 7;
  const top = Math.min(y0 + (y1 - y0) * 0.30, (y0 + y1) / 2 - ((lines.length - 1) * lh) / 2);
  g.save();
  g.globalAlpha = AREA_ALPHA;
  for (let i = 0; i < lines.length; i++) label(g, cx, top + i * lh, lines[i], fg, bg, 5.5);
  g.restore();
}
