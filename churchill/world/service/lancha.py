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

from ..config import (CLS_BEACH, CLS_LAND, CLS_WATER, GRID_CELL, PLANAR_PX_PER_M,
                      UNITS, px)
from ..content import BEACH_ACCESS_DEFS, LANCHA_DEFS
from ..enums import Surface
from ..logging import log, warn
from .block import outline_polys
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
# Two things fix it, and both are needed. The line is re-derived to ride the
# RIDGE of the water rather than its shortest chord, and the channel it rides
# is DREDGED to a width a boat can be driven down.

#: the clearance the line wants, in px. Below it, a step starts paying.
CHANNEL_HW = 150
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
SEARCH_PAD_PX = 6000

#: how much water the dredge guarantees either side of the line.
DREDGE_HW = CHANNEL_HW
#: the berth and the landing are SHORE ON PURPOSE — leave their aprons alone.
DREDGE_END_PAD = 220

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
#: past this a marked channel stops reading as a channel and starts reading as
#: open water, so the buoys would just vanish off both sides of the screen.
CHANNEL_HW_CAP = 190
#: …and below this it is not a lane, whatever the raster says.
CHANNEL_HW_MIN = 64

#: how far a route point may deviate from the straight line between its
#: neighbours before it is kept. The flood returns a staircase; the boat wants
#: a line.
SIMPLIFY_PX = 60.0

#: how far from the authored anchor we may look for water / for a street.
SNAP_PX = 400.0

#: below this, the street already touches the sand and an access would be a
#: stub of asphalt on a beach nobody was ever kept off.
MIN_ACCESS_PX = 24.0


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


