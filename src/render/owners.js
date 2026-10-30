// QUIÉN DIBUJA QUÉ — un solo dueño por CLASE de cosa.
//
// La migración a 3-D es progresiva: una clase (los edificios, la flora, los
// postes…) pasa de Canvas a Three de a una, y el modo de fallar de eso es
// conocido — DOS capas dibujando lo mismo, o NINGUNA. Un pintor de Canvas nunca
// pregunta «¿está el 3-D encendido?»; pregunta `owns("buildings")`.
//
// Hasta que la capa Three avisa que está lista (`claimForThree`), Canvas es
// dueño de todo: si WebGL falla o Three no se descargó, el juego es el de
// siempre. `?own=buildings:canvas,flora:canvas` devuelve clases a Canvas para
// biseccionar una regresión sin apagar el resto.

export const CANVAS = "canvas";
export const THREE = "three";

const owners = new Map();

function overrides() {
  const out = new Map();
  try {
    const raw = new URLSearchParams(window.location.search).get("own") || "";
    for (const pair of raw.split(",")) {
      const [cls, who] = pair.split(":");
      if (cls && (who === CANVAS || who === THREE)) out.set(cls.trim(), who);
    }
  } catch { /* SSR */ }
  return out;
}

/** La capa Three toma estas clases (salvo las que la URL devuelve a Canvas). */
export function claimForThree(classes) {
  const ov = overrides();
  for (const cls of classes) owners.set(cls, ov.get(cls) || THREE);
}

/** Todo vuelve a Canvas (WebGL perdido, o el modo 3-D apagado). */
export function releaseAll() { owners.clear(); }

/** ¿Pinta Canvas esta clase? */
export function canvasOwns(cls) { return (owners.get(cls) || CANVAS) === CANVAS; }

/** ¿Pinta Three esta clase? */
export function threeOwns(cls) { return owners.get(cls) === THREE; }
