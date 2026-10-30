// LA FACHADA DEL MODO TREN — un objeto, cuatro registros y nada de DOM.
//
// Es el equivalente de `src/game/index.js` para el Tren al Puerto: junta el
// nivel, la máquina y la física, y expone lo poco que la pantalla necesita.
// Que viva en `src/game/` y no en el renderer es el mismo reparto de siempre —
// el modelo no sabe dibujar — y tiene una consecuencia práctica: el smoke y la
// prueba corren una partida COMPLETA en Node, sin navegador, que es como se
// comprueba que el nivel 1 se puede terminar con la máquina de salida.
import ART from "../../assets/railway-art.json" with { type: "json" };
import SIM from "../../assets/railway-sim.json" with { type: "json" };
import CATALOG from "../../content/railway/catalog.json" with { type: "json" };
import PACIFICO_BELEN from "../../content/railway/levels/pacifico-belen.json" with { type: "json" };
import { buildLevelMap } from "./level.js";
import { buildTrack } from "./track.js";
import { buildConsist, consistLengthM, trainStats } from "./stats.js";
import { createRun, runResult, stepRun } from "./run.js";

export { ART as RAILWAY_ART, SIM as RAILWAY_SIM, CATALOG as RAILWAY_CATALOG };

/** Los niveles por id. Uno hoy; la campaña propuesta son nueve y el orden lo
 *  manda `catalog.campaign`, no este objeto. */
export const RAILWAY_LEVELS = Object.freeze({
  [PACIFICO_BELEN.id]: PACIFICO_BELEN,
});

export function railwayLevel(id) {
  const level = RAILWAY_LEVELS[id];
  if (!level) throw new Error(`unknown railway level "${id}"`);
  return level;
}

export function railwayTrain(id) {
  const train = CATALOG.trains.find((t) => t.id === id);
  if (!train) throw new Error(`unknown railway train "${id}"`);
  return train;
}

/**
 * Arma una partida: nivel + máquina + mejoras.
 *
 * @param {string} levelId
 * @param {string} trainId
 * @param {object} upgrades  `{engine: 2, brake: 1, …}`
 */
export function createRailwayRun(levelId, trainId, upgrades = {}) {
  const level = railwayLevel(levelId);
  const train = railwayTrain(trainId);
  const map = buildLevelMap(level, SIM);
  const track = buildTrack(map);
  const stats = trainStats(train, upgrades, CATALOG);
  const consist = buildConsist(train, ART);
  const run = createRun({ map, track, stats, sim: SIM, consistM: consistLengthM(consist) });
  return {
    level, train, map, track, stats, consist, run,
    step: (dt, input) => stepRun(run, dt, input),
    result: () => runResult(run, level, CATALOG.economy),
  };
}

/** Las escenas del modo, en el orden en que la campaña las va a mostrar: las del
 *  nivel jugable primero y las de los tramos propuestos después. Es lo que el
 *  selector pasa en bucle. */
export function railwayScenes() {
  const played = [];
  for (const id of CATALOG.campaign) {
    for (const cut of railwayLevel(id).scenes) {
      if (!played.includes(cut.id)) played.push(cut.id);
    }
  }
  const rest = Object.keys(ART.scenes).filter((id) => !played.includes(id));
  return [...played, ...rest];
}
