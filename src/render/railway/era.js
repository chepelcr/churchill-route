// LA ÉPOCA: UN BAÑO SOBRE EL CUADRO TERMINADO.
//
// La campaña va de 1898 a hoy, y un tramo de vapor no se puede ver igual que
// uno del 200-3122. La respuesta barata y equivocada sería autorar dos paletas
// por escena —dieciocho juegos de colores que hay que mantener en paralelo y
// que se despegan el día que alguien retiñe una sola—. La respuesta es la del
// cine: el cuadro se pinta UNA vez con sus colores de verdad y la época es un
// BAÑO encima.
//
// Son cuatro rellenos a pantalla completa y ningún lienzo auxiliar, que es lo
// que lo hace barato:
//
//   1. `saturation` contra un gris le quita el color al cuadro, en la medida
//      que el registro pida;
//   2. `multiply` con el tono cálido lo tiñe;
//   3. `overlay` con el color del papel levanta las luces, que es lo que
//      distingue una foto vieja de una foto gris;
//   4. una viñeta radial, en `source-over`, cierra los bordes.
//
// `moderno` no tiene baño y por eso NO cuesta nada: una época sin `wash` sale
// del paso en la primera línea, y el cuadro queda exactamente como se pintó.
// Eso es lo que hace esta migración demostrable tramo por tramo.
//
// Ojo con el orden: la viñeta va DESPUÉS del tinte y en `source-over`. Metida
// antes, el `multiply` la vuelve a multiplicar y los bordes se van a negro.

/** Pinta el baño de época sobre el cuadro. `g` ya está sin transformar. */
export function paintEra(g, era, w, h) {
  if (!era || !era.wash) return false;
  g.save();
  if (era.desaturate) {
    g.globalCompositeOperation = "saturation";
    g.globalAlpha = era.desaturate;
    g.fillStyle = era.grey;
    g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = "multiply";
  g.globalAlpha = era.washAlpha ?? 1;
  g.fillStyle = era.wash;
  g.fillRect(0, 0, w, h);
  if (era.paper) {
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = era.paperAlpha ?? 0.3;
    g.fillStyle = era.paper;
    g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = "source-over";
  if (era.vignette) {
    g.globalAlpha = era.vignette;
    const r = Math.hypot(w, h) / 2;
    const vig = g.createRadialGradient(w / 2, h / 2, r * (era.vignetteInner ?? 0.45), w / 2, h / 2, r);
    vig.addColorStop(0, era.vignetteClear);
    vig.addColorStop(1, era.vignetteEdge);
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);
  }
  g.restore();
  return true;
}

/** La época de un nivel, o la moderna. Un id que el registro no tiene es un
 *  error del nivel y se dice: una época muda se vería como que el filtro no
 *  está implementado. */
export function eraOf(art, level) {
  const id = level?.era || "moderno";
  const era = art.eras?.[id];
  if (!era) throw new Error(`unknown railway era "${id}"`);
  return era;
}
