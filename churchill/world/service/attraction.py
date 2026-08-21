"""El campo ferial del Paseo: the turno on the sea front.

A malecón with paving, palms and people is a place; a malecón with a rueda de
Chicago turning over it is a place you go TO. This seats the fairground and
everything standing in it — the rides that actually come to a Costa Rican turno,
the chinamos with the food, and the one attraction that is not mechanical at
all: the DJ set up outside La Takería.

WHAT CHANGED, AND WHY IT WAS WRONG BEFORE. Every ride used to carry its own geo
anchor and be snapped to the nearest promenade independently. The four of them
came out 750 px apart — the carrusel at x 20 630 and the tómbola at x 22 878,
nine hundred metres of coast between the first and the last — so each ride was
in a plausible place and there was no feria anywhere. A turno is not four rides
on a seafront. It is a FIELD you walk into: packed, loud, the chinamos down one
side and the wheel over the top of everything.

So the LOT is the authored thing now (`FERIA_DEF`) and the rides are laid out
inside it, in its own frame. Decisions worth keeping:

* THE LOT IS SEATED ON A BUILDING, NOT ON A COORDINATE. It stands in front of
  La Takería — the same real OSM building DJ Urtech plays outside of, which is
  why he was put there in the first place. Move the restaurant in OSM and the
  whole fairground follows it, exactly as the booth already did.
* IT IS STAMPED AS PACKED EARTH (`Surface.BARRO`). A campo ferial in this
  country is tierra, not paving, and the game already has that surface with its
  own look and its own grip. It is what makes the fairground read as a defined
  piece of ground dedicated to the games rather than as decorations scattered on
  the promenade.
* …BUT IT ONLY TAKES PROMENADE AND SAND. The stamp never touches a carriageway,
  an acera or a cuadra: the lot is fitted to the ground that is already sea
  front, so it can be seated anywhere along the coast without eating a street.
* THE RIDES ARE STILL NOT STAMPED AS WALLS. They are scenery you drive around,
  like a vendor's cart or a parada. The lot is the ground; the rides stand on it.
"""
import math

from ..config import (CLS_ACERA, CLS_BARRO, CLS_BEACH, CLS_MALECON, CLS_ROAD,
                      CLS_WATER, GRID_CELL)
from ..content import ATTRACTION_DEFS, FERIA_DEF
from ..enums import Surface
from ..logging import log, warn
from .block import outline_polys
from .placement import nearest_cell

#: How far from its anchor a ride may be moved to find promenade to stand on.
SNAP_CELLS = 60                     # 240 px
#: …and how far the DJ's booth may look off his restaurant for a sidewalk.
FRONTAGE_STEPS = 24              # cells
#: hasta dónde se anda el rayo hacia el mar buscando el malecón de la tarima.
DJ_STAGE_REACH_PX = 520
#: EL CAMPO FERIAL ES UNA CALLE CERRADA, no un lote de tierra sobre el paseo.
#: Antes tomaba malecón y arena y los estampaba `Surface.BARRO` — «a campo ferial
#: in this country is tierra» —, lo que ponía el turno ENCIMA del paseo marítimo,
#: se comía la playa y dejaba el frente del mar café. Un turno de verdad cierra
#: una calle: la calzada SUR del Paseo de los Turistas, al sur de la mediana de
#: palmas, mientras la calzada norte sigue abierta y el Paseo se recorre de punta
#: a punta. El suelo NO se estampa — es la calle, y sigue siendo la calle.
LOT_CLASSES = (CLS_ROAD,)
#: lo que corta la búsqueda hacia el mar: pasado esto ya no hay más calzada.
SEAWARD_STOP = (CLS_MALECON, CLS_BEACH, CLS_WATER)
#: CÓMO SE SABE HACIA DÓNDE ESTÁ EL MAR, que es una pregunta distinta de con qué
#: se corta el lote. Eran la misma constante mientras el campo ferial se cortaba
#: del malecón, y separarlas no es cosmética: `_seaward` cuenta cuál de las dos
#: normales de la calle tiene más de esto debajo, así que apuntarlo a la calzada
#: hacía que «el mar» fuera el lado con más asfalto — tierra adentro.
SEA_CLASSES = (CLS_MALECON, CLS_BEACH)
#: how far seaward of the host building to look for the promenade to stand on.
LOT_REACH_PX = 420


def _seat_on_frontage(raster, x, y, toward):
    """The acera between a building and its street — where a booth sets up.

    Not a walk along the ray from the centroid: on a small restaurant that ray
    can step from wall to kerb without ever landing on a sidewalk cell, and the
    DJ then falls back to his anchor, which is the middle of the Paseo. Taking
    the nearest acera to the MIDPOINT keeps both properties that matter — it is
    a sidewalk, and it is the sidewalk on the street side.
    """
    ref = ((x + toward[0]) / 2, (y + toward[1]) / 2)
    return nearest_cell(raster, ref[0], ref[1], (CLS_ACERA,), FRONTAGE_STEPS)


