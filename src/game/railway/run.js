// LA PARTIDA: FUERZAS SOBRE UNA VÍA, Y UN DEPÓSITO QUE SE VACÍA.
//
// El MVP anterior conducía con `acceleration = throttle*220 + gravity - …`, una
// suma de constantes en píxeles por segundo al cuadrado. Funciona y no se puede
// mejorar: no hay ningún número ahí que una pieza del garaje pueda subir sin
// mover todos los demás. Este modelo es el mismo de Hill Climb y tiene las
// cuatro perillas que el jugador compra:
//
//   * **TIRÓN** (`pullMax`, `pullPower`). La curva de par de cualquier tracción:
//     a baja velocidad manda la ADHERENCIA (`pullMax`, m/s²) y a alta manda la
//     POTENCIA (`pullPower/v`). El quiebre está en `pullPower/pullMax` m/s, que
//     para la Siemens son 15,5 — o sea 56 km/h, que es donde una locomotora
//     diésel-eléctrica real deja de ir a tope de esfuerzo de tracción.
//   * **VELOCIDAD** (`topSpeed`). No es un `Math.min`: es un recorte suave en la
//     cuarta potencia, así que el tren se arrima a su techo en vez de chocar
//     contra él. Un `min` duro se siente como una pared y además deja la aguja
//     clavada, que parece que el juego se trabó.
//   * **FRENO** (`brake`). Y por debajo de `brakes.holdSpeed` SOSTIENE: un tren
//     frenado en una cuesta no resbala hacia atrás, que es lo primero que uno
//     prueba.
//   * **COMBUSTIBLE** (`tankL`, `burnEfficiency`). El gasto es POTENCIA, o sea
//     tirón por velocidad, más el ralentí. Así subir una cuesta a todo gas
//     cuesta lo que debe costar y bajar rodando no cuesta nada, que es lo que
//     hace que el jugador aprenda a soltar el acelerador en las bajadas.
//
// Tres decisiones que no son obvias:
//
// **LA VELOCIDAD PUEDE SER NEGATIVA.** El tren rueda hacia atrás, y eso no es
// un lujo: es cómo FALLA un rizo. Sin velocidad negativa habría que inventar un
// estado "rizo fallido" y una animación para él; con ella, el tren simplemente
// se queda sin impulso, vuelve a bajar y uno toma carrera otra vez.
//
// **EL RIZO NECESITA SOSTÉN DE PESTAÑA, Y ESO SÍ ES CÓDIGO.** En la cima del
// lazo la vía está HORIZONTAL, así que la gravedad a lo largo de la vía vale
// cero y la física pura deja a un tren pasar por arriba a 0,1 m/s, boca abajo,
// tranquilamente. Lo que de verdad lo sostiene ahí es la fuerza centrípeta, y
// eso hay que preguntarlo: por debajo de `railGrip·g·R` el tren pierde el riel y
// se devuelve. `railGrip` es una fracción porque una rueda de riel va enganchada
// y no suelta como una vagoneta — sin ella el rizo grande pide 128 km/h de
// entrada y el nivel 1 es imposible con la máquina de salida.
//
// **SIN COMBUSTIBLE NO SE DETIENE EN SECO.** Pierde la tracción y sigue rodando.
// Un corte instantáneo se lee como un fallo del juego y no como quedarse sin
// leña.
//
// Browser-free: ni `window` ni DOM, para que la prueba y el smoke lo corran en
// Node.
import { atDistance, gradeAt, loopAt } from "./track.js";
import { hash01 } from "../../render/c2d/primitives.js";

export const RUN_PHASE = Object.freeze({
  READY: "ready", RUNNING: "running", FINISHED: "finished", STRANDED: "stranded",
});

/** Las monedas de un nivel: sembradas por regla, no autoradas una por una.
 *
 *  Van con `hash01` —el hash de la casa— y no con `Math.random`, por la razón de
 *  siempre: una moneda tiene que estar en el mismo sitio en cada intento o el
 *  nivel no se puede aprender. Y los rizos se saltan: una moneda dentro del lazo
 *  se cobra sola al pasar y no es una decisión de nadie. */
export function sowCoins(track, map, sim) {
  const rule = sim.coins;
  const out = [];
  const from = track.startS + rule.pitchM;
  for (let s = from; s < track.finishS - rule.pitchM * 0.5; s += rule.pitchM) {
    if (loopAt(track, s)) continue;
    const jitter = (hash01(out.length * 12.9898 + rule.seed) - 0.5) * 2 * rule.jitterM;
    const at = s + jitter;
    if (at <= track.startS || at >= track.finishS || loopAt(track, at)) continue;
    out.push({ s: at, taken: false });
  }
  return out;
}

/** Los bidones: éstos SÍ son autorados por kilómetro, porque dónde hay
 *  combustible es diseño de nivel y decide si el tramo se puede terminar. */
