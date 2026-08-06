"""Streets by name — the one way to ask the map where a calle or avenida is.

OSM roads carry their real name ("Calle 8", "Avenida Centenario") and a flat
world-px `pts` list, and placing anything on the street grid means resolving a
name to a position, a line or a direction near some anchor. The builder grew
FOUR near-identical scans of the road list for that (`_street_vals`,
`_street_edge`, `_street_dir`, `_street_at`) plus ten more open-coded loops, all
re-walking every road in the world for a question about one cuadra.

`StreetIndex` builds a name → roads map once and answers all four questions off
it. The four remain distinct because they answer genuinely different questions,
and picking the wrong one puts a building in the sea:

    vals()  MEAN axis coordinate of the samples near ref.
            Fine for a short straight calle; WRONG for anything long or
            slanted — Avenida Centenario runs diagonally for kilometres, so
            its mean y lands on a different cuadra entirely.
    at()    the coordinate AT ref: the nearest sample in the OTHER axis. This
            is what you want for a bounding street of a specific block.
    edge()  the street as an infinite LINE (point + direction). For a block
            bounded by a street that STOPS SHORT (Calle 8 dead-ends in the
            sand) so the block ends on the line, extended, instead of wrapping
            around the road's round end cap.
    dir()   just the direction, oriented along an expected axis. THE source for
            a manzana's angle — see the recipe in CLAUDE.md: never fit the
            angle from the block's own cells.

Names are passed as a LIST of candidates per edge, because the real grid is
patchy: odd calles are often unnamed (fall back to the flanking even calle) and
the central avenue is "Avenida Centenario", not "Avenida 0".
"""
import math
from collections import defaultdict

from ..config import (
    CUAD, MUELLE_STREET, STREET_AT_SPAN_M, STREET_DIR_SPAN_M,
    STREET_NEAR_SPAN_M, STREET_SPAN_M, street_span_px,
)
from ..util.geometry import principal_axis


