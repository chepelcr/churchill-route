// EL MUNDO DE LA VÍA: tierra, obra de fábrica, carril y convoy.
//
// Todo lo que hay aquí es GEOMETRÍA DERIVADA y por eso está en código y no en el
// registro: el terreno sale del perfil del DEM, el carril sigue la curva que el
// nivel produjo —rizo incluido—, y un puente se cuenta sobre su propio vano. Las
// medidas y las tintas, en cambio, son todas del registro: `railway-art.json`
// pone el paso de los durmientes, el canto de la celosía y los verdes de cada
// barrio, y este archivo no escribe un hex.
//
// El orden de pintado es el que resuelve tres cosas que no se ven hasta que
// están mal:
//
//   1. **LA TIERRA NUNCA TAPA EL CARRIL.** El tablero es el suelo suavizado y
//      con pendiente limitada, así que en un desmonte el terreno queda POR
//      ENCIMA de la vía. La superficie se acota a la cota del tablero y el talud
//      se pinta con su propia tinta: lo que se ve entonces es un corte, que es
//      lo que es.
//   2. **EL HUECO BAJO EL TREN ES UNA OBRA, NUNCA UN DESCUIDO.** Donde el
//      tablero se separa del terreno hay caballete (poco) o puente (mucho). La
//      investigación lo pide por escrito y es, además, la única forma de que los
//      cinco ríos del nivel 1 se lean como ríos.
//   3. **LA ESTACIÓN TIENE ESPALDA Y ANDÉN.** Su cuerpo va detrás del tren y la
//      marquesina y el andén por delante, o la locomotora pasa por encima del
//      edificio.
import { atDistance, loopAt } from "../../game/railway/track.js";
import { paintCar, paintProp, paintRecord } from "./paint.js";
import { alphaColor, hash01 } from "../c2d/primitives.js";

const TAU = Math.PI * 2;

/** Cuánto hueco (metros) hace falta para que la obra deje de ser caballete. */
const BRIDGE_MIN_M = 6.5;
/** Paso del muestreo del terreno, en metros del eje de juego. */
const TERRAIN_STEP_M = 3.5;
/** Cuánto cañón hace falta (metros) para que un puente tenga río debajo. */
const RIVER_MIN_GORGE_M = 6;

/** Mezcla dos colores `#rrggbb`. Es lo que deja que el SUELO también se disuelva
 *  entre escenas: sin esto el cafetal entraba de golpe bajo un cielo que ya se
 *  había mezclado, y el corte se veía en la hierba. */
export function mixHex(a, b, k) {
  if (!b || k <= 0) return a;
  if (k >= 1) return b;
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const mix = (sh) => {
    const va = (pa >> sh) & 255, vb = (pb >> sh) & 255;
    return Math.round(va + (vb - va) * k);
  };
  return `#${((1 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).slice(1)}`;
}

/** La paleta de suelo de la escena activa, ya mezclada con la siguiente. */
export function groundPalette(art, blend) {
  const a = art.scenes[blend.a];
  const b = blend.b ? art.scenes[blend.b] : null;
  const out = {};
  for (const key of Object.keys(a.ground)) {
    out[key] = mixHex(a.ground[key], b?.ground?.[key], blend.blend);
  }
  out.water = { ...(a.water || b?.water || {}) };
  if (a.water && b?.water) {
    for (const key of Object.keys(a.water)) {
      out.water[key] = mixHex(a.water[key], b.water[key], blend.blend);
    }
  }
  return out;
}

/** El normal "hacia arriba" de la vía en un punto. En plano es (0,-1); en la
 *  cima de un rizo apunta al suelo, que es exactamente lo que hace que los
 *  durmientes queden por fuera del lazo y no por dentro. */
function normalOf(angle) {
  return { nx: Math.sin(angle), ny: -Math.cos(angle) };
}

