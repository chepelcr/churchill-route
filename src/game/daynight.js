// The sky, on a clock.
//
// Weather was a value you picked once and lived with: a stage names its own, an
// arcade run took whatever was authored, and Recorrer stayed sunny for as long
// as you drove. The peninsula deserves better than one hour of one day — the
// atardecer over the gulf is the thing people photograph.
//
// THERE IS NO GAME-TIME SCALE IN THIS GAME. `state.timeLeft -= dt` is real
// seconds, everywhere, so a "ten minute day" is ten minutes of playing. That is
// the right length for Recorrer, where a session is long and the change should
// arrive as a surprise rather than a strobe — and the wrong length for a
// three-minute Arcade run, which is why Arcade PICKS its sky instead of
// cycling: a run that ends before dusk is a run that never saw it.
//
// The cycle is the four weathers the renderer already paints, in the order the
// day actually goes. Storm is not part of it: it INTERRUPTS, the way it does on
// the Pacific, and hands the sky back where it left off.
import { state } from "./state.js";
import { pushFloat } from "./state.js";
import { t } from "../i18n/index.js";
import SIM from "../content/simulation.json" with { type: "json" };

//: a whole day, in real seconds. Four phases, so ~2.5 min each.
export const DAY_SECONDS = SIM.day.seconds;
//: the running order of a day. `sunny` is midday and gets the longest share.
const PHASES = SIM.day.phases.map((p) => ({ w: p.weather, share: p.share }));
//: how often a storm rolls in, and how long it stays.
const STORM_EVERY = SIM.day.stormEverySeconds;   // s, random inside the range
const STORM_LASTS = SIM.day.stormLastsSeconds;

//: LOS TRES ACTOS DE UNA TORMENTA. Antes era un interruptor: `state.weather`
//: pasaba a "storm" en un cuadro y ya estaba lloviendo. Una tormenta del
//: Pacífico se ve venir — el cielo se cierra, después truena, y sólo entonces
//: cae el agua.
const STORM_BUILD = SIM.day.stormBuildSeconds;
const STORM_EASE = SIM.day.stormEaseSeconds;
const DRYING = SIM.day.stormDryingSeconds;
const WET_GRIP = SIM.day.stormWetGrip;
const LIGHTNING_EVERY = SIM.day.lightningEverySeconds;

//: LA FUERZA de una tormenta: se sortea al empezar, así que un chubasco y un
//: aguacero son dos cosas distintas y no la misma con otra duración.
const SEVERITY = SIM.day.stormSeverity;
//: …y el umbral arriba del cual sale un tornado. Si saliera en cualquier
//: chubasco dejaría de ser un evento y pasaría a ser el clima.
const TORNADO_ABOVE = SIM.day.tornadoAbove;

//: EL MES LUNAR, en días del juego.
const MOON_DAYS = SIM.tide.moonDays;

const cycle = {
  on: false, t: 0, phase: -1,
  stormIn: 0, stormLeft: 0, before: null,
  //: 0 = despejado, 1 = tormenta encima. Sube en `STORM_BUILD` y baja en
  //: `STORM_EASE`, y es lo que TODO lo de la tormenta lee: el tinte, la lluvia,
  //: el agarre, las luces. Un solo número en vez de una bandera.
  storm: 0,
  //: EL CHARCO DURA MÁS QUE LA NUBE. El asfalto sigue mojado después de que
  //: escampa, así que el agarre vuelve por su cuenta y no con el sol.
  wet: 0,
  //: el relámpago: cuánto falta para el próximo y cuánto queda del destello.
  boltIn: 0, bolt: 0,
  //: días transcurridos, para la fase de la luna. Cuenta aunque el reloj del
  //: día esté apagado en una etapa, porque la marea lo sigue leyendo.
  days: 0,
  //: cuán fuerte es LA TORMENTA QUE ESTÁ CAYENDO, 0..1. Sorteada al empezar.
  severity: 0,
  //: …y la de la que dejó el charco, que puede no ser la misma: el asfalto se
  //: seca a su ritmo y hasta entonces recuerda qué lo mojó.
  wetSeverity: 0,
};

