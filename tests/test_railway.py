"""EL DERECHO DE VÍA — named-street rail alignment.

These are small analytic worlds on purpose.  A full Puntarenas build takes
about half an hour; the facts that make the algorithm safe (pairing, shoulder
clearance, parallel rejection and preserving OSM gaps) fit in metres here.
"""
import copy
import math
import unittest

from churchill.world.content import RAILWAY_DEF
from churchill.world.service.railway import align_rails, alignment_failures
from churchill.world.service.street import StreetIndex


def spec(**changes):
    out = {
        "sampleM": 2.0,
        "checkSampleM": 1.0,
        "smoothM": 0.0,
        "simplifyM": 0.1,
        "searchM": 40.0,
        "parallelMaxDeg": 25.0,
        "sideEpsilonM": 0.5,
        "shoulderM": 2.0,
        "shoulderSide": "preserve-local-raw",
        "trueClearanceM": 0.2,
        "pairMidpointToleranceM": 1.0,
        "pairRules": [],
        "dividedRules": [],
        "shoulderNames": [],
        "transition": {
            "anchorNames": ["Calle del Ferrocarril"],
            "continuationNames": ["Avenida del Ferrocarril"],
            "reachM": 20.0,
        },
    }
    out.update(changes)
    return out


def road(name, y, *, width=10, cls="residential", x0=-20, x1=300):
    return {"name": name, "cls": cls, "w": width,
            "pts": [x0, y, x1, y]}


class AuthoredRuleTests(unittest.TestCase):
    def test_registry_uses_names_and_authors_the_local_side_strategy(self):
        self.assertEqual(RAILWAY_DEF["shoulderSide"], "preserve-local-raw")
        self.assertGreaterEqual(RAILWAY_DEF["pairRules"][0]["maxM"], 14)
        transition = RAILWAY_DEF["transition"]
        self.assertEqual(transition["anchorNames"], ["Calle del Ferrocarril"])
        self.assertIn("Avenida del Ferrocarril", transition["continuationNames"])
        self.assertNotIn("Calle del Ferrocarril", RAILWAY_DEF["shoulderNames"],
                         "the finite perpendicular Calle is an anchor, not a rail shoulder")

        def coordinates(node):
            if isinstance(node, dict):
                for key, value in node.items():
                    self.assertNotIn(key.lower(), {"ll", "lon", "lat", "px", "bbox"})
                    coordinates(value)
            elif isinstance(node, list):
                for value in node:
                    coordinates(value)
        coordinates(RAILWAY_DEF)