export function placeFuel(track, map) {
  return map.fuelStops.map((stop) => ({
    ...stop, s: nearestS(track, stop.playX), taken: false,
  }));
}

function nearestS(track, playX) {
  const pts = track.points;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x >= playX && pts[i - 1].x <= playX) {
      const span = pts[i].x - pts[i - 1].x || 1;
      return pts[i - 1].s + (pts[i].s - pts[i - 1].s) * ((playX - pts[i - 1].x) / span);
    }
  }
  return pts.at(-1).s;
}

/**
 * Una partida lista para arrancar, detenida en la estación.
 *
 * @param {object} args.map      `buildLevelMap`
 * @param {object} args.track    `buildTrack`
 * @param {object} args.stats    `trainStats` — ya con las mejoras aplicadas
 * @param {object} args.sim      `railway-sim.json`
 * @param {number} args.consistM el largo del convoy, para que la cola arranque
 *                               dentro de la vía y no detrás del andén
 */
export function createRun({ map, track, stats, sim, consistM = 0 }) {
  return {
    map,
    track,
    stats,
    sim,
    phase: RUN_PHASE.READY,
    distance: track.startS + consistM,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    drive: 0,
    grade: 0,
    fuelL: stats.tankL,
    burnLPerS: 0,
    usedL: 0,
    coins: 0,
    coinsPicked: 0,
    elapsed: 0,
    graceS: 0,
    distanceM: 0,
    loop: null,
    loopStall: false,
    loopsDone: 0,
    loopFlag: new Set(),
    sliding: false,
    reason: null,
    coinPickups: sowCoins(track, map, sim),
    fuelPickups: placeFuel(track, map),
  };
}

/** Lo que el jugador le pidió este cuadro: dos números de 0 a 1. */
function readInput(input) {
  const brake = Math.max(0, Math.min(1, Number(input.brake) || 0));
  const throttle = Math.max(0, Math.min(1, Number(input.throttle) || 0));
  // El freno gana: con los dos puestos, frena. Mezclarlos deja al tren
  // calentando el motor contra su propio freno, que no es una maniobra.
  return { throttle: brake > 0 ? 0 : throttle, brake };
}

export function stepRun(run, dt, input = {}) {
  if (run.phase === RUN_PHASE.FINISHED || run.phase === RUN_PHASE.STRANDED) return run;
  const step = Math.max(0, Math.min(0.05, dt));
  const { physics, brakes, fuel, loops } = run.sim;
  const { throttle, brake } = readInput(input);
  run.throttle = throttle;
  run.brake = brake;

  if (run.phase === RUN_PHASE.READY) {
    if (throttle <= 0) return run;
    run.phase = RUN_PHASE.RUNNING;
  }
  // La gracia de salida: soltar la pantalla de arranque no cuesta tiempo.
  run.graceS += step;
  if (run.graceS > physics.startGrace) run.elapsed += step;

  const dry = run.fuelL <= 0;
  const drive = dry ? 0 : throttle * driveAccel(run.stats, run.speed);
  run.drive = drive;

  const grade = gradeAt(run.track, run.distance, physics.gradeSmoothM);
  run.grade = grade;
  // EL RIZO LLEVA SU PROPIA GRAVEDAD, y está declarada en el registro con su
  // medición al lado: a gravedad real un lazo circular de 24 m pide 124 km/h de
  // entrada y ninguna de las tres máquinas documentadas llega. No es un empujón
  // escondido — es la licencia del kit de fantasía, dicha donde se afina.
  const inLoop = loopAt(run.track, run.distance);
  const gravity = physics.g * (inLoop ? loops.gravityFactor : 1);
  let accel = drive + gravity * grade;

  const drag = run.stats.rollDrag + run.stats.airDrag * run.speed * run.speed;
  const braking = brake * run.stats.brake;
  if (run.speed > 0) accel -= drag + braking;
  else if (run.speed < 0) accel += drag + braking;

  // EL SOSTÉN DE PESTAÑA. Sólo en la mitad de arriba del lazo, que es donde la
  // vía no puede ayudar: abajo la gravedad ya decide sola.
  const loop = inLoop;
  run.loop = loop;
  run.loopStall = false;
  if (loop) {
    const point = atDistance(run.track, run.distance);
    const lift = (point.y - loop.centerY) / loop.radiusM; // -1 cima, +1 base
    const needed = Math.sqrt(loops.railGrip * gravity * loop.radiusM) * loops.stallMargin;
    if (lift < 0.25 && Math.abs(run.speed) < needed) {
      accel -= gravity * 1.35;
      run.loopStall = true;
    }
  }

  run.speed += accel * step;
  run.sliding = brake >= brakes.slideThreshold && Math.abs(run.speed) > brakes.holdSpeed;
  // Sostener en la cuesta, y dejar de temblar en la recta. Dos frenos distintos
  // con el mismo efecto visible: la aguja en cero de verdad.
  if (brake > 0 && Math.abs(run.speed) < brakes.holdSpeed) run.speed = 0;
  else if (throttle <= 0 && Math.abs(run.speed) < physics.idleRoll
    && Math.abs(physics.g * grade) < run.stats.rollDrag) run.speed = 0;

  run.topSpeed = Math.max(run.topSpeed, run.speed);
  run.distance += run.speed * step;
  if (run.distance <= run.track.startS) { run.distance = run.track.startS; run.speed = Math.max(0, run.speed); }

  // EL GASTO ES POTENCIA. `max(speed, 4)` deja que arrancar cueste algo: a cero
  // la potencia es cero y un tren parado a todo gas no gastaría nada.
  if (!dry) {
    run.burnLPerS = (run.stats.burnIdle * (0.4 + 0.6 * throttle)
      + run.stats.burnPerPull * drive * Math.max(Math.abs(run.speed), 4) / physics.powerRefSpeed)
      / run.stats.burnEfficiency;
    const spent = run.burnLPerS * step;
    run.fuelL = Math.max(0, run.fuelL - spent);
    run.usedL += spent;
  } else {
    run.burnLPerS = 0;
  }

  collect(run);
  run.distanceM = Math.max(0, (run.distance - run.track.startS));

  if (run.distance >= run.track.finishS) {
    run.distance = run.track.finishS;
    run.speed = Math.max(0, Math.min(run.speed, run.stats.topSpeed));
    run.phase = RUN_PHASE.FINISHED;
    run.reason = "arrived";
  } else if (run.fuelL <= 0 && Math.abs(run.speed) < physics.idleRoll
    && Math.abs(physics.g * grade) < run.stats.rollDrag) {
    run.phase = RUN_PHASE.STRANDED;
    run.reason = "dry";
  }
  return run;
}

