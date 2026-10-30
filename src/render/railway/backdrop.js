// EL PAISAJE QUE CRUZA EL NIVEL.
//
// No hay un fondo por nivel: hay escenas, y el nivel dice en qué kilómetro
// empieza cada una. De Pacífico a Belén son cinco —la ciudad, la Sabana, Pavas,
// el cañón del Virilla y el cafetal— y se disuelven una en otra sobre
// `scenes.crossfadeM` metros de corredor, de modo que el fondo cambia por
// AVANZAR y no por entrar a otro nivel. Las escenas de los tramos que todavía no
// se juegan (Río Grande, Orotina, Caldera, el estero) viven en el mismo registro
// y son lo que el selector pasa en bucle: el avance de la campaña, visto.
//
// TRES COSAS QUE SE MIDEN EN EL CUADRO Y NO EN METROS, a propósito: el ancho del
// mosaico, el alto de la banda y el horizonte. Una cordillera a doce kilómetros
// no cambia de tamaño porque la cámara se acerque al tren, y atarla a `pxPerM`
// la haría respirar con el zoom del rizo — que es exactamente el error que
// delata un fondo pintado.
//
// Y UNA CAPA ES UN MOSAICO QUE EMPALMA CONSIGO MISMO: `pts` empieza y termina en
// `y: 1`, así que la silueta se cierra contra el pie de su banda y dos copias
// seguidas no dejan costura. El relleno es UN SOLO camino —todas las copias
// visibles más el cuerpo bajo la banda— y un solo `fill`: pintar copia por copia
// deja una línea de antialias por junta, que a plena luz se ve como un alambre.
import { hash01 } from "../c2d/primitives.js";

const TAU = Math.PI * 2;

/** La escena activa y la siguiente, con cuánto se han mezclado.
 *
 *  El corte vive en el nivel (`scenes[].km`) y el ancho de la disolvencia en el
 *  registro de simulación, así que un tramo con escenas más cerca una de otra no
 *  hereda la disolvencia del nivel 1. */
export function sceneBlend(map, playX, crossfadeM) {
  const cuts = map.sceneCuts;
  if (!cuts.length) return { a: map.level.scene, b: null, blend: 0 };
  let i = 0;
  while (i + 1 < cuts.length && playX >= cuts[i + 1].playX) i++;
  const current = cuts[i];
  const next = cuts[i + 1];
  if (!next) return { a: current.id, b: null, blend: 0 };
  const fade = crossfadeM / map.compression;
  const start = next.playX - fade;
  if (playX <= start) return { a: current.id, b: null, blend: 0 };
  return { a: current.id, b: next.id, blend: Math.min(1, (playX - start) / fade) };
}

/** Dibuja el cielo y las capas de una escena, mezclando dos si hace falta. */
export function paintBackdrop(g, art, w, h, state) {
  const { a, b, blend = 0, camX = 0, camY = 0, t = 0 } = state;
  paintScene(g, art, art.scenes[a], w, h, camX, camY, t);
  if (b && blend > 0) {
    g.save();
    g.globalAlpha = blend;
    paintScene(g, art, art.scenes[b], w, h, camX, camY, t);
    g.restore();
  }
}

function paintScene(g, art, scene, w, h, camX, camY, t) {
  if (!scene) return;
  const sky = g.createLinearGradient(0, 0, 0, h);
  for (const [stop, color] of scene.sky.stops) sky.addColorStop(stop, color);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  if (scene.sun) paintSun(g, scene.sun, w, h);
  if (scene.clouds) paintClouds(g, scene.clouds, w, h, camX, t);
  for (const layer of scene.layers) paintLayer(g, layer, w, h, camX, camY);
}