def _stations(route, pitch, span=TANGENT_SPAN):
    """Walk a polyline at UNIFORM arclength: (s, x, y, unit normal to starboard).

    UNIFORM IS THE WHOLE CONTRACT, and getting it wrong is silent. The first
    version stepped `pitch` along each SEGMENT and restarted at every vertex, so
    a segment shorter than the pitch still produced a station and the samples
    came out unevenly spaced — 619 of them for a 14 159 px route at a pitch of
    40, where uniform gives 355. That is fine for the dredge, which only wants
    dense coverage, and quietly fatal for `measure_channel`: the client reads
    the emitted arrays as `hw[s / pitch]`, so a non-uniform array is the right
    numbers at the wrong places, squeezing the whole channel's profile into the
    first half of the route. Nothing would have crashed; the buoys would just
    have been wrong in a way that looks like the world being odd.
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
    #
    # …AND `span=0` ASKS FOR THE LOCAL ONE, which the DREDGE needs. A smoothed
    # normal does not rotate with a tight bend, so consecutive rays go nearly
    # parallel and the OUTSIDE of the bend is left under-painted: dredging with
    # it turned a channel that traced as 201 outline rings into 2 614, i.e. a
    # corridor full of holes, and dropped the measured minimum from 28 px to 16.
    # Sounding wants the smoothed normal; painting wants the one that follows
    # the curve. They are different jobs and this is the switch between them.
    out, s = [], 0.0
    while s <= total + 1e-9:
        x, y = at(s)
        if span > 0:
            bxp, byp = at(s - span)
            fxp, fyp = at(s + span)
            tx, ty = fxp - bxp, fyp - byp
        else:
            i = 1
            while i < len(cum) - 1 and cum[i] < s:
                i += 1
            (ax, ay), (bx, by) = route[i - 1], route[i]
            tx, ty = bx - ax, by - ay
        L = math.hypot(tx, ty)
        tx, ty = (tx / L, ty / L) if L > 1e-9 else (1.0, 0.0)
        out.append((s, x, y, -ty, tx))
        s += pitch
    return out


def dredge_channel(raster, route):
    """Widen the estero along the sailing line to a boat's width. Returns cells.

    THIS CHANGES THE COASTLINE, in a game whose premise is a faithful true-scale
    map, so the argument had better be good. It is this: OSM maps the estuary's
    edge as one `natural=wetland` + `wetland=mangrove` polygon, and the mangrove
    is drawn to the OUTER edge of the intertidal flat, not to the water. The
    channel it leaves in the raster is a thread — measured on the emitted route,
    under 240 px of total corridor for 68 % of the crossing and 80 px through
    the reach off el Centro — where the real main channel of the Estero de
    Puntarenas is something like 120 m of water. So the dredge RESTORES the
    channel rather than inventing one, and everything about it is written to
    keep that true:

      * it only ever converts `CLS_LAND`. Never road, acera, beach, bridge,
        malecón or boulevard — the two aprons at the berth and the landing are
        418 road and 343 acera cells inside its reach, and this is the guard
        that means they cannot be quietly deleted.
      * it works OUTWARD FROM THE SAILING LINE and STOPS at the first thing that
        is neither water nor land. It cannot tunnel through a road into a
        lagoon on the far side, because the road stops the ray.
      * it stops at `DREDGE_HW`, so it widens a channel and never opens a bay.
      * the two ends are left alone: the berth and the landing are shore ON
        PURPOSE and their ramps are stamped on it.

    Runs before `decorate`, which is not an accident: `mangrove_line` re-plants
    the manglar along the FINISHED waterline, so the dredged banks get their
    mangroves for free instead of leaving a raw edge.
    """
    cell = raster.cell
    cells = set()
    total = sum(math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1])
                for i in range(len(route) - 1))
    # HALF A CELL, and the LOCAL normal: the dredge is painting, and a painter
    # wants its strokes to follow the curve and overlap.
    for (s, x, y, nx, ny) in _stations(route, cell / 2.0, span=0):
        if s < DREDGE_END_PAD or s > total - DREDGE_END_PAD:
            continue
        for side in (-1, 1):
            sx, sy = nx * side, ny * side
            d = 0.0
            while d <= DREDGE_HW:
                c, r = raster.cell_of(x + sx * d, y + sy * d)
                if not raster.in_bounds(c, r):
                    break
                v = raster.at(c, r)
                if v == CLS_WATER:
                    d += cell / 2.0
                    continue
                if v != CLS_LAND:
                    break                 # a road, an acera, the playa: stop dead
                raster.set(c, r, CLS_WATER)
                cells.add((c, r))
                d += cell / 2.0
    # …AND CLOSE THE ISLETS. Rays fan apart on the outside of a tight bend, so
    # however finely they are stepped they leave single cells of mangrove
    # standing in the middle of the dug channel — 292 of them on a test bend,
    # and every one is a wall a hull can hit in open water. Fill anything with
    # water on three sides; twice, so a two-cell islet goes as well. The same
    # move `stamp_malecon` makes on its seams, and for the same reason.
    # Iterated: filling one islet can expose the next, and the loop breaks the
    # moment a round adds nothing, so the extra passes are free where the
    # channel is already clean.
    for _round in range(4):
        add = set()
        for (c, r) in cells:
            for nb in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
                if nb in cells or nb in add:
                    continue
                if not raster.in_bounds(*nb) or raster.at(*nb) != CLS_LAND:
                    continue
                # …counting the DIAGONALS too. A cell pinched between two banks
                # corner-to-corner has only two orthogonal wet neighbours and
                # survives a 4-neighbour test for ever; it is still a rock in
                # the fairway. Six of eight is "surrounded by water".
                wet = sum(1 for q in ((nb[0] + 1, nb[1]), (nb[0] - 1, nb[1]),
                                      (nb[0], nb[1] + 1), (nb[0], nb[1] - 1),
                                      (nb[0] + 1, nb[1] + 1), (nb[0] + 1, nb[1] - 1),
                                      (nb[0] - 1, nb[1] + 1), (nb[0] - 1, nb[1] - 1))
                          if raster.in_bounds(*q) and raster.at(*q) == CLS_WATER)
                if wet >= 6:
                    add.add(nb)
        if not add:
            break
        for nb in add:
            raster.set(nb[0], nb[1], CLS_WATER)
            cells.add(nb)
    return cells


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
    """
    stations = _stations(route, CHANNEL_PITCH)
    # 1. where the water centres, from the polyline
    off_raw = []
    for (_s, x, y, nx, ny) in stations:
        dl = _water_run(raster, x, y, -nx, -ny)
        dr = _water_run(raster, x, y, nx, ny)
        off_raw.append((dr - dl) / 2.0)
    off = _smooth(off_raw)
    # 2. what is really there about the SMOOTHED centre — this is the ceiling
    room = []
    for i, (_s, x, y, nx, ny) in enumerate(stations):
        cx, cy = x + nx * off[i], y + ny * off[i]
        dl = _water_run(raster, cx, cy, -nx, -ny)
        dr = _water_run(raster, cx, cy, nx, ny)
        room.append(min(min(dl, dr), float(CHANNEL_HW_CAP)))
    # 3. smooth the width for a lane that reads as a lane, then clamp it back
    #    under the ceiling so no sample can claim water it does not have
    hw = [min(s, int(room[i])) for i, s in enumerate(_smooth(room))]
    return hw, off


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
        # THREE PASSES, AND THE THIRD IS NOT REDUNDANT. The first finds the best
        # ridge through the estuary AS MAPPED; the dredge then opens the water
        # that ridge had to squeeze past; and the third re-derives on the widened
        # raster, which both straightens the line and — the part that matters —
        # means `measure_channel` is measuring the water the PLAYER will meet
        # rather than the water the router had to work around.
        route = water_route(ctx.raster, berth, landing)
        if route is None or len(route) < 2:
            warn("lancha", f"{spec['id']}: no navigable water from the berth to the landing")
            continue
        dug = dredge_channel(ctx.raster, route)
        if dug:
            # THE DRAWN COAST HAS TO AGREE WITH THE RASTER, and it does not get
            # there by itself. `trace_land_contours` runs in `rasterise_surface`,
            # the SECOND pipeline stage — long before this one — so the land
            # silhouette the renderer paints as its base was traced from the
            # estuary as mapped, and the channel we just opened would be sailed
            # over PAINTED LAND. This is the same trap `reclaim_shore` documents
            # ("trace_land_contours must run AFTER it, or the drawn silhouette
            # keeps the drowned coast"), reached from the other direction.
            #
            # Rather than re-scan 250 M cells for a corridor we already know the
            # shape of, the dredge follows the BALNEARIO PRECEDENT: stamp the
            # water AND emit its outline, so the renderer paints it over the
            # stale silhouette. Every ring, because a dredge along a bending
            # channel leaves islands behind.
            rings = outline_polys(dug, GRID_CELL)
            ctx.waters.extend(rings)
            log("lancha", f"{spec['id']}: canal dragado — {len(dug)} celdas "
                f"({len(dug) * GRID_CELL * GRID_CELL / 1e6:.2f} Mpx²) de manglar "
                f"abiertas a {DREDGE_HW}px de media caña, {len(rings)} contorno(s)")
            route = water_route(ctx.raster, berth, landing) or route
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
            target = nearest_cell(px, py, 260)
            if not target:
                warn("lancha", f"{spec['id']}: no street near the {label}")
                continue
            _apron(ctx, f"ramp_{spec['id']}_{label}", f"{spec['name']} — {label}",
                   px, py, target[0], target[1], 2.0 * (deck[1] / 2))
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
               x, y, target[0], target[1], spec.get("w", 30),
               style="malecon", surface=Surface.ROAD)
        log("beach", f"{spec['id']}: sand ({round(x)},{round(y)}) -> street "
            f"({round(target[0])},{round(target[1])}), {round(gap)}px")
