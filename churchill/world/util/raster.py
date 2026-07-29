"""The surface raster: one byte per cell, and the algorithms that write it.

`Raster` owns the buffer AND its dimensions, which is the point — the builder
read `GRID_COLS`/`GRID_ROWS`/`GRID_CELL` as module globals in 34 index
expressions and 29 bounds guards, so nothing that touched the grid could be
called from anywhere else, or tested on a small one.

PERFORMANCE IS PART OF THE DESIGN. The world is ~101M cells, so the inner loops
here index `self.buf` directly instead of going through `at()`/`set()`: a method
call per cell would turn a 3-minute build into a much longer one. The accessors
are for the callers that touch a handful of cells, not for the flood fills.

Cells are addressed (c, r) — column, row — and world px are (x, y). `cell_of`
is the only conversion; anything doing `int(x / GRID_CELL)` by hand is a bug
waiting for the day the cell size changes.
"""
import base64
import math
from collections import deque

NEIGHBOURS4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def disk_has_only(raster, x, y, radius, allowed):
    """Whether every raster-cell centre inside a world-px disk is `allowed`.

    This deliberately tests the finished surface, not a source polygon. It is
    the right gate for rendered objects with a radius: a centre on LAND is not
    enough when the visible object can still cover the neighbouring ACERA.
    """
    cell = raster.cell
    c0 = math.floor((x - radius) / cell)
    c1 = math.ceil((x + radius) / cell)
    r0 = math.floor((y - radius) / cell)
    r1 = math.ceil((y + radius) / cell)
    radius2 = radius * radius
    allowed = set(allowed)
    for r in range(r0, r1 + 1):
        py = (r + 0.5) * cell
        for c in range(c0, c1 + 1):
            px = (c + 0.5) * cell
            if (px - x) ** 2 + (py - y) ** 2 > radius2:
                continue
            if raster.at(c, r) not in allowed:
                return False
    return True


def disk_within_cells(raster, x, y, radius, cells):
    """Whether every raster-cell centre inside a world-px disk is in `cells`.

    Surface class alone cannot express parcel ownership: a campus lot and the
    neighbouring park are both LAND. Parque Marino uses this stricter test so a
    tank's complete deck stays inside the park's residual cells instead of
    crossing into an adjacent building/UNA/station parcel.
    """
    cell = raster.cell
    c0 = math.floor((x - radius) / cell)
    c1 = math.ceil((x + radius) / cell)
    r0 = math.floor((y - radius) / cell)
    r1 = math.ceil((y + radius) / cell)
    radius2 = radius * radius
    for r in range(r0, r1 + 1):
        py = (r + 0.5) * cell
        for c in range(c0, c1 + 1):
            px = (c + 0.5) * cell
            if (px - x) ** 2 + (py - y) ** 2 <= radius2 and (c, r) not in cells:
                return False
    return True


