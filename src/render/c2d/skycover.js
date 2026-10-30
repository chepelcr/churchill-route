// EL MUNDO BAJO UN CIELO — la sombra de las nubes cruzando el puerto.
//
// El cielo de este juego lleva tiempo siendo un continuo: la paleta se mezcla
// entre dos fases, el sol barre, la tormenta llega en tres actos. Lo que no
// tenía era CONSECUENCIA sobre el suelo. Una nube que pasa y apaga media
// manzana durante cinco segundos es lo que convierte un cielo en tiempo.
//
// ## NO ES UNA CAPA A PANTALLA COMPLETA, Y ESO ESTÁ MEDIDO
//
// El plan pedía una capa en `multiply` a media resolución con ruido fbm. Sería
// lo obvio y es lo caro: el grano del suelo ya dejó el número escrito — **un
// relleno del tamaño del viewport cuesta ~10 ns por píxel**, o sea ~9 ms de un
// cuadro de 16,7, y ninguna perilla lo arregla.
//
// Y no hace falta, porque una sombra de nube **es** unos cuantos discos suaves.
// Se siembran con el mismo verbo que las manchas del suelo (`paintBlobs`), sobre
// la misma retícula global, con el mismo sprite pre-renderizado que se blitea.
// Son ~10 dibujos por cuadro en vez de un millón de píxeles.
//
// ## TRES COSAS QUE TIENEN QUE SER CIERTAS O SE LEE COMO UN ERROR
//
//   * **la nube DERIVA ENTERA.** Por eso el desplazamiento se aplica a la
//     RETÍCULA y no a cada disco: mover los discos sueltos las deshace, y lo que
//     se ve es un hervidero, no un cielo;
//   * **de noche no hay sombra de nube**, porque no hay sol que la proyecte. La
//     luz del día sale de `skyBlend()`, que es el dueño de «qué tan de noche
//     es» — preguntarlo con un `state.weather === "night"` sería el segundo
//     umbral para una sola pregunta, que es el error que la noche ya tuvo una
//     vez con las lámparas;
//   * **la tormenta CIERRA el cielo, no lo llena de nubes sueltas.** Con el
//     cielo tapado no hay sombras marcadas: hay penumbra pareja, y de eso ya se
//     encarga la paleta. Así que la cobertura sube con `stormLevel()` mientras
//     la tormenta se arma y vuelve a bajar cuando se cierra del todo.
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { skyBlend, stormLevel } from "../../game/daynight.js";
import { paintBlobs } from "./materials.js";

const SKY = EFFECTS.skyCover || {};

//: Cuánta luz de sol hay para proyectar una sombra, 0..1. Sale del mismo
//: continuo del que sale la paleta, así que la nube se apaga al anochecer al
//: mismo ritmo con el que el suelo se pone azul.
function daylight() {
  const { from, to, k } = skyBlend();
  const w = (phase) => (SKY.phaseLight && SKY.phaseLight[phase] != null
    ? SKY.phaseLight[phase]
    : 1);
  const a = w(from);
  return a + (w(to) - a) * (k > 0 ? k : 0);
}

/**
 * La sombra de las nubes sobre el rectángulo visible.
 *
 * Va al final del pase del mundo: una nube tapa el suelo, los techos y los
 * árboles por igual, que es lo que la hace leerse como algo que está ENTRE el
 * sol y el pueblo. No alcanza al carro ni al HUD a propósito — el jugador tiene
 * que poder verse siempre.
 *
 * Sin `effects.json -> skyCover` no dibuja nada y el cuadro sale como ayer.
 */
export function paintSkyCover(g, view, t, worldToDevice) {
  if (!SKY.r) return;
  const storm = stormLevel();
  // La tormenta ARMÁNDOSE es cuando más sombra de nube hay; cerrada del todo es
  // penumbra pareja y de eso se encarga la paleta. `4·s·(1-s)` es un arco que
  // vale 0 en los dos extremos y 1 en la mitad — la forma, no un número mágico.
  const gathering = 4 * storm * (1 - storm);
  const alpha = ((SKY.baseAlpha || 0) + (SKY.stormAlpha || 0) * gathering) * daylight();
  if (alpha <= 0.001) return;
  const drift = SKY.driftPxPerS || [0, 0];
  // `t` VIENE EN SEGUNDOS y por eso se pide por parámetro en vez de leer el
  // `lastT` compartido, que guarda MILISEGUNDOS a propósito. Es la trampa que
  // este renderer ya pagó una vez completa: la rueda de Chicago giraba a 1 200
  // rpm porque cada dibujante decidía por su cuenta en qué reloj estaba.
  const seconds = t || 0;
  paintBlobs(g, SKY, view, {
    worldToDevice,
    dx: seconds * drift[0],
    dy: seconds * drift[1],
    alphaScale: alpha,
    seed: SKY.seed || 0,
    key: "skyCover",
  });
}
