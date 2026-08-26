// Painterly render of the streamed 2-D world (WORLD2D).
//
// Instead of a flat per-cell blit, we draw from the per-tile VECTOR features
// (land silhouette, road strokes with lane markings, buildings with
// roofs/windows, palms/trees). Only resident tiles in view contribute; a
// low-res land/water/beach backdrop covers unloaded gaps.
import { WORLD2D as W } from "../../world2d/index.js";
import { ROAD_ORDER, ensureTileCuts } from "./cache.js";
import {
  paintPalm, paintRoadsideTrees, paintTree, paintWoodFloor, paintWoods, tileTrees,
} from "./flora.js";
import { drawStreetLamps } from "./lights.js";
import { aabbInView } from "./gfx.js";
import {
  drawFaroCommas, drawKioskPaths, drawLandBase, drawSurfaceStyleAceras,
} from "./ground.js";
import { drawMalecon } from "./malecon.js";
import { drawStreetLabels2D, medianPairs, paintRoads, paintTileMedians, paintTileRails } from "./streets.js";
import { drawPiers, paintBuilding } from "./structures.js";
import { LAYER, owns } from "../migrated.js";

// Orchestrate the painterly world from resident, in-view tiles.
function drawWorld2D(view, t, rotation = 0) {
  const prof = window.__prof;
  let phaseT = prof ? performance.now() : 0;
  const phase = (key) => {
    if (!prof) return;
    const now = performance.now();
    prof[key] = (prof[key] || 0) + now - phaseT;
    phaseT = now;
  };
  drawLandBase(view, t);   // includes the park/plaza green ground rects
  // el malecón, over the sand and under the streets: the acera band and the
  // asphalt still paint over anything of its paving that reached the kerb.
  drawMalecon(view);
  phase("worldGround");
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
  phase("worldStreets");
  // buildings — SI ES QUE LOS DIBUJA ESTA CAPA. Con el mundo en 3-D las
  // huellas son volumen de verdad en `render/three/massing.js`: techo a dos
  // aguas, sol real y sombra proyectada sobre la calle. Que las pinte una capa
  // o la otra es lo único que se decide acá, y se decide en UN registro
  // (`render/migrated.js`) para que no puedan pintarlas las dos —un edificio
  // con doble no se ve doble, se ve mal— ni ninguna.
  if (owns(LAYER.CANVAS, "buildings")) {
    for (const tile of vts) for (const b of tile.buildings) if (aabbInView(b.aabb, view, 8)) paintBuilding(b);
  }
  phase("worldBuildings");
  // flora. The street trees go down FIRST: they line the acera, so a crown that
  // meets the world's own planting on the cuadra behind it should pass under
  // it, not over. `tileTrees` is the tile's own planting with a double-anchor
  // median's two interleaved rows merged onto its centre (see flora.js).
  // EL MONTE first: it is the ground cover of the countryside, so the town's own
  // planting and the street trees stand over it rather than in a gap in it.
  // EL SUELO DEL MONTE SIEMPRE ES DE CANVAS: es un lavado sobre la tierra, no
  // algo que se pare, así que no se va con los árboles al volumen.
  if (owns(LAYER.CANVAS, "flora")) {
    paintWoods(view);
    paintRoadsideTrees(roads, view);
    for (const tile of vts) {
      for (const tr of tileTrees(tile, medianPairs(tile).pairs)) { if (tr.x > view.x0 - 30 && tr.x < view.x1 + 30 && tr.y > view.y0 - 30 && tr.y < view.y1 + 30) paintTree(tr); }
      for (const pa of tile.palms) { if (pa.x > view.x0 - 30 && pa.x < view.x1 + 30 && pa.y > view.y0 - 30 && pa.y < view.y1 + 30) paintPalm(pa, t); }
    }
  } else {
    paintWoodFloor(view);
  }
  // …y los postes del alumbrado, sobre la acera y bajo los rótulos. El pozo de
  // luz lo abre el compositor de noche (`nightlights.js`); esto es la lámpara.
  if (owns(LAYER.CANVAS, "flora")) drawStreetLamps(view);
  drawStreetLabels2D(roads, view);
  phase("worldFlora");
}

export { drawWorld2D };
