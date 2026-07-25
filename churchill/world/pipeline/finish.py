"""Final stage: prove the world is playable, then write it.

The GATE comes before the write on purpose. A world can look perfect in the
debug render and still be broken in the only way that matters — a kiosk the car
cannot reach, because an acera ring closed around it or a pad landed on the far
side of a wall. That is an unplayable stage, and it is invisible in a
screenshot, so it fails the build instead.

Scenery landmarks are excluded from the gate: a lighthouse or a beach sign has
no drivable pad and was never a delivery target.
"""
import time

from ..config import (
    ACERA_CELLS, CROSS_EXAG, CUAD, CUADS_PER_VIEW, DEBUG_PNG, DEBUG_SVG,
    GRID_CELL,
)
from ..content import STAGES
from ..logging import log
from ..repository.debug_render import render_debug
from ..service.network import block_census, verify_connectivity
from ..util.geometry import to_m
from .emit import emit_world2d


def geo_affine(sp):
    """The geo→world affine shipped in `meta.geo`: x = ax·lon + bx,
    y = ay·lat + by. The planar projection is exactly linear in lon/lat, so two
    reference points determine it — which is what lets a CLIENT place remote
    content (a server NPC, a sponsored lote) from real coordinates without
    shipping any of this code."""
    la0, lo0, la1, lo1 = 9.90, -84.90, 10.00, -84.70
    xa, ya, _, _ = sp.project(to_m(la0, lo0))
    xb, yb, _, _ = sp.project(to_m(la1, lo1))
    ax = (xb - xa) / (lo1 - lo0)
    ay = (yb - ya) / (la1 - la0)
    return {"ax": round(ax, 4), "bx": round(xa - ax * lo0, 2),
            "ay": round(ay, 4), "by": round(ya - ay * la0, 2)}


def build_meta(ctx):
    sp, dims = ctx.projection, ctx.dims
    meta = {"W": dims.w, "H": dims.h, "centerY": dims.center_y, "cell": GRID_CELL,
            "cuad": CUAD, "cuadsPerView": CUADS_PER_VIEW,
            "aceraPx": ACERA_CELLS * GRID_CELL,
            "pxPerMeter": round(sp.px_per_m, 5), "crossExag": CROSS_EXAG,
            "spineLenM": round(sp.total)}
    meta["geo"] = geo_affine(sp)
    return meta


def verify(ctx, *, spawn, gate_pois):
    """The build's gate. Appends to ctx.failures; the runner raises on any."""
    unreachable = verify_connectivity(ctx.raster, spawn, gate_pois,
                                      reach=ACERA_CELLS + 1)
    ctx.failures.extend("unreachable " + u for u in unreachable)
    block_census(ctx.raster)


def write_world(ctx, sink, *, meta, islands, land_polys, bounds_x, t0):
    emit_world2d(ctx.raster, sink, meta=meta, districts=ctx.districts,
                 roads=ctx.roads, rails=ctx.rails, buildings=ctx.buildings,
                 trees=ctx.trees, palms=ctx.palms, mangroves=ctx.mangroves,
                 medians=ctx.medians, plazas=ctx.plazas, greens=ctx.greens,
                 islands=islands, beaches=ctx.beaches, waters=ctx.waters,
                 land_polys=land_polys, landmarks=ctx.landmarks,
                 customers=ctx.customers, stages=STAGES, stadiums=ctx.stadiums,
                 kiosk_paths=ctx.kiosk_paths, faro_pier=ctx.faro_pier,
                 balneario=ctx.balneario, bridge=ctx.bridge, estuary=ctx.estuary,
                 pier=ctx.pier, hills=ctx.hills, pois=ctx.pois,
                 parcels=ctx.parcels)
    render_debug(raster=ctx.raster, buildings=ctx.buildings,
                 landmarks=ctx.landmarks, customers=ctx.customers,
                 roads=ctx.roads, land_contours=land_polys, waters=ctx.waters,
                 bounds_x=bounds_x, png_path=DEBUG_PNG, svg_path=DEBUG_SVG)
    log("done", f"total {time.time()-t0:.1f}s")
    if ctx.failures:
        # Every POI and stage target must resolve and be reachable. Fatal, so a
        # regression fails the build loudly instead of shipping.
        raise SystemExit(f"[poi] BUILD INCOMPLETE — unresolved: {ctx.failures}")
