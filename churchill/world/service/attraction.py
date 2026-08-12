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
                      GRID_CELL)
from ..content import ATTRACTION_DEFS, FERIA_DEF
from ..enums import Surface
from ..logging import log, warn
from .block import outline_polys
from .placement import nearest_cell

#: How far from its anchor a ride may be moved to find promenade to stand on.
SNAP_CELLS = 60                     # 240 px
#: …and how far the DJ's booth may look off his restaurant for a sidewalk.
FRONTAGE_STEPS = 24              # cells
#: what the fairground's ground may be cut from. Never a street, never a cuadra.
LOT_CLASSES = (CLS_MALECON, CLS_BEACH)
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
            if raster.in_bounds(c, r) and raster.at(c, r) in LOT_CLASSES:
                hits += 1
                if first is None:
                    first = d
            d += GRID_CELL
        if hits and (best is None or hits > best[0]):
            best = (hits, nx, ny, first)
    return best


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
    w, h = FERIA_DEF["w"], FERIA_DEF["h"]
    # the lot's centre: half its depth in from the first promenade cell, so the
    # landward edge (where the chinamos are) sits against the sidewalk
    lx = cx + nx * (first + h / 2.0)
    ly = cy + ny * (first + h / 2.0)
    ca, sa = math.cos(ang), math.sin(ang)
    cells = set()
    u = -w / 2.0
    while u <= w / 2.0:
        v = -h / 2.0
        while v <= h / 2.0:
            px = lx + ca * u - sa * v
            py = ly + sa * u + ca * v
            c, r = raster.cell_of(px, py)
            if raster.in_bounds(c, r) and raster.at(c, r) in LOT_CLASSES:
                raster.set(c, r, CLS_BARRO)
                cells.add((c, r))
            v += GRID_CELL / 2.0
        u += GRID_CELL / 2.0
    if not cells:
        warn("feria", "the campo ferial's rect covered no promenade — not placed")
        return None, None, None
    # LA ENTRADA DEL CAMPO FERIAL. The promenade around the lot is a wall now,
    # so without this the fairground is a perfectly good piece of drivable earth
    # that nothing can reach — an island, and the kind the reachability gate
    # does not flag because a ride is not a POI. So the lot gets a way in for
    # the same reason a kiosk gets its calle auxiliar: a place you cannot enter
    # is scenery. Stamped as earth, not asphalt — it is the gap in the fence the
    # trucks come through, not a street.
    gate = nearest_cell(raster, lx - nx * (h / 2.0), ly - ny * (h / 2.0),
                        (CLS_ROAD,), 40)
    if gate:
        raster.stamp_polyline(
            [lx - nx * (h / 2.0 - GRID_CELL), ly - ny * (h / 2.0 - GRID_CELL),
             gate[0], gate[1]], 1.4 * 20, CLS_BARRO)
        for c, r0 in _line_cells(raster, lx, ly, gate[0], gate[1]):
            cells.add((c, r0))
        log("feria", f"entrada del campo ferial -> calle "
            f"({round(gate[0])},{round(gate[1])})")
    else:
        warn("feria", "the campo ferial has no street within 160px — no way in")
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
        f"{len(cells)} celdas de barro, {len(polys)} contorno(s)")
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
        seat = None
        if spec["kind"] == "dj":
            # THE DJ IS SEATED ON HIS RESTAURANT, NOT ON A COORDINATE, and not
            # in the lot's frame either: he plays on La Takería's own sidewalk,
            # across the promenade from the rides.
            host = _host_building(buildings, spec.get("host"))
            if host:
                xs, ys = host["pts"][0::2], host["pts"][1::2]
                hx, hy = sum(xs) / len(xs), sum(ys) / len(ys)
                street = nearest_cell(raster, hx, hy, (CLS_ROAD,), 40)
                if street:
                    seat = _seat_on_frontage(raster, hx, hy, street)
                if seat is None:
                    warn("feria", f"{spec['id']}: {spec['host']} has no acera frontage; "
                         f"falling back to the authored anchor")
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
        if spec.get("food"):
            rec["food"] = spec["food"]
        out.append(rec)
    log("feria", f"{len(out)}/{len(ATTRACTION_DEFS)} atracciones en el campo ferial "
        f"({sum(1 for a in out if a['kind'] == 'chinamo')} chinamos)")
    return out
