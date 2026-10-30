// Game-mode starts (story / arcade / explore) and world setters.
import { WORLD2D as W } from "../world2d/index.js";
import { px } from "../domain/units.js";
import UNITS from "../assets/world-units.json" with { type: "json" };
import { EXPLORE_REALM, STAGE_KIND, VEHICLE_MEDIUM } from "../domain/vocabulary.generated.js";
import { state } from "./state.js";
import { VEHICLES, vehicleMedium } from "./vehicles.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats } from "./spawns.js";
import { esteroMuelles, ferries, muelleAt, resetFerries, routePoint } from "./ferries.js";
import { startCrossing, crossingCondition, resetCrossing } from "./crossing.js";
import { setTide } from "./tides.js";
import { forceStorm, setDayCycle } from "./daynight.js";
import { pickCustomer, pickCustomerNear } from "./delivery.js";
import { rebuildBarriers, bumpCrossingRuns } from "./progress.js";
import { initTutorial } from "./tutorial.js";
import { ARCADE_DURATION_S, DEFAULT_STAGE_DURATION_S, UNTIMED } from "./timers.js";
import { economy, FREE_VEHICLES } from "./economy.js";
import { t, stageBrief } from "../i18n/index.js";
import { analytics } from "../monetize/analytics.js";
import { resetEditorTriggers } from "./editorGameplay.js";
import { applyOwnedShopEffects, consumeEditorBoosts } from "./editorContent.js";

// Resolve the run vehicle: enforce ownership and apply the equipped paint by
// cloning — paintVehicle reads veh.color.
//
// THE FALLBACK IS PER MEDIUM, and that is not a nicety. It used to be the bare
// string "scooter", which is the right answer for every delivery in the game and
// the catastrophic one for the estero: a player who has not bought a boat would
// start the Travesía on a moped, inside a wall, in the middle of the water.
// FREE_VEHICLES is guaranteed to hold at least one entry per medium.
function freeVehicleFor(medium) {
  return FREE_VEHICLES.find((k) => vehicleMedium(k) === medium)
    || (medium === VEHICLE_MEDIUM.WATER ? "panga" : "scooter");
}
function resolveVehicle(key, medium = VEHICLE_MEDIUM.LAND) {
  const owned = economy.ownsVehicle(key) && vehicleMedium(key) === medium;
  const k = owned ? key : freeVehicleFor(medium);
  const col = economy.equippedColor(k);
  const painted = col ? { ...VEHICLES[k], color: col.hex } : VEHICLES[k];
  return { key: k, veh: applyOwnedShopEffects(k, painted, state.progress) };
}
//: the medium a run demands. A crossing stage is sailed; everything else driven.
export function stageMedium(stg) {
  return stg?.kind === STAGE_KIND.CROSSING
    ? VEHICLE_MEDIUM.WATER : VEHICLE_MEDIUM.LAND;
}

//: how far along the route the player's boat starts.
//: NOT at the berth cell itself: the berth is the SHORELINE — the last water
//: cell before the sand, chosen by the build so a ferry could lie alongside —
//: so starting exactly on it puts half the hull in a wall and the solver spends
//: the opening second shoving her off the beach. A little way out is clear
//: water on a line the build already proved navigable.
//:
//: PERO SOBRE TODO TIENE QUE DEJAR ATRÁS A LA LANCHA, y eso es lo que era un
//: `70` a secas. La lancha del estero está atracada en `dockOffsetM` sobre esta
//: misma ruta y su cubierta mide `deckLengthM`, así que su proa llega a
//: 8 + 34.4/2 = 25.2 m. El 70 px valía 28 m — la libraba por dos metros y
//: medio, sin que nada lo dijera.
//:
//: El reescalado a 3.125 px/m del 2026-08-27 se llevó ese margen por delante:
//: 70 px pasaron a ser 22.4 m, o sea DENTRO de ella. Y estar dentro no es un
//: detalle: `startStage` manda la lancha a la otra orilla con
//: `crossingFerry.s = total`, el jugador cuenta como embarcado y `carry()` se lo
//: lleva 15 000 px de un cuadro. Medido: la Travesía se daba por ganada en el
//: primer cuadro, con `progress` 0.997 y `over` true antes de tocar una tecla.
//:
//: Así que se DERIVA de la lancha en vez de escribirse: proa + un margen. Al
//: 2.5 de siempre da los mismos 70 px, que es lo que hace el arreglo
//: demostrable.
const START_OUT_M = UNITS.vessels.lancha.dockOffsetM
  + UNITS.vessels.lancha.deckLengthM / 2 + 2.8;
