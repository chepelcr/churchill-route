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
    ACERA_CELLS, CUAD, CUADS_PER_VIEW, DEBUG_PNG, DEBUG_SVG,
    DRIVABLE_CLASSES, GRID_CELL,
)
from ..content import STAGES
from ..logging import log
from ..repository.debug_render import render_debug
from ..service.kerb import derive_corners
from ..service.network import block_census, verify_connectivity
from ..service.street import StreetIndex
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
            "pxPerMeter": round(sp.px_per_m, 5)}
    meta["geo"] = geo_affine(sp)
    return meta


#: How close to drivable ground a POI must be to count as reachable, in cells.
#: NOT `ACERA_CELLS + 1`, which is what it used to be: that tied the GATE's
#: strictness to a cosmetic knob, so narrowing the sidewalk quietly tightened
#: the test and a build failed on the faro — a landmark nothing about had
#: changed. What "reachable" means is a property of the game, not of how deep
#: the pavement is drawn.
GATE_REACH_CELLS = 6            # 24 px


def verify(ctx, *, spawn, gate_pois):
    """The build's gate. Appends to ctx.failures; the runner raises on any."""
    unreachable = verify_connectivity(ctx.raster, spawn, gate_pois,
                                      reach=GATE_REACH_CELLS)
    ctx.failures.extend("unreachable " + u for u in unreachable)
    block_census(ctx.raster)


#: Furniture that BELONGS on the asphalt: a zebra and a tope are painted on it.
ON_THE_ROAD_OK = ("crossing", "tope")


def clear_the_roadway(raster, signs, roads):
    """Get every sign out of the carriageway — by moving it, or failing that by
    dropping it.

    `derive_altos` offsets each sign from the road it stops for, which is right
    but cannot be sufficient: it measures against the NEAREST major road, and
    where three of them converge — the Paseo, Avenida Centenario and the faro
    street all meet at the end of the point — the one it measured against is not
    the one the sign lands on. No offset rule fixes that, because the rule only
    ever sees one road.

    The finished raster does see all of them, so the last word belongs to it: if
    a post is standing on drivable ground, it is not street furniture, it is an
    obstacle in the lane. This runs after `decorate` for the same reason that
    stage does — the surface is only final once everything has stamped.

    A sign in the way is NUDGED before it is deleted. The first cut of this just
    dropped them, and took all six of the map's semáforos and nineteen paradas
    with it — real, mapped furniture that only needed to step back onto the
    kerb. Deleting a thing because it is a few px off is losing information the
    world had; moving it is not.
    """
    si = StreetIndex(roads)
    kept, moved, dropped = [], 0, 0
    for s in signs:
        if s["kind"] in ON_THE_ROAD_OK or raster.at_px(s["x"], s["y"]) not in DRIVABLE_CLASSES:
            kept.append(s)
            continue
        n = si.nearest_normal(s["x"], s["y"])
        placed = False
        if n:
            for k in range(1, 13):                      # up to 48 px off the road
                x = round(s["x"] + n[0] * k * GRID_CELL)
                y = round(s["y"] + n[1] * k * GRID_CELL)
                if raster.at_px(x, y) not in DRIVABLE_CLASSES:
                    s["x"], s["y"] = x, y
                    moved += 1
                    placed = True
                    break
        if placed:
            kept.append(s)
        else:
            dropped += 1
    if moved or dropped:
        log("signs", f"{moved} señales corridas fuera de la calzada, {dropped} "
            f"sin acera donde pararse (la superficie terminada manda)")
    return kept


def write_world(ctx, sink, *, meta, islands, land_polys, bounds_x, t0):
    # The esquinas, last: the road list is only final once the estadios have
    # clipped the cross-streets out of their cuadras, and a fillet on a road
    # that no longer exists would hang in the middle of a pitch.
    corners = derive_corners(ctx.roads)
    ctx.signs[:] = clear_the_roadway(ctx.raster, ctx.signs, ctx.roads)
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
                 parcels=ctx.parcels, ferries=ctx.ferries, signs=ctx.signs,
                 corners=corners)
    render_debug(raster=ctx.raster, buildings=ctx.buildings,
                 landmarks=ctx.landmarks, customers=ctx.customers,
                 roads=ctx.roads, land_contours=land_polys, waters=ctx.waters,
                 bounds_x=bounds_x, png_path=DEBUG_PNG, svg_path=DEBUG_SVG)
    log("done", f"total {time.time()-t0:.1f}s")
    if ctx.failures:
        # Every POI and stage target must resolve and be reachable. Fatal, so a
        # regression fails the build loudly instead of shipping.
        raise SystemExit(f"[poi] BUILD INCOMPLETE — unresolved: {ctx.failures}")
