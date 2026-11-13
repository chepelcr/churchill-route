// LA PUNTA — El Faro y el Balneario, como el lugar que son.
//
// Hasta ahora la cuadra entera del Balneario era una ensenada de mar. El mundo
// trae ahora las figuras de verdad (`manifest.punta`, autoradas en
// content/world/punta.json): el terreno, el deck, la piscina en forma de coma
// con sus tres zonas y la piscina redonda.
//
// EL MALECÓN NO SE PINTA ACÁ, Y ES A PROPÓSITO: es la plazoleta del Faro de
// siempre, piedra gris y mosaico, y la sigue pintando `malecon.js` desde
// `manifest.malecon`. Lo único que este archivo le pone encima son sus
// figuras — abanicos al norte del Faro, olas al sur — en un rojo apagado, el
// de las comas de antes pasado por gris. Un solo piso, con el dibujo nuevo.
//
// El mundo dice DÓNDE; `materials.json → punta` dice de qué está hecho. Los
// verbos de acá son tres y son geometría: `sector` (el abanico), `outline`
// (la ola, desde su contorno unitario) y la escollera sembrada por hash.
// Edificios, toldos, palmas y árboles NO se pintan acá: van en los tiles como
// todos los demás, y los dibuja quien ya los dibuja.
//
// Se pinta después del malecón y ANTES de las calles, así que la banda de
// acera y el asfalto siguen tapando lo que llegue al cordón.
import { WORLD2D as W } from "../../world2d/index.js";
import { aabbInView, blendPalette, ctx, flatAABB, flatPath, hash01, weatherColors } from "./gfx.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import PROPS from "../../assets/world-props.json" with { type: "json" };

const M = MATERIALS.punta;
const ROCKS = MATERIALS.coast.rocks;
// LA PISCINA SE PINTA COMO LAS DEL PARQUE MARINO: la misma paleta de la escena
// `pool` (deck, brocal, agua, hondo, bajo, brillo), sobre la forma de verdad.
// Se LEE de esa escena; acá no hay copia.
const POOL = PROPS.scenes.pool.palette;
const INK = M.figures.ink;
const RAD = Math.PI / 180;

function shape(s) {
  if (!s._path) { s._path = flatPath(s.pts, true); s._aabb = flatAABB(s.pts); }
  return s._path;
}

function fanPath(f, half) {
  if (f._path) return f._path;
  const p = new Path2D();
  p.moveTo(f.x, f.y);
  p.arc(f.x, f.y, f.r, f.ang - half, f.ang + half);
  p.closePath();
  return (f._path = p);
}

// la ola: su contorno unitario llevado al eje de cada una
function wavePath(w, outline) {
  if (w._path) return w._path;
  const dx = Math.cos(w.ang), dy = Math.sin(w.ang), L = w.len;
  const pts = outline.map(([u, v]) => [
    w.x + dx * (u - 0.5) * L + dy * v * L,
    w.y + dy * (u - 0.5) * L - dx * v * L,
  ]);
  // esquinas redondeadas sin mover las colas: cuadráticas por los puntos medios
  const p = new Path2D(), n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tails = new Set([0, outline.findIndex(([u]) => u === 1)]);
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= n; i++) {
    const c = pts[i % n], nx = pts[(i + 1) % n];
    if (tails.has(i % n)) { p.lineTo(c[0], c[1]); continue; }
    const m = tails.has((i + 1) % n) ? nx : mid(c, nx);
    p.quadraticCurveTo(c[0], c[1], m[0], m[1]);
  }
  p.closePath();
  return (w._path = p);
}

