// Painterly render of the streamed 2-D world (WORLD2D).
//
// Instead of a flat per-cell blit, we draw from the per-tile VECTOR features
// (land silhouette, road strokes with lane markings, buildings with
// roofs/windows, palms/trees). Only resident tiles in view contribute; a
// low-res land/water/beach backdrop covers unloaded gaps.
import { WORLD2D as W } from "../../world2d/index.js";
import { ROAD_ORDER, ensureTileCuts } from "./cache.js";
import { paintPalm, paintRoadsideTrees, paintTree, paintWoods, tileTrees } from "./flora.js";
import { drawStreetLamps } from "./lights.js";
import { aabbInView, ctx, textureScale } from "./gfx.js";
import { depthKey } from "./depth.js";
import { state } from "../../game/state.js";
import {
  drawFaroCommas, drawKioskPaths, drawLandBase, drawSurfaceStyleAceras,
} from "./ground.js";
import { drawMalecon } from "./malecon.js";
import { paintRelief } from "./relief.js";
import { paintSkyCover } from "./skycover.js";
import { drawStreetLabels2D, medianPairs, paintRoads, paintTileMedians, paintTileRails } from "./streets.js";
import { drawPiers, paintBuilding } from "./structures.js";

// Orchestrate the painterly world from resident, in-view tiles.
function drawWorld2D(view, t) {
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
  // EL RELIEVE, sobre el suelo terminado y bajo lo que se levanta de él. La
  // ladera lleva la calle encima, así que sombrear antes de las calles diría que
  // el asfalto es plano cuando el cerro no lo es; y sombrear DESPUÉS de los
  // edificios les pasaría la ladera por la fachada, que ya tienen su propia
  // sombra solar.
  paintRelief(ctx, view);
  phase("worldStreets");
  // LOS EDIFICIOS, DE LEJOS A CERCA. Se pintaban en orden de TILE, que daba
  // igual mientras eran rellenos planos — pero con pared, una que se extiende
  // hacia el viewer tapa mal a su vecina, y no hay z-buffer que lo arregle.
  // Con la cámara a plomo sobre el centro, lo más excéntrico está más lejos en
  // 3-D: se recolecta, se ordena por distancia radial descendente y se pinta.
  //
  // Recolectar no rompe el streaming por tile —sólo separa juntar de pintar— y
  // ordenar unas decenas de referencias por cuadro es ruido: el viewport
  // encuadra 160 m y los edificios enteros costaban 0,21 ms.
  const inView = [];
  for (const tile of vts) {
    for (const b of tile.buildings) if (aabbInView(b.aabb, view, 8)) inView.push(b);
  }
  const cam = state.cam;
  inView.sort((p, q) => depthKey(cam, (p.aabb.x0 + p.aabb.x1) / 2, (p.aabb.y0 + p.aabb.y1) / 2)
                      - depthKey(cam, (q.aabb.x0 + q.aabb.x1) / 2, (q.aabb.y0 + q.aabb.y1) / 2));
  for (const b of inView) paintBuilding(b);
  phase("worldBuildings");
  // flora. The street trees go down FIRST: they line the acera, so a crown that
  // meets the world's own planting on the cuadra behind it should pass under
  // it, not over. `tileTrees` is the tile's own planting with a double-anchor
  // median's two interleaved rows merged onto its centre (see flora.js).
  // EL MONTE first: it is the ground cover of the countryside, so the town's own
  // planting and the street trees stand over it rather than in a gap in it.
  paintWoods(view);
  paintRoadsideTrees(roads, view);
  for (const tile of vts) {
    for (const tr of tileTrees(tile, medianPairs(tile).pairs)) { if (tr.x > view.x0 - 30 && tr.x < view.x1 + 30 && tr.y > view.y0 - 30 && tr.y < view.y1 + 30) paintTree(tr); }
    for (const pa of tile.palms) { if (pa.x > view.x0 - 30 && pa.x < view.x1 + 30 && pa.y > view.y0 - 30 && pa.y < view.y1 + 30) paintPalm(pa, t); }
  }
  // …y los postes del alumbrado, sobre la acera y bajo los rótulos. El pozo de
  // luz lo abre el compositor de noche (`nightlights.js`); esto es la lámpara.
  drawStreetLamps(view);
  drawStreetLabels2D(roads, view);
  // LA SOMBRA DE LAS NUBES, al final del pase del mundo: una nube tapa el suelo,
  // los techos y los árboles por igual, y es eso lo que la hace leerse como algo
  // que está ENTRE el sol y el pueblo. No alcanza al carro ni al HUD a propósito
  // — el jugador tiene que poder verse siempre.
  paintSkyCover(ctx, view, t, textureScale());
  phase("worldFlora");
}

export { drawWorld2D };
