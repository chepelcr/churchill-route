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
JUNCTION_R = 1.3 * CUAD     # px: how close two road ends count as a junction
# A sign stands ON THE CORNER, not in the road. Both offsets are measured from
# the CARRIAGEWAY, not from a fixed number of cuadrículas: the Paseo is 71 px
# wide and a barrio calle 36, so a flat 18 px offset put the ALTOs at the Faro
# end of the Paseo in the middle of the asphalt.
ALTO_SIDE_PAD = 0.45 * CUAD   # px beyond the minor road's own kerb
ALTO_BACK_PAD = 0.6 * CUAD    # px beyond the major road's kerb, back down the approach


#: How deep into the acera a parada's caseta sits, measured from the kerb.
STOP_ACERA_PAD = 0.42 * CUAD
#: A bus_stop node further than this from any carriageway is not on a route the
#: buses drive — it keeps its mapped position and no road to serve it.
STOP_SNAP_R = 3.0 * CUAD


def _snap_to_road(x, y, roads, reach):
    """(qx, qy, ux, uy, half_width) of the nearest road centreline, or None.

    A bus_stop is mapped as a point on the sidewalk, or on the kerb, or (often)
    a couple of metres into the roadway — whatever the surveyor stood on. What
    the world needs is the STREET it serves: the caseta must face the traffic
    and stand clear of the asphalt, and the bus has to know where to pull in.
    """
    best = None
    r2 = reach * reach
    for r in roads:
        p = r.get("pts") or []
        if len(p) < 4 or r.get("cls") == "pedestrian":
            continue
        for i in range(0, len(p) - 2, 2):
            ax, ay, bx, by = p[i], p[i + 1], p[i + 2], p[i + 3]
            dx, dy = bx - ax, by - ay
            l2 = dx * dx + dy * dy
            if l2 <= 0:
                continue
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / l2))
            qx, qy = ax + dx * t, ay + dy * t
            d2 = (x - qx) ** 2 + (y - qy) ** 2
            if d2 > r2:
                continue
            # ties broken by the segment itself, so a rebuild picks the same one
            key = (d2, ax, ay, bx, by)
            if best is None or key < best[0]:
                ln = math.sqrt(l2)
                best = (key, qx, qy, dx / ln, dy / ln, r.get("w", 36) / 2)
    return best[1:] if best else None


def seat_bus_stops(stops, roads):
    """Put every parada on the acera beside its street, facing the traffic."""
    seated = 0
    for s in stops:
        hit = _snap_to_road(s["x"], s["y"], roads, STOP_SNAP_R)
        if hit is None:
            continue
        qx, qy, ux, uy, hw = hit
        # keep the stop on the side the surveyor mapped it; a node dead on the
        # centreline goes to the right of travel, which is where a bus stops
        side = 1.0 if (-uy) * (s["x"] - qx) + ux * (s["y"] - qy) >= 0 else -1.0
        off = hw + STOP_ACERA_PAD
        s["x"] = round(qx - uy * off * side)
        s["y"] = round(qy + ux * off * side)
        s["ang"] = round(math.atan2(uy, ux), 3)
        s["side"] = int(side)
        s["hw"] = round(hw, 1)
        seated += 1
    return seated


def extract_node_signs(sp, nodes_with_tags, canvas_w, canvas_h, roads=()):
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
    stops = [s for s in out if s["kind"] == "bus"]
    if stops and roads:
        seated = seat_bus_stops(stops, roads)
        log("signs", f"{seated}/{len(stops)} paradas sentadas en la acera de su "
            f"calle (las demas quedan donde OSM las puso)")
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
        hw = r.get("w", 36) / 2
        for (_, x, y) in resample_centerline(r["pts"], 10):
            grid.setdefault((int(x // CELL), int(y // CELL)), []).append((x, y, hw))

    def major_near(x, y, rr):
        """The half-width of the nearest major carriageway within rr, or None.

        The WIDTH is what the caller needs: a sign has to clear the road it is
        stopping for, and that road may be a 36 px calle or the 71 px Paseo.
        """
        best = None
        c0, r0 = int(x // CELL), int(y // CELL)
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for (mx, my, hw) in grid.get((c0 + dc, r0 + dr), ()):
                    d2 = (mx - x) ** 2 + (my - y) ** 2
                    if d2 <= rr * rr and (best is None or d2 < best[0]):
                        best = (d2, hw)
        return best[1] if best else None

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
            major_hw = major_near(ex, ey, JUNCTION_R)
            if major_hw is None:
                continue
            # heading INTO the junction, so the sign faces the driver
            ix, iy = (p[2], p[3]) if at_start else (p[-4], p[-3])
            ang = math.atan2(ey - iy, ex - ix)
            # back far enough to clear the road being crossed, and out far
            # enough to clear our own — the corner of the cuadra
            back = major_hw + ALTO_BACK_PAD
            side = r.get("w", 36) / 2 + ALTO_SIDE_PAD
            bx = ex - math.cos(ang) * back
            by = ey - math.sin(ang) * back
            out.append({"x": round(bx + math.cos(ang + math.pi / 2) * side),
                        "y": round(by + math.sin(ang + math.pi / 2) * side),
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
    signs = extract_node_signs(sp, poi_nodes, canvas_w, canvas_h, roads)
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
