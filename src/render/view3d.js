// LA VISTA 2.5D — qué modo de render se pidió y cómo mira la cámara.
//
// Sin three.js adentro, a propósito: esto lo lee Renderer.js ANTES de decidir
// si descarga Three, y lo lee el panel de Tweaks. El modo 3-D es opt-in
// (`?render=3d` o localStorage `churchill_render = "3d"`); sin eso el juego es
// el Canvas2D publicado, byte por byte.
//
// ## La cámara: un pinhole a plomo + una inclinación oblicua
//
// Dos perillas, y las dos dejan el SUELO exactamente donde Canvas lo pinta:
//
//   * `pinholeM` — la altura de un ojo a plomo sobre el centro de la vista. Un
//     plano paralelo a la película se proyecta afín, así que la calle, el carro
//     y el dedo que maneja no se enteran; lo que tiene altura se abre HACIA
//     AFUERA desde el centro, como la paralaje que `c2d/depth.js` ya dibuja.
//     0 = ortográfica pura.
//   * `leanDeg` — una inclinación OBLICUA: lo alto se corre hacia arriba en la
//     pantalla `h · tan(lean)`. Es una ortográfica inclinada con el suelo
//     devuelto a su sitio (÷cos), así que muestra las fachadas del lado de la
//     cámara sin achatar el suelo — y el volante (`applyTouch` compara un ángulo
//     de pantalla con un rumbo de mundo) sigue siendo exacto por construcción.
import EFFECTS from "../assets/effects.json" with { type: "json" };

const V = EFFECTS.view3d || {};

function query() {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
}
function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** ¿Se pidió el mundo en 3-D? La URL gana sobre lo guardado. */
export function render3dRequested() {
  const q = query().get("render");
  if (q) return q === "3d";
  return stored("churchill_render") === "3d";
}

/** Guarda la preferencia (la aplica la próxima carga: Three se descarga al arrancar). */
export function setRender3d(on) {
  try { localStorage.setItem("churchill_render", on ? "3d" : "2d"); } catch { /* private mode */ }
}

function num(v, fallback) {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? n : fallback;
}

const view = {
  leanDeg: num(query().get("lean") ?? stored("churchill_lean"), V.leanDeg ?? 30),
  pinholeM: num(query().get("pinhole") ?? stored("churchill_pinhole"), V.pinholeM ?? 170),
};

/** Grados de inclinación oblicua (0 = a plomo). */
export function leanDeg() { return view.leanDeg; }
/** Altura del ojo en metros (0 = ortográfica). */
export function pinholeM() { return view.pinholeM; }

export function setLeanDeg(deg) {
  view.leanDeg = Math.max(0, Math.min(V.maxLeanDeg ?? 45, num(deg, 0)));
  try { localStorage.setItem("churchill_lean", String(view.leanDeg)); } catch { /* */ }
  return view.leanDeg;
}
export function setPinholeM(m) {
  view.pinholeM = Math.max(0, num(m, 0));
  try { localStorage.setItem("churchill_pinhole", String(view.pinholeM)); } catch { /* */ }
  return view.pinholeM;
}

/**
 * LA CALIDAD — cuánto cuesta un cuadro. `high` en escritorio, `low` en un
 * teléfono (o `?q=low`): sin MSAA, sombra más chica y dura, pixel ratio 1.
 * Lo que se ve es lo mismo; lo que cambia es el borde de la sombra.
 */
export function quality() {
  const q = query().get("q") || stored("churchill_q");
  if (q === "low" || q === "high") return q;
  let coarse = false;
  try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch { /* */ }
  return coarse ? "low" : "high";
}