def resample_centerline(pts_flat, step):
    """[(s, x, y), …] sampled every ~step px along a flat polyline."""
    pts = [(pts_flat[i], pts_flat[i + 1]) for i in range(0, len(pts_flat), 2)]
    out, s = [], 0.0
    for k in range(len(pts) - 1):
        x0, y0 = pts[k]
        x1, y1 = pts[k + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg < 1e-6:
            continue
        n = max(1, int(seg / step))
        for j in range(n):
            t = j / n
            out.append((s + t * seg, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
        s += seg
    if pts:
        out.append((s, pts[-1][0], pts[-1][1]))
    return out


def half_plane(line, anchor, gap):
    """clip(px, py) keeping the ANCHOR's side of a street line, stopping `gap`
    px short of its centreline (= the near kerb)."""
    ex, ey, ux, uy = line
    nx, ny = -uy, ux
    if (anchor[0] - ex) * nx + (anchor[1] - ey) * ny > 0:      # point n at the street
        nx, ny = -nx, -ny
    return lambda px, py: (px - ex) * nx + (py - ey) * ny <= -gap


class StreetIndex:
    """Named roads, indexed once. `roads` is the builder's list of
    {name, pts, cls, w, …} in world px."""

    def __init__(self, roads):
        self.roads = roads
        self._boxed = None          # (road, aabb) pairs, built on first on_street
        self._by_name = defaultdict(list)
        for r in roads:
            name = r.get("name")
            if name:
                self._by_name[name].append(r)

    def named(self, names):
        """Roads for the FIRST of `names` that exists at all."""
        for name in ([names] if isinstance(names, str) else names):
            hit = self._by_name.get(name)
            if hit:
                yield name, hit

    def _samples(self, names, ref, span, step):
        """(name, [(x, y), …]) for the first candidate with samples near ref."""
        rx, ry = ref
        for name, roads in self.named(names):
            pts = [(x, y) for r in roads
                   for (_, x, y) in resample_centerline(r["pts"], step)
                   if abs(x - rx) <= span and abs(y - ry) <= span]
            if pts:
                return name, pts
        return None, []

    def vals(self, names, want, ref, span=None):
        """Average axis coord (x for a calle, y for an avenida) near ref."""
        span = span if span is not None else street_span_px(STREET_SPAN_M)
        _, pts = self._samples(names, ref, span, 10)
        if not pts:
            return None
        i = 0 if want == "x" else 1
        return sum(p[i] for p in pts) / len(pts)

    def at(self, names, want, ref, span=None):
        """The axis coord AT ref — the sample nearest in the OTHER axis."""
        span = span if span is not None else street_span_px(STREET_AT_SPAN_M)
        rx, ry = ref
        for _name, roads in self.named(names):
            best = None
            for r in roads:
                for (_, x, y) in resample_centerline(r["pts"], 6):
                    if abs(x - rx) > span or abs(y - ry) > span:
                        continue
                    d = abs(y - ry) if want == "x" else abs(x - rx)
                    if best is None or d < best[0]:
                        best = (d, x if want == "x" else y)
            if best is not None:
                return best[1]
        return None

    def edge(self, names, ref, span=None):
        """The street near ref as an infinite line (px, py, ux, uy)."""
        span = span if span is not None else street_span_px(STREET_SPAN_M)
        _, pts = self._samples(names, ref, span, 8)
        if len(pts) < 2:
            return None
        mx, my, theta = principal_axis(pts)
        return (mx, my, math.cos(theta), math.sin(theta))

    def direction(self, names, ref, axis, span=None):
        """Unit direction near ref, oriented along `axis`: "x" for an avenida
        (pointing EAST), "y" for a calle (pointing SOUTH).

        A direction that does NOT run along the expected axis is rejected: a
        same-named stub crossing the reference (Calle 33 turns a corner two
        cuadras south) would otherwise hand back the perpendicular.
        """
        span = span if span is not None else street_span_px(STREET_DIR_SPAN_M)
        line = self.edge(names, ref, span)
        if not line:
            return None
        ux, uy = line[2], line[3]
        if (abs(ux) < abs(uy)) if axis == "x" else (abs(uy) < abs(ux)):
            return None
        if (ux < 0) if axis == "x" else (uy < 0):
            ux, uy = -ux, -uy
        return (ux, uy)

    def angle_at(self, px, py, reach=12 * CUAD):
        """The manzana angle at a point, taken from the NEAREST street.

        `direction()` answers the same question from a NAME, which is what a
        hand-authored cuadra has. A parcel derived from an OSM outline does not:
        it knows where it is and nothing about which calle bounds it. So take
        the nearest real centreline segment and fold its direction into the
        AVENIDA family — a result in (-45°, 45°] — because a calle is the same
        grid turned a quarter, and everything drawn on a parcel (mow stripes,
        pitch markings, a church, the sponsor plate) is symmetric under that
        quarter turn.

        Still "the angle comes from the streets", which is the rule that matters
        (see CLAUDE.md): what it must never be is a fit of the parcel's own
        traced cells, whose vertices are 4 px staircase steps and whose
        principal axis snaps to ±45° on a square-ish block.

        Returns radians; 0.0 when no street is within `reach` (a site out in the
        countryside has no grid to align to).

        `reach` is measured from the parcel's CENTRE, so it has to clear half a
        manzana plus the street: at 3·CUAD a whole-cuadra park was further from
        every centreline than the reach and fell back to 0.0 — 126 of 377 sites
        came out square to the screen on a grid that is not. 12·CUAD (two
        cuadras) leaves 8, all of them genuinely out in the countryside.
        """
        if self._boxed is None:
            self._boxed = [(r, (min(r["pts"][0::2]), min(r["pts"][1::2]),
                                max(r["pts"][0::2]), max(r["pts"][1::2])))
                           for r in self.roads if r.get("pts")]
        best = None
        for r, (bx0, by0, bx1, by1) in self._boxed:
            if px < bx0 - reach or px > bx1 + reach or py < by0 - reach or py > by1 + reach:
                continue
            p = r["pts"]
            for i in range(0, len(p) - 2, 2):
                ax, ay, bx, by = p[i], p[i + 1], p[i + 2], p[i + 3]
                dx, dy = bx - ax, by - ay
                l2 = dx * dx + dy * dy
                if l2 <= 0:
                    continue
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
                qx, qy = ax + dx * t, ay + dy * t
                d2 = (px - qx) ** 2 + (py - qy) ** 2
                # ties broken by the segment's own start, so two roads at the
                # same distance always resolve the same way across rebuilds
                key = (d2, ax, ay, bx, by)
                if best is None or key < best[0]:
                    best = (key, dx, dy)
        if best is None or best[0][0] > reach * reach:
            return 0.0
        ang = math.atan2(best[2], best[1])
        while ang > math.pi / 4:
            ang -= math.pi / 2
        while ang <= -math.pi / 4:
            ang += math.pi / 2
        return ang

    def nearest_normal(self, px, py, reach=None):
        """Unit vector pointing from the nearest street centreline TOWARD
        (px, py) — i.e. straight back off the road.

        A footprint that has to be moved off the asphalt has exactly one right
        direction to move in, and it is not "up" or "toward the block centre":
        it is away from the calle it is on, whatever angle that calle runs at.
        Returns None when nothing is within `reach` (nothing to move away from).
        """
        reach = reach if reach is not None else 8 * CUAD
        if self._boxed is None:
            self._boxed = [(r, (min(r["pts"][0::2]), min(r["pts"][1::2]),
                                max(r["pts"][0::2]), max(r["pts"][1::2])))
                           for r in self.roads if r.get("pts")]
        best = None
        for r, (bx0, by0, bx1, by1) in self._boxed:
            if px < bx0 - reach or px > bx1 + reach or py < by0 - reach or py > by1 + reach:
                continue
            p = r["pts"]
            for i in range(0, len(p) - 2, 2):
                ax, ay, bx, by = p[i], p[i + 1], p[i + 2], p[i + 3]
                dx, dy = bx - ax, by - ay
                l2 = dx * dx + dy * dy
                if l2 <= 0:
                    continue
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
                qx, qy = ax + dx * t, ay + dy * t
                d2 = (px - qx) ** 2 + (py - qy) ** 2
                key = (d2, ax, ay, bx, by)
                if best is None or key < best[0]:
                    best = (key, qx, qy)
        if best is None or best[0][0] > reach * reach:
            return None
        vx, vy = px - best[1], py - best[2]
        d = math.hypot(vx, vy)
        if d < 1e-6:
            return None                     # dead on the centreline: no way out
        return (vx / d, vy / d)

    def on_street(self, px, py, pad=2.0, reach=60.0):
        """Is (px, py) under the painted width of a real road centreline?

        The surface raster cannot answer this: a POI apron (`stamp_pad`) and a
        cuadra paved as a sliver are both CLS_ROAD/CLS_ACERA, and neither is a
        street. Asking the ROAD LIST instead is what lets a hand-laid manzana
        reclaim its own interior without eating the calles that bound it —
        including a diagonal avenida, which no axis rect can follow.
        """
        if self._boxed is None:
            self._boxed = [(r, (min(r["pts"][0::2]), min(r["pts"][1::2]),
                                max(r["pts"][0::2]), max(r["pts"][1::2])))
                           for r in self.roads if r.get("pts")]
        for r, (bx0, by0, bx1, by1) in self._boxed:
            p = r["pts"]
            hw = r.get("w", 8) / 2 + pad
            # AABB of the WHOLE polyline, not its endpoints: Avenida Centenario
            # crosses the map, so an endpoint test would skip the one street
            # most likely to bound the block being reclaimed.
            if px < bx0 - reach or px > bx1 + reach or py < by0 - reach or py > by1 + reach:
                continue
            for i in range(0, len(p) - 2, 2):
                ax, ay, bx, by = p[i], p[i + 1], p[i + 2], p[i + 3]
                dx, dy = bx - ax, by - ay
                l2 = dx * dx + dy * dy
                t = 0.0 if l2 <= 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
                qx, qy = ax + dx * t, ay + dy * t
                if (px - qx) ** 2 + (py - qy) ** 2 <= hw * hw:
                    return True
        return False

    def near(self, ref, span_x=None, span_y=None, step=12):
        """{name: (mean x, mean y)} of every named street near ref — the
        diagnostic the placement recipes print so a failed resolve can be read
        off the build log."""
        span_x = span_x if span_x is not None else street_span_px(STREET_NEAR_SPAN_M[0])
        span_y = span_y if span_y is not None else street_span_px(STREET_NEAR_SPAN_M[1])
        rx, ry = ref
        near = defaultdict(list)
        for r in self.roads:
            nm = r.get("name")
            if not nm:
                continue
            for (_, x, y) in resample_centerline(r["pts"], step):
                if abs(x - rx) <= span_x and abs(y - ry) <= span_y:
                    near[nm].append((x, y))
        return {nm: (round(sum(p[0] for p in v) / len(v)),
                     round(sum(p[1] for p in v) / len(v)))
                for nm, v in sorted(near.items())}


def street_end(roads, name, near_x, near_y, end="south", reach=1500):
    """(x, y) of a named street's SOUTHERN or NORTHERN extreme near an anchor.

    A muelle stands at the end of a calle, and which end matters twice over:
    once because that is where the shore is, and once because THE CALLES SLANT.
    Calle Central runs x 19429..19552 over y 11507..12619, so its two ends are
    122 px apart in x — a pier anchored to the wrong end of it lands off the
    end of every street, and the connector loop then "finds" a calle cell a few
    px away and paves a stub to nothing.

    The proximity filter is not optional: 'Calle Central' also exists in
    Esparza and Barranca, and 'Calle 2' exists in half the cantons on the map.
    """
    best = None
    key = name.lower()
    for r in roads:
        if (r.get("name") or "").lower() != key:
            continue
        p = r["pts"]
        for i in range(0, len(p), 2):
            x, y = p[i], p[i + 1]
            if abs(x - near_x) > reach or abs(y - near_y) > reach:
                continue
            if best is None or (y > best[1] if end == "south" else y < best[1]):
                best = (x, y)
    return best


def planar_muelle_axis(roads, near_x, near_y, reach=1500):
    """PLANAR pier anchor: the Muelle Nacional juts south from the END of Calle
    Central, the street at the Paseo de los Turistas east entry — i.e. the
    southernmost point of that road, where it meets the shore."""
    return street_end(roads, MUELLE_STREET, near_x, near_y, "south", reach)


def block_rect(index, spec, ref):
    """The rect of a cuadra named by its four bounding streets.

    `spec` carries a LIST OF CANDIDATES per edge, because the real grid is
    patchy — `{"calles": ([west…], [east…]), "ave_north": […], "ave_south": […]}`.
    Each edge is resolved with `at()`, the coordinate AT the anchor, never
    `vals()`: an avenida that crosses the peninsula has a mean y on a different
    cuadra entirely.

    Returns `((x0, y0, x1, y1) or None, the four resolved edges)`. The edges
    come back either way BECAUSE the caller has to log them: CLAUDE.md's recipe
    is that a placement prints its resolved rect and the nearby-street
    diagnostic, and a failed resolve is only readable if you can see WHICH of
    the four names is the None.
    """
    cxa = index.at(spec["calles"][0], "x", ref)
    cxb = index.at(spec["calles"][1], "x", ref)
    ayn = index.at(spec["ave_north"], "y", ref)
    ays = index.at(spec["ave_south"], "y", ref)
    if None in (cxa, cxb, ayn, ays):
        return None, (cxa, cxb, ayn, ays)
    return (min(cxa, cxb), min(ayn, ays), max(cxa, cxb), max(ayn, ays)), \
           (cxa, cxb, ayn, ays)
