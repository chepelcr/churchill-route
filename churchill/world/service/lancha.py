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

from ..config import CLS_BEACH, CLS_WATER, GRID_CELL
from ..content import BEACH_ACCESS_DEFS, LANCHA_DEFS
from ..enums import Surface
from ..logging import log, warn
from .pier import log_pier, make_pier, stamp as stamp_pier

#: nodes per raster cell in the water flood. 5 cells = 20 px: fine enough to
#: find a channel, coarse enough to keep the search under a second.
WATER_STEP = 5

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


def water_route(raster, start, goal):
    """The shortest navigable line from `start` to `goal`, or None.

    Deterministic: the flood visits neighbours in a fixed order and the mask is
    a pure function of the raster.
    """
    mask, cols, rows = _water_mask(raster)
    step = GRID_CELL * WATER_STEP
    s = _nearest_water(mask, cols, rows, int(start[0]) // step, int(start[1]) // step)
    g = _nearest_water(mask, cols, rows, int(goal[0]) // step, int(goal[1]) // step)
    if s is None or g is None:
        return None
    s_i, g_i = s[0] * cols + s[1], g[0] * cols + g[1]
    prev = {s_i: -1}
    queue = deque([s_i])
    while queue:
        i = queue.popleft()
        if i == g_i:
            break
        r, c = divmod(i, cols)
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1),
                       (-1, -1), (-1, 1), (1, -1), (1, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                j = nr * cols + nc
                if j not in prev and mask[j]:
                    prev[j] = i
                    queue.append(j)
    if g_i not in prev:
        return None
    path, i = [], g_i
    while i != -1:
        r, c = divmod(i, cols)
        path.append((c * step, r * step))
        i = prev[i]
    path.reverse()
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
        if _all_navigable(mask, cols, rows, line, step):
            return line
        tolerance /= 2
    return path


def _all_navigable(mask, cols, rows, line, step):
    """Is every point of this polyline over water? Sampled at half a node, so
    nothing narrower than the flood's own resolution slips through."""
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
            if not _navigable(mask, cols, rows, c, r):
                return False
    return True


def _navigable(mask, cols, rows, c, r):
    """Water at this node, or at one of its four neighbours.

    The flood moves DIAGONALLY, so a legal step between two water nodes can
    clip the corner of a dry one. Testing the node alone made every tolerance
    fail and left the crossing with 500 waypoints — the check has to be as
    forgiving as the search that produced the path.
    """
    for dc, dr in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        nc, nr = c + dc, r + dr
        if 0 <= nr < rows and 0 <= nc < cols and mask[nr * cols + nc]:
            return True
    return False


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
        route = water_route(ctx.raster, berth, landing)
        if route is None or len(route) < 2:
            warn("lancha", f"{spec['id']}: no navigable water from the berth to the landing")
            continue
        total = sum(math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1])
                    for i in range(len(route) - 1))
        ang = math.atan2(route[1][1] - route[0][1], route[1][0] - route[0][0])
        deck = spec.get("deck", (86, 34))
        ctx.ferries.append({
            "id": spec["id"], "name": spec["name"],
            "berth": [round(berth[0]), round(berth[1])], "ang": round(ang, 4),
            "deck": [int(deck[0]), int(deck[1])], "dockS": int(spec.get("dockS", 20)),
            "route": [round(v) for p in route for v in p],
            # A CROSSING: she waits at the far shore instead of sailing home, and
            # is never used up, because she is transport rather than a treat.
            "oneWay": True, "speed": int(spec.get("speed", 150)),
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
        log("lancha", f"{spec['id']} {round(berth[0])},{round(berth[1])} -> "
            f"{round(landing[0])},{round(landing[1])}: {len(route)} pts, "
            f"{round(total)}px ({total / 1.6 / 1000:.2f} km), "
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
        _apron(ctx, f"bajada_{spec['id']}", spec["name"],
               x, y, target[0], target[1], spec.get("w", 30),
               style="malecon", surface=Surface.MALECON)
        log("beach", f"{spec['id']}: sand ({round(x)},{round(y)}) -> street "
            f"({round(target[0])},{round(target[1])}), {round(gap)}px")
