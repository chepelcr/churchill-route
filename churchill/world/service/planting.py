"""Semantic planting beds: ``form × align`` -> deterministic plants.

This is the builder half of ``src/render/c2d/plantingShapes.js``.  The JSON owns
the bed shape, alignment, physical dimensions, species mix and whether it blocks;
the engine owns only this finite geometry interpreter.  All public lengths are
metres and become pixels through the caller's ``ppm``.
"""
from __future__ import annotations

import math

from ..config import CLS_ACERA
from ..util.geometry import point_in_poly


PLANTING_FORMS = ("strip", "disc", "triangle", "square", "free")
PLANTING_ALIGNS = ("street", "horizontal", "vertical", "free")
DERIVED_PLANTING_STRATEGIES = (
    "paseo-crossing-runs",
    "leon-corner-window",
    "elevated-road-shoulder",
    "divided-avenue-midline",
)
MAX_PLANTS = 20_000


def _points(feature):
    geometry = feature.get("geometry") or {}
    if geometry.get("kind") == "point":
        return [geometry["point"]]
    return geometry.get("points") or []


def _centroid(points):
    if not points:
        return (0.0, 0.0)
    return (sum(point[0] for point in points) / len(points),
            sum(point[1] for point in points) / len(points))


def _line_length(points):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1])
               for a, b in zip(points, points[1:]))


def _aligned_line(points, align):
    if align not in ("horizontal", "vertical") or len(points) < 2:
        return points
    cx, cy = _centroid(points)
    half = _line_length(points) / 2
    if align == "horizontal":
        return [[cx - half, cy], [cx + half, cy]]
    return [[cx, cy - half], [cx, cy + half]]


