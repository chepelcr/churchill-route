// Painterly render of the streamed 2-D world (WORLD2D).
//
// Instead of a flat per-cell blit, we draw from the per-tile VECTOR features
// (land silhouette, road strokes with lane markings, buildings with
// roofs/windows, palms/trees). Only resident tiles in view contribute; a
// low-res land/water/beach backdrop covers unloaded gaps.
import { WORLD2D as W } from "../../world2d/index.js";
import { ROAD_ORDER, ensureTileCuts } from "./cache.js";
import { paintPalm, paintRoadsideTrees, paintTree, tileTrees } from "./flora.js";
import { aabbInView } from "./gfx.js";
import {
  drawFaroCommas, drawKioskPaths, drawLandBase, drawSurfaceStyleAceras,
} from "./ground.js";
import { drawMalecon } from "./malecon.js";
import { drawStreetLabels2D, medianPairs, paintRoads, paintTileMedians, paintTileRails } from "./streets.js";
import { drawPiers, paintBuilding } from "./structures.js";

// Orchestrate the painterly world from resident, in-view tiles.
function drawWorld2D(view, t) {
  drawLandBase(view, t);   // includes the park/plaza green ground rects
  // el malecón, over the sand and under the streets: the acera band and the
  // asphalt still paint over anything of its paving that reached the kerb.
  drawMalecon(view);
  const vts = W.visibleTiles(view.x0, view.y0, view.x1, view.y1);
  // roads: gather in-view segments across tiles, minor → major so arterials paint on top
  const roads = [];
  for (const tile of vts) {
    ensureTileCuts(tile); // one-time crossing detection for the dash gaps
    for (const r of tile.roads) if (aabbInView(r.aabb, view, r.w + 6)) roads.push(r);
  }
  roads.sort((a, b) => (ROAD_ORDER[a.cls] || 0) - (ROAD_ORDER[b.cls] || 0));
  paintRoads(roads, view);
  drawSurfaceStyleAceras(view);
  // rails (old Ferrocarril line) + paseo separator ground strips, on top of
  // the asphalt but under buildings/flora
  for (const tile of vts) if (tile.rails.length) paintTileRails(tile.rails, view);
  for (const tile of vts) if (tile.medians.length) paintTileMedians(tile, view);
  drawFaroCommas(view);   // faro plaza red "islands" — under the trees
  // asphalt access lanes from the kiosks to the nearest street (drivable), and
  // the ferry ramps, which are piers drawn at ground level for the same reason
  drawKioskPaths(view);
  drawPiers(view, true);
  // buildings
  for (const tile of vts) for (const b of tile.buildings) if (aabbInView(b.aabb, view, 8)) paintBuilding(b);
  // flora. The street trees go down FIRST: they line the acera, so a crown that
  // meets the world's own planting on the cuadra behind it should pass under
  // it, not over. `tileTrees` is the tile's own planting with a double-anchor
  // median's two interleaved rows merged onto its centre (see flora.js).
  paintRoadsideTrees(roads, view);
  for (const tile of vts) {
    for (const tr of tileTrees(tile, medianPairs(tile).pairs)) { if (tr.x > view.x0 - 30 && tr.x < view.x1 + 30 && tr.y > view.y0 - 30 && tr.y < view.y1 + 30) paintTree(tr); }
    for (const pa of tile.palms) { if (pa.x > view.x0 - 30 && pa.x < view.x1 + 30 && pa.y > view.y0 - 30 && pa.y < view.y1 + 30) paintPalm(pa, t); }
  }
  drawStreetLabels2D(roads, view);
}

export { drawWorld2D };