class AlignmentTests(unittest.TestCase):
    def test_distinct_named_pair_lands_between_and_near_midpoint(self):
        roads = [
            road("Avenida 2 del Farrocarril", -10),
            # A split/duplicate on the same side must not become a second lane.
            road("Avenida Alberto Echandi Montero", 11, x0=0, x1=55),
            road("Avenida Alberto Echandi Montero", 10),
        ]
        rules = spec(
            pairRules=[{
                "id": "cocal", "a": ["Avenida 2 del Farrocarril"],
                "b": ["Avenida Alberto Echandi Montero"],
                "minM": 5, "maxM": 25,
            }],
            shoulderNames=["Avenida 2 del Farrocarril",
                           "Avenida Alberto Echandi Montero"],
        )
        rails = [{"pts": [0, -2, 100, -2]}]
        aligned, reports = align_rails(
            rails, roads, StreetIndex(roads), rules, px_per_m=1.0)
        self.assertEqual(aligned[0]["pts"], [0, 0, 100, 0])
        self.assertGreater(reports[0]["pairSamples"], 0)
        self.assertEqual(reports[0]["pairBetweenErrors"], 0)
        self.assertEqual(reports[0]["pairMidpointErrors"], 0)
        self.assertEqual(alignment_failures(reports), [])

    def test_single_street_uses_painted_shoulder_and_preserves_local_raw_side(self):
        roads = [road("Avenida Alberto Echandi Montero", 0, width=20)]
        rules = spec(shoulderNames=["Avenida Alberto Echandi Montero"])
        rails = [
            {"pts": [0, -1, 100, -1]},
            {"pts": [0, 1, 100, 1]},
        ]
        aligned, reports = align_rails(
            rails, roads, StreetIndex(roads), rules, px_per_m=1.0)
        north_y = aligned[0]["pts"][1::2]
        south_y = aligned[1]["pts"][1::2]
        self.assertTrue(all(y <= -12 for y in north_y), north_y)
        self.assertTrue(all(y >= 12 for y in south_y), south_y)
        self.assertEqual(sum(r["shoulderTrueHits"] for r in reports), 0)
        self.assertEqual(sum(r["shoulderPaintedHits"] for r in reports), 0)
        self.assertEqual(alignment_failures(reports), [])

    def test_perpendicular_named_cross_street_is_rejected(self):
        crossing = {"name": "Avenida Alberto Echandi Montero",
                    "cls": "residential", "w": 20,
                    "pts": [50, -40, 50, 40]}
        rail = {"pts": [0, 0, 100, 0]}
        rules = spec(shoulderNames=["Avenida Alberto Echandi Montero"])
        aligned, reports = align_rails(
            [rail], [crossing], StreetIndex([crossing]), rules, px_per_m=1.0)
        self.assertEqual(aligned, [rail])
        self.assertEqual(reports[0]["alignedSamples"], 0)
        self.assertEqual(alignment_failures(reports, require_alignment=False), [])

    def test_resampling_is_deterministic_and_never_bridges_a_real_gap(self):
        roads = [road("Avenida Alberto Echandi Montero", 0, width=20)]
        rails = [
            {"pts": [0, -1, 100, -1]},
            {"pts": [153.1, -1, 250, -1]},
        ]
        rules = spec(smoothM=20, shoulderNames=["Avenida Alberto Echandi Montero"])
        original = copy.deepcopy(rails)
        first = align_rails(rails, roads, StreetIndex(roads), rules, px_per_m=1.0)
        second = align_rails(rails, roads, StreetIndex(roads), rules, px_per_m=1.0)
        self.assertEqual(first, second)
        self.assertEqual(rails, original, "alignment mutated the extracted OSM rails")
        aligned = first[0]
        self.assertEqual(len(aligned), 2)
        a = aligned[0]["pts"][-2:]
        b = aligned[1]["pts"][:2]
        self.assertGreater(math.dist(a, b), 50,
                           "the real 53.1 m break was joined by smoothing")

    def test_overlapping_arcade_widths_make_midpoint_and_painted_zero_impossible(self):
        roads = [road("Farro", -10, width=30), road("Alberto", 10, width=30)]
        rules = spec(
            pairRules=[{"id": "cocal", "a": ["Farro"], "b": ["Alberto"],
                        "minM": 5, "maxM": 25}],
            shoulderNames=["Farro", "Alberto"],
        )
        aligned, reports = align_rails(
            [{"pts": [0, -2, 100, -2]}], roads, StreetIndex(roads),
            rules, px_per_m=1.0)
        separation = 20
        self.assertLess(separation, roads[0]["w"] / 2 + roads[1]["w"] / 2)
        self.assertEqual(aligned[0]["pts"], [0, 0, 100, 0],
                         "the named pair still owns the midpoint")
        self.assertGreater(reports[0]["pairPaintedHits"], 0,
                           "the report hid the mathematically unavoidable overlap")
        self.assertEqual(reports[0]["pairMidpointErrors"], 0)
        self.assertEqual(reports[0]["pairBetweenErrors"], 0)
        self.assertEqual(alignment_failures(reports), [],
                         "pair geometry, not an impossible painted-zero, is its gate")


if __name__ == "__main__":
    unittest.main()