function paintRiprap(line, view) {
  if (!line._rocks) {
    const rocks = [], step = M.riprap.stepM * W.PX_PER_M, [r0, r1] = M.riprap.rockM;
    for (let i = 0; i + 3 < line.pts.length; i += 2) {
      const ax = line.pts[i], ay = line.pts[i + 1], bx = line.pts[i + 2], by = line.pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let s = 0; s < len; s += step) {
        for (let k = 0; k < 3; k++) {
          const h = hash01(ax * 7.13 + ay * 3.71 + s * 1.37 + k * 91.7), h2 = hash01(h * 977 + k);
          const off = (h - 0.5) * line.w;
          rocks.push([ax + (bx - ax) * s / len + nx * off, ay + (by - ay) * s / len + ny * off,
            (r0 + (r1 - r0) * h2) * W.PX_PER_M / 2, ROCKS[(h2 * ROCKS.length) | 0]]);
        }
      }
    }
    line._rocks = rocks; line._path = flatPath(line.pts, false); line._aabb = flatAABB(line.pts);
  }
  ctx.strokeStyle = M.riprap.bed; ctx.lineWidth = line.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke(line._path);
  const x0 = view.x0 - 8, x1 = view.x1 + 8, y0 = view.y0 - 8, y1 = view.y1 + 8;
  for (const [x, y, r, ink] of line._rocks) {
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;       // la línea mide kilómetros: sólo lo que se ve
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPunta(view, t = 0) {
  const P = W.PUNTA;
  if (!P || !aabbInView(P, view, 40)) return;
  const ppm = W.PX_PER_M;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // el verde del Paseo. Se pinta ACÁ y no con los verdes del mundo porque aquéllos van
  // antes que las aguas interiores, y sobre este frente hay agua vieja que lo taparía
  for (const gr of P.greens || []) { ctx.fillStyle = MATERIALS.green[gr.type]; ctx.fill(shape(gr)); }
  // la playa entre lengua y lengua, y la del frente del Paseo: la arena del mundo
  ctx.fillStyle = weatherColors().sand;
  for (const sd of P.sands || []) ctx.fill(shape(sd));
  for (const line of P.riprap || []) paintRiprap(line, view);
  // el suelo, en el orden en que el mundo lo trae: terreno, deck, malecones…
  for (const g of P.grounds || []) {
    ctx.fillStyle = g.use === "deck" ? POOL.deck : (M.ground[g.use] || M.ground.park);
    ctx.fill(shape(g));
    ctx.strokeStyle = M.kerb; ctx.lineWidth = 1.5; ctx.stroke(g._path);
  }
  // los dos pisos: recortados a SU malecón, para que nada se salga a la calle
  const half = M.fan.halfAngleDeg * RAD;
  // el círculo del Faro: relleno, del color de las figuras
  for (const dsc of P.discs || []) {
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(dsc.x, dsc.y, dsc.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = M.fan.edge; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (const f of P.fans || []) {
    ctx.fillStyle = INK; ctx.fill(fanPath(f, half));
    ctx.strokeStyle = M.fan.edge; ctx.lineWidth = 1.2; ctx.stroke(f._path);
    // DOS bancas por abanico, una a cada lado: afuera de cada canto recto,
    // a media vara, y alineada con él
    const [bl, bw] = M.fan.benchM, off = M.fan.benchOffsetM * ppm;
    for (const side of [-1, 1]) {
      const e = f.ang + side * half, ex = Math.cos(e), ey = Math.sin(e);
      const bx = f.x + ex * f.r * M.fan.benchAlong - ey * side * off;
      const by = f.y + ey * f.r * M.fan.benchAlong + ex * side * off;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(e);
      ctx.fillStyle = M.fan.benchShadow; ctx.fillRect(-bl * ppm / 2 + 1, -bw * ppm / 2 + 1.5, bl * ppm, bw * ppm);
      ctx.fillStyle = M.fan.bench; ctx.fillRect(-bl * ppm / 2, -bw * ppm / 2, bl * ppm, bw * ppm);
      ctx.restore();
    }
  }
  for (const w of P.waves || []) {
    ctx.fillStyle = INK; ctx.fill(wavePath(w, M.wave.outline));
    ctx.strokeStyle = M.wave.edge; ctx.lineWidth = 1.2; ctx.stroke(w._path);
  }
  for (const r of P.rotondas || []) {
    ctx.strokeStyle = INK; ctx.lineWidth = M.wave.rotondaWidthM * ppm;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
  }
  // el agua, con el estilo de las piscinas del Parque Marino sobre su forma
  // de verdad: brocal, lámina, la zona honda y la baja, y el brillo que se mueve
  const whole = (P.pools || []).filter((pool) => !pool.zone);
  for (const pool of whole) {
    ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.rimWidthM * ppm * 2; ctx.stroke(shape(pool));
    ctx.fillStyle = POOL.water; ctx.fill(pool._path);
  }
  for (const pool of P.pools || []) if (pool.zone) { ctx.fillStyle = POOL[M.pool.zones[pool.use]]; ctx.fill(shape(pool)); }
  const S = M.pool.shimmer, gap = S.gapM * ppm, amp = S.ampM * ppm;
  ctx.strokeStyle = POOL.shimmer; ctx.lineWidth = S.widthM * ppm;
  for (const pool of whole) {
    const a = pool._aabb;
    ctx.save(); ctx.clip(pool._path);
    for (let y = a.y0 + gap / 2, n = 0; y < a.y1; y += gap, n++) {
      const drift = (t * S.speed * ppm + n * 37) % (S.dashM * ppm * 2);
      ctx.setLineDash([S.dashM * ppm, S.dashM * ppm]); ctx.lineDashOffset = -drift;
      ctx.beginPath();
      for (let x = a.x0; x <= a.x1; x += 6) {
        const yy = y + Math.sin((x + n * 50) * S.freq + t * S.wobble) * amp;
        if (x === a.x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.wallWidthM * ppm;
  for (const wall of P.walls || []) {
    if (!wall._path) wall._path = flatPath(wall.pts, false);
    ctx.stroke(wall._path);
  }
  // la isla y lo que flota: van DESPUÉS del agua
  for (const g of P.islands || []) {
    ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.rimWidthM * ppm * 2; ctx.stroke(shape(g));
    ctx.fillStyle = M.ground.planter; ctx.fill(g._path);
  }
  for (const pr of P.props || []) {
    if (pr.pts) { ctx.fillStyle = pr.kind === "play-structure" ? POOL.slide : M.props.cabana; ctx.fill(shape(pr)); continue; }
    const s = M.props.cabanaM * ppm;
    ctx.fillStyle = M.props.shadow; ctx.fillRect(pr.x - s / 2 + 2, pr.y - s / 2 + 3, s, s);
    ctx.fillStyle = M.props.cabana; ctx.fillRect(pr.x - s / 2, pr.y - s / 2, s, s);
  }
  // la hora: UN velo sobre todo el suelo del lugar, en un solo relleno para
  // que donde dos figuras se montan no oscurezca dos veces
  // (el deck y el parqueo van DENTRO de otra figura: sumarlos abriría un hueco
  // donde el sentido de su contorno es el contrario)
  if (!P._all) {
    P._all = new Path2D();
    for (const g of P.grounds || []) if (g.use !== "deck" && g.use !== "parking") P._all.addPath(shape(g));
  }
  ctx.fillStyle = blendPalette(M.sky, "clear").veil;
  ctx.fill(P._all);
}

export { drawPunta };