function rand([lo, hi]) { return lo + Math.random() * (hi - lo); }

/** Start (or stop) the clock. `at` is 0..1 through the day. */
export function setDayCycle(on, at = 0) {
  cycle.on = on;
  cycle.t = at * DAY_SECONDS;
  cycle.phase = -1;
  cycle.stormLeft = 0;
  cycle.before = null;
  cycle.stormIn = rand(STORM_EVERY);
  if (on) apply(true);
}

export function dayCycleOn() { return cycle.on; }

/** 0..1 through the day — for anything that wants a continuous hour. */
export function timeOfDay() {
  return cycle.on ? (cycle.t % DAY_SECONDS) / DAY_SECONDS : null;
}

function phaseAt(seconds) {
  let acc = 0;
  const u = (seconds % DAY_SECONDS) / DAY_SECONDS;
  for (let i = 0; i < PHASES.length; i++) {
    acc += PHASES[i].share;
    if (u < acc) return i;
  }
  return PHASES.length - 1;
}

function apply(silent) {
  const i = phaseAt(cycle.t);
  if (i === cycle.phase) return;
  cycle.phase = i;
  // A storm owns the sky while it lasts; the cycle keeps running underneath so
  // it hands back the right hour when the rain stops.
  if (!cycle.stormLeft) state.weather = PHASES[i].w;
  if (!silent && !cycle.stormLeft) {
    pushFloat(state.p.x, state.p.y - 60, t(`sky.${PHASES[i].w}`), "#f4d77a");
  }
}

export function updateDayCycle(dt) {
  // EL RELOJ DEL DÍA puede estar apagado (una etapa escoge su cielo), pero la
  // TORMENTA y la LUNA no: una etapa con tormenta autorada tiene que mojar la
  // calle igual, y la marea lee la luna en las dos.
  advanceStorm(dt);
  if (!cycle.on) return;
  cycle.t += dt;
  cycle.days = cycle.t / DAY_SECONDS;
  apply(false);
  // …y sólo se sortea una tormenta nueva cuando no hay ninguna en curso.
  if (cycle.stormLeft <= 0 && cycle.storm <= 0) {
    cycle.stormIn -= dt;
    if (cycle.stormIn <= 0) startStorm();
  }
}

/** Arranca una tormenta: a cualquier hora del día, y se ve venir. */
function startStorm() {
  cycle.before = state.weather;
  cycle.stormLeft = rand(STORM_LASTS);
  cycle.severity = rand(SEVERITY);
  cycle.boltIn = rand(LIGHTNING_EVERY);
  // El aviso llega con el CIELO, no con el agua: el nombre del clima cambia ya
  // (las luces y la paleta lo leen) y la lluvia entra con la rampa.
  state.weather = "storm";
  pushFloat(state.p.x, state.p.y - 60, t("sky.storm"), "#9fd7ef");
}

/** La rampa: sube mientras la tormenta está encima, baja cuando pasa. */
function advanceStorm(dt) {
  if (cycle.stormLeft > 0) {
    cycle.stormLeft -= dt;
    cycle.storm = Math.min(1, cycle.storm + dt / STORM_BUILD);
    cycle.wet = 1;
    cycle.wetSeverity = cycle.severity;
    // RELÁMPAGOS, y sólo cuando la tormenta ya está encima: uno en el primer
    // segundo, antes de que el cielo se cierre, se lee como un error.
    if (cycle.storm > 0.55) {
      cycle.bolt = Math.max(0, cycle.bolt - dt);
      cycle.boltIn -= dt;
      if (cycle.boltIn <= 0) { cycle.bolt = 0.18; cycle.boltIn = rand(LIGHTNING_EVERY); }
    }
    if (cycle.stormLeft <= 0 && cycle.on) {
      // el cielo vuelve a la hora que sea, no a la que era
      state.weather = PHASES[phaseAt(cycle.t)].w;
      cycle.stormIn = rand(STORM_EVERY);
      pushFloat(state.p.x, state.p.y - 60, t("sky.clearing"), "#9fd7ef");
    }
    return;
  }
  if (cycle.storm > 0) cycle.storm = Math.max(0, cycle.storm - dt / STORM_EASE);
  cycle.bolt = Math.max(0, cycle.bolt - dt);
  // EL CHARCO DURA MÁS QUE LA NUBE: el asfalto se seca por su cuenta, así que
  // sigue resbaloso un rato después de que el cielo abrió.
  if (cycle.wet > 0) cycle.wet = Math.max(0, cycle.wet - dt / DRYING);
}

