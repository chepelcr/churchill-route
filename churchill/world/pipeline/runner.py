"""The build, as an ordered list of stages.

Read top to bottom and the world assembles: read and project, paint the
surface, cut the districts, place the POIs and kiosks, find the cuadras, put
structures on them, decorate, verify, write.

The stages pass their results explicitly rather than sharing a scope, which is
the whole point of the split — you can see what each one needs and what it
produces. Where a value is still handed along by name, it is because two stages
genuinely share it, not because everything was in one function.

DETERMINISM IS THE CONTRACT: same docs/map.osm in, byte-identical world out.
tools/world_snapshot.py checks it, and the build log is character-stable too, so
diffing two runs catches a behaviour change the digest might not.
"""
import time

from ..config import (
    CLS_LAND, CUAD_CELLS, GRID_CELL, OSM_PATH, WORLD2D_DIR,
)
from ..repository.osm_file import OsmFileRepository
from ..repository.world_json import JsonWorldRepository
from ..service.block import block_raster_cells, outline_poly
from ..service.woods import classify as classify_woods
from ..service.editor_patch import (
    WorldPatchError, WorldPatchSession, build_cuadra_catalog,
)
from ..service.placement import block_containing, nearest_cell
from ..service.street import StreetIndex
from .build_stage import decorate, place_structures, seat_town_kiosks
from .extract import extract_world
from .finish import build_meta, verify, write_world
from .poi_stage import place_kiosks_and_blocks, place_pois
from .surface_stage import rasterise_surface, resolve_districts


