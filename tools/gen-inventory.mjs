// gen-inventory.mjs — `pnpm inventory`
//
// Produces inventory.json: a machine-readable catalog of every game element
// (districts, stages, vehicles, landmarks, customers, surfaces, parcels) plus
// counts from the generated world and a map of the source modules with their
// exports. Lets us track what's in the game without reading all the code.
//
// Reads the SHIPPED world — src/world2d/manifest.json + its tiles — the same
// data the game streams. (It used to import the corridor src/world/data.js,
// which the game stopped reading when the planar world shipped, so the
// inventory described a world nobody was playing.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VEHICLES } from "../src/game/vehicles.js";
import { SURFACE_MUL, SURFACE_CLASSES } from "../src/game/surfaces.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD2D = path.join(ROOT, "src", "world2d");

const M = JSON.parse(fs.readFileSync(path.join(WORLD2D, "manifest.json"), "utf8"));

const tally = (arr, key) => {
  const out = {};
  for (const it of arr || []) { const k = it[key] ?? "?"; out[k] = (out[k] || 0) + 1; }
  return out;
};

// ---- Per-tile features ------------------------------------------------------
// Roads, buildings and flora live in the tiles, not the manifest, and anything
// straddling a tile border is DUPLICATED into every tile it overlaps — so a
// plain sum over-counts. Identity is the feature's own geometry.
function scanTiles() {
  const roads = new Map();
  const seen = { buildings: new Set(), palms: new Set(), trees: new Set(), mangroves: new Set() };
  const key = (a) => `${a[0]},${a[1]},${a.length}`;
  for (const name of fs.readdirSync(path.join(WORLD2D, "tiles"))) {
    if (!name.endsWith(".json")) continue;
    const t = JSON.parse(fs.readFileSync(path.join(WORLD2D, "tiles", name), "utf8"));
    for (const r of t.roads || []) roads.set(`${r.cls}|${r.w}|${key(r.pts)}`, r.cls);
    for (const group of ["buildings", "palms", "trees", "mangroves"]) {
      for (const f of t[group] || []) {
        seen[group].add(f.pts ? key(f.pts) : `${f.x},${f.y},${f.s ?? ""}`);
      }
    }
  }
  return {
    roads: roads.size,
    roadsByClass: [...roads.values()].reduce((o, c) => ((o[c] = (o[c] || 0) + 1), o), {}),
    buildings: seen.buildings.size,
    palms: seen.palms.size,
    trees: seen.trees.size,
    mangroves: seen.mangroves.size,
  };
}
const tiles = scanTiles();
const distinct = (arr, key) => [...new Set((arr || []).map((item) => item[key]).filter(Boolean))].sort();

// ---- Source-module map: filename -> { lines, exports[] } --------------------
function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full));
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}
function extractExports(src) {
  const names = new Set();
  const re1 = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/g;
  const re2 = /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g;
  const re3 = /export\s*\{([^}]*)\}/g;
  let m;
  while ((m = re1.exec(src))) names.add(m[1]);
  while ((m = re2.exec(src))) names.add(m[1]);
  while ((m = re3.exec(src))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && name !== "from") names.add(name);
    }
  }
  if (/export\s+default\s+(?:function|class|\()/.test(src) || /export\s+default\s+[A-Za-z]/.test(src)) {
    names.add("default");
  }
  return [...names].sort();
}
const modules = {};
for (const f of listFiles(path.join(ROOT, "src")).sort()) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, "utf8");
  modules[rel] = { lines: src.split("\n").length, exports: extractExports(src) };
}

