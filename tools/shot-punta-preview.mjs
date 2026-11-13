// EL PREVIEW DE LA PUNTA — El Faro y el Balneario trazados, pintados por el
// renderer de verdad sobre el mundo de HOY, sin reconstruir.
//
//   ./reboot-server.sh 8736
//   node tools/shot-punta-preview.mjs [devUrl] [dirSalida]
//
// Lee `docs/punta-satellite-mockup.json` (el trazo sobre la imagen satelital,
// en lat/lon), lo lleva a píxeles de mundo con la afín del manifest y le
// entrega al juego un manifest y un tile PARCHADOS EN EL CAMINO — la página
// nunca ve los de disco, así que no hay caché que invalidar y `src/world2d/`
// no se toca. Lo que el juego recibe es lo que el builder emitirá después:
// `manifest.punta` para `c2d/punta.js`, y los edificios, palmas y árboles en
// su tile como todos los demás.
//
// LO QUE NO MUESTRA: la física. El ráster sigue diciendo que la cuadra es agua;
// la superficie sólo cambia al reconstruir el mundo.
import { chromium } from "playwright";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:8736/";
const out = process.argv[3] || "logs";
const doc = JSON.parse(readFileSync("docs/punta-satellite-mockup.json", "utf8"));
const manifest = JSON.parse(readFileSync("src/world2d/manifest.json", "utf8"));
const { geo, pxPerMeter: ppm, tilePx } = manifest.meta;
mkdirSync(out, { recursive: true });

const xy = ([lat, lon]) => [Math.round(geo.ax * lon + geo.bx), Math.round(geo.ay * lat + geo.by)];
const flat = (lls) => lls.flatMap(xy);
const by = Object.fromEntries(doc.shapes.map((s) => [s.id, s]));
const inside = (x, y, pts) => {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const centroid = (pts) => {
  let x = 0, y = 0; const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
  return [x / n, y / n];
};

// ---- EL ACOMODO A LA CALLE DEL JUEGO (`gameFit` en el JSON dice por qué)
const tcG = Math.floor(xy(by.pool_main.polygonLL[0])[0] / tilePx), trG = Math.floor(xy(by.pool_main.polygonLL[0])[1] / tilePx);
const tile = JSON.parse(readFileSync(`src/world2d/tiles/${tcG}_${trG}.json`, "utf8"));
const FIT = doc.gameFit, ACERA = manifest.meta.aceraPx, realHalf = FIT.realRoadHalfM * ppm, range = FIT.interiorRangeM * ppm;
const streets = tile.roads.filter((r) => r.w >= 40);
function nearestStreet(x, y) {
  let best = null;
  for (const r of streets) {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by2 = r.pts[i + 3];
      const L2 = (bx - ax) ** 2 + (by2 - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by2 - ay)) / L2));
      const qx = ax + (bx - ax) * t, qy = ay + (by2 - ay) * t, d = Math.hypot(x - qx, y - qy);
      if (!best || d < best.d) best = { d, qx, qy, grow: Math.max(0, r.w / 2 + ACERA - realHalf) };
    }
  }
  return best;
}
// cuánto y hacia dónde se corre un punto: entero afuera del lazo, decreciendo adentro
function push(x, y, inner) {
  const n = nearestStreet(x, y);
  if (!n || n.d < 1 || n.d > 70 * ppm) return [0, 0];
  const k = inner ? Math.max(0, 1 - Math.max(0, n.d - realHalf) / range) : 1;
  return [(x - n.qx) / n.d * n.grow * k, (y - n.qy) / n.d * n.grow * k];
}
const OUTER = new Set(["malecon", "faro", "coast"]);
const groundsRaw = by.balneario_grounds.polygonLL.flatMap(xy);
const about = centroid(by[FIT.interiorAbout].polygonLL.flatMap(xy)), K = FIT.interiorScale;
const shrink = ([x, y]) => [Math.round(about[0] + (x - about[0]) * K), Math.round(about[1] + (y - about[1]) * K)];
const pushed = (inner) => ([x, y]) => { const v = push(x, y, inner); return [Math.round(x + v[0]), Math.round(y + v[1])]; };
// el terreno es suelo y se acomoda al cordón; todo lo demás de adentro es rígido
const mover = (id, group) => (OUTER.has(group) ? pushed(false) : id === "balneario_grounds" ? pushed(true) : shrink);
const flatOf = (s) => (s.polygonLL || s.polylineLL).map(xy).map(mover(s.id, s.group)).flat();
const at = (ll, id, group) => mover(id, group)(xy(ll));
const pointAt = (p) => { const q = xy(p.ll); return mover(null, inside(q[0], q[1], groundsRaw) ? "balneario" : "malecon")(q); };
const SKIP = new Set(FIT.skip);

