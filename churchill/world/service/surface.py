"""Painting the surface raster: shorelines, sidewalks, sand and POI aprons.

The order these run in is load-bearing and easy to get wrong:

  1. the coast + water-area BARRIERS, then the flood — everything the sea cannot
     reach past a closed barrier is land, so one sub-cell gap floods the
     peninsula;
  2. beaches, then the estuary basin and mapped water polygons;
  3. the FINAL land silhouette, after every early land/water change;
  4. roads;
  5. `acera_fringe` — sidewalks grow OUT of the roads, so anything stamped
     after it (a stadium pitch, a median) will NOT be re-ringed with sidewalk.
     That is exactly how a whole-cuadra field reads as one open surface.

`stamp_pad` is the exception that proves the rule: it punches a drivable apron
back THROUGH the acera so you can pull off the street to a kiosk.
"""
import math
from collections import deque

from ..config import (
    ACERA_CELLS, CALLE_CLASSES, CLS_ACERA, CLS_BEACH, CLS_LAND, CLS_MALECON,
    CLS_PASEO, CLS_ROAD, CLS_WATER,
    CUAD, CUAD_CELLS, DP_COAST_PX, DP_SAND_PX, ESTERO_MAINLAND_PX, GRID_CELL,
    MANGROVE_R_MAX, SPIT_MAX_WIDTH_PX, SPIT_SHORE_TOL_PX,
)
from ..logging import log, warn
from ..util.geometry import dp_simplify, poly_area, to_m
from ..util.raster import Raster
from .block import outline_polys
from .projection import project_way_pts


def _stamp_barrier(barrier, cols, rows, c, r):
    """Set a barrier cell, thickened to a 3x3 block so sub-cell gaps at
    coastline segment joints don't leak the sea flood into the land (the
    single-cell supercover line can miss a diagonal where two chains meet)."""
    rad = 1
    n = 0
    for dr in range(-rad, rad + 1):
        for dc in range(-rad, rad + 1):
            cc, rr = c + dc, r + dr
            if 0 <= cc < cols and 0 <= rr < rows and not barrier[rr * cols + cc]:
                barrier[rr * cols + cc] = 1
                n += 1
    return n


def raster_coast_barrier(barrier, raster, sp, chains, nodes):
    """Rasterize coastline chains as barriers (supercover lines)."""
    cols, rows, cell = raster.cols, raster.rows, raster.cell
    drawn = 0
    for nds in chains:
        pts_m = [to_m(*nodes[r]) for r in nds if r in nodes]
        if len(pts_m) < 2:
            continue
        # EVERY coastline chain is rasterised: the estuary/south/inland shores
        # are far from the town, and dropping any of them leaves the peninsula
        # unenclosed and the sea flood leaks inland.
        pts, _ = project_way_pts(sp, pts_m)
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            L = math.hypot(x1 - x0, y1 - y0)
            steps = max(1, int(L / (GRID_CELL * 0.5)))
            for k in range(steps + 1):
                x = x0 + (x1 - x0) * k / steps
                y = y0 + (y1 - y0) * k / steps
                c, r = int(x / GRID_CELL), int(y / GRID_CELL)
                if 0 <= c < cols and 0 <= r < rows:
                    drawn += _stamp_barrier(barrier, cols, rows, c, r)
    log("coast", f"rasterized barrier cells: {drawn}")


def raster_poly_barrier(barrier, raster, polys):
    """Rasterize closed polygon boundaries (flat px coords) as 1-cell flood
    barriers. natural=water bodies are mapped by OSM as AREAS, not coastline —
    notably the Estero de Puntarenas along the spit's north shore. Without their
    outline as a barrier the sea flood leaks across that un-barriered shore and
    drains the whole peninsula to water. Their interiors are stamped CLS_WATER
    after the flood regardless, so bordering them only contains the flood."""
    cols, rows = raster.cols, raster.rows
    drawn = 0
    for poly in polys:
        pts = [(poly[i], poly[i + 1]) for i in range(0, len(poly), 2)]
        if len(pts) < 3:
            continue
        pts.append(pts[0])
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            L = math.hypot(x1 - x0, y1 - y0)
            steps = max(1, int(L / (GRID_CELL * 0.5)))
            for k in range(steps + 1):
                x = x0 + (x1 - x0) * k / steps
                y = y0 + (y1 - y0) * k / steps
                c, r = int(x / GRID_CELL), int(y / GRID_CELL)
                if 0 <= c < cols and 0 <= r < rows:
                    drawn += _stamp_barrier(barrier, cols, rows, c, r)
    return drawn


