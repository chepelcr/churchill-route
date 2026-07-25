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
    BLDG_INSET, DRIVABLE_CLASSES, STREET_CLASSES, SYNTH_MAX_TOTAL,
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

# World SIZE is computed from the OSM bounds by _planar_setup(), which rebinds
# these before anything reads them (every function reads them at call time).
CANVAS_W, CANVAS_H, CENTER_Y = 26400, 4920, 3220
GRID_COLS, GRID_ROWS = CANVAS_W // GRID_CELL, CANVAS_H // GRID_CELL

from churchill.world.pipeline.emit import emit_world2d  # noqa: E402
from churchill.world.repository.debug_render import render_debug  # noqa: E402
from churchill.world.repository.world_json import JsonWorldRepository  # noqa: E402
from churchill.world.service.field import FieldService  # noqa: E402
from churchill.world.service.building import (  # noqa: E402
    _grid_placer, make_rng, snap_osm_buildings, synth_buildings,
)
from churchill.world.service.projection import (  # noqa: E402
    PlanarProjection, project_way_pts,
)
from churchill.world.service.surface import (   # noqa: E402
    acera_fringe, beach_fringe, raster_coast_barrier, raster_poly_barrier,
    stamp_pad, trace_land_contours,
)
from churchill.world.service.block import (    # noqa: E402
    block_raster_cells, cuadra_cells, outline_poly,
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
POI_KEYS = ("amenity", "shop", "tourism", "leisure", "office", "healthcare",
            "craft", "historic")

def poi_category(tags):
    """(key, value) of the first POI key on `tags`, or None if it isn't a POI."""
    for k in POI_KEYS:
        if k in tags:
            return k, tags[k]
    return None


def parse_osm(path):
    nodes = {}
    ways = []
    named = []            # (lower_name, (mx,my), tags) for POI resolution
    poi_nodes = []        # (ll, tags) for every NAMED standalone POI node
    rels = []
    keep_keys = {"highway", "building", "natural", "name", "amenity",
                 "man_made", "bridge", "ref", "wetland", "leisure"}
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag == "node":
            nid = el.get("id")
            ll = (float(el.get("lat")), float(el.get("lon")))
            nodes[nid] = ll
            tags = None
            for t in el.findall("tag"):
                if t.get("k") == "name" or t.get("k") in ("man_made", "amenity"):
                    if tags is None:
                        tags = {tt.get("k"): tt.get("v") for tt in el.findall("tag")}
            if tags and tags.get("name"):
                named.append((tags["name"].lower(), to_m(*ll), tags))
                if poi_category(tags):
                    poi_nodes.append((ll, tags))
            el.clear()
        elif el.tag == "way":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if tags.keys() & keep_keys:
                nds = [n.get("ref") for n in el.findall("nd")]
                ways.append({"id": el.get("id"), "nds": nds, "tags": tags})
            el.clear()
        elif el.tag == "relation":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if tags.get("type") == "multipolygon" and tags.get("natural") in ("water", "wetland", "beach"):
                members = [(m.get("ref"), m.get("role")) for m in el.findall("member") if m.get("type") == "way"]
                rels.append({"tags": tags, "members": members})
            el.clear()
    # resolve way coords in meters; register named ways too
    for w in ways:
        pts = [to_m(*nodes[r]) for r in w["nds"] if r in nodes]
        w["pts"] = pts
        nm = w["tags"].get("name")
        if nm and pts:
            named.append((nm.lower(), poly_centroid(pts), w["tags"]))
    return nodes, ways, named, rels, poi_nodes

# ----------------------------------------------------------------- spine ---

def extract_roads(sp, ways):
    roads = []
    bridge_way = None
    for w in ways:
        hw = w["tags"].get("highway")
        name = (w["tags"].get("name") or "")
        lname = name.lower()
        is_bridge = "puente colgante mata" in lname
        if not is_bridge and hw not in ROAD_CLASSES:
            continue
        if len(w["pts"]) < 2:
            continue
        cls = "bridge" if is_bridge else hw
        # The beachfront avenue is a principal street driven at full speed —
        # both its western half (Paseo de los Turistas) and its continuation
        # past the kiosks (Paseo León Cortés Castro, OSM-tagged tertiary).
        if "paseo de los turistas" in lname or "paseo león cortés" in lname:
            cls = "primary"
        # Drop minor alleys/paths to unify small cuadras into bigger blocks.
        if cls in DROP_ROAD_CLASSES:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        for piece in clip_polyline_to_rect(pts, CANVAS_W, CANVAS_H):
            piece = dp_simplify(piece, DP_ROAD_PX)
            length = sum(dist(piece[i], piece[i + 1]) for i in range(len(piece) - 1))
            if cls == "service" and length < SERVICE_MIN_PX:
                continue
            if length < 8:
                continue
            r = {"cls": cls, "w": road_width_px(cls),
                 "pts": [round(v) for p in piece for v in p]}
            if name:
                r["name"] = name
            # Avenida 2 del Ferrocarril (OSM-misspelled "Farrocarril"): the
            # avenue over the old rail bed — a raised packed-earth (barro)
            # street, rendered as dirt, not asphalt. "rrocarril" matches both
            # the misspelling and any real "…Ferrocarril" way.
            # both in-corridor Ferrocarril avenues (Av. 2 del Farrocarril, and
            # the one near the Cocal) — "rrocarril" catches the OSM misspelling
            if "rrocarril" in lname:
                r["barro"] = 1     # dirt surface
                r["elev"] = 1      # AND the raised avenue (car ramps onto it)
            if w["tags"].get("ref"):
                r["ref"] = w["tags"]["ref"]
            if w["tags"].get("bridge") == "yes" and cls != "bridge":
                r["bridge"] = 1  # e.g. Río Barranca bridge at El Roble
            roads.append(r)
            if cls == "bridge":
                bridge_way = r
    return roads, bridge_way


def extract_rails(sp, ways):
    """The old Ferrocarril al Pacífico line (mostly OSM `disused:railway=rail`)
    that ran out the Puntarenas spit. Purely decorative — projected polylines
    emitted as `rails`, drawn as a sleeper-and-track bed by the renderer."""
    rails = []
    for w in ways:
        t = w["tags"]
        is_rail = (t.get("railway") == "rail" or t.get("disused:railway") == "rail"
                   or t.get("abandoned:railway") == "rail"
                   or "ferrocarril al pac" in (t.get("name") or "").lower())
        if not is_rail:
            continue
        if len(w["pts"]) < 2:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        for piece in clip_polyline_to_rect(pts, CANVAS_W, CANVAS_H):
            piece = dp_simplify(piece, DP_ROAD_PX)
            if len(piece) < 2:
                continue
            if sum(dist(piece[i], piece[i + 1]) for i in range(len(piece) - 1)) < 24:
                continue
            rails.append({"pts": [round(v) for p in piece for v in p]})
    return rails


def propagate_barro_to_crossings(roads, reach=1.2 * CUAD):
    """The dirt continues onto the calles that cross the elevated Ferrocarril
    avenue — flag them `barro` too (dirt surface) but NOT `elev`: they stay at
    ground level and ramp up to the raised avenue. Sourced only from the raised
    avenue (`elev`), with both lines densified so a crossing is never missed
    between sparse polyline vertices. Principal avenues are excluded, so their
    asphalt (and their intersections) stay paved."""
    ax0 = ay0 = 1e9; ax1 = ay1 = -1e9
    elev_pts = []
    for r in roads:
        if not r.get("elev"):
            continue
        for (_, x, y) in resample_centerline(r["pts"], 5):
            elev_pts.append((x, y))
            ax0, ay0, ax1, ay1 = min(ax0, x), min(ay0, y), max(ax1, x), max(ay1, y)
    if not elev_pts:
        return
    rr = reach * reach
    KEEP_ASPHALT = {"trunk", "trunk_link", "primary", "primary_link", "paseo", "bridge"}
    n = 0
    for r in roads:
        if r.get("barro") or r.get("cls") in KEEP_ASPHALT:
            continue
        xs, ys = r["pts"][0::2], r["pts"][1::2]
        if max(xs) < ax0 - reach or min(xs) > ax1 + reach or \
           max(ys) < ay0 - reach or min(ys) > ay1 + reach:
            continue
        cand = [(x, y) for (_, x, y) in resample_centerline(r["pts"], 6)]
        if any((px - ox) ** 2 + (py - oy) ** 2 < rr
               for px, py in cand for ox, oy in elev_pts):
            r["barro"] = 1
            n += 1
    log("barro", f"+{n} cross streets flagged barro (cross the Ferrocarril avenue)")


def barro_leon_continuation(roads):
    """Paseo León Cortés (principal) ends at the Parque Marino corner where the
    barro Ferrocarril avenue begins; its continuation east is that dirt route, not
    the principal. Anchored to the Ferrocarril avenue's west end (the `elev`
    roads) so it works in BOTH the corridor and the planar projection — flag the
    León piece(s) that run east past that handoff as a narrow barro street."""
    ferro_xs = [x for r in roads if r.get("elev") for x in r["pts"][0::2]]
    if not ferro_xs:
        return                                    # no Ferrocarril avenue in region
    handoff = min(ferro_xs)
    n = 0
    for r in roads:
        if "león cortés" not in (r.get("name") or "").lower():
            continue
        xs = r["pts"][0::2]
        if max(xs) > handoff + CUAD and min(xs) >= handoff - 3 * CUAD:
            r["barro"] = 1
            r["w"] = road_width_px("residential")
            r["cls"] = "residential"
            n += 1
    log("roads", f"León Cortés continuation past the Ferrocarril handoff -> barro: {n} piece(s)")


def extract_buildings(sp, ways, roads):
    # road segments for overlap testing (subdivided, with per-class half width)
    segs = []
    for r in roads:
        p = r["pts"]
        hw = max(4.0, r["w"] / 2 + ACERA_CELLS * GRID_CELL - 2)  # clear road + acera
        for i in range(0, len(p) - 2, 2):
            segs.append((p[i], p[i + 1], p[i + 2], p[i + 3], hw))
    cellmap = defaultdict(list)
    CS = 64
    for idx, s in enumerate(segs):
        x0, y0, x1, y1 = s[0], s[1], s[2], s[3]
        for cx in range(int(min(x0, x1)) // CS, int(max(x0, x1)) // CS + 1):
            for cy in range(int(min(y0, y1)) // CS, int(max(y0, y1)) // CS + 1):
                cellmap[(cx, cy)].append(idx)

    def nearest_road(px, py):
        """(gap, hw, qx, qy) for the road segment whose buffer the point is
        deepest inside / closest to; checks the 3x3 cell neighborhood."""
        best = None
        c0, r0 = int(px) // CS, int(py) // CS
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for idx in cellmap.get((c0 + dc, r0 + dr), ()):
                    x0, y0, x1, y1, hw = segs[idx]
                    dx, dy = x1 - x0, y1 - y0
                    L2 = dx * dx + dy * dy
                    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
                    qx, qy = x0 + t * dx, y0 + t * dy
                    d = math.hypot(px - qx, py - qy)
                    if best is None or d - hw < best[0]:
                        best = (d - hw, hw, qx, qy, d)
        return best

    def near_road(px, py):
        b = nearest_road(px, py)
        return b is not None and b[0] <= 0

    out = []
    dropped_road, dropped_small = 0, 0
    for w in ways:
        if "building" not in w["tags"] or len(w["pts"]) < 4:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        if dist(pts[0], pts[-1]) < 1e-6:
            pts = pts[:-1]
        pts = clip_poly_to_rect(pts, CANVAS_W, CANVAS_H)
        if len(pts) < 3:
            continue
        pts = dp_simplify(pts + [pts[0]], DP_BUILDING_PX)[:-1]
        if len(pts) < 3 or abs(poly_area(pts)) < MIN_BUILDING_AREA_PX2:
            dropped_small += 1
            continue
        # Buildings line the streets: push the footprint out of any widened
        # road corridor (like a house set back from the curb), then shrink
        # step-by-step until it fits its block.
        cx, cy = poly_centroid(pts)
        ok = True
        for _ in range(4):
            b = nearest_road(cx, cy)
            if b is None or b[0] > 2:
                break
            gap, hw, qx, qy, d = b
            if d < 1e-6:
                ok = False
                break
            ux, uy = (cx - qx) / d, (cy - qy) / d
            shift = (hw + 4 - d)
            cx, cy = cx + ux * shift, cy + uy * shift
            pts = [(px + ux * shift, py + uy * shift) for px, py in pts]
        if not ok or near_road(cx, cy):
            dropped_road += 1
            continue
        # Raw record only: the footprint is snapped to whole cuadrículas later
        # (snap_osm_buildings), once the cuadra blocks are known. Target size
        # comes from the pushed-out footprint's AABB × BUILDING_SCALE. `pts` is
        # kept so a site that must read as ITSELF (the Parque Marino aquarium)
        # can be emitted at its true shape instead of snapped to the lattice.
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        rec = {"cx": cx, "cy": cy,
               "w": (max(xs) - min(xs)) * BUILDING_SCALE,
               "h": (max(ys) - min(ys)) * BUILDING_SCALE,
               "id": int(w["id"]), "pts": pts}
        # A building that IS a named place (Hotel Tioga, Súper Salinas, the
        # church…) keeps its real outline — snapping it to the cuadrícula turns
        # a landmark you can recognise into one more anonymous pastel box.
        if w["tags"].get("name") and poi_category(w["tags"]):
            rec["name"] = w["tags"]["name"]
            k, v = poi_category(w["tags"])
            rec["cat"] = f"{k}={v}"
        out.append(rec)
    log("buildings", f"{len(out)} raw OSM footprints, dropped {dropped_road} on-road, {dropped_small} tiny")
    return out


def extract_pois(sp, ways, poi_nodes):
    """Every NAMED real-world POI (business, church, school, park…) projected to
    world px: {x, y, name, cat}. `cat` is "key=value" from POI_KEYS, so the
    renderer can style or filter by kind. Standalone OSM nodes use their own
    position; POI ways (a shop mapped as its building outline) use the polygon
    centroid. Deduped by (name, 20px cell) — OSM often carries both a building
    way and a point node for the same place."""
    out, seen = [], set()

    def add(name, tags, x, y):
        if not (0 <= x < CANVAS_W and 0 <= y < CANVAS_H):
            return
        key = (name.lower(), int(x // CUAD), int(y // CUAD))
        if key in seen:
            return
        seen.add(key)
        k, v = poi_category(tags)
        out.append({"x": round(x), "y": round(y), "name": name, "cat": f"{k}={v}"})

    for (ll, tags) in poi_nodes:
        x, y, _, _ = sp.project(to_m(*ll))
        add(tags["name"], tags, x, y)
    for w in ways:
        tags = w["tags"]
        name = tags.get("name")
        if not name or not poi_category(tags) or len(w["pts"]) < 3:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        if not pts:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        add(name, tags, cx, cy)
    by_cat = defaultdict(int)
    for p in out:
        by_cat[p["cat"].split("=")[0]] += 1
    log("pois", f"{len(out)} named real-world POIs: {dict(sorted(by_cat.items()))}")
    return out


def extract_coastlines(sp, ways):
    """Stitch natural=coastline ways by endpoint node id, project chains."""
    coast = [w for w in ways if w["tags"].get("natural") == "coastline" and len(w["nds"]) >= 2]
    by_first = defaultdict(list)
    for w in coast:
        by_first[w["nds"][0]].append(w)
    used, chains = set(), []
    for w in coast:
        if w["id"] in used:
            continue
        used.add(w["id"])
        nds = list(w["nds"])
        while True:
            nxt = next((c for c in by_first.get(nds[-1], []) if c["id"] not in used), None)
            if nxt is None:
                break
            used.add(nxt["id"])
            nds.extend(nxt["nds"][1:])
        chains.append(nds)
    return chains  # node-id chains; resolved by caller


def extract_areas(sp, ways, rels):
    beaches, waters = [], []
    ways_by_id = {w["id"]: w for w in ways}
    def add_poly(target, pts_m):
        if len(pts_m) < 3:
            return
        pts, _ = project_way_pts(sp, pts_m)
        pts = clip_poly_to_rect(pts, CANVAS_W, CANVAS_H)
        if len(pts) < 3:
            return
        pts = dp_simplify(pts + [pts[0]], DP_COAST_PX)[:-1]
        if len(pts) >= 3:
            target.append([round(v) for p in pts for v in p])

    for w in ways:
        nat = w["tags"].get("natural")
        if nat == "beach":
            add_poly(beaches, w["pts"])
        elif nat == "water" or (nat == "wetland" and w["tags"].get("wetland") == "mangrove"):
            add_poly(waters, w["pts"])
        elif nat == "wetland" and "estero mata" in (w["tags"].get("name") or "").lower():
            add_poly(waters, w["pts"])
    for rel in rels:
        for ref, role in rel["members"]:
            if role != "outer" or ref not in ways_by_id:
                continue
            w = ways_by_id[ref]
            if len(w["pts"]) >= 3:
                if rel["tags"].get("natural") == "beach":
                    add_poly(beaches, w["pts"])
                else:
                    add_poly(waters, w["pts"])
    return beaches, waters

# ------------------------------------------------------------ raster grid ---

DRIVABLE_CLS = DRIVABLE_CLASSES     # see enums.surface: sand is slow, not a wall

def largest_drivable_component(grid):
    """Mask of the largest 4-connected component of drivable cells — 'the'
    street network. POIs are placed relative to this so none ends up on a
    stranded road/beach fragment (e.g. a stub clipped by estero water)."""
    label = [0] * (GRID_COLS * GRID_ROWS)
    best_id, best_n = 0, 0
    nid = 0
    for start in range(GRID_COLS * GRID_ROWS):
        if label[start] or grid[start] not in DRIVABLE_CLS:
            continue
        nid += 1
        n = 0
        q = deque([start])
        label[start] = nid
        while q:
            i = q.popleft()
            n += 1
            r, c = divmod(i, GRID_COLS)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < GRID_ROWS and 0 <= nc < GRID_COLS:
                    ni = nr * GRID_COLS + nc
                    if not label[ni] and grid[ni] in DRIVABLE_CLS:
                        label[ni] = nid
                        q.append(ni)
        if n > best_n:
            best_id, best_n = nid, n
    return bytearray(1 if v == best_id else 0 for v in label)


def verify_connectivity(grid, seed_xy, pois, reach):
    """Flood-fill the drivable network from the spawn and require every POI to
    have a reached cell within `reach` cells. Returns the ids of unreachable
    POIs (build fails on any)."""
    reached = bytearray(GRID_COLS * GRID_ROWS)
    # seed: nearest drivable cell to the spawn point (expanding square rings)
    sc, sr = int(seed_xy[0] // GRID_CELL), int(seed_xy[1] // GRID_CELL)
    seed = None
    for rad in range(0, 64):
        for dr in range(-rad, rad + 1):
            for dc in range(-rad, rad + 1):
                if max(abs(dr), abs(dc)) != rad:
                    continue
                c, r = sc + dc, sr + dr
                if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS and \
                        grid[r * GRID_COLS + c] in DRIVABLE_CLS:
                    seed = (c, r)
                    break
            if seed:
                break
        if seed:
            break
    if seed is None:
        return ["spawn(no drivable cell near seed)"]
    q = deque([seed])
    reached[seed[1] * GRID_COLS + seed[0]] = 1
    n_reached = 1
    while q:
        c, r = q.popleft()
        for nc, nr in ((c - 1, r), (c + 1, r), (c, r - 1), (c, r + 1)):
            if 0 <= nc < GRID_COLS and 0 <= nr < GRID_ROWS:
                nidx = nr * GRID_COLS + nc
                if not reached[nidx] and grid[nidx] in DRIVABLE_CLS:
                    reached[nidx] = 1
                    n_reached += 1
                    q.append((nc, nr))
    total_driv = sum(1 for v in grid if v in DRIVABLE_CLS)
    unreachable = []
    for poi in pois:
        pc, pr = int(poi["x"] // GRID_CELL), int(poi["y"] // GRID_CELL)
        ok = False
        for dr in range(-reach, reach + 1):
            for dc in range(-reach, reach + 1):
                c, r = pc + dc, pr + dr
                if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS and reached[r * GRID_COLS + c]:
                    ok = True
                    break
            if ok:
                break
        if not ok:
            unreachable.append(poi["id"])
    pct = 100.0 * n_reached / max(1, total_driv)
    log("gate", f"drivable network: {n_reached}/{total_driv} cells reachable "
          f"from spawn ({pct:.1f}%), {len(pois) - len(unreachable)}/{len(pois)} POIs ok")
    return unreachable


def block_census(grid, min_side=6):
    """Cuadrícula-resolution census of buildable land: 4-connected components
    of CUAD cells fully covered by CLS_LAND, with each component's area and
    max inscribed square (DP). The tuning instrument for Milestone B★."""
    ccols, crows = GRID_COLS // CUAD_CELLS, GRID_ROWS // CUAD_CELLS
    buildable = bytearray(ccols * crows)
    for cr in range(crows):
        for cc in range(ccols):
            ok = True
            for r in range(cr * CUAD_CELLS, (cr + 1) * CUAD_CELLS):
                row = r * GRID_COLS
                for c in range(cc * CUAD_CELLS, (cc + 1) * CUAD_CELLS):
                    if grid[row + c] != CLS_LAND:
                        ok = False
                        break
                if not ok:
                    break
            buildable[cr * ccols + cc] = 1 if ok else 0
    # max inscribed square DP (global; squares never straddle components)
    dp = [0] * (ccols * crows)
    for cr in range(crows):
        for cc in range(ccols):
            i = cr * ccols + cc
            if buildable[i]:
                dp[i] = 1 if (cr == 0 or cc == 0) else \
                    min(dp[i - 1], dp[i - ccols], dp[i - ccols - 1]) + 1
    # component labelling (4-connected)
    label = [0] * (ccols * crows)
    comps = []          # per component: [area, max_inscribed]
    for start in range(ccols * crows):
        if not buildable[start] or label[start]:
            continue
        cid = len(comps) + 1
        comps.append([0, 0])
        q = deque([start])
        label[start] = cid
        while q:
            i = q.popleft()
            comps[cid - 1][0] += 1
            comps[cid - 1][1] = max(comps[cid - 1][1], dp[i])
            r, c = divmod(i, ccols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < crows and 0 <= nc < ccols:
                    ni = nr * ccols + nc
                    if buildable[ni] and not label[ni]:
                        label[ni] = cid
                        q.append(ni)
    big = sorted((c for c in comps if c[0] >= 4), key=lambda c: -c[0])
    n_ok = sum(1 for c in comps if c[1] >= min_side)
    log("census", f"{len(comps)} land components at CUAD resolution; "
          f"{len(big)} with area>=4, {n_ok} with inscribed>={min_side}x{min_side}")
    for area, insq in big[:20]:
        log("census", f"  area {area:>4} cuads   inscribed {insq}x{insq}")
    return comps

# ---------------------------------------------------- cuadrícula blocks -----

def cells_to_rects(cells, cell_px):
    """Merge a set of (cc,cr) cells into axis-aligned [x,y,w,h] px rects
    (row-run merge + vertical span merge). Footprint-accurate."""
    rows = defaultdict(list)
    for (cc, cr) in cells:
        rows[cr].append(cc)
    runs_by_row = {}
    for cr, ccs in rows.items():
        ccs.sort(); runs = []
        for cc in ccs:
            if runs and runs[-1][1] == cc:
                runs[-1][1] = cc + 1
            else:
                runs.append([cc, cc + 1])
        runs_by_row[cr] = runs
    rects = []; open_runs = {}
    def _emit(k, s):
        rects.append([k[0] * cell_px, s[0] * cell_px,
                      (k[1] - k[0]) * cell_px, (s[1] - s[0]) * cell_px])
    for cr in sorted(runs_by_row):
        cur = {tuple(r) for r in runs_by_row[cr]}; nxt = {}
        for k in cur:
            if k in open_runs and open_runs[k][1] == cr:
                open_runs[k][1] = cr + 1; nxt[k] = open_runs[k]
            else:
                if k in open_runs:
                    _emit(k, open_runs[k])
                nxt[k] = [cr, cr + 1]
        for k, s in open_runs.items():
            if k not in nxt:
                _emit(k, s)
        open_runs = nxt
    for k, s in open_runs.items():
        _emit(k, s)
    return rects


BLOCK_MIN_CUADS = 6       # a real cuadra fits >= 6x6 buildable cuadrículas
SLIVER_MAX_CUADS = 25.0   # smaller-and-thinner land paves to plaza concrete

def detect_blocks(grid, build_band_x1=None):
    """Classify every CLS_LAND component (after roads/aceras/pads are stamped)
    at cuadrícula resolution:
      - block: fits a BLOCK_MIN_CUADS square of buildable CUAD cells somewhere
        -> kept as solid cuadra; its organic CUAD cell set (L-shapes, triangle
        and trapezoid arms included) is returned for building placement;
      - sliver: nowhere near the minimum AND small -> paved to CLS_ACERA and
        emitted as plaza rects (intersection corners, alley wedges);
      - green: large but nowhere BLOCK_MIN_CUADS (thin coastal strips) ->
        stays CLS_LAND with no buildings, never paved (no concrete oceans).
    Returns (blocks, plazas): blocks = [{"cells": set[(cc, cr)]}], plazas =
    flat [x, y, w, h] px rects for the renderer."""
    from array import array
    N = GRID_COLS * GRID_ROWS
    label = array("i", [0]) * N
    comp_n = [0]            # raster cell count per component id (1-based)
    for start in range(N):
        if grid[start] != CLS_LAND or label[start]:
            continue
        cid = len(comp_n)
        comp_n.append(0)
        q = deque([start])
        label[start] = cid
        n = 0
        while q:
            i = q.popleft()
            n += 1
            r, c = divmod(i, GRID_COLS)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < GRID_ROWS and 0 <= nc < GRID_COLS:
                    ni = nr * GRID_COLS + nc
                    if grid[ni] == CLS_LAND and not label[ni]:
                        label[ni] = cid
                        q.append(ni)
        comp_n[cid] = n
    n_comps = len(comp_n) - 1
    # buildable CUAD cells (fully CLS_LAND — such a 5x5 is 4-connected, so it
    # belongs to exactly one component) + max-inscribed-square DP per cell
    ccols, crows = GRID_COLS // CUAD_CELLS, GRID_ROWS // CUAD_CELLS
    bcomp = array("i", [0]) * (ccols * crows)      # component id per cuad cell
    for cr in range(crows):
        for cc in range(ccols):
            ok = True
            for r in range(cr * CUAD_CELLS, (cr + 1) * CUAD_CELLS):
                row = r * GRID_COLS
                for c in range(cc * CUAD_CELLS, (cc + 1) * CUAD_CELLS):
                    if grid[row + c] != CLS_LAND:
                        ok = False
                        break
                if not ok:
                    break
            if ok:
                bcomp[cr * ccols + cc] = label[cr * CUAD_CELLS * GRID_COLS + cc * CUAD_CELLS]
    dp = [0] * (ccols * crows)
    comp_ins = [0] * (len(comp_n))                 # max inscribed per component
    comp_cells = defaultdict(set)
    for cr in range(crows):
        for cc in range(ccols):
            i = cr * ccols + cc
            cid = bcomp[i]
            if not cid:
                continue
            dp[i] = 1 if (cr == 0 or cc == 0) else \
                min(dp[i - 1], dp[i - ccols], dp[i - ccols - 1]) + 1
            comp_ins[cid] = max(comp_ins[cid], dp[i])
            comp_cells[cid].add((cc, cr))
    # classify
    blocks, paved_ids = [], set()
    n_green = 0
    for cid in range(1, len(comp_n)):
        area_cuads = comp_n[cid] / (CUAD_CELLS * CUAD_CELLS)
        cells = comp_cells[cid]
        # Faro tip: the fine street grid makes cuadras below the 6x6 minimum, so
        # they'd pave to green plazas. Keep the small coastal blocks BUILDABLE
        # (whole component west of the band edge) so the barrio by the lighthouse
        # has houses instead of a green patchwork.
        in_band = (build_band_x1 is not None and cells and
                   max(cc for cc, _ in cells) * CUAD < build_band_x1)
        if comp_ins[cid] >= BLOCK_MIN_CUADS:
            blocks.append({"cells": cells, "green": False})
        elif in_band and comp_ins[cid] >= 2 and area_cuads >= 4:
            blocks.append({"cells": cells, "green": False})
        elif area_cuads <= SLIVER_MAX_CUADS:
            paved_ids.add(cid)
        else:
            # green strip: no synth fill, but real OSM buildings may still
            # snap onto its buildable cells (rural villages on thin coast land)
            if comp_cells[cid]:
                blocks.append({"cells": comp_cells[cid], "green": True})
            n_green += 1
    # pave the slivers (concrete corners — deliberately NOT painted green: a
    # sliver is a partial-cuadra shape, and partial green reads as a bad paint
    # job; cuadras are all-green (parks) or all-ground)
    for i in range(N):
        if label[i] in paved_ids:
            grid[i] = CLS_ACERA
    n_cuadras = sum(1 for b in blocks if not b["green"])
    log("blocks", f"{n_comps} land components -> {n_cuadras} cuadras, "
          f"{len(paved_ids)} paved slivers, {n_green} green")
    return blocks, []

# ----------------------------------------------------- paseo palm median ----
# The Paseo de los Turistas is a divided avenue: a dashed palm median runs down
# the centerline as a solid (blocking) separator between the two sides, with
# periodic gaps ("aperturas") where you can cross from one side to the other.
PASEO_MEDIAN_W = 0.5 * CUAD     # separator strips (palm median / tree lines) — ½ cuad planter
PASEO_MIN_DASH = 2.0 * CUAD    # drop palm-median slivers shorter than this
PASEO_GAP_MARGIN = CUAD        # extra turn room on each side of a crossing

PASEO_TURISTAS = "paseo de los turistas"
PASEO_LEON = "paseo león cortés"
PASEO_NAMES = (PASEO_TURISTAS, PASEO_LEON)

MUELLE_STREET = "calle central"
LEON_END_STREET = "calle 20"    # the calle at the paseo's east end

def paseo_roads(roads):
    return [r for r in roads
            if any(n in (r.get("name") or "").lower() for n in PASEO_NAMES)]

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


def paseo_median_runs(roads, pieces):
    """Solid-median runs along the given avenue pieces, with gaps ALIGNED TO
    THE CROSS STREETS: a gap opens wherever another street meets the avenue,
    wide enough to turn into it (street width + PASEO_GAP_MARGIN per side).
    Returns [(samples, [(k0, k1), ...])] — resampled centerline points and
    index ranges of the solid runs. Used by both the median stamp and the
    palm planting so they always agree."""
    paseo_ids = set(map(id, paseo_roads(roads)))
    segs = []
    for r in roads:
        if id(r) in paseo_ids or r["cls"] == "bridge":
            continue
        p = r["pts"]
        hw = r["w"] / 2 + PASEO_GAP_MARGIN
        for i in range(0, len(p) - 2, 2):
            segs.append((p[i], p[i + 1], p[i + 2], p[i + 3], hw))
    CS = 256
    cellmap = defaultdict(list)
    for idx, s in enumerate(segs):
        for cx in range(int(min(s[0], s[2]) - 200) // CS, int(max(s[0], s[2]) + 200) // CS + 1):
            for cy in range(int(min(s[1], s[3]) - 200) // CS, int(max(s[1], s[3]) + 200) // CS + 1):
                cellmap[(cx, cy)].append(idx)

    def in_crossing(px, py):
        c0, r0 = int(px) // CS, int(py) // CS
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for idx in cellmap.get((c0 + dc, r0 + dr), ()):
                    x0, y0, x1, y1, hw = segs[idx]
                    dx, dy = x1 - x0, y1 - y0
                    L2 = dx * dx + dy * dy
                    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
                    if (px - (x0 + t * dx)) ** 2 + (py - (y0 + t * dy)) ** 2 <= hw * hw:
                        return True
        return False

    out = []
    for r in pieces:
        samples = resample_centerline(r["pts"], 4.0)
        solid = [not in_crossing(x, y) for (_, x, y) in samples]
        runs, k = [], 0
        while k < len(samples):
            if solid[k]:
                k0 = k
                while k < len(samples) and solid[k]:
                    k += 1
                if samples[k - 1][0] - samples[k0][0] >= PASEO_MIN_DASH:
                    runs.append((k0, k - 1))
            else:
                k += 1
        out.append((samples, runs))
    return out

def stamp_paseo_median(raster, median_runs):
    """Stamp the separator strips (paseo palm median + tree lines) and return
    their polylines (for rendering the planted strip). Stamped as CLS_ACERA:
    equally blocking in physics (walls are land+acera) but invisible to block
    detection and building placement, which only consider CLS_LAND. Run AFTER
    acera_fringe so the strip stays a blocking separator, not sidewalk."""
    dashes = []
    for samples, runs in median_runs:
        for (k0, k1) in runs:
            flat = [v for (_, x, y) in samples[k0:k1 + 1] for v in (x, y)]
            if len(flat) >= 4:
                # Stamp the collision wall WIDER than the drawn curb (draw is
                # m.w+3 ≈ 13px with a ~6.5px round cap) so the car stops at the
                # visual green and can't slip into a drawn-but-unstamped round
                # cap corner (that trapped it half-in). Manifest `w` stays the
                # drawn value, so rendering is unchanged.
                raster.stamp_polyline(flat, PASEO_MEDIAN_W + 6, CLS_ACERA)
                dashes.append({"pts": [round(v) for v in flat], "w": round(PASEO_MEDIAN_W)})
    return dashes

# ---------------------------------------------------------------- outputs ---

# ------------------------------------------------------------------- main ---

def _planar_setup(ways):
    """Compute world bounds from the OSM ways (metres), recompute the world-size
    globals for the flat map, and return a PlanarProjection. Optionally clip the
    bounds to PLANAR_BBOX ("lon0,lat0,lon1,lat1") for a bounded smoke build."""
    global CANVAS_W, CANVAS_H, GRID_COLS, GRID_ROWS, CENTER_Y
    clip = None
    if PLANAR_BBOX:
        lo0, la0, lo1, la1 = (float(v) for v in PLANAR_BBOX.split(","))
        (a0, b0), (a1, b1) = to_m(la0, lo0), to_m(la1, lo1)
        clip = (min(a0, a1), min(b0, b1), max(a0, a1), max(b0, b1))
        # Drop ways entirely outside the clip so stray inland geometry never
        # inflates the bounds, gets rasterised at the world edge, or pollutes
        # edge tiles. A way with ANY point inside (or crossing) the clip stays.
        m = 300.0                                    # keep a small crossing margin
        inside = lambda p: (clip[0] - m <= p[0] <= clip[2] + m and
                            clip[1] - m <= p[1] <= clip[3] + m)
        kept = [w for w in ways if any(inside(p) for p in w["pts"])]
        dropped = len(ways) - len(kept)
        ways[:] = kept
        if dropped:
            log("planar", f"dropped {dropped} ways entirely outside the clip bbox")
    mxs, mys = [], []
    for w in ways:
        for (mx, my) in w["pts"]:
            if clip and not (clip[0] <= mx <= clip[2] and clip[1] <= my <= clip[3]):
                continue
            mxs.append(mx); mys.append(my)
    if not mxs:
        raise SystemExit("[planar] no OSM points in bounds")
    pad = 200.0
    min_mx, max_mx = min(mxs) - pad, max(mxs) + pad
    min_my, max_my = min(mys) - pad, max(mys) + pad
    ppm = PLANAR_PX_PER_M
    snap = lambda px: int(math.ceil(px / CUAD) * CUAD)
    CANVAS_W = snap((max_mx - min_mx) * ppm)
    CANVAS_H = snap((max_my - min_my) * ppm)
    GRID_COLS, GRID_ROWS = CANVAS_W // GRID_CELL, CANVAS_H // GRID_CELL
    CENTER_Y = CANVAS_H // 2
    log("planar", f"world {CANVAS_W}x{CANVAS_H}px  ppm={ppm}  grid "
          f"{GRID_COLS}x{GRID_ROWS} = {GRID_COLS*GRID_ROWS/1e6:.1f}M cells"
          + ("  (bbox clip)" if clip else ""))
    return PlanarProjection(min_mx, min_my, ppm)


def main():
    t0 = time.time()
    log("parse", f"{OSM_PATH}")
    nodes, ways, named, rels, poi_nodes = parse_osm(OSM_PATH)
    log("parse", f"{len(nodes)} nodes, {len(ways)} kept ways, {len(named)} named features ({time.time()-t0:.1f}s)")

    sp = _planar_setup(ways)

    roads, bridge_road = extract_roads(sp, ways)
    # León Cortés end-barro + dirt cross streets (coordinate-agnostic).
    barro_leon_continuation(roads)
    propagate_barro_to_crossings(roads)
    # Junction triangles and medians EMERGE from the real geometry via
    # detect_blocks — no hand-placed gores, islands or carriageway splits.
    junction_islands = []
    rails = extract_rails(sp, ways)
    log("rails", f"{len(rails)} rail pieces")
    n_by_cls = defaultdict(int)
    for r in roads:
        n_by_cls[r["cls"]] += 1
    log("roads", f"{len(roads)} pieces: {dict(n_by_cls)}")
    if bridge_road is None:
        warn("roads", "Puente colgante way not found — synthesizing later")

    raw_bldgs = extract_buildings(sp, ways, roads)
    beaches, waters = extract_areas(sp, ways, rels)
    pois = extract_pois(sp, ways, poi_nodes)
    log("areas", f"{len(beaches)} beach, {len(waters)} water polys")

    # --- raster surface grid
    # ONE raster, and `grid` stays an alias of its buffer: the algorithms that
    # moved to util take the object, while everything still reading cells by
    # index keeps working until it moves to a service too.
    raster = Raster(GRID_COLS, GRID_ROWS, GRID_CELL)
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
    def resolve(spec):
        if "osm" in spec:
            cands = [(nm, pm) for nm, pm, tg in named if spec["osm"] in nm]
            if cands:
                if "near" in spec:
                    ref = to_m(*spec["near"])
                elif "ll" in spec:
                    ref = to_m(*spec["ll"])
                else:
                    ref = None
                # take the osm match nearest the spec anchor, or (no anchor)
                # nearest the candidates' own centroid, so a far stray duplicate
                # of the name can't win.
                if ref is None:
                    cx = sum(c[1][0] for c in cands) / len(cands)
                    cy = sum(c[1][1] for c in cands) / len(cands)
                    ref = (cx, cy)
                return min(cands, key=lambda c: dist(c[1], ref))[1], "osm"
        if "ll" in spec:
            return to_m(*spec["ll"]), "hand"
        return None, "missing"

    main_net = largest_drivable_component(grid)

    def near_drivable(c, r, reach=ACERA_CELLS + 1):
        """True if a MAIN-network street/beach cell is within `reach` cells (so
        a POI pad stamped here merges with the network the player drives —
        stranded road/beach fragments don't count)."""
        for dr in range(-reach, reach + 1):
            for dc in range(-reach, reach + 1):
                cc, rr = c + dc, r + dr
                if 0 <= cc < GRID_COLS and 0 <= rr < GRID_ROWS and \
                        main_net[rr * GRID_COLS + cc]:
                    return True
        return False

    def nudge_to_land(x, y, radius_px=POI_NUDGE_PX, need_drivable=False):
        c0, r0 = int(x / GRID_CELL), int(y / GRID_CELL)
        best = None
        R = radius_px // GRID_CELL
        for dr in range(-R, R + 1):
            for dc in range(-R, R + 1):
                c, r = c0 + dc, r0 + dr
                if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS and grid[r * GRID_COLS + c] != CLS_WATER:
                    d2 = dc * dc + dr * dr
                    if (best is None or d2 < best[0]) and (not need_drivable or near_drivable(c, r)):
                        best = (d2, c, r)
        if best is None:
            return None
        return ((best[1] + 0.5) * GRID_CELL, (best[2] + 0.5) * GRID_CELL)

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
    def _drivable_cell(c, r):
        return 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS and \
            grid[r * GRID_COLS + c] in (CLS_ROAD, CLS_BRIDGE)
    def snap_into_block(x, y, reach_px=160, inset_px=32):
        # The anchor is on/next to a street; step into the nearest cuadra
        # interior (CLS_LAND) and then a bit deeper (inset) so the footprint
        # sits INSIDE the block fronting that street, not on the asphalt.
        c0, r0 = int(x / GRID_CELL), int(y / GRID_CELL)
        R = reach_px // GRID_CELL
        best = None
        for dr in range(-R, R + 1):
            for dc in range(-R, R + 1):
                c, r = c0 + dc, r0 + dr
                if not (0 <= c < GRID_COLS and 0 <= r < GRID_ROWS):
                    continue
                if grid[r * GRID_COLS + c] != CLS_LAND:
                    continue
                d2 = dc * dc + dr * dr
                if best is None or d2 < best[0]:
                    best = (d2, c, r)
        if best is None:
            return None
        _, bc, br = best
        # push a couple cells further from the anchor (deeper into the block)
        ins = inset_px // GRID_CELL
        sc = 1 if bc >= c0 else -1
        sr = 1 if br >= r0 else -1
        for k in range(ins, 0, -1):
            nc, nr = bc + sc * k, br + sr * k
            if 0 <= nc < GRID_COLS and 0 <= nr < GRID_ROWS and grid[nr * GRID_COLS + nc] == CLS_LAND:
                bc, br = nc, nr
                break
        return ((bc + 0.5) * GRID_CELL, (br + 0.5) * GRID_CELL)

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
    def _cell_cls(cc, cr):
        if 0 <= cc < GRID_COLS and 0 <= cr < GRID_ROWS:
            return grid[cr * GRID_COLS + cc]
        return CLS_WATER
    def _nearest_cell(x, y, classes, max_cells):
        c0, r0 = int(x // GRID_CELL), int(y // GRID_CELL)
        for rad in range(1, max_cells):
            best = None
            for a in range(0, 360, 6):
                rc = c0 + int(round(math.cos(math.radians(a)) * rad))
                rr = r0 + int(round(math.sin(math.radians(a)) * rad))
                if _cell_cls(rc, rr) in classes:
                    d2 = (rc - c0) ** 2 + (rr - r0) ** 2
                    if best is None or d2 < best[0]:
                        best = (d2, rc, rr)
            if best:
                return ((best[1] + 0.5) * GRID_CELL, (best[2] + 0.5) * GRID_CELL)
        return None
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
    blocks, plazas = detect_blocks(grid, build_band_x1=faro_band_x1)
    # Faro esplanade: paint the paved sand-tip as a gray ground fill by TYPE
    # (single draw — no sand shows under it; follows the sand, never the street).
    if faro_esp:
        plazas.extend([r + ["esplanade"] for r in cells_to_rects(faro_esp, GRID_CELL)])

    # Step each building landmark off its street anchor into a cuadra INTERIOR
    # cell — nearest block, cell ≥1 cuadrícula from any edge so it clears the
    # acera fringe and sits solidly inside the block (church-in-the-street fix).
    def snap_into_block_cell(x, y, max_d_cuads=8):
        ac, ar = int(x // CUAD), int(y // CUAD)
        best = None
        for b in blocks:
            if b.get("green"):
                continue
            for (cc, cr) in b["cells"]:
                d2 = (cc - ac) ** 2 + (cr - ar) ** 2
                if best is None or d2 < best[0]:
                    best = (d2, b["cells"])
        # no buildable block nearby (fine-grained centro cuadras classify as
        # slivers/green): KEEP the geo-true anchor instead of teleporting the
        # building to a far block — this is what stacked catedral/cultura/museo
        # onto one distant cell
        if best is None or best[0] > max_d_cuads ** 2:
            return None
        cells = best[1]
        interior = [c for c in cells
                    if all((c[0] + dx, c[1] + dy) in cells
                           for dx in (-1, 0, 1) for dy in (-1, 0, 1))]
        pool = interior if interior else list(cells)
        tc, tr = min(pool, key=lambda c: (c[0] - ac) ** 2 + (c[1] - ar) ** 2)
        return ((tc + 0.5) * CUAD, (tr + 0.5) * CUAD)
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
    def _nudge_off_acera(x, y, reach_cells=16):
        cx0, cy0 = int(x / GRID_CELL), int(y / GRID_CELL)
        def interior(c, r, pad):
            for dc in range(-pad, pad + 1):
                for dr in range(-pad, pad + 1):
                    cc, rr = c + dc, r + dr
                    if not (0 <= cc < GRID_COLS and 0 <= rr < GRID_ROWS):
                        return False
                    if grid[rr * GRID_COLS + cc] != CLS_LAND:
                        return False
            return True
        for pad in (4, 3, 2):                          # prefer the deepest clearance available
            if interior(cx0, cy0, pad):
                return x, y                            # already well inside its cuadra
            best = None
            for rad in range(1, reach_cells + 1):
                for dc in range(-rad, rad + 1):
                    for dr in range(-rad, rad + 1):
                        if max(abs(dc), abs(dr)) != rad:
                            continue
                        c, r = cx0 + dc, cy0 + dr
                        if interior(c, r, pad):
                            d2 = dc * dc + dr * dr
                            if best is None or d2 < best[0]:
                                best = (d2, c, r)
                if best is not None:
                    break
            if best is not None:
                return (best[1] + 0.5) * GRID_CELL, (best[2] + 0.5) * GRID_CELL
        return x, y
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

    def _block_containing(x, y):
        ac, ar = int(x // CUAD), int(y // CUAD)
        for bi, b in enumerate(blocks):
            if (ac, ar) in b["cells"]:
                return bi
        return None

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

    def _road_adj(cc, cr):
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            px = int((cc + dc + 0.5) * CUAD // GRID_CELL)
            py = int((cr + dr + 0.5) * CUAD // GRID_CELL)
            if _cell_cls(px, py) in (CLS_ROAD, CLS_BRIDGE, CLS_PASEO, CLS_ACERA):
                return True
        return False

    def _kiosk_frontage(x, y):
        ac, ar = int(x // CUAD), int(y // CUAD)
        m = KIOSK_SNAP_CUAD
        best = None
        for (bc0, bc1, br0, br1, cs) in nongreen_blocks:
            if ac < bc0 - m or ac > bc1 + m or ar < br0 - m or ar > br1 + m:
                continue
            for (cc, cr) in cs:
                if abs(cc - ac) > m or abs(cr - ar) > m:
                    continue
                d2 = (cc - ac) ** 2 + (cr - ar) ** 2
                if best is None or d2 < best[0]:
                    best = (d2, cc, cr, cs)
        if best is None:
            return None
        cs = best[3]
        near = [c for c in cs if abs(c[0] - ac) <= m and abs(c[1] - ar) <= m]
        frontage = [c for c in near if _road_adj(*c)]
        pool = frontage if frontage else near
        if not pool:
            return None
        tc, tr = min(pool, key=lambda c: (c[0] - ac) ** 2 + (c[1] - ar) ** 2)
        return ((tc + 0.5) * CUAD, (tr + 0.5) * CUAD)
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
    def _nearest_block(x, y, min_cells=12):
        ac, ar = int(x // CUAD), int(y // CUAD)
        best = None
        for bi, b in enumerate(blocks):
            if b.get("green") or len(b["cells"]) < min_cells:
                continue
            cs = b["cells"]
            cx = sum(c for c, _ in cs) / len(cs); cy = sum(r for _, r in cs) / len(cs)
            d2 = (cx - ac) ** 2 + (cy - ar) ** 2
            if best is None or d2 < best[0]:
                best = (d2, bi)
        return best[1] if best else None
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

    # --- verification gate: every POI reachable through the drivable network
    # from the Faro spawn, plus a cuadrícula block census (tuning instrument).
    _kf = next((l for l in landmarks if l["id"] == "kios_faro"), None)
    spawn = tuple(_kf["spawn"]) if (_kf and _kf.get("spawn")) else (
        (faro_lm["x"], faro_lm["y"]) if faro_lm else (
            (landmarks[0]["x"], landmarks[0]["y"]) if landmarks else (CANVAS_W // 2, CANVAS_H // 2)))
    # scenery landmarks (no drivable pad) aren't delivery targets → exclude
    # them from the reachability gate
    gate_pois = [l for l in landmarks if l["type"] not in NO_PAD_LM] + customers
    unreachable = verify_connectivity(grid, spawn,
                                      gate_pois, reach=ACERA_CELLS + 1)
    failures.extend("unreachable " + u for u in unreachable)
    block_census(grid)

    mata_x0 = next(d["x0"] for d in districts if d["id"] == "mata")
    hills = [{"x0": mata_x0 - 1200, "x1": CANVAS_W, "baseY": 750, "color": "#5e8a55"},
             {"x0": mata_x0, "x1": CANVAS_W - 600, "baseY": 600, "color": "#4c7848"}]

    # --- emit
    meta = {"W": CANVAS_W, "H": CANVAS_H, "centerY": CENTER_Y, "cell": GRID_CELL,
            "cuad": CUAD, "cuadsPerView": CUADS_PER_VIEW,
            "aceraPx": ACERA_CELLS * GRID_CELL,
            "pxPerMeter": round(sp.px_per_m, 5), "crossExag": CROSS_EXAG,
            "spineLenM": round(sp.total)}
    # geo→world affine (planar projection is exactly linear in lon/lat):
    # x = ax*lon + bx ; y = ay*lat + by. Lets the CLIENT place remote
    # content (server NPCs / sponsored lotes) given real lat/lon, without
    # shipping the projection code.
    la0, lo0, la1, lo1 = 9.90, -84.90, 10.00, -84.70  # two reference points
    xa, ya, _, _ = sp.project(to_m(la0, lo0))
    xb, yb, _, _ = sp.project(to_m(la1, lo1))
    ax = (xb - xa) / (lo1 - lo0); bx = xa - ax * lo0
    ay = (yb - ya) / (la1 - la0); by = ya - ay * la0
    meta["geo"] = {"ax": round(ax, 4), "bx": round(bx, 2),
                   "ay": round(ay, 4), "by": round(by, 2)}
    # chunked/tiled emit → src/world2d/ (streamable full-OSM world)
    emit_world2d(raster, JsonWorldRepository(WORLD2D_DIR), meta=meta, districts=districts, roads=roads, rails=rails,
                 buildings=buildings, trees=trees, palms=palms, mangroves=mangroves,
                 medians=medians, plazas=plazas, greens=greens, islands=junction_islands,
                 beaches=beaches, waters=waters, land_polys=land_contours,
                 landmarks=landmarks, customers=customers, stages=STAGES, stadiums=stadiums,
                 kiosk_paths=kiosk_paths, faro_pier=faro_pier, balneario=balneario,
                 bridge=bridge, estuary=est, pier=pier, hills=hills, pois=pois, parcels=parcels)

    # --- debug renders
    render_debug(raster=raster, buildings=buildings, landmarks=landmarks,
                 customers=customers, roads=roads, land_contours=land_contours,
                 waters=waters, bounds_x=bounds_x,
                 png_path=DEBUG_PNG, svg_path=DEBUG_SVG)

    log("done", f"total {time.time()-t0:.1f}s")
    # Note: the service worker (public/sw.js) uses runtime caching with a manual
    # CACHE version now that Vite fingerprints assets — no build-time stamping.
    if failures:
        # every POI + stage must resolve (52/52 reachable) — the gate is fatal
        # so a regression fails the build loudly.
        raise SystemExit(f"[poi] BUILD INCOMPLETE — unresolved: {failures}")


if __name__ == "__main__":
    main()
