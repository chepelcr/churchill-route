"""Putting things where they belong on a built surface.

A POI resolved from OSM lands wherever OSM put it, and that is regularly wrong
for a game: inside a building, in the sea, on a sidewalk the car cannot cross,
or on a stretch of road with no way in. These are the corrections, and every one
of them exists because something ended up unreachable:

    resolve_poi          which OSM match to believe when several share a name
    nudge_to_land        off the water, optionally onto the drivable network
    near_drivable        is this cell close enough to the network the player is
                         actually on? (a stranded road fragment does not count)
    snap_into_block      a building landmark INTO its cuadra interior
    nudge_off_acera      off the sidewalk ring, which is a wall
    kiosk_frontage       a beach kiosk onto the block frontage it is reached from
    block_containing / nearest_block / snap_into_block_cell

They are free functions taking what they need — the raster, the block list —
rather than closures over a build, so the placement rules can be exercised on a
small world.
"""
import math
from collections import deque

from ..config import (
    ACERA_CELLS, CLS_ACERA, CLS_BEACH, CLS_BRIDGE, CLS_LAND, CLS_PASEO,
    CLS_ROAD, CLS_WATER, CUAD, CUAD_CELLS, GRID_CELL, POI_NUDGE_PX,
)
from ..util.geometry import dist, to_m


def cell_class(raster, cc, cr):
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    if 0 <= cc < cols and 0 <= cr < rows:
        return grid[cr * cols + cc]
    return CLS_WATER

def nearest_cell(raster, x, y, classes, max_cells):
    c0, r0 = int(x // GRID_CELL), int(y // GRID_CELL)
    for rad in range(1, max_cells):
        best = None
        for a in range(0, 360, 6):
            rc = c0 + int(round(math.cos(math.radians(a)) * rad))
            rr = r0 + int(round(math.sin(math.radians(a)) * rad))
            if cell_class(raster, rc, rr) in classes:
                d2 = (rc - c0) ** 2 + (rr - r0) ** 2
                if best is None or d2 < best[0]:
                    best = (d2, rc, rr)
        if best:
            return ((best[1] + 0.5) * GRID_CELL, (best[2] + 0.5) * GRID_CELL)
    return None

def drivable_cell(raster, c, r):
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    return 0 <= c < cols and 0 <= r < rows and \
        grid[r * cols + c] in (CLS_ROAD, CLS_BRIDGE)

def snap_into_block(raster, x, y, reach_px=160, inset_px=32):
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    # The anchor is on/next to a street; step into the nearest cuadra
    # interior (CLS_LAND) and then a bit deeper (inset) so the footprint
    # sits INSIDE the block fronting that street, not on the asphalt.
    c0, r0 = int(x / GRID_CELL), int(y / GRID_CELL)
    R = reach_px // GRID_CELL
    best = None
    for dr in range(-R, R + 1):
        for dc in range(-R, R + 1):
            c, r = c0 + dc, r0 + dr
            if not (0 <= c < cols and 0 <= r < rows):
                continue
            if grid[r * cols + c] != CLS_LAND:
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
        if 0 <= nc < cols and 0 <= nr < rows and grid[nr * cols + nc] == CLS_LAND:
            bc, br = nc, nr
            break
    return ((bc + 0.5) * GRID_CELL, (br + 0.5) * GRID_CELL)

def nudge_off_acera(raster, x, y, reach_cells=16):
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    cx0, cy0 = int(x / GRID_CELL), int(y / GRID_CELL)
    def interior(c, r, pad):
        for dc in range(-pad, pad + 1):
            for dr in range(-pad, pad + 1):
                cc, rr = c + dc, r + dr
                if not (0 <= cc < cols and 0 <= rr < rows):
                    return False
                if grid[rr * cols + cc] != CLS_LAND:
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

def nudge_to_land(raster, near_drivable, x, y, radius_px=POI_NUDGE_PX, need_drivable=False):
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    c0, r0 = int(x / GRID_CELL), int(y / GRID_CELL)
    best = None
    R = radius_px // GRID_CELL
    for dr in range(-R, R + 1):
        for dc in range(-R, R + 1):
            c, r = c0 + dc, r0 + dr
            if 0 <= c < cols and 0 <= r < rows and grid[r * cols + c] != CLS_WATER:
                d2 = dc * dc + dr * dr
                if (best is None or d2 < best[0]) and (not need_drivable or near_drivable(c, r)):
                    best = (d2, c, r)
    if best is None:
        return None
    return ((best[1] + 0.5) * GRID_CELL, (best[2] + 0.5) * GRID_CELL)

def near_drivable(raster, main_net, c, r, reach=ACERA_CELLS + 1):
    """True if a MAIN-network street/beach cell is within `reach` cells (so
    a POI pad stamped here merges with the network the player drives —
    stranded road/beach fragments don't count)."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    for dr in range(-reach, reach + 1):
        for dc in range(-reach, reach + 1):
            cc, rr = c + dc, r + dr
            if 0 <= cc < cols and 0 <= rr < rows and \
                    main_net[rr * cols + cc]:
                return True
    return False

def snap_into_block_cell(blocks, x, y, max_d_cuads=8):
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

def block_containing(blocks, x, y):
    ac, ar = int(x // CUAD), int(y // CUAD)
    for bi, b in enumerate(blocks):
        if (ac, ar) in b["cells"]:
            return bi
    return None

def nearest_block(blocks, x, y, min_cells=12):
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

def road_adj(raster, cc, cr):
    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        px = int((cc + dc + 0.5) * CUAD // GRID_CELL)
        py = int((cr + dr + 0.5) * CUAD // GRID_CELL)
        if cell_class(raster, px, py) in (CLS_ROAD, CLS_BRIDGE, CLS_PASEO, CLS_ACERA):
            return True
    return False

def kiosk_frontage(raster, nongreen_blocks, snap_cuad, x, y):
    ac, ar = int(x // CUAD), int(y // CUAD)
    m = snap_cuad
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
    frontage = [c for c in near if road_adj(raster, *c)]
    pool = frontage if frontage else near
    if not pool:
        return None
    tc, tr = min(pool, key=lambda c: (c[0] - ac) ** 2 + (c[1] - ar) ** 2)
    return ((tc + 0.5) * CUAD, (tr + 0.5) * CUAD)

def resolve_poi(named, spec):
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