const START_OUT_PX = px(START_OUT_M);

/** The player's pose on the start line of a crossing, or null if there is no
 *  route to start on.
 *
 *  NULL IS A REAL ANSWER, not a defensive habit. A lancha only reaches the
 *  manifest if the build's water flood found a navigable line between her two
 *  ends; when it does not, `place_lanchas` warns and emits no ferry at all. So
 *  a crossing stage can legitimately ship pointing at a boat that is not there,
 *  and reading `.x` off the undefined it resolves to threw a TypeError inside
 *  `startStage` — which is the freeze-shaped failure this codebase keeps
 *  getting bitten by, from a world change nobody would think to re-test the UI
 *  against. */
function startAtBerth(f) {
  if (!f || !f.pts || f.pts.length < 2) return null;
  const q = routePoint(f, START_OUT_PX);
  return { x: q.x, y: q.y, a: q.a };
}

/** La lancha del estero: la única ruta de un solo sentido que el mundo emite.
 *
 *  Se pregunta por su CONDUCTA y no por su id. Los dos ferris del golfo son
 *  `doubleEnded` y hacen ida y vuelta con horario; la del estero deja al
 *  pasajero en la otra orilla y se queda ahí, que es lo que `oneWay` dice.
 *  Buscarla por `"pitahaya"` habría atado el modo al nombre de un trayecto de
 *  OSM — y `content/world/ferries.json` existe precisamente para que ese
 *  nombre sea contenido editable. */
function oneWayFerry() {
  return ferries().find((f) => f.oneWay) || null;
}

// ---- Recorrer: el estero es un DESTINO, no un trasbordo -------------------
//
// Aquí vivían `takeTheLancha`, `leaveTheLancha` y la oferta del muelle: parquear
// en el atracadero abría un selector de lanchas, y aceptar arrancaba
// `startCrossing` — o sea la Travesía entera, con sus boyas, sus portones y su
// director de carrera — en medio de un modo que no tiene reloj. Uno salía a
// pasear por el puerto y terminaba corriendo una regata que no había pedido, y
// la única forma de no correrla era no parquear ahí.
//
// El estero es hoy la otra mitad de Recorrer y se escoge en el menú, con su
// propio selector de cascos. Eso borra las dos razones por las que el trasbordo
// existía —elegir el barco y llegar al agua— así que se fue entero, y con él
// `state.landVehicleKey`: ya no hay un carro guardado que devolver, porque
// quien sale al estero salió al estero.
//
// ---- El pasaje: los dos muelles son UNA PUERTA ----------------------------
//
// Lo que quedaba sin resolver es que el norte —Pitahaya y toda la tierra firme
// de esa orilla— **no está conectado por tierra**. Medido sobre el mundo
// emitido: la red manejable tiene 69 componentes, el norte es la #3 (162 945
// celdas) y la península la #4 (4 228 466), y en 600 px a la redonda se acercan
// en UN solo punto — un corte de 95 px al final de la Calle del Arreo. Sin algo
// que cruce, esa mitad del mapa se ve y no se llega.
//
// Y lo que cruza NO ES UN BARCO. No se navega, no se aborda, no se cambia de
// vehículo y no hay una lancha que esperar: se entra al muelle, se pregunta, y
// el agua tapa la pantalla y lo deja a uno del otro lado. Es una PUERTA entre
// dos puntos del mapa con una transición encima, y decirlo así es lo que evita
// que vuelva a crecer hasta ser la regata que se borró aquí arriba.
//
// La ruta de la lancha del estero se usa sólo por su GEOMETRÍA: sus dos
// extremos son los dos muelles, ya resueltos por el build contra la costa de
// verdad. Es de donde sale dónde están las puertas, no qué las cruza.

