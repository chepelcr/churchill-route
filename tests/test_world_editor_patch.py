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
from churchill.world.service.pier import make_pier, stamp as stamp_pier
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
            ferries=[],
            piers=[],
            pier_restores={},
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
            editor_ui={},
            editor_content={},
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
            "content": {
                "shop": {
                    "tabs": [{"id": "parts", "label": "Parts", "enabled": True}],
                    "items": [{"id": "roof_rack", "kind": "vehicle-part", "tab": "parts"}],
                },
                "world": {"weather": {"default": "sunset"}},
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
        self.assertEqual(ctx.editor_content["shop"]["items"][0]["id"], "roof_rack")
        self.assertEqual(ctx.editor_content["world"]["weather"]["default"], "sunset")
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

    @staticmethod
    def ferry():
        return {
            "id": "paquera", "name": "Ferry a Tambor",
            "destination": "Tambor", "vesselName": "Tambor",
            "doubleEnded": True,
            "berth": [500, 400], "ang": 0.0,
            "deck": [124, 46], "dockS": 28,
            "route": [500, 400, 600, 400, 700, 460],
        }

    def ferry_feature(self, **properties):
        return feature(
            "move_ferry", "ferry",
            {"kind": "line", "points": [[520, 380], [620, 380], [720, 440]]},
            operation="modify",
            source_ref={"kind": "ferry", "id": "paquera"},
            source_snapshot=self.ferry(),
            properties=properties,
        )

    def test_ferry_override_moves_the_berth_before_the_ramp_is_paved(self):
        # The berth is the first route point, and the whole edit lands in
        # apply_pre_surface — the stage that runs BEFORE seat_town_kiosks paves
        # the boarding ramp from the stern at rest.
        ctx = self.context()
        ctx.ferries.append(self.ferry())
        session = self.session({
            "schemaVersion": 1,
            "overrides": [self.ferry_feature(deckLength=140, deckWidth=52, dockS=30)],
            "additions": [], "deletions": [],
        })
        session.apply_pre_surface(ctx)

        edited = ctx.ferries[0]
        self.assertEqual(edited["berth"], [520, 380])
        self.assertEqual(edited["deck"], [140, 52])
        self.assertEqual(edited["dockS"], 30)
        self.assertEqual(edited["route"], [520, 380, 620, 380, 720, 440])
        # Heading follows the first leg, the way extract_ferries derives it.
        self.assertEqual(edited["ang"], 0.0)
        self.assertEqual(edited["name"], "Move Ferry")
        self.assertEqual(edited["destination"], "Tambor")
        self.assertEqual(edited["vesselName"], "Tambor")
        self.assertIs(edited["doubleEnded"], True)

    def test_ferry_heading_can_be_pinned(self):
        ctx = self.context()
        ctx.ferries.append(self.ferry())
        session = self.session({
            "schemaVersion": 1,
            "overrides": [self.ferry_feature(ang=-3.1099)],
            "additions": [], "deletions": [],
        })
        session.apply_pre_surface(ctx)
        self.assertEqual(ctx.ferries[0]["ang"], -3.1099)

    def test_a_stern_over_water_is_refused(self):
        # dockS at half the deck puts the stern seaward of the berth node, where
        # nearest_cell has no street to ramp to: a ferry you can see and cannot
        # board. The editor and its API refuse the same number.
        ctx = self.context()
        ctx.ferries.append(self.ferry())
        session = self.session({
            "schemaVersion": 1,
            "overrides": [self.ferry_feature(deckLength=100, dockS=50)],
            "additions": [], "deletions": [],
        })
        with self.assertRaisesRegex(WorldPatchError, "half the deck length"):
            session.apply_pre_surface(ctx)

    def test_a_ferry_needs_line_geometry(self):
        ctx = self.context()
        ctx.ferries.append(self.ferry())
        session = self.session({
            "schemaVersion": 1,
            "overrides": [],
            "additions": [feature(
                "new_ferry", "ferry",
                {"kind": "point", "point": [500, 400]},
            )],
            "deletions": [],
        })
        with self.assertRaisesRegex(WorldPatchError, "needs line geometry"):
            session.apply_pre_surface(ctx)

    def test_a_ferry_can_be_added_and_deleted(self):
        ctx = self.context()
        ctx.ferries.append(self.ferry())
        session = self.session({
            "schemaVersion": 1,
            "overrides": [],
            "additions": [feature(
                "naranjo_2", "ferry",
                {"kind": "line", "points": [[100, 100], [100, 300]]},
                properties={"deckLength": 90, "deckWidth": 30, "dockS": 20},
            )],
            "deletions": ["ferry:paquera"],
        })
        session.apply_pre_surface(ctx)
        self.assertEqual([f["id"] for f in ctx.ferries], ["naranjo_2"])
        added = ctx.ferries[0]
        self.assertEqual(added["berth"], [100, 100])
        self.assertEqual(added["deck"], [90, 30])
        self.assertAlmostEqual(added["ang"], 1.5708, places=3)

    def test_moving_a_pier_puts_back_the_sea_it_covered(self):
        # The one edit that MUST undo itself: a moved deck whose old cells stay
        # drivable is a strip of invisible road over open water.
        ctx = self.context()
        pier = make_pier("muelle_test", "Muelle", [200, 200, 200, 400], 40)
        ctx.piers.append(pier)
        ctx.pier_restores[pier["id"]] = stamp_pier(ctx.raster, pier)
        self.assertEqual(ctx.raster.at_px(200, 300), Surface.BRIDGE)

        session = self.session({
            "schemaVersion": 1,
            "overrides": [feature(
                "move_muelle", "pier",
                {"kind": "line", "points": [[600, 200], [600, 400]]},
                operation="modify",
                source_ref={"kind": "pier", "id": "muelle_test"},
                source_snapshot=pier,
                properties={"width": 48, "style": "timber", "seaEnd": "last"},
            )],
            "additions": [], "deletions": [],
        })
        session.apply_final(ctx)

        self.assertEqual(ctx.raster.at_px(200, 300), Surface.WATER)   # the old deck is sea again
        self.assertEqual(ctx.raster.at_px(600, 300), Surface.BRIDGE)  # the new one is drivable
        self.assertEqual(ctx.piers[0]["pts"], [600, 200, 600, 400])
        self.assertEqual(ctx.piers[0]["w"], 48)
        self.assertEqual(ctx.piers[0]["style"], "timber")

    def test_the_sea_end_is_the_end_that_is_pulled_back(self):
        # stamp_polyline adds a round cap of radius w/2 past the last point. At
        # a muelle's free end that cap is drivable cells past the drawn deck;
        # at a ferry ramp's it is the overlap you board across.
        ctx = self.context()
        muelle = make_pier("m", "M", [400, 200, 400, 400], 40, sea_end="last")
        stamp_pier(ctx.raster, muelle)
        self.assertEqual(ctx.raster.at_px(400, 396), Surface.BRIDGE)
        self.assertEqual(ctx.raster.at_px(400, 412), Surface.WATER)   # cap pulled back

        ctx = self.context()
        ramp = make_pier("r", "R", [400, 200, 400, 400], 40, sea_end=None)
        stamp_pier(ctx.raster, ramp)
        self.assertEqual(ctx.raster.at_px(400, 412), Surface.BRIDGE)  # cap kept

    def test_a_pier_narrower_than_the_car_is_refused(self):
        ctx = self.context()
        session = self.session({
            "schemaVersion": 1,
            "overrides": [],
            "additions": [feature(
                "new_muelle", "pier",
                {"kind": "line", "points": [[100, 100], [100, 300]]},
                properties={"width": 4},
            )],
            "deletions": [],
        })
        with self.assertRaisesRegex(WorldPatchError, "narrower than the car"):
            session.apply_final(ctx)

    def test_a_pier_can_be_drawn_and_removed(self):
        ctx = self.context()
        pier = make_pier("old_muelle", "Old", [200, 200, 200, 400], 40)
        ctx.piers.append(pier)
        ctx.pier_restores[pier["id"]] = stamp_pier(ctx.raster, pier)
        session = self.session({
            "schemaVersion": 1,
            "overrides": [],
            "additions": [feature(
                "new_muelle", "pier",
                {"kind": "line", "points": [[700, 100], [700, 320]]},
                properties={"width": 40, "style": "timber"},
            )],
            "deletions": ["pier:old_muelle"],
        })
        session.apply_final(ctx)
        self.assertEqual([p["id"] for p in ctx.piers], ["new_muelle"])
        self.assertEqual(ctx.raster.at_px(200, 300), Surface.WATER)
        self.assertEqual(ctx.raster.at_px(700, 200), Surface.BRIDGE)

    def npc_session(self, npc_type, host=None):
        properties = {"npcType": npc_type}
        if host:
            properties["host"] = host
        return self.session({
            "schemaVersion": 1,
            "overrides": [],
            "additions": [feature(
                "crowd_1", "npc", {"kind": "point", "point": [500, 400]},
                properties=properties,
            )],
            "deletions": [],
        })

    def test_an_npc_must_stand_where_its_type_is_allowed(self):
        # The editor checks the SHAPE of an authored NPC; only the build has the
        # raster, so only the build can catch a swimmer standing on asphalt.
        ctx = self.context()
        for col in range(120, 130):
            for row in range(95, 105):
                ctx.raster.set(col, row, Surface.ROAD)
        with self.assertRaisesRegex(WorldPatchError, "may not stand on road"):
            self.npc_session("swimmer").apply_final(ctx)

        ctx = self.context()
        for col in range(120, 130):
            for row in range(95, 105):
                ctx.raster.set(col, row, Surface.WATER)
        self.npc_session("swimmer").apply_final(ctx)
        self.assertEqual(len(ctx.editor_features), 1)

    def test_an_npc_may_belong_to_a_parcel_instead_of_a_surface(self):
        # A fan is allowed on `parcel:stadium`, and the ground under a pitch is
        # ROAD — so the host reference is what makes the placement legal.
        ctx = self.context()
        ctx.parcels.append({"id": "cancha_1", "use": "stadium"})
        for col in range(120, 130):
            for row in range(95, 105):
                ctx.raster.set(col, row, Surface.LAND)
        self.npc_session("fan", {"kind": "parcel", "id": "cancha_1"}).apply_final(ctx)
        self.assertEqual(len(ctx.editor_features), 1)

        ctx = self.context()
        ctx.parcels.append({"id": "jardin_1", "use": "garden"})
        with self.assertRaisesRegex(WorldPatchError, "may not stand on"):
            self.npc_session("fan", {"kind": "parcel", "id": "jardin_1"}).apply_final(ctx)

    def test_an_unknown_npc_type_is_refused(self):
        ctx = self.context()
        with self.assertRaisesRegex(WorldPatchError, "unknown npcType"):
            self.npc_session("astronaut").apply_final(ctx)

    def test_a_semantic_planting_emits_editable_species_and_collision(self):
        bed = feature(
            "patio_nativo", "planting",
            {"kind": "line", "points": [[100, 100], [300, 100]]},
            properties={
                "form": "strip", "align": "horizontal", "widthM": 4,
                "radiusM": 8, "spacingM": 10.4, "mix": "barro",
                "treeKind": "tree", "scale": [0.9, 1.2], "blocks": True,
            },
        )
        session = self.session({
            "schemaVersion": 1, "overrides": [], "additions": [bed], "deletions": [],
        })
        ctx = self.context()
        session.apply_final(ctx)
        self.assertGreater(len(ctx.trees), 1)
        self.assertTrue(all(tree["line"] == "patio_nativo" for tree in ctx.trees))
        self.assertTrue(all(tree["editorId"].startswith("patio_nativo_")
                            for tree in ctx.trees))
        self.assertTrue(all(tree.get("k") in {
            "guanacaste", "cortez", "indio_desnudo", "tempisque",
            "cedro_amargo", "roble_sabana",
        } for tree in ctx.trees))
        self.assertEqual(ctx.raster.at_px(200, 100), Surface.ACERA)

    def test_a_planting_form_cannot_lie_about_its_geometry(self):
        bed = feature(
            "bad_disc", "planting",
            {"kind": "line", "points": [[100, 100], [200, 100]]},
            properties={"form": "disc"},
        )
        with self.assertRaisesRegex(WorldPatchError, "disc requires point"):
            self.session({
                "schemaVersion": 1, "overrides": [],
                "additions": [bed], "deletions": [],
            })

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
