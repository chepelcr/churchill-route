"""LO QUE HAY EN EL MUNDO as data, and the line between art and a scene.

`src/assets/world-props.json` says what each landmark type, each street sign and
each parcel prop LOOKS like; the world says where it stands. Those used to be a
26-branch and a 10-case `switch` of raw Canvas calls in `c2d/landmarks.js` and
`c2d/streets.js`, which is the shape `docs/inventory.md` §12 names as the thing a
designer should never have to edit.

WORLD SCENES STILL SELECT THEIR HOST IN CODE, while their authored identity does
not. `lighthouse`, `stadium` and a marine `park` consume a mapped rim, a traced
footprint or emitted pool anchors; the Faro, fountains and pools execute JSON
parts plus a finite family interpreter shared with the editor. Parcel scenes use
`fit`, clamped scalar slots, `group`, deterministic `scatter` and a closed JSON
formula tree. There are no cathedral/school/fountain/pool identity drawers left.
Tree silhouettes live in flora.json v2.

What rots silently here is the same as in the vehicle catalog: a part naming a
shape nobody implements is SKIPPED, so a landmark loses its roof, a parada loses
its bench, and no error is raised anywhere.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums import LandmarkType, ParcelUse, SignKind
from tests.shapevocab import implemented_shapes

PROPS = os.path.join(ROOT, "src", "assets", "world-props.json")
LANDMARKS_JSON = os.path.join(ROOT, "content", "world", "landmarks.json")
FLORA = os.path.join(ROOT, "src", "assets", "flora.json")
SHAPES_JS = os.path.join(ROOT, "src", "render", "c2d", "shapes.js")
SCENE_SHAPES_JS = os.path.join(ROOT, "src", "render", "c2d", "sceneShapes.js")
LANDMARKS_JS = os.path.join(ROOT, "src", "render", "c2d", "landmarks.js")
STREETS_JS = os.path.join(ROOT, "src", "render", "c2d", "streets.js")
HEX = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$", re.I)

#: The types drawn by a scene function rather than from the catalog. Named here
#: so that MOVING one is a deliberate edit to this list, not an accident.
SCENES = {"lighthouse", "stadium", "park"}

#: Parcel uses drawn by a data scene. The use-to-scene dispatch is data too.
PARCEL_SCENES = {
    "cathedral": "cathedral",
    "civic": "civicBuilding",
    "school": "school",
    "kinder": "school",
    "campus": "school",
    "fuel": "fuel",
    "garden": "garden",
    "park": "garden",
}
DECOR_SCENES = {
    "kiosco": "kiosco",
    "river": "parkRiver",
}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class WorldPropTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(PROPS))
        self.props = self.doc["landmarks"]
        self.signs = self.doc["signs"]
        self.pieces = self.doc["props"]
        self.parcels = self.doc["parcels"]
        self.shapes = implemented_shapes()

    def parts_of(self, name, table=None):
        table = self.props if table is None else table
        rec = table[name]
        if "sameAs" in rec:
            rec = {**table[rec["sameAs"]], **rec}
        return rec.get("parts", [])

    def walk(self, parts):
        for part in parts:
            yield part
            if part.get("parts"):
                yield from self.walk(part["parts"])
            # A `prop` part inlines another record — follow it, or half the
            # catalog goes unchecked the moment anything is shared.
            if part["shape"] == "prop":
                yield from self.walk(self.pieces[part["ref"]]["parts"])

    def every_record(self):
        """(label, parts) for everything the catalog can draw."""
        for name in self.props:
            yield f"landmark {name}", self.parts_of(name)
        for name in self.signs:
            yield f"sign {name}", self.parts_of(name, self.signs)
        for name in self.pieces:
            yield f"prop {name}", self.parts_of(name, self.pieces)
        for name, rec in self.doc["scenes"].items():
            if isinstance(rec, dict) and rec.get("parts"):
                yield f"scene {name}", rec["parts"]
        yield "default landmark shadow", self.doc["defaults"]["landmarkShadow"]["parts"]

    def test_every_landmark_type_is_drawn_somehow(self):
        for kind in LandmarkType:
            if kind.value in SCENES:
                continue
            self.assertIn(kind.value, self.props,
                          f"{kind.value} has no prop record and is not a scene — "
                          f"it would draw nothing at all")

    def test_a_place_may_own_its_art_without_shadowing_a_type(self):
        """`propFor` tries the landmark's ID before its TYPE, so one PLACE can
        look like itself — the Tioga is a long wine block, Las Brisas is a white
        corner, the Capitanía is green wood under red zinc — while every other
        hotel keeps the generic record.

        The two live in ONE namespace, which is the whole hazard: a landmark
        whose id happened to equal a type name would silently repaint every
        place of that type in the world, and nothing would raise."""
        with open(LANDMARKS_JSON, encoding="utf-8") as fh:
            ids = {l["id"] for l in json.load(fh)["landmarks"]}
        types = {k.value for k in LandmarkType}
        self.assertEqual(ids & types, set(),
                         "a landmark id equals a type name — its art would "
                         "replace that whole type's art")
        # …and an id-keyed art record has to belong to a landmark that exists,
        # or it is art nothing can ever select.
        for key, rec in self.props.items():
            if key in types or not isinstance(rec, dict):
                continue
            self.assertIn(key, ids,
                          f"landmark art {key!r} matches no landmark id and no "
                          f"type — nothing will ever draw it")

    def test_world_scene_dispatch_stays_attached_to_mapped_hosts(self):
        # These branches supply mapped host geometry. They select a data scene;
        # they are not permission to put its silhouette back in this module.
        js = read(LANDMARKS_JS)
        for name in SCENES:
            self.assertIn(f'lm.type === "{name}"', js,
                          f"{name} lost its escape in drawLandmark")
        for name in SCENES & set(self.props):
            self.assertTrue(self.props[name].get("areaOnly"),
                            f"{name} is a scene; only its area label may be data")

    def test_every_part_names_a_shape_the_interpreter_implements(self):
        for name, parts in self.every_record():
            for part in self.walk(parts):
                self.assertIn(part["shape"], self.shapes,
                              f"{name} wants shape '{part['shape']}', which "
                              f"c2d/shapes.js does not implement — it is skipped "
                              f"silently ({sorted(self.shapes)})")

    def test_every_prop_reference_resolves(self):
        # An unresolved `ref` is not an error at draw time: `propParts` returns
        # undefined and the interpreter simply draws nothing where the parroquia
        # or the caseta was.
        for name, parts in self.every_record():
            for part in parts:
                if part["shape"] != "prop":
                    continue
                self.assertIn(part["ref"], self.pieces,
                              f"{name} inlines prop '{part['ref']}', which does "
                              f"not exist — it would draw nothing")

    def test_every_sameAs_points_at_a_record_with_parts(self):
        for name, rec in self.props.items():
            if "sameAs" not in rec:
                continue
            self.assertIn(rec["sameAs"], self.props, f"{name} extends a missing record")
            self.assertTrue(self.props[rec["sameAs"]].get("parts"),
                            f"{name} extends {rec['sameAs']}, which has no parts")

    def test_every_colour_is_a_colour(self):
        for name, parts in self.every_record():
            for part in self.walk(parts):
                specs = [part.get("fill"), part.get("stroke"), part.get("fg"), part.get("bg")]
                for spec in specs + list(part.get("palette", [])):
                    for one in (spec if isinstance(spec, list) else [spec]):
                        if isinstance(one, str) and not one.startswith("$"):
                            self.assertRegex(one, HEX, f"{name}: bad colour {one}")

    def test_the_anchors_stroke_grouping_is_preserved(self):
        """The one that cost a measurement.

        Two `stroke()` calls that overlap composite their antialiased edges
        TWICE; one merged path does not. Collapsing the anchor's shank, stock
        and arms into a single `stroke` part lightened every crossing by ~30
        levels — 384 pixels, all of them exactly where the stock meets the shank
        and where the arms do. So the grouping is content, not formatting.
        """
        strokes = [p for p in self.parts_of("anchor") if p["shape"] == "stroke"]
        self.assertGreaterEqual(len(strokes), 3,
                                "the anchor's strokes have been merged; its "
                                "crossings will render lighter than they did")

    def test_no_switch_on_landmark_type_came_back(self):
        js = read(LANDMARKS_JS)
        self.assertNotIn("switch (lm.type)", js,
                         "landmarks.js branches on the type again; the catalog "
                         "decides what a landmark looks like")

    # ------------------------------------------------------------- signs ----

    def test_every_sign_kind_has_a_record(self):
        for kind in SignKind:
            self.assertIn(kind.value, self.signs,
                          f"{kind.value} has no record in `signs` — drawSign "
                          f"returns early and it draws nothing at all")

    def test_no_switch_on_sign_kind_came_back(self):
        js = read(STREETS_JS)
        self.assertNotIn("switch (s.kind)", js,
                         "streets.js branches on the kind again; the catalog "
                         "decides what a sign looks like")

    def test_a_turning_sign_says_so(self):
        """The one a catalog cannot infer.

        Six of the ten are drawn INSIDE a rotation by the angle the world
        measured against the kerb — the promenade's normal for a banca, the lane
        heading for a zebra, `seat_bus_stops`' kerb angle for a parada. A record
        that loses `turn` still draws; it draws square to the SCREEN, on a
        cuadrícula that is not square to the screen, which reads as furniture in
        the wrong street rather than as a bug.
        """
        for kind in ("banca", "crossing", "tope", "speed_limit",
                     "semaforo_centered", "semaforo_overhead", "bus"):
            self.assertTrue(self.signs[kind].get("turn"),
                            f"{kind} lost its `turn` and will be drawn square "
                            f"to the screen")

    def test_only_the_parada_flips_to_the_far_kerb(self):
        # `flip: "side"` reads a field only the seated bus stops carry; on
        # anything else it would silently mean nothing.
        flipped = [k for k, r in self.signs.items() if r.get("flip")]
        self.assertEqual(flipped, ["bus"])

    # ----------------------------------------------------------- parcels ----

    def test_every_parcel_use_the_catalog_names_is_a_real_use(self):
        for use in self.parcels["uses"]:
            self.assertIn(use, {u.value for u in ParcelUse},
                          f"`{use}` is not a ParcelUse — nothing will ever look "
                          f"it up")

    def test_parcel_uses_dispatch_to_complete_json_scenes(self):
        for use, scene in PARCEL_SCENES.items():
            self.assertEqual(self.parcels["uses"][use].get("scene"), scene,
                             f"{use} does not name its scene in JSON")
            self.assertTrue(self.doc["scenes"][scene].get("parts"),
                            f"{use}'s scene {scene} has no parts")
            self.assertIsNone(self.parcels["uses"].get(use, {}).get("prop"),
                              f"{use} is a scene; a `prop` on it "
                              f"would be drawn on top of its own building")

    def test_parcel_decor_dispatches_to_json_scenes(self):
        for feature, scene in DECOR_SCENES.items():
            self.assertEqual(self.parcels["decor"][feature].get("scene"), scene)
            self.assertTrue(self.doc["scenes"][scene].get("parts"),
                            f"scenes.{scene} has no parts")

    def test_no_parcel_asset_has_an_identity_drawer_left(self):
        js = re.sub(r"/\*.*?\*/", "", read(LANDMARKS_JS), flags=re.S)
        js = re.sub(r"^\s*//.*$", "", js, flags=re.M)
        for drawer in ("drawCathedral", "drawCivicBuilding", "drawSchool",
                       "drawFuel", "drawGarden", "drawKiosco", "drawParkRiver"):
            self.assertNotIn(drawer, js,
                             f"{drawer} makes code, not world-props.json, the asset authority")
        self.assertNotRegex(js, r'P\.use\s*===\s*"(?:cathedral|civic|school|fuel|garden)"')

    def test_scene_flora_identity_is_authored_not_a_renderer_default(self):
        flora = json.loads(read(FLORA))
        for scene_name, scene in self.doc["scenes"].items():
            if not isinstance(scene, dict):
                continue
            for part in self.walk(scene.get("parts", [])):
                if part.get("paint") != "tree":
                    continue
                self.assertIn("species", part,
                              f"scenes.{scene_name} relies on paintTree's hidden default")
                self.assertIn(part["species"], flora["species"],
                              f"scenes.{scene_name} names missing flora species")

    def test_procedural_world_scenes_use_the_finite_shared_interpreter(self):
        expected = {
            "riprap", "flora-placements", "lighthouse-tower",
            "fountain-water", "pool-water",
        }
        used = set()
        for scene in self.doc["scenes"].values():
            if not isinstance(scene, dict):
                continue
            for part in self.walk(scene.get("parts", [])):
                if part.get("shape") == "family":
                    used.add(part.get("verb"))
        self.assertEqual(used, expected)
        interpreter = read(SCENE_SHAPES_JS)
        for verb in used:
            self.assertIn(f'"{verb}"', interpreter)
        landmarks = read(LANDMARKS_JS)
        for scene in ("faro", "fountain", "pool", "lote"):
            self.assertIn(f'paintSceneParts(ctx, PROPS, "{scene}"', landmarks)

    def test_scene_interpreter_owns_no_authored_colours(self):
        js = re.sub(r"/\*.*?\*/", "", read(SCENE_SHAPES_JS), flags=re.S)
        js = re.sub(r"^\s*//.*$", "", js, flags=re.M)
        self.assertNotRegex(js, r"#[0-9a-fA-F]{3,8}|rgba?\(\s*\d")

    def test_scene_formula_trees_use_only_the_exported_finite_vocabulary(self):
        shapes = read(SHAPES_JS)
        block = shapes.split("export const ASSET_FORMULA_OPS", 1)[1].split("]", 1)[0]
        operators = set(re.findall(r'"([a-z]+)"', block))
        host = {"hw", "hh", "cx", "cy", "x0", "y0", "use", "whole", "decor",
                "hasKiosco", "hasStatue", "hasFountain"}

        for scene_name, scene in self.doc["scenes"].items():
            if not isinstance(scene, dict):
                continue
            definitions = scene.get("values", {})
            known = host | set(definitions)

            def walk(node, where):
                if isinstance(node, (str, int, float, bool)) or node is None:
                    return
                self.assertIsInstance(node, dict, f"{where} is executable/unknown syntax")
                if "ref" in node:
                    self.assertEqual(set(node), {"ref"}, where)
                    self.assertIn(node["ref"], known, f"{where} references a missing value")
                    return
                self.assertEqual(set(node), {"op", "args"}, where)
                self.assertIn(node["op"], operators, f"{where} names an engine op that is absent")
                self.assertIsInstance(node["args"], list, where)
                for index, child in enumerate(node["args"]):
                    walk(child, f"{where}.{node['op']}[{index}]")

            for name, formula in definitions.items():
                walk(formula, f"scenes.{scene_name}.values.{name}")

    def test_interpreters_do_not_own_asset_colours(self):
        for path in (SHAPES_JS, LANDMARKS_JS):
            js = re.sub(r"/\*.*?\*/", "", read(path), flags=re.S)
            js = re.sub(r"^\s*//.*$", "", js, flags=re.M)
            self.assertNotRegex(js, r"#[0-9a-fA-F]{3,8}|rgba?\(\s*\d",
                                f"{os.path.basename(path)} owns an authored colour")

    def test_a_use_that_draws_its_own_building_has_something_to_draw(self):
        """`drawsBuilding` SUPPRESSES the landmark's art.

        Setting it on a use with neither a prop nor a scene leaves the landmark
        with only its name pill — bare ground under a caption, which is exactly
        the trap the `market` comment in landmarks.js records.
        """
        for use, rec in self.parcels["uses"].items():
            if not rec.get("drawsBuilding"):
                continue
            self.assertTrue(rec.get("prop") or rec.get("scene"),
                            f"{use} claims to draw its own building but has "
                            f"neither a prop nor a scene — the landmark's art "
                            f"is suppressed and nothing replaces it")

    def test_a_scaled_prop_carries_the_size_it_was_drawn_at(self):
        # `fit` is the half-width the art is authored for; without it the scale
        # is `hw / undefined` = NaN, and a NaN scale silently draws nothing.
        for use, rec in self.parcels["uses"].items():
            if rec.get("prop"):
                self.assertIsInstance(rec.get("fit"), (int, float),
                                      f"{use} has a prop and no `fit`")
