"""Las atracciones del malecón: the turno on the sea front.

A malecón with paving, palms and people is a place; a malecón with a carrusel
turning on it is a place you go TO. These are the mechanical rides — carrusel,
rueda de chicago, chocones, tómbola — plus the one that is not mechanical at
all: the DJ set up outside La Takería.

Three decisions worth keeping:

* THEY ARE ANCHORED IN GEO, LIKE EVERY OTHER POI. A px anchor on this coast is
  a thing that survives exactly until the next rescale (see FARO_ESP_R_M for the
  last one that did not). What the def says is where the ride stands in the
  world; where the promenade happens to be that build is the snap's problem.
* THEY ARE NOT STAMPED AS WALLS. The band is 60 px deep and it is the ONLY way
  the two Paseo kiosks are reached — a 40 px carrusel stamped blocking cuts the
  promenade in half and takes a delivery target off the network with it. So an
  attraction is scenery you drive around, exactly like a vendor's cart or a
  parada, and the renderer draws it standing on ground the car may cross.
* THE DJ IS SEATED ON HIS RESTAURANT, NOT ON A COORDINATE. `La Takería` is a
  real named OSM building (way 914868373) on the north side of the Paseo, and a
  DJ set up "in front of" it means on its frontage — so the seat is the acera
  nearest the midpoint between the building and its street. Move the restaurant
  in OSM and the booth follows it.
"""
from ..config import CLS_ACERA, CLS_MALECON, CLS_ROAD, GRID_CELL
from ..content import ATTRACTION_DEFS
from ..logging import log, warn
from .placement import nearest_cell

#: How far from its anchor a ride may be moved to find promenade to stand on.
SNAP_CELLS = 60                     # 240 px
#: …and how far the DJ's booth may look off his restaurant for a sidewalk.
FRONTAGE_STEPS = 24              # cells


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


def place_attractions(ctx, project_ll, buildings):
    """Seat every authored attraction and return the records the client draws."""
    raster = ctx.raster
    out = []
    for spec in ATTRACTION_DEFS:
        ax, ay = project_ll(*spec["at"])
        seat = None
        if spec["kind"] == "dj":
            host = next((b for b in buildings
                         if (b.get("name") or "").lower() == spec.get("host", "").lower()), None)
            if host:
                xs, ys = host["pts"][0::2], host["pts"][1::2]
                cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
                street = nearest_cell(raster, cx, cy, (CLS_ROAD,), 40)
                if street:
                    seat = _seat_on_frontage(raster, cx, cy, street)
                if seat is None:
                    warn("feria", f"{spec['id']}: {spec['host']} has no acera frontage; "
                         f"falling back to the authored anchor")
            else:
                warn("feria", f"{spec['id']}: no building named {spec.get('host')!r}")
        if seat is None and spec["kind"] != "dj":
            spot = nearest_cell(raster, ax, ay, (CLS_MALECON,), SNAP_CELLS)
            if spot is None:
                warn("feria", f"{spec['id']}: no malecón within "
                     f"{SNAP_CELLS * GRID_CELL}px of its anchor — not placed")
                continue
            seat = spot
        if seat is None:
            seat = (ax, ay)
        out.append({"id": spec["id"], "name": spec["name"], "kind": spec["kind"],
                    "x": round(seat[0]), "y": round(seat[1]),
                    "r": spec.get("r", 24)})
        log("feria", f"{spec['id']:<10} {spec['kind']:<9} at "
            f"({round(seat[0])},{round(seat[1])}) r={spec.get('r', 24)}")
    log("feria", f"{len(out)}/{len(ATTRACTION_DEFS)} attractions on the sea front")
    return out