/** La curva de par: adherencia abajo, potencia arriba, techo suave al final. */
export function driveAccel(stats, speed) {
  const v = Math.max(Math.abs(speed), 2);
  const raw = Math.min(stats.pullMax, stats.pullPower / v);
  const reach = Math.max(0, Math.min(1, speed / stats.topSpeed));
  return raw * (1 - reach ** 4);
}

function collect(run) {
  const reach = run.sim.coins.pickupM;
  for (const coin of run.coinPickups) {
    if (!coin.taken && Math.abs(run.distance - coin.s) < reach) {
      coin.taken = true;
      run.coins += run.sim.coins.value;
      run.coinsPicked += run.sim.coins.value;
    }
  }
  for (const drum of run.fuelPickups) {
    if (!drum.taken && Math.abs(run.distance - drum.s) < reach) {
      drum.taken = true;
      run.fuelL = Math.min(run.stats.tankL, run.fuelL + run.sim.fuel.canL);
    }
  }
  // UN RIZO SE PAGA AL SALIR, NO AL ENTRAR. Medido en la salida porque entrar y
  // devolverse es exactamente el intento que no cuenta.
  for (const loop of run.track.loops) {
    if (!run.loopFlag.has(loop.entryX) && run.distance > loop.sOut) {
      run.loopFlag.add(loop.entryX);
      run.loopsDone += 1;
      run.coins += run.sim.coins.loopBonus;
    }
  }
}

/** El resultado de la partida: estrellas, fichas y por qué terminó.
 *
 *  LO QUE UNA META PIDE, EL NIVEL LO DICE. Las tres estrellas son llegar, llegar
 *  a tiempo y recoger su parte de las monedas; los umbrales están en `goals` del
 *  nivel, así que un tramo más largo no hereda el reloj del nivel 1. */
export function runResult(run, level, economy) {
  const arrived = run.phase === RUN_PHASE.FINISHED;
  const total = run.coinPickups.length * run.sim.coins.value;
  // LA FRACCIÓN CUENTA MONEDAS, NO PREMIOS. Sumar el bono del rizo acá dejaba
  // la tercera estrella ganada por dar vueltas y no por recorrer el tramo — y,
  // peor, un 83 de 70 en la pantalla de resultados.
  const fraction = total ? run.coinsPicked / total : 1;
  const stars = !arrived ? 0
    : 1 + (run.elapsed <= level.goals.targetS ? 1 : 0)
      + (fraction >= level.goals.coinFraction ? 1 : 0);
  const reward = Math.round(run.coins
    + run.distanceM * economy.coinPerM
    + (arrived ? economy.finishBonus + stars * economy.starBonus : 0));
  return {
    arrived,
    reason: run.reason,
    stars,
    elapsed: run.elapsed,
    distanceM: run.distanceM,
    coins: run.coins,
    coinsPicked: run.coinsPicked,
    coinsTotal: total,
    usedL: run.usedL,
    loopsDone: run.loopsDone,
    topSpeed: run.topSpeed,
    reward,
  };
}