def _host_building(buildings, name):
    return next((b for b in buildings
                 if (b.get("name") or "").lower() == (name or "").lower()), None)


def _seaward(raster, cx, cy, ang):
    """Step off the host toward the sea and return the promenade it finds.

    The coast bends, so "the sea is south" is not a rule this can use. The
    normal of the street the host sits on gives two candidate directions; the
    one with promenade under it is the sea, and if both have some, the one with
    MORE of it — which on this front is always the playa side.
    """
    best = None
    for side in (-1, 1):
        nx, ny = -math.sin(ang) * side, math.cos(ang) * side
        hits, first = 0, None
        d = 0.0
        while d <= LOT_REACH_PX:
            c, r = raster.cell_of(cx + nx * d, cy + ny * d)
            if raster.in_bounds(c, r) and raster.at(c, r) in SEA_CLASSES:
                hits += 1
                if first is None:
                    first = d
            d += GRID_CELL
        if hits and (best is None or hits > best[0]):
            best = (hits, nx, ny, first)
    return best


def _first_class(raster, cx, cy, nx, ny, classes, reach):
    """El primer punto del rayo cuya celda es una de `classes`, o None."""
    d = 0.0
    while d <= reach:
        px, py = cx + nx * d, cy + ny * d
        c, r = raster.cell_of(px, py)
        if raster.in_bounds(c, r) and raster.at(c, r) in classes:
            return (px, py)
        d += GRID_CELL
    return None


def _disc_on(raster, px, py, classes, rad):
    """¿Cae el disco ENTERO sobre estas clases? (no sólo su centro)"""
    if rad <= 0:
        rad = 0.0
    for f in (1.0, 0.62):
        for k in range(8):
            a = k * (math.pi / 4)
            x, y = px + math.cos(a) * rad * f, py + math.sin(a) * rad * f
            c, r = raster.cell_of(x, y)
            if not (raster.in_bounds(c, r) and raster.at(c, r) in classes):
                return False
    c, r = raster.cell_of(px, py)
    return raster.in_bounds(c, r) and raster.at(c, r) in classes


def _first_class_clear(raster, cx, cy, nx, ny, classes, reach, rad):
    """El primer punto del rayo donde CABE ENTERO un disco de radio `rad`.

    UNA TARIMA TIENE QUE LIBRAR POR SU ARTE, NO POR SU ANCLA — es la misma regla
    que el repo ya escribió para los kioscos y el agua («a kiosk must clear the
    sea by its ART, not its anchor»), y se rompió igual: `_first_class` devuelve
    la PRIMERA celda de malecón del rayo, o sea justo el borde de tierra. El DJ
    quedaba con su ancla 2 px dentro del malecón y la tarima —que mide ±19 px—
    metida en la calzada sur cerrada y en la acera de la mediana.
    """
    d = 0.0
    while d <= reach:
        px, py = cx + nx * d, cy + ny * d
        if _disc_on(raster, px, py, classes, rad):
            return (px, py)
        d += GRID_CELL
    return None


def _south_carriageway(raster, cx, cy, nx, ny):
    """LA CALZADA MÁS AL MAR antes de que se acabe el asfalto — `(d0, d1)` en px
    desde `(cx, cy)` a lo largo de `(nx, ny)`.

    El Paseo de los Turistas es una avenida DIVIDIDA: calzada norte, mediana de
    palmas (una acera de ~16 px) y calzada sur. Caminar hacia el mar cruza las
    dos, así que la que se cierra es LA ÚLTIMA — la de más al mar — y eso se
    encuentra sin nombrar ninguna: se anda hasta que aparece malecón, arena o
    agua, y se devuelve la última corrida de calzada de ese camino.
    """
    runs, start = [], None
    d = 0.0
    while d <= LOT_REACH_PX:
        c, r = raster.cell_of(cx + nx * d, cy + ny * d)
        if not raster.in_bounds(c, r):
            break
        cls = raster.at(c, r)
        if cls in SEAWARD_STOP:
            break
        if cls == CLS_ROAD:
            if start is None:
                start = d
        elif start is not None:
            runs.append((start, d - GRID_CELL))
            start = None
        d += GRID_CELL
    if start is not None:
        runs.append((start, d - GRID_CELL))
    return runs[-1] if runs else None


