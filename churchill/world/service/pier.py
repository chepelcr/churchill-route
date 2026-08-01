"""Muelles — a deck the car can drive on, allowed to leave the land.

There are two on this map (the Muelle Nacional off the end of Calle Central and
the wooden jetty at the faro) and until now each was a hardcoded singleton with
its own manifest key and its own copy of the one rule that matters:

    `stamp_polyline` ADDS A ROUND CAP OF RADIUS w/2 PAST THE LAST POINT.

At a free end that cap is drivable cells sitting past the drawn deck — you drive
off the muelle onto the sea and the collider's both-ends-blocked snap-back traps
you there. So the stamped line is pulled back by w/2 at the SEA end and left
alone at the landward end, where the cap simply overlaps the beach it joins.

A pier is a polyline like a road, with a width, a stamped surface class and a
style the renderer draws it in. That makes it authorable: the editor can move
one, extend it, or draw a third.

`stamp` also records what each cell WAS before the deck went down. Nothing is
emitted from that — it exists so the editor patch can move a generated pier
exactly, restoring the water and sand it used to cover instead of leaving a
strip of invisible drivable sea behind.
"""
import math

from ..enums import Surface
from ..logging import log


def make_pier(pier_id, name, pts, w, *, style="concrete", surface=Surface.BRIDGE,
              sea_end="last"):
    """A pier record. `pts` is flat [x, y, x, y, …] in world px.

    `sea_end` names the end that hangs over open water — "last" (the polyline
    runs from the shore out), "first", or None when both ends land.
    """
    return {
        "id": pier_id, "name": name,
        "pts": [round(v) for v in pts], "w": int(w),
        "style": style, "surface": Surface(surface).label,
        "seaEnd": sea_end,
    }


def _shortened(pts, w, sea_end):
    """The polyline with its free end pulled back by w/2, so the stamp's round
    cap stops flush with the drawn deck instead of past it."""
    out = list(pts)
    back = w / 2
    if sea_end == "last" and len(out) >= 4:
        x0, y0, x1, y1 = out[-4], out[-3], out[-2], out[-1]
        length = math.hypot(x1 - x0, y1 - y0) or 1.0
        out[-2] = x1 - (x1 - x0) / length * back
        out[-1] = y1 - (y1 - y0) / length * back
    elif sea_end == "first" and len(out) >= 4:
        x0, y0, x1, y1 = out[0], out[1], out[2], out[3]
        length = math.hypot(x1 - x0, y1 - y0) or 1.0
        out[0] = x0 + (x1 - x0) / length * back
        out[1] = y0 + (y1 - y0) / length * back
    return out


def _covered_cells(raster, pts, w):
    """Every raster cell the stamp will touch, from the polyline's own segments
    plus the round caps `stamp_polyline` leaves at each vertex."""
    cells = set()
    radius = w / 2 + raster.cell
    for i in range(0, len(pts) - 2, 2):
        x0, y0, x1, y1 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        steps = int(math.hypot(x1 - x0, y1 - y0) / (raster.cell / 2)) + 1
        for step in range(steps + 1):
            t = step / steps
            px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            c0, r0 = raster.cell_of(px - radius, py - radius)
            c1, r1 = raster.cell_of(px + radius, py + radius)
            for row in range(r0, r1 + 1):
                for col in range(c0, c1 + 1):
                    if raster.in_bounds(col, row):
                        cells.add((col, row))
    return cells


def stamp(raster, pier):
    """Stamp the deck and return [(col, row, previous_class)] for every cell it
    could have touched — the undo the editor patch needs to move it."""
    pts = _shortened(pier["pts"], pier["w"], pier.get("seaEnd", "last"))
    previous = [(col, row, raster.at(col, row))
                for col, row in sorted(_covered_cells(raster, pts, pier["w"]))]
    raster.stamp_polyline(pts, pier["w"], int(Surface[pier["surface"].upper()]))
    return previous


def restore(raster, previous):
    """Put back what a pier covered. Used only when an edit MOVES one: without
    it the old deck stays drivable, which is a strip of invisible road over open
    water — worse than the wall it replaced."""
    for col, row, cls in previous:
        if cls is not None:
            raster.set(col, row, cls)


def log_pier(pier):
    pts = pier["pts"]
    length = sum(math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1])
                 for i in range(0, len(pts) - 2, 2))
    log("pier", f"{pier['id']:<16} {pier['style']:<8} {len(pts) // 2} pts, "
        f"{round(length)}px long, {pier['w']}px wide")
