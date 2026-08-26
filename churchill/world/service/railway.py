"""Put the old Ferrocarril in its own right-of-way.

OSM preserves the disused railway, but long stretches share the centreline of
the streets which replaced it.  Drawing those coordinates literally puts ties
on the asphalt.  This service resolves the authored *street names* against a
``StreetIndex`` and moves each existing rail piece to one of two honest places:

* a single named street's shoulder; or
* between two parallel carriageways (the Cocal hand-off and divided Alberto).

There are deliberately no world-px, longitude or latitude transitions here.
``Calle del Ferrocarril`` is a finite transition anchor only: being near it
prefers ``Avenida del Ferrocarril`` as the continuation, but the perpendicular
calle is never used as a rail-bearing centreline.

One awkward fact is made explicit in the report.  The arcade renderer paints
roads wider than life, and the two painted Cocal envelopes overlap.  A rail
cannot be both at their midpoint and outside both painted widths.  Shoulder
samples therefore have a hard zero-painted-envelope gate; pair samples instead
have a hard between/near-midpoint gate, while both their true- and
painted-envelope hits are counted.  Hiding those hits as an exemption would
make the build log lie about the geometry.
"""
from __future__ import annotations

import math

from ..config import PLANAR_PX_PER_M, ROAD_WIDTH_M
from ..util.geometry import dp_simplify
from .street import resample_centerline


_EPS = 1e-7


def _unit(dx, dy):
    length = math.hypot(dx, dy)
    return (0.0, 0.0) if length < _EPS else (dx / length, dy / length)


def _sample_piece(flat, step):
    samples = resample_centerline(flat, step)
    out = []
    for i, (s, x, y) in enumerate(samples):
        before = samples[max(0, i - 1)]
        after = samples[min(len(samples) - 1, i + 1)]
        tx, ty = _unit(after[1] - before[1], after[2] - before[2])
        if tx == ty == 0.0 and i:
            tx, ty = out[-1]["t"]
        out.append({"s": s, "p": (x, y), "t": (tx, ty)})
    return out


def _rounded_flat(points):
    rounded = []
    for x, y in points:
        point = (round(x), round(y))
        if not rounded or point != rounded[-1]:
            rounded.append(point)
    return [v for point in rounded for v in point]