// ---- manifest.punta: lo que `c2d/punta.js` pinta
const ground = (id) => ({ id, use: by[id].use, pts: flatOf(by[id]) });
const north = by.malecon_norte.pattern, south = by.malecon_sur.pattern;
const punta = {
  grounds: ["balneario_grounds", "pool_deck", "malecon_norte", "faro_plaza", "mirador_oeste", "malecon_sur", "parqueo_faro"].map(ground),
  pools: [
    { id: "pool_main", use: "pool", pts: flatOf(by.pool_main) },
    { id: "pool_kids_zone", use: "pool-shallow", zone: true, pts: flatOf(by.pool_kids_zone) },
    { id: "pool_south_lobe", use: "pool-deep", zone: true, pts: flatOf(by.pool_south_lobe) },
    { id: "pool_kiddie_round", use: "pool", pts: flatOf(by.pool_kiddie_round) },
  ],
  walls: doc.lines.map((l) => ({ id: l.id, pts: l.polylineLL.map(xy).map(mover(l.id, "balneario")).flat() })),
  islands: [ground("pool_island")],
  fans: north.fans.map((f) => { const [x, y] = at(f.apexLL, null, "malecon"); return { x, y, ang: f.axisDeg * Math.PI / 180, r: north.rM * ppm }; }),
  waves: south.waves.map((w) => { const [x, y] = at(w.ll, null, "malecon"); return { x, y, ang: w.axisDeg * Math.PI / 180, len: south.lenM * ppm }; }),
  rotondas: [(() => { const [x, y] = at(south.rotonda.centerLL, null, "malecon"); return { x, y, r: south.rotonda.rM * ppm }; })()],
  riprap: doc.shapes.filter((s) => s.use === "riprap" && !SKIP.has(s.id)).map((s) => ({ id: s.id, pts: flatOf(s), w: s.widthM * ppm })),
  props: [
    { kind: "play-structure", pts: flatOf(by.pool_play_ship) },
    ...doc.points.filter((p) => p.kind === "cabana").map((p) => { const [x, y] = shrink(xy(p.ll)); return { kind: "cabana", x, y }; }),
  ],
};
const all = [...punta.grounds, ...punta.riprap].flatMap((g) => g.pts);
punta.x0 = Math.min(...all.filter((_, i) => i % 2 === 0)); punta.x1 = Math.max(...all.filter((_, i) => i % 2 === 0));
punta.y0 = Math.min(...all.filter((_, i) => i % 2 === 1)); punta.y1 = Math.max(...all.filter((_, i) => i % 2 === 1));
const G = punta.grounds[0].pts;

// ---- el manifest parchado: la ensenada deja de existir y el Faro va a su torre
const B = manifest.balneario;
const inBaln = (poly) => {
  const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
  return B && Math.min(...xs) >= B.x0 - 60 && Math.max(...xs) <= B.x1 + 60 && Math.min(...ys) >= B.y0 - 60 && Math.max(...ys) <= B.y1 + 60;
};
const dropped = { waters: manifest.waters.filter(inBaln).length, parcels: 0, buildings: 0 };
manifest.waters = manifest.waters.filter((p) => !inBaln(p));
manifest.greens = (manifest.greens || []).filter((g) => !(g.type === "pool" && inBaln(g.pts)));
delete manifest.balneario;
manifest.parcels = manifest.parcels.filter((p) => { const hit = inside(p.cx, p.cy, G); dropped.parcels += hit; return !hit; });
const tower = at(by.faro_torre.circle.centerLL, "faro_torre", "faro"), poolC = centroid(punta.pools[0].pts);
for (const lm of manifest.landmarks) {
  if (lm.id === "faro") { lm.x = tower[0]; lm.y = tower[1]; lm.commas = []; }
  if (lm.id === "balneario") { lm.x = Math.round(poolC[0]); lm.y = Math.round(poolC[1]); }
}
manifest.punta = punta;

