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
    ACERA_CELLS, CLS_LAND, CUAD, CUADS_PER_VIEW, DEBUG_PNG, DEBUG_SVG,
    DRIVABLE_CLASSES, GRID_CELL, MARINE_POOL_GROUND_CLEAR_PX,
    MARINE_POOL_MIN_SPACING_PX, MARINE_POOL_RAIL_CLEAR_PX, MARINE_POOL_SCALE,
)
from ..content import MARINE_BUILDING_NAMES, STAGES
from ..logging import log
from ..repository.debug_render import render_debug
from ..service.network import block_census, verify_connectivity
from ..service.street import StreetIndex
from ..util.geometry import (
    pairs, point_in_poly, point_polygon_dist, point_polyline_dist, poly_area,
    to_m,
)
from ..util.raster import disk_has_only
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


def _polygon_rings(record):
    """Return a manifest parcel's exact even-odd rings as point pairs."""
    flats = record.get("polys")
    if not flats:
        flat = record.get("poly")
        flats = [flat] if flat else []
    return [pairs(flat) for flat in flats if flat]


def _inside_rings(point, rings):
    """Canvas ``evenodd`` membership, mirrored here for build-time gates."""
    return sum(bool(point_in_poly(point, ring)) for ring in rings) % 2 == 1


def _rings_edge_dist(point, rings):
    return min((
        point_polyline_dist(point, ring + ring[:1])
        for ring in rings if ring
    ), default=float("inf"))


def _rings_dist(point, rings):
    return 0.0 if _inside_rings(point, rings) else _rings_edge_dist(point, rings)


def _rings_area(rings):
    # Raster tracing directs outer loops and holes oppositely, so their signed
    # areas add to the exact owned area (and disconnected outers add normally).
    return abs(sum(poly_area(ring) for ring in rings))


