"""Stage 2: paint the surface, and stage 3: cut the districts.

`rasterise_surface` is where the world becomes DRIVABLE GROUND rather than a
list of features, and its order is the fragile part (see service.surface): coast
and water barriers, then the flood — everything the sea cannot reach past a
closed barrier is land — then beaches, water polygons, roads, and only then the
acera fringe, which grows out of the roads and must run before anything that
needs to stay un-ringed.

It also builds the shore arrays: for every grid column, the first and last
non-water row. The renderer draws the coastline from them, and a median filter
takes out the single-column spikes that a pier or a jetty would otherwise leave.

`resolve_districts` turns the geo boundary anchors into x-bands. The peninsula
barrios are full-height bands along the spit; the inland ones carry an explicit
bbox, so they emit as real 2-D regions instead.
"""
from collections import defaultdict

from ..config import (
    CLASS_NAMES,
    CLS_ACERA, CLS_BEACH, CLS_BRIDGE, CLS_LAND, CLS_PASEO, CLS_ROAD, CLS_WATER,
    CUAD, GRID_CELL,
)
from ..content import (
    DISTRICT_BOUNDS_GEO, DISTRICT_DEFS, INLAND_DISTRICT_DEFS, PROBE_LAND,
    PROBE_SEA,
)
from ..logging import log, warn
from ..service.osm import extract_coastlines
from ..service.surface import (
    acera_fringe, beach_fringe, raster_coast_barrier, raster_poly_barrier,
    trace_land_contours,
)
from ..util.geometry import pairs, to_m


def rasterise_surface(ctx, *, sp, ways, nodes, roads, beaches, waters, bridge_road):
    dims = ctx.dims
    CANVAS_H, CENTER_Y = dims.h, dims.center_y
    GRID_COLS, GRID_ROWS = dims.cols, dims.rows
    raster = ctx.raster
    # --- raster surface grid
    # ONE raster, and `grid` stays an alias of its buffer: the algorithms that
    # moved to util take the object, while everything still reading cells by
    # index keeps working until it moves to a service too.
    raster = ctx.raster
    grid = raster.buf
    barrier = bytearray(GRID_COLS * GRID_ROWS)
    chains = extract_coastlines(sp, ways)
    log("coast", f"{len(chains)} stitched chains from natural=coastline")
    raster_coast_barrier(barrier, raster, sp, chains, nodes)
    # water bodies (estuary) are areas, not coastline — barrier their edges
    # too so the flood can't leak across an un-barriered shore into the land
    nb = raster_poly_barrier(barrier, raster, waters)
    log("coast", f"+{nb} water-outline barrier cells (planar)")
    # flood ONLY the open outer gulf (the entire west bbox edge
    # is deep gulf, west of La Punta). Do NOT seed the estuary/inner water
    # or the world corners — those either sit on inland land (draining it to
    # water) or pour the flood through the harbour mouth into the whole
    # peninsula + eastern lowland. The inner waters (estuary, rivers,
    # mangroves) are stamped CLS_WATER from their polygons after the flood,
    # so they don't need to be flooded; everything the gulf can't reach past
    # the coastline stays land.
    sea_seeds = [(2, y) for y in range(2, CANVAS_H, 200)]
    sea_seeds.append(sp.to_px(*sp.project_m(to_m(*PROBE_SEA[0]))[:2]))
    raster.flood_water(barrier, sea_seeds, CLS_WATER, CLS_LAND)

    # sanity probes before painting details
    def cls_at_geo(ll):
        x, y, _, _ = sp.project(to_m(*ll))
        c, r = int(x / GRID_CELL), int(y / GRID_CELL)
        if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS:
            return grid[r * GRID_COLS + c]
        return -1
    for p in PROBE_LAND:
        if cls_at_geo(p) == CLS_WATER:
            log("WARN", f"land probe {p} is WATER — coastline leak or spine offset")
    for p in PROBE_SEA:
        if cls_at_geo(p) == CLS_LAND:
            log("WARN", f"sea probe {p} is LAND")

    land_contours = trace_land_contours(raster)
    for b in beaches:
        raster.fill_poly([(b[i], b[i + 1]) for i in range(0, len(b), 2)], CLS_BEACH)
    beach_fringe(raster, 9)
    for wpoly in waters:
        raster.fill_poly([(wpoly[i], wpoly[i + 1]) for i in range(0, len(wpoly), 2)], CLS_WATER)
    for r in roads:
        cls = CLS_PASEO if r["cls"] == "paseo" else \
              CLS_BRIDGE if r.get("bridge") else CLS_ROAD
        raster.stamp_polyline(r["pts"], r["w"], cls)
    if bridge_road:
        raster.stamp_polyline(bridge_road["pts"], bridge_road["w"] + 6, CLS_BRIDGE)

    hist = defaultdict(int)
    for v in grid:
        hist[CLASS_NAMES[v]] += 1
    log("grid", f"class histogram: {dict(hist)}")

    # --- shore arrays (px) per grid column
    topY, botY = [], []
    for c in range(GRID_COLS):
        t, b = CENTER_Y, CENTER_Y
        for r in range(GRID_ROWS):
            if grid[r * GRID_COLS + c] != CLS_WATER:
                t = r * GRID_CELL
                break
        for r in range(GRID_ROWS - 1, -1, -1):
            if grid[r * GRID_COLS + c] != CLS_WATER:
                b = (r + 1) * GRID_CELL
                break
        topY.append(t)
        botY.append(b)
    def medfilt(a):
        out = list(a)
        for i in range(2, len(a) - 2):
            out[i] = sorted(a[i - 2:i + 3])[2]
        return out
    topY, botY = medfilt(topY), medfilt(botY)

    return grid, land_contours, topY, botY


def resolve_districts(ctx, *, sp):
    CANVAS_W, CANVAS_H = ctx.dims.w, ctx.dims.h
    # --- districts
    bounds_x = []
    for ll in DISTRICT_BOUNDS_GEO:
        x, y, _, _ = sp.project(to_m(*ll))
        bounds_x.append(round(x))
    if bounds_x != sorted(bounds_x):
        raise SystemExit(f"[districts] boundaries not monotonic: {bounds_x}")
    edges = [0] + bounds_x + [CANVAS_W]
    districts = []
    for i, d in enumerate(DISTRICT_DEFS):
        districts.append({**d, "x0": edges[i], "x1": edges[i + 1]})
    # Inland barrios: real 2-D bbox regions off the peninsula.
    for d in INLAND_DISTRICT_DEFS:
        la0, lo0, la1, lo1 = d["bbox"]
        xa, ya, _, _ = sp.project(to_m(la0, lo0))
        xb, yb, _, _ = sp.project(to_m(la1, lo1))
        x0, x1 = sorted([round(xa), round(xb)])
        y0, y1 = sorted([round(ya), round(yb)])
        x0 = max(0, min(CANVAS_W, x0)); x1 = max(0, min(CANVAS_W, x1))
        y0 = max(0, min(CANVAS_H, y0)); y1 = max(0, min(CANVAS_H, y1))
        districts.append({"id": d["id"], "name": d["name"], "short": d["short"],
                          "tone": d["tone"], "x0": x0, "x1": x1, "y0": y0, "y1": y1})
    log("districts", "" + ", ".join(f"{d['id']}:{d['x0']}-{d['x1']}" for d in districts))

    return districts, bounds_x
