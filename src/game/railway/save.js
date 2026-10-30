// EL PROGRESO FERROVIARIO, APARTE DE LA ECONOMÍA DEL JUEGO.
//
// Las fichas del Tren al Puerto no son los colones de las entregas de churchill,
// y mezclarlas sería decidir hoy un diseño de economía que todavía no está
// decidido. Viven en su propia llave, con su propia versión, y la clave es `v2`
// porque `churchill.railway.v1` guardaba el récord del recorrido de prueba
// —`valley-run`— que ya no existe: un save viejo no puede hacer que el garaje
// aparezca con un tren que el catálogo no tiene.
//
// TODO LO QUE ENTRA SE VALIDA CONTRA EL REGISTRO, no contra sí mismo. Un
// `localStorage` es entrada del usuario: una mejora en el nivel 90, un tren
// comprado que ya no está en el catálogo o `coins: NaN` tienen que salir
// saneados y no romper una pantalla.
import { clampLevel } from "./stats.js";

const KEY = "churchill.railway.v2";

function blank(catalog) {
  const first = catalog.trains[0];
  return {
    coins: catalog.economy.startCoins,
    owned: [first.id],
    train: first.id,
    upgrades: {},
    levels: {},
  };
}

/** El progreso saneado. Nunca lanza: una pantalla de menú no se cae por un save. */
export function loadProgress(catalog, storage = safeStorage()) {
  const base = blank(catalog);
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(KEY) || "null"); } catch { raw = null; }
  if (!raw || typeof raw !== "object") return base;
  const ids = new Set(catalog.trains.map((t) => t.id));
  const owned = Array.isArray(raw.owned)
    ? catalog.trains.filter((t) => raw.owned.includes(t.id) || t.price === 0).map((t) => t.id)
    : base.owned;
  const upgrades = {};
  for (const id of owned) {
    const saved = raw.upgrades?.[id];
    if (!saved || typeof saved !== "object") continue;
    const row = {};
    for (const ladder of catalog.upgrades.ladders) {
      const level = clampLevel(saved[ladder.id], catalog);
      if (level) row[ladder.id] = level;
    }
    if (Object.keys(row).length) upgrades[id] = row;
  }
  const levels = {};
  for (const level of catalog.campaign) {
    const saved = raw.levels?.[level];
    if (!saved || typeof saved !== "object") continue;
    const best = Number(saved.bestS);
    const stars = Number(saved.stars);
    levels[level] = {
      bestS: Number.isFinite(best) && best > 0 ? best : null,
      stars: Number.isFinite(stars) ? Math.max(0, Math.min(3, Math.floor(stars))) : 0,
      cleared: !!saved.cleared,
    };
  }
  return {
    coins: Number.isFinite(raw.coins) && raw.coins >= 0 ? Math.floor(raw.coins) : base.coins,
    owned,
    train: ids.has(raw.train) && owned.includes(raw.train) ? raw.train : owned[0],
    upgrades,
    levels,
  };
}

export function saveProgress(progress, storage = safeStorage()) {
  try { storage?.setItem(KEY, JSON.stringify(progress)); } catch { /* modo privado */ }
  return progress;
}

/** Lo que una partida terminada deja en el progreso. Devuelve un objeto NUEVO:
 *  la pantalla lo compara para saber si hubo récord o primer despeje. */
export function applyResult(progress, levelId, result, economy) {
  const before = progress.levels[levelId] || { bestS: null, stars: 0, cleared: false };
  const first = result.arrived && !before.cleared;
  const bestS = result.arrived
    ? (before.bestS === null ? result.elapsed : Math.min(before.bestS, result.elapsed))
    : before.bestS;
  return {
    ...progress,
    coins: progress.coins + result.reward + (first ? economy.firstClearBonus : 0),
    levels: {
      ...progress.levels,
      [levelId]: { bestS, stars: Math.max(before.stars, result.stars), cleared: before.cleared || result.arrived },
    },
    _firstClear: first,
  };
}

/** Comprar una máquina. Devuelve el progreso igual si no alcanza: quien llama
 *  no tiene que repetir la condición para saber si pasó algo. */
export function buyTrain(progress, train) {
  if (progress.owned.includes(train.id) || progress.coins < train.price) return progress;
  return {
    ...progress,
    coins: progress.coins - train.price,
    owned: [...progress.owned, train.id],
    train: train.id,
  };
}

/** Subir una barra un escalón. */
export function buyUpgrade(progress, trainId, ladder, catalog) {
  const level = clampLevel(progress.upgrades[trainId]?.[ladder.id], catalog);
  if (level >= catalog.upgrades.maxLevel) return progress;
  const cost = ladder.costs[level];
  if (progress.coins < cost) return progress;
  return {
    ...progress,
    coins: progress.coins - cost,
    upgrades: {
      ...progress.upgrades,
      [trainId]: { ...(progress.upgrades[trainId] || {}), [ladder.id]: level + 1 },
    },
  };
}

function safeStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