// ---- lo que el resto del juego le pregunta al cielo -------------------------

/**
 * ¿ESTÁ PRENDIDO EL ALUMBRADO?
 *
 * De noche, y **también cuando el cielo se cierra** — un pueblo prende las luces
 * a mediodía si viene un aguacero. Vive acá y no en cada pintor porque la
 * pregunta la hacen DOS: el que dibuja la lámpara y el que abre su pozo de luz.
 * Escrita dos veces, un umbral distinto en cada lado da lámparas encendidas sin
 * luz alrededor — que es exactamente el bug que tuvo la noche la primera vez.
 */
export function lightsOn() {
  return state.weather === "night" || cycle.storm > 0.45;
}

/** Cuánta tormenta hay encima, 0..1 — la RAMPA (cuán metidos estamos en ella). */
export function stormLevel() { return cycle.storm; }

/**
 * CUÁN FUERTE ES esta tormenta, 0..1 — su carácter, no su avance.
 *
 * Son dos ejes distintos y hay que tenerlos separados: la rampa dice cuánto
 * falta para que llueva, la fuerza dice cuánto va a llover. Un chubasco al 100 %
 * de su rampa sigue siendo un chubasco.
 */
export function stormSeverity() { return cycle.storm > 0 ? cycle.severity : 0; }

/** Lo que de verdad se siente: la fuerza YA rampada. */
export function stormForce() { return cycle.storm * cycle.severity; }

/** ¿Esta tormenta saca tornado? Sólo las de verdad. */
export function stormHasTornado() {
  return cycle.storm > 0.6 && cycle.severity >= TORNADO_ABOVE;
}

/** El destello de un relámpago, 0..1 — se apaga en fracciones de segundo. */
export function lightning() { return cycle.bolt > 0 ? cycle.bolt / 0.18 : 0; }

/**
 * EL AGARRE QUE QUEDA sobre asfalto mojado.
 *
 * La lluvia no le hacía NADA a la calle: llovía y se manejaba igual. Sale del
 * CHARCO y no de la nube, así que la calle sigue resbalosa después de escampar.
 */
export function wetGrip() {
  // LA FUERZA SE COME EL AGARRE. Un chubasco moja la calle; un aguacero la
  // vuelve otra cosa. `wet` es el charco (que sobrevive a la nube) y la fuerza
  // es de la tormenta que lo hizo, así que se guarda al mojarse: si se leyera
  // en vivo, el asfalto se «desmojaría» al pasar la tormenta y no al secarse.
  return 1 - (1 - WET_GRIP) * cycle.wet * (0.55 + 0.45 * cycle.wetSeverity);
}

/**
 * LAS DOS FASES ENTRE LAS QUE ESTÁ EL CIELO, y cuánto va de una a otra.
 *
 * El día cambiaba DE GOLPE: `apply()` sólo actuaba al cruzar una frontera, así
 * que el atardecer aparecía de un cuadro al otro. La hora es continua y la
 * paleta ahora también: `weatherColors()` mezcla estas dos.
 *
 * La tormenta entra por el mismo camino y no como un quinto caso — se mezcla
 * HACIA la paleta de tormenta con la rampa, que es lo que hace que el cielo se
 * cierre en vez de saltar.
 */
