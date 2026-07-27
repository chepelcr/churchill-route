"""Esquinas: where two streets meet, the kerb TURNS — it does not form an angle.

A street is painted as a band (asphalt with an acera either side), so a junction
of two of them is a plus sign, and a plus has four sharp re-entrant corners where
the manzana's ground pokes into the crossing. A real esquina does not look like
that: the kerb has a radius, the acera follows it round, and the corner of the
block is cut.

The renderer cannot find those corners for itself. It draws roads per TILE and
never sees a junction as such — it only has a list of polylines, and the one
thing it already does (an acera-coloured disc at each polyline end, radius =
that road's own half-width) is exactly inscribed in the plus, so it rounds
nothing. That is why the corners still read as closed angles.

So the build finds them once, where the whole road list exists:

  * road ends that share a point are a junction (OSM splits its ways there, and
    the traffic AI already relies on it — see `findNextRoad` in spawns.js);
  * the outgoing directions are sorted by angle, and each pair of CONSECUTIVE
    ones is a candidate corner. The gap between them is the filter, and it is
    the whole trick: ~180° is a street continuing straight through (no corner),
    ~0° is the same way duplicated, and what is left in between is a real
    esquina. A T-junction therefore gets two corners and not three — the side
    with no cross street keeps its straight kerb;
  * the corner POINT is where the two aceras' outer edges cross, solved as two
    lines, so it is right for a diagonal avenida meeting a calle at 84° as well
    as for a square crossing.

`r` is how far the kerb turns through, clamped so the fillet can never be wider
than the sidewalk it is rounding. The renderer fills a disc there in the acera's
colour, which — seen from above — is all a rounded corner is.
"""
import math
from collections import defaultdict

from ..config import CUAD
from ..logging import log

#: Two ways are the same street continuing when their directions are this close
#: to opposite; there is nothing to round.
CORNER_MAX = math.radians(168)
#: …and this close to equal when one way is a duplicate or a hair-pin stub.
CORNER_MIN = math.radians(28)
#: How far a kerb turns through, in px. Puntarenas' esquinas are generous.
KERB_R = 0.55 * CUAD
#: A fillet never eats more than this fraction of the narrower acera.
KERB_MAX_FRAC = 0.8


def _outgoing(roads, acera_px):
    """{(x, y): [(ux, uy, half_width), …]} — every street leaving a junction.

    The direction points AWAY from the junction, down the way, so two ways that
    continue each other come out ~180° apart.

    EVERY VERTEX IS A CANDIDATE, not just the ends. A junction in OSM is a
    SHARED NODE, and only sometimes an endpoint: Calle 5 runs the length of the
    peninsula as one way and crosses a dozen avenidas at interior vertices of
    itself. Indexing endpoints alone found 759 junctions in this map where
    indexing every vertex finds 1843 — i.e. it missed most of the cuadrícula,
    which is precisely the part of town whose esquinas you look at.

    A point is a junction when two DIFFERENT ways meet there; a bend in a single
    way is not one (its kerb curves on its own, and rounding it would put a
    fillet in the middle of a block).
    """
    at = defaultdict(list)
    for ri, r in enumerate(roads):
        p = r.get("pts") or []
        if len(p) < 4 or r.get("bridge"):
            continue
        hw = r.get("w", 36) / 2 + acera_px
        n = len(p) // 2
        for i in range(n):
            ex, ey = p[i * 2], p[i * 2 + 1]
            for j in (i - 1, i + 1):
                if not (0 <= j < n):
                    continue
                ix, iy = p[j * 2], p[j * 2 + 1]
                d = math.hypot(ix - ex, iy - ey)
                if d < 1e-6:
                    continue
                at[(round(ex), round(ey))].append(
                    (ri, (ix - ex) / d, (iy - ey) / d, hw))
    return {k: [(ux, uy, hw) for (_, ux, uy, hw) in legs]
            for k, legs in at.items() if len({ri for (ri, *_) in legs}) >= 2}


def _fillet(ux1, uy1, h1, ux2, uy2, h2):
    """Where the two aceras' outer edges cross, as (x, y) relative to the
    junction — the intersection of two lines, one offset h from each
    centreline toward the other street."""
    # normal of each street pointing at the OTHER one: that is the side the
    # corner is on
    n1x, n1y = -uy1, ux1
    if n1x * ux2 + n1y * uy2 < 0:
        n1x, n1y = -n1x, -n1y
    n2x, n2y = -uy2, ux2
    if n2x * ux1 + n2y * uy1 < 0:
        n2x, n2y = -n2x, -n2y
    # t·u1 - s·u2 = h2·n2 - h1·n1
    det = ux2 * uy1 - uy2 * ux1
    if abs(det) < 1e-6:
        return None
    rx = h2 * n2x - h1 * n1x
    ry = h2 * n2y - h1 * n1y
    t = (rx * (-uy2) - (-ux2) * ry) / det
    return (t * ux1 + h1 * n1x, t * uy1 + h1 * n1y)


def derive_corners(roads, acera_px):
    """[{x, y, r}] — one acera fillet per real street corner in the world."""
    out = []
    for (jx, jy), legs in _outgoing(roads, acera_px).items():
        if len(legs) < 2:
            continue
        legs = sorted(legs, key=lambda l: math.atan2(l[1], l[0]))
        # collapse duplicates (a way emitted once per tile-spanning piece, a
        # service stub doubling an avenida) onto the widest of them
        uniq = []
        for (ux, uy, hw) in legs:
            if uniq and abs(math.atan2(uy, ux) - math.atan2(uniq[-1][1], uniq[-1][0])) < CORNER_MIN:
                if hw > uniq[-1][2]:
                    uniq[-1] = (ux, uy, hw)
                continue
            uniq.append((ux, uy, hw))
        if len(uniq) > 1:
            a0 = math.atan2(uniq[0][1], uniq[0][0])
            an = math.atan2(uniq[-1][1], uniq[-1][0])
            if (a0 + 2 * math.pi) - an < CORNER_MIN:
                uniq.pop()
        if len(uniq) < 2:
            continue
        n = len(uniq)
        for i in range(n):
            # A two-way join is walked BOTH ways round on purpose: a bend's
            # inside gap may be either (0→1) or (1→0), and only the gap filter
            # knows which — the other one comes out reflex and is dropped.
            ux1, uy1, h1 = uniq[i]
            ux2, uy2, h2 = uniq[(i + 1) % n]
            gap = math.atan2(uy2, ux2) - math.atan2(uy1, ux1)
            while gap <= 0:
                gap += 2 * math.pi
            if gap < CORNER_MIN or gap > CORNER_MAX:
                continue
            fil = _fillet(ux1, uy1, h1, ux2, uy2, h2)
            if fil is None:
                continue
            rad = min(KERB_R, KERB_MAX_FRAC * min(h1 - acera_px, h2 - acera_px))
            if rad < 2:
                continue
            out.append({"x": round(jx + fil[0]), "y": round(jy + fil[1]),
                        "r": round(rad, 1)})
    # deterministic order, and one fillet per point (two junctions a pixel apart
    # would otherwise stack discs on the same corner)
    seen, uniq_out = set(), []
    for c in sorted(out, key=lambda c: (c["x"], c["y"], c["r"])):
        k = (c["x"], c["y"])
        if k in seen:
            continue
        seen.add(k)
        uniq_out.append(c)
    log("kerb", f"{len(uniq_out)} esquinas redondeadas "
        f"(radio {KERB_R:.0f} px, recortado a la acera mas angosta)")
    return uniq_out
