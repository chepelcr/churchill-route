// Pixi landmarks layer for the Renderer seam. Creates a transparent canvas
// ABOVE #game-canvas (pointer-events: none, so the drive finger always reaches
// the game canvas) carrying landmark STRUCTURES — the estadio's gradas and
// tunnel roof today, more landmarks as they migrate. canvas2d keeps painting
// the whole painterly world, entities and their grounds below.
import { PixiScene } from "./scene.js";

let scene = null;
let ready = false;
let failed = false;

export function setupPixi(mainCanvas, onFail) {
  if (scene) return; // canvas re-setup (resize/fullscreen) — Pixi resizes itself
  const pc = document.createElement("canvas");
  pc.id = "pixi-canvas";
  pc.style.cssText = "position:fixed;inset:0;pointer-events:none;";
  mainCanvas.parentNode.insertBefore(pc, mainCanvas.nextSibling);
  scene = new PixiScene();
  scene.init(pc, { landmarksOnly: true }).then(() => { ready = true; }).catch((e) => {
    console.warn("[pixi] landmarks layer init failed — canvas2d fallback", e);
    failed = true;
    pc.remove();
    if (onFail) onFail(e);
  });
}

export function renderPixi(t) {
  if (ready && !failed) scene.render(t);
}
