"""Cuadras: finding a block on the raster and turning it back into geometry.

A *cuadra* (manzana, city block) is not stored anywhere — it is whatever the
streets leave behind. Every structure the world places on the street grid asks
the same three questions, so they live here:

    cuadra_cells()      which cells ARE this block, from its bounding streets
    block_raster_cells() the LAND inside a block's cuad cells (no acera ring)
    outline_poly()      those cells back as a drawable polygon

The polygon is raster-TRACED, not fitted: it follows the manzana's real angles,
including a diagonal one, which is the whole reason the estadios and parcels
read as part of the city instead of boxes dropped on it. It also means the
vertices are 4 px staircase steps — never fit an angle from them (see
util.geometry.principal_axis).
"""
from collections import defaultdict, deque

from ..config import (
    BLOCK_MIN_CUADS, CLS_ACERA, CLS_LAND, CUAD, CUAD_CELLS, GRID_CELL,
    SLIVER_MAX_CUADS,
)
from ..logging import log


def cuadra_cells(raster, px0, py0, px1, py1, classes, clip=None):
    """The one cuadra under a street rect, as raster cells: the LARGEST
    connected component of `classes` inside the rect.

    Clipping to the rect is what keeps it local — the acera fringe is continuous
    along every street, so an unbounded flood would swallow the whole city — and
    the rect runs centreline-to-centreline, so the far-side aceras stay out.
    `clip(px, py) -> bool` adds a further half-plane test (see street.half_plane)
    for a block bounded by a street that stops short.
    """
    cell, cols, rows, buf = raster.cell, raster.cols, raster.rows, raster.buf
    gc0 = max(0, int(px0 // cell)); gc1 = min(cols - 1, int(px1 // cell))
    gr0 = max(0, int(py0 // cell)); gr1 = min(rows - 1, int(py1 // cell))
    inside = lambda c, r: (gc0 <= c <= gc1 and gr0 <= r <= gr1
                           and (clip is None or clip(c * cell, r * cell)))
    member = lambda c, r: buf[r * cols + c] in classes
    seen, best = set(), set()
    for r0 in range(gr0, gr1 + 1):
        for c0 in range(gc0, gc1 + 1):
            if (c0, r0) in seen or not member(c0, r0):
                continue
            comp, st = set(), [(c0, r0)]
            while st:
                c, r = st.pop()
                if (c, r) in comp or not inside(c, r) or not member(c, r):
                    continue
                comp.add((c, r))
                st += ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1))
            seen |= comp
            if len(comp) > len(best):
                best = comp
    return best


def block_raster_cells(raster, cuad_cells, cuad_cells_per_side, land_cls):
    """The LAND cells of a block, flooded from the centre of each of its cuad
    cells. Excludes the acera ring by construction: it only walks `land_cls`."""
    cell, cols, rows, buf = raster.cell, raster.cols, raster.rows, raster.buf
    out, seeds = set(), []
    for (cc, cr) in cuad_cells:
        pc = cc * cuad_cells_per_side + cuad_cells_per_side // 2
        pr = cr * cuad_cells_per_side + cuad_cells_per_side // 2
        if 0 <= pc < cols and 0 <= pr < rows and buf[pr * cols + pc] == land_cls:
            seeds.append((pc, pr))
    for s in seeds:
        if s in out:
            continue
        st = [s]
        while st:
            c, r = st.pop()
            if (c, r) in out or not (0 <= c < cols and 0 <= r < rows):
                continue
            if buf[r * cols + c] != land_cls:
                continue
            out.add((c, r))
            st += ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1))
    return out


def outline_poly(cells, cell_px):
    """Outer boundary of a raster cell set as a flat [x, y, …] px polygon
    (largest loop wins — interior holes are ignored; collinear runs merged)."""
    edges = defaultdict(list)                  # start vertex -> [end vertices]
    for (c, r) in cells:
        if (c, r - 1) not in cells: edges[(c, r)].append((c + 1, r))
        if (c + 1, r) not in cells: edges[(c + 1, r)].append((c + 1, r + 1))
        if (c, r + 1) not in cells: edges[(c + 1, r + 1)].append((c, r + 1))
        if (c - 1, r) not in cells: edges[(c, r + 1)].append((c, r))
    best, best_area = None, 0.0
    while True:
        start = next((v for v, outs in edges.items() if outs), None)
        if start is None:
            break
        loop, v, closed = [start], start, False
        while True:
            outs = edges.get(v)
            if not outs:
                break                          # pinch-point dead end: drop loop
            v = outs.pop()
            if v == start:
                closed = True; break
            loop.append(v)
        if not closed:
            continue
        area = 0.0
        for i in range(len(loop)):
            x0, y0 = loop[i]; x1, y1 = loop[(i + 1) % len(loop)]
            area += x0 * y1 - x1 * y0
        if abs(area) > best_area:
            best_area, best = abs(area), loop
    if not best:
        return []
    pts, n = [], len(best)
    for i in range(n):
        p0, p1, p2 = best[i - 1], best[i], best[(i + 1) % n]
        if (p1[0] - p0[0]) * (p2[1] - p1[1]) == (p1[1] - p0[1]) * (p2[0] - p1[0]):
            continue                           # collinear — drop the midpoint
        pts += [p1[0] * cell_px, p1[1] * cell_px]
    return pts


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



def detect_blocks(raster, build_band_x1=None):
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
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    from array import array
    N = cols * rows
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
            r, c = divmod(i, cols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < rows and 0 <= nc < cols:
                    ni = nr * cols + nc
                    if grid[ni] == CLS_LAND and not label[ni]:
                        label[ni] = cid
                        q.append(ni)
        comp_n[cid] = n
    n_comps = len(comp_n) - 1
    # buildable CUAD cells (fully CLS_LAND — such a 5x5 is 4-connected, so it
    # belongs to exactly one component) + max-inscribed-square DP per cell
    ccols, crows = cols // CUAD_CELLS, rows // CUAD_CELLS
    bcomp = array("i", [0]) * (ccols * crows)      # component id per cuad cell
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
            if ok:
                bcomp[cr * ccols + cc] = label[cr * CUAD_CELLS * cols + cc * CUAD_CELLS]
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