function paintSun(g, sun, w, h) {
  const x = sun.x * w, y = sun.y * h, r = sun.r * Math.min(w, h);
  const k = sun.glowK ?? 4.2;
  const glow = g.createRadialGradient(x, y, r * 0.5, x, y, r * k);
  glow.addColorStop(0, sun.glow);
  glow.addColorStop(1, sun.fade);
  g.fillStyle = glow;
  g.beginPath(); g.arc(x, y, r * k, 0, TAU); g.fill();
  g.fillStyle = sun.core;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

/** Las nubes DERIVAN ENTERAS: el desplazamiento va a la retícula y no a cada
 *  disco. Moverlos sueltos deshace la nube — la misma lección que dejó escrita
 *  la sombra de nube de la ciudad. */
function paintClouds(g, spec, w, h, camX, t) {
  const span = w * 2.6;
  const drift = (camX * spec.parallax + t * 7) % span;
  const [y0, y1] = spec.yBand;
  g.fillStyle = spec.fill;
  for (let i = 0; i < spec.n; i++) {
    const h1 = hash01(i * 12.9898 + spec.seed);
    const h2 = hash01(i * 78.233 + spec.seed);
    const h3 = hash01(i * 37.719 + spec.seed);
    let x = h1 * span - drift;
    x = ((x % span) + span) % span - span * 0.25;
    const y = (y0 + h2 * (y1 - y0)) * h;
    const r = (0.018 + h3 * 0.022) * w * spec.scale;
    g.beginPath();
    g.ellipse(x, y, r * 2.1, r * 0.72, 0, 0, TAU);
    g.ellipse(x - r * 0.8, y + r * 0.16, r * 0.78, r * 0.56, 0, 0, TAU);
    g.ellipse(x + r * 0.5, y - r * 0.24, r * 0.95, r * 0.7, 0, 0, TAU);
    g.fill();
  }
}

/** La altura normalizada de la silueta en `u` ∈ [0,1] del mosaico. */
function ridgeY(pts, u) {
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= u) {
      const span = pts[i][0] - pts[i - 1][0] || 1;
      const k = (u - pts[i - 1][0]) / span;
      return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k;
    }
  }
  return pts.at(-1)[1];
}

function paintLayer(g, layer, w, h, camX, camY) {
  const tile = Math.max(32, layer.tileW * w);
  const band = layer.bandH * h;
  // Acotado a una fracción del cuadro: ni el nivel más empinado puede sacar
  // una capa de la vista, que es cuando su relleno se come el cielo.
  const lift = Math.max(-h * 0.1, Math.min(h * 0.1, camY * (layer.yParallax || 0)));
  const bottom = layer.horizon * h - lift;
  const top = bottom - band;
  const shift = ((-camX * layer.parallax) % tile + tile) % tile;
  const first = shift - tile;
  const copies = Math.ceil((w - first) / tile) + 1;

  g.beginPath();
  for (let c = 0; c < copies; c++) {
    const x0 = first + c * tile;
    for (let i = 0; i < layer.pts.length; i++) {
      const [u, v] = layer.pts[i];
      const px = x0 + u * tile, py = top + v * band;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.lineTo(x0 + tile, h);
    g.lineTo(x0, h);
    g.closePath();
  }
  g.fillStyle = layer.fill;
  g.fill();

  if (layer.crest) {
    g.strokeStyle = layer.crest;
    g.lineWidth = Math.max(1, band * 0.035);
    g.beginPath();
    for (let c = 0; c < copies; c++) {
      const x0 = first + c * tile;
      layer.pts.forEach(([u, v], i) => {
        const px = x0 + u * tile, py = top + v * band;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
    }
    g.stroke();
  }

  // LAS VENTANAS ENCENDIDAS DE LA CIUDAD. Van después del relleno y dentro de la
  // silueta: se consulta la altura del perfil en cada columna, que es más barato
  // y más exacto que recortar con el camino.
  const win = layer.windows;
  if (!win) return;
  g.fillStyle = win.fill;
  const step = win.pitch * tile;
  const size = Math.max(1.5, step * 0.34);
  for (let c = 0; c < copies; c++) {
    const x0 = first + c * tile;
    for (let u = win.pitch * 0.5; u < 1; u += win.pitch) {
      const px = x0 + u * tile;
      if (px < -size || px > w + size) continue;
      const roof = top + ridgeY(layer.pts, u) * band;
      for (let row = 0; row < win.rows; row++) {
        const py = roof + size * 1.2 + row * step * 1.5;
        if (py > bottom - size) break;
        if (hash01(Math.round(px * 0.37) + row * 91.7) < 0.42) continue;
        g.fillRect(px - size / 2, py, size, size * 1.25);
      }
    }
  }
}