/**
 * Cruzar: del muelle en el que se está al del otro lado.
 *
 * ES ASÍNCRONA, Y ESO NO ES UN DETALLE. El otro lado está a 15 000 px y no está
 * en memoria; `surfaceAt` contesta AGUA para todo tile que no ha llegado, así
 * que buscar el desembarcadero antes de esperar el streaming es preguntarle a
 * un mapa en blanco. La primera versión lo hacía —`W.ready()` devuelve una
 * promesa y nadie la esperaba— y `reachablePointNear` devolvía el propio punto
 * de la ruta con clase 0: el carro salía del agua dentro del agua. Lo cazó
 * `smoke:passage` y no se ve en ninguna captura, porque el mundo termina de
 * cargar un segundo después y para entonces el carro ya está mal puesto.
 *
 * Se espera con la cortina de agua arriba, que es justo para lo que sirve.
 *
 * SALE EN SUELO MANEJABLE, no en el punto de la ruta: el extremo de la ruta es
 * la ORILLA —la última celda de agua antes de la tierra, donde un casco puede
 * arrimarse— y dejar ahí un carro lo deja medio dentro de una pared.
 * `reachablePointNear` encuentra la rampa que el build pavimentó.
 *
 * Devuelve a dónde salió, o null si no se estaba en un muelle o si no hay suelo
 * al que salir. NULL ES UNA RESPUESTA: mejor no cruzar que aparecer flotando en
 * tierra firme, y quien llama tiene que decirlo.
 */
export async function crossTheEstero() {
  const ms = esteroMuelles();
  const here = muelleAt(state.p.x, state.p.y);
  if (!ms || here < 0) return null;
  const q = ms[here === 0 ? 1 : 0];
  // LA CÁMARA VA PRIMERO, y ése es el arreglo entero. El lazo de dibujo llama
  // a `W.update(cam)` en CADA cuadro y esa función además EVICTA todo tile a
  // más de cinco de la cámara. Con la cámara todavía en Puntarenas, los tiles
  // de Pitahaya que este `await` acababa de traer se los llevaba el cuadro
  // siguiente, antes de que `reachablePointNear` pudiera leerlos — y como es
  // una carrera contra el lazo, fallaba una vez de cada dos. Movida la cámara,
  // el propio lazo los mantiene. No se ve nada raro: el mundo está en pausa y
  // el agua tapa la pantalla.
  const home = { x: state.cam.x, y: state.cam.y };
  state.cam.x = q.x; state.cam.y = q.y;
  W.update(q.x, q.y);
  await W.ready(q.x, q.y, state.cam.vw || 1600, state.cam.vh || 1000);
  const spot = W.reachablePointNear(q.x, q.y, 640);
  if (!spot) { state.cam.x = home.x; state.cam.y = home.y; return null; }
  state.p.x = spot.x; state.p.y = spot.y; state.p.a = q.a;
  state.p.vx = 0; state.p.vy = 0; state.p.speed = 0; state.p.drift = 0;
  state.cam.x = spot.x; state.cam.y = spot.y; state.cam.shake = 0;
  // Se llega parado ENCIMA del muelle de destino, así que hay que decirlo o la
  // oferta se levantaría en el cuadro siguiente y preguntaría otra vez. Hay que
  // salirse y volver a entrar, que es la regla que pidió el diseño.
  state.passageMuelle = here === 0 ? 1 : 0;
  state.passageOffer = null;
  state.district = null; state.districtToast = null;   // la otra orilla se anuncia sola
  return { x: spot.x, y: spot.y };
}

export function declinePassage() { state.passageOffer = null; }