// ---- el tile parchado: edificios, palmas y árboles van donde van los de todos
const tc = tcG, tr = trG;
tile.buildings = tile.buildings.filter((b) => { const hit = inside(...centroid(b.pts), G); dropped.buildings += hit; return !hit; });
const isRoof = (s) => s.use === "canopy" || s.use === "pergola";
for (const s of doc.shapes) {
  if (s.kind !== "building" || s.use === "lighthouse") continue;
  tile.buildings.push({ pts: flatOf(s), color: s.color, roof: s.roof, wnd: isRoof(s) ? 0 : 1, name: s.name });
}
const crown = (rM) => Math.max(0.6, Math.min(1.9, rM * ppm / 17));
// lo ya sembrado sobre el suelo nuevo se quita: no se planta dos veces
const onNew = (o) => punta.grounds.some((g) => inside(o.x, o.y, g.pts));
tile.palms = tile.palms.filter((o) => !onNew(o));
tile.trees = tile.trees.filter((o) => !onNew(o));
for (const p of doc.points) {
  const [x, y] = pointAt(p);
  if (p.kind === "palm") tile.palms.push({ x, y, s: 1.0, sway: (x * 0.37 + y * 0.11) % 6.28 });
  if (p.kind === "tree") tile.trees.push({ x, y, s: crown(p.rM) });
}
{ const [x, y] = at(by.faro_arbol.circle.centerLL, null, "faro"); tile.trees.push({ x, y, s: crown(by.faro_arbol.circle.rM) }); }
console.log(`[punta-preview] fuera: ${dropped.waters} agua, ${dropped.parcels} parcelas, ${dropped.buildings} edificios · ` +
  `dentro: ${punta.grounds.length} suelos, ${punta.pools.length} piscinas, ${punta.fans.length} abanicos, ${punta.waves.length} olas`);

// PW_CHROMIUM: un Chromium ya instalado, cuando el de Playwright no está en la máquina
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const asModule = (obj) => ({ status: 200, contentType: "text/javascript", body: `export default ${JSON.stringify(obj)};` });
await page.route("**/src/world2d/manifest.json*", (route) => route.fulfill(asModule(manifest)));
await page.route(`**/src/world2d/tiles/${tc}_${tr}.json*`, (route) => route.fulfill(asModule(tile)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
const cx = (punta.x0 + punta.x1) / 2, cy = (punta.y0 + punta.y1) / 2;
await page.goto(`${url}?editorPlay=1&x=${Math.round(cx)}&y=${Math.round(cy)}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(2500);
if (!(await page.evaluate(() => !!window.WORLD2D.PUNTA))) { console.error("[punta-preview] el juego no recibió el manifest parchado"); process.exit(1); }

const shot = async (name, weather, x, y, zoom) => {
  await page.evaluate(async ({ weather, x, y, zoom }) => {
    const G = window.Game, W = window.WORLD2D, st = G.state;
    G.setAttract(false);
    G.startExplore({ weather, x: st.p.x, y: st.p.y });
    st.storyTip = null;
    await new Promise((r) => setTimeout(r, 700));
    st.paused = true;
    st.p.x = -9999; st.p.y = -9999;            // el carro fuera de cuadro: es una foto del lugar
    st.cam.x = x; st.cam.y = y; st.cam.zoom = zoom;
    W.update(x, y); await W.ready(x, y, 1800, 1200);
    for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
      if (!el.querySelector("canvas")) el.style.display = "none";
    }
  }, { weather, x, y, zoom });
  await page.waitForTimeout(1300);
  const file = path.join(out, `punta-preview-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`[punta-preview] ${file}`);
  return file;
};

const fan = punta.fans[8], wave = punta.waves[1];
const whole = await shot("punta", "sunny", cx + 40, cy, 1.55);
await shot("piscina", "sunny", poolC[0] + 30, poolC[1], 3.4);
await shot("abanicos", "sunny", fan.x + 40, fan.y, 4.2);
await shot("olas", "sunny", wave.x + 40, wave.y + 20, 4.2);
await shot("noche", "night", cx + 40, cy, 1.55);
copyFileSync(whole, "docs/punta-space-mockup.png");
await browser.close();
if (errors.length) { console.error(`[punta-preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