def verify(ctx, *, spawn, gate_pois):
    """The build's gate. Appends to ctx.failures; the runner raises on any."""
    unreachable = verify_connectivity(ctx.raster, spawn, gate_pois,
                                      reach=GATE_REACH_CELLS)
    ctx.failures.extend("unreachable " + u for u in unreachable)
    marine = next((lm for lm in ctx.landmarks if lm["id"] == "parquemar"), None)
    marine_greens = [g for g in ctx.greens if g.get("type") == "marine"]
    if (marine is None or not marine.get("marine")
            or len(marine.get("pools", [])) != 5 or len(marine_greens) != 1
            or marine.get("poolScale") != MARINE_POOL_SCALE):
        ctx.failures.append("Parque Marino green layer/metadata")
    if marine:
        pools = marine.get("pools", [])
        deck_radius = 78 * MARINE_POOL_SCALE
        marine_buildings = [b for b in ctx.buildings if b.get("marine")]
        marine_block_parcels = [
            p for p in ctx.parcels
            if p["id"].startswith("marino_lote_")
            or p["id"].startswith("marino_cuadra_")
        ]
        block_osm_ids = {
            p["osmId"] for p in marine_block_parcels
            if p.get("osmId") is not None
        }
        block_buildings = [
            b for b in ctx.buildings if b.get("marineBlock")
        ]
        structure_polys = [pairs(b["pts"]) for b in block_buildings]
        station = next((b for b in marine_buildings
                        if b.get("building") == "train_station"), None)
        if station is None:
            ctx.failures.append("Parque Marino train-station footprint")
        else:
            station_x0 = min(station["pts"][0::2])
            if any(pool[0] + MARINE_POOL_GROUND_CLEAR_PX > station_x0
                   for pool in pools):
                ctx.failures.append(
                    "Parque Marino tanks must stay entirely left of station")
        if any(not disk_has_only(
                ctx.raster, pool[0], pool[1],
                MARINE_POOL_GROUND_CLEAR_PX, (CLS_LAND,))
                for pool in pools):
            ctx.failures.append("Parque Marino tank/acera clearance")
        park_parcel = next((p for p in ctx.parcels
                            if p["id"] == "marino_parque"), None)
        if park_parcel is None or not park_parcel.get("whole"):
            ctx.failures.append("Parque Marino residual parcel")
        else:
            park_rings = _polygon_rings(park_parcel)
            if any(not _inside_rings(pool, park_rings)
                   or _rings_edge_dist(pool, park_rings)
                   < deck_radius
                   for pool in pools):
                ctx.failures.append(
                    "Parque Marino tank must stay inside residual parcel")
        # Campus, structure and station parcels are all LAND just like the
        # park. Prove the complete deck does not enter any one of them.
        protected = [
            p for p in ctx.parcels
            if p["id"] != "marino_parque" and p.get("poly")
        ]
        nearest_parcel = min((
            _rings_dist(pool, _polygon_rings(parcel))
            for pool in pools for parcel in protected
        ), default=float("inf"))
        if nearest_parcel < deck_radius:
            ctx.failures.append(
                "Parque Marino tank/parcel clearance "
                f"{nearest_parcel:.1f}px < {deck_radius:.1f}px")
        nearest_structure = min((
            point_polygon_dist(pool, poly)
            for pool in pools for poly in structure_polys
        ), default=float("inf"))
        if nearest_structure < MARINE_POOL_GROUND_CLEAR_PX:
            ctx.failures.append(
                "Parque Marino tank/OSM-structure clearance "
                f"{nearest_structure:.1f}px < {MARINE_POOL_GROUND_CLEAR_PX}px")
        nearest_tank = min((
            ((pool[0] - other[0]) ** 2 + (pool[1] - other[1]) ** 2) ** 0.5
            for i, pool in enumerate(pools) for other in pools[:i]
        ), default=float("inf"))
        if nearest_tank < MARINE_POOL_MIN_SPACING_PX:
            ctx.failures.append(
                "Parque Marino tank/tank clearance "
                f"{nearest_tank:.1f}px < {MARINE_POOL_MIN_SPACING_PX}px")
        rail_lines = [pairs(rail["pts"]) for rail in ctx.rails
                      if len(rail.get("pts", [])) >= 4]
        nearest_rail = min((
            point_polyline_dist(pool, line)
            for pool in pools
            for line in rail_lines
        ), default=float("inf"))
        if nearest_rail < MARINE_POOL_RAIL_CLEAR_PX:
            ctx.failures.append(
                "Parque Marino tank/rail clearance "
                f"{nearest_rail:.1f}px < {MARINE_POOL_RAIL_CLEAR_PX}px")
        marine_parcels = [
            p for p in ctx.parcels if p["id"].startswith("marino_lote_")
        ]
        expected_ids = {
            f"marino_lote_{b['osmId']}" for b in marine_buildings
            if b.get("osmId") is not None
        }
        if ({p["id"] for p in marine_parcels} != expected_ids
                or len(marine_parcels) != len(marine_buildings)):
            ctx.failures.append("Parque Marino exact-boundary/stable parcels")
        visible_names = {p["name"] for p in marine_parcels
                         if p.get("label", True)}
        if not set(MARINE_BUILDING_NAMES.values()).issubset(visible_names):
            ctx.failures.append("Parque Marino verified facility labels")
        if any(p["name"].startswith("Parque Marino ")
               and p["name"][len("Parque Marino "):].isdigit()
               for p in marine_parcels):
            ctx.failures.append("Parque Marino numbered fallback labels")
        if ({b.get("osmId") for b in block_buildings} != block_osm_ids
                or not all(p.get("label", False)
                           for p in marine_block_parcels)):
            ctx.failures.append("Parque Marino cuadra building parcels")
        station_parcel = next((
            p for p in marine_parcels
            if p.get("osmId") == (station or {}).get("osmId")
        ), None)
        if station is not None and station_parcel is not None:
            station_area = abs(poly_area(pairs(station["pts"])))
            parcel_area = _rings_area(_polygon_rings(station_parcel))
            if parcel_area <= station_area * 2:
                ctx.failures.append(
                    "Parque Marino station must own the large east parcel")
        campus = next((p for p in ctx.parcels
                       if p["id"] == "osm_campus_232386868"), None)
        campus_area = _rings_area(_polygon_rings(campus)) if campus else 0
        if campus_area < 5000:
            ctx.failures.append(
                f"Escuela de Biología Marina parcel too small ({campus_area:.0f}px²)")
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
    if ctx.failures:
        # Never replace valid generated artifacts with a world the gate has
        # already rejected. This keeps the module's "gate before write"
        # contract literal during local iteration.
        raise SystemExit(f"[poi] BUILD INCOMPLETE — unresolved: {ctx.failures}")
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
                 editor_features=ctx.editor_features,
                 editor_patch=ctx.editor_patch_meta, cuadras=ctx.cuadras,
                 surface_styles=ctx.surface_styles, editor_ui=ctx.editor_ui)
    render_debug(raster=ctx.raster, buildings=ctx.buildings,
                 landmarks=ctx.landmarks, customers=ctx.customers,
                 roads=ctx.roads, land_contours=land_polys, waters=ctx.waters,
                 bounds_x=bounds_x, png_path=DEBUG_PNG, svg_path=DEBUG_SVG)
    log("done", f"total {time.time()-t0:.1f}s")
