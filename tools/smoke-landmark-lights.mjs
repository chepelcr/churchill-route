// Run against the production preview: node tools/smoke-landmark-lights.mjs [url]
import assert from "node:assert/strict";
import { chromium } from "playwright";
import LIGHTS from "../src/assets/lights.json" with { type: "json" };
import manifest from "../src/world2d/manifest.json" with { type: "json" };

const url = new URL(process.argv[2] || "http://localhost:8799/");
const faro = manifest.landmarks.find((landmark) => landmark.id === "faro");
url.searchParams.set("canvas", "");
url.searchParams.set("editorPlay", "1");
url.searchParams.set("x", faro.x);
url.searchParams.set("y", faro.y);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const zoom = 1.7;
const { radius, scatter } = LIGHTS.types.stadium;
async function inspect(id, weather) {
  await page.evaluate(({ id, weather, zoom }) => {
    const { x, y } = WORLD2D.landmarkById(id);
    Game.startExplore({ x, y, weather });
    Game.setAttract(false);
    Game.state.cam.zoom = zoom;
    Game.state.paused = true;
  }, { id, weather, zoom });
  await page.waitForFunction((id) => {
    const { x, y } = WORLD2D.landmarkById(id);
    return WORLD2D.tileResident(x, y);
  }, id);

  return page.evaluate(async (sourceRadius) => {
    const g = document.querySelector("#game-canvas").getContext("2d");
    const proto = CanvasRenderingContext2D.prototype;
    const originalGradient = proto.createRadialGradient;
    const originalClip = proto.clip;
    const heads = new Set();
    let roofProtected = false;
    proto.createRadialGradient = function (...args) {
      if (this === g && this.globalCompositeOperation === "screen"
          && args[3] === 0 && args[4] === 0 && Math.abs(args[5] - sourceRadius) < 0.001) {
        const { e, f } = this.getTransform();
        heads.add([Math.round(e), Math.round(f)].join(","));
      }
      return originalGradient.apply(this, args);
    };
    proto.clip = function (...args) {
      if (this === g && args[1] === "evenodd") {
        const center = this.isPointInPath(args[0], innerWidth / 2, innerHeight / 2, "evenodd");
        const outside = this.isPointInPath(args[0], 10, 10, "evenodd");
        roofProtected ||= !center && outside;
      }
      return originalClip.apply(this, args);
    };
    try {
      for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame);
      return { halos: heads.size, roofProtected };
    } finally {
      proto.createRadialGradient = originalGradient;
      proto.clip = originalClip;
    }
  }, radius * zoom * scatter.sourceK);
}

try {
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Game?.state.running);
  assert.equal((await inspect("estadio", "night")).halos, 6, "Lito Pérez must light all six towers");
  assert.equal((await inspect("estadio_playitas", "night")).halos, 4, "Las Playitas must light all four towers");
  assert.equal((await inspect("estadio", "sunny")).halos, 0, "Floodlights must stay off in daylight");
  assert.equal((await inspect("faro", "night")).roofProtected, true, "The lighthouse roof must occlude its light");
  assert.deepEqual(errors, []);
  console.log("[landmark-lights] ok — six Lito Pérez towers, four Las Playitas towers, lighthouse roof occlusion");
} finally {
  await browser.close();
}
