"""El campo ferial del Paseo: the turno on the sea front.

A malecón with paving, palms and people is a place; a malecón with a rueda de
Chicago turning over it is a place you go TO. This seats the fairground and
everything standing in it — the rides that actually come to a Costa Rican turno,
the chinamos with the food, and the one attraction that is not mechanical at
all: the DJ set up outside La Takería.

EL TURNO TIENE SU PROPIO SUELO, JUNTO A LA CALLE. Tres intentos antes de éste,
y vale saber por qué cayó cada uno:

* cada juego con su ancla geo, pegado al paseo más cercano: quedaron a 750 px
  uno del otro. Un turno no son cuatro juegos sobre un frente de mar, es un
  CAMPO al que se entra;
* un lote de `Surface.BARRO` cortado del malecón y la arena: pintó el frente del
  mar de café y se comió la playa;
* la calzada SUR del Paseo cerrada, sin estampar nada: los juegos desbordaban
  sobre la mediana y se manejaba ENTRE ellos por la calle misma — la feria
  estaba encima de la calle.

Ahora es un TABLADO de madera pegado al cordón de la calzada más al mar, y SE
MAPEA A MANO como una cuadra de `blocks.json`: `FERIA_DEF["outlineLL"]` es su
contorno en lat/lon y cada juego trae su propia `ll`. Nada se deriva de un
edificio ni de un offset: lo que se autora es lo que sale, y se puede mirar
antes de construir (`tools/preview_feria.py`). Las reglas:

* TOMA MALECÓN y la acera suelta del cordón; nunca calzada ni cuadra. La playa
  y el agua requieren las autorizaciones explícitas `overSand` y `overWater`:
  esta ampliación las usa para continuar sobre pilotes con pasos entre juegos.
* SE ESTAMPA `Surface.BRIDGE`, la clase de la cubierta de un muelle: algo sobre
  lo que se maneja y que no es una calle a la que enlazar. Es exactamente lo
  que es un tablado, y no hizo falta una clase nueva.
* LOS JUEGOS NO SE ESTAMPAN COMO PARED. Estorban y rebotan en el cliente
  (`physics.js`); el tablado es el suelo y ellos se paran encima: comidas a la
  izquierda, escenario central y atracciones a la derecha — ver `_layoutNote`
  en `attractions.json`.
"""
import math

from ..config import (CLS_ACERA, CLS_BARRO, CLS_BEACH, CLS_BRIDGE, CLS_MALECON,
                      CLS_ROAD, CLS_WATER, GRID_CELL, px)
from ..content import ATTRACTION_DEFS, FERIA_DEF
from ..enums import Surface
from ..logging import log, warn
from ..util.geometry import point_in_poly, principal_axis
from .block import outline_polys
from .placement import nearest_cell

#: How far from its anchor a ride may be moved to find promenade to stand on.
SNAP_CELLS = 60                     # 240 px
#: …and how far the DJ's booth may look off his restaurant for a sidewalk.
FRONTAGE_STEPS = 24              # cells
#: hasta dónde se anda el rayo hacia el mar buscando el malecón de la tarima.
DJ_STAGE_REACH_PX = 520
#: DE QUÉ SE CORTA EL TABLADO: del paseo, y de la acera suelta que a ratos queda
#: entre el cordón y él (medido: 5 px en el extremo este). Esa acera es PARED, así
#: que dejarla sería ponerle una valla al frente por donde se entra.
LOT_CLASSES = (CLS_MALECON, CLS_ACERA)
#: hasta qué ancho una franja de arena es una costura del malecón y no playa.
SEAM_CELLS = 3
#: …y qué es: la cubierta de un muelle. Transitable, y no una calle.
DECK_CLASS = CLS_BRIDGE
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


