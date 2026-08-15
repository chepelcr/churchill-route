"""The Puntarenas ferry: two berths and the routes they sail.

Almost none of this is invented. OSM already carries the whole thing at the west
end of the spit, and the build only has to find it and truncate it:

    amenity=ferry_terminal  "Ferry Paquera"          the north berth
    amenity=ferry_terminal  "Ferry a Playa Naranjo"  the south berth
    route=ferry             "Ruta Puntarenas - Paquera"
    route=ferry             "Ruta Puntarenas - Playa Naranjo"

Each berth even has its own named access road already (`Ingreso Ferry Paquera`,
`Ingreso Ferry Playa Naranjo`), so driving down the ingreso and onto the ramp is
the real layout, not a game-ism.

Two things need care.

* A ROUTE MAY BE STORED EITHER WAY ROUND. Paquera's way starts at the terminal
  and heads out; Playa Naranjo's starts on the far shore, outside the world, and
  ends here. So the route is oriented by which END is nearer the berth, never by
  assuming the file's order.
* THE CROSSING IS A SHORT LOOP, not the real 90-minute sailing. The route is cut
  at RIDE_PX of arclength, which is the whole ride: out, turn, back. The rest of
  the real route runs off the map to the Nicoya side, where there is no world to
  arrive at.
"""
import math

from ..config import UNITS, px
from ..logging import log
from .projection import project_way_pts

#: how far out along the real route the ferry sails before turning back (world
#: px). ~1800 px at PLANAR_PX_PER_M 1.6 is a bit over a kilometre of gulf, which
#: at the ferry's speed is a crossing of about 45 s round trip — long enough to
#: read as a trip, short enough that nobody puts the controller down.
RIDE_PX = float(px(UNITS["world"]["ferry"]["rideM"]))

#: The DECK and how far seaward of the OSM berth node she lies alongside. A
#: ferry is a real boat, so her size is in metres (`world-units.json` ->
#: `ferry`) and the px are derived here; the build needs them as well as the
#: client, because the boarding ramp has to reach the STERN at rest and stern
#: position is a function of all three. The client reads them back off the
#: manifest — these are what is emitted, not a second opinion.
_FERRY = UNITS["vessels"]["ferry"]
DECK_L = float(px(_FERRY["deckLengthM"]))
DECK_W = float(px(_FERRY["deckWidthM"]))
DOCK_S = float(px(_FERRY["dockOffsetM"]))

#: OSM names, in the order the berths sit north→south at the terminal
FERRY_DEFS = [
    {"id": "paquera", "name": "Ferry a Paquera",
     "terminal": "ferry paquera", "route": "ruta puntarenas - paquera"},
    {"id": "naranjo", "name": "Ferry a Playa Naranjo",
     "terminal": "ferry a playa naranjo", "route": "ruta puntarenas - playa naranjo"},
]


def _resample(pts, step=24.0):
    """Polyline resampled at a fixed step, so a route's shape does not depend on
    how densely whoever drew it placed nodes."""
    out = [pts[0]]
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        n = int(seg // step)
        for k in range(1, n + 1):
            t = k * step / seg
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def _truncate(pts, limit):
    """The first `limit` px of arclength of a polyline."""
    out, run = [pts[0]], 0.0
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        if run + seg >= limit:
            t = (limit - run) / seg if seg else 0
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
            return out
        out.append((x1, y1))
        run += seg
    return out


def stern_at_rest(ferry):
    """Where the STERN sits when she is alongside — the point the boarding ramp
    has to reach. She lies DOCK_S seaward of the berth node and the stern is
    half a deck astern of that, so it lands (DECK_L/2 - DOCK_S) px LANDWARD of
    the node, not at it. Paving from the node alone left a wall of sand right
    behind the ramp door, which is a ferry you can see and cannot board.
    """
    bx, by = ferry["berth"]
    back = DECK_L / 2 - DOCK_S
    return (bx - math.cos(ferry["ang"]) * back, by - math.sin(ferry["ang"]) * back)


def extract_ferries(sp, ways, pois, canvas_w, canvas_h):
    """[{id, name, berth, ang, route}] — one per FERRY_DEFS entry that resolves.

    `berth` is the ferry_terminal node in world px, `ang` the heading it leaves
    on (radians, from the first leg of its route) and `route` the flat truncated
    sailing line the ferry follows out and back.
    """
    by_name = {}
    for w in ways:
        nm = (w["tags"].get("name") or "").lower()
        if w["tags"].get("route") == "ferry" and nm and len(w.get("pts") or []) >= 2:
            by_name[nm] = w
    terminals = {(p.get("name") or "").lower(): p for p in pois
                 if p.get("cat") == "amenity=ferry_terminal"}

    out = []
    for spec in FERRY_DEFS:
        term = terminals.get(spec["terminal"])
        way = by_name.get(spec["route"])
        if term is None or way is None:
            log("ferry", f"WARN {spec['id']} unresolved "
                f"(terminal={term is not None}, route={way is not None})")
            continue
        pts, _ = project_way_pts(sp, way["pts"])
        bx, by = term["x"], term["y"]
        # ORIENT: the route may be stored from the far shore inwards. Take the
        # end nearer the berth as the start — never the file's order.
        d0 = math.hypot(pts[0][0] - bx, pts[0][1] - by)
        d1 = math.hypot(pts[-1][0] - bx, pts[-1][1] - by)
        if d1 < d0:
            pts = pts[::-1]
        # start AT the berth, so the ferry leaves from where it is drawn
        pts = [(float(bx), float(by))] + [p for p in pts[1:]]
        pts = _truncate(_resample(pts), RIDE_PX)
        if len(pts) < 3:
            log("ferry", f"WARN {spec['id']} route too short after truncation"); continue
        ang = math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])
        total = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
                    for i in range(len(pts) - 1))
        out.append({
            "id": spec["id"], "name": spec["name"],
            "berth": [int(bx), int(by)], "ang": round(ang, 4),
            "deck": [int(DECK_L), int(DECK_W)], "dockS": int(DOCK_S),
            "route": [round(v) for p in pts for v in p],
        })
        log("ferry", f"{spec['id']} berth ({int(bx)},{int(by)}) heading "
            f"{math.degrees(ang):+.1f}° -> {len(pts)} route pts, {round(total)}px out")
    return out
