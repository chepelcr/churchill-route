"""Geometry — pure functions over points, polylines and polygons.

No grid, no globals, no I/O: everything here takes coordinates and returns
coordinates, which is what makes it the one place these formulas live. The
builder open-coded several of them dozens of times (a centroid eight ways, a
principal-axis fit twice, `pts[0::2]`/`[1::2]` unpacking eighteen times), and
each copy was a place for the versions to drift apart.

TWO POINT FORMATS are in play and both are load-bearing:
  * pairs — [(x, y), …]  what these functions work in
  * flat  — [x, y, x, y, …]  what the emitted JSON carries (half the bytes, and
            what the renderer's Path2D helpers consume)
`pairs()` and `flat()` convert; the `flat_*` helpers work in place.
"""
import math

from ..config import LAT0, LON0, M_PER_DEG_LAT, M_PER_DEG_LON


# ---- formats ---------------------------------------------------------------

def pairs(flat_pts):
    """[x, y, x, y, …] -> [(x, y), …]"""
    return [(flat_pts[i], flat_pts[i + 1]) for i in range(0, len(flat_pts), 2)]


def flat(pair_pts):
    """[(x, y), …] -> [x, y, x, y, …]"""
    return [v for p in pair_pts for v in p]


def flat_bbox(flat_pts):
    """(x0, y0, x1, y1) of a flat point list."""
    xs = flat_pts[0::2]
    ys = flat_pts[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def flat_centroid(flat_pts):
    """Mean vertex of a flat point list — NOT the area centroid."""
    xs = flat_pts[0::2]
    ys = flat_pts[1::2]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def principal_axis(pts):
    """Angle (radians) of the dominant axis of a point cloud, by the 2x2
    covariance: 0.5·atan2(2·Sxy, Sxx − Syy).

    KNOW ITS TWO FAILURE MODES before using it to orient anything:
      * it is DEGENERATE when Sxx ≈ Syy (a square-ish cloud) — the denominator
        vanishes and the answer snaps to ±45°, i.e. the contrary diagonal;
      * it can only return ORTHOGONAL axes, and Puntarenas' cuadrícula is a
        parallelogram (by El Carmen the avenidas run at -5.4°, the calles at
        82.3°).
    For a manzana's angle, resolve the bounding streets instead
    (services take that path); this fit is the fallback of last resort.
    """
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    return mx, my, 0.5 * math.atan2(2 * sxy, sxx - syy)


# ---- the builder's own primitives -------------------------------------------


def to_m(lat, lon):
    """Geo -> metres east/south of the projection anchor (Faro de La Punta)."""
    return ((lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT)

def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])

def point_segment_dist(p, a, b):
    """Shortest Euclidean distance from point `p` to closed segment a→b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
    return math.hypot(p[0] - (a[0] + t * dx),
                      p[1] - (a[1] + t * dy))

def point_polyline_dist(p, pts):
    """Shortest distance from point `p` to a polyline; infinity if empty."""
    if len(pts) == 1:
        return dist(p, pts[0])
    return min((point_segment_dist(p, a, b)
                for a, b in zip(pts, pts[1:])), default=math.inf)

def point_polygon_dist(p, pts):
    """Shortest distance to a closed polygon; zero for a point inside it."""
    if not pts:
        return math.inf
    if point_in_poly(p, pts):
        return 0.0
    return min(point_segment_dist(p, pts[i], pts[(i + 1) % len(pts)])
               for i in range(len(pts)))

def poly_centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

def poly_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        s += x0 * y1 - x1 * y0
    return s / 2.0

def point_in_poly(pt, pts):
    x, y = pt
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def dp_simplify(pts, tol):
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if seg2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > worst:
                worst, wi = d, i
        if worst > tol:
            keep[wi] = True
            stack.append((a, wi))
            stack.append((wi, b))
    return [p for p, k in zip(pts, keep) if k]

def clip_polyline_to_rect(pts, w, h):
    """Liang-Barsky per segment; returns list of polyline pieces inside rect."""
    pieces, cur = [], []

    def clip_seg(p0, p1):
        x0, y0 = p0
        x1, y1 = p1
        t0, t1 = 0.0, 1.0
        dx, dy = x1 - x0, y1 - y0
        for p, q in ((-dx, x0), (dx, w - x0), (-dy, y0), (dy, h - y0)):
            if p == 0:
                if q < 0:
                    return None
            else:
                r = q / p
                if p < 0:
                    if r > t1:
                        return None
                    if r > t0:
                        t0 = r
                else:
                    if r < t0:
                        return None
                    if r < t1:
                        t1 = r
        return ((x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy), t0, t1)

    for i in range(len(pts) - 1):
        res = clip_seg(pts[i], pts[i + 1])
        if res is None:
            if cur:
                pieces.append(cur)
                cur = []
            continue
        a, b, t0, t1 = res
        if not cur:
            cur = [a]
        elif dist(cur[-1], a) > 1e-6:
            pieces.append(cur)
            cur = [a]
        cur.append(b)
        if t1 < 1.0:
            pieces.append(cur)
            cur = []
    if cur:
        pieces.append(cur)
    return [p for p in pieces if len(p) >= 2]

def clip_poly_to_rect(pts, w, h):
    """Sutherland-Hodgman against canvas rect."""
    def clip_edge(poly, inside, intersect):
        out = []
        for i in range(len(poly)):
            cur, prev = poly[i], poly[i - 1]
            ci, pi = inside(cur), inside(prev)
            if ci:
                if not pi:
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif pi:
                out.append(intersect(prev, cur))
        return out

    def ix(p0, p1, x):
        t = (x - p0[0]) / (p1[0] - p0[0])
        return (x, p0[1] + t * (p1[1] - p0[1]))

    def iy(p0, p1, y):
        t = (y - p0[1]) / (p1[1] - p0[1])
        return (p0[0] + t * (p1[0] - p0[0]), y)

    poly = list(pts)
    for inside, inter in (
        (lambda p: p[0] >= 0, lambda a, b: ix(a, b, 0)),
        (lambda p: p[0] <= w, lambda a, b: ix(a, b, w)),
        (lambda p: p[1] >= 0, lambda a, b: iy(a, b, 0)),
        (lambda p: p[1] <= h, lambda a, b: iy(a, b, h)),
    ):
        poly = clip_edge(poly, inside, inter)
        if len(poly) < 3:
            return []
    return poly
