#!/usr/bin/env python3
# build_world.py — La Ruta del Churchill world builder.
#
# Parses docs/map.osm (real OpenStreetMap export of Puntarenas, Costa Rica)
# and emits src/world2d/: a faithful, TRUE-SCALE 2-D map of the peninsula from
# El Faro to Caldera, as per-tile RLE surface slabs + a manifest the game
# streams by camera region.
#
# Projection: PLANAR. World px = (metres - origin) · PLANAR_PX_PER_M, so the
# map keeps real proportions and a geo→world affine ships in the manifest.
# (The old "corridor unroll" — a smoothed spine with x = arclength along it —
# was removed once the planar world shipped; see docs/changelog/.)
#
# Stdlib only (no PIL/shapely). Usage:  python3 tools/build_world.py [--debug]
# Every step must keep the output byte-identical: tools/world_snapshot.py.

import xml.etree.ElementTree as ET
import base64
import json
import math
import os
import struct
import sys
import time
import zlib
from collections import defaultdict, deque

# The knobs, the map content and the build log live in the package now — this
# script is the CLI in front of them (and will shrink to just that as the
# services land). sys.path shim: the repo root holds `churchill/`, and
# `pnpm world:build` runs this file directly rather than an installed console
# script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from churchill.world.config import (            # noqa: E402
    ACERA_CELLS, ARCADE_STREET_MUL, BUILDING_SCALE, CLASS_NAMES,
    CLS_ACERA, CLS_BEACH, CLS_BRIDGE, CLS_LAND, CLS_PASEO, CLS_ROAD, CLS_WATER,
    BLDG_INSET, DRIVABLE_CLASSES, LEON_END_STREET, MUELLE_STREET,
    PASEO_LEON, PASEO_MEDIAN_W, PASEO_TURISTAS, STREET_CLASSES, SYNTH_MAX_TOTAL,
    CROSS_EXAG, CUAD, CUADS_PER_VIEW, CUAD_CELLS, DEBUG_PNG, DEBUG_SVG,
    DP_BUILDING_PX, DP_COAST_PX, DP_ROAD_PX, DROP_ROAD_CLASSES,
    FIELD_ACERA_CELLS, GRID_CELL, LAT0, LON0, M_PER_DEG_LAT, M_PER_DEG_LON,
    MIN_BUILDING_AREA_PX2, OSM_PATH, PLANAR_BBOX, PLANAR_PX_PER_M,
    POI_NUDGE_PX, ROAD_CLASSES, ROAD_WIDTH_M, ROOT, SERVICE_MIN_PX,
    TILE_CELLS, TILE_CUADS, TILE_PX, WORLD2D_DIR, road_width_px,
)
from churchill.world.content import (           # noqa: E402
    BLDG_PALETTE, CUSTOMER_DEFS, DISTRICT_BOUNDS_GEO, DISTRICT_DEFS,
    INLAND_DISTRICT_DEFS, LANDMARK_DEFS, PROBE_LAND, PROBE_SEA, ROOF_PALETTE,
    STAGES,
)
from churchill.world.logging import log, warn   # noqa: E402



from churchill.world.pipeline.emit import emit_world2d  # noqa: E402
from churchill.world.pipeline.extract import extract_world  # noqa: E402
from churchill.world.pipeline.finish import (  # noqa: E402
    build_meta, verify, write_world,
)
from churchill.world.repository.debug_render import render_debug  # noqa: E402
from churchill.world.repository.osm_file import OsmFileRepository  # noqa: E402
from churchill.world.repository.world_json import JsonWorldRepository  # noqa: E402
from churchill.world.service.field import FieldService  # noqa: E402
from churchill.world.service.building import (  # noqa: E402
    _grid_placer, make_rng, snap_osm_buildings, synth_buildings,
)
from churchill.world.service.projection import (  # noqa: E402
    planar_setup, project_way_pts,
)
from churchill.world.service.surface import (   # noqa: E402
    acera_fringe, beach_fringe, raster_coast_barrier, raster_poly_barrier,
    stamp_pad, trace_land_contours,
)
from churchill.world.service.block import (    # noqa: E402
    block_raster_cells, cells_to_rects, cuadra_cells, detect_blocks, outline_poly,
)
from churchill.world.service.placement import (  # noqa: E402
    block_containing, cell_class, drivable_cell, kiosk_frontage,
    nearest_block, nearest_cell, resolve_poi, road_adj,
)
from churchill.world.service.placement import (  # noqa: E402
    near_drivable as _near_drivable,
    nudge_off_acera,
    nudge_to_land as _nudge_to_land,
    snap_into_block as _snap_into_block,
    snap_into_block_cell as _snap_into_block_cell,
)
from churchill.world.service.osm import (      # noqa: E402
    barro_leon_continuation, extract_areas, extract_buildings,
    extract_coastlines, extract_pois, extract_rails, extract_roads,
    propagate_barro_to_crossings,
)
from churchill.world.service.decoration import (  # noqa: E402
    paseo_median_runs, paseo_roads, stamp_paseo_median,
)
from churchill.world.service.network import (  # noqa: E402
    block_census, largest_drivable_component, verify_connectivity,
)
from churchill.world.service.street import (   # noqa: E402
    StreetIndex, half_plane, resample_centerline,
)
from churchill.world.util.raster import (     # noqa: E402
    Raster, erode_cells, rle_encode,
)
from churchill.world.util.geometry import (   # noqa: E402
    clip_poly_to_rect, clip_polyline_to_rect, dist, dp_simplify, flat_bbox,
    flat_centroid, pairs, point_in_poly, poly_area, poly_centroid,
    principal_axis, to_m,
)


# ----------------------------------------------------------------- parse ---

# OSM keys that make an object a real-world POINT OF INTEREST (a business, a
# civic building, a park...). Order matters: the first match names the category.
def planar_muelle_axis(roads, near_x, near_y, reach=1500):
    """PLANAR pier anchor: the muelle juts south from the END of Calle Central,
    the street at the Paseo de los Turistas east entry. Among road pieces named
    'calle central' near the muelle geo anchor (the OSM name also exists in
    Esparza/Barranca — hence the proximity filter), return the southernmost
    point's x (and y) — i.e. the end of that road at the shore."""
    best = None
    for r in roads:
        if (r.get("name") or "").lower() != MUELLE_STREET:
            continue
        p = r["pts"]
        for i in range(0, len(p), 2):
            x, y = p[i], p[i + 1]
            if abs(x - near_x) > reach or abs(y - near_y) > reach:
                continue
            if best is None or y > best[1]:
                best = (x, y)
    return best


