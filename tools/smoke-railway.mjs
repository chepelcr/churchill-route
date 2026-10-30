// EL NIVEL 1 SE PUEDE TERMINAR — y eso una captura no lo puede decir.
//
//   node tools/smoke-railway.mjs
//
// Corre la partida ENTERA, sin navegador, con las tres máquinas y con el
// registro de verdad. Mide las cuatro cosas de las que depende que el tramo
// Pacífico–Belén sea un nivel y no una pared:
//
//   1. **LA MÁQUINA GRATIS LLEGA.** Si el primer tramo pide comprar algo, el
//      bucle de mejoras no arranca nunca. La compuerta barata de
//      `tests/test_railway_content.py` compara contra el techo teórico; ésta
//      corre la bajada de verdad, que es donde el tren toma la velocidad con la
//      que entra al rizo.
//   2. **LOS TRES RIZOS SE PASAN**, incluido el grande, llegando lanzado.
//   3. **EL COMBUSTIBLE ALCANZA Y APRIETA.** Que sobre demasiado convierte la
//      barra de combustible en adorno; que no alcance a todo gas convierte el
//      nivel en un muro. Se exige terminar y se exige haber gastado más de un
//      depósito.
//   4. **EL PERFIL ES EL DEL CORREDOR.** El tramo baja 225 m de cota real; si
//      alguien retipea el perfil o cambia la compresión, la caída deja de
//      cuadrar con la investigación y esto lo dice.
//
// Y el caso que se mide aparte: **un rizo que no se pasa no descarrila, se
// devuelve.** Entrar frenado al rizo grande tiene que dejar al tren rodando
// hacia atrás y con el aviso puesto, no clavado ni cayéndose del mapa.
import { createRailwayRun, RAILWAY_CATALOG, RAILWAY_SIM } from "../src/game/railway/index.js";
import { RUN_PHASE } from "../src/game/railway/run.js";

const DT = 1 / 60;
const fails = [];
const check = (ok, line) => { console.log(`${ok ? "  ok " : "FAIL "} ${line}`); if (!ok) fails.push(line); };

function drive(game, input = () => ({ throttle: 1 }), limitS = 600) {
  let steps = 0, stalls = 0;
  while (game.run.phase !== RUN_PHASE.FINISHED && game.run.phase !== RUN_PHASE.STRANDED
    && steps < limitS * 60) {
    game.step(DT, input(game.run));
    if (game.run.loopStall) stalls++;
    steps++;
  }
  return { ...game.result(), stalls, phase: game.run.phase, fuelLeft: game.run.fuelL };
}

console.log("— Pacífico → Belén, a todo gas —");
for (const train of RAILWAY_CATALOG.trains) {
  const game = createRailwayRun("pacifico-belen", train.id, {});
  const r = drive(game);
  console.log(`  ${train.id.padEnd(14)} ${r.phase.padEnd(9)} ${r.elapsed.toFixed(0)}s`
    + ` ${(r.distanceM / 1000).toFixed(2)}km  rizos ${r.loopsDone}/3`
    + `  ${r.usedL.toFixed(0)}L  ★${r.stars}  ${(r.topSpeed * 3.6).toFixed(0)}km/h`);
  check(r.arrived, `${train.id} llega a Belén`);
  check(r.loopsDone === 3, `${train.id} pasa los tres rizos`);
}

const starter = RAILWAY_CATALOG.trains[0];
const base = drive(createRailwayRun("pacifico-belen", starter.id, {}));
check(base.usedL > starter.stats.tankL,
  `el depósito aprieta: ${base.usedL.toFixed(0)} L gastados contra ${starter.stats.tankL} de tanque`);
check(base.stars >= 1 && base.stars <= 2,
  `la máquina de salida saca ${base.stars} estrella(s): llegar sí, las tres no`);

const maxed = Object.fromEntries(RAILWAY_CATALOG.upgrades.ladders
  .map((l) => [l.id, RAILWAY_CATALOG.upgrades.maxLevel]));
const full = drive(createRailwayRun("pacifico-belen", starter.id, maxed));
check(full.stars === 3, `con el taller al tope saca las tres estrellas (${full.stars})`);
check(full.elapsed < base.elapsed, `y llega antes (${full.elapsed.toFixed(0)}s < ${base.elapsed.toFixed(0)}s)`);

console.log("— el rizo grande, entrando frenado —");
{
  const game = createRailwayRun("pacifico-belen", starter.id, {});
  const big = game.track.loops.at(-1);
  let sawStall = false, sawBackwards = false;
  // Frena hasta un paso de hombre antes de la entrada y SUELTA: frenar hasta
  // que la rueda pare lo deja clavado contra su propio freno (es lo que
  // `brakes.holdSpeed` promete) y el rizo no se intenta nunca.
  const APPROACH = 8;
  for (let i = 0; i < 600 * 60; i++) {
    const d = game.run.distance;
    const approach = d > big.sIn - 150 && d < big.sIn - 6;
    const braking = approach && game.run.speed > APPROACH;
    game.step(DT, { throttle: approach ? 0 : 1, brake: braking ? 1 : 0 });
    if (d > big.sIn && game.run.loopStall) sawStall = true;
    if (d > big.sIn && game.run.speed < -0.5) sawBackwards = true;
    if (sawStall && sawBackwards) break;
    if (game.run.phase !== RUN_PHASE.RUNNING && game.run.phase !== RUN_PHASE.READY) break;
  }
  check(sawStall, "avisa que falta velocidad en la mitad de arriba del lazo");
  check(sawBackwards, "y el tren rueda de vuelta en vez de quedarse clavado o descarrilar");
}

console.log("— el corredor —");
{
  const game = createRailwayRun("pacifico-belen", starter.id, {});
  const level = game.level;
  const profile = level.profile;
  const drop = profile.groundM[0] - profile.groundM.at(-1);
  const compression = (level.corridor.toKm - level.corridor.fromKm) * 1000 / level.play.lengthM;
  console.log(`  ${profile.groundM.length} muestras · caída ${drop.toFixed(0)} m`
    + ` · compresión ×${compression.toFixed(2)} · vía ${game.track.length.toFixed(0)} m`);
  check(Math.abs(drop - 225) < 6, `el tramo baja los 225 m de cota que mide la investigación (${drop.toFixed(0)})`);
  check(game.track.loops.length === level.loops.length, "los tres rizos entran en la vía");
  check(game.map.playTotalM > level.play.lengthM,
    "el hueco de los rizos se suma al recorrido y no le roba kilometraje al corredor");
  const km0 = game.map.kmAt(0), kmEnd = game.map.kmAt(game.map.playTotalM);
  check(Math.abs(km0 - level.corridor.fromKm) < 0.01 && Math.abs(kmEnd - level.corridor.toKm) < 0.02,
    `el eje de juego cubre km ${km0.toFixed(2)}–${kmEnd.toFixed(2)}`);
  // La cámara también vive en metros: el rizo grande tiene que caber en cuadro.
  const bigR = RAILWAY_SIM.loops.sizes.large.radiusM;
  const fits = (720 * RAILWAY_SIM.view.loopFitFraction) / ((bigR * 2 + 12) * RAILWAY_SIM.view.pxPerM);
  check(Math.min(fits, RAILWAY_SIM.view.maxZoom) * (bigR * 2) * RAILWAY_SIM.view.pxPerM < 720,
    "el rizo grande entra entero en un cuadro de 720");
}

console.log(fails.length ? `\n${fails.length} fallo(s)` : "\ntodo bien");
process.exit(fails.length ? 1 : 0);