def _nearest_on_segment(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length2 = dx * dx + dy * dy
    t = 0 if not length2 else max(0, min(1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
    return [a[0] + dx * t, a[1] + dy * t]


def _street_line(points, properties, roads):
    """Snap a drawn window onto a named street without storing world pixels.

    The authored endpoints remain the extent.  Dense samples between them are
    projected onto the named road segments, so a curved avenue stays curved and
    a world rescale can rebuild the same intent from the street geometry.
    """
    name = str(properties.get("streetName") or "").strip().lower()
    if not name or len(points) < 2:
        return points
    segments = []
    for road in roads or ():
        if name not in str(road.get("name") or "").lower():
            continue
        flat = road.get("pts") or []
        pairs = [[flat[i], flat[i + 1]] for i in range(0, len(flat) - 1, 2)]
        segments.extend(zip(pairs, pairs[1:]))
    if not segments:
        return points
    step = max(1.0, float(properties.get("sampleStepPx") or 4.0))
    samples = _sample_line(points, step)
    snapped = []
    for sample in samples:
        point = [sample["x"], sample["y"]]
        best = min((_nearest_on_segment(point, a, b) for a, b in segments),
                   key=lambda candidate: (candidate[0] - point[0]) ** 2
                                         + (candidate[1] - point[1]) ** 2)
        if not snapped or math.hypot(best[0] - snapped[-1][0],
                                     best[1] - snapped[-1][1]) > 0.1:
            snapped.append(best)
    return snapped if len(snapped) >= 2 else points


def _sample_line(points, spacing):
    out = []
    next_at = 0.0
    walked = 0.0
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if not length:
            continue
        while next_at <= walked + length + 1e-9 and len(out) < MAX_PLANTS:
            t = max(0, min(1, (next_at - walked) / length))
            out.append({"x": a[0] + dx * t, "y": a[1] + dy * t,
                        "tx": dx / length, "ty": dy / length})
            next_at += spacing
        walked += length
    if not out and points:
        out.append({"x": points[0][0], "y": points[0][1], "tx": 1, "ty": 0})
    return out


def _basis_angle(points, align):
    if align == "horizontal":
        return 0.0
    if align == "vertical":
        return math.pi / 2
    if len(points) > 1:
        return math.atan2(points[1][1] - points[0][1],
                          points[1][0] - points[0][0])
    return 0.0


def _lattice(polygon, spacing, angle, accept=lambda _point: True):
    centre = _centroid(polygon)
    ca, sa = math.cos(-angle), math.sin(-angle)
    local = []
    for x, y in polygon:
        dx, dy = x - centre[0], y - centre[1]
        local.append((dx * ca - dy * sa, dx * sa + dy * ca))
    min_x, max_x = min(p[0] for p in local), max(p[0] for p in local)
    min_y, max_y = min(p[1] for p in local), max(p[1] for p in local)
    fca, fsa = math.cos(angle), math.sin(angle)
    out = []
    for gy in range(math.ceil(min_y / spacing), math.floor(max_y / spacing) + 1):
        for gx in range(math.ceil(min_x / spacing), math.floor(max_x / spacing) + 1):
            lx, ly = gx * spacing, gy * spacing
            point = [centre[0] + lx * fca - ly * fsa,
                     centre[1] + lx * fsa + ly * fca]
            if point_in_poly(point, polygon) and accept(point):
                out.append({"x": point[0], "y": point[1]})
                if len(out) >= MAX_PLANTS:
                    return out
    if not out and point_in_poly(centre, polygon) and accept(centre):
        out.append({"x": centre[0], "y": centre[1]})
    return out


def _hash01(number):
    value = math.sin(number) * 43758.5453
    return value - math.floor(value)


def _mix_rows(flora, mix_id):
    mix = ((flora.get("plantings") or {}).get(mix_id)
           or (flora.get("mixes") or {}).get(mix_id)
           or (flora.get("mangroveMixes") or {}).get(mix_id)
           or {})
    source = mix.get("weights") or mix.get("species") or []
    if isinstance(source, dict):
        source = source.items()
    rows = []
    for item in source:
        if isinstance(item, (list, tuple)):
            species, weight = item[0], item[1] if len(item) > 1 else 1
        else:
            species, weight = item.get("species"), item.get("weight", 1)
        if species in (flora.get("species") or {}) and float(weight) > 0:
            rows.append((species, float(weight)))
    return rows


def planting_species(flora, mix_id, x, y, fallback=None):
    rows = _mix_rows(flora, mix_id)
    if not rows:
        return fallback or flora["defaults"]["treeSpecies"]
    roll = _hash01(x * 12.9898 + y * 78.233) * sum(weight for _, weight in rows)
    for species, weight in rows:
        roll -= weight
        if roll <= 0:
            return species
    return rows[-1][0]


def resolve_planting(feature, flora, ppm, roads=()):
    defaults = (flora.get("plantingSchema") or {}).get("defaults") or {}
    properties = {**defaults, **(feature.get("properties") or {})}
    points = _points(feature)
    align = properties.get("align") or "free"
    if properties.get("form") == "strip":
        points = _aligned_line(points, align)
        if align == "street":
            properties["sampleStepPx"] = float(properties.get("sampleStepM", 1.6)) * ppm
            points = _street_line(points, properties, roads)
    return {**properties,
            "form": properties.get("form") or "strip",
            "align": align,
            "widthPx": max(0.1, float(properties.get("widthM", 4)) * ppm),
            "radiusPx": max(0.1, float(properties.get("radiusM", 8)) * ppm),
            "spacingPx": max(0.1, float(properties.get("spacingM", 10.4)) * ppm),
            "points": points}


def planting_placements(feature, flora, ppm, roads=()):
    spec = resolve_planting(feature, flora, ppm, roads)
    placements = []
    if spec["form"] == "strip":
        samples = _sample_line(spec["points"], spec["spacingPx"])
        rows = max(1, math.floor(spec["widthPx"] / spec["spacingPx"]))
        for sample in samples:
            for row in range(rows):
                offset = (row - (rows - 1) / 2) * spec["spacingPx"]
                placements.append({"x": sample["x"] - sample["ty"] * offset,
                                   "y": sample["y"] + sample["tx"] * offset})
                if len(placements) >= MAX_PLANTS:
                    break
            if len(placements) >= MAX_PLANTS:
                break
    elif spec["form"] == "disc":
        centre = spec["points"][0]
        polygon = [[centre[0] + math.cos(index / 32 * math.tau) * spec["radiusPx"],
                    centre[1] + math.sin(index / 32 * math.tau) * spec["radiusPx"]]
                   for index in range(32)]
        placements = _lattice(
            polygon, spec["spacingPx"], _basis_angle(spec["points"], spec["align"]),
            lambda point: math.hypot(point[0] - centre[0], point[1] - centre[1])
                          <= spec["radiusPx"])
    else:
        placements = _lattice(spec["points"], spec["spacingPx"],
                              _basis_angle(spec["points"], spec["align"]))
    scale = spec.get("scale", 1)
    scale_range = scale if isinstance(scale, list) else [float(scale), float(scale)]
    fallback = (flora["defaults"]["palmSpecies"] if spec.get("treeKind") == "palm"
                else flora["defaults"]["treeSpecies"])
    for placement in placements:
        x, y = placement["x"], placement["y"]
        placement["speciesId"] = planting_species(flora, spec.get("mix"), x, y, fallback)
        placement["scale"] = (scale_range[0] + _hash01(x * 4.137 + y * 9.731)
                              * (scale_range[1] - scale_range[0]))
    return placements


def stamp_planting(raster, feature, flora, ppm, roads=()):
    spec = resolve_planting(feature, flora, ppm, roads)
    if not spec.get("blocks"):
        return
    if spec["form"] == "strip":
        flat = [coordinate for point in spec["points"] for coordinate in point]
        if len(flat) >= 4:
            raster.stamp_polyline(flat, spec["widthPx"], CLS_ACERA)
    elif spec["form"] == "disc":
        centre = spec["points"][0]
        polygon = [(centre[0] + math.cos(index / 32 * math.tau) * spec["radiusPx"],
                    centre[1] + math.sin(index / 32 * math.tau) * spec["radiusPx"])
                   for index in range(32)]
        raster.fill_poly(polygon, CLS_ACERA)
    else:
        raster.fill_poly(spec["points"], CLS_ACERA)