def trace_land_contours(raster):
    """Marching-squares style: emit oriented boundary edges (land on left),
    chain them into loops, return px-space polygons.

    THE EDGE MAP IS A MULTIMAP, and it has to be. A lattice point where two land
    cells meet CORNER TO CORNER across water — a diagonal pinch — is the start
    of TWO boundary edges. Held in a plain `start -> end` dict the second
    overwrites the first, the walk that reaches the lost one runs off the end of
    the chain, and the closing test then discards THE WHOLE LOOP.

    That is not a rounding error: it silently deletes a coastline. Measured on
    2026-08-23, opening the estuary added enough new diagonal pinches to take
    out the single 24 200-vertex loop that is the entire mainland-plus-spit —
    so `landPolys` went 26 -> 54 while the peninsula the game is set on stopped
    having a silhouette at all, and the manzana interiors of El Cocal rendered
    as open sea. The bug was always here; the old waterline simply never pinched.

    So: every outgoing edge is kept, one is consumed per visit, and a pinch is
    walked once per loop through it. And a loop that still fails to close is
    LOGGED rather than dropped in silence — that is the part that let this ship.
    """
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    edges = {}  # start -> [end, ...]

    def is_land(c, r):
        if c < 0 or c >= cols or r < 0 or r >= rows:
            return False
        return grid[r * cols + c] != CLS_WATER

    def add(a, b):
        edges.setdefault(a, []).append(b)

    G = GRID_CELL
    for r in range(rows):
        for c in range(cols):
            if not is_land(c, r):
                continue
            x0, y0, x1, y1 = c * G, r * G, (c + 1) * G, (r + 1) * G
            if not is_land(c + 1, r):
                add((x1, y1), (x1, y0))
            if not is_land(c - 1, r):
                add((x0, y0), (x0, y1))
            if not is_land(c, r - 1):
                add((x1, y0), (x0, y0))
            if not is_land(c, r + 1):
                add((x0, y1), (x1, y1))

    def take(v):
        """One outgoing edge from `v`, or None once it is spent."""
        outs = edges.get(v)
        if not outs:
            return None
        nxt = outs.pop()
        if not outs:
            del edges[v]
        return nxt

    loops = []
    dropped = 0
    while edges:
        start = next(iter(edges))
        cur = take(start)
        loop = [start]
        while cur is not None and cur != start:
            loop.append(cur)
            cur = take(cur)
        if cur == start and len(loop) >= 8:
            loops.append(loop)
        elif len(loop) >= 8:
            dropped = max(dropped, len(loop))
    if dropped:
        warn("coast", f"a boundary chain of {dropped} points never closed — "
                      "the land silhouette is missing a piece")
    out = []
    for lp in loops:
        if abs(poly_area(lp)) < 400:  # skip specks
            continue
        simp = dp_simplify(lp + [lp[0]], DP_COAST_PX)[:-1]
        if len(simp) >= 3:
            out.append([round(v) for p in simp for v in p])
    out.sort(key=lambda fl: -abs(poly_area([(fl[i], fl[i + 1]) for i in range(0, len(fl), 2)])))
    log("coast", f"traced {len(out)} land contour loops")
    return out


