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
    ACERA_CELLS, CLS_ACERA, CLS_BEACH, CLS_LAND, CLS_PASEO, CLS_ROAD, CLS_WATER,
    CUAD, CUAD_CELLS, DP_COAST_PX, GRID_CELL,
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
    """Sidewalks: convert land cells bordering roads/paseo into acera."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    cur = [i for i in range(len(grid)) if grid[i] in (CLS_ROAD, CLS_PASEO)]
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


def beach_fringe(raster, depth_cells=3):
    """Mark land cells within depth of water as beach (natural sand fringe)."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    cur = [i for i in range(len(grid)) if grid[i] == CLS_WATER]
    for _ in range(depth_cells):
        nxt = []
        for idx in cur:
            r, c = divmod(idx, cols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < rows and 0 <= nc < cols:
                    nidx = nr * cols + nc
                    if grid[nidx] == CLS_LAND:
                        grid[nidx] = CLS_BEACH
                        nxt.append(nidx)
        cur = nxt

# ------------------------------------------------------ verification gate ---

# What physics lets you drive: streets/paseo/bridges plus beach (sand is slow
# but not a wall — several POIs are beach-side and reached across the sand).
