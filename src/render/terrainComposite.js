// CSS compositor seam for the transparent Three terrain pass.
//
// Drawing a WebGL canvas into Canvas2D cost 4.7 ms/frame in the D2 gate. The
// browser compositor can keep both surfaces on the GPU instead: world Canvas
// below, terrain here, Pixi structures next, and the split screen/HUD Canvas on
// top. This tiny module owns that DOM contract without importing Three into 2-D.
let terrainCanvas = null;
let frameActive = false;

export function setTerrainCanvas(canvas, mainCanvas) {
  terrainCanvas = canvas || null;
  if (!terrainCanvas || !mainCanvas) return;
  terrainCanvas.dataset.composite = "css-multiply";
  terrainCanvas.style.cssText = [
    "position:fixed", "inset:0", "pointer-events:none",
    "mix-blend-mode:multiply", "will-change:contents",
  ].join(";");
  // Insert immediately above the opaque world. Pixi and #game-overlay-canvas
  // already sit later in the stack, so structures and screen UI remain clear.
  mainCanvas.parentNode.insertBefore(terrainCanvas, mainCanvas.nextSibling);
}

export function setTerrainFrameReady(ready = true) {
  if (terrainCanvas) terrainCanvas.dataset.frameReady = ready ? "true" : "false";
}

// Three resolves this before Canvas starts its frame. A flat/cull-empty frame
// keeps the historical one-canvas path, so an alpha-zero terrain layer changes
// literally no pixels; relief frames lift the screen pass above WebGL.
export function setTerrainFrameActive(active) {
  frameActive = !!active;
  if (terrainCanvas) {
    terrainCanvas.style.visibility = frameActive ? "visible" : "hidden";
    terrainCanvas.dataset.active = frameActive ? "true" : "false";
  }
}

export function terrainFrameActive() {
  return frameActive;
}

export function clearTerrainCanvas() {
  terrainCanvas?.remove();
  terrainCanvas = null;
  frameActive = false;
}
