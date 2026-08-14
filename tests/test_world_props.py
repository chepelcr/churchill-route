"""LO QUE HAY EN EL MUNDO as data, and the line between art and a scene.

`src/assets/world-props.json` says what each landmark type, each street sign and
each parcel prop LOOKS like; the world says where it stands. Those used to be a
26-branch and a 10-case `switch` of raw Canvas calls in `c2d/landmarks.js` and
`c2d/streets.js`, which is the shape `docs/inventory.md` §12 names as the thing a
designer should never have to edit.

SOME THINGS DELIBERATELY STAY IN CODE, and the test asserts that they do.
`lighthouse`, `stadium` and a marine `park` are SCENES, not art: the faro sweeps
a beam on the clock, the estadio clips grass and stands to a footprint the build
emitted, the marine park fills a multi-ring even-odd residual. So are the seven
parcel buildings — every one of them sizes ITSELF from the parcel's own
half-extents through clamps and counts, which would need arithmetic in JSON.
§12's own "what should not be converted" list covers exactly these — a Canvas
command stream with unrestricted operations does not become JSON, and pretending
otherwise is how a DSL turns into a worse programming language.

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
SHAPES_JS = os.path.join(ROOT, "src", "render", "c2d", "shapes.js")
LANDMARKS_JS = os.path.join(ROOT, "src", "render", "c2d", "landmarks.js")
STREETS_JS = os.path.join(ROOT, "src", "render", "c2d", "streets.js")
HEX = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$", re.I)

#: The types drawn by a scene function rather than from the catalog. Named here
#: so that MOVING one is a deliberate edit to this list, not an accident.
SCENES = {"lighthouse", "stadium", "park"}

#: The parcel uses whose building is still a scene, and the drawer that owns it.
#: Same list as the catalog's `_parcelScenes`, and for the same reason: each one
#: derives its own size, its own pavilion count or its own scatter FROM THE
#: PARCEL. Moving one here without moving the code is what this pins.
PARCEL_SCENES = {
    "cathedral": "drawCathedral",
    "civic": "drawCivicBuilding",
    "school": "drawSchool",
    "kinder": "drawSchool",
    "campus": "drawSchool",
    "fuel": "drawFuel",
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
            if part["shape"] == "repeat":
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

    def test_the_parcel_buildings_that_are_scenes_stay_in_code(self):
        # The other direction from `_parcelScenes`: giving one of these a `prop`
        # would draw the catalog art AND the scene, one on top of the other.
        js = read(LANDMARKS_JS)
        for use, drawer in PARCEL_SCENES.items():
            self.assertIn(f"function {drawer}(", js,
                          f"{use}'s {drawer} is gone from landmarks.js")
            self.assertIsNone(self.parcels["uses"].get(use, {}).get("prop"),
                              f"{use} is a scene ({drawer}); a `prop` on it "
                              f"would be drawn on top of its own building")

    def test_a_use_that_draws_its_own_building_has_something_to_draw(self):
        """`drawsBuilding` SUPPRESSES the landmark's art.

        Setting it on a use with neither a prop nor a scene leaves the landmark
        with only its name pill — bare ground under a caption, which is exactly
        the trap the `market` comment in landmarks.js records.
        """
        for use, rec in self.parcels["uses"].items():
            if not rec.get("drawsBuilding"):
                continue
            self.assertTrue(rec.get("prop") or use in PARCEL_SCENES,
                            f"{use} claims to draw its own building but has "
                            f"neither a prop nor a drawer — the landmark's art "
                            f"is suppressed and nothing replaces it")

    def test_a_scaled_prop_carries_the_size_it_was_drawn_at(self):
        # `fit` is the half-width the art is authored for; without it the scale
        # is `hw / undefined` = NaN, and a NaN scale silently draws nothing.
        for use, rec in self.parcels["uses"].items():
            if rec.get("prop"):
                self.assertIsInstance(rec.get("fit"), (int, float),
                                      f"{use} has a prop and no `fit`")
