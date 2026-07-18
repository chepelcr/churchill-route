// Vehicle body silhouettes as pure path traces — no DOM, no fills, no colors.
// Backend-agnostic on purpose: only path verbs shared by Canvas2D and Pixi 8
// Graphics are used (beginPath / moveTo / lineTo / quadraticCurveTo / rect /
// roundRect / closePath — NOT ellipse, whose signatures differ). The caller
// owns the transform (centered at (0,0), facing +x), sets the fill style and
// calls fill(). Used today for the player's ground shadow (canvas2d); the
// Pixi backend adopts it when vehicles land there (Milestone C).
export function traceVehicleSilhouette(g, key, veh) {
  const w = veh.w, h = veh.h;
  g.beginPath();
  if (veh.kind === "bike") {
    // slim capsule from rear wheel to front wheel (frame + rider, not the
    // full bounding box — bikes are much narrower than veh.h)
    g.roundRect(-w / 2 - 1, -5, w + 2, 10, 5);
  } else if (key === "tuktuk") {
    // teardrop body (same curve as the painted sprite)
    g.moveTo(w / 2, 0);
    g.quadraticCurveTo(w / 2 - 4, -h / 2, -w / 2 + 2, -h / 2 + 1);
    g.lineTo(-w / 2 + 2, h / 2 - 1);
    g.quadraticCurveTo(w / 2 - 4, h / 2, w / 2, 0);
    g.closePath();
  } else if (key === "turbo") {
    // kart: narrow hull + exposed wheels + rear spoiler (multi-subpath)
    g.roundRect(-w / 2, -h / 2 + 3, w, h - 6, 3);
    g.rect(-w / 2 + 1, -h / 2 - 2, 5, 3); g.rect(-w / 2 + 1, h / 2 - 1, 5, 3);
    g.rect(w / 2 - 6, -h / 2 - 2, 5, 3); g.rect(w / 2 - 6, h / 2 - 1, 5, 3);
    g.rect(-w / 2 - 2, -h / 2 + 1, 3, h - 2);
  } else {
    // cart / pickup / generic car: rounded box
    g.roundRect(-w / 2, -h / 2, w, h, 3);
  }
}