export function paintWorld(g, view) {
  const { art, map, track, run, blend, camX, camY, zoom, w, h, t } = view;
  const ppm = view.ppm;
  const pal = groundPalette(art, blend);
  const leftM = (camX - w * 0.6 / zoom) / ppm;
  const rightM = (camX + w * 0.6 / zoom) / ppm;

  g.save();
  g.translate(w / 2, h / 2);
  g.scale(zoom, zoom);
  g.translate(-camX, -camY);

  const bottom = camY + h * 0.6 / zoom;
  paintTerrain(g, map, art, pal, ppm, leftM, rightM, bottom);
  paintRivers(g, map, art, pal, ppm, leftM, rightM, t);
  paintScatter(g, art, map, pal, blend, ppm, leftM, rightM);
  paintSupports(g, map, art, pal, ppm, leftM, rightM);
  paintLoopFrames(g, art, map, track, ppm, leftM, rightM);
  for (const station of map.stations) {
    if (station.playX < leftM - 60 || station.playX > rightM + 60) continue;
    paintStation(g, art, map, station, ppm, "parts", view);
  }
  paintTrackwork(g, art, map, track, ppm, leftM, rightM);
  paintPickups(g, art, track, run, ppm, leftM, rightM, t);
  paintConsist(g, view);
  // LA CELOSÍA PASANTE VA TAMBIÉN DELANTE. En el Virilla el tren va POR DENTRO
  // del cajón: dibujada sólo detrás, la estructura se lee como una valla al
  // fondo y no como un puente que se cruza.
  for (const span of map.structures) {
    if (span.type !== "bridge" || span.playX1 < leftM - 80 || span.playX0 > rightM + 80) continue;
    paintBridge(g, art, map, span, ppm, "front");
  }
  for (const station of map.stations) {
    if (station.playX < leftM - 60 || station.playX > rightM + 60) continue;
    paintStation(g, art, map, station, ppm, "front", view);
  }
  paintSmoke(g, view);
  g.restore();
}

/** La superficie dibujada, acotada para que nunca suba por encima del tablero. */
function surfaceAt(map, x) {
  return Math.max(map.groundY(x), map.deckY(x) + 0.35);
}