class Raster:
    __slots__ = ("buf", "cols", "rows", "cell")

    def __init__(self, cols, rows, cell, fill=0, buf=None):
        self.cols, self.rows, self.cell = cols, rows, cell
        self.buf = buf if buf is not None else bytearray([fill]) * (cols * rows)

    # ---- addressing ---------------------------------------------------------
    def idx(self, c, r):
        return r * self.cols + c

    def in_bounds(self, c, r):
        return 0 <= c < self.cols and 0 <= r < self.rows

    def at(self, c, r):
        """Class at a cell, or None outside the world."""
        return self.buf[r * self.cols + c] if self.in_bounds(c, r) else None

    def set(self, c, r, cls):
        if self.in_bounds(c, r):
            self.buf[r * self.cols + c] = cls

    def cell_of(self, x, y):
        """World px -> (c, r), unclamped."""
        return int(x / self.cell), int(y / self.cell)

    def at_px(self, x, y):
        return self.at(*self.cell_of(x, y))

    # ---- painting -----------------------------------------------------------
    def fill_poly(self, pts, cls):
        """Even-odd scanline fill of a polygon given px coords."""
        cell, cols, rows, buf = self.cell, self.cols, self.rows, self.buf
        ys = [p[1] for p in pts]
        r0 = max(0, int(min(ys)) // cell)
        r1 = min(rows - 1, int(max(ys)) // cell)
        n = len(pts)
        for row in range(r0, r1 + 1):
            y = (row + 0.5) * cell
            xs = []
            for i in range(n):
                x0, y0 = pts[i]
                x1, y1 = pts[(i + 1) % n]
                if (y0 > y) != (y1 > y):
                    xs.append(x0 + (y - y0) / (y1 - y0) * (x1 - x0))
            xs.sort()
            base = row * cols
            for k in range(0, len(xs) - 1, 2):
                c0 = max(0, int(xs[k] / cell + 0.5))
                c1 = min(cols - 1, int(xs[k + 1] / cell - 0.5))
                for c in range(c0, c1 + 1):
                    buf[base + c] = cls

    def stamp_polyline(self, flat_pts, width, cls):
        """Stamp a stroked polyline (ROUND CAPS) onto the grid.

        The cap matters: it adds `width/2` of drivable cells PAST the last
        point, so a free end (a pier deck, a median) must be shortened by that
        much or the stamped surface overhangs what the renderer draws.
        """
        cell, cols, rows, buf = self.cell, self.cols, self.rows, self.buf
        hw = width / 2.0
        pts = [(flat_pts[i], flat_pts[i + 1]) for i in range(0, len(flat_pts), 2)]
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            # subdivide long segments to keep bboxes tight
            L = math.hypot(x1 - x0, y1 - y0)
            steps = max(1, int(L / 28))
            for k in range(steps):
                ax = x0 + (x1 - x0) * k / steps
                ay = y0 + (y1 - y0) * k / steps
                bx = x0 + (x1 - x0) * (k + 1) / steps
                by = y0 + (y1 - y0) * (k + 1) / steps
                c0 = max(0, int((min(ax, bx) - hw) / cell))
                c1 = min(cols - 1, int((max(ax, bx) + hw) / cell))
                r0 = max(0, int((min(ay, by) - hw) / cell))
                r1 = min(rows - 1, int((max(ay, by) + hw) / cell))
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy
                for row in range(r0, r1 + 1):
                    py = (row + 0.5) * cell
                    base = row * cols
                    for col in range(c0, c1 + 1):
                        px = (col + 0.5) * cell
                        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                        if (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2 <= hw * hw:
                            buf[base + col] = cls

    # ---- flooding -----------------------------------------------------------
    def flood_water(self, barrier, seeds_px, water_cls, land_cls):
        """BFS flood from sea seeds; barrier cells stop it (they stay land).

        Everything the sea CANNOT reach past the coastline is land — which is
        why the barrier has to be closed: one sub-cell gap and the gulf pours
        into the peninsula.
        """
        cols, rows, cell, buf = self.cols, self.rows, self.cell, self.buf
        water = bytearray(cols * rows)
        dq = deque()
        for (x, y) in seeds_px:
            c, r = int(x / cell), int(y / cell)
            if 0 <= c < cols and 0 <= r < rows and not barrier[r * cols + c]:
                idx = r * cols + c
                if not water[idx]:
                    water[idx] = 1
                    dq.append(idx)
        while dq:
            idx = dq.popleft()
            r, c = divmod(idx, cols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < rows and 0 <= nc < cols:
                    nidx = nr * cols + nc
                    if not water[nidx] and not barrier[nidx]:
                        water[nidx] = 1
                        dq.append(nidx)
        for i in range(len(buf)):
            buf[i] = water_cls if water[i] else land_cls
        return water

    def component(self, seed_idx, member):
        """Cell indices 4-connected to `seed_idx` for which member(idx) holds."""
        out, dq = set(), deque([seed_idx])
        cols, rows = self.cols, self.rows
        while dq:
            i = dq.popleft()
            if i in out or not member(i):
                continue
            out.add(i)
            r, c = divmod(i, cols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < rows and 0 <= nc < cols:
                    dq.append(nr * cols + nc)
        return out

    # ---- encoding -----------------------------------------------------------
    def rle(self):
        return rle_encode(self.buf)


def rle_encode(buf):
    """(count, class) byte pairs, base64'd — the surface as the client reads it.

    Counts cap at 255 per pair, which is why a run of open water costs a byte
    every 255 cells rather than nothing.
    """
    out = bytearray()
    i, n = 0, len(buf)
    while i < n:
        v = buf[i]
        j = i
        while j < n and buf[j] == v and j - i < 255:
            j += 1
        out.append(j - i)
        out.append(v)
        i = j
    return base64.b64encode(bytes(out)).decode("ascii")


def erode_cells(cells, depth, facing=None, at=None):
    """Morphological erosion of a CELL SET by `depth` (BFS distance transform
    seeded on the boundary). Applied to a cuadra+acera set it yields the pitch,
    so the difference between the two IS the block's real acera ring.

    `facing` (a tuple of surface classes, with `at(c, r)` reading them) erodes
    DIRECTIONALLY: only the boundary whose neighbour OUTSIDE the set is one of
    those classes seeds the transform. An acera exists where there is a street
    to walk beside — a cuadra edge facing the sea, the sand or the next parcel
    has none, and eroding it there just eats the block.
    """
    dist = {}
    q = deque()
    for (c, r) in cells:
        out = [(c + dc, r + dr) for dc, dr in NEIGHBOURS4 if (c + dc, r + dr) not in cells]
        if not out:
            continue
        if facing is not None and not any(at(n[0], n[1]) in facing for n in out):
            continue
        dist[(c, r)] = 1
        q.append((c, r))
    while q:
        c, r = q.popleft()
        d = dist[(c, r)] + 1
        if d > depth:
            continue
        for dc, dr in NEIGHBOURS4:
            n = (c + dc, r + dr)
            if n in cells and n not in dist:
                dist[n] = d
                q.append(n)
    return {c for c in cells if dist.get(c, depth + 1) > depth}
