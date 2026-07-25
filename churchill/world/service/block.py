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
