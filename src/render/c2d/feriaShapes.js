// LOS VERBOS DE LA FERIA, sin el `ctx` compartido.
//
// Son 28 formas y viven aparte por la misma razón que `shapes.js` dejó de
// depender de `gfx.js`: son un catálogo de arte, y un catálogo de arte que sólo
// se puede dibujar sobre el canvas del juego no se puede meter en una hoja
// sintética ni en la vista previa del editor.
//
// **La hoja encontró esto en su primera corrida.** `tools/shot-feria.mjs` dibujó
// los 14 juegos y salieron 66 164 px de tinta que eran SÓLO las sombras: el
// cuerpo de cada juego se había pintado sobre el canvas del juego, porque la
// tabla escribía en `ctx` mientras el resto de la función escribía en `g`. Es
// exactamente el mismo fallo que tenían `label`/`areaLabel` en el otro
// intérprete, encontrado por el mismo método.
//
// **ESTE ES EL SEGUNDO INTÉRPRETE Y SIGUE SIENDO EL SEGUNDO.** Sus verbos no se
// fundieron con los de `shapes.js` y la razón es medida, no pereza: la feria mide
// en FRACCIONES DEL RADIO del juego (`(p.r||1)*r`) con sufijo `Px` para lo
// absoluto —un tercer marco— y de sus 28 verbos sólo `disc` y `ring` coinciden
// de nombre con los de allá. Los demás no son primitivas: `counter`, `awning`,
// `facade`, `prizes`, `goods` son RECETAS compuestas de un puesto de feria.
// Reescribir 71 partes afinadas a mano para que hablen el otro vocabulario
// cambiaría los píxeles del campo ferial sin que el jugador gane nada. Lo que sí
// se cerró es la deriva que importaba: la lista de verbos ya no está copiada en
// el validador del editor — se exporta desde acá y se pregunta.
import { hash01, label, roundRect } from "./primitives.js";
// `with { type: "json" }` es OBLIGATORIO acá, por la misma razón que en
// `game/surfaces.js`: este módulo se carga bajo Node pelado —el editor lo importa
// para su vista previa y para preguntarle sus verbos— y Node rechaza un import de
// JSON sin atributo. Vite lo acepta sin él, así que la falta no se nota hasta que
// algo fuera del navegador lo abre.
import ASSETS from "./feriaAssets.json" with { type: "json" };

// `$defaults` es lo que dibuja un verbo cuando la receta NO trae ese campo;
// `$chrome` es el decorado que no pertenece a ningún juego —las guirnaldas, las
// costuras, la sombra de un toldo—. Tres verbos leen `$chrome` y por eso viene
// también acá: `awning`, `banner` y `banderines`.
const D = ASSETS.$defaults, CH = ASSETS.$chrome;
const TAU = Math.PI * 2;

function pick(palette, i) {
  if (!palette || !palette.length) return D.fallback;
  return palette[i % palette.length];
}

