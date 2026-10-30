#!/usr/bin/env python3
"""EL TABLERO NO ES EL SUELO — refresh a railway level's `profile` block.

    python3 tools/gen_railway_profile.py [level-id ...]

A level in `src/content/railway/levels/` authors its corridor (which
kilometres of the real Pacífico–Puntarenas line it covers), its stations, its
bridges, its scenes and its fantasy loops BY HAND.  What it must never hold by
hand is the ground: that comes from the DEM samples in
`docs/research/pacific-railway/data/terrain-profile.json`, and retyping 144
elevations is how a profile silently stops being the corridor it claims.

So this script owns exactly two arrays of the level file and nothing else:

  * `profile.groundM` — the DEM, verbatim, resampled onto the level's own
    spacing.  It is SURFACE elevation, not the rail platform; the research
    README says so and so does the level's note.
  * `profile.deckM` — the rail deck, DERIVED: the ground smoothed over
    `smoothM`, then grade-limited to `maxGradePct` (a 1910s mainline does not
    climb at the DEM's 5 % sampling noise), then flattened to a straight chord
    across every authored bridge, because a deck on a bridge follows its own
    profile over the canyon and not the canyon.

Everything else in the file is the author's.  `tests/test_railway_content.py`
re-derives both arrays and fails if the committed ones drifted, which is what
keeps "generated and committed" honest without a Python runtime in the game.
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "src/content/railway/levels"
TERRAIN = ROOT / "docs/research/pacific-railway/data/terrain-profile.json"


def ground_sampler():
    """The DEM as a function of corridor metres, linearly interpolated."""
    samples = json.loads(TERRAIN.read_text())["samples"]
    xs = [float(s["s_m"]) for s in samples]
    ys = [float(s["terrain_m"]) for s in samples]

    def at(s):
        if s <= xs[0]:
            return ys[0]
        if s >= xs[-1]:
            return ys[-1]
        lo, hi = 0, len(xs) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if xs[mid] < s:
                lo = mid + 1
            else:
                hi = mid
        a, b = max(0, lo - 1), lo
        span = xs[b] - xs[a] or 1.0
        t = (s - xs[a]) / span
        return ys[a] + (ys[b] - ys[a]) * t

    return at


def smooth(values, spacing_m, window_m):
    """A centred moving average over `window_m`, clamped at the ends.

    Widening the window is what turns the DEM's 100 m sampling noise into
    something a train could have been built on; it is not cosmetic.  Measured on
    Pacífico–Belén the raw samples reach 5.0 % grade over 100 m on ground that
    falls 1.6 % across the whole level.
    """
    half = max(0, int(round(window_m / spacing_m / 2)))
    if not half:
        return list(values)
    out = []
    for i in range(len(values)):
        lo, hi = max(0, i - half), min(len(values) - 1, i + half)
        out.append(sum(values[lo:hi + 1]) / (hi - lo + 1))
    return out


def limit_grade(values, spacing_m, max_pct):
    """Clip the profile so no step exceeds `max_pct`, forward then backward.

    One direction leaves the mirrored violation behind, so both passes run and
    they run until the profile stops moving — a single pair of sweeps can still
    leave a spike between two clipped neighbours.
    """
    step = spacing_m * max_pct / 100.0
    out = list(values)
    for _ in range(64):
        moved = 0.0
        for i in range(1, len(out)):
            delta = out[i] - out[i - 1]
            if abs(delta) > step:
                target = out[i - 1] + math.copysign(step, delta)
                moved = max(moved, abs(out[i] - target))
                out[i] = target
        for i in range(len(out) - 2, -1, -1):
            delta = out[i] - out[i + 1]
            if abs(delta) > step:
                target = out[i + 1] + math.copysign(step, delta)
                moved = max(moved, abs(out[i] - target))
                out[i] = target
        if moved < 1e-9:
            break
    return out


def flatten_bridges(values, spacing_m, from_km, structures):
    """A bridge deck is a CHORD, not a copy of the canyon under it.

    The chord is taken from the deck at the two abutments, which is why this
    runs AFTER the grade limit: taken from the raw DEM it would start and end
    inside the gorge the bridge exists to cross.
    """
    out = list(values)
    for s in structures:
        if s.get("type") != "bridge":
            continue
        a = (float(s["fromKm"]) - from_km) * 1000.0 / spacing_m
        b = (float(s["toKm"]) - from_km) * 1000.0 / spacing_m
        i0, i1 = max(0, int(math.floor(a))), min(len(out) - 1, int(math.ceil(b)))
        if i1 <= i0:
            continue
        y0, y1 = out[i0], out[i1]
        for i in range(i0, i1 + 1):
            t = (i - i0) / (i1 - i0)
            out[i] = y0 + (y1 - y0) * t
    return out


def derive(level):
    """The two generated arrays for one level record."""
    profile = level["profile"]
    corridor = level["corridor"]
    spacing = float(profile["spacingM"])
    from_km, to_km = float(corridor["fromKm"]), float(corridor["toKm"])
    length_m = (to_km - from_km) * 1000.0
    n = int(round(length_m / spacing)) + 1
    at = ground_sampler()
    ground = [round(at(from_km * 1000.0 + i * spacing), 1) for i in range(n)]
    deck = smooth(ground, spacing, float(profile["smoothM"]))
    deck = limit_grade(deck, spacing, float(profile["maxGradePct"]))
    deck = flatten_bridges(deck, spacing, from_km, level.get("structures", []))
    return ground, [round(v, 2) for v in deck]


def main(argv):
    wanted = set(argv) or None
    files = sorted(LEVELS.glob("*.json"))
    if not files:
        print("no level files in", LEVELS)
        return 1
    for path in files:
        level = json.loads(path.read_text())
        if wanted and level["id"] not in wanted:
            continue
        ground, deck = derive(level)
        level["profile"]["groundM"] = ground
        level["profile"]["deckM"] = deck
        path.write_text(json.dumps(level, ensure_ascii=False, indent=2) + "\n")
        drop = ground[0] - ground[-1]
        print(f"[railway] {level['id']}: {len(ground)} samples, "
              f"{ground[0]:.0f} m -> {ground[-1]:.0f} m (bajada {drop:.0f} m), "
              f"deck {min(deck):.0f}..{max(deck):.0f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