def acera_fringe(raster, depth_cells=ACERA_CELLS):
    """Sidewalks: convert land cells bordering a carriageway into acera."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    # A sidewalk grows beside any street at street level, including the unpaved
    # calles — they are ordinary streets that happen to be made of earth.
    # Leaving barro out took the acera off 8,204 cells of real cuadra frontage
    # the moment dirt became a class of its own.
    cur = [i for i in range(len(grid)) if grid[i] in CALLE_CLASSES]
    for _ in range(depth_cells):
        nxt = []
        for idx in cur:
            r, c = divmod(idx, cols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < rows and 0 <= nc < cols:
                    nidx = nr * cols + nc
                    if grid[nidx] == CLS_LAND:
                        grid[nidx] = CLS_ACERA
                        nxt.append(nidx)
        cur = nxt


def stamp_pad(raster, x, y, r_px):
    """Carve a drivable road apron under a POI, punching through the acera so
    you can pull off the street right up to the kiosk/customer even though
    aceras are otherwise non-drivable curbs. Cuadrícula-aligned: the apron is
    a whole-CUAD square centered on the POI's cuadrícula cell.

    …AND THROUGH THE MALECÓN, for exactly the same reason. While the promenade
    was drivable this never came up; the moment it became a wall, `c3` — the
    Carnaval troupe, who stand on the sea front at (23658, 15946) — was a
    delivery target standing on a wall, and the build's own reachability gate
    caught it: `46/47 POIs ok, unreachable c3`. A customer is somewhere you have
    to be able to DRIVE TO, so the apron punches through whatever is under them
    that a car cannot cross. That is the whole point of it."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    side = max(2, round(2 * r_px / CUAD))          # side in cuadrículas
    cc0 = int(x // CUAD) - (side - 1) // 2
    cr0 = int(y // CUAD) - (side - 1) // 2
    c0, r0 = cc0 * CUAD_CELLS, cr0 * CUAD_CELLS    # raster origin, on-lattice
    for r in range(max(0, r0), min(rows, r0 + side * CUAD_CELLS)):
        row = r * cols
        for c in range(max(0, c0), min(cols, c0 + side * CUAD_CELLS)):
            if grid[row + c] in (CLS_LAND, CLS_ACERA, CLS_MALECON):
                grid[row + c] = CLS_ROAD


# A byte no surface class uses, borrowed for the length of `beach_fringe` to
# hide the estuary from the sand seed. It never reaches the emit: the band is
# restored to CLS_WATER before the function returns.
_NOT_SEA = 255


def estero_band(raster):
    """Per column, the rows the ESTUARY occupies — or None where there is none.

    Puntarenas is a spit, and which sea a shore faces is the whole difference
    between sand and mangrove: the Paseo de los Turistas really is a beach, the
    Estero de Puntarenas is mangrove down to the waterline. Nothing in the OSM
    input says which water is which, so derive it from the landform, the way
    `place_pois` finds the estero shore for the Muelle de Pitahaya — a column
    walk north from a cell known to be on the spit. Generalising that walk to
    every column needs one thing the pier did not: knowing WHICH columns are the
    spit, since the same walk on the mainland finds an inland river.

    Note that `topY[col]` is NOT the answer and never was (see poi_stage): the
    first land in a column, this far north, is the far side of the estuary.

    So the spit is TRACED, not assumed:
      * a column is a candidate if the land run above its southernmost water is
        narrower than `SPIT_MAX_WIDTH_PX` — i.e. it has water on both sides;
      * candidates chain left-to-right while their Pacific shore moves less than
        `SPIT_SHORE_TOL_PX` per column, so a chain follows ONE shoreline and
        breaks where the land ends rather than jumping to the next island;
      * the LONGEST chain is the spit. On the real map it wins by 12x (19.7 km
        of it against a 1.6 km runner-up at Mata de Limón), so this is not a
        close call that a coastline edit could flip.

    From each spit column, walk north: every water run is estuary, and a land
    run narrower than `ESTERO_MAINLAND_PX` is an island in it (mangrove on both
    its shores too) rather than the far shore. The band ends at the first run
    wide enough to be the mainland.

    Columns with no spit report None and their water counts as open sea, which
    is the safe way to be wrong: it is exactly today's behaviour.
    """
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    cell = raster.cell
    max_spit = SPIT_MAX_WIDTH_PX // cell
    tol = SPIT_SHORE_TOL_PX // cell
    mainland = ESTERO_MAINLAND_PX // cell
    water = bytes([CLS_WATER])

    # candidate spit columns: (southernmost land row, first water row north)
    shore = [-1] * cols          # the Pacific shore row
    north = [-1] * cols          # the first estuary water row north of it
    for c in range(cols):
        col = grid[c::cols]
        bot = len(col.rstrip(water))          # one past the southernmost land
        if bot == 0:
            continue
        w = col.rfind(CLS_WATER, 0, bot)
        if w < 0 or bot - 1 - w > max_spit:   # no water north, or that is mainland
            continue
        shore[c] = bot - 1
        north[c] = w

    best = (0, -1, -1)
    c = 0
    while c < cols:
        if shore[c] < 0:
            c += 1
            continue
        start = c
        c += 1
        while c < cols and shore[c] >= 0 and abs(shore[c] - shore[c - 1]) <= tol:
            c += 1
        if c - start > best[0]:
            best = (c - start, start, c - 1)
    n_cols, c0, c1 = best
    if n_cols == 0:
        log("estero", "no spit traced — every water cell counts as open sea")
        return [None] * cols

    band = [None] * cols
    n_water = 0
    for c in range(c0, c1 + 1):
        col = grid[c::cols]
        r = north[c]
        top = r
        while r >= 0:
            while r >= 0 and col[r] == CLS_WATER:      # estuary
                r -= 1
            top = r + 1
            if r < 0:
                break
            end = r
            while r >= 0 and col[r] != CLS_WATER:      # island, or the far shore
                r -= 1
            if end - r >= mainland:
                break
        band[c] = (top, north[c])
        n_water += col.count(CLS_WATER, top, north[c] + 1)
    log("estero", f"spit traced over {n_cols} columns, x {c0 * cell}..{c1 * cell}px; "
        f"estuary north of it: {n_water} water cells")
    return band


# One full largest mangrove clump between the opened basin and either shore.
# This is deliberately derived from the existing flora dial instead of adding
# a second number that could drift away from the thing the rim has to hold.
ESTERO_RIM_CELLS = max(1, math.ceil(MANGROVE_R_MAX / GRID_CELL))


def estuary_claim_mask(raster, band, *, roads=(), sites=(), pois=(),
                       authored_pois=(), parcels=(), occ=(), bridge_road=None,
                       poi_pad_px=56):
    """Scratch bitmap of authored ground the estuary opening must keep.

    The basin has to open before blocks, parcels and their shared ``occ`` set
    exist, because the land silhouette is traced in the surface stage.  Protect
    their SOURCE geometry here instead: a road plus its future acera, OSM site
    polygons (the future parcels), the exact cuadrícula-aligned POI apron, and
    any parcel/occ claims a caller already has.  The bitmap is also the visited
    scratch space consumed by :func:`open_estuary`; do not retain it afterwards.

    Only features whose bbox intersects the estuary's rectangular extent are
    stamped.  On the full 247M-cell raster that turns an otherwise global
    second placement pass into a small, countable guard pass.
    """
    segments = [(c, seg) for c, seg in enumerate(band[:raster.cols])
                if seg is not None]
    counts = {"roads": 0, "sites": 0, "pois": 0, "authored": 0,
              "parcels": 0, "occ": 0}
    if not segments:
        return None, counts

    c0, c1 = segments[0][0], segments[-1][0]
    r0 = min(seg[0] for _, seg in segments)
    r1 = max(seg[1] for _, seg in segments)
    x0, y0 = c0 * raster.cell, r0 * raster.cell
    x1, y1 = (c1 + 1) * raster.cell, (r1 + 1) * raster.cell
    claims = Raster(raster.cols, raster.rows, raster.cell)

    def overlaps(points, pad=0):
        if not points:
            return False
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return not (max(xs) + pad < x0 or min(xs) - pad > x1
                    or max(ys) + pad < y0 or min(ys) - pad > y1)

    def points_of(record):
        raw = record.get("pts") or record.get("poly") or ()
        if raw and isinstance(raw[0], (int, float)):
            return list(zip(raw[0::2], raw[1::2]))
        return list(raw)

    # The surface stage has not stamped roads yet.  Reserve the carriageway and
    # the LAND the later acera fringe needs on both sides, or opening the basin
    # first would silently remove a waterfront street's sidewalk.
    road_records = list(roads)
    # extract_roads returns the bridge both in `roads` and as the convenience
    # pointer `bridge_road`; do not count/stamp the same source twice.
    if bridge_road and bridge_road not in road_records:
        road_records.append(bridge_road)
    acera_pad = ACERA_CELLS * raster.cell
    for road in road_records:
        pts = list(zip(road.get("pts", ())[0::2], road.get("pts", ())[1::2]))
        half_width = road.get("w", 0) / 2 + acera_pad
        if not overlaps(pts, half_width):
            continue
        claims.stamp_polyline(road["pts"], road.get("w", 0) + 2 * acera_pad, 1)
        counts["roads"] += 1

    for label, records in (("sites", sites), ("parcels", parcels)):
        for record in records:
            pts = points_of(record)
            if len(pts) < 3 or not overlaps(pts):
                continue
            claims.fill_poly(pts, 1)
            counts[label] += 1

    # Match stamp_pad exactly: it is a whole-CUAD square, not a radius around
    # the point.  Using the same lattice is what makes this a POI-apron guard
    # rather than a merely nearby keep-out.
    side = max(2, round(2 * poi_pad_px / CUAD))
    for label, records in (("pois", pois), ("authored", authored_pois)):
        for poi in records:
            x, y = poi.get("x"), poi.get("y")
            if x is None or y is None:
                continue
            cc0 = int(x // CUAD) - (side - 1) // 2
            cr0 = int(y // CUAD) - (side - 1) // 2
            pc0, pr0 = cc0 * CUAD_CELLS, cr0 * CUAD_CELLS
            pc1, pr1 = pc0 + side * CUAD_CELLS, pr0 + side * CUAD_CELLS
            if pc1 * raster.cell < x0 or pc0 * raster.cell > x1 \
                    or pr1 * raster.cell < y0 or pr0 * raster.cell > y1:
                continue
            for row in range(max(0, pr0), min(raster.rows, pr1)):
                base = row * raster.cols
                for col in range(max(0, pc0), min(raster.cols, pc1)):
                    claims.buf[base + col] = 1
            counts[label] += 1

    # ``occ`` is expressed in CUAD cells.  It is empty in today's early stage,
    # but accepting it makes the guard exact for focused tests and for any
    # future pre-authored claim without moving the coastline pass later.
    for cc, cr in occ:
        oc0, or0 = cc * CUAD_CELLS, cr * CUAD_CELLS
        if (oc0 + CUAD_CELLS) * raster.cell < x0 or oc0 * raster.cell > x1 \
                or (or0 + CUAD_CELLS) * raster.cell < y0 or or0 * raster.cell > y1:
            continue
        for row in range(max(0, or0), min(raster.rows, or0 + CUAD_CELLS)):
            base = row * raster.cols
            for col in range(max(0, oc0), min(raster.cols, oc0 + CUAD_CELLS)):
                claims.buf[base + col] = 1
        counts["occ"] += 1

    return claims.buf, counts


def open_estuary(raster, band, *, claims=None, rim_cells=ESTERO_RIM_CELLS):
    """Turn the estuary's shore-connected interior LAND into open WATER.

    The band is the hard cap: no search or write may cross it into town.  A
    connected LAND component wholly inside the cap is an islet and survives.
    A component touching the cap is shoreline/mangrove flat: keep a rim at the
    north or south edge and open the rest.  ``claims`` protects authored ground
    inside that flat.  Every other surface class is untouched by construction.

    Returns countable buckets whose sum is the LAND examined.  ``claims`` is a
    scratch bytearray and is consumed (bit 1 is used as the visited flag).
    """
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    rim_cells = max(0, int(rim_cells))
    stats = {"mask": 0, "land": 0, "opened": 0, "rim": 0,
             "islets": 0, "islet_cells": 0, "claims": 0}
    segments = [(c, seg) for c, seg in enumerate(band[:cols]) if seg is not None]
    if not segments:
        return stats
    stats["mask"] = sum(bot - top + 1 for _, (top, bot) in segments)
    marks = claims if claims is not None else bytearray(len(grid))
    if len(marks) != len(grid):
        raise ValueError("estuary claim mask must match the surface raster")

    def inside(c, r):
        if not (0 <= c < cols and 0 <= r < rows and c < len(band)):
            return False
        seg = band[c]
        return seg is not None and seg[0] <= r <= seg[1]

    for c, (top, bot) in segments:
        for r in range(top, bot + 1):
            idx = r * cols + c
            if grid[idx] != CLS_LAND or marks[idx] & 2:
                continue
            component = []
            queue = deque([idx])
            marks[idx] |= 2
            touches_cap = False
            while queue:
                cur = queue.popleft()
                component.append(cur)
                rr, cc = divmod(cur, cols)
                for nc, nr in ((cc - 1, rr), (cc + 1, rr),
                               (cc, rr - 1), (cc, rr + 1)):
                    if not inside(nc, nr):
                        touches_cap = True
                        continue
                    ni = nr * cols + nc
                    if grid[ni] == CLS_LAND and not marks[ni] & 2:
                        marks[ni] |= 2
                        queue.append(ni)

            stats["land"] += len(component)
            if not touches_cap:
                stats["islets"] += 1
                stats["islet_cells"] += len(component)
                continue
            for cur in component:
                rr, cc = divmod(cur, cols)
                seg_top, seg_bot = band[cc]
                if marks[cur] & 1:
                    stats["claims"] += 1
                elif min(rr - seg_top, seg_bot - rr) < rim_cells:
                    stats["rim"] += 1
                else:
                    grid[cur] = CLS_WATER
                    stats["opened"] += 1

    log("estero", f"basin opened {stats['opened']} LAND cells to WATER inside "
        f"{stats['mask']} mask cells; kept {stats['rim']} shore-rim cells at "
        f"{rim_cells * raster.cell}px, {stats['islet_cells']} cells in "
        f"{stats['islets']} islet(s), {stats['claims']} claimed cells")
    return stats


def beach_fringe(raster, depth_cells=3, band=None):
    """Mark land cells within depth of water as beach (natural sand fringe).

    `band` (from `estero_band`) is the estuary, and it grows NO sand: the estero
    is mangrove down to the waterline. It is hidden from the seed rather than
    subtracted afterwards, because a cell within reach of both waters is a real
    beach — the open sea has to win — and only a seed-side filter gets that
    right.
    """
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    water, hidden = bytes([CLS_WATER]), bytes([_NOT_SEA])
    masked, est_seeds = [], []
    for c, seg in enumerate(band or ()):
        if seg is None:
            continue
        top, bot = seg
        sl = slice(top * cols + c, bot * cols + c + 1, cols)
        grid[sl] = grid[sl].replace(water, hidden)
        masked.append(sl)
        est_seeds.extend(top * cols + c + k * cols
                         for k, v in enumerate(grid[sl]) if v == _NOT_SEA)

    def spread(seeds, paint):
        """`depth_cells` rings of 4-neighbour growth over CLS_LAND. `paint`
        writes the sand; a shadow pass marks `seen` and leaves the grid alone."""
        cur, n = seeds, 0
        for _ in range(depth_cells):
            nxt = []
            for idx in cur:
                r, c = divmod(idx, cols)
                for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                    if 0 <= nr < rows and 0 <= nc < cols:
                        nidx = nr * cols + nc
                        if grid[nidx] == CLS_LAND and paint(nidx):
                            nxt.append(nidx)
            n += len(nxt)
            cur = nxt
        return n

    def sand(idx):
        grid[idx] = CLS_BEACH
        return True
    n_sand = spread([i for i in range(len(grid)) if grid[i] == CLS_WATER], sand)

    # The same growth from the estuary, but only counted: it is the sand the
    # north shore USED to get, and the whole point of the split is that it is
    # now mangrove bank instead.
    seen = bytearray(len(grid)) if est_seeds else None

    def mark(idx):
        if seen[idx]:
            return False
        seen[idx] = 1
        return True
    n_kept = spread(est_seeds, mark) if est_seeds else 0
    del seen

    for sl in masked:                       # the estuary is water again
        grid[sl] = grid[sl].replace(hidden, water)
    log("beach", f"{n_sand} cells of sand fringed onto the open-sea shores; "
        f"{n_kept} cells of estuary bank stayed land (mangrove, not sand); "
        f"{grid.count(CLS_BEACH)} beach cells in total")
    return n_sand


def reclaim_shore(raster, band, depth_cells, corridor=None):
    """Push the WATERLINE OUT: grow the sand `depth_cells` rings into the sea.

    The one deliberate lie this map tells about its own coast, and it is told on
    purpose. Puntarenas' playa is 15-40 m of sand; the camera frames twenty
    cuadrículas, so at true scale the beach is a stripe you cross rather than a
    place, and the malecón beside it has nothing to be beside. Twenty metres of
    reclaimed sea (SHORE_RECLAIM_M) makes the playa read at play zoom without
    the spit visibly fattening.

    It is the exact inverse of `beach_fringe` — that one grows sand INLAND out
    of the land, this one grows it SEAWARD out of the water — and it borrows the
    same estuary mask for the same reason: the estero is mangrove down to the
    waterline and must not gain a metre of beach. Run it right after the fringe,
    and BEFORE `trace_land_contours`, or the drawn coast silhouette keeps the
    old waterline while the raster has the new one.

    Two things bound it, and both were learned by leaving them out:

    * THE CORRIDOR. Run over the whole map it reclaimed 490 384 cells — it more
      than DOUBLED the world's sand, doubled the beach palms with it, and left
      300 000 more drivable cells stranded off the network, all to widen a beach
      nobody plays on. `corridor` is the waterfront the paseos run along, which
      is the beach the camera is ever pointed at.
    * THE CHANNEL. A ring grown blindly closes any water narrower than twice the
      depth — it walled off a sea probe on the first run. So each candidate
      casts the growth direction forward: if the far shore is within reach, this
      is a channel, not the open gulf, and it keeps its water.
    """
    if depth_cells <= 0:
        return 0
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    water, hidden = bytes([CLS_WATER]), bytes([_NOT_SEA])
    masked = []
    for c, seg in enumerate(band or ()):
        if seg is None:
            continue
        top, bot = seg
        sl = slice(top * cols + c, bot * cols + c + 1, cols)
        grid[sl] = grid[sl].replace(water, hidden)
        masked.append(sl)
    cell = raster.cell
    c0, r0, c1, r1 = 0, 0, cols - 1, rows - 1
    if corridor:
        c0 = max(0, int(corridor[0] // cell)); r0 = max(0, int(corridor[1] // cell))
        c1 = min(cols - 1, int(corridor[2] // cell)); r1 = min(rows - 1, int(corridor[3] // cell))

    def open_water(c, r, dc, dr):
        """Is there still sea past this cell, or is the far shore right there?"""
        for k in range(1, depth_cells + 2):
            cc, rr = c + dc * k, r + dr * k
            if not (0 <= cc < cols and 0 <= rr < rows):
                return True                 # the map edge is open gulf
            if grid[rr * cols + cc] != CLS_WATER:
                return False
        return True

    cur = [r * cols + c
           for r in range(r0, r1 + 1)
           for c in range(c0, c1 + 1)
           if grid[r * cols + c] == CLS_BEACH]
    gained, blocked = 0, 0
    for _ in range(depth_cells):
        nxt = []
        for idx in cur:
            r, c = divmod(idx, cols)
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if not (r0 <= nr <= r1 and c0 <= nc <= c1):
                    continue
                nidx = nr * cols + nc
                if grid[nidx] != CLS_WATER:
                    continue
                if not open_water(nc, nr, dc, dr):
                    blocked += 1
                    continue
                grid[nidx] = CLS_BEACH
                nxt.append(nidx)
        gained += len(nxt)
        cur = nxt
    for sl in masked:                       # the estuary is water again
        grid[sl] = grid[sl].replace(hidden, water)
    log("beach", f"{gained} cells of sea reclaimed as sand ({depth_cells} rings "
        f"= {depth_cells * cell}px along the paseos' waterfront); {blocked} cells "
        f"left as water because the far shore was within reach")
    return gained


def sand_outlines(raster, tolerance_px=DP_SAND_PX):
    """The DRAWN sand, traced from the sand you actually drive on.

    THIS IS WHY THE BEACH HAD TWO COLOURS. `beaches` used to ship the raw OSM
    `natural=beach` outlines — 29 polygons, 366 points — while the raster's sand
    is those polygons PLUS nine rings of `beach_fringe` grown inland from the
    water. Along the Paseo, 8.5 % of the beach cells fell outside the drawn
    polygons and were painted with the land tan under them instead of with sand,
    and because the polygon edge is a long simplified chord the seam read as a
    hard straight line down the playa.

    Tracing the finished raster removes the disagreement instead of papering
    over it: what is drawn as sand is exactly what is sand. Run LAST, after
    every stamp — the malecón, the faro's esplanade, the pads and the bajadas
    all take cells out of the beach, and a sand outline that predates them draws
    over the lot.

    Cheap, measured on this world: 407 355 cells -> 212 rings, 9 318 points,
    ~120 KB of manifest, ~3 s.
    """
    cells = set()
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    for r in range(rows):
        row = grid[r * cols:(r + 1) * cols]
        if CLS_BEACH not in row:
            continue
        for c in range(cols):
            if row[c] == CLS_BEACH:
                cells.add((c, r))
    polys = []
    for flat in outline_polys(cells, raster.cell):
        pts = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
        pts = dp_simplify(pts + [pts[0]], tolerance_px)[:-1]
        if len(pts) >= 3:
            polys.append([round(v) for p in pts for v in p])
    log("beach", f"{len(cells)} sand cells traced into {len(polys)} outlines, "
        f"{sum(len(p) // 2 for p in polys)} points (DP {tolerance_px}px) — the "
        f"drawn playa is now exactly the playa")
    return polys

# ------------------------------------------------------ verification gate ---

# What physics lets you drive: streets/paseo/bridges plus beach (sand is slow
# but not a wall — several POIs are beach-side and reached across the sand).
