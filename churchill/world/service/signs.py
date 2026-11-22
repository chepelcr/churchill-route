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

from ..config import ACERA_CELLS, CUAD, GRID_CELL
from ..enums.features import SignKind, YIELDS_TO
from ..logging import log
from .street import resample_centerline

#: Which OSM node tags become which sign. The value is the `kind` the renderer
#: switches on, and it is a `SignKind` now rather than a bare string: the DTO
#: validates against that enum, so a typo here fails the build instead of
#: drawing nothing at a junction (`drawSign` in src/render/c2d/streets.js takes
#: an unknown kind to a silent no-op).
NODE_SIGNS = {
    ("highway", "traffic_signals"): SignKind.SEMAFORO,
    ("highway", "crossing"): SignKind.CROSSING,
    ("highway", "bus_stop"): SignKind.BUS,
    ("traffic_calming", "bump"): SignKind.TOPE,
    ("traffic_calming", "hump"): SignKind.TOPE,
}

#: A street this class or wider never yields to the one crossing it. The set
#: lives in `enums/features.py` as `YIELDS_TO`, beside the client's separate
#: "traffic may speed here" list — the two were being read as one.
MAJOR = YIELDS_TO
#: …and one this narrow is a driveway, not an approach worth signing.
MINOR_MIN_LEN = 60          # px
JUNCTION_R = 1.3 * CUAD     # px: how close two road ends count as a junction
# A sign stands ON THE CORNER, not in the road — and the corner is where the two
# SIDEWALKS cross. It is found the way `streetlights.py` seats a lamp: from each
# centreline, half its carriageway plus half the acera. Half the major street's
# width + half an acera back from its centreline (measured along the approach,
# so an oblique junction lands right), half the minor street's + half an acera
# off its own: the middle of the corner square of acera. Both measured from the
# CARRIAGEWAY, since the Paseo is 71 px wide and a barrio calle 36. The old
# pads (a whole acera back, 11 px out) put the post at the inner, building-side
# corner of that square, which from above reads as "not at the corner".
ALTO_CORNER_IN = ACERA_CELLS * GRID_CELL * 0.5
#: No two derived ALTOs stand closer than this. Where several ways end at the
#: same esquina they each earn a sign, and the result is a thicket.
ALTO_MIN_GAP = 2.2 * CUAD


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


#: Furniture that OSM maps ON the carriageway because that is where the node
#: belongs for routing, but that STANDS at the kerb in the world: a parada and a
#: semáforo. Both get seated on the acera beside their street.
SEATED_KINDS = (SignKind.BUS, SignKind.SEMAFORO)