def _line_cells(raster, x0, y0, x1, y1):
    """Every barro cell the entrance ramp just laid, so the lot's outline
    includes it — otherwise the drawn fairground stops at a gate you can drive
    through but cannot see."""
    out = []
    L = math.hypot(x1 - x0, y1 - y0)
    if L < 1e-6:
        return out
    steps = int(L / (GRID_CELL / 2.0)) + 1
    for i in range(steps + 1):
        t = i / steps
        px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for dx in range(-14, 15, GRID_CELL // 2):
            for dy in range(-14, 15, GRID_CELL // 2):
                c, r = raster.cell_of(px + dx, py + dy)
                if raster.in_bounds(c, r) and raster.at(c, r) == CLS_BARRO:
                    out.append((c, r))
    return out


def place_feria(ctx, buildings, streets):
    """Stamp the fairground's ground and return (lot record, centre, angle)."""
    raster = ctx.raster
    host = _host_building(buildings, FERIA_DEF.get("host"))
    if host is None:
        warn("feria", f"no building named {FERIA_DEF.get('host')!r} — "
             f"the campo ferial has nowhere to stand")
        return None, None, None
    xs, ys = host["pts"][0::2], host["pts"][1::2]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    ang = float(streets.angle_at(cx, cy, reach=12 * 20) or 0.0)
    found = _seaward(raster, cx, cy, ang)
    if found is None:
        warn("feria", f"no promenade within {LOT_REACH_PX}px of "
             f"{FERIA_DEF['host']} — the campo ferial is not placed")
        return None, None, None
    _hits, nx, ny, first = found
    lane = _south_carriageway(raster, cx, cy, nx, ny)
    if lane is None:
        warn("feria", f"no carriageway seaward of {FERIA_DEF['host']} — "
             f"the campo ferial is not placed")
        return None, None, None
    d0, d1 = lane
    w, h = FERIA_DEF["w"], FERIA_DEF["h"]
    # El lote se centra EN la calzada que cierra. Su profundidad autorada (`h`)
    # es mucho mayor que un carril —200 px contra ~32— y eso es a propósito: los
    # juegos DESBORDAN sobre el borde de la mediana y el labio del malecón, como
    # desborda un turno de verdad. Lo que no desborda es el SUELO: sólo se toman
    # las celdas de calzada dentro de la franja, así que el campo ferial se
    # dibuja sobre la calle que cerró y sobre nada más.
    lx = cx + nx * ((d0 + d1) / 2.0)
    ly = cy + ny * ((d0 + d1) / 2.0)
    ca, sa = math.cos(ang), math.sin(ang)
    cells = set()
    u = -w / 2.0
    while u <= w / 2.0:
        v = -h / 2.0
        while v <= h / 2.0:
            px = lx + ca * u - sa * v
            py = ly + sa * u + ca * v
            c, r = raster.cell_of(px, py)
            # NADA SE ESTAMPA. El suelo del campo ferial ES la calle: cerrarla
            # para el turno no la convierte en tierra, y estampar `CLS_BARRO`
            # aquí era lo que pintaba el frente del mar de café. Se recogen las
            # celdas para tener el contorno, y se dejan como están.
            if raster.in_bounds(c, r) and raster.at(c, r) in LOT_CLASSES:
                cells.add((c, r))
            v += GRID_CELL / 2.0
        u += GRID_CELL / 2.0
    if not cells:
        warn("feria", "the campo ferial's rect covered no carriageway — not placed")
        return None, None, None
    # Y NO HACE FALTA ENTRADA. La reja de tierra existía porque el lote era una
    # isla de barro rodeada de malecón, que es pared para un carro. Una calzada
    # ya está en la red: se entra por donde se entraba a la calle.
    polys = outline_polys(cells, GRID_CELL)
    xs = [c for c, _ in cells]
    ys = [r for _, r in cells]
    lot = {
        "id": FERIA_DEF["id"], "name": FERIA_DEF["name"],
        "polys": polys, "ang": round(ang, 4),
        "x0": min(xs) * GRID_CELL, "y0": min(ys) * GRID_CELL,
        "x1": (max(xs) + 1) * GRID_CELL, "y1": (max(ys) + 1) * GRID_CELL,
        "cx": round(lx), "cy": round(ly), "cells": len(cells),
    }
    log("feria", f"campo ferial frente a {FERIA_DEF['host']}: "
        f"({round(lx)},{round(ly)}) {w}x{h}px at {math.degrees(ang):+.1f}°, "
        f"calzada sur {round(d1 - d0)}px de ancho, {len(cells)} celdas de calle "
        f"(sin estampar), {len(polys)} contorno(s)")
    return lot, (lx, ly), ang


def place_attractions(ctx, project_ll, buildings, streets):
    """Seat the fairground and everything in it; return what the client draws."""
    raster = ctx.raster
    lot, centre, ang = place_feria(ctx, buildings, streets)
    if lot is not None:
        ctx.feria.append(lot)
    ca, sa = (math.cos(ang), math.sin(ang)) if ang is not None else (1.0, 0.0)
    out = []
    for spec in ATTRACTION_DEFS:
        seat, rec_ang = None, None
        if spec["kind"] == "dj":
            # THE DJ IS SEATED ON HIS RESTAURANT, NOT ON A COORDINATE, and not
            # in the lot's frame either: he plays on La Takería's own sidewalk,
            # across the promenade from the rides.
            # EL DJ SE MUDÓ AL MALECÓN, de cara al mar. Tocaba en la acera de su
            # restaurante, de espaldas al golfo y con el campo ferial encima del
            # paseo; ahora el turno cierra una calzada y el paseo marítimo queda
            # libre, que es donde se pone una tarima. Sigue anclado a La
            # Takería —mové el restaurante en OSM y el DJ lo sigue— pero se
            # sienta en el malecón que tiene enfrente.
            host = _host_building(buildings, spec.get("host"))
            if host:
                xs, ys = host["pts"][0::2], host["pts"][1::2]
                hx, hy = sum(xs) / len(xs), sum(ys) / len(ys)
                hang = float(streets.angle_at(hx, hy, reach=12 * 20) or 0.0)
                found = _seaward(raster, hx, hy, hang)
                if found:
                    _h, dnx, dny, _first = found
                    # EL PRIMER MALECÓN DEL RAYO, no una distancia escrita. Un
                    # `+150 px` es verdad sólo donde la avenida mide lo que medía
                    # el día que se escribió: aquí la calzada norte, la mediana y
                    # la calzada sur suman ~160, así que el tiro caía todavía en
                    # el asfalto. Andar el rayo hasta encontrar promenade
                    # funciona en cualquier ancho.
                    # …Y QUE QUEPA LA TARIMA ENTERA, no sólo su ancla. El arte
                    # va de -0.95r a +0.95r, así que se pide un disco del radio
                    # del propio juego; si el malecón no da para tanto se cae al
                    # borde de antes, avisando, en vez de plantarlo en la calle.
                    rad = float(spec.get("r") or 0)
                    spot = _first_class_clear(raster, hx, hy, dnx, dny,
                                              (CLS_MALECON,), DJ_STAGE_REACH_PX, rad)
                    if spot is None:
                        spot = _first_class(raster, hx, hy, dnx, dny,
                                            (CLS_MALECON,), DJ_STAGE_REACH_PX)
                        if spot:
                            warn("feria", f"{spec['id']}: el malecón frente a "
                                 f"{spec['host']} no da para una tarima de {rad:.0f}px "
                                 f"de radio — queda en el borde")
                    if spot:
                        seat = spot
                        log("feria", f"{spec['id']} en el malecón "
                            f"({round(spot[0])},{round(spot[1])}), "
                            f"{round(math.hypot(spot[0] - hx, spot[1] - hy))}px mar "
                            f"adentro de {spec['host']}")
                        # DE CARA A LA PLAYA. `_seaward` ya resolvió cuál de las
                        # dos normales de la calle da al mar, así que el rumbo
                        # del escenario sale de ahí y no de un número escrito.
                        rec_ang = math.atan2(dny, dnx)
                if seat is None:
                    warn("feria", f"{spec['id']}: {spec['host']} has no malecón in "
                         f"front of it; falling back to the authored anchor")
            else:
                warn("feria", f"{spec['id']}: no building named {spec.get('host')!r}")
            if seat is None:
                seat = project_ll(*spec["at"])
        elif centre is not None:
            # IN THE LOT'S FRAME. `at` is (u, v) px from the lot's centre: u
            # along the coast, v seaward. Turning them by the lot's own angle is
            # what makes the two rows read as rows instead of as a scatter — the
            # same rule every parcel in this world draws by.
            u, v = spec["at"]
            seat = (centre[0] + ca * u - sa * v, centre[1] + sa * u + ca * v)
        else:
            warn("feria", f"{spec['id']}: no campo ferial to stand in — not placed")
            continue
        rec = {"id": spec["id"], "name": spec["name"], "kind": spec["kind"],
               "x": round(seat[0]), "y": round(seat[1]), "r": spec.get("r", 24)}
        if rec_ang is not None:
            rec["ang"] = round(rec_ang, 4)
        if spec.get("food"):
            rec["food"] = spec["food"]
        out.append(rec)
    log("feria", f"{len(out)}/{len(ATTRACTION_DEFS)} atracciones en el campo ferial "
        f"({sum(1 for a in out if a['kind'] == 'chinamo')} chinamos)")
    return out
