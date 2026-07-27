"""Street furniture: the signs and markings that make a road read as a road.

Costa Rica's signalling follows the Manual Centroamericano de Dispositivos
Uniformes: the **ALTO** is the octagonal red one (the word, not "STOP"), the
**CEDA EL PASO** an inverted white triangle with a red border, speed limits a
white disc with a red rim, and the *tope* (speed bump) is the yellow-hatched
hump every barrio street has.

WHAT OSM ACTUALLY HAS IS ALMOST NONE OF IT. Across this whole map:
`highway=stop` 0, `give_way` 0, `traffic_signals` 6, `crossing` 12,
`bus_stop` 87, `traffic_calming=bump` 2. So the mapped furniture is emitted
where it exists, and the ALTOs — which is what a driver actually sees at every
esquina here — are DERIVED from the street network: where a small street ends
at a bigger one, that approach gets an ALTO.

Deriving them is honest as long as it follows the rule the real ones follow
(the minor road yields), which is what `derive_altos` does. It is also the only
option: inventing them at random would put an ALTO in the middle of a block.
"""
import math

from ..config import CUAD
from ..logging import log
from .street import resample_centerline

#: Which OSM node tags become which sign. The value is the `kind` the renderer
#: switches on — keep it in step with `drawSign` in src/render/c2d/streets.js.
NODE_SIGNS = {
    ("highway", "traffic_signals"): "semaforo",
    ("highway", "crossing"): "crossing",
    ("highway", "bus_stop"): "bus",
    ("traffic_calming", "bump"): "tope",
    ("traffic_calming", "hump"): "tope",
}

#: A street this class or wider never yields to the one crossing it.
MAJOR = ("trunk", "trunk_link", "primary", "primary_link", "secondary", "paseo")
#: …and one this narrow is a driveway, not an approach worth signing.
MINOR_MIN_LEN = 60          # px
ALTO_BACK = 1.1 * CUAD      # px back from the junction, along the approach
ALTO_SIDE = 0.9 * CUAD      # px to the right of the centreline — the kerb
JUNCTION_R = 1.3 * CUAD     # px: how close two road ends count as a junction


def extract_node_signs(sp, nodes_with_tags, canvas_w, canvas_h):
    """The furniture OSM does record, projected: {x, y, kind, ang}."""
    out = []
    for (ll, tags) in nodes_with_tags:
        kind = next((v for k, v in NODE_SIGNS.items()
                     if tags.get(k[0]) == k[1]), None)
        if kind is None:
            continue
        from ..util.geometry import to_m
        x, y, _, _ = sp.project(to_m(*ll))
        if not (0 <= x < canvas_w and 0 <= y < canvas_h):
            continue
        out.append({"x": round(x), "y": round(y), "kind": kind, "ang": 0.0})
    return out


def derive_altos(roads, limit=None):
    """An ALTO on every minor approach to a bigger street.

    The rule is the real one: where a residential calle runs into an avenida,
    the calle stops. So for each end of each minor road, look for a MAJOR road
    passing within `JUNCTION_R`; if one is there, put a sign a little back down
    the approach and off to the right, facing the way the driver is going.
    """
    major = [r for r in roads if r.get("cls") in MAJOR and r.get("pts")]
    if not major:
        return []
    # coarse bucket index over the major centrelines, so this is not 2000x2000
    CELL = 128
    grid = {}
    for r in major:
        for (_, x, y) in resample_centerline(r["pts"], 10):
            grid.setdefault((int(x // CELL), int(y // CELL)), []).append((x, y))

    def major_near(x, y, rr):
        c0, r0 = int(x // CELL), int(y // CELL)
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for (mx, my) in grid.get((c0 + dc, r0 + dr), ()):
                    if (mx - x) ** 2 + (my - y) ** 2 <= rr * rr:
                        return True
        return False

    out = []
    for r in roads:
        if r.get("cls") in MAJOR or not r.get("pts"):
            continue
        p = r["pts"]
        if len(p) < 4:
            continue
        length = sum(math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1])
                     for i in range(0, len(p) - 2, 2))
        if length < MINOR_MIN_LEN:
            continue
        for at_start in (True, False):
            ex, ey = (p[0], p[1]) if at_start else (p[-2], p[-1])
            if not major_near(ex, ey, JUNCTION_R):
                continue
            # heading INTO the junction, so the sign faces the driver
            ix, iy = (p[2], p[3]) if at_start else (p[-4], p[-3])
            ang = math.atan2(ey - iy, ex - ix)
            bx = ex - math.cos(ang) * ALTO_BACK
            by = ey - math.sin(ang) * ALTO_BACK
            out.append({"x": round(bx + math.cos(ang + math.pi / 2) * ALTO_SIDE),
                        "y": round(by + math.sin(ang + math.pi / 2) * ALTO_SIDE),
                        "kind": "alto", "ang": round(ang, 3)})
    # Deterministic order and a cap: 2000 minor roads with two ends each is a
    # lot of signage, and the map should read as a town, not a sign shop.
    out.sort(key=lambda s: (s["x"], s["y"]))
    if limit and len(out) > limit:
        step = len(out) / limit
        out = [out[int(i * step)] for i in range(limit)]
    return out


def build_signs(sp, poi_nodes, roads, canvas_w, canvas_h, alto_limit=900):
    """Every piece of street furniture the world emits, in one list."""
    signs = extract_node_signs(sp, poi_nodes, canvas_w, canvas_h)
    mapped = len(signs)
    signs += derive_altos(roads, alto_limit)
    signs.sort(key=lambda s: (s["kind"], s["x"], s["y"]))
    by = {}
    for s in signs:
        by[s["kind"]] = by.get(s["kind"], 0) + 1
    log("signs", f"{len(signs)} pieces of street furniture "
        f"({mapped} mapped in OSM, {len(signs) - mapped} ALTOs derived from the "
        f"street network): {dict(sorted(by.items()))}")
    return signs
