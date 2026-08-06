"""El malecón: the paved sea front between the Paseo de los Turistas and the sand.

The Paseo is the one street in Puntarenas people go to rather than through, and
until now the world had no way of saying so. The band of sand between its kerb
and the beach was `Surface.BEACH` like the rest of the playa — which is also why
it was drawn in two tones: the raster's sand is `beach_fringe` grown nine rings
inland from the water, while the DRAWN sand is the coarse OSM `natural=beach`
outline, and the strip between the two edges fell through to the land colour.
Paving it is both the feature and the fix.

Three rules decide how much sand becomes promenade, and each of them exists
because the alternative was measured on this coast:

  * THE WIDTH IS METRES, NOT PIXELS. A px constant tuned at 1.6 px/m is exactly
    what left the faro's plazoleta ringed in yellow after the rescale. The band
    is `MALECON_BAND_M` metres deep and stays that whatever the world's scale.
  * THE SAND HAS A VETO. The beach is 88–150 px wide along most of the Paseo and
    ~28 px at the faro end. A flat 60 px band would pave the playa away there, so
    the take is capped per cross-section: `MALECON_MIN_SAND_PX` of sand always
    survives seaward of the paving, and where that leaves nothing worth paving
    there is simply no malecón.
  * ONLY SAND BECOMES MALECON. The stamp never overwrites asphalt, water or a
    cuadra — it converts `CLS_BEACH` and nothing else. That is what lets it
    follow the real, wandering line between the street and the sea without a
    single hand-placed vertex, and what makes it safe to run over the whole
    length of the Paseo at once.

The ENTRADAS are the exception to the last rule. A promenade you cannot get onto
is scenery, and in places a strip of solar or acera stands between the kerb and
the sand. So at each opening of the palm median — the gaps `paseo_median_runs`
already aligns to the cross calles, reused rather than re-derived — a ramp is
paved from the kerb down to the band, and that one is allowed to cross acera and
land. Where the sand already touches the asphalt (most of the middle stretch) no
ramp is stamped at all, because none is needed.

Runs AFTER `acera_fringe`, like the palm median, so nothing re-rings the
promenade with sidewalk; and BEFORE the faro esplanade, whose flood follows sand
only and would otherwise leak east along this very band.
"""
import math
from collections import deque

from ..config import (
    CARRIAGEWAY_CLASSES, CLS_ACERA, CLS_BEACH, CLS_BRIDGE, CLS_LAND,
    CLS_MALECON, CLS_WATER, CUAD, GRID_CELL, MALECON_BAND_M, MALECON_ENTRADA_W,
    MALECON_MIN_PATCH_CELLS, MALECON_MIN_SAND_PX, MALECON_MIN_TAKE_PX,
    MALECON_SHOULDER_M, PASEO_NAMES, PASEO_TURISTAS, PLANAR_PX_PER_M,
)
from ..logging import log, warn
from ..util.geometry import point_in_poly
from .block import outline_polys
from .decoration import paseo_median_runs
from .street import resample_centerline

#: What an entrada ramp is allowed to pave through. NOT the carriageway: the
#: ramp starts at the kerb and runs seaward, so the asphalt it comes off stays
#: asphalt and the two simply meet.
ENTRADA_CLASSES = (CLS_ACERA, CLS_LAND, CLS_BEACH)


def paseo_frontage_roads(roads):
    """The sea front: BOTH paseos, because together they are one avenue.

    Paseo de los Turistas runs the spit from the faro to x≈19099, and Paseo León
    Cortés Castro picks up at exactly that point and carries on east past the
    Muelle de Cruceros to the Parque Marino. They are the same waterfront under
    two names — which is worth writing down, because this file previously said
    León Cortés was "the estero side of the spit and has no beach to pave", and
    it is not: the estuary is the OTHER shore, and León Cortés faces the
    Pacific just like Turistas does.

    `PASEO_LEON` matches "Paseo León Cortés Castro" and not "Calle León Cortés
    Castro", which is a residential street 18 km east and nothing to do with it.
    """
    return [r for r in roads
            if any(n in (r.get("name") or "").lower() for n in PASEO_NAMES)]