def place_feria(ctx, project_ll):
    """Stamp the fairground's deck from its mapped outline; return (lot, centre, angle)."""
    raster = ctx.raster
    outline = FERIA_DEF.get("outlineLL")
    if not outline or len(outline) < 3:
        ctx.failures.append("feria(sin `outlineLL`: el tablado no está mapeado)")
        return None, None, None
    pts = [project_ll(lat, lon) for lat, lon in outline]
    lx, ly = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    # EL MARCO SALE DEL PROPIO CONTORNO: su eje largo es el ángulo del lote —por
    # donde corren las tablas—. `principal_axis` se cae en una figura casi
    # cuadrada (su docstring lo dice), y un tablado de feria mide cuatro veces
    # más de largo que de fondo. Preguntarle a la calle más cercana daba -0,5°
    # donde el frente va a -4,3°: desde el centro del lote la calle «más
    # cercana» no es la del frente.
    ang = float(principal_axis(pts)[2])
    if ang > math.pi / 2:
        ang -= math.pi
    elif ang <= -math.pi / 2:
        ang += math.pi
    # MAR ADENTRO es la perpendicular que se aleja de la entrada; sin entrada
    # mapeada, la que tiene más paseo y arena debajo.
    nx, ny = -math.sin(ang), math.cos(ang)
    gate_ll = FERIA_DEF.get("entranceLL")
    if gate_ll:
        gx, gy = project_ll(*gate_ll[0])
        if (lx - gx) * nx + (ly - gy) * ny < 0:
            nx, ny = -nx, -ny
    else:
        found = _seaward(raster, lx, ly, ang)
        if found:
            nx, ny = found[1], found[2]
    c0, r0 = raster.cell_of(min(p[0] for p in pts), min(p[1] for p in pts))
    c1, r1 = raster.cell_of(max(p[0] for p in pts), max(p[1] for p in pts))
    inside = [(c, r) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)
              if raster.in_bounds(c, r)
              and point_in_poly(((c + 0.5) * GRID_CELL, (r + 0.5) * GRID_CELL), pts)]
    # Nunca se entabla la calzada. La playa y el agua sólo se toman cuando el
    # lote lo autoriza expresamente con `overSand` y `overWater`.
    take = LOT_CLASSES + ((CLS_BEACH,) if FERIA_DEF.get("overSand") else ()) \
        + ((CLS_WATER,) if FERIA_DEF.get("overWater") else ())
    cells = {cell for cell in inside if raster.at(*cell) in take}
    # Sin `overSand`, sólo se entablan las rendijas estrechas entre tramos de
    # malecón; la playa abierta queda intacta y se cuenta en el log.
    seams, beach = set(), 0
    for c, r in inside:
        if raster.at(c, r) != CLS_BEACH or (c, r) in cells:
            continue
        for dc, dr in ((1, 0), (0, 1)):
            a = any((c + dc * k, r + dr * k) in cells for k in range(1, SEAM_CELLS + 1))
            b = any((c - dc * k, r - dr * k) in cells for k in range(1, SEAM_CELLS + 1))
            if a and b:
                seams.add((c, r))
                break
        else:
            beach += 1
    cells |= seams
    if not cells:
        ctx.failures.append("feria(el contorno mapeado no cubre nada de malecón)")
        return None, None, None
    # LA ENTRADA. El tablado va separado de la acera y entre los dos queda paseo,
    # que es pared para un carro: la rampa mapeada (`entranceLL`) es el único
    # paso. Sus dos primeros vértices van en la calzada y los dos últimos son la
    # boca sobre el tablado, donde se abre la baranda y va el cartel.
    ramp, entrance = set(), None
    gate = FERIA_DEF.get("entranceLL")
    if gate and len(gate) >= 4:
        gp = [project_ll(lat, lon) for lat, lon in gate]
        g0, h0 = raster.cell_of(min(p[0] for p in gp), min(p[1] for p in gp))
        g1, h1 = raster.cell_of(max(p[0] for p in gp), max(p[1] for p in gp))
        ramp = {(c, r) for r in range(h0, h1 + 1) for c in range(g0, g1 + 1)
                if raster.in_bounds(c, r) and (c, r) not in cells
                and raster.at(c, r) in LOT_CLASSES
                and point_in_poly(((c + 0.5) * GRID_CELL, (r + 0.5) * GRID_CELL), gp)}
        (mx0, my0), (mx1, my1) = gp[-2], gp[-1]
        (sx0, sy0), (sx1, sy1) = gp[0], gp[1]
        ex, ey = (mx0 + mx1) / 2, (my0 + my1) / 2
        entrance = {
            "x": round(ex), "y": round(ey),
            "w": round(math.hypot(mx1 - mx0, my1 - my0)),
            "len": round(math.hypot((sx0 + sx1) / 2 - ex, (sy0 + sy1) / 2 - ey)),
        }
    for c, r in cells | ramp:
        raster.buf[r * raster.cols + c] = DECK_CLASS
    # ¿SE ENTRA? El tablado no sirve si no toca la calle: se cuentan las celdas
    # suyas con calzada al lado, y si no hay ninguna el build falla.
    mouth = sum(1 for c, r in cells | ramp
                if any(raster.in_bounds(c + dc, r + dr) and raster.at(c + dc, r + dr) == CLS_ROAD
                       for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))))
    if not mouth:
        ctx.failures.append("feria(el tablado no toca ninguna calzada: no se puede entrar)")
    polys = outline_polys(cells, GRID_CELL)
    xs = [c for c, _ in cells]
    ys = [r for _, r in cells]
    lot = {
        "id": FERIA_DEF["id"], "name": FERIA_DEF["name"],
        "polys": polys, "ang": round(ang, 4),
        "x0": min(xs) * GRID_CELL, "y0": min(ys) * GRID_CELL,
        "x1": (max(xs) + 1) * GRID_CELL, "y1": (max(ys) + 1) * GRID_CELL,
        "cx": round(lx), "cy": round(ly), "cells": len(cells),
        # `(nx, ny)` es mar adentro: la tarima mira al otro lado.
        "sea": [round(nx, 4), round(ny, 4)],
    }
    if entrance:
        lot["entrance"] = entrance
        lot["ramp"] = outline_polys(ramp, GRID_CELL) if ramp else []
    if FERIA_DEF.get("sign"):
        lot["sign"] = FERIA_DEF["sign"]
    log("feria", f"tablado mapeado ({len(outline)} vértices) en ({round(lx)},{round(ly)}) "
        f"at {math.degrees(ang):+.1f}°: {len(cells)} celdas -> cubierta "
        f"({sum(1 for c in inside if raster.at(*c) == CLS_BEACH) if FERIA_DEF.get('overSand') else 0} "
        f"sobre la arena, {len(seams)} de rendijas, {beach} de playa respetadas), "
        f"{mouth} con calzada al lado, {len(polys)} contorno(s); "
        f"rampa de entrada {len(ramp)} celdas")
    return lot, (lx, ly), ang