// Player start beside a kiosk: use the build-authored `spawn` (snapped to the
// nearest drivable street), never the kiosk's beach-facing icon position — that
// dropped the car onto the sand beside sand kiosks.
function spawnAtKiosk(k) {
  // NULL IS REACHABLE. A crossing stage carries `kiosks: []`, so if its ferry
  // fails to resolve the fallback path arrives here with `landmarkById(undefined)`
  // — and the old `{ x: k.x - 60 }` threw a TypeError out of `startStage`
  // itself, which is the freeze-shaped failure this codebase keeps meeting.
  if (!k) return null;
  const sp = k.spawn;
  return sp ? { x: sp[0], y: sp[1] } : { x: k.x - 60, y: k.y };
}
function editorPlayer(mode) {
  return W.EDITOR_FEATURES.find((feature) => {
    if (!["player", "spawn"].includes(feature.type) || feature.geometry?.kind !== "point") return false;
    const playerMode = feature.properties?.playerMode || "all";
    return playerMode === "all" || playerMode === mode;
  }) || null;
}
function authoredSpawn(mode, fallback, explicit = null) {
  if (explicit && Number.isFinite(explicit.x) && Number.isFinite(explicit.y)) return explicit;
  const feature = editorPlayer(mode);
  if (!feature) return fallback;
  return {
    x: feature.geometry.point[0],
    y: feature.geometry.point[1],
    a: (Number(feature.properties?.angle) || 0) * Math.PI / 180,
  };
}
function authoredVehicle(mode, requested) {
  return requested || editorPlayer(mode)?.properties?.vehicleKey || state.vehicleKey;
}
function authoredWeather(fallback = "sunny") {
  return W.EDITOR_CONTENT?.world?.weather?.default || fallback;
}
// Run-start economy state: reset the run wallet and consume any armed boosts
// (picked in the vehicle picker; each is one use).
function armRun() {
  state.runCoins = 0;
  state.icepackT = 0; state.headstartT = 0;
  const armed = state.armedBoosts || {};
  if (armed.icepack && economy.useBoost("icepack")) state.icepackT = 30;
  if (armed.headstart && economy.useBoost("headstart")) state.headstartT = 5;
  consumeEditorBoosts(
    Object.fromEntries(Object.entries(armed).filter(([id]) => id !== "icepack" && id !== "headstart")),
    economy,
    state,
  );
  state.armedBoosts = null;
}