function paintTerrain(g, map, art, pal, ppm, leftM, rightM, bottomPx) {
  const from = Math.floor(leftM / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const cols = [];
  for (let x = from; x <= rightM + TERRAIN_STEP_M; x += TERRAIN_STEP_M) {
    cols.push([x, surfaceAt(map, x)]);
  }
  // EL CUERPO DE TIERRA TIENE PROFUNDIDAD. Relleno plano, el tercio inferior del
  // cuadro es una plancha de un solo café y el ojo lo lee como un error. Un
  // degradado al oscuro más tres vetas de estrato cuestan nada y convierten la
  // plancha en un talud.
  const top = cols.reduce((n, c) => Math.min(n, c[1]), Infinity) * ppm;
  const soil = g.createLinearGradient(0, top, 0, bottomPx);
  soil.addColorStop(0, pal.soil);
  soil.addColorStop(1, pal.soilDark);
  g.beginPath();
  g.moveTo(cols[0][0] * ppm, bottomPx);
  for (const [x, y] of cols) g.lineTo(x * ppm, y * ppm);
  g.lineTo(cols.at(-1)[0] * ppm, bottomPx);
  g.closePath();
  g.fillStyle = soil;
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = pal.soilDark;
  g.lineWidth = Math.max(1, 0.5 * ppm);
  g.globalAlpha = 0.45;
  for (let band = 1; band <= 3; band++) {
    g.beginPath();
    cols.forEach(([x, y], i) => {
      const yy = (y + band * 7 + Math.sin(x * 0.07 + band) * 1.3) * ppm;
      if (i === 0) g.moveTo(x * ppm, yy); else g.lineTo(x * ppm, yy);
    });
    g.stroke();
  }
  g.globalAlpha = 1;
  g.restore();

  // La capa de hierba: el mismo contorno, con un canto claro arriba.
  g.beginPath();
  for (let i = 0; i < cols.length; i++) {
    const [x, y] = cols[i];
    if (i === 0) g.moveTo(x * ppm, y * ppm); else g.lineTo(x * ppm, y * ppm);
  }
  for (let i = cols.length - 1; i >= 0; i--) {
    const [x, y] = cols[i];
    g.lineTo(x * ppm, (y + 1.5) * ppm);
  }
  g.closePath();
  g.fillStyle = pal.grass;
  g.fill();
  g.strokeStyle = pal.grassLite;
  g.lineWidth = Math.max(1, 0.34 * ppm);
  g.beginPath();
  cols.forEach(([x, y], i) => (i ? g.lineTo(x * ppm, y * ppm) : g.moveTo(x * ppm, y * ppm)));
  g.stroke();

  // EL DESMONTE: donde el terreno de verdad quedaba por encima del tablero, el
  // talud lleva su propia tinta. Sin esto el corte se veía como hierba pegada al
  // tren, o sea como un error de dibujo.
  g.fillStyle = pal.cut;
  for (const [x, y] of cols) {
    const real = map.groundY(x);
    if (real >= y - 0.05) continue;
    g.fillRect(x * ppm, y * ppm, TERRAIN_STEP_M * ppm + 1, Math.max(1, (y - real) * 0.42 * ppm));
  }

  // El árido del talud: la misma siembra por hash de la casa.
  g.fillStyle = pal.rock;
  for (let i = 0; i < cols.length; i += 2) {
    const [x, y] = cols[i];
    const hx = hash01(Math.round(x * 3.1) + 11);
    if (hx < 0.6) continue;
    const r = (0.28 + hash01(Math.round(x * 7.7)) * 0.5) * ppm;
    g.beginPath();
    g.ellipse(x * ppm, (y + 2.6 + hash01(Math.round(x * 5.3)) * 6) * ppm, r * 1.4, r, 0, 0, TAU);
    g.fill();
  }
}

/** Los ríos del fondo del cañón, bajo cada puente que la investigación nombra. */
function paintRivers(g, map, art, pal, ppm, leftM, rightM, t) {
  if (!pal.water?.fill) return;
  for (const s of map.structures) {
    if (!s.riverKey) continue;
    if (s.playX1 < leftM - 40 || s.playX0 > rightM + 40) continue;
    const pad = (s.playX1 - s.playX0) * 0.45;
    const x0 = s.playX0 - pad, x1 = s.playX1 + pad;
    const step = (x1 - x0) / 24;
    // EL FONDO DEL VALLE ES LA `y` MÁXIMA, no la mínima: en este marco -y es
    // arriba. Con el signo al revés el agua se dibujaba a la cota MÁS ALTA del
    // tramo —por encima del tablero— y el tren cruzaba por debajo del río, que
    // es exactamente como se veía.
    let floor = -Infinity;
    for (let x = x0; x <= x1; x += step) floor = Math.max(floor, map.groundY(x));
    const deck = map.deckY((s.playX0 + s.playX1) / 2);
    // Y un río sólo se pinta si hay cañón: en un paso elevado de tres metros el
    // agua quedaría lamiendo los durmientes.
    if (floor - deck < RIVER_MIN_GORGE_M) continue;
    const level = floor - 0.4;
    g.beginPath();
    g.moveTo(x0 * ppm, level * ppm);
    for (let x = x0; x <= x1; x += step) {
      g.lineTo(x * ppm, (level + Math.sin(x * 0.4 + t * 1.6) * 0.18) * ppm);
    }
    g.lineTo(x1 * ppm, (level + 14) * ppm);
    g.lineTo(x0 * ppm, (level + 14) * ppm);
    g.closePath();
    g.fillStyle = pal.water.fill;
    g.fill();
    g.strokeStyle = pal.water.shine;
    g.lineWidth = Math.max(1, 0.26 * ppm);
    g.beginPath();
    for (let x = x0; x <= x1; x += step) {
      const y = (level + 0.9 + Math.sin(x * 0.7 - t * 2.1) * 0.22) * ppm;
      if (x === x0) g.moveTo(x * ppm, y); else g.lineTo(x * ppm, y);
    }
    g.stroke();
  }
}

/** Lo que sostiene el tablero: terraplén, caballete de madera o puente. */
function paintSupports(g, map, art, pal, ppm, leftM, rightM) {
  const spans = map.structures.filter((s) => s.type === "bridge"
    && s.playX1 > leftM - 80 && s.playX0 < rightM + 80);
  for (const span of spans) paintBridge(g, art, map, span, ppm, "back");

  // El caballete donde el hueco es pequeño y nadie autoró un puente: lo pone la
  // cadena sola, que es como se evita una lista de postes en el registro.
  const trestle = art.bridges.trestle;
  const inSpan = (x) => spans.some((s) => x >= s.playX0 - 2 && x <= s.playX1 + 2);
  const posts = [];
  g.lineCap = "butt";
  for (let x = Math.floor(leftM / trestle.pitchM) * trestle.pitchM; x <= rightM; x += trestle.pitchM) {
    if (inSpan(x)) continue;
    const deck = map.deckY(x);
    const soil = surfaceAt(map, x);
    const gap = soil - deck;
    if (gap < 2.2 || gap > BRIDGE_MIN_M) continue;
    g.fillStyle = trestle.wood;
    g.fillRect((x - trestle.postWM / 2) * ppm, deck * ppm, trestle.postWM * ppm, gap * ppm);
    g.fillStyle = trestle.woodDark;
    g.fillRect((x - trestle.postWM / 2) * ppm, deck * ppm, trestle.postWM * 0.34 * ppm, gap * ppm);
    if (gap > 3) {
      g.strokeStyle = trestle.brace;
      g.lineWidth = Math.max(1, 0.16 * ppm);
      g.beginPath();
      g.moveTo((x - 1.6) * ppm, (deck + gap) * ppm);
      g.lineTo((x + 1.6) * ppm, (deck + gap * 0.35) * ppm);
      g.moveTo((x + 1.6) * ppm, (deck + gap) * ppm);
      g.lineTo((x - 1.6) * ppm, (deck + gap * 0.35) * ppm);
      g.stroke();
    }
    posts.push(x);
  }
  paintBunting(g, art, map, posts, ppm);
}

/** BANDERINES Y BOMBILLOS ENTRE LOS POSTES DEL CABALLETE.
 *
 *  Es el detalle que separa una obra de ingeniería de un lugar donde vive
 *  gente, y no es decoración importada: este corredor pasa por pueblos que
 *  ponen turno, y la ciudad ya tiene el mismo vocabulario en la feria del
 *  malecón. La catenaria es una cuadrática con la flecha del registro, los
 *  banderines cuelgan de ella alternando la paleta y los bombillos van en el
 *  mismo hilo — todo derivado de dónde quedaron los postes, que es lo que lo
 *  deja seguir el terreno sin una sola coordenada escrita a mano. */
function paintBunting(g, art, map, posts, ppm) {
  const T = art.bridges.trestle;
  if (!T.bunting || posts.length < 2) return;
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    if (b - a > T.buntingSpanM * 2.2) continue;
    const ya = map.deckY(a) - T.buntingDropM, yb = map.deckY(b) - T.buntingDropM;
    const sag = (ya + yb) / 2 + T.buntingDepthM;
    const at = (u) => {
      const v = 1 - u;
      return { x: v * v * a + 2 * v * u * ((a + b) / 2) + u * u * b,
        y: v * v * ya + 2 * v * u * sag + u * u * yb };
    };
    g.strokeStyle = T.cord;
    g.lineWidth = Math.max(1, 0.08 * ppm);
    g.beginPath();
    g.moveTo(a * ppm, ya * ppm);
    g.quadraticCurveTo(((a + b) / 2) * ppm, sag * ppm, b * ppm, yb * ppm);
    g.stroke();
    const n = Math.max(2, Math.round((b - a) / T.bulbPitchM));
    for (let k = 0; k <= n; k++) {
      const p = at(k / n);
      g.fillStyle = T.bunting[(i * 3 + k) % T.bunting.length];
      g.beginPath();
      g.moveTo((p.x - 0.34) * ppm, p.y * ppm);
      g.lineTo((p.x + 0.34) * ppm, p.y * ppm);
      g.lineTo(p.x * ppm, (p.y + 0.9) * ppm);
      g.closePath();
      g.fill();
      g.fillStyle = T.bulbs[(i * 2 + k) % T.bulbs.length];
      g.beginPath();
      g.arc(p.x * ppm, (p.y + 1.1) * ppm, T.bulbM * ppm, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** UN PUENTE SE CUENTA SOBRE SU VANO. La celosía, el arco, las pilas y los
 *  tirantes salen del largo del tramo, así que el del Torres (160 m) y el del
 *  Río Grande comparten receta sin compartir una medida escrita a mano.
 *
 *  `pass` es `"back"` (todo lo que va detrás del convoy) o `"front"` (sólo la
 *  mitad cercana de una celosía PASANTE). Un puente `below` no tiene pasada
 *  delantera: el tren va encima. */
function paintBridge(g, art, map, span, ppm, pass) {
  const rec = art.bridges[span.style] || art.bridges.girder;
  const through = rec.side === "through";
  if (pass === "front" && !through) return;
  const x0 = span.playX0, x1 = span.playX1;
  const y0 = map.deckY(x0), y1 = map.deckY(x1);
  const deckAt = (x) => y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1));
  const panels = Math.max(2, Math.round((x1 - x0) / rec.panelM));
  const step = (x1 - x0) / panels;

  if (pass === "back") {
    paintPiers(g, map, rec, x0, x1, deckAt, ppm);
    if (rec.arch) paintArchRib(g, map, rec, x0, x1, deckAt, ppm);
  }
  if (through) {
    const near = pass === "front";
    const top = (x) => deckAt(x) - rec.depthM;
    webPass(g, rec, x0, x1, step, panels, deckAt, top, ppm,
      near ? rec.nearWeb : rec.farWeb, near ? 0.16 : 0.2);
    g.strokeStyle = near ? rec.near : rec.far;
    g.lineWidth = Math.max(1.5, (near ? 0.4 : 0.3) * ppm);
    g.beginPath();
    g.moveTo(x0 * ppm, top(x0) * ppm); g.lineTo(x1 * ppm, top(x1) * ppm);
    g.moveTo(x0 * ppm, (deckAt(x0) + 0.2) * ppm); g.lineTo(x1 * ppm, (deckAt(x1) + 0.2) * ppm);
    g.stroke();
    if (!near) {
      // Pórtico: los dos marcos de los extremos, que es lo que cierra el cajón.
      g.strokeStyle = rec.topChord;
      g.lineWidth = Math.max(1, rec.portalM * 0.3 * ppm);
      g.beginPath();
      for (const x of [x0, x1]) { g.moveTo(x * ppm, deckAt(x) * ppm); g.lineTo(x * ppm, top(x) * ppm); }
      g.stroke();
    }
    return;
  }
  // VIGA Y ARCO: todo cuelga del tablero.
  const lower = (x) => deckAt(x) + rec.depthM;
  webPass(g, rec, x0, x1, step, panels, deckAt, lower, ppm, rec.web, 0.2);
  g.strokeStyle = rec.chord;
  g.lineWidth = Math.max(1.5, 0.34 * ppm);
  g.beginPath();
  g.moveTo(x0 * ppm, lower(x0) * ppm); g.lineTo(x1 * ppm, lower(x1) * ppm);
  g.stroke();
  g.strokeStyle = rec.chordLite;
  g.lineWidth = Math.max(1, 0.22 * ppm);
  g.beginPath();
  g.moveTo(x0 * ppm, (deckAt(x0) + 0.1) * ppm); g.lineTo(x1 * ppm, (deckAt(x1) + 0.1) * ppm);
  g.stroke();
}

/** Montantes y diagonales en zigzag entre dos cordones. */
function webPass(g, rec, x0, x1, step, panels, a, b, ppm, ink, width) {
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1, width * ppm);
  g.beginPath();
  for (let i = 0; i <= panels; i++) {
    const x = x0 + step * i;
    g.moveTo(x * ppm, a(x) * ppm);
    g.lineTo(x * ppm, b(x) * ppm);
  }
  for (let i = 0; i < panels; i++) {
    const p = x0 + step * i, q = p + step;
    const up = i % 2 === 0;
    g.moveTo(p * ppm, (up ? a(p) : b(p)) * ppm);
    g.lineTo(q * ppm, (up ? b(q) : a(q)) * ppm);
  }
  g.stroke();
}

/** EL ARCO DEL RÍO GRANDE: una parábola entre estribos, con montantes de tímpano
 *  hasta el tablero. Es lo que distingue ese puente de todos los demás del
 *  corredor y lo que la postal de 1910 enseña. */
function paintArchRib(g, map, rec, x0, x1, deckAt, ppm) {
  const span = x1 - x0;
  const rise = span * rec.riseK;
  // LA CLAVE DEL ARCO VA ARRIBA, JUNTO AL TABLERO, y los arranques bajan a los
  // estribos: `y` crece hacia abajo, así que la parábola SUMA con el cuadrado
  // de la distancia al centro. Al revés —como salió primero— el arco se abomba
  // por encima de la vía y el puente se lee como una viga cualquiera, que es
  // exactamente lo que la hoja de arte enseñó.
  const curve = (x) => {
    const u = (x - x0) / span * 2 - 1;        // -1 .. 1
    return deckAt(x) + rec.depthM + rise * u * u;
  };
  g.strokeStyle = rec.arch;
  g.lineWidth = Math.max(2, 0.6 * ppm);
  g.lineJoin = "round";
  g.beginPath();
  for (let i = 0; i <= 48; i++) {
    const x = x0 + (span * i) / 48;
    if (i === 0) g.moveTo(x * ppm, curve(x) * ppm); else g.lineTo(x * ppm, curve(x) * ppm);
  }
  g.stroke();
  g.strokeStyle = rec.archLite;
  g.lineWidth = Math.max(1, 0.2 * ppm);
  g.stroke();
  // Montantes de tímpano: del arco al tablero, y nunca por encima de él.
  g.strokeStyle = rec.web;
  g.lineWidth = Math.max(1, 0.2 * ppm);
  g.beginPath();
  const columns = Math.max(4, Math.round(span / rec.panelM));
  for (let i = 1; i < columns; i++) {
    const x = x0 + (span * i) / columns;
    const top = deckAt(x) + rec.depthM, bottom = curve(x);
    if (bottom <= top) continue;
    g.moveTo(x * ppm, top * ppm);
    g.lineTo(x * ppm, bottom * ppm);
  }
  g.stroke();
  g.lineJoin = "miter";
}

/** Las pilas, hasta el terreno. Un arco se apoya en estribos anchos en las dos
 *  orillas en vez de en pilas repartidas, y por eso `pierPitchM` puede ser
 *  enorme: la receta lo dice, no una rama. */
function paintPiers(g, map, rec, x0, x1, deckAt, ppm) {
  const piers = Math.max(1, Math.round((x1 - x0) / rec.pierPitchM));
  const places = [];
  for (let i = 1; i < piers; i++) places.push(x0 + ((x1 - x0) * i) / piers);
  if (rec.abutM) places.push(x0 - rec.abutM * 0.4, x1 + rec.abutM * 0.4);
  for (const x of places) {
    const top = deckAt(x) + (rec.depthM || 0) * 0.1;
    const foot = surfaceAt(map, x);
    if (foot <= top) continue;
    const wM = rec.abutM && (x < x0 || x > x1) ? rec.abutM : rec.pierWM;
    g.fillStyle = rec.pier;
    g.fillRect((x - wM / 2) * ppm, top * ppm, wM * ppm, (foot - top) * ppm);
    g.fillStyle = rec.pierDark;
    g.fillRect((x - wM / 2) * ppm, top * ppm, wM * 0.3 * ppm, (foot - top) * ppm);
    g.fillStyle = rec.pier;
    g.fillRect((x - wM * 0.85) * ppm, (foot - 0.6) * ppm, wM * 1.7 * ppm, 0.9 * ppm);
  }
}

function paintLoopFrames(g, art, map, track, ppm, leftM, rightM) {
  const F = art.loopFrame;
  for (const loop of track.loops) {
    if (loop.centerX < leftM - 60 || loop.centerX > rightM + 60) continue;
    const r = loop.radiusM;
    const foot = surfaceAt(map, loop.centerX);
    const cx = loop.centerX * ppm, cy = loop.centerY * ppm, base = foot * ppm;
    g.strokeStyle = F.tie;
    g.lineWidth = Math.max(1, F.tieWK * r * ppm);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx - r * F.spreadK * ppm, base);
    g.moveTo(cx, cy);
    g.lineTo(cx + r * F.spreadK * ppm, base);
    g.moveTo(cx - r * 0.55 * ppm, cy + r * 0.62 * ppm);
    g.lineTo(cx + r * 0.55 * ppm, cy + r * 0.62 * ppm);
    g.stroke();
    const mw = F.mastWK * r * ppm;
    g.fillStyle = F.mast;
    g.fillRect(cx - mw / 2, cy, mw, base - cy);
    g.fillStyle = F.mastLite;
    g.fillRect(cx - mw / 2, cy, mw * 0.32, base - cy);
    g.fillStyle = F.footing;
    for (const dx of [-r * F.spreadK, 0, r * F.spreadK]) {
      g.fillRect(cx + dx * ppm - F.footWK * r * ppm / 2, base - 1,
        F.footWK * r * ppm, F.footHK * r * ppm);
    }
  }
}

