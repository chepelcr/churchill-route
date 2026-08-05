"""Painting the surface raster: shorelines, sidewalks, sand and POI aprons.

The order these run in is load-bearing and easy to get wrong:

  1. the coast + water-area BARRIERS, then the flood — everything the sea cannot
     reach past a closed barrier is land, so one sub-cell gap floods the
     peninsula;
  2. beaches and water polygons stamped over the flooded result;
  3. roads;
  4. `acera_fringe` — sidewalks grow OUT of the roads, so anything stamped
     after it (a stadium pitch, a median) will NOT be re-ringed with sidewalk.
     That is exactly how a whole-cuadra field reads as one open surface.

`stamp_pad` is the exception that proves the rule: it punches a drivable apron
back THROUGH the acera so you can pull off the street to a kiosk.
"""
import math
from collections import deque

from ..config import (
    ACERA_CELLS, CALLE_CLASSES, CLS_ACERA, CLS_BEACH, CLS_LAND, CLS_PASEO,
    CLS_ROAD, CLS_WATER,
    CUAD, CUAD_CELLS, DP_COAST_PX, ESTERO_MAINLAND_PX, GRID_CELL,
    SPIT_MAX_WIDTH_PX, SPIT_SHORE_TOL_PX,
)
from ..logging import log
from ..util.geometry import dp_simplify, poly_area, to_m
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
    chain them into loops, return px-space polygons."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    edges = {}  # start -> end

    def is_land(c, r):
        if c < 0 or c >= cols or r < 0 or r >= rows:
            return False
        return grid[r * cols + c] != CLS_WATER

    G = GRID_CELL
    for r in range(rows):
        for c in range(cols):
            if not is_land(c, r):
                continue
            x0, y0, x1, y1 = c * G, r * G, (c + 1) * G, (r + 1) * G
            if not is_land(c + 1, r):
                edges[(x1, y1)] = (x1, y0)
            if not is_land(c - 1, r):
                edges[(x0, y0)] = (x0, y1)
            if not is_land(c, r - 1):
                edges[(x1, y0)] = (x0, y0)
            if not is_land(c, r + 1):
                edges[(x0, y1)] = (x1, y1)
    loops = []
    while edges:
        start, cur = next(iter(edges.items()))
        loop = [start]
        del edges[start]
        while cur != start and cur in edges:
            loop.append(cur)
            nxt = edges[cur]
            del edges[cur]
            cur = nxt
        if cur == start and len(loop) >= 8:
            loops.append(loop)
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
    a whole-CUAD square centered on the POI's cuadrícula cell."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    side = max(2, round(2 * r_px / CUAD))          # side in cuadrículas
    cc0 = int(x // CUAD) - (side - 1) // 2
    cr0 = int(y // CUAD) - (side - 1) // 2
    c0, r0 = cc0 * CUAD_CELLS, cr0 * CUAD_CELLS    # raster origin, on-lattice
    for r in range(max(0, r0), min(rows, r0 + side * CUAD_CELLS)):
        row = r * cols
        for c in range(max(0, c0), min(cols, c0 + side * CUAD_CELLS)):
            if grid[row + c] in (CLS_LAND, CLS_ACERA):
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

# ------------------------------------------------------ verification gate ---

# What physics lets you drive: streets/paseo/bridges plus beach (sand is slow
# but not a wall — several POIs are beach-side and reached across the sand).