// ---- Inventory --------------------------------------------------------------
//: Every versioned registry in the game, with who reads it. The `reads` line is
//: the useful half: a registry with one consumer is a config file, and a
//: registry with three is a contract.
const REGISTRIES = [
  { id: "surfaces", path: "src/assets/surfaces.json", reads: "game, Pixi, dev viewer, debug_render.py, editor",
    count: (d) => Object.keys(d.surfaces || {}).length },
  { id: "vehicles", path: "src/assets/vehicles.json", reads: "game, shop, picker, inventory",
    count: (d) => Object.keys(d.vehicles || {}).length },
  { id: "materials", path: "src/assets/materials.json", reads: "canvas, minimap, editor" },
  { id: "world-props", path: "src/assets/world-props.json", reads: "canvas (landmarks, signs, parcels)" },
  //: EL COLOR DE UN EDIFICIO POR LO QUE EL EDIFICIO ES. La llave es `cat` —la
  //: categoría de OSM que el mundo ya emitía sin que nadie la usara— y NO la
  //: etiqueta `building`, que en esta ventana dice `yes` en 571 de 635 huellas
  //: con nombre. Se resuelve en el cliente, así que reteñir el puerto no cuesta
  //: una reconstrucción.
  { id: "building-styles", path: "src/assets/building-styles.json",
    reads: "canvas structures (paintBuilding), editor",
    count: (d) => Object.keys(d.byCat || {}).length },
  { id: "water", path: "src/assets/water.json", reads: "canvas water + the backend ownership registry" },
  { id: "world-units", path: "src/assets/world-units.json", reads: "builder (px()), game (domain/units.js), editor" },
  { id: "effects", path: "src/assets/effects.json", reads: "canvas entities, editor",
    count: (d) => Object.keys(d.vehicle || {}).filter((k) => !k.startsWith("_")).length },
  { id: "audio", path: "src/assets/audio.json", reads: "game audio, render-audio.mjs, editor",
    count: (d) => Object.keys(d.recipes || {}).filter((k) => !k.startsWith("_")).length },
  { id: "actors", path: "src/assets/actors.json", reads: "canvas entities (peds, traffic, boats, coins, cargo), editor",
    count: (d) => Object.keys(d.actors || {}).length },
  { id: "lights", path: "src/assets/lights.json", reads: "canvas lights (editor features + field towers), editor",
    count: (d) => Object.keys(d.types || {}).length },
  { id: "hud", path: "src/assets/hud.json", reads: "canvas HUD + minimap" },
  { id: "flora", path: "src/assets/flora.json", reads: "builder, canvas flora" },
  //: LOS SPRITES: la vía para que un lugar CONCRETO use una imagen en vez de
  //: dibujarse. Todo lo demás del arte es vectorial y para casi todo eso es lo
  //: correcto; lo que el vector no cubre es un edificio que uno quiere que sea
  //: ESE edificio. Se mide en METROS, y `casa_prueba` se queda porque un verbo
  //: que nada ejercita es un verbo roto que nadie ve.
  { id: "sprites", path: "src/assets/sprites.json", reads: "canvas (el verbo `sprite`), editor",
    count: (d) => Object.keys(d.sprites || {}).filter((k) => !k.startsWith("_")).length },
  { id: "feria", path: "src/render/c2d/feriaAssets.json", reads: "canvas attractions" },
  { id: "npc-types", path: "src/game/npcTypes.json", reads: "spawns, editor",
    count: (d) => (d.types || []).length },
  { id: "economy", path: "src/content/economy.json", reads: "wallet, shop, IAP" },
  { id: "simulation", path: "src/content/simulation.json", reads: "spawns, buses, daynight, tides" },
  { id: "progression", path: "src/content/progression.json", reads: "tutorial, progress, modes",
    count: (d) => (d.tutorial?.steps || []).length },
  { id: "services", path: "src/content/services.json", reads: "ads, IAP, analytics, remote content" },
  { id: "screens", path: "src/ui/screens.json", reads: "App screens",
    count: (d) => Object.keys(d.screens || {}).length },
  { id: "theme-tokens", path: "src/ui/themeTokens.json", reads: "styles.css, editor theme form",
    count: (d) => (d.tokens || []).length },
  { id: "vocabulary", path: "src/assets/vocabulary.generated.json", reads: "game + editor (GENERATED)",
    count: (d) => Object.keys(d.enums || {}).length },
  //: The BUNDLED default of the runtime content block — sponsors, the theme,
  //: authored copy and sounds. It is what ships when `content.json` cannot be
  //: fetched, so it is the offline half of the one thing this game does not
  //: compile into its bundle.
  { id: "content-default", path: "src/content/default.json", reads: "remote.js, as the offline fallback" },
];

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
  catch { return null; }
}

const vocab = readJson("src/assets/vocabulary.generated.json");
const materials = readJson("src/assets/materials.json");
const feria = readJson("src/render/c2d/feriaAssets.json");
const npcTypes = readJson("src/game/npcTypes.json") || {};
const screens = readJson("src/ui/screens.json");
const audio = readJson("src/assets/audio.json");
const effects = readJson("src/assets/effects.json");
//: The four the renderer implements (`lightPalette` in c2d/editorWorld.js).
//: NOT a generated vocabulary yet — see the ROADMAP row on light design.
const LIGHT_TYPES = ["warm", "led", "amber", "stadium"];

