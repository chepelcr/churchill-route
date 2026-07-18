// Pixi backend adapter for the Renderer seam. Creates its own canvas UNDER the
// existing #game-canvas (canvas2d keeps running above it in overlay mode), so
// the stack is: Pixi world+entities (WebGL) -> canvas2d overlay (landmarks,
// weather, HUD drawings) -> React UI.
import { PixiScene } from "./scene.js";

let scene = null;
let ready = false;
let failed = false;

export function setupPixi(mainCanvas, onFail) {
  if (scene) return; // canvas re-setup (resize/fullscreen) — Pixi resizes itself
  const pc = document.createElement("canvas");
  pc.id = "pixi-canvas";
  pc.style.cssText = "position:fixed;inset:0;";
  mainCanvas.parentNode.insertBefore(pc, mainCanvas);
  scene = new PixiScene();
  scene.init(pc).then(() => { ready = true; }).catch((e) => {
    console.warn("[pixi] init failed, falling back to canvas2d", e);
    failed = true;
    pc.remove();
    if (onFail) onFail(e);
  });
}

export function renderPixi(t) {
  if (ready && !failed) scene.render(t);
}