def _normals(samples):
    """Unit normal per resampled centreline point, from its neighbours."""
    n = len(samples)
    out = []
    for i in range(n):
        a = samples[max(0, i - 1)]
        b = samples[min(n - 1, i + 1)]
        tx, ty = b[1] - a[1], b[2] - a[2]
        L = math.hypot(tx, ty) or 1.0
        out.append((-ty / L, tx / L))
    return out


def _sand_run(raster, x, y, nx, ny, hw, shoulder_px, reach_px):
    """Walk outward from the kerb: (d0, run_px) of the first sand column, or None.

    Two things this has to get right, both learned from the first run of it:

    * THE SHOULDER IS CROSSED, NOT MEASURED. `hw` is the road's half-width, so
      the very first probe usually lands ON the asphalt — starting the walk with
      "the shoulder must be acera or land" rejected almost every cross-section
      and left the sea front in 46 disconnected patches. Anything but water may
      be crossed on the way out; nothing crossed is ever painted.
    * IT MUST BE THE SEA FRONT. The run has to end at open water (or at a deck
      standing in it) — otherwise it is an inland pocket of sand that happens to
      lie within a promenade's reach of the street, and the malecón would jump
      the Paseo onto the wrong side of it.
    """
    step = raster.cell / 2.0
    d, d0 = hw, None
    limit = hw + shoulder_px + reach_px
    while d <= hw + shoulder_px:
        cls = raster.at_px(x + nx * d, y + ny * d)
        if cls == CLS_BEACH:
            d0 = d
            break
        if cls is None or cls == CLS_WATER:
            return None                      # the sea is already here
        d += step
    if d0 is None:
        return None
    d = d0
    while d <= limit and raster.at_px(x + nx * d, y + ny * d) == CLS_BEACH:
        d += step
    end = raster.at_px(x + nx * d, y + ny * d)
    if d <= limit and end not in (CLS_WATER, CLS_BRIDGE):
        return None                          # not a shore: an inland sand pocket
    return d0, d - d0


def _paint(raster, x, y, cls, allowed, reserved=(), was=None):
    """Convert one cell, if it is one of `allowed` and nobody has reserved it.

    `was` records what the cell HELD, because a patch that turns out too small
    to be a promenade is given back — and an entrada crosses acera and solar, so
    giving it all back as sand would leave a hole in somebody's sidewalk.
    """
    c, r = raster.cell_of(x, y)
    if not raster.in_bounds(c, r) or raster.at(c, r) not in allowed:
        return None
    if (c, r) in reserved:
        return None
    if was is not None and (c, r) not in was:
        was[(c, r)] = raster.at(c, r)
    raster.set(c, r, cls)
    return (c, r)


def _median_gaps(roads, pieces):
    """The centre point of every opening in the palm median: (x, y).

    `paseo_median_runs` returns the SOLID runs; the openings are what is left
    between them, and they are already aligned to the cross calles — which is
    exactly where a person walks down to the sea front.
    """
    out = []
    for samples, runs in paseo_median_runs(roads, pieces):
        edges = [0] + [k for run in runs for k in run] + [len(samples) - 1]
        for i in range(1, len(edges) - 1, 2):
            k0, k1 = edges[i], edges[i + 1]
            if k1 <= k0:
                continue
            k = (k0 + k1) // 2
            out.append((samples[k][1], samples[k][2]))
    return out


def _components(cells):
    """4-connected components of a cell set, largest first, deterministic."""
    remaining = set(cells)
    out = []
    for seed in sorted(remaining):
        if seed not in remaining:
            continue
        comp, q = {seed}, deque([seed])
        remaining.discard(seed)
        while q:
            c, r = q.popleft()
            for nb in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
                if nb in remaining:
                    remaining.discard(nb)
                    comp.add(nb)
                    q.append(nb)
        out.append(comp)
    out.sort(key=lambda s: (-len(s), min(s)))
    return out