function paintTrackwork(g, art, map, track, ppm, leftM, rightM) {
  const T = art.track;
  const pts = track.points;
  const visible = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < leftM - 20 || p.x > rightM + 20) continue;
    visible.push(p);
  }
  if (visible.length < 2) return;

  // El balasto sólo donde la vía va sobre tierra: en un rizo y en un puente lo
  // que hay es acero y madera.
  g.beginPath();
  let open = false;
  for (const p of visible) {
    const soil = surfaceAt(map, p.x);
    const onGround = !loopAt(track, p.s) && soil - p.y < 1.2;
    if (!onGround) { open = false; continue; }
    if (!open) { g.moveTo((p.x - T.ballastFlareM) * ppm, (p.y + T.ballastDepthM) * ppm); open = true; }
    g.lineTo(p.x * ppm, (p.y + 0.05) * ppm);
  }
  g.fillStyle = T.ballast;
  g.fill();

  // Durmientes: una barra corta perpendicular a la vía, por el lado de arriba.
  let next = 0;
  g.lineCap = "butt";
  for (const p of visible) {
    if (p.s < next) continue;
    next = p.s + T.sleeperPitchM;
    g.save();
    g.translate(p.x * ppm, p.y * ppm);
    g.rotate(p.angle);
    g.fillStyle = (Math.round(p.s / T.sleeperPitchM) % 2) ? T.sleeper : T.sleeperAlt;
    g.fillRect(-T.sleeperWM / 2 * ppm, 0, T.sleeperWM * ppm, T.sleeperHM * ppm);
    g.restore();
  }

  // El carril, de una pasada: un camino continuo es lo único que no deja
  // escalones de antialias en una curva cerrada como el rizo.
  const run = (offset, color, width) => {
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, width * ppm);
    g.lineJoin = "round";
    g.beginPath();
    visible.forEach((p, i) => {
      const { nx, ny } = normalOf(p.angle);
      const x = (p.x + nx * offset) * ppm, y = (p.y + ny * offset) * ppm;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();
  };
  run(0, T.railShade, T.railM);
  run(T.railM * 0.3, T.rail, T.railM * 0.7);
  run(T.railM * 0.55, T.railHead, T.railHeadM);
  g.lineJoin = "miter";
}

