"""Lanchas, and the ways down onto the sand.

Two small things that share one idea: the world already contains places the car
cannot reach, and reaching them is a matter of paving a few metres or sailing a
few kilometres.

THE LANCHA. The two gulf ferries sail out and come back, because the real
crossing ends on the Nicoya side where this world has no shore to arrive at.
The estero has one — Pitahaya, on the north coast — whose streets the build
already emits and which no road on the spit can reach: it is a 160,154-cell
island in the reachability gate. So the lancha is a ONE-WAY crossing that lands
you there, exactly as the real boats out of Puntarenas do.

Only the two ENDS are authored (`LANCHA_DEFS`). THE SAILING LINE IS DERIVED, by
a flood over the water raster, for the reason every derived thing here exists:
a hand-drawn route would cross land the moment the coastline moved, and this
one has to thread an estero that bends twice. The flood runs on a downsampled
grid (one node per 5 cells) because a boat does not need 4-px precision and the
full raster is 158 M cells.

THE BEACH ACCESSES. Sand is drivable — `Surface.DRIVABLE` has always said so —
but a cuadra's acera ring is a wall, so a beach with a sidewalk between it and
the street can be seen and never entered. An access paves a short apron THROUGH
that ring, the same recipe as a kiosk connector, and is emitted as a pier so it
draws as asphalt and can be moved in the editor afterwards.
"""
import math
from collections import deque
from heapq import heappop, heappush

from ..config import (CLS_BEACH, CLS_WATER, GRID_CELL, PLANAR_PX_PER_M,
                      UNITS, px)
# `px` under a second name, because the two apron loops below bind `px, py` as
# a POINT and shadow it. The module-level constants above are evaluated before
# that ever happens, so they keep the short name; inside those loops the metre
# conversion has to be called something else or it is a point, not a function.
from ..config import px as to_px
from ..content import APRON_DEFS, BEACH_ACCESS_DEFS, LANCHA_DEFS
from ..enums import Surface
from ..logging import log, warn
from .pier import log_pier, make_pier, stamp as stamp_pier

#: nodes per raster cell in the water flood. 5 cells = 20 px: fine enough to
#: find a channel, coarse enough to keep the search under a second.
WATER_STEP = 5

# ---- the channel ------------------------------------------------------------
# THE ROUTE USED TO BE A SHORTEST PATH, AND A SHORTEST PATH HUGS EVERY INSIDE
# CORNER. Measured on the line it produced: the corridor is under 240 px wide
# for 68 % of the crossing, drops to 80 px through the reach off el Centro, and
# at four sample points the perpendicular water half-width on one side is ZERO —
# the centreline was ON the mangrove. To a hull every non-water cell is a wall,
# so that is not a scenic narrow bit, it is 5,7 km of scraping; and the game's
# 105 px marked half-width put 48 % of its buoys on dry land.
#
# The line is re-derived to ride the RIDGE of the water rather than its shortest
# chord.  The surface stage opens the estuary basin before this service runs, so
# routing measures faithful open water instead of manufacturing a late channel.

#: the clearance the line wants, in px. Below it, a step starts paying.
#: Las recetas de las dos piezas derivadas que este servicio emite. Su LARGO no
#: se autora —van de una cosa a otra que el build ubicó— y el ancho de la rampa
#: sale de la lancha misma; ver `content/world/piers.json`.
_LANCHA_RAMP = APRON_DEFS["lanchaRamp"]
_BAJADA = APRON_DEFS["bajada"]

CHANNEL_HW = px(UNITS["world"]["lancha"]["clearanceM"])
#: …and how hard. The penalty is SQUARED, which is the whole character of the
#: search: at 90 % of the wanted clearance a step costs ~1.06 and the route
#: still takes the short way through the wide reaches, but squeezing past a
#: mangrove point at 30 % costs ~3.9 and it will sail 300 px around instead.
#: A max-min BOTTLENECK search is the other classic answer and it is wrong here:
#: the estero has one unavoidable narrows, so maximising the worst node
#: degenerates to "any path" and expresses no preference among the hundreds that
#: share it.
CLEARANCE_WEIGHT = 6.0
#: clearance is only computed this far out — past it every node is equally
#: "open water" as far as the cost function cares, and stopping early is what
#: keeps the distance transform off the whole gulf.
CLEAR_CAP_NODES = 10
#: a simplified polyline must keep at least this much water on both sides. Two
#: nodes = 40 px, which is where `_navigable`'s old "…or any 4-neighbour is
#: water" used to pass a node that was itself dry.
CLEAR_FLOOR_NODES = 2
#: the search is confined to the two ends' bbox grown by this, so the ridge
#: Dijkstra does not price the entire Gulf of Nicoya. Falls back to unbounded.
SEARCH_PAD_PX = px(UNITS["world"]["lancha"]["searchPadM"])