def _site_keepout(raster, sites, corridor):
    """Cells inside a mapped OSM site — the promenade flows AROUND them.

    The Paseo's sea front already has places on it: Parque El Planché, the Plaza
    de Deportes, the cancha de fútbol playa. They become parcels two stages from
    now, out of whatever LAND/ACERA is still under their outline — so paving
    their ground first would not merge them into the malecón, it would delete
    them. Reserving the cells is what lets the two meet: the park keeps its
    ground, and the paving runs up to its kerb.
    """
    x0, y0, x1, y1 = corridor
    keep = set()
    for site in sites or ():
        pts = site.get("pts") or []
        if len(pts) < 3:
            continue
        sx = [p[0] for p in pts]
        sy = [p[1] for p in pts]
        if max(sx) < x0 or min(sx) > x1 or max(sy) < y0 or min(sy) > y1:
            continue
        for cr in range(int(min(sy) // raster.cell), int(max(sy) // raster.cell) + 1):
            for cc in range(int(min(sx) // raster.cell), int(max(sx) // raster.cell) + 1):
                if point_in_poly(((cc + 0.5) * raster.cell, (cr + 0.5) * raster.cell), pts):
                    keep.add((cc, cr))
    return keep


def stamp_malecon(raster, roads, streets, sites=(), east_x=None):
    """Pave the sea front and return the bands the renderer draws.

    Each band is one contiguous piece of promenade:
    `{polys, ang, x0, y0, x1, y1}` — the outline rings straight off the raster
    (so the drawn paving is exactly the paving you drive on) plus the street's
    own angle, which is what lets the renderer lay the courses with the coast
    instead of with the screen.
    """
    pieces = paseo_frontage_roads(roads)
    if not pieces:
        warn("malecon", f"no road named '{PASEO_TURISTAS}' — no sea front paved")
        return []
    band_px = MALECON_BAND_M * PLANAR_PX_PER_M
    shoulder_px = MALECON_SHOULDER_M * PLANAR_PX_PER_M
    reach = shoulder_px + band_px + MALECON_MIN_SAND_PX
    xs = [v for r in pieces for v in r["pts"][0::2]]
    ys = [v for r in pieces for v in r["pts"][1::2]]
    reserved = _site_keepout(raster, sites, (min(xs) - reach, min(ys) - reach,
                                             max(xs) + reach, max(ys) + reach))
    cells, was = set(), {}
    n_narrow = 0
    for r in sorted(pieces, key=lambda p: (p["pts"][0], p["pts"][1])):
        hw = r["w"] / 2.0
        samples = resample_centerline(r["pts"], 3.0)
        for (_s, x, y), (nx, ny) in zip(samples, _normals(samples)):
            if east_x is not None and x > east_x:
                continue                  # past the Parque Marino: not sea front
            for side in (-1, 1):
                sx, sy = nx * side, ny * side
                run = _sand_run(raster, x, y, sx, sy, hw, shoulder_px, band_px + MALECON_MIN_SAND_PX)
                if run is None:
                    continue
                d0, width = run
                take = min(band_px, width - MALECON_MIN_SAND_PX)
                if take < MALECON_MIN_TAKE_PX:
                    n_narrow += 1
                    continue
                d = d0
                while d <= d0 + take:
                    hit = _paint(raster, x + sx * d, y + sy * d, CLS_MALECON,
                                 (CLS_BEACH,), reserved, was)
                    if hit:
                        cells.add(hit)
                    d += raster.cell / 2.0
    # Pinholes: a cell the marching rays stepped over is still promenade if the
    # promenade is on every side of it. Cheaper and more honest than sampling
    # finely enough to be sure — the band's EDGES stay exactly where the sand
    # rule put them.
    n_fill = 0
    for (c, r) in sorted(cells.copy()):
        for nb in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
            if nb in cells or raster.at(*nb) != CLS_BEACH:
                continue
            ring = [(nb[0] + 1, nb[1]), (nb[0] - 1, nb[1]), (nb[0], nb[1] + 1), (nb[0], nb[1] - 1)]
            if sum(1 for q in ring if q in cells) >= 3:
                was.setdefault(nb, CLS_BEACH)
                raster.set(nb[0], nb[1], CLS_MALECON)
                cells.add(nb)
                n_fill += 1
    log("malecon", f"{len(cells)} cells of sea front paved along {len(pieces)} "
        f"pieces of the Paseo ({round(band_px)}px deep, {n_fill} pinholes filled, "
        f"{n_narrow} cross-sections too narrow to share)")

    # --- las entradas: a ramp at every opening of the palm median
    n_ramp = 0
    for (gx, gy) in _median_gaps(roads, pieces):
        near = min(pieces, key=lambda p: _dist_to_poly(p["pts"], gx, gy))
        hw = near["w"] / 2.0
        for side in (-1, 1):
            nrm = _normal_at(near["pts"], gx, gy)
            if nrm is None:
                continue
            sx, sy = nrm[0] * side, nrm[1] * side
            run = _sand_run(raster, gx, gy, sx, sy, hw, shoulder_px, band_px + MALECON_MIN_SAND_PX)
            if run is None:
                continue
            d0, _width = run
            if d0 <= hw + raster.cell:
                continue                      # the sand already meets the asphalt
            painted = False
            d = hw - raster.cell
            while d <= d0 + raster.cell:
                for t in _across(MALECON_ENTRADA_W, raster.cell / 2.0):
                    hit = _paint(raster, gx + sx * d - sy * t, gy + sy * d + sx * t,
                                 CLS_MALECON, ENTRADA_CLASSES, (), was)
                    if hit:
                        cells.add(hit)
                        painted = True
                d += raster.cell / 2.0
            n_ramp += 1 if painted else 0

    # A patch too small to be a promenade is GIVEN BACK TO THE SAND, not merely
    # left out of the emit: the raster is what the car drives on and what the
    # renderer's sand outline is traced from, so a class-10 cell nobody draws is
    # a hole in the beach. Near the tip the sea is on both sides of the Paseo
    # and this is what keeps a 26 px square of paving out of the middle of it.
    comps, dropped = [], 0
    for comp in _components(cells):
        if len(comp) >= MALECON_MIN_PATCH_CELLS:
            comps.append(comp)
            continue
        for (c, r) in comp:
            raster.set(c, r, was.get((c, r), CLS_BEACH))
            cells.discard((c, r))
        dropped += 1
    if dropped:
        log("malecon", f"{dropped} patch(es) under {MALECON_MIN_PATCH_CELLS} cells "
            f"handed back to the sand")
    linked = sum(1 for c in comps if _touches(raster, c, CARRIAGEWAY_CLASSES))
    log("malecon", f"{n_ramp} entradas paved at the median's openings; "
        f"{len(comps)} bands, {linked} of them reaching the carriageway")
    if linked < len(comps):
        warn("malecon", f"{len(comps) - linked} band(s) with no way in from the street")

    bands = []
    for comp in comps:
        polys = outline_polys(comp, GRID_CELL)
        if not polys:
            continue
        xs = [c for (c, _) in comp]
        ys = [r for (_, r) in comp]
        x0, x1 = min(xs) * GRID_CELL, (max(xs) + 1) * GRID_CELL
        y0, y1 = min(ys) * GRID_CELL, (max(ys) + 1) * GRID_CELL
        ang = streets.angle_at((x0 + x1) / 2, (y0 + y1) / 2, reach=12 * CUAD)
        bands.append({"polys": polys, "ang": round(float(ang or 0.0), 4),
                      "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                      "cells": len(comp)})
    for b in bands:
        log("malecon", f"sea front x {b['x0']}..{b['x1']} y {b['y0']}..{b['y1']} — "
            f"{b['cells']} cells, {sum(len(p) // 2 for p in b['polys'])} outline points")
    return bands


def _touches(raster, comp, classes):
    for (c, r) in comp:
        for nb in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
            if raster.in_bounds(*nb) and raster.at(*nb) in classes:
                return True
    return False


def _across(width, step):
    """Offsets across a ramp of `width`, centre outward, endpoints included."""
    half = width / 2.0
    out, t = [], -half
    while t <= half:
        out.append(t)
        t += step
    return out


def _dist_to_poly(pts, x, y):
    best = float("inf")
    for i in range(0, len(pts) - 2, 2):
        x0, y0, x1, y1 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / L2))
        best = min(best, math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)))
    return best


def _normal_at(pts, x, y):
    """Unit normal of the nearest segment of a flat polyline."""
    best, out = float("inf"), None
    for i in range(0, len(pts) - 2, 2):
        x0, y0, x1, y1 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        if L2 == 0:
            continue
        t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / L2))
        d = math.hypot(x - (x0 + t * dx), y - (y0 + t * dy))
        if d < best:
            L = math.sqrt(L2)
            best, out = d, (-dy / L, dx / L)
    return out
