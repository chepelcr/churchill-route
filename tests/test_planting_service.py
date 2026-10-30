"""The editable planting language is one finite ``form × align`` contract."""
import unittest

from churchill.world.config import CLS_ACERA, flora_registry
from churchill.world.service.planting import (
    DERIVED_PLANTING_STRATEGIES,
    PLANTING_ALIGNS,
    PLANTING_FORMS,
    planting_placements,
    resolve_planting,
    stamp_planting,
)
from churchill.world.util.raster import Raster


def planting(form, geometry, **properties):
    return {
        "id": f"test_{form}",
        "name": f"Test {form}",
        "type": "planting",
        "geometry": geometry,
        "properties": {"form": form, **properties},
    }


class PlantingServiceTests(unittest.TestCase):
    def setUp(self):
        self.flora = flora_registry()
        self.ppm = 2

    def test_json_vocabulary_exactly_matches_the_engine(self):
        schema = self.flora["plantingSchema"]
        self.assertEqual(schema["forms"], list(PLANTING_FORMS))
        self.assertEqual(schema["alignments"], list(PLANTING_ALIGNS))
        strategies = {
            record["strategy"] for key, record in self.flora["plantingRuns"].items()
            if not key.startswith("_")
        }
        self.assertEqual(strategies, set(DERIVED_PLANTING_STRATEGIES))

    def test_every_form_places_deterministic_json_species(self):
        fixtures = {
            "strip": {"kind": "line", "points": [[20, 20], [180, 20]]},
            "disc": {"kind": "point", "point": [100, 100]},
            "triangle": {"kind": "polygon", "points": [[100, 20], [180, 170], [20, 170]]},
            "square": {"kind": "polygon", "points": [[20, 20], [180, 20], [180, 180], [20, 180]]},
            "free": {"kind": "polygon", "points": [[20, 40], [130, 20], [180, 110], [120, 180], [30, 150]]},
        }
        for form, geometry in fixtures.items():
            with self.subTest(form=form):
                feature = planting(form, geometry, spacingM=12, mix="parque")
                first = planting_placements(feature, self.flora, self.ppm)
                second = planting_placements(feature, self.flora, self.ppm)
                self.assertTrue(first)
                self.assertEqual(first, second)
                self.assertTrue(all(row["speciesId"] in self.flora["species"]
                                    for row in first))

    def test_alignment_changes_orientation_without_changing_the_form(self):
        feature = planting(
            "strip", {"kind": "line", "points": [[30, 30], [170, 130]]},
            align="horizontal", spacingM=10,
        )
        resolved = resolve_planting(feature, self.flora, self.ppm)
        self.assertEqual(resolved["form"], "strip")
        self.assertEqual(resolved["points"][0][1], resolved["points"][1][1])

    def test_blocking_bed_stamps_acera_and_nonblocking_bed_does_not(self):
        geometry = {"kind": "point", "point": [100, 100]}
        solid = planting("disc", geometry, radiusM=10, blocks=True)
        open_bed = planting("disc", geometry, radiusM=10, blocks=False)

        raster = Raster(50, 50, 4)
        stamp_planting(raster, solid, self.flora, self.ppm)
        self.assertEqual(raster.at_px(100, 100), CLS_ACERA)

        raster = Raster(50, 50, 4)
        stamp_planting(raster, open_bed, self.flora, self.ppm)
        self.assertEqual(raster.at_px(100, 100), 0)


if __name__ == "__main__":
    unittest.main()
