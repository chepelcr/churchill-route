"""LA LUMINARIA COMO DATA — y la mitad que se queda en el motor.

Una luz era el caso más claro de familia partida por la mitad: su POSICIÓN se
autora en el editor desde que existen los editor features, pero lo que era —el
color del núcleo, el del halo, el alto del mástil, el tamaño de la cabeza, el
radio— vivía en `lightPalette()`, un if/else de cuatro ramas, más seis ternarios
sobre `type === "stadium"`. Se podía poner una luz donde uno quisiera y no se
podía diseñar una quinta.

Lo que estas pruebas fijan es el corte:

* la IDENTIDAD es `LightType`, generado, como toda otra vocabulario del mundo;
* las PROPIEDADES son `src/assets/lights.json`, igual que `surfaces.json` hace
  con una clase de superficie;
* el HALO —sólo de noche, y un gradiente radial, que no es una forma del
  vocabulario— es comportamiento y se queda en `c2d/lights.js`.

Y una regresión con nombre y apellido: las tres farolas de calle tienen que
salir PIXEL POR PIXEL como salían del if/else. La torre de estadio cambia a
propósito y es lo único que cambia.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums.game import LightType
from tests.shapevocab import implemented_shapes

LIGHTS_JSON = os.path.join(ROOT, "src", "assets", "lights.json")
LIGHTS_JS = os.path.join(ROOT, "src", "render", "c2d", "lights.js")
EDITOR_JS = os.path.join(ROOT, "src", "render", "c2d", "editorWorld.js")
PROPS_JSON = os.path.join(ROOT, "src", "assets", "world-props.json")

#: The three that must not move. A `stadium` fixture is deliberately absent:
#: turning it into a real four-lamp tower is the point of the change.
STREET_LAMPS = ("warm", "led", "amber")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def source(path):
    """A JS file with its comments stripped.

    Every scan in this repo that skipped this step matched its own prose: a
    check for `Math.random` found the sentence explaining why there is none, and
    a check for a hard-coded colour found the paragraph naming the four it had
    just deleted. Three separate tests learned this the same way.
    """
    return re.sub(r"^\s*//.*$", "", read(path), flags=re.M)


class LightRegistryTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(read(LIGHTS_JSON))
        self.types = self.data["types"]

    def test_the_enum_and_the_registry_agree_exactly(self):
        """Neither side may hold a type the other does not.

        A `LightType` with no record draws nothing — `paintLight` falls back to
        the street lamp, so a designed light silently becomes a different one.
        A record with no enum member is worse in the other direction: the editor
        offers a type the vocabulary does not admit.
        """
        self.assertEqual(
            set(self.types), {member.value for member in LightType},
            "lights.json and LightType disagree; run pnpm vocabulary and add the record")

    def test_every_part_names_a_shape_the_interpreter_implements(self):
        """The failure this catches is SILENT: `paintParts` skips an unknown
        shape rather than throwing, so a bad name ships as a lamp with no head
        and nothing in the console."""
        known = implemented_shapes()

        def walk(parts, where):
            for part in parts:
                self.assertIn(part["shape"], known, f"{where}: unknown shape {part['shape']!r}")
                if "parts" in part:
                    walk(part["parts"], f"{where}/{part['shape']}")

        for name, spec in self.types.items():
            walk(spec["parts"], name)

    def test_every_type_carries_the_fields_the_painter_reads(self):
        for name, spec in self.types.items():
            with self.subTest(light=name):
                self.assertRegex(spec["core"], r"^#[0-9a-f]{3,8}$", "core must be a hex colour")
                self.assertEqual(len(spec["halo"]), 3, "halo is an RGB triple, not a colour string")
                for channel in spec["halo"]:
                    self.assertTrue(0 <= channel <= 255, f"halo channel out of range: {channel}")
                self.assertGreater(spec["radius"], 0)
                self.assertEqual(len(spec["haloAt"]), 2)

    def test_the_halo_is_a_triple_because_its_alpha_was_dead(self):
        """The four old `rgba(...)` glows carried .34/.42/.32 — and NONE of them
        ever reached the canvas: the painter overwrote the alpha with
        `glow.replace(/[\\d.]+\\)$/, …)` before using it. They were four numbers
        that looked adjustable and were not. Storing the triple is what makes
        that impossible to reintroduce, so no record may hold an rgba glow."""
        for name, spec in self.types.items():
            with self.subTest(light=name):
                self.assertIsInstance(spec["halo"], list, f"{name}: halo must be [r,g,b]")

    def test_the_core_reaches_the_lamps_through_a_placeholder(self):
        """`$core` is the vehicle catalog's `$color`, and it is what makes ONE
        field light all four lamps of a tower. A record whose parts spell the
        colour out instead has as many knobs as it has lamps."""
        for name, spec in self.types.items():
            with self.subTest(light=name):
                self.assertIn("$core", json.dumps(spec["parts"]),
                              f"{name}: no part uses $core, so `core` is decorative")


class StreetLampRegressionTests(unittest.TestCase):
    """The three street lamps come out of the registry exactly as they came out
    of the if/else. Written as the numbers themselves rather than as a diff,
    because the diff is only as good as the sheet it was taken from."""

    def setUp(self):
        self.types = json.loads(read(LIGHTS_JSON))["types"]

    def test_the_mast_and_the_head_are_the_old_geometry(self):
        for name in STREET_LAMPS:
            with self.subTest(light=name):
                mast, head = self.types[name]["parts"]
                self.assertEqual(mast["shape"], "stroke")
                self.assertEqual(mast["stroke"], "#3f4648")
                self.assertEqual(mast["width"], 1.4)
                self.assertEqual(mast["pts"], [[0, 8], [0, -10]])
                self.assertEqual(head["shape"], "roundRect")
                self.assertEqual(
                    [head["x"], head["y"], head["w"], head["h"], head["r"]], [-3, -13, 6, 4, 1])

    def test_the_halo_still_sits_where_it_sat(self):
        """(x, y − 10) for every street lamp, and radius 46. The tower's moved
        to the lamps at y − 29, which is the one intended change: at 33 px of
        mast a glow at the base comes out of the concrete."""
        for name in STREET_LAMPS:
            with self.subTest(light=name):
                self.assertEqual(self.types[name]["haloAt"], [0, -10])
                self.assertEqual(self.types[name]["radius"], 46)
        self.assertEqual(self.types["stadium"]["haloAt"][1], -29)

    def test_the_alpha_curve_is_the_old_one(self):
        alpha = json.loads(read(LIGHTS_JSON))["haloAlpha"]
        self.assertEqual(alpha["perUnit"], 0.24)
        self.assertEqual(alpha["max"], 0.75)

    def test_the_clamps_are_the_old_ones(self):
        limits = json.loads(read(LIGHTS_JSON))["limits"]
        self.assertEqual(
            [limits["radiusMin"], limits["radiusMax"], limits["intensityMax"]], [10, 240, 4])


class LightPainterTests(unittest.TestCase):
    """What must NOT be in the painter — the branch it replaced."""

    def test_no_colour_literal_survives_in_the_light_painter(self):
        """Except the one that is not a colour choice: the gradient's outer stop
        is fully transparent, so which white it fades from cannot be seen."""
        src = source(LIGHTS_JS)
        found = set(re.findall(r"#[0-9a-fA-F]{3,8}\b", src))
        # Only LITERAL colours — `rgba(` followed by numbers. The painter also
        # ASSEMBLES one from the registry's channels (`rgba(${r},${g},${b},…)`),
        # and that is the engine doing its job: a gradient stop is not a shape
        # the vocabulary has, so building the string is exactly what is left
        # here after the palette moved out.
        found |= {m for m in re.findall(r"rgba?\(\s*[\d.,\s]+\)", src)
                  if "255,255,255,0)" not in m}
        self.assertEqual(found, set(), f"colours belong in lights.json: {sorted(found)}")

    def test_the_four_branch_palette_is_gone(self):
        for path in (LIGHTS_JS, EDITOR_JS):
            with self.subTest(file=os.path.basename(path)):
                self.assertNotIn("lightPalette", source(path))

    def test_no_type_is_branched_on_in_the_painter(self):
        """The geometry used to be six ternaries on `type === "stadium"`. A
        registry that still asks which type it is has not replaced anything —
        it has added a file to the same branch."""
        src = source(LIGHTS_JS)
        for member in LightType:
            # A COMPARISON, not a mention. `FALLBACK = "warm"` is a lookup key
            # and `drawLight`'s legacy default resolves which type an untyped
            # editor feature MEANS — neither decides what anything looks like.
            # A `type === "stadium"` does, and that is the thing that left.
            self.assertNotRegex(src, rf'===?\s*"{member.value}"',
                                f"the painter still branches on the {member.value} type")

    def test_the_editor_no_longer_draws_a_light_itself(self):
        """`editorWorld.js` keeps WHERE a light stands, which was always the
        half that worked, and imports what it looks like."""
        src = source(EDITOR_JS)
        self.assertIn("drawLight", src)
        self.assertNotIn("createRadialGradient", src)

    def test_night_is_behaviour_and_stayed_in_code(self):
        self.assertIn("night", source(LIGHTS_JS))
        self.assertNotIn("weather", read(LIGHTS_JSON))


class FieldTowerTests(unittest.TestCase):
    """Las torres de cancha: dónde se paran es `world-props.json`, qué son es
    `lights.json`. La juntura es el `type`."""

    def setUp(self):
        self.props = json.loads(read(PROPS_JSON))
        self.towers = self.props["scenes"]["stadium"]["towers"]
        self.lights = json.loads(read(LIGHTS_JSON))["types"]

    def test_the_tower_names_a_light_type_that_exists(self):
        kinds = {self.towers["type"]}
        kinds |= {own["type"] for own in self.towers["byLandmark"].values() if "type" in own}
        for kind in kinds:
            self.assertIn(kind, self.lights, f"towers name a light type nobody designed: {kind}")

    def test_both_stadiums_get_towers(self):
        """The same two the gradería covers — a lit stand and an unlit pitch
        beside it would read as two different places."""
        stands = self.props["scenes"]["stadium"]["stands"]["byLandmark"]
        self.assertEqual(set(self.towers["byLandmark"]), set(stands))

    def test_the_corner_is_the_polygons_and_not_the_bboxs(self):
        """A cuadra here is not square to the screen (the avenidas run -5.4° and
        the calles 82.3°), so a bbox corner on a skewed block lands off the
        pitch — the same trap `standEdge` documents for an edge, and the same
        one `P.ang` exists for."""
        src = source(LIGHTS_JS)
        self.assertIn("polyCorner", src)
        self.assertNotIn("polyBBox", src)

    def test_the_tower_is_built_from_the_emitted_footprint(self):
        """No geometry of its own — that is what lets ONE record light two
        stadiums whose blocks are different shapes."""
        self.assertIn("lm.footprint", source(LIGHTS_JS))
        # The DATA, never the prose. `_note` explains that the towers are built
        # from the footprint, and a scan of the whole blob matches its own
        # explanation — the trap three other tests in this repo fell into.
        data = {k: v for k, v in self.towers.items() if not k.startswith("_")}
        self.assertNotIn("footprint", json.dumps(data))

    def test_the_stadium_fixture_is_a_tower_and_not_a_bigger_street_lamp(self):
        """It was: a mast of 18 px with a 10×4 head — the same street lamp,
        wider. A tower is a mast with a crossbar of four floodlights, and the
        four are why it is a member of the enum rather than a radius."""
        spec = self.lights["stadium"]
        repeats = [p for p in spec["parts"] if p["shape"] == "repeat"]
        lamps = [p for p in repeats if p["n"] == 4]
        self.assertTrue(lamps, "the stadium fixture has no four-lamp crossbar")
        self.assertIn("$core", json.dumps(lamps[0]["parts"]))

    def test_the_lamps_are_centred_on_the_mast(self):
        """`repeat` has no initial offset — copy 0 draws at the sub-list's own
        coordinates — so centring the row is a matter of where the first lamp is
        written. Getting this wrong hangs the whole crossbar off one side, which
        looks like a design choice rather than a bug."""
        spec = self.lights["stadium"]
        row = next(p for p in spec["parts"] if p["shape"] == "repeat" and p["n"] == 4)
        head = next(p for p in row["parts"] if p["shape"] == "roundRect")
        span_left = head["x"]
        span_right = head["x"] + row["dx"] * (row["n"] - 1) + head["w"]
        self.assertAlmostEqual(span_left + span_right, 0, places=6,
                               msg=f"lamps span {span_left}..{span_right}, not centred on 0")


if __name__ == "__main__":
    unittest.main()
