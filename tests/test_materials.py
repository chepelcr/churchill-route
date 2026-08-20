"""LOS MATERIALES — one registry for the families that are not surfaces.

`src/assets/surfaces.json` closed the surface half of this on 2026-08-11 and the
audit (`docs/inventory.md` §13) left the rest open: parcels, greens, piers,
street inks, structures and the minimap. This is that rest.

WHAT BELONGS HERE IS MEASURED, NOT ASSUMED. The register said "duplicated
Canvas/Pixi/editor colors"; scanning the tree found `canvas ∩ pixi = 0` — the
Pixi backend has had no hex literals since it started reading `surfaces.json` —
and `canvas ∩ editor = 40`. Of those 40, several only SHARE A NUMBER: `#e85d75`
is the scooter's paint, a feria cabin and the editor's default feature colour.
§13's own rule says an identical number in two files is not one constant, so
those stay where they are; merging them would only move the hard-coding.

Three failures this guards, all of which have actually happened here:

  * a value the builder EMITS with no material to draw it — `malecon` shipped
    for a week as a `PierStyle` with no recipe, and the lookup fell through to
    `concrete`, so four beach ramps were drawn as grey quays with blue railings
    and lamps, lying on the sand. Nothing threw;
  * a family table growing a second copy somewhere else, which is how every
    drift in this audit began;
  * the minimap restating a colour it should be reading — two of its inks were
    literally the pier decks, with a comment pointing at the file it copied.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums import GreenType, ParcelUse, PierStyle

MATERIALS = os.path.join(ROOT, "src", "assets", "materials.json")
STRUCTURES = os.path.join(ROOT, "src", "render", "c2d", "structures.js")
STRUCTURE_SHAPES = os.path.join(ROOT, "src", "render", "c2d", "structureShapes.js")
HEX = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$", re.I)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def rows(table):
    """A family's real entries — `_`-prefixed keys are prose for the reader."""
    return {k: v for k, v in table.items() if not k.startswith("_")}


class MaterialRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(MATERIALS))

    def test_every_parcel_use_has_a_ground(self):
        have = rows(self.doc["parcel"])
        for use in ParcelUse:
            self.assertIn(use.value, have,
                          f"parcel use {use.value} has no ground colour — it would "
                          f"draw as bare land, which is what `market` did in the editor")

    def test_every_green_type_has_a_fill(self):
        have = rows(self.doc["green"])
        for green in GreenType:
            self.assertIn(green.value, have, f"green type {green.value} has no fill")

    def test_every_pier_style_has_a_complete_recipe(self):
        # The one that shipped broken. A style is not just a colour: an unknown
        # one falls through to `concrete` and gets ITS rails, lamps and hut.
        have = rows(self.doc["pier"])
        for style in PierStyle:
            self.assertIn(style.value, have, f"pier style {style.value} has no recipe")
            recipe = have[style.value]
            for field in ("deck", "seam", "cap", "rail", "centre"):
                self.assertIn(field, recipe,
                              f"pier {style.value} does not say what its {field} is "
                              f"(null is an answer; missing is not)")
            self.assertRegex(recipe["deck"], HEX, f"pier {style.value} deck")

    def test_every_colour_is_a_colour(self):
        for family, table in self.doc.items():
            if family.startswith("_") or family == "version":
                continue
            for key, value in rows(table).items():
                if isinstance(value, str):
                    if key.endswith("Note"):
                        continue
                    self.assertRegex(value, HEX, f"{family}.{key}")

    def test_the_minimap_reads_the_pier_recipes_rather_than_copying_them(self):
        # `MINI_PIER` and `MINI_JETTY` were the concrete and timber decks
        # written out again, with a comment naming the file they came from.
        hud = read(os.path.join(ROOT, "src", "render", "c2d", "hud.js"))
        self.assertIn("MATERIALS.pier.concrete.deck", hud)
        self.assertIn("MATERIALS.pier.timber.deck", hud)
        for deck in (self.doc["pier"]["concrete"]["deck"], self.doc["pier"]["timber"]["deck"]):
            self.assertNotIn(deck, hud, f"the minimap restates {deck} instead of reading it")

    #: A family table written as a literal. Each pattern is one of the tables
    #: this file absorbed, so a reappearance is a genuine regression rather than
    #: a stylistic complaint.
    FORBIDDEN = (
        (r"const PARCEL_FILL\s*=\s*\{\s*\w+\s*:", "a parcel→colour table"),
        (r"const GREEN_COLORS\s*=\s*\{\s*\w+\s*:", "a green→colour table"),
        (r"const PIER_STYLES\s*=\s*\{\s*\w+\s*:", "a pier→recipe table"),
        (r"const SURFACE_PRESET_COLORS\s*=\s*\{\s*\w+\s*:", "a terrain preset table"),
    )

    def test_no_module_grows_its_own_copy_back(self):
        for dirpath, _, files in os.walk(os.path.join(ROOT, "src")):
            if "tiles" in dirpath:
                continue
            for name in sorted(files):
                if not name.endswith((".js", ".jsx")):
                    continue
                path = os.path.join(dirpath, name)
                text = read(path)
                rel = os.path.relpath(path, ROOT)
                for pattern, why in self.FORBIDDEN:
                    self.assertIsNone(re.search(pattern, text),
                                      f"{rel} authors {why}; materials.json owns it")

    def test_building_bridge_ferry_and_berth_are_editable_recipes(self):
        structures = self.doc["structure"]
        for asset in ("building", "bridge", "ferry", "berth"):
            with self.subTest(asset=asset):
                self.assertTrue(structures[asset].get("parts"))
                self.assertIsInstance(structures[asset].get("preview"), dict)
        painter = read(STRUCTURES)
        self.assertIn("paintStructureParts(ctx, S.building.parts", painter)
        self.assertIn("paintStructureParts(ctx, S.bridge.parts", painter)

    def test_double_ended_ferry_has_equivalent_ramps_at_both_ends(self):
        ferry = self.doc["structure"]["ferry"]
        self.assertTrue(ferry["preview"]["doubleEnded"])
        hull = next(part for part in ferry["parts"]
                    if part.get("shape") == "group" and not part.get("when")
                    and any(child.get("fill") == "$ramp" for child in part.get("parts", [])))
        ramps = [part for part in hull["parts"] if part.get("fill") == "$ramp"]
        self.assertEqual(len(ramps), 2, "a double-ended ferry needs one ramp at each end")
        for field in ("y", "w", "h", "r"):
            self.assertEqual(ramps[0][field], ramps[1][field],
                             f"the two ferry ramps disagree on {field}")
        # Rect x is its left edge. These two formulas put equal-width ramps at
        # centres -L-3 and +L+3: mirrored, not a decorative stern door.
        self.assertEqual(ramps[0]["x"], [-1, -9])
        self.assertEqual(ramps[1]["x"], [1, -3])

    def test_structure_family_verbs_are_finite_and_implemented(self):
        verbs = set()
        def walk(parts):
            for part in parts or []:
                if part.get("shape") == "family":
                    verbs.add(part.get("verb"))
                walk(part.get("parts"))
        for record in self.doc["structure"].values():
            if isinstance(record, dict):
                walk(record.get("parts"))
        interpreter = read(STRUCTURE_SHAPES)
        for verb in verbs:
            self.assertIn(f'"{verb}"', interpreter)

    def test_renderer_contains_no_authored_colour_literals(self):
        """The renderer composes registries; it must not become another one.

        Dynamic ``rgba(${rgb},${alpha})`` assembly is engine behaviour. A hex or
        numeric rgba literal in ``src/render`` is an authored ink with no editor
        surface and therefore a second source of truth.
        """
        colour = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.,\s]+\)")
        for dirpath, _, files in os.walk(os.path.join(ROOT, "src", "render")):
            for name in files:
                if not name.endswith((".js", ".jsx")):
                    continue
                path = os.path.join(dirpath, name)
                source = re.sub(r"/\*.*?\*/", "", read(path), flags=re.S)
                source = re.sub(r"^\s*//.*$", "", source, flags=re.M)
                found = colour.findall(source)
                self.assertEqual(found, [],
                                 f"{os.path.relpath(path, ROOT)} authors colours {found}; "
                                 "move them to the relevant JSON registry")
