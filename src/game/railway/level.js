// EL CORREDOR REAL, PUESTO EN EL ESPACIO DE JUEGO.
//
// Un nivel del Tren al Puerto declara DOS cosas que no se parecen: el tramo del
// Ferrocarril al Pacífico que cubre (kilómetros medidos sobre el snapshot de
// OSM, con su perfil de suelo del DEM) y lo que se juega (tres kilómetros de
// vía). Este módulo es el único sitio donde las dos se encuentran, y conviene
// que sea uno:
//
//   * **LA FORMA ES LA DEL DEM, EL LARGO NO.** 14,34 km de corredor se recorren
//     en 3 km de juego. La compresión horizontal (×4,78 en el nivel 1) ya
//     multiplica la pendiente por sí sola — el DEM baja 1,6 % de Pacífico a
//     Belén y en juego eso llega a 19 % en la bajada de la Sabana. Lo poco que
//     se le suma encima es `play.verticalExaggeration`, y se suma ACÁ para que
//     ningún lector crea que lee metros de la vía de verdad.
//   * **EL TABLERO NO ES EL SUELO.** `deckM` es la plataforma ferroviaria
//     (suelo suavizado, pendiente limitada, cuerda recta sobre cada puente) y
//     `groundM` es el terreno. Que el tren vuele sobre un hueco es LA SEÑAL de
//     que ahí hay un puente, no un error de dibujo; la investigación lo pide
//     explícitamente.
//   * **UN RIZO NO AVANZA EL CORREDOR.** El kit de fantasía mete su hueco en el
//     eje de JUEGO y deja el kilometraje quieto, así que el perfil pasa plano
//     por debajo y la cota del corredor no se altera por una licencia de
//     diseño. De ahí que el mapa play↔corredor sea una lineal a trozos con una
//     meseta por rizo, y no una regla de tres.
//
// Browser-free on purpose: la hoja de arte, el smoke y las pruebas lo importan
// sin DOM.

/** Interpolación lineal sobre un arreglo muestreado a paso constante. */
function sampleAt(values, index) {
  if (!values.length) return 0;
  if (index <= 0) return values[0];
  const last = values.length - 1;
  if (index >= last) return values[last];
  const i = Math.floor(index);
  return values[i] + (values[i + 1] - values[i]) * (index - i);
}

/**
 * El mapa de un nivel: play ↔ corredor, cota del tablero y cota del suelo.
 *
 * @param {object} level  un registro de `src/content/railway/levels/`
 * @param {object} sim    `src/assets/railway-sim.json`
 */
export function buildLevelMap(level, sim) {
  const { fromKm, toKm } = level.corridor;
  const corridorM = (toKm - fromKm) * 1000;
  const spacingM = level.profile.spacingM;
  const ground = level.profile.groundM;
  const deck = level.profile.deckM;
  if (!ground.length || !deck.length) {
    throw new Error(`railway level "${level.id}" has no profile; run tools/gen_railway_profile.py`);
  }
  const playM = level.play.lengthM;
  const compression = corridorM / playM;
  const exaggeration = level.play.verticalExaggeration ?? 1;
  const baseElevM = deck[0];

  // Los rizos, ordenados y con su hueco acumulado. `playX0` es donde empieza el
  // hueco en el eje de juego, ya contando los rizos anteriores.
  let inserted = 0;
  const loops = (level.loops || []).slice()
    .sort((a, b) => a.km - b.km)
    .map((loop) => {
      const size = sim.loops.sizes[loop.size];
      if (!size) throw new Error(`unknown loop size "${loop.size}" in level "${level.id}"`);
      const corridorS = (loop.km - fromKm) * 1000;
      const playX0 = corridorS / compression + inserted;
      inserted += size.advanceM;
      return {
        ...loop, ...size, corridorS, playX0,
        entryX: playX0 + size.leadM,
        playX1: playX0 + size.advanceM,
      };
    });
  const playTotalM = playM + inserted;

  /** Metros de corredor bajo un punto del eje de juego. Meseta dentro de un rizo. */
  function corridorAt(playX) {
    let x = playX;
    for (const loop of loops) {
      if (x <= loop.playX0) break;
      if (x < loop.playX1) { x = loop.playX0; break; }
      x -= loop.advanceM;
    }
    return Math.max(0, Math.min(corridorM, x * compression));
  }

  /** Dónde cae en el eje de juego un kilómetro del corredor. */
  function playAt(km) {
    const corridorS = Math.max(0, Math.min(corridorM, (km - fromKm) * 1000));
    let x = corridorS / compression;
    for (const loop of loops) {
      if (loop.corridorS / compression < x - 1e-9) x += loop.advanceM;
    }
    return x;
  }

  /** Metros SOBRE EL SUELO, exagerados, con el origen en la salida: -y es arriba. */
  const toY = (elevM) => -(elevM - baseElevM) * exaggeration;

  const deckElevAt = (playX) => sampleAt(deck, corridorAt(playX) / spacingM);
  const groundElevAt = (playX) => sampleAt(ground, corridorAt(playX) / spacingM);

  return {
    id: level.id,
    level,
    corridorM,
    compression,
    exaggeration,
    baseElevM,
    playM,
    playTotalM,
    loops,
    corridorAt,
    playAt,
    toY,
    deckElevAt,
    groundElevAt,
    /** La cota del tablero en el marco del dibujo (metros, -y arriba). */
    deckY: (playX) => toY(deckElevAt(playX)),
    /** La cota del terreno en el mismo marco. */
    groundY: (playX) => toY(groundElevAt(playX)),
    /** Kilómetro del corredor, para el HUD y los mojones. */
    kmAt: (playX) => fromKm + corridorAt(playX) / 1000,
    /** Las estaciones, los puentes y las escenas, ya en el eje de juego. */
    stations: (level.stations || []).map((s) => ({ ...s, playX: playAt(s.km) })),
    structures: (level.structures || []).map((s) => ({
      ...s, playX0: playAt(s.fromKm), playX1: playAt(s.toKm),
    })),
    sceneCuts: (level.scenes || []).map((s) => ({ ...s, playX: playAt(s.km) })),
    fuelStops: (level.fuelKm || []).map((km) => ({ km, playX: playAt(km) })),
  };
}