def seat_bus_stops(stops, roads):
    """Put every parada (and semáforo) on the acera beside its street, facing
    the traffic.

    A traffic light in OSM is a node ON the centreline — that is how routing
    reads it — so left alone every one of the six stands in the middle of the
    asphalt. It is the same problem the paradas have and it has the same
    answer, so they share the seating pass rather than each growing a rule.""" 
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
    stops = [s for s in out if s["kind"] in SEATED_KINDS]
    if stops and roads:
        seated = seat_bus_stops(stops, roads)
        log("signs", f"{seated}/{len(stops)} paradas y semáforos sentados en la "
            f"acera de su calle (los demas quedan donde OSM los puso)")
    # LA ZEBRA CRUZA SU CALLE. Un `highway=crossing` es un nodo SOBRE la vía y se emitía con
    # `ang` 0: las doce zebras del mapa se pintaban a escuadra con la pantalla, cruzando la calle
    # en diagonal o a lo largo. Se asienta en el eje de su calle, con el rumbo de la calle y su
    # medio ancho (`hw`), que es lo que el renderer necesita para tenderla de bordillo a bordillo.
    snapped = 0
    for z in out:
        if z["kind"] != SignKind.CROSSING or not roads:
            continue
        hit = _snap_to_road(z["x"], z["y"], roads, STOP_SNAP_R)
        if hit is None:
            continue
        qx, qy, ux, uy, hw = hit
        z["x"], z["y"] = round(qx), round(qy)
        z["ang"] = round(math.atan2(uy, ux), 3)
        z["hw"] = round(hw, 1)
        snapped += 1
    if snapped:
        log("signs", f"{snapped} zebras de OSM asentadas a lo ancho de su calle")
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
    # coarse bucket index over the major centrelines, so this is not 2000x2000; each sample keeps its
    # half-width AND its direction, which the corner needs to measure an oblique junction
    CELL = 128
    grid = {}
    for r in major:
        hw = r.get("w", 36) / 2
        sm = resample_centerline(r["pts"], 10)
        for k, (_, x, y) in enumerate(sm):
            a, b = sm[max(0, k - 1)], sm[min(len(sm) - 1, k + 1)]
            d = math.hypot(b[1] - a[1], b[2] - a[2]) or 1.0
            grid.setdefault((int(x // CELL), int(y // CELL)), []).append(
                (x, y, hw, (b[1] - a[1]) / d, (b[2] - a[2]) / d))

    def major_near(x, y, rr):
        """The nearest major centreline sample within rr — (x, y, hw, dx, dy) — or None.

        The WIDTH is what the caller needs: a sign has to clear the road it is
        stopping for, and that road may be a 36 px calle or the 71 px Paseo.
        """
        best = None
        c0, r0 = int(x // CELL), int(y // CELL)
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for smp in grid.get((c0 + dc, r0 + dr), ()):
                    d2 = (smp[0] - x) ** 2 + (smp[1] - y) ** 2
                    if d2 <= rr * rr and (best is None or d2 < best[0]):
                        best = (d2, smp)
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
            hit = major_near(ex, ey, JUNCTION_R)
            if hit is None:
                continue
            mx, my, major_hw, mdx, mdy = hit
            # heading INTO the junction, so the sign faces the driver
            ix, iy = (p[2], p[3]) if at_start else (p[-4], p[-3])
            ang = math.atan2(ey - iy, ex - ix)
            ux, uy = math.cos(ang), math.sin(ang)
            # how far back down the approach the major's near kerb + half an acera lies: the signed
            # distance from its centreline, n·(X - M), falls by (u·n) per px walked along u
            nx, ny = -mdy, mdx
            un = ux * nx + uy * ny
            if abs(un) < 0.35:              # running alongside the major, not into it: no corner
                continue
            # the corner is where two lines cross: parallel to the major at `reach` from its centreline
            # (on the approach side) and parallel to the minor at `side` (on the driver's right). The
            # sideways step has a component across the major too, `side·(r·n)`, which an oblique
            # junction makes large — leaving it out put the post in the crossing street's roadway.
            dE = (ex - mx) * nx + (ey - my) * ny
            reach = major_hw + ALTO_CORNER_IN
            side = r.get("w", 36) / 2 + ALTO_CORNER_IN
            rn = -uy * nx + ux * ny
            back = (dE + side * rn + math.copysign(reach, un)) / un
            bx, by = ex - ux * back, ey - uy * back
            # `_side`/`_hw`: lo que el asiento en la esquina (`finish.settle_altos`) necesita saber de
            # esta calle; no se emiten
            out.append({"x": round(bx - uy * side), "y": round(by + ux * side),
                        "kind": SignKind.ALTO, "ang": round(ang, 3),
                        "_side": round(side, 1), "_hw": round(r.get("w", 36) / 2, 1)})
    # ONE ALTO PER CORNER, not one per approach that happens to end near it.
    # Where the Paseo, Avenida Centenario and the faro street all converge, a
    # dozen short ways end within a few metres of each other and each claimed
    # its own sign — a thicket of ALTOs at the mouth of the junction. Thinning
    # by distance is the honest filter: a driver reads one sign per approach,
    # and two signs a few px apart are the same instruction twice.
    out.sort(key=lambda s: (s["x"], s["y"]))
    thinned = []
    gap2 = ALTO_MIN_GAP * ALTO_MIN_GAP
    for s in out:
        if any((s["x"] - k["x"]) ** 2 + (s["y"] - k["y"]) ** 2 < gap2 for k in thinned):
            continue
        thinned.append(s)
    out = thinned
    # …and a cap: 2000 minor roads with two ends each is a lot of signage, and
    # the map should read as a town, not a sign shop.
    if limit and len(out) > limit:
        step = len(out) / limit
        out = [out[int(i * step)] for i in range(limit)]
    return out


# ─────────────────────────── las señales de poste que salen de la calle ───────────────────────────
#: Las placas de poste se paran a esta distancia del bordillo, dentro de la acera (que mide
#: ACERA_CELLS·GRID_CELL = 15 px); `finish.clear_the_roadway` corrige lo que caiga en la calzada.
POLE_KERB_PAD = 0.3 * CUAD
#: Una VELOCIDAD MÁXIMA entra a esta distancia de la punta de su vía, y se repite cada
#: `SPEED_EVERY` en una vía larga. Dos del mismo número no se paran a menos de `SPEED_MIN_GAP`.
SPEED_IN = 1.4 * CUAD
SPEED_EVERY = 40 * CUAD
SPEED_MIN_GAP = 18 * CUAD
#: Una vía de un sentido más corta que esto es un acceso, no una calle que firmar.
ONEWAY_MIN_LEN = 3 * CUAD
ONEWAY_IN = 0.9 * CUAD
#: Ninguna placa nueva a menos de esto de otra señal ya puesta: la esquina no es una tienda de rótulos.
POLE_MIN_GAP = 0.9 * CUAD
#: A cuánto de la caseta, a lo largo de la calle, van la de PARADA (adelante) y la de NO ESTACIONAR (atrás).
PARADA_ALONG = 1.1 * CUAD
#: Las calles que no se firman: un acceso de servicio o una calle peatonal no llevan velocidad.
UNSIGNED = ("service", "pedestrian", "bridge", "paseo")


def _along(pts, s):
    """(x, y, ux, uy) a `s` px desde el inicio de la polilínea plana `pts`."""
    acc = 0.0
    for i in range(0, len(pts) - 2, 2):
        ax, ay, bx, by = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        L = math.hypot(bx - ax, by - ay)
        if L <= 0:
            continue
        if acc + L >= s:
            t = (s - acc) / L
            return ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / L, (by - ay) / L
        acc += L
    ax, ay, bx, by = pts[-4], pts[-3], pts[-2], pts[-1]
    L = math.hypot(bx - ax, by - ay) or 1
    return bx, by, (bx - ax) / L, (by - ay) / L


def _length(pts):
    return sum(math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) for i in range(0, len(pts) - 2, 2))


def _pole_at(x, y, ux, uy, hw, kind, **extra):
    """Una placa a la DERECHA de quien viaja (ux, uy), en la acera, mirándolo."""
    off = hw + POLE_KERB_PAD
    # con y hacia abajo, la derecha del rumbo (ux, uy) es (-uy, ux)
    return {"x": round(x - uy * off), "y": round(y + ux * off), "kind": kind,
            "ang": round(math.atan2(uy, ux), 3), **extra}


def derive_road_signs(roads, existing):
    """Lo que un conductor lee en una calle de Costa Rica y que OSM sí sabe de ella.

    * **VELOCIDAD MÁXIMA** donde la vía trae `maxspeed`: una placa al entrar a la vía en cada
      sentido que se puede andar, y otra cada `SPEED_EVERY` en una vía larga — nunca dos del mismo
      número a menos de `SPEED_MIN_GAP`, porque una avenida partida en treinta tramos no lleva
      treinta placas;
    * **UNA VÍA** en la punta de entrada de una vía de un sentido —la placa negra con su flecha,
      parada a lo largo de la calle para que la lea quien cruza— y **NO HAY PASO** en la de salida,
      mirando a quien venga al revés.

    Todo a la derecha de quien viaja, en la acera; lo que caiga en la calzada lo corre
    `finish.clear_the_roadway`, que tiene la superficie terminada."""
    placed = list(existing)
    out = []
    gap2 = POLE_MIN_GAP * POLE_MIN_GAP

    def free(s):
        return all((s["x"] - k["x"]) ** 2 + (s["y"] - k["y"]) ** 2 >= gap2 for k in placed)

    def add(s):
        if free(s):
            out.append(s)
            placed.append(s)

    # LA PUNTA DE UNA VÍA ES UN CRUCE. Las placas de la entrada y la salida se medían a una distancia FIJA
    # del final del eje (`ONEWAY_IN`, `SPEED_IN`), y en una avenida de 81 px el final del eje es el medio
    # de la avenida: la NO HAY PASO de Calle 4 quedaba parada en el cordón de la Avenida Centenario. Se
    # miden pasada la calle que cruza —su medio ancho más media acera—, como el ALTO de esa esquina.
    CELL = 128
    grid = {}
    for r in roads:
        if r.get("pts") and len(r["pts"]) >= 4:
            hw_r = r.get("w", 36) / 2
            for (_, x, y) in resample_centerline(r["pts"], 10):
                grid.setdefault((int(x // CELL), int(y // CELL)), []).append((x, y, hw_r, id(r)))

    def past_the_crossing(x, y, own, base):
        """cuánto entrar desde la punta (x, y): `base`, o pasada la calle más ancha que cruza ahí"""
        widest = 0.0
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for (sx, sy, hw_r, rid) in grid.get((int(x // CELL) + dc, int(y // CELL) + dr), ()):
                    if rid != own and (sx - x) ** 2 + (sy - y) ** 2 <= JUNCTION_R * JUNCTION_R:
                        widest = max(widest, hw_r)
        return max(base, widest + ALTO_CORNER_IN) if widest else base

    speeds = []
    for r in sorted(roads, key=lambda r: (r.get("cls", ""), r["pts"][:2])):
        p = r.get("pts") or []
        if len(p) < 4 or r.get("cls") in UNSIGNED:
            continue
        L, hw, ow = _length(p), r.get("w", 36) / 2, r.get("oneway", 0)
        in0 = past_the_crossing(p[0], p[1], id(r), 0.0)       # lo que ocupa la calle que cruza en cada punta
        in1 = past_the_crossing(p[-2], p[-1], id(r), 0.0)
        if r.get("maxspeed") and L > 2 * SPEED_IN:
            for direction in ((1,) if ow == 1 else (-1,) if ow == -1 else (1, -1)):
                a_in, b_in = (in0, in1) if direction == 1 else (in1, in0)
                s = max(SPEED_IN, a_in)
                while s < L - max(SPEED_IN, b_in):
                    d = s if direction == 1 else L - s
                    x, y, ux, uy = _along(p, d)
                    if direction == -1:
                        ux, uy = -ux, -uy
                    cand = _pole_at(x, y, ux, uy, hw, SignKind.VELOCIDAD, value=int(r["maxspeed"]))
                    near = any(k["value"] == cand["value"] and (k["x"] - cand["x"]) ** 2 + (k["y"] - cand["y"]) ** 2 < SPEED_MIN_GAP ** 2
                               for k in speeds)
                    if not near and free(cand):
                        out.append(cand); placed.append(cand); speeds.append(cand)
                    s += SPEED_EVERY
        if ow and L >= ONEWAY_MIN_LEN:
            q = p if ow == 1 else [v for i in range(len(p) - 2, -1, -2) for v in (p[i], p[i + 1])]
            e_in, x_in = (in0, in1) if ow == 1 else (in1, in0)
            e_in, x_in = max(ONEWAY_IN, e_in), max(ONEWAY_IN, x_in)
            if e_in + x_in >= L:
                continue                    # una cuadra que el cruce se come entera: nada que firmar
            x, y, ux, uy = _along(q, e_in)
            add(_pole_at(x, y, ux, uy, hw, SignKind.UNA_VIA))
            x, y, ux, uy = _along(q, L - x_in)
            # la de salida mira al que viene al revés: su rumbo es el contrario, y su derecha la otra acera
            add(_pole_at(x, y, -ux, -uy, hw, SignKind.NO_HAY_PASO))
    return out


def derive_stop_signs(stops, existing):
    """Junto a cada caseta, en su misma acera: PARADA DE AUTOBUSES adelante (en el sentido del
    tráfico de esa acera) y NO ESTACIONAR atrás, las dos mirando al que llega."""
    placed, out = list(existing), []
    gap2 = POLE_MIN_GAP * POLE_MIN_GAP
    for st in stops:
        if "side" not in st:
            continue
        a = st["ang"] + (0 if st["side"] > 0 else math.pi)       # el tráfico de esa acera
        ux, uy = math.cos(a), math.sin(a)
        for k, kind in ((1, SignKind.PARADA), (-1, SignKind.NO_ESTACIONAR)):
            s = {"x": round(st["x"] + ux * PARADA_ALONG * k), "y": round(st["y"] + uy * PARADA_ALONG * k),
                 "kind": kind, "ang": round(a, 3)}
            if all((s["x"] - q["x"]) ** 2 + (s["y"] - q["y"]) ** 2 >= gap2 for q in placed if q is not st):
                out.append(s); placed.append(s)
    return out


def build_signs(sp, poi_nodes, roads, canvas_w, canvas_h, alto_limit=900):
    """Every piece of street furniture the world emits, in one list."""
    signs = extract_node_signs(sp, poi_nodes, canvas_w, canvas_h, roads)
    mapped = len(signs)
    signs += derive_altos(roads, alto_limit)
    signs += derive_stop_signs([s for s in signs if s["kind"] == SignKind.BUS], signs)
    signs += derive_road_signs(roads, signs)
    signs.sort(key=lambda s: (s["kind"], s["x"], s["y"]))
    # Census keyed by the STRING, not the enum member: the build log is the
    # review surface, and a `SignKind` in a dict f-string reprs as
    # `<SignKind.ALTO: 'alto'>`, which turned this line into noise the moment
    # `kind` stopped being a bare str.
    by = {}
    for s in signs:
        key = str(s["kind"])
        by[key] = by.get(key, 0) + 1
    log("signs", f"{len(signs)} pieces of street furniture "
        f"({mapped} mapped in OSM, {len(signs) - mapped} derived from the street "
        f"network and the paradas): {dict(sorted(by.items()))}")
    return signs
