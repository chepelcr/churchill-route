// EL RUIDO Y LAS CURVAS, MEDIDOS — sin navegador.
//
// Estos dos módulos son aritmética pura y son el cimiento de todo lo orgánico:
// si el ruido tiene retícula visible o el redondeo mueve una arista, el error
// no sale como una excepción sino como una TEXTURA rara o una costura, y eso se
// discute en vez de medirse. Aquí se mide.
//
// Corre bajo node a secas porque `curves.js` separa la lista de órdenes del
// `Path2D` justamente para esto: `Path2D` no existe fuera del navegador.
import { noise2, snoise2, fbm } from "../src/render/c2d/noise.js";
import { roundedOutline, subdivide, jitterAlongNormals } from "../src/render/c2d/curves.js";

let bad = 0;
const fail = (m) => { console.log("[curves] FAIL — " + m); bad++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- el ruido --------------------------------------------------------------
let lo = 1, hi = 0, sum = 0, n = 0;
for (let y = 0; y < 400; y += 7) {
  for (let x = 0; x < 400; x += 7) {
    const v = noise2(x, y, 40);
    lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; n++;
  }
}
if (lo < 0 || hi > 1) fail(`noise2 se sale de 0..1 (${lo.toFixed(3)}..${hi.toFixed(3)})`);
if (!near(sum / n, 0.5, 0.06)) fail(`noise2 está sesgado: media ${(sum / n).toFixed(3)}`);
if (hi - lo < 0.5) fail(`noise2 apenas varía (${(hi - lo).toFixed(3)}) — se vería plano`);

// DETERMINISTA: es la razón entera de sembrarlo en `hash01` y no en Math.random.
// Un mundo que se dibuja distinto cada cuadro parpadea.
if (noise2(123.4, 567.8, 40) !== noise2(123.4, 567.8, 40)) fail("noise2 no es determinista");

// CONTINUO: el paso más grande entre muestras vecinas dice si hay retícula. Con
// interpolación lineal en vez de la curva de Perlin salen rombos, y eso se lee
// como una tela y no como una mancha.
let worst = 0;
for (let x = 0; x < 400; x += 0.5) {
  worst = Math.max(worst, Math.abs(noise2(x + 0.5, 77, 40) - noise2(x, 77, 40)));
}
if (worst > 0.06) fail(`noise2 salta ${worst.toFixed(3)} en medio píxel — hay retícula`);

let flo = 1, fhi = -1, fsum = 0, fn = 0;
for (let y = 0; y < 400; y += 7) for (let x = 0; x < 400; x += 7) {
  const v = fbm(x, y, 60, 3); flo = Math.min(flo, v); fhi = Math.max(fhi, v); fsum += v; fn++;
}
if (flo < -1 || fhi > 1) fail(`fbm se sale de -1..1 (${flo.toFixed(3)}..${fhi.toFixed(3)})`);
if (!near(fsum / fn, 0, 0.12)) fail(`fbm está sesgado: media ${(fsum / fn).toFixed(3)}`);

// ---- el redondeo: LAS ARISTAS NO SE MUEVEN ---------------------------------
// Ésta es LA propiedad. Chaikin encoge el polígono entero y por eso abre una
// costura contra la calle de al lado; aquí sólo se recorta el vértice, y el
// resto de cada arista tiene que quedar EXACTAMENTE donde estaba.
const square = [0, 0, 100, 0, 100, 100, 0, 100];
const cmds = roundedOutline(square, 20);
const pts = cmds.filter((c) => c[0] === "L" || c[0] === "M").map((c) => [c[1], c[2]]);
const onSquare = ([x, y]) => (
  (near(x, 0, 1e-9) || near(x, 100, 1e-9) || near(y, 0, 1e-9) || near(y, 100, 1e-9))
  && x >= -1e-9 && x <= 100 + 1e-9 && y >= -1e-9 && y <= 100 + 1e-9);
for (const p of pts) {
  if (!onSquare(p)) fail(`el redondeo movió un punto fuera de la arista: (${p})`);
}
// …y llega hasta 20 px de cada esquina, ni más ni menos
const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
if (!near(xs[0], 0, 1e-9) || !near(xs[xs.length - 1], 100, 1e-9)) {
  fail("el redondeo encogió el contorno");
}
// EL RADIO SE RECORTA A MEDIA ARISTA: sobre un polígono flaco, un radio enorme
// se comería la arista de en medio y el contorno se cruzaría consigo mismo —
// que en un relleno even-odd sale como un agujero, no como un error.
const thin = [0, 0, 10, 0, 10, 100, 0, 100];
for (const c of roundedOutline(thin, 999)) {
  const [x, y] = c[0] === "Q" ? [c[3], c[4]] : [c[1], c[2]];
  if (c[0] === "Z") continue;
  if (x < -1e-9 || x > 10 + 1e-9 || y < -1e-9 || y > 100 + 1e-9) {
    fail(`un radio desmedido se salió del polígono: (${x}, ${y})`);
  }
}
// un radio de cero es la petición de no tocarlo
if (roundedOutline(square, 0).some((c) => c[0] === "Q")) fail("radio 0 igual redondeó");

// ---- subdividir ------------------------------------------------------------
const sub = subdivide(square, 25);
for (let i = 0; i < sub.length; i += 2) {
  const j = (i + 2) % sub.length;
  const len = Math.hypot(sub[j] - sub[i], sub[j + 1] - sub[i + 1]);
  if (len > 25 + 1e-9) fail(`subdivide dejó una arista de ${len.toFixed(1)} px`);
}

// ---- el jitter: LA AMPLITUD LA MANDA EL RÁSTER -----------------------------
// La celda del ráster mide 5 px y *la arena dibujada ES la arena*. Un
// desplazamiento por encima de una celda diría que hay agua donde el
// colisionador dice tierra, y el jugador chocaría con una pared invisible.
const CELL = 5;
const AMP = 4;
const line = subdivide([0, 0, 400, 0, 400, 10, 0, 10], 8);
const wob = jitterAlongNormals(line, AMP, 60, snoise2);
let maxD = 0;
for (let i = 0; i < line.length; i += 2) {
  maxD = Math.max(maxD, Math.hypot(wob[i] - line[i], wob[i + 1] - line[i + 1]));
}
if (maxD > AMP + 1e-9) fail(`el jitter movió ${maxD.toFixed(2)} px con amplitud ${AMP}`);
if (maxD >= CELL) fail(`el jitter llega a ${maxD.toFixed(2)} px y la celda mide ${CELL} — el dibujo mentiría sobre dónde está el agua`);
if (maxD < AMP * 0.3) fail(`el jitter apenas movió ${maxD.toFixed(2)} px — no se notaría`);

if (bad) process.exit(1);
console.log(`[curves] ok — ruido 0..1 media ${(sum / n).toFixed(3)}, salto máx `
  + `${worst.toFixed(4)} en medio px (sin retícula); fbm ${flo.toFixed(2)}..${fhi.toFixed(2)}`);
console.log(`[curves] ok — el redondeo NO mueve una arista (${pts.length} puntos, todos sobre el `
  + `cuadro), el radio se recorta a media arista, y el jitter topa en ${maxD.toFixed(2)} px `
  + `contra una celda de ${CELL}`);
