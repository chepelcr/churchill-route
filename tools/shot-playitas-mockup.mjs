// Render the Las Playitas JSON space-mapping proposal with the live game.
// This patches only the browser's in-memory world; it never edits emitted content.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [out = "docs/playitas-space-mockup.png", url = "http://127.0.0.1:8734/"] = process.argv.slice(2);
const mockup = JSON.parse(readFileSync("docs/playitas-space-mockup.json", "utf8"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const W = window.Game?.world || window.WORLD2D;
    return W && document.querySelector("canvas") && !document.body.innerText.includes("LOADING");
  }, null, { timeout: 60000 });

  await page.evaluate(({ x, y, zoom }) => {
    const G = window.Game;
    G.setAttract(false);
    G.startExplore();
    G.setWeather("sunny");
    const p = G.state.p;
    p.x = x; p.y = y; p.vx = p.vy = 0; p.speed = 0;
    G.state.cam.x = x; G.state.cam.y = y;
    if (G.state.cam.z) G.state.cam.z *= zoom;
  }, mockup.camera);

  await page.evaluate(async () => {
    const shadowsUrl = new URL("/src/render/c2d/shadows.js", location.href);
    const shadowsSrc = await fetch(shadowsUrl).then((response) => response.text());
    const solarSpec = shadowsSrc.match(/from\s+["']([^"']*\/render\/sun\.js[^"']*)["']/)?.[1];
    if (!solarSpec) throw new Error("Could not resolve the live solar module");
    const solarUrl = new URL(solarSpec, shadowsUrl);
    const solarSrc = await fetch(solarUrl).then((response) => response.text());
    const daySpec = solarSrc.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
    if (!daySpec) throw new Error("Could not resolve the live day/night module");
    (await import(new URL(daySpec, solarUrl).href)).setDayCycle(true, 0.25);
  });

  await page.waitForTimeout(6000);
  const applied = await page.evaluate((layout) => {
    const W = window.Game?.world || window.WORLD2D;
    if (!W?.PARCELS || !W?.LANDMARKS || !W?.STADIUMS) {
      throw new Error("The live world does not expose the mockup geometry");
    }
    const bounds = (poly) => {
      const xs = poly.filter((_, index) => index % 2 === 0);
      const ys = poly.filter((_, index) => index % 2 === 1);
      return {
        x0: Math.min(...xs), y0: Math.min(...ys),
        x1: Math.max(...xs), y1: Math.max(...ys),
      };
    };
    const clearCaches = (record) => {
      for (const key of ["_path", "_frame", "_pframe", "_acera", "_pitch"]) delete record[key];
    };
    const result = { parcels: [], buildings: [], stadiums: 0, landmarks: [] };

    for (const [id, patch] of Object.entries(layout.parcels)) {
      const parcel = W.PARCELS.find((item) => item.id === id);
      if (!parcel) throw new Error(`Missing parcel ${id}`);
      clearCaches(parcel);
      delete parcel.polys;
      Object.assign(parcel, patch, bounds(patch.poly));
      result.parcels.push(id);
    }

    const tiles = W.visibleTiles(31000, 17800, 32200, 19000);
    for (const tile of tiles) {
      for (const building of tile.buildings) {
        const entry = Object.entries(layout.buildings).find(([, patch]) => (
          building.pts[0] === patch.match?.[0] && building.pts[1] === patch.match?.[1]
        ));
        if (!entry) continue;
        const [name, patch] = entry;
        clearCaches(building);
        Object.assign(building, patch, { aabb: bounds(patch.pts) });
        result.buildings.push(name);
      }
    }
    for (const [name, patch] of Object.entries(layout.buildings)) {
      if (patch.match) continue;
      const box = bounds(patch.pts);
      const tile = tiles.find((item) => (
        box.x0 >= item.x && box.x1 < item.x + W.TILE_PX
        && box.y0 >= item.y && box.y1 < item.y + W.TILE_PX
      ));
      if (!tile) throw new Error(`No resident tile for new building ${name}`);
      tile.buildings.push({ name, ...patch, aabb: box });
      result.buildings.push(name);
    }

    const stadium = W.STADIUMS.find((item) => item.parts?.includes("playitas_cancha"));
    if (!stadium) throw new Error("Missing sectioned Las Playitas stadium");
    clearCaches(stadium);
    Object.assign(stadium, layout.stadium);
    result.stadiums = 1;
    result.grayAreas = [];
    for (const area of layout.grayAreas || []) {
      W.PARCELS.push({
        ...area,
        use: "acera",
        label: false,
        ...bounds(area.poly),
      });
      stadium.parts.push(area.id);
      result.grayAreas.push(area.id);
    }

    for (const [id, patch] of Object.entries(layout.landmarks)) {
      const landmark = W.LANDMARKS.find((item) => item.id === id);
      if (!landmark) throw new Error(`Missing landmark ${id}`);
      clearCaches(landmark);
      Object.assign(landmark, patch);
      if (id === "estadio_playitas") Object.assign(landmark, layout.stadium);
      result.landmarks.push(id);
    }
    result.lights = 0;
    for (const light of layout.lights || []) {
      W.LIGHTS.push({
        id: light.id,
        type: light.lightType === "stadium" ? "light" : "street-light",
        geometry: { kind: "point", point: light.point },
        properties: { lightType: light.lightType },
      });
      result.lights += 1;
    }
    result.trees = 0;
    for (const [x, y, s] of layout.trees || []) {
      const tile = tiles.find((item) => (
        x >= item.x && x < item.x + W.TILE_PX && y >= item.y && y < item.y + W.TILE_PX
      ));
      if (!tile) throw new Error(`No resident tile for mockup tree at ${x},${y}`);
      tile.trees.push({ x, y, s, line: "playitas-south-mockup" });
      delete tile._flora;
      result.trees += 1;
    }
    return result;
  }, mockup);

  if (applied.parcels.length !== Object.keys(mockup.parcels).length || !applied.buildings.length) {
    throw new Error(`Incomplete mockup: ${JSON.stringify(applied)}`);
  }

  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
      if (!el.querySelector("canvas")) el.style.display = "none";
    }
    for (const el of document.querySelectorAll("canvas")) el.style.visibility = "visible";
  });
  await page.waitForTimeout(1200);
  writeFileSync(out, await page.screenshot());
  console.log(`[playitas-mockup] ${JSON.stringify(applied)} -> ${out}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`[playitas-mockup] page errors: ${errors.join(" | ")}`);
  process.exit(1);
}