def main():
    t0 = time.time()
    ctx, raw_bldgs, bridge_road = extract_world(OsmFileRepository(OSM_PATH))
    # The stage owns the context; these locals are the same objects, kept while
    # the remaining phases still read them by their old names.
    sp, dims = ctx.projection, ctx.dims
    CANVAS_W, CANVAS_H, CENTER_Y = dims.w, dims.h, dims.center_y
    GRID_COLS, GRID_ROWS = dims.cols, dims.rows
    nodes, ways, named, rels, poi_nodes = (ctx.nodes, ctx.ways, ctx.named,
                                           ctx.relations, ctx.poi_nodes)
    roads, rails, pois = ctx.roads, ctx.rails, ctx.pois
    beaches, waters = ctx.beaches, ctx.waters
    junction_islands = []

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

    # --- POI resolution
    resolve = lambda spec: resolve_poi(named, spec)

    main_net = largest_drivable_component(raster)

    near_drivable = lambda c, r, reach=ACERA_CELLS + 1: _near_drivable(raster, main_net, c, r, reach)

    nudge_to_land = lambda x, y, radius_px=POI_NUDGE_PX, need_drivable=False: _nudge_to_land(raster, near_drivable, x, y, radius_px, need_drivable)

    # Building landmarks (church, market, hotel…) must sit INSIDE a cuadra, not
    # on the street. From a drivable anchor, walk into the nearest block
    # interior (CLS_LAND) so the footprint fronts the road it was next to.
    # (the estadio is NOT a building landmark: its anchor must stay put so the
    # dedicated stadium pass can grow the footprint from it — snapping it into
    # a block interior is what left the fallback rect straddling streets)
    BUILDING_LM = {"church", "cathedral", "market", "super", "hotel", "civic",
                   "house", "museum", "restaurant"}
    # Scenery that must NOT get a drivable apron: buildings above + green areas
    # (parks/pool). The stadium is placed by place_stadium (its own drivable
    # pitch) so it gets no apron here either. Excluded from the reachability gate.
    NO_PAD_LM = BUILDING_LM | {"park", "pool", "stadium"}
    _drivable_cell = lambda c, r: drivable_cell(raster, c, r)
    snap_into_block = lambda x, y, reach_px=160, inset_px=32: _snap_into_block(raster, x, y, reach_px, inset_px)

    landmarks, failures = [], []
    for spec in LANDMARK_DEFS:
        pm, how = resolve(spec)
        if pm is None:
            failures.append(spec["id"])
            continue
        x, y, _, _ = sp.project(pm)
        x += spec.get("dx", 0)
        y += spec.get("dy", 0)
        # every landmark must sit near the street network so its stamped pad
        # merges with it (a pad enclosed by solid land is unreachable in-game)
        pos = nudge_to_land(x, y, need_drivable=True)
        if pos is None:
            failures.append(spec["id"] + "(water)")
            continue
        # NB: building landmarks get repositioned INTO their cuadra later, once
        # roads + aceras are rasterized into the grid (snap_into_block needs the
        # final surface classes to find real block interior).
        landmarks.append({"id": spec["id"], "name": spec["name"], "x": round(pos[0]),
                          "y": round(pos[1]), "type": spec["type"], "district": spec["district"],
                          "_how": how})
    # Customers: nudge to land, then ENFORCE spread so every delivery is a
    # real trip — ≥150px from any kiosk, ≥120px from every other customer.
    MIN_FROM_KIOSK, MIN_BETWEEN = 450, 360
    kiosk_pts = [(l["x"], l["y"]) for l in landmarks if l["type"] == "kiosk"]
    dist_edges = {d["id"]: (d["x0"], d["x1"]) for d in districts}

    def spread_ok(x, y, placed):
        if any((x - kx) ** 2 + (y - ky) ** 2 < MIN_FROM_KIOSK ** 2 for kx, ky in kiosk_pts):
            return False
        return all((x - c["x"]) ** 2 + (y - c["y"]) ** 2 >= MIN_BETWEEN ** 2 for c in placed)

    customers = []
    for spec in CUSTOMER_DEFS:
        x, y, _, _ = sp.project(to_m(*spec["ll"]))
        pos = nudge_to_land(x, y, need_drivable=True)
        if pos is None:
            failures.append(spec["id"] + "(water)")
            continue
        px, py = pos
        if not spread_ok(px, py, customers):
            x0, x1 = dist_edges[spec["district"]]
            found = None
            for rad in range(24, 1920, 16):       # expanding ring, nearest wins
                cands = []
                for a in range(0, 360, 20):
                    tx = px + rad * math.cos(math.radians(a))
                    ty = py + rad * math.sin(math.radians(a))
                    if not (x0 + 20 <= tx <= x1 - 20):
                        continue
                    c, r = int(tx / GRID_CELL), int(ty / GRID_CELL)
                    if not (0 <= c < GRID_COLS and 0 <= r < GRID_ROWS):
                        continue
                    if grid[r * GRID_COLS + c] == CLS_WATER or not near_drivable(c, r):
                        continue
                    if spread_ok(tx, ty, customers):
                        cands.append((abs(tx - px) + abs(ty - py), tx, ty))
                if cands:
                    found = min(cands)
                    break
            if found is None:
                failures.append(spec["id"] + "(crowded)")
                continue
            px, py = found[1], found[2]
        customers.append({"id": spec["id"], "name": spec["name"], "x": round(px),
                          "y": round(py), "district": spec["district"], "line": spec["line"]})
    if failures:
        log("poi", f"WARNING — unplaced (fix geo anchors): {failures}")
    # assert stage refs exist
    lm_ids = {l["id"] for l in landmarks}
    cu_ids = {c["id"] for c in customers}
    for st in STAGES:
        for k in st["kiosks"]:
            if k not in lm_ids:
                failures.append(f"stage {st['id']} kiosk {k}")
        for c in st["customers"]:
            if c not in cu_ids:
                failures.append(f"stage {st['id']} customer {c}")
    for lm in landmarks:
        how = lm.pop("_how")
        log("poi", f"{lm['id']:<12} ({how:4}) -> {lm['x']},{lm['y']} [{lm['district']}]")

    # --- Muelle (the long pier into the gulf, faithful to muelle-nacional)
    mlm = next(l for l in landmarks if l["id"] == "muellecruc")
    # anchor to the real Calle Central south end (the road at the Paseo's
    # east entry)
    end = planar_muelle_axis(roads, mlm["x"], mlm["y"])
    if end is not None:
        mlm["x"] = round(end[0])
        log("pier", f"planar anchor: Calle Central south end at x={mlm['x']}")
    else:
        warn("pier", "Calle Central not found near the muelle anchor")
    pier_col = min(GRID_COLS - 1, max(0, int(mlm["x"] / GRID_CELL)))
    pier_y0 = botY[pier_col] - 6
    pier = {"x": mlm["x"], "y0": round(pier_y0),
            "y1": round(min(CANVAS_H - 30, pier_y0 + 630)), "w": 2 * CUAD}
    # Stamp the drivable strip flush with the DRAWN deck: raster_stamp_polyline
    # adds a round cap of radius w/2 past the last point, so pull the sea end
    # back by w/2 — otherwise ~20px of drivable cells sit past the visible deck.
    raster.stamp_polyline([pier["x"], pier["y0"], pier["x"], pier["y1"] - pier["w"] / 2],
                          pier["w"], CLS_BRIDGE)
    # connect the pier base to the street grid (walk north to the first road)
    pc = int(pier["x"] // GRID_CELL)
    pr = int(pier_y0 // GRID_CELL)
    for r in range(pr, max(0, pr - 120), -1):
        if grid[r * GRID_COLS + pc] in (CLS_ROAD, CLS_PASEO):
            raster.stamp_polyline([pier["x"], r * GRID_CELL,
                                         pier["x"], pier["y0"]], 2 * CUAD, CLS_ROAD)
            log("pier", f"connector road to y={r * GRID_CELL}")
            break
    mlm["x"], mlm["y"] = pier["x"], round(pier_y0 - 16)
    log("pier", f"muelle at x={pier['x']}, y {pier['y0']}..{pier['y1']}")

    # --- aceras (sidewalks) + plaza pads: these define where you can drive
    # off-street; everything left as CLS_LAND becomes solid cuadra interior
    acera_fringe(raster)

    # --- Kiosk placement: real aceras are respected everywhere (walls), so
    #   (a) kiosks sitting mid-lane shift onto the adjacent sidewalk, and
    #   (b) BEACH kiosks get a drivable SAND PATH from the nearest street so
    #       you can actually reach them. Runs BEFORE the pad stamp so the apron
    #       lands at the final position.
    _cell_cls = lambda cc, cr: cell_class(raster, cc, cr)
    _nearest_cell = lambda x, y, classes, max_cells: nearest_cell(raster, x, y, classes, max_cells)
    # BEACH kiosks: keep them on the sand and carve a drivable SAND PATH from the
    # nearest street. TOWN kiosks are re-seated INSIDE a cuadra (on the frontage
    # cell nearest a street) with a paved connector — done after block detection
    # below, so nothing is left mid-lane.
    kiosk_paths = []
    beach_kiosks = set()
    # Paseo stands stay pinned where their dy put them (between the Paseo and
    # the sand) — treated like beach kiosks so the frontage pass never re-seats
    # them across the street; their connector may target the Paseo itself.
    PINNED_KIOSKS = {"kios_paseo1", "kios_paseo2"}
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm["id"] == "kios_faro":
            continue                                    # kios_faro goes on the muelle below
        kx, ky = lm["x"], lm["y"]
        surf = _cell_cls(int(kx // GRID_CELL), int(ky // GRID_CELL))
        pinned = lm["id"] in PINNED_KIOSKS
        if surf == CLS_BEACH or pinned:
            classes = (CLS_ROAD, CLS_PASEO, CLS_BRIDGE) if pinned else (CLS_ROAD, CLS_BRIDGE)
            tgt = _nearest_cell(kx, ky, classes, 260)
            if tgt:
                raster.stamp_polyline([kx, ky, tgt[0], tgt[1]], 1.4 * CUAD, CLS_ROAD)
                kiosk_paths.append({"pts": [round(kx), round(ky), round(tgt[0]), round(tgt[1])],
                                    "surface": "paved"})
                log("kiosk", f"{'pinned' if pinned else 'sand'} path {lm['id']} "
                      f"(surf {surf}) -> street ({round(tgt[0])},{round(tgt[1])})")
            beach_kiosks.add(lm["id"])

    for lm in landmarks:
        # scenery (buildings + green areas) gets NO drivable apron; kiosks get
        # theirs in the cuadra-frontage pass after block detection
        if lm["type"] in NO_PAD_LM or lm["type"] == "kiosk":
            continue
        stamp_pad(raster, lm["x"], lm["y"], 48)
    for cu in customers:
        stamp_pad(raster, cu["x"], cu["y"], 56)
    faro_lm = next((l for l in landmarks if l["id"] == "faro"), None)
    faro_pier = None
    faro_esp = None
    if faro_lm:
        fx, fy = faro_lm["x"], faro_lm["y"]
        fcc0, fcr0 = int(fx // GRID_CELL), int(fy // GRID_CELL)
        # La Punta plaza: pave the SAND TIP following its NATURAL SHAPE (flood the
        # beach around the faro, bounded so it never reaches the street), then
        # VIRTUALLY EXTEND it a few cells into the sea so the shape is respected
        # and the muelle starts at the extended edge. Emitted as a gray
        # "esplanade" ground fill (single colour-by-type draw — no sand below).
        esp = set()
        seed = None
        for rad in range(0, 16):
            for a in range(0, 360, 15):
                cc = fcc0 + int(round(math.cos(math.radians(a)) * rad))
                cr = fcr0 + int(round(math.sin(math.radians(a)) * rad))
                if _cell_cls(cc, cr) == CLS_BEACH:
                    seed = (cc, cr); break
            if seed:
                break
        Rc = 34                                            # bound the tip (~136px)
        if seed:
            q = deque([seed]); esp.add(seed)
            while q:
                cc, cr = q.popleft()
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nb = (cc + dc, cr + dr)
                    if nb in esp or (nb[0] - fcc0) ** 2 + (nb[1] - fcr0) ** 2 > Rc * Rc:
                        continue
                    if _cell_cls(*nb) == CLS_BEACH:        # follow the SAND only
                        esp.add(nb); q.append(nb)
        esp.add((fcc0, fcr0))
        for _ in range(7):                                 # dilate into the sea
            add = set()
            for (cc, cr) in esp:
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    nb = (cc + dc, cr + dr)
                    if nb not in esp and _cell_cls(*nb) == CLS_WATER:
                        add.add(nb)
            esp |= add
        for (cc, cr) in esp:
            if 0 <= cc < GRID_COLS and 0 <= cr < GRID_ROWS:
                grid[cr * GRID_COLS + cc] = CLS_ACERA       # pedestrian plaza (NON-drivable)
        faro_esp = esp
        ecc0 = min(c for c, _ in esp); ecc1 = max(c for c, _ in esp)
        ecr0 = min(r for _, r in esp); ecr1 = max(r for _, r in esp)
        faro_lm["plaza"] = [ecc0 * GRID_CELL, ecr0 * GRID_CELL,
                            (ecc1 - ecc0 + 1) * GRID_CELL, (ecr1 - ecr0 + 1) * GRID_CELL]
        espl = sorted(esp)                                 # comma islands across the shape
        faro_lm["commas"] = [[int((espl[(i * len(espl)) // 12][0] + 0.5) * GRID_CELL),
                              int((espl[(i * len(espl)) // 12][1] + 0.5) * GRID_CELL)] for i in range(12)]
        # riprap rim: only the esplanade cells that border the SEA (so the rocks
        # follow the real sand/water edge, never a bbox circle into the town)
        rim = [c for c in esp if any(_cell_cls(c[0] + dc, c[1] + dr) == CLS_WATER
               for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)))]
        rim.sort(key=lambda c: math.atan2(c[1] - fcr0, c[0] - fcc0))
        rstep = max(1, len(rim) // 46)
        faro_lm["rim"] = [[int((rim[i][0] + 0.5) * GRID_CELL), int((rim[i][1] + 0.5) * GRID_CELL)]
                          for i in range(0, len(rim), rstep)]
        # Faro muelle: jut SOUTH-WEST from the beach line (the edge of the paved
        # tip) into the open water, kiosk at the sea end; the player spawns on it.
        scc, scr = fcc0, fcr0                              # walk SW to the water's edge
        for _ in range(60):
            if _cell_cls(scc - 1, scr + 1) == CLS_WATER:
                break
            scc -= 1; scr += 1
        sx, sy = scc * GRID_CELL, scr * GRID_CELL          # muelle base (beach line)
        ex, ey = sx - 7 * CUAD, sy + 7 * CUAD              # SW sea end
        pw = 2 * CUAD
        # pull the stamped sea end back by w/2 so its round cap doesn't leave
        # drivable cells past the drawn deck (car can't drive off the sea end)
        _pl = math.hypot(ex - sx, ey - sy) or 1.0
        _sex = ex - (ex - sx) / _pl * (pw / 2); _sey = ey - (ey - sy) / _pl * (pw / 2)
        raster.stamp_polyline([sx, sy, _sex, _sey], pw, CLS_BRIDGE)
        faro_pier = {"x0": int(ex), "y0": int(ey), "x1": int(sx), "y1": int(sy), "w": int(pw)}
        # ONE drivable lane tying the muelle base to the nearest loop road (the
        # pedestrian plaza itself stays non-drivable); drawn asphalt.
        aux = None
        for rad in range(4, 70):
            for a in range(0, 360, 10):
                cc = fcc0 + int(round(math.cos(math.radians(a)) * rad))
                cr = fcr0 + int(round(math.sin(math.radians(a)) * rad))
                if (cc, cr) not in esp and _cell_cls(cc, cr) in (CLS_ROAD, CLS_PASEO):
                    aux = (cc, cr); break
            if aux:
                break
        if aux:
            axp, ayp = (aux[0] + 0.5) * GRID_CELL, (aux[1] + 0.5) * GRID_CELL
            # straight lane from the muelle base to the road (the lighthouse sits
            # to its left/west, over on the tip)
            raster.stamp_polyline([sx, sy, axp, ayp], round(1.6 * CUAD), CLS_ROAD)
            kiosk_paths.append({"pts": [int(sx), int(sy), round(axp), round(ayp)], "surface": "paved"})
            log("pier", f"faro drivable lane -> ({round(axp)},{round(ayp)})")
        kf = next((l for l in landmarks if l["id"] == "kios_faro"), None)
        if kf:
            kf["x"] = int(sx + 0.85 * (ex - sx)); kf["y"] = int(sy + 0.85 * (ey - sy))   # sea end
            kf["spawn"] = [int(sx + 0.4 * (ex - sx)), int(sy + 0.4 * (ey - sy))]         # on the deck
            beach_kiosks.add("kios_faro")                     # skip the frontage pass
        # Nudge the drawn lighthouse NORTH-WEST so the tower no longer sits on top
        # of the drivable connection lane (which runs SW→NE). NW is perpendicular
        # to that lane, so the faro clears it to the left; the esplanade / commas /
        # rim / muelle geometry all stay put (already computed from the original
        # anchor above). Kept modest so the faro stays within the reachability
        # gate's acera reach of the lane (≤ ACERA_CELLS+1 cells from drivable).
        faro_lm["x"] = int(faro_lm["x"] - 1.6 * CUAD)
        faro_lm["y"] = int(faro_lm["y"] - 1.6 * CUAD)
        log("pier", f"faro muelle SW ({sx},{sy})->({ex},{ey}); esplanade {len(esp)} cells; "
              f"faro icon -> ({faro_lm['x']},{faro_lm['y']})")
    # Hand-placed junction islands: medians carve non-drivable acera, cuadras
    # carve solid land — stamped last so they override the road/apron beneath.
    for isl in junction_islands:
        raster.fill_poly(isl["pts"], CLS_ACERA if isl["kind"] == "median" else CLS_LAND)
    acera_cells = sum(1 for v in grid if v == CLS_ACERA)
    log("acera", f"{acera_cells} sidewalk cells; {len(junction_islands)} junction islands")

    # --- cuadrícula blocks: classify land into cuadras / paved plazas / green.
    # The Faro + Carmen barrios by the lighthouse have a fine street grid whose
    # small cuadras would pave to green plazas — keep them BUILDABLE (houses)
    # out to the east edge of Carmen so the tip reads as a town, not a lawn.
    faro_band_x1 = next((d["x1"] for d in districts if d["id"] == "carmen"),
                        next((d["x1"] for d in districts if d["id"] == "faro"), None))
    blocks, plazas = detect_blocks(raster, build_band_x1=faro_band_x1)
    # Faro esplanade: paint the paved sand-tip as a gray ground fill by TYPE
    # (single draw — no sand shows under it; follows the sand, never the street).
    if faro_esp:
        plazas.extend([r + ["esplanade"] for r in cells_to_rects(faro_esp, GRID_CELL)])

    # Step each building landmark off its street anchor into a cuadra INTERIOR
    # cell — nearest block, cell ≥1 cuadrícula from any edge so it clears the
    # acera fringe and sits solidly inside the block (church-in-the-street fix).
    snap_into_block_cell = lambda x, y, max_d_cuads=8: _snap_into_block_cell(blocks, x, y, max_d_cuads)
    n_snap = 0
    for lm in landmarks:
        if lm["type"] not in BUILDING_LM:
            continue
        inb = snap_into_block_cell(lm["x"], lm["y"])
        if inb is not None:
            lm["x"], lm["y"] = round(inb[0]), round(inb[1])
            n_snap += 1
    log("poi", f"{n_snap} building landmarks snapped into cuadra interiors")

    # Building POIs often keep their geo anchor (dense/sliver cuadras make the
    # snap above return None) and land on the acera fringe or a street — the icon
    # then straddles the sidewalk. Pull each to the NEAREST grid point with as
    # much solid-land clearance as its cuadra allows (±16 px if possible, down to
    # ±8 px), so the icon sits inside the block, not on the sidewalk.
    _nudge_off_acera = lambda x, y, reach_cells=16: nudge_off_acera(raster, x, y, reach_cells)
    n_nudge = 0
    for lm in landmarks:
        if lm["type"] not in BUILDING_LM:             # all cuadra buildings, not just civic
            continue
        nx, ny = _nudge_off_acera(lm["x"], lm["y"])
        if round(nx) != lm["x"] or round(ny) != lm["y"]:
            lm["x"], lm["y"] = round(nx), round(ny)
            n_nudge += 1
    log("poi", f"{n_nudge} building landmarks nudged off the acera fringe")

    # A green block's ground is emitted as ONE raster-resolution outline
    # polygon (4 px cells, so it follows the acera inner edge — curves and
    # diagonal streets included). The renderer fills it and dilates it a few px
    # under the painted acera band, so lawns meet the sidewalks with no sand
    # slivers and none of the blocky cuadrícula steps of the old rect fill.
    _block_raster_cells = lambda cells: block_raster_cells(raster, cells, CUAD_CELLS, CLS_LAND)
    _outline_poly = lambda cells: outline_poly(cells, GRID_CELL)

    def _green_poly(cells, typ):
        poly = _outline_poly(_block_raster_cells(cells))
        return {"pts": poly, "type": typ} if poly else None
    greens = []
    balneario = None          # sea-water inlet bbox (boat + swimmers spawn inside)
    balneario_cells = None    # its cuad cells → added to `occ` once that exists
    marine_site = None        # Parque Marino: {lm, cells, grass} → real OSM footprints + tanks

    _block_containing = lambda x, y: block_containing(blocks, x, y)

    # --- TOWN kiosks: seat each on a NEARBY cuadra FRONTAGE cell (solid land next
    # to a street, never the roadway/acera/median) and carve a short paved
    # connector + apron to the nearest street. Bounded to a small radius so a
    # kiosk with no cuadra beside it (e.g. on the Paseo boardwalk) stays put and
    # just gets the pad+connector instead of teleporting to a far block.
    KIOSK_SNAP_CUAD = 10                       # ≤ this many cuadrículas from anchor
    nongreen_blocks = []
    for b in blocks:
        if b.get("green"):
            continue
        cs = b["cells"]
        bc0 = min(c for c, _ in cs); bc1 = max(c for c, _ in cs)
        br0 = min(r for _, r in cs); br1 = max(r for _, r in cs)
        nongreen_blocks.append((bc0, bc1, br0, br1, cs))

    _road_adj = lambda cc, cr: road_adj(raster, cc, cr)

    _kiosk_frontage = lambda x, y: kiosk_frontage(raster, nongreen_blocks, KIOSK_SNAP_CUAD, x, y)
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm["id"] in beach_kiosks:
            if lm["type"] == "kiosk":
                stamp_pad(raster, lm["x"], lm["y"], 44)   # apron for the beach stand
            continue
        spot = _kiosk_frontage(lm["x"], lm["y"])
        if spot:
            lm["x"], lm["y"] = round(spot[0]), round(spot[1])
        stamp_pad(raster, lm["x"], lm["y"], 44)            # drivable pocket
        tgt = _nearest_cell(lm["x"], lm["y"], (CLS_ROAD, CLS_BRIDGE, CLS_PASEO), 60)
        if tgt:
            raster.stamp_polyline([lm["x"], lm["y"], tgt[0], tgt[1]], 1.4 * CUAD, CLS_ROAD)
            kiosk_paths.append({"pts": [round(lm["x"]), round(lm["y"]),
                                        round(tgt[0]), round(tgt[1])], "surface": "paved"})
            log("kiosk", f"{lm['id']} -> cuadra frontage ({lm['x']},{lm['y']}), paved connector")

    # Player spawn per kiosk: run starts place the player beside the run's first
    # kiosk. Snap that point to the nearest DRIVABLE street cell now (build time,
    # so modes.js never spawns on the beach beside a sand kiosk and never probes
    # tiles that aren't resident yet). kios_faro keeps its muelle-deck spawn.
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm.get("spawn"):
            continue
        tgt = _nearest_cell(lm["x"], lm["y"], (CLS_ROAD, CLS_BRIDGE, CLS_PASEO), 260)
        if tgt:
            lm["spawn"] = [round(tgt[0]), round(tgt[1])]
        else:
            log("kiosk", f"WARN no street spawn near {lm['id']} ({lm['x']},{lm['y']})")

    # OSM parks (parquemar, cocal_park) + the Balneario pool: paint their green
    # on the containing block's footprint so the cuadra is OPEN (no buildings),
    # tagged by type for the renderer's colour-by-type fill.
    _nearest_block = lambda x, y, min_cells=12: nearest_block(blocks, x, y, min_cells)
    for lm in landmarks:
        if lm["type"] not in ("park", "pool"):
            continue
        bi = _block_containing(lm["x"], lm["y"])
        if bi is None and lm["type"] == "pool":
            bi = _nearest_block(lm["x"], lm["y"])   # the Balneario must sit IN a cuadra
        if bi is None:
            continue
        blocks[bi]["green"] = True
        cells = blocks[bi]["cells"]
        bc0 = min(c for c, _ in cells); bc1 = max(c for c, _ in cells)
        br0 = min(r for _, r in cells); br1 = max(r for _, r in cells)
        if lm["type"] == "pool":
            # The Balneario is a SEA-WATER inlet: the whole cuadra becomes open
            # water (drawn with the living-sea effect, no pool graphic). Keep OSM
            # buildings off it (occ, applied once occ exists), stamp the interior
            # CLS_WATER, and emit its outline into `waters` so it renders exactly
            # like the ocean. A boat + swimmers spawn inside its bbox
            # (maintainBalneario).
            balneario_cells = list(cells)
            g = _green_poly(cells, "pool")
            if g:
                wp = g["pts"]
                waters.append([round(v) for v in wp])
                raster.fill_poly([(wp[i], wp[i + 1]) for i in range(0, len(wp), 2)], CLS_WATER)
            ccx = sum(c for c, _ in cells) / len(cells); ccy = sum(r for _, r in cells) / len(cells)
            tcx, tcy = min(cells, key=lambda c: (c[0] - ccx) ** 2 + (c[1] - ccy) ** 2)
            lm["x"] = int((tcx + 0.5) * CUAD); lm["y"] = int((tcy + 0.5) * CUAD)
            px0, py0 = bc0 * CUAD, br0 * CUAD
            px1, py1 = (bc1 + 1) * CUAD, (br1 + 1) * CUAD
            lm["w"] = px1 - px0; lm["h"] = py1 - py0
            balneario = {"x0": px0, "y0": py0, "x1": px1, "y1": py1,
                         "cx": lm["x"], "cy": lm["y"]}
            continue
        marine = lm["id"] == "parquemar"     # Parque Marino fills its whole cuadra
        g = _green_poly(cells, "marine" if marine else "park")
        if g: greens.append(g)
        lm["x"] = (bc0 + bc1 + 1) * CUAD // 2; lm["y"] = (br0 + br1 + 1) * CUAD // 2
        if marine:
            lm["marine"] = True
            lm["w"] = (bc1 - bc0 + 1) * CUAD; lm["h"] = (br1 - br0 + 1) * CUAD
            # The aquarium is a REAL place: its own OSM buildings are kept at
            # their true footprints (see marine_site below) instead of snapped
            # into generic cuadrícula boxes, and the tanks are placed after them
            # so a tank can never end up under a building or on the acera.
            marine_site = {"lm": lm, "cells": set(cells),
                           "grass": _block_raster_cells(cells)}
        else:
            lm["w"] = min(160, (bc1 - bc0 + 1) * CUAD); lm["h"] = min(140, (br1 - br0 + 1) * CUAD)

    # Synthetic parks: scatter green spaces (each with a fountain) across the
    # town so parks aren't rare. Pick well-sized cuadras clear of other POIs,
    # mark them green (no synth buildings), and add a park landmark sized to
    # the block. Spatially spread by sorting candidates on x.
    _pts = [(l["x"], l["y"]) for l in landmarks] + [(c["x"], c["y"]) for c in customers]
    def _dcls(cc, cr):
        d = {d["id"]: (d["x0"], d["x1"]) for d in districts}
        for did, (x0, x1) in d.items():
            if x0 <= cc * CUAD < x1:
                return did
        return districts[0]["id"]
    park_cands = []
    for bi, b in enumerate(blocks):
        if b.get("green"):
            continue
        cells = b["cells"]; sz = len(cells)
        if sz < 6 or sz > 160:              # a small-to-mid cuadra (green render covers it)
            continue
        bc0 = min(c for c, _ in cells); bc1 = max(c for c, _ in cells)
        br0 = min(r for _, r in cells); br1 = max(r for _, r in cells)
        cx = (bc0 + bc1 + 1) * CUAD // 2; cy = (br0 + br1 + 1) * CUAD // 2
        if any((cx - px) ** 2 + (cy - py) ** 2 < 220 ** 2 for px, py in _pts):
            continue
        w = min(300, (bc1 - bc0 + 1) * CUAD); h = min(240, (br1 - br0 + 1) * CUAD)
        park_cands.append((cx, cy, bi, w, h))
    log("parks", f"{len(park_cands)} candidate blocks")
    park_cands.sort()
    TARGET_PARKS = 16
    n_park = 0
    if park_cands:
        step = max(1, len(park_cands) // TARGET_PARKS)
        for j in range(0, len(park_cands), step):
            if n_park >= TARGET_PARKS:
                break
            cx, cy, bi, w, h = park_cands[j]
            blocks[bi]["green"] = True       # keep the interior open (no buildings)
            # paint the park's green on the block footprint (never over streets)
            g = _green_poly(blocks[bi]["cells"], "park")
            if g: greens.append(g)
            landmarks.append({"id": f"park_syn_{n_park}", "name": "Parque",
                              "x": int(cx), "y": int(cy), "type": "park",
                              "district": _dcls(cx // CUAD, cy // CUAD),
                              "w": min(160, int(w)), "h": min(140, int(h))})
            _pts.append((cx, cy))
            n_park += 1
    log("parks", f"+{n_park} synthetic parks scattered across the town")

    # The avenue's separators (final layout, user-iterated):
    # - Paseo de los Turistas: its classic PALM median — dashes with crossing
    #   gaps aligned to the coming streets (paseo_median_runs).
    # - The kiosks street (Paseo León Cortés): ONE continuous tree strip from
    #   the first cuadra's corner (the Turistas→León Cortés curve stays fully
    #   drivable) up to just before the muelle street; beyond, normal street.
    tzx1 = mlm["x"] - 3 * CUAD          # stop clear of the muelle street

    def continuous_runs(pieces, x0=None, x1=None):
        out = []
        for r in pieces:
            samples = resample_centerline(r["pts"], 4.0)
            ks = [k for k, (_, x, _) in enumerate(samples)
                  if (x0 is None or x >= x0) and (x1 is None or x <= x1)]
            run = []
            for k in ks + [-99]:                 # sentinel flushes the tail
                if run and k != run[-1] + 1:
                    if len(run) >= 2:
                        out.append((samples, [(run[0], run[-1])]))
                    run = []
                run.append(k)
        return out

    turistas = [r for r in paseo_roads(roads)
                if PASEO_TURISTAS in (r.get("name") or "").lower()]
    leon = [r for r in paseo_roads(roads)
            if PASEO_LEON in (r.get("name") or "").lower()]

    # the tree strip starts at the SW corner of the first cuadra facing the
    # León Cortés stretch — never inside the curve that leads into it
    leon_cl = [(x, y) for r in leon
               for (_, x, y) in resample_centerline(r["pts"], 8.0)]
    lx0, lx1 = min(x for x, _ in leon_cl), max(x for x, _ in leon_cl)

    def _leon_y(x):
        return min(leon_cl, key=lambda p: abs(p[0] - x))[1]

    corner_xs = []
    for b in blocks:
        for (cc, cr) in b["cells"]:
            bx, by = cc * CUAD, (cr + 1) * CUAD          # cell SW corner
            if lx0 <= bx <= min(lx1, tzx1) and 0 < _leon_y(bx) - by <= 6 * CUAD:
                corner_xs.append(bx)
    tzx0 = min(corner_xs, default=lx0)
    log("median", f"León Cortés tree strip x{tzx0}-{tzx1} (cuadra corner start)")

    palm_runs = paseo_median_runs(roads, turistas)
    tree_runs = continuous_runs(leon, x0=tzx0, x1=tzx1)
    medians = stamp_paseo_median(raster, palm_runs + tree_runs)

    # --- buildings on the cuadrícula: snap OSM footprints, then fill the
    # cuadras' frontage bands with synth lots (shared occupancy, POI keepouts)
    keepouts = []
    for lm in landmarks:
        keepouts.append((lm["x"], lm["y"], 100 if lm["type"] == "kiosk" else 68))
    for cu in customers:
        keepouts.append((cu["x"], cu["y"], 100))
    keepouts.append((pier["x"], pier["y0"], 120))
    cell_block, occ = _grid_placer(blocks, keepouts)
    if balneario_cells:                 # keep OSM buildings off the Balneario water
        occ.update(balneario_cells)

    # --- Estadios: DRIVABLE green pitches placed on a named street-grid cuadra.
    # Lito Pérez = the block bounded by Calle 15-17 x Avenida 0-2 (actual size);
    # Las Playitas = Calle 6-8 x Avenida 1, extended NORTH so it reads vertical.
    # The pitch grid is stamped CLS_ROAD (you can drive on it — coins + NPCs
    # stream inside like Recorrer), interior cross-streets are clipped, and the
    # cuad footprint polygon + a "stadium" green poly are emitted for drawing.
    stadiums = []
    parcels = []        # named cuadra parts (church / plaza / sponsor lots)

    # Streets by name — one index, four questions (see the service for which
    # to use when: a MEAN coordinate, the coordinate AT a point, the street as
    # an infinite line, or its direction).
    streets = StreetIndex(roads)
    _street_vals = streets.vals
    _street_at = streets.at
    _street_edge = streets.edge
    _street_dir = lambda names, ref, axis, span=520: streets.direction(names, ref, axis, span)
    _half_plane = half_plane

    _cuadra_cells = lambda px0, py0, px1, py1, classes, clip=None: cuadra_cells(
        raster, px0, py0, px1, py1, classes, clip)

    # Erosion lives in util now; this binds it to THIS build's raster so the
    # directional test can read the class outside a boundary cell.
    def _erode_cells(cells, depth, facing=None):
        return erode_cells(cells, depth, facing, raster.at)

    # Aquarium tanks: farthest-point spread over grass cells that CLEAR both the
    # acera and every aquarium building. drawPool paints a 78x48 ellipse at
    # s=0.46 (~36x22 px) with a tree/palm at (px-26, py+12), so a tank needs
    # TANK_CLEAR px of lawn all round or it spills onto the sidewalk.
    TANK_CLEAR = 26
    def _place_marine_pools(site, raws, want=5):
        grass = site["grass"]                         # grass cells (CLS_LAND only)
        # distance (in cells) from every grass cell to the nearest non-grass one
        dist = {}
        q = deque()
        for cell in grass:
            c, rr = cell
            if any((c + dc, rr + dr) not in grass for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                dist[cell] = 1; q.append(cell)
        while q:
            c, rr = q.popleft()
            d = dist[(c, rr)] + 1
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (c + dc, rr + dr)
                if n in grass and n not in dist:
                    dist[n] = d; q.append(n)
        boxes = []
        for raw in raws:
            xs = [p[0] for p in raw["pts"]]; ys = [p[1] for p in raw["pts"]]
            boxes.append((min(xs) - TANK_CLEAR, min(ys) - TANK_CLEAR,
                          max(xs) + TANK_CLEAR, max(ys) + TANK_CLEAR))
        free = lambda px, py: not any(x0 <= px <= x1 and y0 <= py <= y1
                                      for (x0, y0, x1, y1) in boxes)
        # Relax the clearance until the lawn offers enough well-separated spots:
        # this block is cut by interior paths, so a hard 26 px leaves one pocket
        # and all five tanks pile up in it.
        cand = []
        for need in (TANK_CLEAR, 22, 18, 14, 10):
            r = need / GRID_CELL
            cand = [(c * GRID_CELL, rr * GRID_CELL) for (c, rr) in grass
                    if dist.get((c, rr), 0) >= r and not (c % 3 or rr % 3)
                    and free(c * GRID_CELL, rr * GRID_CELL)]
            if len(cand) >= want * 8:
                break
        if not cand:
            log("marino", "WARN no clear spot for the aquarium tanks"); return
        log("marino", f"{len(grass)} grass cells -> {len(cand)} tank candidates "
              f"at >={round(need)}px clearance")
        mx = sum(p[0] for p in cand) / len(cand); my = sum(p[1] for p in cand) / len(cand)
        pts = [min(cand, key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2)]
        while len(pts) < want and len(pts) < len(cand):
            pts.append(max(cand, key=lambda p: min((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 for q in pts)))
        site["lm"]["pools"] = [[int(p[0]), int(p[1])] for p in pts]

    # Estadios and parcels: one service over the world under construction.
    fields = FieldService(raster=raster, streets=streets, landmarks=landmarks,
                          blocks=blocks, greens=greens, plazas=plazas,
                          stadiums=stadiums, parcels=parcels, occ=occ)

    # Calle/Avenida refs mapped to the OSM names actually present here (odd
    # calles are unnamed → fall back to the flanking even calle; the central
    # avenue is "Avenida Centenario"). place_stadium prints the resolved quad.
    for _sp in (
        {"id": "estadio",                    # Lito Pérez: Calle 15-17 x Avenida 0-2
         "calles": (["Calle 15 José Joaquín Escalante"], ["Calle 17"]),
         "ave_south": ["Avenida 2"],
         "ave_north": ["Avenida Centenario", "Avenida 0"]},
        {"id": "estadio_playitas",           # Las Playitas: Calle 6-8, between Av
         "calles": (["Calle 6"], ["Calle 8"]),   # Centenario and the shoreline
         "ave_north": ["Avenida 1", "Avenida 1 Dr. Sergio Fallas Badilla"],
         "ave_south": ["Avenida Centenario"],
         "beach": True,                      # the cuadra runs out to the sand
         "edge": ["Calle 8"]},               # right wall on Calle 8's line, extended
    ):
        fields.place_stadium(_sp)

    # ---- PARCELS -----------------------------------------------------------
    # A cuadra split into named PARTS, each with a `use` that drives how it is
    # drawn, and each carrying a `slot` rect a sponsor can paint a logo into.
    # This is the general form of what the estadios do by hand: resolve the
    # block from its bounding streets, then hand out pieces of it.
    #
    #   aceras: True  -> the part is eroded by the sidewalk depth, so whatever
    #                    sits on it (a church) never lands on the acera.
    #   aceras: False -> the part keeps the ring, filling the block edge to edge
    #                    (how Plaza Las Playitas reads as one open field).
    for _pc in (
        {"id": "carmen", "at": (12620, 9755),      # Calle 35-33 x Av Centenario-Av 1
         "calles": (["Calle 35"], ["Calle 33"]),
         "ave_north": ["Avenida Centenario", "Avenida 0"],
         "ave_south": ["Avenida 1 Dr. Sergio Fallas Badilla", "Avenida 1"],
         "cols": [1, 1], "rows": [1, 1],
         "parts": [
             # left column, split in two: the church up top…
             {"id": "carmen_parroquia", "col": 0, "row": 0, "use": "church",
              "name": "Parroquia Nuestra Señora de El Carmen",
              "aceras": True, "anchor": "north"},
             # …and its garden below it
             {"id": "carmen_jardin", "col": 0, "row": 1, "use": "garden",
              "name": "Jardín de la Parroquia", "aceras": True},
             # right column, spanning BOTH rows
             {"id": "carmen_plaza", "col": 1, "row": [0, 1], "use": "stadium",
              "name": "Plaza Deportes El Carmen", "aceras": True},
         ]},
    ):
        fields.place_parcels(_pc)

    # Parque Marino: the aquarium's own OSM ways stay at their TRUE footprints
    # (a snapped pastel box reads as a generic house, not the theme park), and
    # occ keeps every other building — OSM or synth — off the cuadra. green=True
    # alone only excludes a block from synth_buildings, which is why generic
    # buildings used to land on the lawn, one of them right on an aquarium tank.
    marine_raw = []
    if marine_site:
        mc = marine_site["cells"]
        keep = []
        for raw in raw_bldgs:
            if (int(raw["cx"] // CUAD), int(raw["cy"] // CUAD)) in mc and raw.get("pts"):
                marine_raw.append(raw)
            else:
                keep.append(raw)
        raw_bldgs = keep
        occ.update(mc)
    # Every OTHER building that is a NAMED place also keeps its real outline, for
    # the same reason: Hotel Tioga, the Catedral, Súper Salinas et al. should be
    # recognisable on the map, not another anonymous pastel rect. They bypass the
    # cuadrícula snap, so claim the cuad cells they cover — otherwise a snapped
    # or synthesised neighbour lands on top of them.
    # …but ONLY when the real outline is actually clear of the streets. Snapping
    # guaranteed that (a snapped rect must fit inside one block); a raw OSM
    # polygon does not, and a few were sitting across the auxiliary calles by
    # the Paseo kiosks. Any that overlaps drivable ground goes back to the
    # snapper rather than being drawn over a road.
    def _poly_on_road(pts, step=4):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        for py in range(int(min(ys)), int(max(ys)) + 1, step):
            for px in range(int(min(xs)), int(max(xs)) + 1, step):
                if not (0 <= px < CANVAS_W and 0 <= py < CANVAS_H):
                    return True
                if not point_in_poly((px, py), pts):
                    continue
                if grid[(py // GRID_CELL) * GRID_COLS + (px // GRID_CELL)] in \
                        (CLS_ROAD, CLS_PASEO, CLS_BRIDGE):
                    return True
        return False

    named_raw, keep, n_onroad = [], [], 0
    for raw in raw_bldgs:
        if raw.get("name") and raw.get("pts") and not _poly_on_road(raw["pts"]):
            named_raw.append(raw)
        else:
            if raw.get("name"):
                n_onroad += 1
            keep.append(raw)
    raw_bldgs = keep
    if n_onroad:
        log("buildings", f"{n_onroad} named footprints overlapped a street — snapped instead")
    for raw in named_raw:
        xs = [p[0] for p in raw["pts"]]; ys = [p[1] for p in raw["pts"]]
        for cc in range(int(min(xs) // CUAD), int(max(xs) // CUAD) + 1):
            for cr in range(int(min(ys) // CUAD), int(max(ys) // CUAD) + 1):
                occ.add((cc, cr))
    buildings = snap_osm_buildings(raw_bldgs, cell_block, occ)
    synth = synth_buildings([b for b in blocks if not b["green"]],
                            cell_block, occ, len(buildings))
    log("buildings", f"+{len(synth)} synthesized in cuadra frontage bands "
          f"(total {len(buildings) + len(synth)})")
    buildings = buildings + synth
    # gate: every footprint sits on the cuadrícula (inset seam on each edge)
    for b in buildings:
        xs, ys = b["pts"][0::2], b["pts"][1::2]
        for v in (min(xs), max(xs), min(ys), max(ys)):
            if v % CUAD not in (BLDG_INSET, CUAD - BLDG_INSET):
                raise SystemExit(f"[gate] building edge off the cuadrícula: {v}")
    # after the gate: real footprints are deliberately OFF the lattice
    if marine_site:
        # Muted aquarium palette so the site reads as one complex, not a row of
        # houses in the random pastel mix.
        MARINE_WALL = ["#8fb8b0", "#a8c6be", "#7fa9a6", "#b7c9bd"]
        MARINE_ROOF = ["#3f5f63", "#4d6f70", "#35545a"]
        for i, raw in enumerate(marine_raw):
            flat = [round(v) for p in raw["pts"] for v in p]
            buildings.append({"pts": flat,
                              "color": MARINE_WALL[i % len(MARINE_WALL)],
                              "roof": MARINE_ROOF[i % len(MARINE_ROOF)], "wnd": 0})
        _place_marine_pools(marine_site, marine_raw)
        log("marino", f"{len(marine_raw)} aquarium buildings at their real OSM "
              f"footprints, {len(marine_site['lm'].get('pools', []))} tanks placed clear")
    for raw in named_raw:
        rng = make_rng(raw["id"])
        buildings.append({"pts": [round(v) for p in raw["pts"] for v in p],
                          "color": BLDG_PALETTE[int(rng() * len(BLDG_PALETTE))],
                          "roof": ROOF_PALETTE[int(rng() * len(ROOF_PALETTE))],
                          "wnd": 1 if rng() < 0.7 else 0,
                          "name": raw["name"], "cat": raw.get("cat")})
    log("buildings", f"{len(named_raw)} NAMED buildings kept at their real OSM footprint")
    # The Balneario cuadra is a SEA inlet, so any building whose real footprint
    # lands inside it was floating on the water. Give each one a sand pad: a
    # dilated bbox emitted into `beaches` (painted AFTER the water, so it shows)
    # and stamped CLS_BEACH so the ground under the building is solid too.
    # ---- FEATURE PARCELS ---------------------------------------------------
    # An irregular block cannot be quartered: Parque Marino fills 32% of its
    # bbox and the Balneario 46%, so a grid cut would hand out parts that are
    # mostly street or water. Their real parcels are the things already STANDING
    # in them, so derive one parcel per building footprint inside the block.
    # Same output shape, same sponsor slot — only the source differs.
    for _fp in (
        {"id": "marino_lote", "lm": "parquemar", "name": "Parque Marino", "use": "lot"},
        {"id": "balneario_lote", "lm": "balneario", "name": "Balneario", "use": "lot"},
    ):
        fields.place_feature_parcels(_fp, buildings)

    if balneario:
        pads = 0
        for b in buildings:
            xs, ys = b["pts"][0::2], b["pts"][1::2]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            if not (balneario["x0"] <= cx <= balneario["x1"] and
                    balneario["y0"] <= cy <= balneario["y1"]):
                continue
            px0, py0 = min(xs) - 10, min(ys) - 10
            px1, py1 = max(xs) + 10, max(ys) + 10
            beaches.append([round(px0), round(py0), round(px1), round(py0),
                            round(px1), round(py1), round(px0), round(py1)])
            raster.fill_poly([(px0, py0), (px1, py0), (px1, py1), (px0, py1)], CLS_BEACH)
            pads += 1
        if pads:
            log("balneario", f"{pads} buildings given a sand pad (were floating on the inlet)")

    # --- bridge / estuary / decorations
    if bridge_road:
        bp = bridge_road["pts"]
        xs = bp[0::2]
        ys = bp[1::2]
        bx0, bx1 = min(xs), max(xs)
        bcy = sum(ys) / len(ys)
    else:
        pm, _ = resolve({"osm": "puente colgante mata de limón"})
        if pm is None:
            # region has no Mata bridge (e.g. a bounded build) — stub it off-map
            x, y = CANVAS_W - 40, 40
        else:
            x, y, _, _ = sp.project(pm)
        bx0, bx1, bcy = x - 80, x + 80, y
        bw = road_width_px("bridge")
        roads.append({"cls": "bridge", "w": bw,
                      "pts": [round(bx0), round(bcy), round(bx1), round(bcy)]})
        raster.stamp_polyline(roads[-1]["pts"], bw + 6, CLS_BRIDGE)
    span = bx1 - bx0
    bridge = {"x0": round(bx0), "x1": round(bx1), "cy": round(bcy), "deckW": 60,
              "towers": [round(bx0 + span * 0.15), round(bx1 - span * 0.15)], "towerH": 180,
              "pts": bridge_road["pts"] if bridge_road else roads[-1]["pts"]}

    # estuary ellipse from the largest water poly near the bridge
    est = None
    for wp in waters:
        pts = [(wp[i], wp[i + 1]) for i in range(0, len(wp), 2)]
        cx, cy = poly_centroid(pts)
        if abs(cx - (bx0 + bx1) / 2) < 2700:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            cand = {"cx": round(cx), "cy": round(cy),
                    "rx": round((max(xs) - min(xs)) / 2), "ry": round((max(ys) - min(ys)) / 2)}
            if est is None or cand["rx"] * cand["ry"] > est["rx"] * est["ry"]:
                est = cand
    if est is None:
        est = {"cx": round((bx0 + bx1) / 2 + 900), "cy": CENTER_Y - 360, "rx": 840, "ry": 210}
        warn("estuary", "no water poly near bridge; synthetic ellipse")

    # mangroves around the estuary
    seed = 57
    def rng():
        nonlocal seed
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280
    mangroves = []
    for a in [i * 0.12 for i in range(int(2 * math.pi / 0.12) + 1)]:
        rx = est["rx"] + 60 + rng() * 78
        ry = est["ry"] + 60 + rng() * 60
        mangroves.append({"x": round(est["cx"] + math.cos(a) * rx),
                          "y": round(est["cy"] + math.sin(a) * ry),
                          "r": round(24 + rng() * 24)})
    for _ in range(10):
        ang = rng() * math.pi * 2
        rr = rng() * est["rx"] * 0.6
        mangroves.append({"x": round(est["cx"] + math.cos(ang) * rr),
                          "y": round(est["cy"] + math.sin(ang) * rr * est["ry"] / max(est["rx"], 1)),
                          "r": round(4 + rng() * 4)})

    # palms: along shores where land is present, plus along the paseo road
    palms = []
    seed = 33
    x = 140.0
    while x < CANVAS_W - 60:
        c = int(x / GRID_CELL)
        if 0 <= c < GRID_COLS and botY[c] - topY[c] > 60:
            palms.append({"x": round(x), "y": round(botY[c] - 12 - rng() * 6),
                          "s": round(0.9 + rng() * 0.4, 2), "sway": round(rng() * 6.28, 2)})
        x += 45 + rng() * 30
    x = 220.0
    while x < CANVAS_W - 60:
        c = int(x / GRID_CELL)
        if 0 <= c < GRID_COLS and botY[c] - topY[c] > 60:
            palms.append({"x": round(x), "y": round(topY[c] + 10 + rng() * 6),
                          "s": round(0.8 + rng() * 0.4, 2), "sway": round(rng() * 6.28, 2)})
        x += 70 + rng() * 60
    # Paseo de los Turistas: PALMS on the median dashes, planted inside the
    # same street-aligned runs the median stamp uses.
    PALM_PITCH = 22
    PALM_END_MARGIN = 10
    n_median_palms = 0
    for samples, runs in palm_runs:
        for (k0, k1) in runs:
            s0, s1 = samples[k0][0] + PALM_END_MARGIN, samples[k1][0] - PALM_END_MARGIN
            nxt = s0
            for (s, x, y) in samples[k0:k1 + 1]:
                if s >= nxt and s <= s1:
                    # paintPalm anchors the trunk base at y+4 (shadow at y+5), so
                    # planting on the island centerline drops the visible palm to
                    # the strip's lower edge. Lift by that base offset so the
                    # trunk sits centered ON the median island.
                    palms.append({"x": round(x), "y": round(y - 4),
                                  "s": 1.05, "sway": round(rng() * 6.28, 2)})
                    n_median_palms += 1
                    nxt = s + PALM_PITCH
    # Trees (almendros/robles) along the continuous tree lines only.
    TREE_PITCH = 26
    TREE_END_MARGIN = 12
    trees = []
    for samples, runs in tree_runs:
        for (k0, k1) in runs:
            s0, s1 = samples[k0][0] + TREE_END_MARGIN, samples[k1][0] - TREE_END_MARGIN
            nxt = s0
            for (s, x, y) in samples[k0:k1 + 1]:
                if s >= nxt and s <= s1:
                    trees.append({"x": round(x), "y": round(y),
                                  "s": round(0.9 + rng() * 0.3, 2)})
                    nxt = s + TREE_PITCH
    # Tree line on the north shoulder of Avenida 2 del Ferrocarril (from
    # x≈6892 to the avenue's end), separating it from the parallel Avenida
    # Alberto Echandi Montero. Decorative trees (no blocking median → the barro
    # avenue stays fully drivable), GAPPED at every cross street.
    FERRO_TREE_X0 = 6892
    # tree line along the whole elevated barro route (Av. 2 del Ferrocarril AND
    # the Cocal-side avenue) from x≈6892 to where it ends at the estero
    ferro = [r for r in roads if r.get("elev")]
    other_pts = [(x, y) for r in roads
                 if not r.get("elev")
                 for x, y in zip(r["pts"][0::2], r["pts"][1::2])]
    def _near_crossing(px, py, rad=1.8 * CUAD):
        rr = rad * rad
        return any((px - ox) ** 2 + (py - oy) ** 2 < rr for ox, oy in other_pts)
    n_ferro_trees = 0
    for r in ferro:
        samples = resample_centerline(r["pts"], 26)
        for i, (s, cx, cy) in enumerate(samples):
            if cx < FERRO_TREE_X0:
                continue
            j = i + 1 if i + 1 < len(samples) else max(0, i - 1)
            hx, hy = samples[j][1] - cx, samples[j][2] - cy
            h = math.hypot(hx, hy) or 1.0
            nx, ny = -hy / h, hx / h
            off = r["w"] / 2 + 0.6 * CUAD
            tx, ty = cx + nx * off, cy + ny * off
            if ty > cy:                      # force the NORTH side (smaller y)
                tx, ty = cx - nx * off, cy - ny * off
            if _near_crossing(cx, cy):       # respect intersections (leave gaps)
                continue
            c, gr = int(tx / GRID_CELL), int(ty / GRID_CELL)
            if not (0 <= c < GRID_COLS and 0 <= gr < GRID_ROWS):
                continue
            # only BESIDE the lane: never on the drivable lane (or a cross
            # street / paseo / bridge / water) — this is the Cocal-side tree
            # line the user saw sitting on top of streets.
            if grid[gr * GRID_COLS + c] in (CLS_ROAD, CLS_PASEO, CLS_BRIDGE, CLS_WATER):
                continue
            trees.append({"x": round(tx), "y": round(ty), "s": round(0.9 + rng() * 0.3, 2)})
            n_ferro_trees += 1
    # Planted median down the middle of the divided Cocal avenue (corridor-only;
    # planar never divides that avenue, so this is inert there).
    def _centerline_pts(name, x0, x1):
        out = []
        for r in roads:
            if (r.get("name") or "") == name:
                out += [(x, y) for (_, x, y) in resample_centerline(r["pts"], 10) if x0 <= x <= x1]
        return sorted(out)
    A = _centerline_pts("Avenida 1", 8139, 11921)
    B = _centerline_pts("Avenida Alberto Echandi Montero", 8139, 11921)
    n_dc = 0
    if A and B:
        for xs in range(8200, 11900, 40):
            a = min(A, key=lambda p: abs(p[0] - xs))
            b = min(B, key=lambda p: abs(p[0] - xs))
            if abs(a[0] - xs) < 90 and abs(b[0] - xs) < 90 and abs(a[1] - b[1]) < 6 * CUAD:
                mx, my = xs, round((a[1] + b[1]) / 2)
                c, gr = int(mx / GRID_CELL), int(my / GRID_CELL)
                if 0 <= c < GRID_COLS and 0 <= gr < GRID_ROWS and \
                        grid[gr * GRID_COLS + c] not in (CLS_ROAD, CLS_PASEO, CLS_BRIDGE, CLS_WATER):
                    trees.append({"x": mx, "y": my, "s": round(0.9 + rng() * 0.3, 2)})
                    n_dc += 1
    log("median", f"{n_median_palms} palms on the paseo median dashes, "
          f"{len(trees)} trees on the tree lines ({n_ferro_trees} Ferrocarril, "
          f"{n_dc} Cocal divided-avenue median)")

    # --- living puerto: trees in the cuadra patios (the open interiors behind
    # the frontage band) and parks, plus coconut palms scattered on open beach.
    # Deterministic: sorted block/cell order + the shared seeded rng.
    n_patio = 0
    PATIO_MAX = 45000
    for bi in sorted(range(len(blocks)), key=lambda i: min(blocks[i]["cells"])):
        b = blocks[bi]
        green = b.get("green")
        size = len(b["cells"])
        p = 0.55 if green else 0.30
        if size > 400:                       # huge rural blocks: bounded, not carpeted
            p *= 400.0 / size
        for (cc, cr) in sorted(b["cells"], key=lambda c: (c[1], c[0])):
            if n_patio >= PATIO_MAX:
                break
            if (cc, cr) in occ:
                continue
            if rng() > p:
                continue
            trees.append({"x": round(cc * CUAD + CUAD / 2 + (rng() - 0.5) * 8),
                          "y": round(cr * CUAD + CUAD / 2 + (rng() - 0.5) * 8),
                          "s": round(0.85 + rng() * 0.4, 2)})
            n_patio += 1
    n_beach_palms = 0
    _lat = 6                                     # 6 cells = 24 px lattice
    for gr in range(0, GRID_ROWS, _lat):
        row = gr * GRID_COLS
        for gc in range(0, GRID_COLS, _lat):
            if grid[row + gc] != CLS_BEACH:
                continue
            if rng() > 0.16:
                continue
            palms.append({"x": round(gc * GRID_CELL + (rng() - 0.5) * 18),
                          "y": round(gr * GRID_CELL + (rng() - 0.5) * 18),
                          "s": round(0.75 + rng() * 0.45, 2),
                          "sway": round(rng() * 6.28, 2)})
            n_beach_palms += 1
    log("verde", f"{n_patio} patio/park trees, {n_beach_palms} beach palms")

    # --- verification gate + emit. The context is the world; these locals are
    # the same objects the earlier phases filled.
    ctx.districts, ctx.blocks, ctx.plazas, ctx.greens = districts, blocks, plazas, greens
    ctx.landmarks, ctx.customers = landmarks, customers
    ctx.buildings, ctx.stadiums, ctx.parcels = buildings, stadiums, parcels
    ctx.kiosk_paths, ctx.trees, ctx.palms = kiosk_paths, trees, palms
    ctx.mangroves, ctx.medians = mangroves, medians
    ctx.bridge, ctx.estuary, ctx.pier = bridge, est, pier
    ctx.faro_pier, ctx.balneario = faro_pier, balneario
    ctx.failures = failures

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
