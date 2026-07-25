"""The drivable network, and the census that describes the built world.

Two different questions about the same raster:

* CONNECTIVITY — `largest_drivable_component` finds the network the player is
  actually on, and `verify_connectivity` is the build's GATE: every POI and
  stage target must be reachable from the spawn, or the build fails. A kiosk
  behind an unbroken acera ring is not a cosmetic bug, it is an unplayable
  stage, and it is invisible in a screenshot.
* SHAPE — `block_census` reports the land components and the largest square
  that fits in each, which is how you tell "the cuadras are the right size" from
  "the streets ate the town" after a knob change.

Both walk the grid directly rather than through the Raster accessors: they visit
millions of cells.
"""
from collections import defaultdict, deque

from ..config import CLS_ACERA, CLS_LAND, CUAD, CUAD_CELLS, DRIVABLE_CLASSES, GRID_CELL
from ..logging import log


def largest_drivable_component(raster):
    """Mask of the largest 4-connected component of drivable cells — 'the'
    street network. POIs are placed relative to this so none ends up on a
    stranded road/beach fragment (e.g. a stub clipped by estero water)."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    label = [0] * (cols * rows)
    best_id, best_n = 0, 0
    nid = 0
    for start in range(cols * rows):
        if label[start] or grid[start] not in DRIVABLE_CLASSES:
            continue
        nid += 1
        n = 0
        q = deque([start])
        label[start] = nid
        while q:
            i = q.popleft()
            n += 1
            r, c = divmod(i, cols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < rows and 0 <= nc < cols:
                    ni = nr * cols + nc
                    if not label[ni] and grid[ni] in DRIVABLE_CLASSES:
                        label[ni] = nid
                        q.append(ni)
        if n > best_n:
            best_id, best_n = nid, n
    return bytearray(1 if v == best_id else 0 for v in label)


def verify_connectivity(raster, seed_xy, pois, reach):
    """Flood-fill the drivable network from the spawn and require every POI to
    have a reached cell within `reach` cells. Returns the ids of unreachable
    POIs (build fails on any)."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    reached = bytearray(cols * rows)
    # seed: nearest drivable cell to the spawn point (expanding square rings)
    sc, sr = int(seed_xy[0] // GRID_CELL), int(seed_xy[1] // GRID_CELL)
    seed = None
    for rad in range(0, 64):
        for dr in range(-rad, rad + 1):
            for dc in range(-rad, rad + 1):
                if max(abs(dr), abs(dc)) != rad:
                    continue
                c, r = sc + dc, sr + dr
                if 0 <= c < cols and 0 <= r < rows and \
                        grid[r * cols + c] in DRIVABLE_CLASSES:
                    seed = (c, r)
                    break
            if seed:
                break
        if seed:
            break
    if seed is None:
        return ["spawn(no drivable cell near seed)"]
    q = deque([seed])
    reached[seed[1] * cols + seed[0]] = 1
    n_reached = 1
    while q:
        c, r = q.popleft()
        for nc, nr in ((c - 1, r), (c + 1, r), (c, r - 1), (c, r + 1)):
            if 0 <= nc < cols and 0 <= nr < rows:
                nidx = nr * cols + nc
                if not reached[nidx] and grid[nidx] in DRIVABLE_CLASSES:
                    reached[nidx] = 1
                    n_reached += 1
                    q.append((nc, nr))
    total_driv = sum(1 for v in grid if v in DRIVABLE_CLASSES)
    unreachable = []
    for poi in pois:
        pc, pr = int(poi["x"] // GRID_CELL), int(poi["y"] // GRID_CELL)
        ok = False
        for dr in range(-reach, reach + 1):
            for dc in range(-reach, reach + 1):
                c, r = pc + dc, pr + dr
                if 0 <= c < cols and 0 <= r < rows and reached[r * cols + c]:
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


def block_census(raster, min_side=6):
    """Cuadrícula-resolution census of buildable land: 4-connected components
    of CUAD cells fully covered by CLS_LAND, with each component's area and
    max inscribed square (DP). The tuning instrument for Milestone B★."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    ccols, crows = cols // CUAD_CELLS, rows // CUAD_CELLS
    buildable = bytearray(ccols * crows)
    for cr in range(crows):
        for cc in range(ccols):
            ok = True
            for r in range(cr * CUAD_CELLS, (cr + 1) * CUAD_CELLS):
                row = r * cols
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