const inventory = {
  generatedAt: new Date().toISOString(),
  note: "Generated by tools/gen-inventory.mjs — run `pnpm inventory` to refresh.",
  world: {
    size: { W: M.meta.W, H: M.meta.H, cell: M.meta.cell },
    cuad: M.meta.cuad,
    cuadsPerView: M.meta.cuadsPerView,
    pxPerMeter: M.meta.pxPerMeter,
    grid: { cols: M.grid.cols, rows: M.grid.rows },
    tiles: { cols: M.meta.tileCols, rows: M.meta.tileRows, px: M.meta.tilePx },
  },
  counts: {
    roads: tiles.roads,
    roadsByClass: tiles.roadsByClass,
    buildings: tiles.buildings,
    palms: tiles.palms,
    trees: tiles.trees,
    mangroves: tiles.mangroves,
    landPolys: (M.landPolys || []).length,
    beaches: (M.beaches || []).length,
    waters: (M.waters || []).length,
    cuadras: (M.cuadras || []).length,
    surfaceStyles: (M.surfaceStyles || []).length,
    greens: (M.greens || []).length,
    malecon: (M.malecon || []).length,
    maleconCells: (M.malecon || []).reduce((n, b) => n + (b.cells || 0), 0),
    attractions: (M.attractions || []).length,
    attractionsByKind: tally(M.attractions || [], "kind"),
    hills: (M.hills || []).length,
    landmarks: M.landmarks.length,
    landmarksByType: tally(M.landmarks, "type"),
    parcels: (M.parcels || []).length,
    parcelsByUse: tally(M.parcels, "use"),
    stadiums: (M.stadiums || []).length,
    pois: (M.pois || []).length,
    poisByCategory: tally(M.pois, "cat"),
    signs: (M.signs || []).length,
    signsByKind: tally(M.signs, "kind"),
    ferries: (M.ferries || []).length,
    plazas: (M.plazas || []).length,
    editorFeatures: (M.editorFeatures || []).length,
    customers: M.customers.length,
    districts: M.districts.length,
    stages: M.stages.length,
  },
  surfaces: SURFACE_CLASSES.map((name, id) => ({ id, name, speedMul: SURFACE_MUL[id] })),
  vehicles: Object.entries(VEHICLES).map(([key, v]) => ({
    key, name: v.name, kind: v.kind,
    accel: v.accel, top: v.top, turn: v.turn, grip: v.grip, melt: v.melt,
  })),
  districts: M.districts.map((d) => ({ id: d.id, name: d.name, x0: d.x0, x1: d.x1, tone: d.tone })),
  stages: M.stages.map((s) => ({
    num: s.num, id: s.id, name: s.name, district: s.district, weather: s.weather,
    targetDeliveries: s.targetDeliveries, timeLimit: s.timeLimit, unlock: s.unlock,
    kiosks: s.kiosks, customers: s.customers,
  })),
  landmarks: M.landmarks.map((l) => ({ id: l.id, type: l.type, name: l.name, district: l.district })),
  // A parcel is a sponsorable space: `slot` is the rect a lote's art fills and
  // `ang` the manzana's angle it is drawn at.
  parcels: (M.parcels || []).map((p) => ({
    id: p.id, use: p.use, name: p.name, ang: p.ang, slot: p.slot,
  })),
  customers: M.customers.map((c) => ({ id: c.id, name: c.name, district: c.district })),
  catalogs: {
    // Shared human/agent type contract. Feature instances remain streamed from
    // the manifest and tiles instead of ballooning this file to 80k records.
    worldEntities: [
      { type: "cuadra", label: "Cuadra", category: "ground", geometry: "polygon", layer: "parcels", source: "manifest", count: (M.cuadras || []).length, editable: true },
      { type: "surface-region", label: "Surface region", category: "ground", geometry: "polygon", layer: "surfaces", source: "patch", count: (M.surfaceStyles || []).length, editable: true },
      { type: "water", label: "Water", category: "ground", geometry: "polygon", layer: "surfaces", source: "manifest", count: (M.waters || []).length, editable: true },
      { type: "beach", label: "Beach", category: "ground", geometry: "polygon", layer: "surfaces", source: "manifest", count: (M.beaches || []).length, editable: true },
      { type: "hill", label: "Hill", category: "ground", geometry: "polygon", layer: "surfaces", source: "manifest", count: (M.hills || []).length, editable: true },
      { type: "malecon", label: "Malecón", category: "ground", geometry: "polygon", layer: "surfaces", source: "manifest", count: (M.malecon || []).length, editable: false },
      { type: "attraction", label: "Atracción", category: "structures", geometry: "point", layer: "landmarks", source: "manifest", count: (M.attractions || []).length, editable: true },
      { type: "road", label: "Road", category: "transport", geometry: "line", layer: "roads", source: "tile", count: tiles.roads, editable: true },
      { type: "boulevard", label: "Boulevard", category: "transport", geometry: "line", layer: "roads", source: "tile", count: tiles.roadsByClass.pedestrian || 0, editable: true },
      { type: "rail", label: "Rail", category: "transport", geometry: "line", layer: "roads", source: "generator", count: 22, editable: true },
      { type: "ferry-route", label: "Ferry route", category: "transport", geometry: "line", layer: "roads", source: "manifest", count: (M.ferries || []).length, editable: true },
      { type: "building", label: "Building", category: "structures", geometry: "polygon", layer: "buildings", source: "tile", count: tiles.buildings, editable: true },
      { type: "parcel", label: "Parcel", category: "structures", geometry: "polygon", layer: "parcels", source: "manifest", count: (M.parcels || []).length, editable: true },
      { type: "stadium", label: "Stadium / cancha", category: "structures", geometry: "polygon", layer: "parcels", source: "manifest", count: (M.stadiums || []).length, editable: true },
      { type: "park", label: "Park / green", category: "structures", geometry: "polygon", layer: "parcels", source: "manifest", count: (M.greens || []).length, editable: true },
      { type: "landmark", label: "Landmark", category: "places", geometry: "point", layer: "landmarks", source: "manifest", count: (M.landmarks || []).length, editable: true },
      { type: "kiosk", label: "Churchill kiosk", category: "places", geometry: "point", layer: "landmarks", source: "manifest", count: (M.landmarks || []).filter((item) => item.type === "kiosk").length, editable: true },
      { type: "poi", label: "OSM place", category: "places", geometry: "point", layer: "landmarks", source: "manifest", count: (M.pois || []).length, editable: true },
      { type: "sign", label: "Street furniture / sign", category: "places", geometry: "point", layer: "landmarks", source: "manifest", count: (M.signs || []).length, editable: true },
      { type: "tree", label: "Tree", category: "vegetation", geometry: "point", layer: "vegetation", source: "tile", count: tiles.trees, editable: true },
      { type: "palm", label: "Palm", category: "vegetation", geometry: "point", layer: "vegetation", source: "tile", count: tiles.palms, editable: true },
      { type: "tree-line", label: "Tree line", category: "vegetation", geometry: "line", layer: "vegetation", source: "patch", count: 0, editable: true },
      { type: "mangrove", label: "Mangrove", category: "vegetation", geometry: "point", layer: "vegetation", source: "tile", count: tiles.mangroves, editable: true },
      { type: "player", label: "Player start", category: "gameplay", geometry: "point", layer: "drafts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "player").length, editable: true },
      { type: "placed-vehicle", label: "Placed vehicle", category: "gameplay", geometry: "point", layer: "drafts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "placed-vehicle").length, editable: true },
      { type: "spawn", label: "Spawn / checkpoint", category: "gameplay", geometry: "point", layer: "drafts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "spawn").length, editable: true },
      { type: "delivery", label: "Delivery target", category: "gameplay", geometry: "point", layer: "drafts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "delivery").length, editable: true },
      { type: "route", label: "Authored route", category: "gameplay", geometry: "line", layer: "drafts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "route").length, editable: true },
      { type: "trigger", label: "Trigger zone", category: "gameplay", geometry: "polygon", layer: "drafts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "trigger").length, editable: true },
      { type: "stage", label: "Story stage", category: "gameplay", geometry: "point", layer: "drafts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "stage").length, editable: true },
      { type: "district", label: "District / neighborhood", category: "world rules", geometry: "polygon", layer: "districts", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "district").length, editable: true },
      { type: "weather-zone", label: "Weather zone", category: "world rules", geometry: "polygon", layer: "ground", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "weather-zone").length, editable: true },
      { type: "roof", label: "Drivable roof", category: "structures", geometry: "polygon", layer: "roofs", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "roof").length, editable: true },
      { type: "grandstand", label: "Grandstand / gradería", category: "structures", geometry: "polygon", layer: "elements", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "grandstand").length, editable: true },
      { type: "covered-lane", label: "Covered drivable lane", category: "structures", geometry: "polygon", layer: "roofs", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "covered-lane").length, editable: true },
      { type: "entrance", label: "Entrance", category: "structures", geometry: "point", layer: "elements", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "entrance").length, editable: true },
      { type: "light", label: "Stadium light", category: "infrastructure", geometry: "point", layer: "infrastructure", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "light").length, editable: true },
      { type: "street-light", label: "Street light", category: "infrastructure", geometry: "point", layer: "infrastructure", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "street-light").length, editable: true },
      { type: "traffic-sign", label: "Traffic / stop sign", category: "infrastructure", geometry: "point", layer: "infrastructure", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "traffic-sign").length, editable: true },
      { type: "traffic-light", label: "Traffic light / semáforo", category: "infrastructure", geometry: "point", layer: "infrastructure", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "traffic-light").length, editable: true },
      { type: "road-marking", label: "Ground speed marking", category: "infrastructure", geometry: "point", layer: "infrastructure", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "road-marking").length, editable: true },
      { type: "npc", label: "Authored NPC", category: "actors", geometry: "point", layer: "actors", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "npc").length, editable: true },
      { type: "coin-spawn", label: "Coin spawn", category: "gameplay", geometry: "point", layer: "gameplay", source: "patch", count: (M.editorFeatures || []).filter((item) => item.type === "coin-spawn").length, editable: true },
    ],
    roadClasses: Object.keys(tiles.roadsByClass).sort(),
    parcelUses: distinct(M.parcels, "use"),
    landmarkTypes: distinct(M.landmarks, "type"),
    poiCategories: distinct(M.pois, "cat"),
    signKinds: distinct(M.signs, "kind"),
    treeKinds: ["tree", "palm", "mangrove"],
    groundPresets: Object.keys(materials.terrain).filter((k) => !k.startsWith("_")),
    // THESE USED TO BE TYPED OUT BY HAND, and one was already wrong: the NPC
    // movements were listed as `stationary, wander, route` when the registry
    // has `rail, bounded-random, route, stationary`. An inventory that invents
    // its own copy of a vocabulary is the drift it exists to report.
    lightTypes: LIGHT_TYPES,
    signalStyles: ["roadside", "centered", "overhead"],
    trafficSigns: vocab.enums.SIGN_KIND,
    attractionKinds: Object.keys(feria).filter((k) => !k.startsWith("$") && k !== "version"),
    npcTypes: (npcTypes.types || []).map((t) => t.id),
    npcMovements: vocab.enums.NPC_MOVEMENT,
    npcDrawStyles: ["person", "vendor", "worker", "mascot"],
    coinTypes: vocab.enums.COIN_TYPE,
    weatherModes: vocab.enums.WEATHER,
    fieldSports: vocab.enums.FIELD_SPORT,
    esteroEncounters: vocab.enums.ESTERO_ENCOUNTER,
    gameModes: vocab.enums.GAME_MODE,
    uiScreens: vocab.enums.UI_SCREEN,
    shopItemKinds: ["vehicle", "upgrade", "boost", "color", "coin-pack", "vehicle-part", "custom"],
  },

  // EVERY VERSIONED REGISTRY, so this file can be checked against the tree
  // instead of believed. `docs/inventory.md` §16 asks for exactly this: an
  // asset family that is not listed here is one nobody can audit.
  registries: REGISTRIES.map((r) => {
    const doc = readJson(r.path);
    return {
      id: r.id,
      path: r.path,
      version: doc?.version ?? doc?.schemaVersion ?? null,
      entries: r.count ? r.count(doc) : null,
      reads: r.reads,
    };
  }),

  // The screens, and which blocks each one is built from.
  screens: Object.fromEntries(Object.entries(screens.screens).map(([id, rec]) => [id, {
    name: rec.name,
    slots: rec.slots.map((s) => s.id),
    conditional: rec.slots.filter((s) => s.when).length,
  }])),

  // Every sound the game can play, and every effect a vehicle can carry.
  sounds: Object.keys(audio.recipes).filter((k) => !k.startsWith("_")).concat(["horn", "combo"]),
  mixerBuses: Object.keys(audio.mixer.buses).filter((k) => !k.startsWith("_")),
  vehicleEffects: Object.keys(effects.vehicle).filter((k) => !k.startsWith("_")),

  modules,
};

const outPath = path.join(ROOT, "inventory.json");
fs.writeFileSync(outPath, JSON.stringify(inventory, null, 2) + "\n");
console.log(`inventory.json written — ${M.landmarks.length} landmarks, ${M.customers.length} customers, ` +
  `${M.districts.length} districts, ${M.stages.length} stages, ${tiles.roads} roads, ` +
  `${tiles.buildings} buildings, ${(M.parcels || []).length} parcels, ` +
  `${Object.keys(modules).length} src modules.`);