def place_attractions(ctx, project_ll, buildings, streets):
    """Seat the fairground and everything in it; return what the client draws.

    `buildings` ya no se usa —el lote no se cuelga de un edificio— pero se
    conserva en la firma: la llama `decorate` y `tools/preview_feria.py`.
    """
    raster = ctx.raster
    lot, _centre, _ang = place_feria(ctx, project_ll)
    if lot is not None:
        ctx.feria.append(lot)
    out = []
    for spec in ATTRACTION_DEFS:
        if not spec.get("ll"):
            ctx.failures.append(f"feria({spec['id']} no tiene `ll`: no está mapeado)")
            continue
        # CADA JUEGO SE PARA DONDE SE MAPEÓ. No hay marco del lote ni ajuste: la
        # lat/lon es el sitio, igual que el `centerLL` de una parte de una
        # cuadra. Lo que el build sí hace es DECIR si no cabe.
        seat = project_ll(*spec["ll"])
        rad = float(spec.get("r") or 0)
        if lot is not None and not _disc_on(raster, seat[0], seat[1], (DECK_CLASS,), rad * 0.9):
            seen = {}
            for k in range(16):
                a = k * math.pi / 8
                cls = raster.at(*raster.cell_of(seat[0] + math.cos(a) * rad * 0.9,
                                                seat[1] + math.sin(a) * rad * 0.9))
                seen[cls] = seen.get(cls, 0) + 1
            warn("feria", f"{spec['id']}: no cabe entero en el tablado "
                 f"({round(seat[0])},{round(seat[1])}, r {rad:.0f}px; debajo: {seen})")
        rec = {"id": spec["id"], "name": spec["name"], "kind": spec["kind"],
               "x": round(seat[0]), "y": round(seat[1]), "r": spec.get("r", 24)}
        if "ang" in spec:
            rec["ang"] = float(spec["ang"])
        if spec["kind"] == "dj" and lot is not None:
            # LA TARIMA, DE CARA A LA CALLE: de espaldas al mar que `_seaward`
            # resolvió, no a un rumbo escrito.
            rec["ang"] = round(math.atan2(-lot["sea"][1], -lot["sea"][0]), 4)
        if spec.get("food"):
            rec["food"] = spec["food"]
        if spec.get("audience"):
            rec["audience"] = int(spec["audience"])
        out.append(rec)
    log("feria", f"{len(out)}/{len(ATTRACTION_DEFS)} atracciones en el campo ferial "
        f"({sum(1 for a in out if a['kind'] == 'chinamo')} chinamos)")
    return out