class _Aligner:
    def __init__(self, roads, streets, spec, px_per_m):
        self.roads = roads
        self.streets = streets
        self.spec = spec
        self.ppm = px_per_m
        self.sample = max(1.0, spec["sampleM"] * px_per_m)
        self.check_sample = max(1.0, spec["checkSampleM"] * px_per_m)
        self.smooth = max(0.0, spec["smoothM"] * px_per_m)
        self.handoff = max(0.0, spec.get("handoffM", spec["smoothM"]) * px_per_m)
        self.pair_min_run = max(0.0, spec.get("pairMinRunM", 0) * px_per_m)
        self.simplify = max(0.0, spec["simplifyM"] * px_per_m)
        # DP may move a segment by ``simplify`` and integer emission by half a
        # pixel on each axis. Keep the analytic shoulder outside that complete
        # output error, not merely epsilon-clear before serialization.
        self.output_safety = self.simplify + math.sqrt(0.5) + 0.5
        self.search = spec["searchM"] * px_per_m
        self.parallel_cos = math.cos(math.radians(spec["parallelMaxDeg"]))
        self.crossing_sin = math.sin(math.radians(spec["parallelMaxDeg"]))
        self.side_epsilon = spec["sideEpsilonM"] * px_per_m
        self.shoulder = spec["shoulderM"] * px_per_m
        if spec.get("shoulderSide") != "preserve-local-raw":
            raise ValueError("railway shoulderSide must be 'preserve-local-raw'")
        self.true_clearance = spec["trueClearanceM"] * px_per_m
        self.midpoint_tolerance = spec["pairMidpointToleranceM"] * px_per_m
        self.road_order = {id(road): i for i, road in enumerate(roads)}

        names = []
        for rule in spec.get("pairRules", []):
            names.extend(rule["a"])
            names.extend(rule["b"])
        for rule in spec.get("dividedRules", []):
            names.extend(rule["names"])
        names.extend(spec.get("shoulderNames", []))
        transition = spec.get("transition") or {}
        names.extend(transition.get("continuationNames", []))
        # Anchor names are intentionally NOT in this list: the Calle is allowed
        # to answer only "are we at the transition?", never "ride beside me".
        self.names = list(dict.fromkeys(names))
        self.named_roads = {name: self._resolve_name(name) for name in self.names}
        self.anchor_roads = {
            name: self._resolve_name(name)
            for name in transition.get("anchorNames", [])
        }

    def _resolve_name(self, name):
        """Resolve one exact authored name through StreetIndex, in OSM order."""
        resolved = next(self.streets.named(name), None)
        return [] if resolved is None else list(resolved[1])

    @staticmethod
    def _true_half(road, ppm):
        # ``road['w']`` is the deliberately exaggerated arcade paint width.
        # The true envelope is the OSM class' real width at this projection.
        return ROAD_WIDTH_M.get(road.get("cls"), 7) * ppm / 2.0

    def _nearest(self, point, tangent, road, *, parallel=True):
        px, py = point
        rpts = road.get("pts") or []
        best = None
        for i in range(0, len(rpts) - 2, 2):
            ax, ay, bx, by = rpts[i], rpts[i + 1], rpts[i + 2], rpts[i + 3]
            ux, uy = _unit(bx - ax, by - ay)
            dot = ux * tangent[0] + uy * tangent[1]
            if parallel and abs(dot) < self.parallel_cos:
                continue
            # Orient every road segment with this rail chain.  Side is then
            # local to the chain even when the OSM way itself is reversed.
            if dot < 0:
                ux, uy = -ux, -uy
            dx, dy = bx - ax, by - ay
            length2 = dx * dx + dy * dy
            t = 0.0 if length2 < _EPS else max(
                0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
            qx, qy = ax + t * dx, ay + t * dy
            distance = math.hypot(px - qx, py - qy)
            key = (distance, self.road_order.get(id(road), 10**9), i,
                   ax, ay, bx, by)
            if best is None or key < best[0]:
                nx, ny = -uy, ux
                signed = (px - qx) * nx + (py - qy) * ny
                rail_side = 1 if ((qx - px) * tangent[1]
                                  - (qy - py) * tangent[0]) > _EPS else -1
                # The expression above is the same left/right test as a cross
                # product, written so reversing the rail flips both sides.
                if distance < _EPS:
                    rail_side = 0
                best = (key, {
                    "road": road, "q": (qx, qy), "t": (ux, uy),
                    "n": (nx, ny), "signed": signed, "side": rail_side,
                    "d": distance, "paintedHalf": road.get("w", 0) / 2.0,
                    "trueHalf": self._true_half(road, self.ppm),
                    "segment": i // 2,
                })
        return None if best is None or best[1]["d"] > self.search else best[1]

    def _candidates(self, names, point, tangent):
        """Nearest parallel candidate per (name, side).

        OSM splits a carriageway at junctions and sometimes duplicates a short
        continuation.  Keeping one candidate on each side prevents two pieces
        of the *same* carriageway from masquerading as a divided avenue.
        """
        out = []
        for name_rank, name in enumerate(names):
            by_side = {}
            for road in self.named_roads.get(name, []):
                candidate = self._nearest(point, tangent, road)
                if candidate is None:
                    continue
                candidate["name"] = name
                candidate["nameRank"] = name_rank
                side = candidate["side"]
                key = (candidate["d"], self.road_order.get(id(road), 10**9),
                       candidate["segment"])
                if side not in by_side or key < by_side[side][0]:
                    by_side[side] = (key, candidate)
            out.extend(by_side[side][1] for side in (-1, 0, 1)
                       if side in by_side)
        return out

    def _anchor_near(self, point, tangent):
        transition = self.spec.get("transition") or {}
        reach = transition.get("reachM", 0) * self.ppm
        for name in transition.get("anchorNames", []):
            for road in self.anchor_roads.get(name, []):
                hit = self._nearest(point, tangent, road, parallel=False)
                if hit is not None and hit["d"] <= reach:
                    return True
        return False

    def _pair(self, candidates_a, candidates_b, rule_id, min_px, max_px):
        best = None
        for a in candidates_a:
            for b in candidates_b:
                if a["road"] is b["road"] or not a["side"] or not b["side"]:
                    continue
                if a["side"] == b["side"]:
                    continue
                vx, vy = b["q"][0] - a["q"][0], b["q"][1] - a["q"][1]
                separation = math.hypot(vx, vy)
                if not (min_px <= separation <= max_px):
                    continue
                ux, uy = vx / separation, vy / separation
                # Close parallel roads can touch at a junction.  Their join is
                # longitudinal, not a divider; reject it just like a cross calle.
                if abs(ux * a["t"][0] + uy * a["t"][1]) > self.crossing_sin:
                    continue
                key = (a["d"] + b["d"], abs(a["d"] - b["d"]), separation,
                       a["nameRank"], b["nameRank"],
                       self.road_order.get(id(a["road"]), 10**9),
                       self.road_order.get(id(b["road"]), 10**9))
                if best is None or key < best[0]:
                    best = (key, a, b, (ux, uy), separation)
        if best is None:
            return None
        _, a, b, u, separation = best
        midpoint = separation / 2.0
        lo = a["trueHalf"] + self.true_clearance
        hi = separation - b["trueHalf"] - self.true_clearance
        # Stay as close to the centreline midpoint as the TRUE road envelopes
        # permit.  Painted envelopes can overlap and are reported, not hidden.
        along = max(lo, min(hi, midpoint)) if lo <= hi else midpoint
        target = (a["q"][0] + u[0] * along, a["q"][1] + u[1] * along)
        return {
            "mode": "pair", "rule": rule_id, "a": a, "b": b, "u": u,
            "separation": separation, "lo": lo, "hi": hi,
            "hasTrueGap": lo <= hi, "target": target,
        }

    def _painted_margin(self, point, tangent):
        margins = []
        for name in self.names:
            for road in self.named_roads.get(name, []):
                hit = self._nearest(point, tangent, road)
                if hit is not None:
                    margins.append(hit["d"] - hit["paintedHalf"])
        return min(margins, default=math.inf)

    def _plan(self, sample, *, allow_pair=True, previous=None):
        point, tangent = sample["p"], sample["t"]
        if allow_pair:
            for rule in self.spec.get("pairRules", []):
                plan = self._pair(
                    self._candidates(rule["a"], point, tangent),
                    self._candidates(rule["b"], point, tangent),
                    rule["id"], rule["minM"] * self.ppm,
                    rule["maxM"] * self.ppm)
                if plan is not None:
                    return plan

            for rule in self.spec.get("dividedRules", []):
                candidates = self._candidates(rule["names"], point, tangent)
                plan = self._pair(
                    candidates, candidates, rule["id"],
                    rule["minM"] * self.ppm, rule["maxM"] * self.ppm)
                if plan is not None:
                    return plan

        names = list(self.spec.get("shoulderNames", []))
        transition = self.spec.get("transition") or {}
        if self._anchor_near(point, tangent):
            # The finite Calle is only the question "are we at the hand-off?".
            # If its authored Avenida continuation is present, use that.  Only
            # when it is absent do the ordinary named shoulders take over.
            continuation = self._candidates(
                transition.get("continuationNames", []), point, tangent)
            candidates = continuation or self._candidates(names, point, tangent)
        else:
            candidates = self._candidates(names, point, tangent)
        if not candidates:
            return {"mode": "raw", "target": point}
        # The registry order is semantic: the Ferrocarril avenue owns its
        # shoulder until it really ends; Alberto is the continuation, not a
        # locally-nearer coin flip while both are present.
        candidate = min(candidates, key=lambda c: (
            c["nameRank"], c["d"],
            self.road_order.get(id(c["road"]), 10**9), c["segment"]))
        signed = candidate["signed"]
        preferred = 1 if signed > self.side_epsilon else (
            -1 if signed < -self.side_epsilon else None)
        offset = candidate["paintedHalf"] + self.shoulder
        options = []
        for sign in (-1, 1):
            actual_offset = offset
            target = None
            margin = -math.inf
            # A named avenue is split into several OSM ways at junctions.  One
            # way's shoulder can still lie under the painted envelope of its
            # parallel continuation, so walk outward until the UNION is clear.
            step = max(1.0, 0.5 * self.ppm)
            while actual_offset <= offset + self.search:
                target = (
                    candidate["q"][0] + candidate["n"][0] * sign * actual_offset,
                    candidate["q"][1] + candidate["n"][1] * sign * actual_offset)
                margin = self._painted_margin(target, tangent)
                if margin >= self.output_safety:
                    break
                actual_offset += step
            options.append((sign, target, margin, actual_offset))
        clear = [option for option in options
                 if option[2] >= self.output_safety]
        pool = clear or options
        if previous is not None:
            expected = (previous["target"][0] + point[0] - previous["point"][0],
                        previous["target"][1] + point[1] - previous["point"][1])
            chosen = min(pool, key=lambda option: (
                math.hypot(option[1][0] - expected[0],
                           option[1][1] - expected[1]),
                option[0] != preferred, -option[2], option[0]))
        elif clear:
            chosen = next((option for option in clear if option[0] == preferred),
                          max(clear, key=lambda option: (option[2], -option[0])))
        else:
            # At a merge both arcade envelopes can overlap.  Pick the locally
            # clearer side deterministically; the final gate will reject it if
            # it still sits on painted asphalt.
            chosen = max(options, key=lambda option: (
                option[2], option[0] == preferred, -option[0]))
        return {
            "mode": "shoulder", "rule": candidate["name"],
            "road": candidate, "sign": chosen[0], "minOffset": chosen[3],
            "target": chosen[1],
        }

    def _pair_at(self, rule_id, point, tangent):
        """Re-resolve one pair rule at a final, simplified rail sample."""
        for rule in self.spec.get("pairRules", []):
            if rule["id"] == rule_id:
                return self._pair(
                    self._candidates(rule["a"], point, tangent),
                    self._candidates(rule["b"], point, tangent), rule_id,
                    rule["minM"] * self.ppm, rule["maxM"] * self.ppm)
        for rule in self.spec.get("dividedRules", []):
            if rule["id"] == rule_id:
                candidates = self._candidates(rule["names"], point, tangent)
                return self._pair(
                    candidates, candidates, rule_id,
                    rule["minM"] * self.ppm, rule["maxM"] * self.ppm)
        return None

    def _plans(self, samples):
        """Resolve stable local regimes before smoothing their offsets."""
        probe = [self._plan(sample) for sample in samples]
        suppress_pair = set()
        start = 0
        while start < len(probe):
            plan = probe[start]
            if plan["mode"] != "pair":
                start += 1
                continue
            end = start + 1
            while (end < len(probe) and probe[end]["mode"] == "pair"
                   and probe[end].get("rule") == plan.get("rule")):
                end += 1
            run = samples[end - 1]["s"] - samples[start]["s"] + self.sample
            if run < self.pair_min_run:
                suppress_pair.update(range(start, end))
            start = end

        plans = []
        previous = None
        for i, sample in enumerate(samples):
            plan = self._plan(sample, allow_pair=i not in suppress_pair,
                              previous=previous)
            plans.append(plan)
            previous = {"point": sample["p"], "target": plan["target"]}

        if self.handoff:
            key = lambda p: (p["mode"], p.get("rule"))
            boundaries = []
            for i in range(1, len(plans)):
                target_step = math.dist(plans[i - 1]["target"], plans[i]["target"])
                if (key(plans[i]) != key(plans[i - 1])
                        or target_step > 3 * self.sample):
                    boundaries.append(
                        (samples[i - 1]["s"] + samples[i]["s"]) / 2)
            radius = self.handoff / 2.0
            for i, sample in enumerate(samples):
                if any(abs(sample["s"] - boundary) <= radius
                       for boundary in boundaries):
                    base = plans[i]
                    plans[i] = {**base, "baseMode": base["mode"],
                                "mode": "handoff"}
        return plans

    def _smooth_targets(self, samples, plans):
        targets = [plan["target"] for plan in plans]
        if self.smooth <= 0:
            return targets
        out = list(targets)
        half = self.smooth / 2.0
        # Smooth offsets, not absolute positions, along this one rail piece. A
        # real break between OSM rail pieces is outside this function and can
        # therefore never be bridged.
        for i, plan in enumerate(plans):
            base_mode = plan.get("baseMode", plan["mode"])
            if base_mode == "raw" and plan["mode"] != "handoff":
                continue
            sx, sy = samples[i]["p"]
            offsets = []
            j = i
            while j >= 0 and samples[i]["s"] - samples[j]["s"] <= half:
                offsets.append((targets[j][0] - samples[j]["p"][0],
                                targets[j][1] - samples[j]["p"][1]))
                j -= 1
            j = i + 1
            while j < len(plans) and samples[j]["s"] - samples[i]["s"] <= half:
                offsets.append((targets[j][0] - samples[j]["p"][0],
                                targets[j][1] - samples[j]["p"][1]))
                j += 1
            candidate = (sx + sum(v[0] for v in offsets) / len(offsets),
                         sy + sum(v[1] for v in offsets) / len(offsets))
            if plan["mode"] == "handoff":
                out[i] = candidate
            elif base_mode == "pair":
                a, u, separation = plan["a"]["q"], plan["u"], plan["separation"]
                along = ((candidate[0] - a[0]) * u[0]
                         + (candidate[1] - a[1]) * u[1])
                if plan["hasTrueGap"]:
                    along = max(plan["lo"], min(plan["hi"], along))
                else:
                    along = max(0.0, min(separation, along))
                out[i] = (a[0] + u[0] * along, a[1] + u[1] * along)
            elif base_mode == "shoulder":
                road, sign = plan["road"], plan["sign"]
                normal = road["n"]
                projected = ((candidate[0] - road["q"][0]) * normal[0]
                             + (candidate[1] - road["q"][1]) * normal[1]) * sign
                projected = max(plan["minOffset"], projected)
                out[i] = (road["q"][0] + normal[0] * sign * projected,
                          road["q"][1] + normal[1] * sign * projected)
        return out

    def _envelope_hits(self, point, tangent):
        true_hits = painted_hits = 0
        for name in self.names:
            for road in self.named_roads.get(name, []):
                hit = self._nearest(point, tangent, road)
                if hit is None:
                    continue
                true_hits += hit["d"] < hit["trueHalf"] - _EPS
                painted_hits += hit["d"] < hit["paintedHalf"] - _EPS
        return true_hits, painted_hits

    def _report(self, piece_no, aligned_flat, source_samples, plans, targets=None):
        report = {
            "piece": piece_no, "samples": 0, "alignedSamples": 0,
            "shoulderSamples": 0, "pairSamples": 0,
            "shoulderTrueHits": 0, "shoulderPaintedHits": 0,
            "pairTrueHits": 0, "pairPaintedHits": 0,
            "handoffSamples": 0, "handoffTrueHits": 0,
            "handoffPaintedHits": 0,
            "pairBetweenErrors": 0, "pairMidpointErrors": 0,
            "pairNoTrueGap": 0,
        }
        checks = _sample_piece(aligned_flat, self.check_sample)
        if not checks or not source_samples:
            return report
        targets = targets or [sample["p"] for sample in source_samples]
        # The old rail doubles back locally near Cocal.  Arclength fractions or
        # a monotone nearest walk can then associate half a kilometre of output
        # with one source plan.  A small spatial bin maps each simplified check
        # point back to the target geometry that actually produced it.
        bin_px = max(self.search, self.sample * 4)
        target_bins = {}
        for index, target in enumerate(targets):
            key = (math.floor(target[0] / bin_px), math.floor(target[1] / bin_px))
            target_bins.setdefault(key, []).append(index)
        for check in checks:
            bx = math.floor(check["p"][0] / bin_px)
            by = math.floor(check["p"][1] / bin_px)
            nearby = [index for yy in range(by - 1, by + 2)
                      for xx in range(bx - 1, bx + 2)
                      for index in target_bins.get((xx, yy), ())]
            if not nearby:
                nearby = range(len(targets))
            j = min(nearby, key=lambda index: (
                (check["p"][0] - targets[index][0]) ** 2
                + (check["p"][1] - targets[index][1]) ** 2,
                index))
            plan = plans[min(j, len(plans) - 1)]
            report["samples"] += 1
            if plan["mode"] == "raw":
                continue
            report["alignedSamples"] += 1
            # Parallelism is measured against the source rail chain.  A cross
            # calle does not become a candidate merely because a smoothed
            # hand-off briefly turns toward it.
            source_tangent = source_samples[j]["t"]
            true_hits, painted_hits = self._envelope_hits(check["p"], source_tangent)
            if plan["mode"] == "handoff":
                report["handoffSamples"] += 1
                report["handoffTrueHits"] += bool(true_hits)
                report["handoffPaintedHits"] += bool(painted_hits)
                continue
            if plan["mode"] == "shoulder":
                report["shoulderSamples"] += 1
                report["shoulderTrueHits"] += bool(true_hits)
                report["shoulderPaintedHits"] += bool(painted_hits)
                continue
            report["pairSamples"] += 1
            report["pairTrueHits"] += bool(true_hits)
            report["pairPaintedHits"] += bool(painted_hits)
            final_pair = self._pair_at(plan["rule"], check["p"], source_tangent)
            if final_pair is None:
                report["pairBetweenErrors"] += 1
                continue
            report["pairNoTrueGap"] += not final_pair["hasTrueGap"]
            a, u, separation = (final_pair["a"]["q"], final_pair["u"],
                                final_pair["separation"])
            vx, vy = check["p"][0] - a[0], check["p"][1] - a[1]
            along = vx * u[0] + vy * u[1]
            across = abs(vx * u[1] - vy * u[0])
            if along < -self.midpoint_tolerance \
                    or along > separation + self.midpoint_tolerance \
                    or across > self.midpoint_tolerance:
                report["pairBetweenErrors"] += 1
            if abs(along - separation / 2.0) > self.midpoint_tolerance:
                report["pairMidpointErrors"] += 1
        return report

    def align_piece(self, piece_no, rail):
        flat = rail.get("pts") or []
        if len(flat) < 4:
            return dict(rail), self._report(piece_no, flat, [], [])
        samples = _sample_piece(flat, self.sample)
        plans = self._plans(samples)
        targets = self._smooth_targets(samples, plans)
        if not any(plan.get("baseMode", plan["mode"]) != "raw" for plan in plans):
            aligned = dict(rail)
        else:
            points = dp_simplify(targets, self.simplify)
            aligned = {**rail, "pts": _rounded_flat(points)}
            if len(aligned["pts"]) < 4:
                aligned["pts"] = list(flat)
        return aligned, self._report(piece_no, aligned["pts"], samples, plans, targets)


def align_rails(rails, roads, streets, spec, *, px_per_m=PLANAR_PX_PER_M):
    """Return ``(aligned_rails, reports)`` without mutating either input list.

    Each input record is handled independently.  In particular, two pieces
    whose OSM geometry has a 53.1 m break stay two pieces: resampling, smoothing
    and simplification never see a point from the other side of that gap.
    """
    aligner = _Aligner(roads, streets, spec, px_per_m)
    aligned, reports = [], []
    for piece_no, rail in enumerate(rails, 1):
        piece, report = aligner.align_piece(piece_no, rail)
        aligned.append(piece)
        reports.append(report)
    return aligned, reports


def alignment_failures(reports, *, require_alignment=True):
    """Human-readable failures for the final build gate.

    Pair-envelope hits are deliberately not failures: when arcade-painted
    carriageways overlap, midpoint and painted-clearance are mathematically
    incompatible.  They remain countable in every per-piece log line; pair
    position is enforced by the two explicit geometry errors below.
    """
    failures = []
    if require_alignment and not any(r["alignedSamples"] for r in reports):
        failures.append("railway registry matched no rail samples")
    for report in reports:
        piece = report["piece"]
        if report["shoulderTrueHits"]:
            failures.append(
                f"rail {piece}: {report['shoulderTrueHits']} shoulder samples "
                "inside a true road envelope")
        if report["shoulderPaintedHits"]:
            failures.append(
                f"rail {piece}: {report['shoulderPaintedHits']} shoulder samples "
                "inside a painted carriageway")
        if report["pairBetweenErrors"]:
            failures.append(
                f"rail {piece}: {report['pairBetweenErrors']} pair samples not "
                "between their named carriageways")
        if report["pairMidpointErrors"]:
            failures.append(
                f"rail {piece}: {report['pairMidpointErrors']} pair samples too "
                "far from the named-carriageway midpoint")
    return failures


def alignment_log_line(report):
    """Stable, factual build-log text for one original OSM rail piece."""
    return (
        f"segment {report['piece']}: {report['alignedSamples']}/"
        f"{report['samples']} samples aligned; shoulder true-envelope hits "
        f"{report['shoulderTrueHits']} (target 0), painted-envelope hits "
        f"{report['shoulderPaintedHits']} (target 0); pair true/painted hits "
        f"{report['pairTrueHits']}/{report['pairPaintedHits']} diagnostic, "
        f"handoff true/painted hits {report['handoffTrueHits']}/"
        f"{report['handoffPaintedHits']} diagnostic, "
        f"between/midpoint errors {report['pairBetweenErrors']}/"
        f"{report['pairMidpointErrors']}, no-true-gap "
        f"{report['pairNoTrueGap']}"
    )
