import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from churchill.world.context import WorldDims
from churchill.world.enums import Surface
from churchill.world.service.editor_patch import (
    WorldPatchError,
    WorldPatchSession,
    building_source_id,
    road_source_id,
    stable_hash,
    tree_source_id,
)
from churchill.world.util.raster import Raster


def feature(feature_id, feature_type, geometry, *, operation="add", source_ref=None,
            source_snapshot=None, properties=None):
    props = dict(properties or {})
    if source_ref:
        props["sourceRef"] = source_ref
    if source_snapshot:
        props["sourceSnapshot"] = source_snapshot
    return {
        "id": feature_id,
        "name": feature_id.replace("_", " ").title(),
        "type": feature_type,
        "operation": operation,
        "geometry": geometry,
        "style": {"color": "#abcdef"},
        "properties": props,
    }


class WorldEditorPatchTests(unittest.TestCase):
    def setUp(self):
        self.dims = WorldDims.of(1000, 800, 4)

    def session(self, payload):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "patch.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return WorldPatchSession(payload, path=str(path), dims=self.dims)

    @staticmethod
    def context():
        return SimpleNamespace(
            dims=WorldDims.of(1000, 800, 4),
            roads=[],
            buildings=[],
            trees=[],
            palms=[],
            landmarks=[],
            stadiums=[],
            parcels=[],
            greens=[],
            cuadras=[],
            surface_styles=[],
            waters=[],
            balneario=None,
            raster=Raster(250, 200, 4),
            districts=[{
                "id": "test", "x0": 0, "x1": 1000, "y0": 0, "y1": 800,
            }],
            editor_features=[],
            editor_patch_meta=None,
        )

    def test_hashes_match_editor_javascript(self):
        self.assertEqual(stable_hash([[1, 2], [3, 4]]), "14v8g9h")
        self.assertEqual(
            stable_hash(["residential", "Calle 1", None, [1, 2, 3, 4]]),
            "dcz2he",
        )
        self.assertEqual(stable_hash([12, 34, "tree"]), "1wuupob")

    def test_staged_patch_applies_every_edit(self):
        ctx = self.context()
        road = {
            "cls": "residential", "name": "Calle 1", "w": 30,
            "pts": [100, 100, 300, 100],
        }
        building = {"pts": [400, 200, 450, 200, 450, 250, 400, 250]}
        tree = {"x": 520, "y": 220, "s": 1}
        ctx.roads.append(road)
        ctx.buildings.append(building)
        ctx.trees.append(tree)

        road_override = feature(
            "move_road", "road",
            {"kind": "line", "points": [[100, 120], [300, 120]]},
            operation="modify",
            source_ref={"kind": "road", "id": road_source_id(road)},
            source_snapshot=road,
            properties={"use": "residential", "width": 36},
        )
        building_override = feature(
            "move_building", "building",
            {"kind": "polygon", "points": [
                [420, 220], [470, 220], [470, 270], [420, 270],
            ]},
            operation="modify",
            source_ref={"kind": "building", "id": building_source_id(building)},
            source_snapshot=building,
        )
        road_addition = feature(
            "new_road", "road",
            {"kind": "line", "points": [[50, 50], [50, 200]]},
            properties={"use": "service", "width": 18},
        )
        building_addition = feature(
            "new_building", "building",
            {"kind": "polygon", "points": [
                [600, 300], [640, 300], [640, 340], [600, 340],
            ]},
        )
        future_light = feature(
            "stadium_light", "light",
            {"kind": "point", "point": [700, 300]},
        )
        payload = {
            "schemaVersion": 1,
            "overrides": [road_override, building_override],
            "additions": [road_addition, building_addition, future_light],
            "deletions": [f"tree:{tree_source_id(tree)}"],
            "ui": {
                "screens": {
                    "title": {
                        "title": "Churchill Editor Test",
                        "background": "#17141f",
                        "accent": "#ffe06b",
                    },
                },
            },
        }
        session = self.session(payload)

        session.apply_pre_surface(ctx)
        self.assertEqual(ctx.roads[0]["pts"], [100, 120, 300, 120])
        self.assertEqual(ctx.roads[0]["w"], 36)
        self.assertEqual(len(ctx.roads), 2)

        session.apply_final(ctx)
        self.assertEqual(ctx.buildings[0]["pts"], [
            420, 220, 470, 220, 470, 270, 420, 270,
        ])
        self.assertEqual(len(ctx.buildings), 2)
        self.assertEqual(ctx.trees, [])
        self.assertEqual([item["id"] for item in ctx.editor_features], [
            "stadium_light",
        ])
        self.assertEqual(ctx.editor_ui["screens"]["title"]["title"],
                         "Churchill Editor Test")
        self.assertEqual(ctx.editor_patch_meta["overrides"], 2)
        self.assertEqual(ctx.editor_patch_meta["additions"], 3)
        self.assertEqual(ctx.editor_patch_meta["deletions"], 1)
        self.assertEqual(len(ctx.editor_patch_meta["sha256"]), 64)

    def test_unresolved_source_fails_instead_of_dropping_edit(self):
        override = feature(
            "missing_building", "building",
            {"kind": "polygon", "points": [[10, 10], [20, 10], [20, 20]]},
            operation="modify",
            source_ref={"kind": "building", "id": "building_missing"},
        )
        session = self.session({
            "schemaVersion": 1,
            "overrides": [override],
            "additions": [],
            "deletions": [],
        })
        ctx = self.context()
        session.apply_pre_surface(ctx)
        with self.assertRaisesRegex(WorldPatchError, "unresolved overrides"):
            session.apply_final(ctx)

    def test_width_only_road_override_is_not_mistaken_for_late_source(self):
        ctx = self.context()
        road = {
            "cls": "residential", "name": "Calle 2", "w": 24,
            "pts": [100, 100, 300, 100],
        }
        ctx.roads.append(road)
        override = feature(
            "wider_road", "road",
            {"kind": "line", "points": [[100, 100], [300, 100]]},
            operation="modify",
            source_ref={"kind": "road", "id": road_source_id(road)},
            source_snapshot=road,
            properties={"use": "residential", "width": 48},
        )
        session = self.session({
            "schemaVersion": 1,
            "overrides": [override],
            "additions": [],
            "deletions": [],
        })
        session.apply_pre_surface(ctx)
        session.apply_final(ctx)
        self.assertEqual(ctx.roads[0]["w"], 48)

    def test_surface_region_paints_collision_and_inside_acera(self):
        ctx = self.context()
        region = feature(
            "service_yard", "surface-region",
            {"kind": "polygon", "points": [
                [40, 40], [120, 40], [120, 120], [40, 120],
            ]},
            properties={
                "surfaceClass": "road",
                "groundPreset": "plaza",
                "aceraWidthCells": 1,
                "aceraColor": "#111111",
            },
        )
        session = self.session({
            "schemaVersion": 1,
            "overrides": [],
            "additions": [region],
            "deletions": [],
        })
        session.apply_pre_surface(ctx)
        session.apply_final(ctx)
        self.assertEqual(ctx.raster.at(20, 20), Surface.ROAD)
        self.assertEqual(ctx.raster.at(10, 10), Surface.ACERA)
        self.assertEqual(ctx.surface_styles[0]["aceraColor"], "#111111")

    def test_balneario_preset_paints_water_and_metadata(self):
        ctx = self.context()
        balneario = feature(
            "new_balneario", "surface-region",
            {"kind": "polygon", "points": [
                [200, 200], [320, 200], [320, 300], [200, 300],
            ]},
            properties={
                "surfaceClass": "water",
                "groundPreset": "balneario",
                "collisionMode": "auto",
            },
        )
        session = self.session({
            "schemaVersion": 1,
            "overrides": [],
            "additions": [balneario],
            "deletions": [],
        })
        session.apply_pre_surface(ctx)
        session.apply_final(ctx)
        self.assertEqual(ctx.raster.at(65, 60), Surface.WATER)
        self.assertEqual(ctx.balneario["cx"], 260)
        self.assertEqual(ctx.balneario["cy"], 250)
        self.assertEqual(ctx.waters[-1], [
            200, 200, 320, 200, 320, 300, 200, 300,
        ])

    def test_invalid_geometry_is_rejected(self):
        invalid = feature(
            "bad_water", "water",
            {"kind": "polygon", "points": [[1, 2], [3, float("nan")], [4, 5]]},
        )
        with self.assertRaisesRegex(WorldPatchError, "polygon needs"):
            self.session({
                "schemaVersion": 1,
                "overrides": [],
                "additions": [invalid],
                "deletions": [],
            })


if __name__ == "__main__":
    unittest.main()
