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

    def vals(self, names, want, ref, span=700):
        """Average axis coord (x for a calle, y for an avenida) near ref."""
        _, pts = self._samples(names, ref, span, 10)
        if not pts:
            return None
        i = 0 if want == "x" else 1
        return sum(p[i] for p in pts) / len(pts)

    def at(self, names, want, ref, span=900):
        """The axis coord AT ref — the sample nearest in the OTHER axis."""
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

    def edge(self, names, ref, span=700):
        """The street near ref as an infinite line (px, py, ux, uy)."""
        _, pts = self._samples(names, ref, span, 8)
        if len(pts) < 2:
            return None
        mx, my, theta = principal_axis(pts)
        return (mx, my, math.cos(theta), math.sin(theta))

    def direction(self, names, ref, axis, span=520):
        """Unit direction near ref, oriented along `axis`: "x" for an avenida
        (pointing EAST), "y" for a calle (pointing SOUTH).

        A direction that does NOT run along the expected axis is rejected: a
        same-named stub crossing the reference (Calle 33 turns a corner two
        cuadras south) would otherwise hand back the perpendicular.
        """
        line = self.edge(names, ref, span)
        if not line:
            return None
        ux, uy = line[2], line[3]
        if (abs(ux) < abs(uy)) if axis == "x" else (abs(uy) < abs(ux)):
            return None
        if (ux < 0) if axis == "x" else (uy < 0):
            ux, uy = -ux, -uy
        return (ux, uy)

    def near(self, ref, span_x=800, span_y=500, step=12):
        """{name: (mean x, mean y)} of every named street near ref — the
        diagnostic the placement recipes print so a failed resolve can be read
        off the build log."""
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