export function startStage(stageIdx, vehicleKey) {
  resetCrossing();
  const stg = W.STAGES[stageIdx];
  state.stage = stg;
  state.stageIdx = stageIdx;
  state.mode = "story";
  // EL ENCUADRE DEL NIVEL. Una etapa puede pedir que su cámara vaya girada: El
  // Cocal corre a lo largo del arenal, que es horizontal, y de canto llena la
  // pantalla en vez de cruzarla. Es de la CÁMARA, no del mundo — ninguna
  // coordenada cambia — y se limpia al salir, o el giro se filtra al siguiente.
  state.cam.rot = (stg.rotate || 0) * Math.PI / 180;
  applyWeather(stg.weather, { hold: true });
  setDayCycle(false);          // a stage's sky is part of its brief
  // …EXCEPT THE TRAVESÍA, whose sky and tide ARE the brief. The estero is a
  // different course at bajamar than at pleamar and a different one again in an
  // aguacero, so the crossing rotates through its four conditions by attempt
  // rather than naming one in the world. The day clock still stays off: a
  // three-minute run that cycled the whole day would strobe, and the point is
  // that this run has an hour, not that it has all of them.
  const crossCond = stg.kind === STAGE_KIND.CROSSING
    ? crossingCondition(bumpCrossingRuns(stg.id)) : null;
  if (crossCond) {
    state.weather = crossCond.weather;
    setTide(crossCond.tide);
  } else {
    setTide(0.5);
  }
  state.timeLeft = stg.timeLimit ?? DEFAULT_STAGE_DURATION_S;
  state.stageDeliveries = 0;
  state.stageTarget = stg.targetDeliveries;
  const rv = resolveVehicle(authoredVehicle("story", vehicleKey), stageMedium(stg));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  // A CROSSING STAGE STARTS AT THE BERTH, AS THE BOAT. There is no kiosk to
  // spawn beside and no delivery to make: the level is the estero, and the
  // player IS the lancha — a water-medium vehicle out of the picker, not a car
  // parked on somebody else's deck. The berth and the heading still come from
  // the world's ferry record, because that is where the build put the muelle.
  const crossingFerry = stg.kind === STAGE_KIND.CROSSING
    ? ferries().find((f) => f.id === stg.ferry) : null;
  let sp;
  if (crossingFerry) {
    // EL ATRACADERO ES UN PUNTO DE LA RUTA, NO DONDE ESTÉ LA LANCHA AHORA.
    //
    // Esto leía `crossingFerry.x/y`, que es su pose VIVA — la lancha navega y
    // esos campos se reescriben cada cuadro. `resetFerries()` la manda a casa,
    // pero se llama TREINTA LÍNEAS MÁS ABAJO, después de colocar al jugador.
    // La primera vez no se nota porque arranca atracada; a la SEGUNDA —o sea al
    // reintentar la etapa, que es lo que hace cualquiera que la pierda— el
    // jugador aparecía donde la lancha se hubiera quedado. Medido: reintentando
    // la Travesía salías en (31327,2423), a 45 px del desembarcadero, con la
    // etapa dada por ganada en el primer cuadro (`progress` 0.997, `over` true).
    //
    // `routePoint(f, f.dock)` es exactamente lo que `resetFerries` va a
    // escribir, así que da la misma pose SIN depender del orden de llamada.
    const q = routePoint(crossingFerry, crossingFerry.dock);
    sp = authoredSpawn("story", q);
  } else {
    // place player near first kiosk of stage (on its street-snapped spawn)
    const k = W.landmarkById((stg.kiosks || [])[0]);
    sp = authoredSpawn("story", spawnAtKiosk(k));
  }
  // Last resort: a stage that resolved neither a boat nor a kiosk still has to
  // put the player SOMEWHERE, because everything below dereferences the pose.
  if (!sp) sp = { x: state.p?.x || W.W * 0.5, y: state.p?.y || W.H * 0.5, a: 0 };
  state.p = { x: sp.x, y: sp.y, a: sp.a || 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  // mutate cam, never replace: the renderer publishes zoom/vw/vh on it
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = stageBrief(stg);
  rebuildBarriers(); // MVP wall (story has no progression barriers)
  state.district = null; state.districtToast = null;
  state.tutorial = null;
  // prime the streamed world on the spawn area so surfaces are resident before
  // the first physics/render frame (tiles keep loading via update() in the loop)
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
  if (crossingFerry) {
    // THE LANCHA HERSELF IS SENT AWAY. She used to be the thing you rode, and
    // leaving her sitting on the start line would put a 86x34 px hull on top of
    // the player's own boat — she is scenery at the far shore now, where the
    // real one waits between passages.
    crossingFerry.phase = "docked";
    crossingFerry.far = true;
    crossingFerry.s = crossingFerry.total;   // advanceFerries re-poses her there
    const nudge = startAtBerth(crossingFerry);
    if (nudge) {
      state.p.x = nudge.x; state.p.y = nudge.y; state.p.a = nudge.a;
      state.cam.x = state.p.x; state.cam.y = state.p.y;
    }
    startCrossing(crossingFerry, { level: true });
  } else if (stg.kind === STAGE_KIND.CROSSING) {
    // The stage says "sail to Pitahaya" and the world shipped no boat to sail:
    // the build could not find navigable water between the two ends and warned
    // instead of emitting a ferry. Say so, once, where somebody will see it —
    // and leave the run standing rather than throwing out of the mode start.
    console.warn(`[crossing] stage ${stg.id} wants ferry '${stg.ferry}', which this world does not contain`);
    state.storyTip = stageBrief(stg);
  } else {
    pickCustomer();
  }
  analytics.track("run_start", { mode: "story", stage_id: stg.id, vehicle: state.vehicleKey });
}

export function startArcade(opts = {}) {
  resetCrossing();
  state.stage = null;
  state.cam.rot = 0;
  state.stageIdx = 0;
  state.mode = "arcade";
  // ARCADE PICKS ITS SKY. Three minutes is shorter than any phase of the day,
  // so a cycle here would either never turn or strobe; the run says what it
  // wants and keeps it. `cycle` is offered for anyone who wants the turn.
  applyWeather(opts.weather || authoredWeather());
  setDayCycle(Boolean(opts.cycle), opts.dayAt ?? 0);
  state.timeLeft = ARCADE_DURATION_S;
  const rv = resolveVehicle(authoredVehicle("arcade", opts.vehicleKey));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  const k0 = W.landmarkById("kios_paseo1");
  { const _sp = authoredSpawn("arcade", spawnAtKiosk(k0)); state.p = { x: _sp.x, y: _sp.y, a: _sp.a || 0, vx: 0, vy: 0, speed: 0, drift: 0 }; }
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = t("tip.arcade");
  rebuildBarriers(); // MVP wall (arcade has no progression barriers)
  state.district = null; state.districtToast = null;
  state.tutorial = null;
  // prime the streamed world on the spawn area so surfaces are resident before
  // the first physics/render frame (tiles keep loading via update() in the loop)
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
  pickCustomer();
  analytics.track("run_start", { mode: "arcade", vehicle: state.vehicleKey });
}

/**
 * RECORRER — y son DOS Puntarenas, no dos modos.
 *
 * `ciudad` es lo de siempre: la península en carro, sin reloj, con el día
 * dando la vuelta. `estero` es la otra mitad del mismo lugar, en lancha, desde
 * la boca del estuario hacia adentro.
 *
 * Lo que el realm decide es el MEDIO, y por eso se escoge en el menú y no aquí:
 * el selector de vehículos tiene que abrir ya sabiendo si ofrece carros o
 * cascos. Todo lo demás —el reloj (ninguno), el marcador, el ciclo del día, la
 * analítica— es idéntico en las dos mitades, que es exactamente la razón por la
 * que esto NO es un quinto `GameMode`: partirlo habría bifurcado cada una de
 * esas ramas para decir dos veces lo mismo.
 */
export function startExplore(opts = {}) {
  resetCrossing();
  state.stage = null;
  state.cam.rot = 0;
  state.stageIdx = 0;
  state.mode = "explore";
  const realm = opts.realm === EXPLORE_REALM.ESTERO
    ? EXPLORE_REALM.ESTERO : EXPLORE_REALM.CIUDAD;
  state.exploreRealm = realm;
  const afloat = realm === EXPLORE_REALM.ESTERO;
  // RECORRER GETS A DAY. Ten real minutes for a full turn — sunny, atardecer,
  // night, amanecer — with a storm rolling in now and then and handing the sky
  // back where it left off. An explicit `weather` still wins: asking for one
  // and getting a cycle would be a bug, not a feature.
  applyWeather(opts.weather || authoredWeather());
  setDayCycle(!opts.weather, Math.random());
  state.timeLeft = UNTIMED;
  // EL MEDIO SALE DEL REALM, y `resolveVehicle` lo hace cumplir: quien no tiene
  // lancha sale en la panga y no en la moto, que es la diferencia entre
  // empezar en el agua y empezar dentro de una pared.
  const rv = resolveVehicle(authoredVehicle("explore", opts.vehicleKey),
                            afloat ? VEHICLE_MEDIUM.WATER : VEHICLE_MEDIUM.LAND);
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  // Spawn on the faro muelle by default. The world editor may provide an exact
  // generated-world point for a one-click playtest.
  const editorSpawn = Number.isFinite(opts.x) && Number.isFinite(opts.y)
    ? { x: opts.x, y: opts.y }
    : null;
  // EL ESTERO ARRANCA EN LA BOCA, sobre la misma línea de salida que la
  // Travesía — `startAtBerth` ya sabe dejar atrás a la lancha atracada, que es
  // el margen que la etapa aprendió a las malas. Un `authoredSpawn` de la
  // ciudad aquí sería un casco en medio del Paseo.
  const esteroFerry = afloat ? oneWayFerry() : null;
  const esteroStart = esteroFerry ? startAtBerth(esteroFerry) : null;
  const kf = W.landmarkById("kios_faro"), f0 = W.landmarkById("faro");
  const fallback = (kf && kf.spawn) ? { x: kf.spawn[0], y: kf.spawn[1] } : null;
  const sp = esteroStart || authoredSpawn("explore", fallback, editorSpawn);
  state.p = sp ? { x: sp.x ?? sp[0], y: sp.y ?? sp[1], a: sp.a ?? opts.angle ?? 0, vx: 0, vy: 0, speed: 0, drift: 0 }
               : { x: f0.x + 60, y: f0.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = afloat ? t("tip.estero")
    : t("tip.explore", { n: state.progress.unlocked.length });
  rebuildBarriers();
  state.district = null; state.districtToast = null;
  state.tutorial = null;
  // prime the streamed world on the spawn area so surfaces are resident before
  // the first physics/render frame (tiles keep loading via update() in the loop)
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
  // EL ESTERO NO REPARTE. Los clientes están todos en tierra —medido: cero al
  // norte de la mitad de la ruta— así que darle un destino a quien va en lancha
  // es apuntarlo a una casa a la que su casco no llega. Lo que sí tiene el
  // estuario es la vida que `startCrossing` siembra: las boyas como marcas de
  // navegación, las pangas, los cardúmenes, las gaviotas y los remolinos.
  //
  // `level: false` es lo que lo mantiene un LUGAR y no una regata: sin
  // portones, sin contramano, sin hundirse a las tres, sin marcador. Ese
  // camino ya existía porque el trasbordo del muelle lo usaba; lo que cambió es
  // que ahora se escoge, en vez de aparecer por parquear en el sitio equivocado.
  if (afloat) { if (esteroFerry) startCrossing(esteroFerry, { level: false }); }
  else pickCustomer();
  analytics.track("run_start", { mode: "explore", realm, vehicle: state.vehicleKey });
}

// Tutorial: timerless guided run at the Paseo kiosk; the step machine in
// tutorial.js drives the HUD instructions and ends the run when complete.
export function startTutorial(opts = {}) {
  resetCrossing();
  state.stage = null;
  state.cam.rot = 0;
  state.stageIdx = 0;
  state.mode = "tutorial";
  state.weather = "sunny";
  state.timeLeft = UNTIMED;
  const rv = resolveVehicle(authoredVehicle("tutorial", opts.vehicleKey));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  const k0 = W.landmarkById("kios_paseo1");
  { const _sp = authoredSpawn("tutorial", spawnAtKiosk(k0)); state.p = { x: _sp.x, y: _sp.y, a: _sp.a || 0, vx: 0, vy: 0, speed: 0, drift: 0 }; }
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = "";
  rebuildBarriers();
  state.district = null; state.districtToast = null;
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
  pickCustomerNear(k0.x, k0.y); // short, predictable first delivery
  initTutorial();
  analytics.track("run_start", { mode: "tutorial", vehicle: state.vehicleKey });
}

/**
 * PONER EL CLIMA, y que el clima OCURRA.
 *
 * Era `state.weather = …` en tres sitios, y para «storm» eso sólo cambiaba el
 * nombre: la lluvia, los relámpagos, el agarre mojado y el alumbrado de día
 * cuelgan todos de la RAMPA (`cycle.storm`), que nadie arrancaba. La etapa
 * `s5 Tormenta en El Cocal` llevaba así desde que existe — con la paleta de
 * tormenta y ni una gota.
 */
function applyWeather(w, opts = {}) {
  state.weather = w;
  if (w === "storm") forceStorm(opts);
}

export function setWeather(w) { state.weather = w; }
export function setVehicle(k) {
  // Honour the medium the KEY asks for, not the run's: this is the picker and
  // the console setter, and both are choosing a vehicle rather than a stage.
  const rv = resolveVehicle(k, vehicleMedium(k));
  state.vehicleKey = rv.key; state.veh = rv.veh;
}
