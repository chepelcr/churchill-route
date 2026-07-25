"""The separator strips down the middle of the paseos.

Two different plantings, and mixing them up is a mistake we have already made:
the Paseo de los Turistas carries a DASHED PALM MEDIAN — solid blocking
segments with deliberate gaps to cross — while Paseo León Cortés carries a
continuous tree line. The gaps are not decorative spacing: they are ALIGNED TO
THE CROSS STREETS, wide enough to turn into each one.

The strips are stamped CLS_ACERA, not CLS_LAND: equally blocking in physics
(walls are land+acera), but invisible to block detection and building
placement, which only consider CLS_LAND. And they are stamped AFTER
acera_fringe, so the fringe never re-rings them into ordinary sidewalk.

A stamped wall must be at least as wide as the DRAWN feature (including its
round cap) or the car slips into the drawn-but-unstamped rim and the
both-ends-blocked snap-back traps it — which is why the stamp is
PASEO_MEDIAN_W + 6 while the renderer draws PASEO_MEDIAN_W.
"""
from collections import defaultdict

from ..config import (
    CLS_ACERA, CUAD, PASEO_GAP_MARGIN, PASEO_MEDIAN_W, PASEO_MIN_DASH,
    PASEO_NAMES,
)
from .street import resample_centerline


# The Paseo de los Turistas is a divided avenue: a dashed palm median runs down
# the centerline as a solid (blocking) separator between the two sides, with
# periodic gaps ("aperturas") where you can cross from one side to the other.



def paseo_roads(roads):
    return [r for r in roads
            if any(n in (r.get("name") or "").lower() for n in PASEO_NAMES)]

def paseo_median_runs(roads, pieces):
    """Solid-median runs along the given avenue pieces, with gaps ALIGNED TO
    THE CROSS STREETS: a gap opens wherever another street meets the avenue,
    wide enough to turn into it (street width + PASEO_GAP_MARGIN per side).
    Returns [(samples, [(k0, k1), ...])] — resampled centerline points and
    index ranges of the solid runs. Used by both the median stamp and the
    palm planting so they always agree."""
    paseo_ids = set(map(id, paseo_roads(roads)))
    segs = []
    for r in roads:
        if id(r) in paseo_ids or r["cls"] == "bridge":
            continue
        p = r["pts"]
        hw = r["w"] / 2 + PASEO_GAP_MARGIN
        for i in range(0, len(p) - 2, 2):
            segs.append((p[i], p[i + 1], p[i + 2], p[i + 3], hw))
    CS = 256
    cellmap = defaultdict(list)
    for idx, s in enumerate(segs):
        for cx in range(int(min(s[0], s[2]) - 200) // CS, int(max(s[0], s[2]) + 200) // CS + 1):
            for cy in range(int(min(s[1], s[3]) - 200) // CS, int(max(s[1], s[3]) + 200) // CS + 1):
                cellmap[(cx, cy)].append(idx)

    def in_crossing(px, py):
        c0, r0 = int(px) // CS, int(py) // CS
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for idx in cellmap.get((c0 + dc, r0 + dr), ()):
                    x0, y0, x1, y1, hw = segs[idx]
                    dx, dy = x1 - x0, y1 - y0
                    L2 = dx * dx + dy * dy
                    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
                    if (px - (x0 + t * dx)) ** 2 + (py - (y0 + t * dy)) ** 2 <= hw * hw:
                        return True
        return False

    out = []
    for r in pieces:
        samples = resample_centerline(r["pts"], 4.0)
        solid = [not in_crossing(x, y) for (_, x, y) in samples]
        runs, k = [], 0
        while k < len(samples):
            if solid[k]:
                k0 = k
                while k < len(samples) and solid[k]:
                    k += 1
                if samples[k - 1][0] - samples[k0][0] >= PASEO_MIN_DASH:
                    runs.append((k0, k - 1))
            else:
                k += 1
        out.append((samples, runs))
    return out

def stamp_paseo_median(raster, median_runs):
    """Stamp the separator strips (paseo palm median + tree lines) and return
    their polylines (for rendering the planted strip). Stamped as CLS_ACERA:
    equally blocking in physics (walls are land+acera) but invisible to block
    detection and building placement, which only consider CLS_LAND. Run AFTER
    acera_fringe so the strip stays a blocking separator, not sidewalk."""
    dashes = []
    for samples, runs in median_runs:
        for (k0, k1) in runs:
            flat = [v for (_, x, y) in samples[k0:k1 + 1] for v in (x, y)]
            if len(flat) >= 4:
                # Stamp the collision wall WIDER than the drawn curb (draw is
                # m.w+3 ≈ 13px with a ~6.5px round cap) so the car stops at the
                # visual green and can't slip into a drawn-but-unstamped round
                # cap corner (that trapped it half-in). Manifest `w` stays the
                # drawn value, so rendering is unchanged.
                raster.stamp_polyline(flat, PASEO_MEDIAN_W + 6, CLS_ACERA)
                dashes.append({"pts": [round(v) for v in flat], "w": round(PASEO_MEDIAN_W)})
    return dashes
