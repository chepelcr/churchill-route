"""LOS HITOS as data, and the line between art and a scene.

`src/assets/world-props.json` says what each landmark type LOOKS like; the world
says where it stands. That used to be a 26-branch `switch` of raw Canvas calls in
`c2d/landmarks.js`, which is the shape `docs/inventory.md` §12 names as the thing
a designer should never have to edit.

THREE TYPES DELIBERATELY STAY IN CODE, and the test asserts that they do:
`lighthouse`, `stadium` and a marine `park` are SCENES, not art. The faro sweeps
a beam on the clock, the estadio clips grass and stands to a footprint the build
emitted, the marine park fills a multi-ring even-odd residual. §12's own "what
should not be converted" list covers exactly these — a Canvas command stream with
unrestricted operations does not become JSON, and pretending otherwise is how a
DSL turns into a worse programming language.

What rots silently here is the same as in the vehicle catalog: a part naming a
shape nobody implements is SKIPPED, so a landmark loses its roof and no error is
raised anywhere.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums import LandmarkType
from tests.shapevocab import implemented_shapes

PROPS = os.path.join(ROOT, "src", "assets", "world-props.json")
SHAPES_JS = os.path.join(ROOT, "src", "render", "c2d", "shapes.js")
LANDMARKS_JS = os.path.join(ROOT, "src", "render", "c2d", "landmarks.js")
HEX = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$", re.I)

#: The types drawn by a scene function rather than from the catalog. Named here
#: so that MOVING one is a deliberate edit to this list, not an accident.
SCENES = {"lighthouse", "stadium", "park"}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class WorldPropTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(PROPS))
        self.props = self.doc["landmarks"]
        self.shapes = implemented_shapes()

    def parts_of(self, name):
        rec = self.props[name]
        if "sameAs" in rec:
            rec = {**self.props[rec["sameAs"]], **rec}
        return rec.get("parts", [])

    def walk(self, parts):
        for part in parts:
            yield part
            if part["shape"] == "repeat":
                yield from self.walk(part["parts"])

    def test_every_landmark_type_is_drawn_somehow(self):
        for kind in LandmarkType:
            if kind.value in SCENES:
                continue
            self.assertIn(kind.value, self.props,
                          f"{kind.value} has no prop record and is not a scene — "
                          f"it would draw nothing at all")

    def test_the_scenes_stay_in_code(self):
        # The other direction: a scene that quietly acquired a catalog record
        # would be drawn TWICE, its art on top of its own geometry.
        js = read(LANDMARKS_JS)
        for name in SCENES:
            self.assertIn(f'lm.type === "{name}"', js,
                          f"{name} lost its escape in drawLandmark")
        for name in SCENES & set(self.props):
            self.assertTrue(self.props[name].get("areaOnly"),
                            f"{name} is a scene; only its area label may be data")

    def test_every_part_names_a_shape_the_interpreter_implements(self):
        for name in self.props:
            for part in self.walk(self.parts_of(name)):
                self.assertIn(part["shape"], self.shapes,
                              f"{name} wants shape '{part['shape']}', which "
                              f"c2d/shapes.js does not implement — it is skipped "
                              f"silently ({sorted(self.shapes)})")

    def test_every_sameAs_points_at_a_record_with_parts(self):
        for name, rec in self.props.items():
            if "sameAs" not in rec:
                continue
            self.assertIn(rec["sameAs"], self.props, f"{name} extends a missing record")
            self.assertTrue(self.props[rec["sameAs"]].get("parts"),
                            f"{name} extends {rec['sameAs']}, which has no parts")

    def test_every_colour_is_a_colour(self):
        for name in self.props:
            for part in self.walk(self.parts_of(name)):
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
