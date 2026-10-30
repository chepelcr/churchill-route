// Shared mutable game state + world-entity arrays.
// These are module singletons (one game instance) imported by the spawn,
// physics, delivery and render modules.
import { VEHICLES } from "./vehicles.js";
import { ARCADE_DURATION_S } from "./timers.js";

export const state = {
  running: false, paused: false, over: false, won: false,
  attract: false,           // menu attract mode: world lives, no player

  mode: "arcade",           // arcade | story | explore
  stageIdx: 0,              // index into WORLD.STAGES
  // WHICH PUNTARENAS RECORRER IS SHOWING — `ciudad` or `estero`, null in every
  // other mode. It is chosen at the menu because it decides the MEDIUM, and a
  // medium has to be known before the vehicle picker opens rather than after.
  exploreRealm: null,
  // EL PASAJE — los dos muelles del estero como UNA PUERTA, no como un barco.
  //
  // El norte del mapa no está conectado por tierra (una sola aproximación en
  // 600 px, y es un corte de 95 px), así que cruzar es la única forma de llegar.
  // No se navega ni se cambia de vehículo: se entra al muelle, se pregunta, y
  // una transición de agua deja al jugador del otro lado.
  //
  // `passageOffer` es el muelle en el que se está y que todavía no se ha
  // contestado; `passageMuelle` es en cuál se está, punto. La oferta sólo se
  // levanta al ENTRAR (muelle ahora, ninguno el cuadro pasado), y eso es lo
  // que hace que salir del agua no vuelva a preguntar en el acto — uno
  // desembarca ya parado encima. Hay que salirse y volver a entrar.
  //
  // `passage` es la transición misma, `{ phase, t }`, publicada por el sim y
  // dibujada por la UI.
  passageOffer: null, passageMuelle: null, passage: null,
  weather: "sunny",
  timeOfDay: 0.55,
  vehicleKey: "scooter", veh: VEHICLES.scooter,
  p: { x: 1500, y: 760, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 },
  // the renderer publishes zoom/vw/vh on cam — mutate it, never replace it
  cam: { x: 1500, y: 760, shake: 0 },
  carrying: null,
  pendingOrder: null,
  score: 0, combo: 1, comboTimer: 0,
  deliveries: 0, perfect: 0,
  // Arcade is the mode a cold boot lands in; an untimed run sets this to
  // UNTIMED (null) rather than to a large number nobody counts down.
  timeLeft: ARCADE_DURATION_S,
  storyTip: "",
  particles: [], floats: [],
  rainT: 0,
  // Active stage data
  stage: null,
  stageDeliveries: 0,
  stageTarget: 0,
  // Set at startup by game/index.js (loadProgress) and by mode starts.
  progress: null,
  barriers: [],
  // Free-roam district identity: the id of the band the player is currently in,
  // and a transient "you entered X" title card ({ id, name, tone, t } or null).
  district: null,
  districtToast: null,
  // Debug overlay: world-coordinate grid + live readout (persisted).
  debug: (() => { try { return localStorage.getItem("churchill_debug") === "1"; } catch (e) { return false; } })(),
  // 0..1 how far the car has climbed onto the raised barro avenue (ramps at
  // the intersections). Drives a visual lift in the renderer.
  elev: 0,
  //: LA COTA REAL BAJO EL CARRO, en metros — del campo del IGN, no de `elev`.
  //: Son dos cosas distintas y conviven a propósito: `elev` es un booleano por
  //: NOMBRE de calle que levanta el dibujo 7 px, y esto es el terreno.
  zM: 0,
  //: …y la pendiente FIRMADA en la dirección en que va el carro (dz/ds). Firmada
  //: y no magnitud: una cuesta que se siente igual de frente y de espaldas no es
  //: una cuesta. Suavizada, porque el campo se muestrea cada 32 m.
  grade: 0,
};

// ----- World entities (advanced by physics, drawn by the renderer) ----------
//: LAS ORDAS DE GAVIOTAS — bandadas posadas, no la gaviota ambiental del golfo.
//: Cada una es UNA entidad con su centro y sus pájaros, igual que un banco de
//: atún: si los pájaros fueran sueltos, «orda» sería sólo un contador más alto.
export const gullFlocks = [];
export const traffic = [];      // moving cars/buses/trucks on main roads
export const pedestrians = [];  // strollers on the paseo + aceras
export const gulls = [];        // seagulls over the water
export const boats = [];        // ferries + pangas offshore
export const parked = [];       // static cars along curbs
export const vendors = [];      // street vendor carts on the aceras
export const animals = [];      // dogs/cats wandering across streets
export const trains = [];       // the old Ferrocarril: loco + wagons on the rails
// Bancos de atún: a school working the surface out in the gulf with the pangas
// that found it turning around the edge of it. One entity, not two — a school
// and its fleet are the same event, they drift together, and splitting them
// into a shoal pool and a boat pool would let the boats wander off the fish.
export const schools = [];
// La mejenga: a game of fútbol playa on the sand. ONE entity per game rather
// than a pool of players and a pool of balls, for the same reason a school and
// its pangas are one — the players exist because the ball does, and splitting
// them would let a ball roll away from the game it belongs to.
export const beachGames = [];

export function pushFloat(x, y, text, color) {
  state.floats.push({ x, y, text, color, t: 0, ttl: 1.6 });
}