#: LA LANCHA, in px, derived from her real size. She is a much smaller boat
#: than the gulf ferries and these were a bare `(86, 34)` / `20` that nothing
#: else in the build or the client knew about — the fourth copy of a contract
#: `world-units.json` exists to hold once.
LANCHA_DECK = (px(UNITS["vessels"]["lancha"]["deckLengthM"]),
               px(UNITS["vessels"]["lancha"]["deckWidthM"]))
LANCHA_DOCK_S = px(UNITS["vessels"]["lancha"]["dockOffsetM"])

#: px of arclength between the emitted channel samples. Emitted as
#: `channel.pitch`, because `laneAt` in the client divides by it — see
#: `world-units.json` -> `channel`.
CHANNEL_PITCH = px(UNITS["channel"]["pitchM"])
#: how far either side of a station the tangent is measured over. Big enough to
#: average out the derived route's ~23 px segments, small enough to still follow
#: a real bend. See `_stations`. NOT emitted: the client measures its own
#: heading over the same span, so the two read the file rather than each other.
TANGENT_SPAN = float(px(UNITS["channel"]["tangentSpanM"]))
#: box filter over the emitted arrays, in samples. One mangrove clump must not
#: put a kink in the marked lane.
CHANNEL_SMOOTH = 5
#: Past the cap a marked channel stops reading as a channel and the buoys leave
#: both sides of the SCREEN; below the floor the two marks sit on top of each
#: other. Those are statements about the VIEW.
#:
#: Y POR ESO SON METROS, QUE ES LO CONTRARIO DE LO QUE DECÍA AQUÍ. Estaban
#: fijados en px «porque la cámara encuadra un número fijo de metros, así que el
#: px es lo que los sostiene» — y es justo al revés: `camera.viewWidthM` son 160
#: metros, y cuántos PÍXELES son esos 160 metros depende de la escala. Al pasar
#: de 2.5 a 3.125 px/m el encuadre pasó de 400 a 500 px, así que un tope de 190
#: px se encogió de la mitad del ancho de pantalla a un 38 % sin que nadie lo
#: decidiera. Lo que se sostiene entre reescalados es la fracción de la vista, o
#: sea el metraje. Al 2.5 de siempre dan exactamente los 190 y 64 que eran.
CHANNEL_HW_CAP = to_px(76.0)
CHANNEL_HW_MIN = to_px(25.6)

#: how far a route point may deviate from the straight line between its
#: neighbours before it is kept. The flood returns a staircase; the boat wants
#: a line.
SIMPLIFY_PX = float(px(UNITS["world"]["lancha"]["simplifyM"]))

#: how far from the authored anchor we may look for water / for a street.
SNAP_PX = float(px(UNITS["world"]["lancha"]["snapM"]))

#: below this, the street already touches the sand and an access would be a
#: stub of asphalt on a beach nobody was ever kept off.
MIN_ACCESS_PX = float(px(UNITS["world"]["lancha"]["minAccessM"]))