function paintStation(g, art, map, station, ppm, which, view) {
  const rec = art.structures[`station-${station.style}`];
  if (!rec?.[which]) return;
  const y = map.deckY(station.playX);
  paintRecord(g, rec, rec[which], station.playX * ppm, y * ppm, ppm, {
    vars: { name: view.stationName?.(station) ?? "" },
  });
}

/** La siembra del paisaje: la retícula global recorrida SÓLO sobre la vista, el
 *  patrón que `paintWoods` dejó probado en la ciudad. Un cafetal de nueve
 *  kilómetros cuesta lo mismo que uno de cien metros. */
function paintScatter(g, art, map, pal, blend, ppm, leftM, rightM) {
  const scene = art.scenes[blend.a];
  const sow = (spec, alpha) => {
    const rec = art.props[spec.art];
    if (!rec) return;
    g.globalAlpha = alpha;
    const from = Math.floor(leftM / spec.pitchM) * spec.pitchM;
    for (let x = from; x <= rightM + spec.pitchM; x += spec.pitchM) {
      const h1 = hash01(Math.round(x / spec.pitchM) * 12.9898 + spec.seed);
      const h2 = hash01(Math.round(x / spec.pitchM) * 78.233 + spec.seed);
      const at = x + (h1 - 0.5) * spec.pitchM * 0.8;
      const deck = map.deckY(at);
      const soil = surfaceAt(map, at);
      // Nada crece sobre el tablero ni colgando de un puente.
      if (soil - deck > 2.2) continue;
      const off = (spec.offMin || 0) + h2 * (spec.offRange || 0);
      const scale = (spec.scaleMin ?? 1) + h1 * (spec.scaleRange ?? 0);
      paintProp(g, rec, (at + off) * ppm, surfaceAt(map, at + off) * ppm, ppm, scale,
        { pick: Math.round(h2 * 97) });
    }
    g.globalAlpha = 1;
  };
  for (const spec of scene.scatter || []) sow(spec, 1 - blend.blend * 0.85);
  if (blend.b && blend.blend > 0.15) {
    for (const spec of art.scenes[blend.b].scatter || []) sow(spec, blend.blend);
  }
}

