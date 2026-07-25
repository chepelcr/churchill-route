"""Stage 1: read the map and project it.

Everything downstream measures in world px, so this is where OSM's metres stop.
The order inside is forced, not stylistic: the world's SIZE is computed from the
ways themselves, so the projection has to exist before a single feature can be
extracted or clipped.

Out: a WorldContext with the projection, the dims, an empty raster of the right
size, and every extracted feature family. Nothing is placed or rasterised yet —
a building here still sits at its true OSM footprint.
"""
import time
from collections import defaultdict

from ..context import WorldContext
from ..logging import log, warn
from ..service.osm import (
    barro_leon_continuation, extract_areas, extract_buildings, extract_pois,
    extract_rails, extract_roads, propagate_barro_to_crossings,
)
from ..service.projection import planar_setup
from ..util.raster import Raster


def extract_world(osm_source):
    """Read the OSM source, project it, and return the world under construction
    plus the raw building footprints (which are placed by a later stage, not
    kept on the context: they are consumed, not shared)."""
    t0 = time.time()
    nodes, ways, named, relations, poi_nodes = osm_source.load()
    log("parse", f"{len(nodes)} nodes, {len(ways)} kept ways, "
                 f"{len(named)} named features ({time.time()-t0:.1f}s)")

    sp, dims = planar_setup(ways)
    ctx = WorldContext(dims=dims, projection=sp)
    ctx.nodes, ctx.ways, ctx.named = nodes, ways, named
    ctx.relations, ctx.poi_nodes = relations, poi_nodes
    ctx.raster = Raster(dims.cols, dims.rows, dims.cell)

    roads, bridge_road = extract_roads(sp, ways, dims.w, dims.h)
    # León Cortés end-barro + dirt cross streets (coordinate-agnostic).
    barro_leon_continuation(roads)
    propagate_barro_to_crossings(roads)
    ctx.roads = roads

    ctx.rails = extract_rails(sp, ways, dims.w, dims.h)
    log("rails", f"{len(ctx.rails)} rail pieces")
    n_by_cls = defaultdict(int)
    for r in roads:
        n_by_cls[r["cls"]] += 1
    log("roads", f"{len(roads)} pieces: {dict(n_by_cls)}")
    if bridge_road is None:
        warn("roads", "Puente colgante way not found — synthesizing later")

    raw_bldgs = extract_buildings(sp, ways, roads, dims.w, dims.h)
    ctx.beaches, ctx.waters = extract_areas(sp, ways, relations, dims.w, dims.h)
    ctx.pois = extract_pois(sp, ways, poi_nodes, dims.w, dims.h)
    log("areas", f"{len(ctx.beaches)} beach, {len(ctx.waters)} water polys")
    return ctx, raw_bldgs, bridge_road