def main():
    t0 = time.time()
    ctx, raw_bldgs, bridge_road = extract_world(OsmFileRepository(OSM_PATH))
    # Unpacked once: these are the same objects the context holds, named the
    # way the stages take them.
    sp, dims = ctx.projection, ctx.dims
    CANVAS_W, CANVAS_H, CENTER_Y = dims.w, dims.h, dims.center_y
    GRID_COLS, GRID_ROWS = dims.cols, dims.rows
    nodes, ways, named, rels, poi_nodes = (ctx.nodes, ctx.ways, ctx.named,
                                           ctx.relations, ctx.poi_nodes)
    roads, rails, pois = ctx.roads, ctx.rails, ctx.pois
    beaches, waters = ctx.beaches, ctx.waters
    junction_islands = []
    try:
        editor_patch = WorldPatchSession.discover(ctx.dims)
        if editor_patch:
            editor_patch.apply_pre_surface(ctx)
    except WorldPatchError as error:
        raise SystemExit(f"[editor] {error}") from error

    grid, land_contours, topY, botY = rasterise_surface(
        ctx, sp=sp, ways=ways, nodes=nodes, roads=roads, beaches=beaches,
        waters=waters, bridge_road=bridge_road)
    districts, bounds_x = resolve_districts(ctx, sp=sp)
    raster = ctx.raster
    landmarks, customers, failures, mlm, pier, BUILDING_LM, NO_PAD_LM, resolve = place_pois(
        ctx, sp=sp, roads=roads, named=named, districts=districts, botY=botY)
    (blocks, plazas, greens, kiosk_paths, beach_kiosks, faro_lm,
     balneario, balneario_cells, marine_site) = place_kiosks_and_blocks(
        ctx, landmarks=landmarks, customers=customers, districts=districts,
        junction_islands=junction_islands, BUILDING_LM=BUILDING_LM,
        NO_PAD_LM=NO_PAD_LM)
    # Two block helpers bound to THIS build's raster and block list. They are
    # passed to the later stages rather than re-derived, so every stage traces
    # the same cuadra outlines.
    _nearest_cell = lambda x, y, classes, max_cells: nearest_cell(raster, x, y, classes, max_cells)
    _block_containing = lambda x, y: block_containing(blocks, x, y)
    _block_raster_cells = lambda cells: block_raster_cells(raster, cells, CUAD_CELLS, CLS_LAND)
    _outline_poly = lambda cells: outline_poly(cells, GRID_CELL)
    _green_poly = lambda cells, typ: (
        {"pts": _outline_poly(_block_raster_cells(cells)), "type": typ}
        if _outline_poly(_block_raster_cells(cells)) else None)
    (balneario, balneario_cells, marine_site, keepouts, medians, palm_runs,
     tree_runs) = seat_town_kiosks(
        ctx, landmarks=landmarks, customers=customers,
        roads=roads, waters=waters, blocks=blocks, greens=greens,
        kiosk_paths=kiosk_paths, beach_kiosks=beach_kiosks, mlm=mlm, pier=pier,
        balneario=balneario, balneario_cells=balneario_cells,
        marine_site=marine_site, _nearest_cell=_nearest_cell,
        _block_containing=_block_containing,
        _block_raster_cells=_block_raster_cells, _green_poly=_green_poly)

    buildings, occ, stadiums, parcels = place_structures(
        ctx, landmarks=landmarks, roads=roads, blocks=blocks, greens=greens,
        plazas=plazas, beaches=beaches, balneario=balneario,
        balneario_cells=balneario_cells, marine_site=marine_site,
        keepouts=keepouts, streets=StreetIndex(roads), raw_bldgs=raw_bldgs,
        sites=ctx.sites, _green_poly=_green_poly,
        _block_raster_cells=_block_raster_cells)

    # WHICH BLOCKS ARE COUNTRYSIDE — before `decorate`, because the patio scatter
    # must not sprinkle its handful of trees over ground a whole forest covers.
    # After the surface is finished, because it asks how far each one is from the
    # real sea.
    classify_woods(ctx.raster, blocks)

    bridge, est, trees, palms, mangroves = decorate(
        ctx, sp=sp, roads=roads, blocks=blocks, occ=occ, waters=waters,
        topY=topY, botY=botY, bridge_road=bridge_road, palm_runs=palm_runs,
        tree_runs=tree_runs, resolve=resolve, buildings=buildings)
    # Everything the stages produced, onto the context the gate and the writer
    # read. (Assignment, not mutation, is safe HERE: nothing runs after.)
    ctx.districts, ctx.blocks, ctx.plazas, ctx.greens = districts, blocks, plazas, greens
    ctx.landmarks, ctx.customers = landmarks, customers
    ctx.buildings, ctx.stadiums, ctx.parcels = buildings, stadiums, parcels
    ctx.kiosk_paths, ctx.trees, ctx.palms = kiosk_paths, trees, palms
    ctx.mangroves, ctx.medians = mangroves, medians
    ctx.bridge, ctx.estuary, ctx.balneario = bridge, est, balneario
    ctx.failures = failures
    ctx.cuadras = build_cuadra_catalog(ctx.raster, blocks)
    if editor_patch:
        try:
            editor_patch.apply_final(ctx)
        except WorldPatchError as error:
            raise SystemExit(f"[editor] {error}") from error

    _kf = next((l for l in landmarks if l["id"] == "kios_faro"), None)
    spawn = tuple(_kf["spawn"]) if (_kf and _kf.get("spawn")) else (
        (faro_lm["x"], faro_lm["y"]) if faro_lm else (
            (landmarks[0]["x"], landmarks[0]["y"]) if landmarks else (CANVAS_W // 2, CANVAS_H // 2)))
    # scenery landmarks (no drivable pad) aren't delivery targets → exclude
    # them from the reachability gate
    gate_pois = [l for l in landmarks if l["type"] not in NO_PAD_LM] + customers
    verify(ctx, spawn=spawn, gate_pois=gate_pois)

    mata_x0 = next(d["x0"] for d in districts if d["id"] == "mata")
    ctx.hills = [{"x0": mata_x0 - 1200, "x1": CANVAS_W, "baseY": 750, "color": "#5e8a55"},
                 {"x0": mata_x0, "x1": CANVAS_W - 600, "baseY": 600, "color": "#4c7848"}]

    write_world(ctx, JsonWorldRepository(WORLD2D_DIR), meta=build_meta(ctx),
                islands=junction_islands, land_polys=land_contours,
                bounds_x=bounds_x, t0=t0)


if __name__ == "__main__":
    main()