function paintPickups(g, art, track, run, ppm, leftM, rightM, t) {
  const coin = art.props.ficha, drum = art.props.bidon;
  const lift = run.sim.coins.heightM;
  for (const c of run.coinPickups) {
    if (c.taken) continue;
    const p = atDistance(track, c.s);
    if (p.x < leftM - 10 || p.x > rightM + 10) continue;
    const { nx, ny } = normalOf(p.angle);
    const bob = Math.sin(t * 2.2 + c.s * 0.1) * 0.22;
    paintProp(g, coin, (p.x + nx * (lift + bob)) * ppm, (p.y + ny * (lift + bob)) * ppm, ppm);
  }
  for (const d of run.fuelPickups) {
    if (d.taken) continue;
    const p = atDistance(track, d.s);
    if (p.x < leftM - 10 || p.x > rightM + 10) continue;
    const { nx, ny } = normalOf(p.angle);
    g.save();
    g.translate((p.x + nx * 0.2) * ppm, (p.y + ny * 0.2) * ppm);
    g.rotate(p.angle);
    paintRecord(g, drum, drum.parts, 2.4 * ppm, 0, ppm);
    g.restore();
  }
}

function paintConsist(g, view) {
  const { track, run, consist, ppm, t } = view;
  const rollRad = run.distance / Math.max(0.2, consist[0].record.wheels?.[0]?.r || 0.8);
  for (let i = consist.length - 1; i >= 0; i--) {
    const car = consist[i];
    const point = atDistance(track, run.distance - car.offsetM);
    // `t` VIAJA HASTA EL COCHE porque los pasajeros se mecen: los verbos de
    // movimiento del intérprete leen `frame.t` y sin él la fila de gente sale
    // perfectamente quieta — que se ve igual que si no estuviera implementada.
    paintCar(g, car.record, { x: point.x * ppm, y: point.y * ppm, angle: point.angle }, ppm, {
      rollRad, t,
    });
  }
}