def _water_mask(raster):
    """A downsampled bitmap of navigable water."""
    cols = raster.cols // WATER_STEP + 1
    rows = raster.rows // WATER_STEP + 1
    mask = bytearray(cols * rows)
    buf, rcols = raster.buf, raster.cols
    for r in range(0, raster.rows, WATER_STEP):
        base = r * rcols
        out = (r // WATER_STEP) * cols
        for c in range(0, raster.cols, WATER_STEP):
            if buf[base + c] == CLS_WATER:
                mask[out + c // WATER_STEP] = 1
    return mask, cols, rows


def _nearest_water(mask, cols, rows, cx, cy):
    """The nearest navigable node to a point, in ring order so the result does
    not depend on iteration order."""
    for radius in range(0, int(SNAP_PX / (GRID_CELL * WATER_STEP)) + 1):
        best = None
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                if max(abs(dr), abs(dc)) != radius:
                    continue
                r, c = cy + dr, cx + dc
                if 0 <= r < rows and 0 <= c < cols and mask[r * cols + c]:
                    d = dr * dr + dc * dc
                    if best is None or d < best[0] or (d == best[0] and (r, c) < best[1:]):
                        best = (d, r, c)
        if best:
            return best[1], best[2]
    return None


def _simplify(points, tolerance=SIMPLIFY_PX):
    """Douglas-Peucker: keep the points the LINE cannot do without.

    The local version of this test — is each point near the chord between its
    neighbours — collapsed a 7 km estero crossing into a single straight leg
    over the mangroves, because every point of a gentle curve passes it. The
    deviation has to be measured against the whole span being replaced.
    """
    if len(points) < 3:
        return list(points)
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    worst, at = -1.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if length:
            d = abs((px - ax) * dy - (py - ay) * dx) / length
        else:
            d = math.hypot(px - ax, py - ay)
        if d > worst:
            worst, at = d, i
    if worst <= tolerance:
        return [points[0], points[-1]]
    return _simplify(points[:at + 1], tolerance)[:-1] + _simplify(points[at:], tolerance)


def _clearance(mask, cols, rows):
    """Distance in nodes from each water node to the nearest bank, capped.

    A bounded multi-source BFS inward from every water node that touches dry
    ground. Bounded because the cost function stops caring past `CLEAR_CAP_NODES`
    and the alternative is a distance transform of the entire Gulf of Nicoya:
    unreached water is open water and simply reports the cap.
    """
    clear = bytearray([CLEAR_CAP_NODES]) * (cols * rows)
    q = deque()
    for r in range(rows):
        base = r * cols
        for c in range(cols):
            i = base + c
            if not mask[i]:
                clear[i] = 0
                continue
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, nr = c + dc, r + dr
                if not (0 <= nr < rows and 0 <= nc < cols) or not mask[nr * cols + nc]:
                    clear[i] = 1
                    q.append(i)
                    break
    while q:
        i = q.popleft()
        d = clear[i]
        if d >= CLEAR_CAP_NODES:
            continue
        r, c = divmod(i, cols)
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nc, nr = c + dc, r + dr
            if not (0 <= nr < rows and 0 <= nc < cols):
                continue
            j = nr * cols + nc
            if mask[j] and clear[j] > d + 1:
                clear[j] = d + 1
                q.append(j)
    return clear


def _ridge_path(mask, clear, cols, rows, s_i, g_i, bounds=None):
    """The cheapest line from `s_i` to `g_i` under the clearance penalty.

    Dijkstra rather than the old BFS, because the thing being minimised is no
    longer length. Deterministic: the cost is a pure function of the mask, and
    the heap is ordered on `(cost, node)` so ties break on node index.
    """
    want = float(CHANNEL_HW) / (GRID_CELL * WATER_STEP)
    best = {s_i: 0.0}
    prev = {s_i: -1}
    heap = [(0.0, s_i)]
    seen = set()
    c0 = r0 = 0
    c1, r1 = cols - 1, rows - 1
    if bounds:
        c0, r0, c1, r1 = bounds
    while heap:
        cost, i = heappop(heap)
        if i in seen:
            continue
        seen.add(i)
        if i == g_i:
            break
        r, c = divmod(i, cols)
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1),
                       (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nc, nr = c + dc, r + dr
            if not (r0 <= nr <= r1 and c0 <= nc <= c1):
                continue
            j = nr * cols + nc
            if j in seen or not mask[j]:
                continue
            short = max(0.0, (want - clear[j]) / want)
            step = 1.0 if (dc == 0 or dr == 0) else 1.41421356
            nxt = cost + step * (1.0 + CLEARANCE_WEIGHT * short * short)
            if nxt < best.get(j, float("inf")):
                best[j] = nxt
                prev[j] = i
                heappush(heap, (nxt, j))
    if g_i not in prev:
        return None
    path, i = [], g_i
    while i != -1:
        r, c = divmod(i, cols)
        path.append((c * GRID_CELL * WATER_STEP, r * GRID_CELL * WATER_STEP))
        i = prev[i]
    path.reverse()
    return path


def water_route(raster, start, goal):
    """The navigable line from `start` to `goal` that keeps the most water, or None.

    Deterministic: the mask, the clearance transform and the search's tie-break
    are all pure functions of the raster.
    """
    mask, cols, rows = _water_mask(raster)
    step = GRID_CELL * WATER_STEP
    s = _nearest_water(mask, cols, rows, int(start[0]) // step, int(start[1]) // step)
    g = _nearest_water(mask, cols, rows, int(goal[0]) // step, int(goal[1]) // step)
    if s is None or g is None:
        return None
    s_i, g_i = s[0] * cols + s[1], g[0] * cols + g[1]
    clear = _clearance(mask, cols, rows)
    pad = int(SEARCH_PAD_PX / step)
    box = (max(0, min(s[1], g[1]) - pad), max(0, min(s[0], g[0]) - pad),
           min(cols - 1, max(s[1], g[1]) + pad), min(rows - 1, max(s[0], g[0]) + pad))
    path = _ridge_path(mask, clear, cols, rows, s_i, g_i, box)
    if path is None:                    # the corridor left the box: pay for it all
        path = _ridge_path(mask, clear, cols, rows, s_i, g_i, None)
    if path is None:
        return None
    # The ends are the AUTHORED points, not the snapped nodes: the boat has to
    # lie alongside the berth she is drawn at.
    path[0], path[-1] = (float(start[0]), float(start[1])), (float(goal[0]), float(goal[1]))
    # SIMPLIFY, THEN PROVE IT. Douglas-Peucker may move the line up to
    # `tolerance` off the traced path, which over an estero is enough to cut the
    # corner across a headland — and a boat that sails over the mangroves is
    # worse than a boat with forty waypoints. Tighten until the line is water.
    tolerance = SIMPLIFY_PX
    while tolerance >= 5:
        line = _simplify(path, tolerance)
        if _all_navigable(mask, clear, cols, rows, line, step):
            return line
        tolerance /= 2
    return path


def _all_navigable(mask, clear, cols, rows, line, step):
    """Does this polyline keep real water on both sides the whole way?"""
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]
        length = math.hypot(bx - ax, by - ay)
        for k in range(int(length / (step / 2)) + 1):
            t = k / max(1, int(length / (step / 2)))
            c = int((ax + (bx - ax) * t) / step)
            r = int((ay + (by - ay) * t) / step)
            # the two ENDS are the berth and the landing: they are on the shore
            # on purpose, so a node at either end is allowed to be dry
            if (i == 0 and k <= 1) or (i == len(line) - 2 and t > 0.98):
                continue
            if not _has_clearance(mask, clear, cols, rows, c, r):
                return False
    return True


def _has_clearance(mask, clear, cols, rows, c, r):
    """Is this node water, with `CLEAR_FLOOR_NODES` of water around it?

    THIS REPLACES A TEST THAT ACCEPTED A DRY NODE. `_navigable` used to pass if
    the node OR ANY OF ITS FOUR NEIGHBOURS was water — forgiveness added because
    the diagonal flood could clip the corner of a dry node, and a strict test
    made every tolerance fail and left the crossing with 500 waypoints. It is
    also the precise licence under which the emitted centreline came to run
    ALONG the mangrove: one dry node beside one wet one passed.
    The forgiveness is no longer needed, because the ridge search does not go
    near the bank in the first place — so the check can ask for what the boat
    actually needs, which is water on both sides.
    """
    if not (0 <= r < rows and 0 <= c < cols):
        return False
    i = r * cols + c
    return bool(mask[i]) and clear[i] >= CLEAR_FLOOR_NODES


def _stations(route, pitch):
    """Walk a polyline at UNIFORM arclength: (s, x, y, unit normal to starboard).

    UNIFORM IS THE WHOLE CONTRACT, and getting it wrong is silent. The first
    version stepped `pitch` along each SEGMENT and restarted at every vertex, so
    a segment shorter than the pitch still produced a station and the samples
    came out unevenly spaced — 619 of them for a 14 159 px route at a pitch of
    40, where uniform gives 355. Dense coverage hid the mistake, but it is
    quietly fatal for `measure_channel`: the client reads the emitted arrays as
    `hw[s / pitch]`, so a non-uniform array is the right numbers at the wrong
    places, squeezing the whole channel's profile into the first half of the
    route. Nothing would have crashed; the buoys would just have been wrong in
    a way that looks like the world being odd.
    """
    if len(route) < 2:
        return []
    cum = [0.0]
    for i in range(len(route) - 1):
        (ax, ay), (bx, by) = route[i], route[i + 1]
        cum.append(cum[-1] + math.hypot(bx - ax, by - ay))
    total = cum[-1]

    def at(u):
        u = min(max(u, 0.0), total)
        i = 1
        while i < len(cum) - 1 and cum[i] < u:
            i += 1
        (ax, ay), (bx, by) = route[i - 1], route[i]
        L = cum[i] - cum[i - 1]
        k = (u - cum[i - 1]) / L if L > 1e-9 else 0.0
        return ax + (bx - ax) * k, ay + (by - ay) * k

    # THE NORMAL COMES FROM A SMOOTHED TANGENT, and this is not a nicety.
    # The derived route has ~23 px between points, so the direction of the one
    # segment a station happens to fall on is noisy — and a ray cast along a
    # normal that is a few degrees out runs DOWN the channel instead of across
    # it and comes back with a width the estero does not have. Measured: at
    # s=5260 that reported 144 px of water between two stations that correctly
    # reported 44 and 40, and it put a gate mark on the mangrove.
    # Taking the chord over +/- TANGENT_SPAN averages the wobble out.
    out, s = [], 0.0
    while s <= total + 1e-9:
        x, y = at(s)
        bxp, byp = at(s - TANGENT_SPAN)
        fxp, fyp = at(s + TANGENT_SPAN)
        tx, ty = fxp - bxp, fyp - byp
        L = math.hypot(tx, ty)
        tx, ty = (tx / L, ty / L) if L > 1e-9 else (1.0, 0.0)
        out.append((s, x, y, -ty, tx))
        s += pitch
    return out


def _water_run(raster, x, y, nx, ny, cap=600):
    """How far the water reaches from (x, y) along (nx, ny), in px.

    THE LAST WET DISTANCE, not the first dry one. The walk stops ON the cell
    that ended the water, so returning `d` describes a point that is already
    ashore — and a buoy placed at exactly that half-width stands on it. One
    cell of difference, and it put half the marks of a narrow reach on land.
    """
    cell = raster.cell
    d = 0.0
    while d <= cap:
        c, r = raster.cell_of(x + nx * d, y + ny * d)
        if not raster.in_bounds(c, r) or raster.at(c, r) != CLS_WATER:
            break
        d += cell
    return max(0.0, d - cell)


def measure_channel(raster, route):
    """The navigable half-width and the water's centre, every `CHANNEL_PITCH` px.

    This is the number the game had to guess and got wrong, and it takes THREE
    passes to be honest rather than the obvious one.

    The obvious version measures the water either side of the polyline, calls
    the average the half-width and the difference the offset, and smooths both.
    That is right on a straight reach and wrong on a bend, because smoothing
    `hw` and `off` INDEPENDENTLY lets the smoothed lane drift off the water it
    was measured from: it shipped seven buoys standing on mangrove at 34 %,
    42 %, 45 % and 84-87 % of the route, each one claiming 90-120 px of channel
    where the estero does not have it.

    So: measure, smooth the CENTRE, then re-measure about that smoothed centre
    and let the smoothed width be clamped by what is actually there. Smoothing
    can round a width DOWN but never invent water.

    …AND IT MAY NOT COST WATER EITHER, which is the other half of the same rule
    and was missing. Clamping `hw` under the re-measured `room` makes a drifted
    centre HONEST, not USABLE: on the bend at (25708, 10032) the box filter
    pulled the centre 85 px to port — off a run that only reached 48 px that way
    — so the station truthfully reported a half-width of 0 and the lane vanished
    where the estuary is 200 px wide. Two samples of 355, and they are what kept
    `smoke:crossing` red after the basin opened.

    A station therefore keeps the smoothed centre only while it leaves as much
    water as its OWN measurement already offered; where it does not, the raw
    centre — the middle of the water actually there — wins. Isolated stations
    fall back, so the lane still reads smooth, and no station can be made worse
    by the filter than it was without it.
    """
    stations = _stations(route, CHANNEL_PITCH)
    # 1. where the water centres, from the polyline
    off_raw = []
    room_raw = []
    for (_s, x, y, nx, ny) in stations:
        dl = _water_run(raster, x, y, -nx, -ny)
        dr = _water_run(raster, x, y, nx, ny)
        off_raw.append((dr - dl) / 2.0)
        # the raw centre sits mid-run, so this is what that centre would give
        room_raw.append(min((dl + dr) / 2.0, float(CHANNEL_HW_CAP)))
    off = _smooth(off_raw)
    # 2. what is really there about the SMOOTHED centre — this is the ceiling,
    #    and where the filter has cost water the station takes its raw centre back
    room = []
    for i, (_s, x, y, nx, ny) in enumerate(stations):
        cx, cy = x + nx * off[i], y + ny * off[i]
        dl = _water_run(raster, cx, cy, -nx, -ny)
        dr = _water_run(raster, cx, cy, nx, ny)
        have = min(min(dl, dr), float(CHANNEL_HW_CAP))
        keep = min(room_raw[i], float(CHANNEL_HW_MIN))
        if have < keep:
            off[i] = int(round(off_raw[i]))
            cx, cy = x + nx * off[i], y + ny * off[i]
            dl = _water_run(raster, cx, cy, -nx, -ny)
            dr = _water_run(raster, cx, cy, nx, ny)
            have = min(min(dl, dr), float(CHANNEL_HW_CAP))
        room.append(have)
    # 2b. UNA ESTACIÓN QUE NO SE PUDO SONDEAR NO ES UNA SONDA DE CERO.
    #
    # `_water_run` empieza a caminar EN la celda de la estación, así que si esa
    # celda no es agua devuelve 0 hacia los dos lados y el canal "se cierra" ahí.
    # Pasa en un sitio concreto y por una razón conocida: la ruta arranca en la
    # punta del muelle, y `raster_stamp_polyline` le pone al muelle una tapa
    # redonda de `w/2` MÁS ALLÁ de su último punto (ver CLAUDE.md, «collision-vs-
    # visual alignment gotchas»), de modo que la primera estación cae sobre la
    # cubierta. Medido en el Pitahaya: `hw[0]` = 0 con agua abierta a 15 px por
    # los dos lados, y `smoke:crossing` en rojo por «el canal se cierra a 0px».
    #
    # Un cero así no es una medición, es un hueco — la misma distinción que el
    # resto de esta función ya hace con el filtro. Se rellena con la vecina
    # sondeable más cercana, que es lo que de verdad hay al lado.
    dry = [i for i, (_s, x, y, _nx, _ny) in enumerate(stations)
           if _cell_is_water(raster, x, y) is False]
    for i in dry:
        j = next((k for k in range(i + 1, len(stations)) if k not in dry), None)
        if j is None:
            j = next((k for k in range(i - 1, -1, -1) if k not in dry), None)
        if j is None:
            continue
        room[i] = room[j]
        off[i] = off[j]
    if dry:
        log("lancha", f"{len(dry)} estación(es) sobre estructura, no sobre agua "
                      f"(la punta del muelle) — heredan la sonda de al lado")
    # 3. smooth the width for a lane that reads as a lane, then clamp it back
    #    under the ceiling so no sample can claim water it does not have
    hw = [min(s, int(room[i])) for i, s in enumerate(_smooth(room))]
    return hw, off


def _cell_is_water(raster, x, y):
    """Is the station's OWN cell water? `None` if it is off the raster."""
    c, r = raster.cell_of(x, y)
    if not raster.in_bounds(c, r):
        return None
    return raster.at(c, r) == CLS_WATER


def _smooth(vals, win=CHANNEL_SMOOTH):
    """Box filter, so one mangrove clump cannot put a kink in the marked lane."""
    if len(vals) < win:
        return [int(round(v)) for v in vals]
    half = win // 2
    out = []
    for i in range(len(vals)):
        a = max(0, i - half)
        b = min(len(vals), i + half + 1)
        out.append(int(round(sum(vals[a:b]) / (b - a))))
    return out


def _nearest_class(raster, x, y, wanted, reach=SNAP_PX):
    """The nearest cell centre of a given surface class, searched in rings so
    the answer does not depend on iteration order."""
    cell = raster.cell
    c0, r0 = raster.cell_of(x, y)
    for radius in range(0, int(reach / cell) + 1):
        best = None
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                if max(abs(dr), abs(dc)) != radius:
                    continue
                c, r = c0 + dc, r0 + dr
                if raster.in_bounds(c, r) and raster.at(c, r) == wanted:
                    d = dr * dr + dc * dc
                    if best is None or d < best[0] or (d == best[0] and (r, c) < best[1:]):
                        best = (d, r, c)
        if best:
            return ((best[2] + 0.5) * cell, (best[1] + 0.5) * cell)
    return None


def _apron(ctx, pier_id, name, x0, y0, x1, y1, width,
           style="apron", surface=Surface.ROAD):
    """A short paved deck between two points, stamped and emitted as a pier."""
    pier = make_pier(pier_id, name, [x0, y0, x1, y1], width,
                     style=style, surface=surface, sea_end=None)
    ctx.piers.append(pier)
    ctx.pier_restores[pier["id"]] = stamp_pier(ctx.raster, pier)
    log_pier(pier)
    return pier


def _shoreline(raster, x, y):
    """The nearest water cell to an authored anchor — where a hull can float."""
    return _nearest_class(raster, x, y, CLS_WATER)


def place_lanchas(ctx, project_ll, nearest_cell):
    """Berth, land and route each authored lancha; ramp ends without a pier."""
    for spec in LANCHA_DEFS:
        # A named berth pier already ends in the water and already connects to
        # the street. Otherwise the authored anchor snaps to the water's edge:
        # an anchor twenty metres inland puts the deck on sand, while the boat
        # has to lie alongside the shoreline.
        berth_pier_id = spec.get("berth_pier")
        if berth_pier_id:
            berth_pier = next((p for p in ctx.piers if p["id"] == berth_pier_id), None)
            if berth_pier is None:
                warn("lancha", f"{spec['id']}: berth pier {berth_pier_id} not found")
                continue
            sea_end = berth_pier.get("seaEnd", "last")
            if sea_end == "last":
                berth = tuple(berth_pier["pts"][-2:])
            elif sea_end == "first":
                berth = tuple(berth_pier["pts"][:2])
            else:
                warn("lancha", f"{spec['id']}: berth pier {berth_pier_id} has no sea end")
                continue
        else:
            berth = _shoreline(ctx.raster, *project_ll(*spec["berth"]))
        landing = _shoreline(ctx.raster, *project_ll(*spec["landing"]))
        if berth is None or landing is None:
            warn("lancha", f"{spec['id']}: berth or landing is nowhere near water")
            continue
        # One derived route over the FINISHED basin.  The surface stage has
        # already opened the estuary before tracing its coastline, so routing
        # and sounding now read exactly the water the player will meet.
        route = water_route(ctx.raster, berth, landing)
        if route is None or len(route) < 2:
            warn("lancha", f"{spec['id']}: no navigable water from the berth to the landing")
            continue
        total = sum(math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1])
                    for i in range(len(route) - 1))
        hw, off = measure_channel(ctx.raster, route)
        tight = sum(1 for v in hw if v < CHANNEL_HW_MIN)
        srt = sorted(hw)
        log("lancha", f"{spec['id']}: canal medido — {len(hw)} muestras cada "
            f"{CHANNEL_PITCH}px, media caña min {srt[0]}px / mediana "
            f"{srt[len(srt) // 2]}px / max {srt[-1]}px")
        if tight:
            warn("lancha", f"{spec['id']}: {tight} muestra(s) bajo "
                 f"{CHANNEL_HW_MIN}px — el canal se cierra ahí")
        ang = math.atan2(route[1][1] - route[0][1], route[1][0] - route[0][0])
        deck = spec.get("deck", LANCHA_DECK)
        ctx.ferries.append({
            "id": spec["id"], "name": spec["name"],
            "berth": [round(berth[0]), round(berth[1])], "ang": round(ang, 4),
            "deck": [int(deck[0]), int(deck[1])], "dockS": int(spec.get("dockS", LANCHA_DOCK_S)),
            "route": [round(v) for p in route for v in p],
            # A CROSSING: she waits at the far shore instead of sailing home, and
            # is never used up, because she is transport rather than a treat.
            "oneWay": True, "speed": int(spec.get("speed", 150)),
            "channel": {"pitch": CHANNEL_PITCH, "hw": hw, "off": off},
        })
        # Both ends need a way onto the street, and the far one needs it most:
        # landing on a beach with no road out is a boat ride to a wall. A berth
        # pier is already its own ramp and connector, so only emit the landing.
        for label, (px, py) in (("berth", berth), ("landing", landing)):
            if label == "berth" and berth_pier_id:
                continue
            target = nearest_cell(px, py, to_px(_LANCHA_RAMP["reachM"]))
            if not target:
                warn("lancha", f"{spec['id']}: no street near the {label}")
                continue
            # THE RAMP'S WIDTH COMES FROM THE BOAT, not from the registry: a
            # ramp narrower than the hull is a ramp nobody can use, and the
            # lancha is already authored. `piers.json` records that it does.
            _apron(ctx, f"ramp_{spec['id']}_{label}", f"{spec['name']} — {label}",
                   px, py, target[0], target[1], 2.0 * (deck[1] / 2),
                   style=_LANCHA_RAMP["style"], surface=_LANCHA_RAMP["surface"])
        # …and the kilometres are divided by the REAL scale. This line said
        # "8.88 km" because it still divided by 1.6 px/m, the scale before the
        # rescale to 2.5 — which is also where `content.py`'s "~7.1 km of estero"
        # and the 225 s time limit reasoned off it came from. It is 5,7 km.
        log("lancha", f"{spec['id']} {round(berth[0])},{round(berth[1])} -> "
            f"{round(landing[0])},{round(landing[1])}: {len(route)} pts, "
            f"{round(total)}px ({total / PLANAR_PX_PER_M / 1000:.2f} km), "
            f"{round(total / spec.get('speed', 150))}s each way")


def place_beach_accesses(ctx, project_ll, nearest_cell):
    """Pave a way through the acera ring onto the sand.

    THE BAJADAS ARE THE WAY IN. Now that the kiosks on the Paseo no longer have
    asphalt lanes stamped across the beach to reach them, these four are the
    only marked ways down to the water — so they are paved as PROMENADE
    (`Surface.MALECON`, drawn in the malecón's own pavers) rather than as the
    grey terminal apron a ferry ramp is. A bajada is a place you walk down, not
    a place a truck reverses onto.
    """
    raster = ctx.raster
    for spec in BEACH_ACCESS_DEFS:
        ax, ay = project_ll(*spec["at"])
        # THE ANCHOR NAMES A PLACE, NOT A CELL. Snapping to the real sand is
        # what makes the def survive a rebuild that moved the coastline by a
        # few metres — an anchor that landed in the water paved a 3 px stub.
        sand = _nearest_class(raster, ax, ay, CLS_BEACH)
        if sand is None:
            warn("beach", f"{spec['id']}: no sand within {int(SNAP_PX)}px of the anchor")
            continue
        x, y = sand
        target = nearest_cell(x, y, 400)
        if not target:
            warn("beach", f"{spec['id']}: no street within 400px of the sand")
            continue
        gap = math.hypot(target[0] - x, target[1] - y)
        if gap < MIN_ACCESS_PX:
            log("beach", f"{spec['id']}: street already reaches the sand "
                f"({round(gap)}px) — no access needed")
            continue
        # STAMPED AS ROAD, DRAWN AS PROMENADE. The surface and the style are
        # separate on a pier for exactly this reason. A bajada was `MALECON`
        # while the promenade was drivable; now that it is not, stamping one as
        # malecón would make the only marked ways down to the sand into walls —
        # which is the precise opposite of what a beach access is for.
        _apron(ctx, f"bajada_{spec['id']}", spec["name"],
               x, y, target[0], target[1], spec.get("w", to_px(_BAJADA["widthM"])),
               style=_BAJADA["style"], surface=_BAJADA["surface"])
        log("beach", f"{spec['id']}: sand ({round(x)},{round(y)}) -> street "
            f"({round(target[0])},{round(target[1])}), {round(gap)}px")