export function skyBlend() {
  if (!cycle.on) {
    // Sin reloj (una etapa) el cielo es fijo, y la tormenta sigue pudiendo
    // cerrarlo encima.
    return { from: state.weather, to: "storm", k: cycle.storm };
  }
  const u = (cycle.t % DAY_SECONDS) / DAY_SECONDS;
  let acc = 0, i = 0;
  for (; i < PHASES.length; i++) {
    if (u < acc + PHASES[i].share) break;
    acc += PHASES[i].share;
  }
  i = Math.min(i, PHASES.length - 1);
  const within = (u - acc) / PHASES[i].share;
  const next = PHASES[(i + 1) % PHASES.length];
  // LA MEZCLA VIVE EN EL ÚLTIMO TERCIO de cada fase, no a lo largo de toda.
  // Mezclando de punta a punta el mediodía nunca es mediodía: es siempre medio
  // atardecer, y el día pierde sus horas.
  const EDGE = 0.34;
  const k = within > 1 - EDGE ? (within - (1 - EDGE)) / EDGE : 0;
  const base = { from: PHASES[i].w, to: next.w, k };
  if (cycle.storm <= 0) return base;
  // …y la tormenta encima de lo que haya: se mezcla desde el cielo de la hora
  // hacia el de tormenta, así que una tormenta de día y una de noche son dos
  // cosas distintas, que es como se ven de verdad.
  return { from: base.k > 0.5 ? base.to : base.from, to: "storm", k: cycle.storm };
}

/**
 * EL SOL: hacia dónde tira la sombra y cuán alto está.
 *
 * Las sombras estaban clavadas abajo y a la derecha en TODO el mundo y a toda
 * hora, lo que a mediodía se lee como si cada árbol estuviera descuadrado. Un
 * vector de verdad las mueve con la hora: cortas y casi bajo la copa a
 * mediodía, largas y tendidas al atardecer.
 *
 * `alt` es 0 en el horizonte y 1 en el cenit. De noche el sol está bajo el
 * horizonte y la que manda es la luna, mucho más suave — así que `alt` no baja
 * a cero, o los árboles se quedarían sin sombra y flotando.
 */
export function sunVector() {
  const u = cycle.on ? (cycle.t % DAY_SECONDS) / DAY_SECONDS : 0.25;
  // El día va de este a oeste: el ángulo recorre media vuelta entre el amanecer
  // y el atardecer, así que la sombra barre de un lado al otro.
  const a = (u - 0.25) * Math.PI * 2;
  const alt = Math.max(0.16, Math.cos(a));
  return { x: -Math.sin(a), y: 0.55, alt };
}

/**
 * LA FASE DE LA LUNA, 0..1 — 0 y 1 son luna nueva, 0.5 es luna llena.
 *
 * Mueve dos cosas, y las dos son de verdad: la MAREA (llena o nueva = viva, el
 * sol y la luna alineados; cuarto = muerta) y cuánto se VE de noche.
 */
export function moonPhase() {
  return (cycle.days / MOON_DAYS) % 1;
}

/** Cuánta luna hay: 0 en luna nueva, 1 en llena. */
export function moonlight() {
  return 1 - Math.abs(0.5 - moonPhase()) * 2;
}

/**
 * EL RANGO DE LA MAREA por la luna: viva en llena y en nueva, muerta en cuarto.
 *
 * Es la física de verdad y cae sobre el modelo que ya había — multiplica la
 * AMPLITUD del coseno en vez de agregarle un término. Nótese que llena Y nueva
 * dan viva: lo que importa es la ALINEACIÓN, no cuánta luna se ve.
 */
export function tideRange() {
  const { springRange, neapRange } = SIM.tide;
  // |cos(2π·fase)| es 1 en nueva y en llena, 0 en los cuartos.
  const aligned = Math.abs(Math.cos(moonPhase() * Math.PI * 2));
  return neapRange + (springRange - neapRange) * aligned;
}