/** LA CHIMENEA ES LA ÚNICA TELEMETRÍA HONESTA DEL ESFUERZO. Un tren parado humea
 *  poco y uno cuesta arriba a todo gas humea mucho, así que el penacho dice lo
 *  que la aguja no: cuánto está trabajando el motor y cuánto combustible se
 *  está yendo en ello. */
export function updateSmoke(state, run, dt, point, stack, ppm) {
  const S = run.sim.smoke;
  const load = Math.max(0, Math.min(1, run.drive / Math.max(0.5, run.stats.pullMax)));
  state.acc = (state.acc || 0) + dt * (S.idleRate + (S.fullRate - S.idleRate) * load);
  while (state.acc >= 1 && state.puffs.length < S.max) {
    state.acc -= 1;
    const cos = Math.cos(point.angle), sin = Math.sin(point.angle);
    const sx = stack.x, sy = stack.y;
    state.puffs.push({
      x: (point.x + sx * cos - sy * sin) * ppm,
      y: (point.y + sx * sin + sy * cos) * ppm,
      vx: (run.speed * 0.25 + S.driftMPerS) * ppm,
      vy: -S.riseMPerS * ppm,
      life: 0,
      seed: Math.random(),
    });
  }
  for (const p of state.puffs) {
    p.life += dt / S.lifeS;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy *= 1 - dt * 0.9;
    p.vx *= 1 - dt * 1.4;
  }
  state.puffs = state.puffs.filter((p) => p.life < 1);
}

function paintSmoke(g, view) {
  const { smoke, run, ppm } = view;
  if (!smoke?.puffs?.length) return;
  const S = run.sim.smoke;
  for (const p of smoke.puffs) {
    const k = p.life;
    const r = (S.r0M + (S.r1M - S.r0M) * k) * ppm;
    g.fillStyle = alphaColor(S.rgb, S.alpha * (1 - k) * 0.9);
    g.beginPath();
    g.arc(p.x, p.y, r, 0, TAU);
    g.arc(p.x + r * 0.5, p.y - r * 0.3, r * 0.68, 0, TAU);
    g.fill();
  }
}