export const FERIA_SHAPES = {
  disc(g, p, r) {
    g.fillStyle = p.fill || D.disc;
    g.beginPath();
    g.arc(0, p.dyPx || 0, (p.r || 1) * r, 0, TAU);
    g.fill();
  },

  ring(g, p, r) {
    g.strokeStyle = p.stroke || D.ring;
    g.lineWidth = p.widthPx || 2;
    g.beginPath();
    g.arc(0, p.dyPx || 0, (p.r || 1) * r, 0, TAU);
    g.stroke();
  },

  spokes(g, p, r) {
    g.strokeStyle = p.stroke || D.spokes;
    g.lineWidth = p.widthPx || 1.5;
    const n = p.n || 8, r0 = (p.r0 || 0) * r, r1 = (p.r1 || 1) * r, dy = p.dyPx || 0;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.moveTo(Math.cos(a) * r0, dy + Math.sin(a) * r0);
      g.lineTo(Math.cos(a) * r1, dy + Math.sin(a) * r1);
    }
    g.stroke();
  },

  // arms with a car on the end — el pulpo, las sillas, los caballitos
  arms(g, p, r) {
    const n = p.n || 8, len = (p.r || 1) * r;
    g.strokeStyle = p.stroke || D.arms;
    g.lineWidth = p.widthPx || 3;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    }
    g.stroke();
    if (!p.cap) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.fillStyle = pick(p.cap.palette, i);
      g.beginPath();
      g.arc(Math.cos(a) * len, Math.sin(a) * len, p.cap.radiusPx || 4, 0, TAU);
      g.fill();
    }
  },

  // boxes round a circle — gondolas, the tagada's riders, the gusanito's train
  cabins(g, p, r, t, ph, A, spec, spinA) {
    const n = p.n || 8, rad = (p.r || 1) * r;
    const w = p.wPx || 8, h = p.hPx || 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      g.save();
      g.translate(x, y);
      // A GONDOLA HANGS. It stays level however far round the wheel it has got,
      // and the frame is turning under it — so it is counter-rotated by exactly
      // the spin this part was drawn under. Without it the cabins cartwheel with
      // the rim, which is the one thing a Ferris wheel visibly does not do.
      if (p.hang) g.rotate(-spinA);
      g.fillStyle = pick(p.palette, i);
      roundRect(g, -w / 2, -h / 2, w, h, 2, true, false);
      g.restore();
    }
  },

  box(g, p, r) {
    g.fillStyle = p.fill || D.box;
    roundRect(g, (p.x || 0) * r, (p.y || 0) * r, (p.w || 1) * r, (p.h || 1) * r,
      p.roundPx || 2, true, false);
  },

  legs(g, p, r) {
    g.strokeStyle = p.stroke || D.legs;
    g.lineWidth = p.widthPx || 4;
    const s = (p.spread || 0.7) * r, d = (p.drop || 0.6) * r;
    g.beginPath();
    g.moveTo(-s, d); g.lineTo(0, 0); g.lineTo(s, d);
    g.stroke();
  },

  mast(g, p) {
    g.fillStyle = p.fill || D.mast;
    const w = p.widthPx || 6, h = p.hPx || 26;
    g.fillRect(-w / 2, -h, w, h);
  },

  // el martillo: an arm about the centre with a cabin on the end
  pendulum(g, p, r, t) {
    const sw = p.swing || { amp: 2.6, speed: 0.25 };
    const a = Math.sin(t * sw.speed * TAU + (p.phase || 0)) * sw.amp - Math.PI / 2;
    const len = (p.len || 0.9) * r;
    g.strokeStyle = p.stroke || D.pendulumArm;
    g.lineWidth = p.widthPx || 5;
    g.beginPath(); g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
    if (!p.cab) return;
    g.save();
    g.translate(Math.cos(a) * len, Math.sin(a) * len);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = p.cab.fill || D.pendulumCab;
    roundRect(g, -(p.cab.wPx || 10) / 2, -(p.cab.hPx || 8) / 2,
      p.cab.wPx || 10, p.cab.hPx || 8, 2, true, false);
    g.restore();
  },

  dish(g, p, r) {
    g.fillStyle = p.fill || D.dish;
    g.beginPath(); g.arc(0, 0, (p.r || 1) * r, 0, TAU); g.fill();
    g.strokeStyle = p.rim || D.dishRim;
    g.lineWidth = p.rimPx || 5;
    g.beginPath(); g.arc(0, 0, (p.r || 1) * r, 0, TAU); g.stroke();
  },

  // el carrusel's striped roof
  canopy(g, p, r) {
    const n = p.n || 12, rad = (p.r || 1) * r;
    for (let i = 0; i < n; i++) {
      g.fillStyle = pick(p.palette, i);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, rad, (i / n) * TAU, ((i + 1) / n) * TAU);
      g.closePath();
      g.globalAlpha = 0.35;
      g.fill();
      g.globalAlpha = 1;
    }
  },

  boat(g, p, r, t) {
    const sw = p.swing || { amp: 0.7, speed: 0.2 };
    const a = Math.sin(t * sw.speed * TAU) * sw.amp;
    const piv = (p.pivot || 0.9) * r;
    g.save();
    g.rotate(a);
    g.translate(0, piv);
    const w = (p.w || 1.4) * r, h = (p.h || 0.5) * r;
    g.fillStyle = p.fill || D.boat;
    g.beginPath();
    g.moveTo(-w / 2, -h / 2);
    g.quadraticCurveTo(0, h * 0.9, w / 2, -h / 2);
    g.closePath(); g.fill();
    g.strokeStyle = p.trim || D.boatTrim;
    g.lineWidth = 1.6; g.stroke();
    g.restore();
  },

  track(g, p, r) {
    g.strokeStyle = p.stroke || D.track;
    g.lineWidth = p.widthPx || 5;
    g.beginPath(); g.arc(0, 0, (p.r || 1) * r, 0, TAU); g.stroke();
  },

  facade(g, p, r) {
    const w = (p.w || 1.6) * r, h = (p.h || 1.1) * r;
    g.fillStyle = p.fill || D.facade;
    roundRect(g, -w / 2, -h / 2, w, h, 3, true, false);
    g.strokeStyle = p.trim || D.facadeTrim;
    g.lineWidth = 2; g.stroke();
    if (!p.door) return;
    const dw = (p.door.w || 0.3) * r, dh = (p.door.h || 0.6) * r;
    g.fillStyle = p.door.fill || D.facadeDoor;
    g.fillRect(-dw / 2, h / 2 - dh, dw, dh);
  },

  counter(g, p, r) {
    const w = (p.w || 1.5) * r, h = (p.h || 0.6) * r, dy = (p.dy || 0) * r;
    g.fillStyle = p.fill || D.counter;
    roundRect(g, -w / 2, dy - h / 2, w, h, 2, true, false);
    g.fillStyle = p.top || D.counterTop;
    g.fillRect(-w / 2, dy - h / 2, w, Math.max(2, h * 0.3));
    // the stainless rail along the front — the bright line under the food
    if (p.trim) {
      g.strokeStyle = p.trim;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-w / 2, dy + h / 2 - 1); g.lineTo(w / 2, dy + h / 2 - 1);
      g.stroke();
    }
  },

  // LA LONA. Seen from above the chinamos' roof is one long blue tarp pitched
  // in gables over each bay — the ridge catches the light, the eaves fall away
  // dark. Drawn as one module so a row of them butts into a continuous roof.
  tarp(g, p, r) {
    const w = (p.w || 1.8) * r, h = (p.h || 0.8) * r, bays = p.bays || 3;
    g.fillStyle = p.eave || D.tarpEave;
    roundRect(g, -w / 2, -h / 2, w, h, 2, true, false);
    const seg = w / bays;
    for (let i = 0; i < bays; i++) {
      const x0 = -w / 2 + i * seg;
      // each bay: a lit ridge running front-to-back, darker to either side
      // `grad`, no `g`: la variable local se llamaba `g` cuando el contexto era
      // `ctx`, y al parametrizar la superficie las dos colisionaron —
      // `const g = g.createLinearGradient(...)` es un TDZ que revienta la lona.
      const grad = g.createLinearGradient(x0, 0, x0 + seg, 0);
      grad.addColorStop(0, p.eave || D.tarpEave);
      grad.addColorStop(0.5, p.ridge || D.tarpRidge);
      grad.addColorStop(1, p.eave || D.tarpEave);
      g.fillStyle = grad;
      g.fillRect(x0 + 1, -h / 2 + 1, seg - 2, h - 2);
      // the gable's front point
      g.fillStyle = p.fill || D.tarpFill;
      g.beginPath();
      g.moveTo(x0 + 1, h / 2 - 1);
      g.lineTo(x0 + seg / 2, h / 2 + h * 0.14);
      g.lineTo(x0 + seg - 1, h / 2 - 1);
      g.closePath(); g.fill();
    }
  },

  // EL ANDAMIO. White scaffold pipe with those bulbous cast joints, which is
  // what makes the row read as built rather than as a tent.
  frame(g, p, r) {
    const w = (p.w || 1.8) * r, h = (p.h || 0.8) * r, n = p.n || 4;
    g.strokeStyle = p.stroke || D.frame;
    g.lineWidth = p.widthPx || 2;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i / (n - 1)) * w;
      g.moveTo(x, -h / 2); g.lineTo(x, h / 2 + h * 0.12);
    }
    g.moveTo(-w / 2, h / 2); g.lineTo(w / 2, h / 2);
    g.stroke();
    g.fillStyle = p.stroke || D.frame;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i / (n - 1)) * w;
      g.beginPath(); g.arc(x, h / 2, p.jointPx || 2.2, 0, TAU); g.fill();
    }
  },

  // LOS BANDERINES. The neon pennant line along the front of the row, and the
  // thing that says "feria" from further away than anything else here.
  banderines(g, p, r, t, ph) {
    const w = (p.w || 2.0) * r, n = p.n || 10, dy = (p.dy || 0.7) * r;
    const s = p.sizePx || 5;
    const seg = w / n;
    g.strokeStyle = CH.banderines;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-w / 2, dy);
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + i * seg;
      g.lineTo(x, dy + Math.sin(i * 0.9 + ph) * 1.2);
    }
    g.stroke();
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * seg;
      const sag = Math.sin(i * 0.9 + ph) * 1.2;
      // they flutter — a slow shear, deterministic per pennant
      const lean = Math.sin(t * 1.6 + i * 0.7 + ph) * 0.28;
      g.fillStyle = pick(p.palette, i);
      g.beginPath();
      g.moveTo(x - s * 0.45, dy + sag);
      g.lineTo(x + s * 0.45, dy + sag);
      g.lineTo(x + lean * s, dy + sag + s);
      g.closePath(); g.fill();
    }
  },

  // EL TECHO DE ZINC. Corrugated sheet, dark, ribbed along the row's length,
  // with the eaves catching a little light. From above this is most of the
  // chinamo's footprint and it should read as METAL, not as cloth.
  zinc(g, p, r) {
    const w = (p.w || 1.9) * r, h = (p.h || 0.8) * r, ribs = p.ribs || 12;
    g.fillStyle = p.fill || D.zinc;
    roundRect(g, -w / 2, -h / 2, w, h, 1.5, true, false);
    g.strokeStyle = p.rib || D.zincRib;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < ribs; i++) {
      const x = -w / 2 + (i / ribs) * w;
      g.moveTo(x, -h / 2 + 1); g.lineTo(x, h / 2 - 1);
    }
    g.stroke();
    g.strokeStyle = p.edge || D.zincEdge;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-w / 2, h / 2); g.lineTo(w / 2, h / 2);
    g.stroke();
  },

  // LA MANTA IMPRESA — and this is the chinamo, seen from above. A band of
  // printed panels on a dark ground: the product photograph, then the name in
  // saturated ink, repeated down the row. It is the brightest thing in the
  // fairground and the reason you can read the food from across the Paseo.
  banner(g, p, r, t, ph, A, spec) {
    const food = spec.foods && spec.foods[A.food];
    const w = (p.w || 1.8) * r, h = (p.h || 0.3) * r, dy = (p.dy || 0.35) * r;
    const n = p.panels || 3;
    g.fillStyle = p.ground || D.bannerGround;
    roundRect(g, -w / 2, dy - h / 2, w, h, 1.5, true, false);
    const seg = w / n;
    const ink = (food && food.ink) || D.bannerInk;
    const accent = (food && food.accent) || D.bannerAccent;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + i * seg;
      // the photograph: a block of the food's own colour, bled to the panel edge
      g.fillStyle = accent;
      g.fillRect(x0 + 1.5, dy - h / 2 + 1.5, seg * 0.42, h - 3);
      // the lettering: two bars of ink, because at this zoom a word IS two bars
      g.fillStyle = ink;
      g.fillRect(x0 + seg * 0.5, dy - h * 0.28, seg * 0.42, h * 0.2);
      g.fillRect(x0 + seg * 0.5, dy + h * 0.04, seg * 0.3, h * 0.16);
    }
    g.strokeStyle = CH.bannerSeam;
    g.lineWidth = 0.8;
    g.strokeRect(-w / 2, dy - h / 2, w, h);
  },

  // EL RÓTULO DE NEÓN. Lit tube lettering over the counter, not a label pill:
  // a glowing bar with the word on it. Kept for the rows that have it — the
  // blue-tarp chinamos on the Paseo do, the printed-banner ones do not.
  neon(g, p, r, t, ph, A, spec) {
    const food = spec.foods && spec.foods[A.food];
    const col = (food && food.neon) || p.color || D.neon;
    const w = (p.w || 1.4) * r, dy = (p.dy || 0.2) * r;
    const flicker = 0.82 + 0.18 * Math.sin(t * 7 + ph * 3);
    g.save();
    g.globalAlpha = flicker;
    g.strokeStyle = col;
    g.lineWidth = 2.4;
    g.lineCap = "round";
    g.shadowColor = col; g.shadowBlur = 6;
    g.beginPath();
    g.moveTo(-w / 2, dy); g.lineTo(w / 2, dy);
    g.stroke();
    g.restore();
  },

  // the striped toldo over a chinamo — the thing that makes it a chinamo
  awning(g, p, r) {
    const w = (p.w || 1.7) * r, h = (p.h || 0.42) * r, n = p.n || 7;
    const seg = w / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = pick(p.stripes, i);
      g.beginPath();
      g.moveTo(-w / 2 + i * seg, -h);
      g.lineTo(-w / 2 + (i + 1) * seg, -h);
      g.lineTo(-w / 2 + (i + 1) * seg, 0);
      g.lineTo(-w / 2 + i * seg, 0);
      g.closePath(); g.fill();
    }
    // the scalloped edge
    g.fillStyle = CH.awningShadow;
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(-w / 2 + (i + 0.5) * seg, 0, seg * 0.5, 0, Math.PI);
      g.fill();
    }
  },

  // what is on the counter: churros standing in their cup, manzanas on sticks
  goods(g, p, r, t, ph, A, spec) {
    const food = spec.foods && spec.foods[A.food];
    const palette = (food && food.goods) || D.goods;
    const n = p.n || 5, w = (p.w || 1.3) * r;
    for (let i = 0; i < n; i++) {
      g.fillStyle = pick(palette, i);
      g.beginPath();
      g.arc(-w / 2 + (i + 0.5) * (w / n), -r * 0.36, p.radiusPx || 3, 0, TAU);
      g.fill();
    }
  },

  prizes(g, p, r) {
    const n = p.n || 7, w = (p.w || 1.5) * r;
    for (let i = 0; i < n; i++) {
      g.fillStyle = pick(p.palette, i);
      g.beginPath();
      g.arc(-w / 2 + (i + 0.5) * (w / n), -r * 0.5, p.radiusPx || 3.4, 0, TAU);
      g.fill();
    }
  },

  cars(g, p, r, t, ph) {
    const n = p.n || 6, w = (p.areaW || 1.6) * r, h = (p.areaH || 0.9) * r;
    for (let i = 0; i < n; i++) {
      const s = hash01(i * 3.7 + ph) * TAU;
      const x = Math.cos(t * (p.speed || 0.5) + s) * w * 0.4;
      const y = Math.sin(t * (p.speed || 0.5) * 1.3 + s * 1.7) * h * 0.34;
      g.save();
      g.translate(x, y);
      g.rotate(Math.sin(t * 0.7 + s) * 0.9);
      g.fillStyle = pick(p.palette, i);
      roundRect(g, -(p.wPx || 9) / 2, -(p.hPx || 6) / 2, p.wPx || 9, p.hPx || 6, 2, true, false);
      g.restore();
    }
  },

  speakers(g, p, r, t) {
    const off = (p.offset || 0.7) * r, w = p.wPx || 7, h = p.hPx || 12;
    const pump = p.pump ? 1 + Math.sin(t * (p.pump.speed || 2) * TAU) * p.pump.amp : 1;
    for (const side of [-1, 1]) {
      g.fillStyle = p.fill || D.speaker;
      roundRect(g, side * off - w / 2, -h / 2, w, h, 1.5, true, false);
      g.fillStyle = p.cone || D.speakerCone;
      g.beginPath();
      g.arc(side * off, -h * 0.18, w * 0.3 * pump, 0, TAU); g.fill();
      g.beginPath();
      g.arc(side * off, h * 0.24, w * 0.22 * pump, 0, TAU); g.fill();
    }
  },

  // LAS LUCES. A feria at night IS its bulbs, so they are their own shape and
  // they twinkle on a deterministic phase rather than at random.
  bulbs(g, p, r, t, ph) {
    const n = p.n || 12;
    for (let i = 0; i < n; i++) {
      let x, y;
      if (p.rect) {
        // strung round a rectangle: walk its perimeter
        const w = p.rect.w * r, h = p.rect.h * r;
        const per = (i / n) * (2 * (w + h));
        if (per < w) { x = -w / 2 + per; y = -h / 2; }
        else if (per < w + h) { x = w / 2; y = -h / 2 + (per - w); }
        else if (per < 2 * w + h) { x = w / 2 - (per - w - h); y = h / 2; }
        else { x = -w / 2; y = h / 2 - (per - 2 * w - h); }
      } else {
        const a = (i / n) * TAU;
        x = Math.cos(a) * (p.r || 1) * r;
        y = Math.sin(a) * (p.r || 1) * r;
      }
      const tw = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7 + ph);
      g.globalAlpha = tw;
      g.fillStyle = pick(p.palette, i);
      g.beginPath(); g.arc(x, y, p.radiusPx || 1.4, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
  },

  sign(g, p, r, t, ph, A, spec) {
    let text = p.text, fill = p.fill || D.signFg, bg = p.bg || D.signBg;
    if (p.fromFood) {
      const food = spec.foods && spec.foods[A.food];
      if (!food) return;
      text = food.label; fill = food.fill; bg = food.bg;
    }
    if (!text) return;
    label(g, 0, (p.dyPx || -1.4) * r, text, fill, bg);
  },
};

/** Los nombres que este intérprete dibuja. Se exporta para que el validador del
 *  editor los PREGUNTE en vez de tener una copia: la copia de 28 nombres que
 *  tenía se atrasaría el día que se agregue un verbo, y el fallo es invisible
 *  —la pieza simplemente no aparece. */
export const FERIA_SHAPE_NAMES = Object.freeze(Object.keys(FERIA_SHAPES));
