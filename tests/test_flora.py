"""LA ARBOLEDA as data, and the joins that have to hold.

`src/assets/flora.json` says what a species IS (palette, proportions, which form
draws it) and which species each wood plants. Three things can rot silently here,
and all three are invisible in a screenshot because the failure mode is a tree
that simply is not drawn:

  * a species naming a `form` the renderer does not implement;
  * a mix naming a species that does not exist;
  * the BUILDER naming a mix the registry does not have — `service/woods.py`
    writes `cuadra.wood = "altura"` and the renderer looks that up, so a typo on
    either side is a forest that does not grow.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

FLORA = os.path.join(ROOT, "src", "assets", "flora.json")
FLORA_JS = os.path.join(ROOT, "src", "render", "c2d", "flora.js")
WOODS_PY = os.path.join(ROOT, "churchill", "world", "service", "woods.py")
HEX = re.compile(r"^#[0-9a-f]{6}$", re.I)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class FloraRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(FLORA))
        self.species = self.doc["species"]
        self.mixes = {k: v for k, v in self.doc["mixes"].items()
                      if not k.startswith("_")}

    #: Forms drawn by a painter of their OWN rather than through `paintTree`'s
    #: dispatch table, because their signatures carry more than a position: a
    #: palm sways with the clock, a mangle stands in the tide.
    STANDALONE = {"palm": "function paintPalm", "mangrove": "function paintMangrove"}

    def test_every_species_has_a_form_the_renderer_implements(self):
        # `FORMS` is the dispatch table for `paintTree`; a species naming
        # anything not implemented anywhere silently falls back to broadleaf, so
        # a pine would draw as a round tree.
        body = read(FLORA_JS).split("const FORMS = {", 1)[1].split("};", 1)[0]
        forms = set(re.findall(r"(\w+):", body))
        ground = read(os.path.join(ROOT, "src", "render", "c2d", "ground.js"))
        for name, sp in self.species.items():
            form = sp["form"]
            if form in self.STANDALONE:
                needle = self.STANDALONE[form]
                self.assertTrue(needle in read(FLORA_JS) or needle in ground,
                                f"{name} wants form '{form}', whose painter {needle} is gone")
                continue
            self.assertIn(form, forms,
                          f"{name} wants form '{form}', which flora.js has no painter for")

    def test_every_form_is_described(self):
        for name, sp in self.species.items():
            self.assertIn(sp["form"], self.doc["forms"],
                          f"{name}'s form is undocumented in flora.json")

    def test_every_species_is_drawable(self):
        for name, sp in self.species.items():
            self.assertGreater(sp["r"], 0, f"{name} has no crown radius")
            # …except the mangle, which has no trunk at all: it stands on a cage
            # of prop roots, and that IS its silhouette.
            if sp["form"] != "mangrove":
                self.assertGreater(sp["trunkH"], 0, f"{name} has no trunk")
            if sp["form"] == "bare":
                self.assertEqual(sp["canopy"], [], f"{name} is bare and must have no canopy")
                continue
            self.assertGreaterEqual(len(sp["canopy"]), 3,
                                    f"{name}: a crown is a dark/mid/highlight stack")
            for colour in sp["canopy"]:
                self.assertRegex(colour, HEX, f"{name} canopy colour {colour}")
            self.assertRegex(sp["trunk"], HEX, f"{name} trunk colour")

    def test_every_mix_names_species_that_exist(self):
        for mix_name, mix in self.mixes.items():
            self.assertGreater(mix["d"], 0, f"{mix_name} has no density")
            self.assertTrue(mix["weights"], f"{mix_name} plants nothing")
            for name, weight in mix["weights"]:
                self.assertIn(name, self.species,
                              f"mix {mix_name} plants '{name}', which is not a species")
                self.assertGreater(weight, 0, f"mix {mix_name}: {name} has no weight")

    def test_the_builder_only_names_mixes_the_registry_has(self):
        # service/woods.py writes these onto `cuadra.wood`; the renderer looks
        # them up in this registry. A typo either side is a wood that never grows.
        used = set(re.findall(r'mix = "(\w+)"', read(WOODS_PY)))
        self.assertTrue(used, "woods.py assigns no mix — has the shape changed?")
        for name in used:
            self.assertIn(name, self.mixes,
                          f"woods.py assigns mix '{name}', which flora.json has no entry for")

    def test_every_planting_names_species_that_exist(self):
        # The BUILD resolves these (build_stage `_plant`), the woods mixes are
        # resolved by the RENDERER — two ends, one catalog.
        plantings = {k: v for k, v in self.doc["plantings"].items()
                     if not k.startswith("_")}
        self.assertTrue(plantings, "no plantings — has the shape changed?")
        for name, mix in plantings.items():
            for species_name, weight in mix["weights"]:
                self.assertIn(species_name, self.species,
                              f"planting {name} plants '{species_name}', which is not a species")
                self.assertGreater(weight, 0, f"planting {name}: {species_name} has no weight")

    def test_the_builder_only_names_plantings_the_registry_has(self):
        build_stage = read(os.path.join(ROOT, "churchill", "world", "pipeline", "build_stage.py"))
        # CALL SITES ONLY, with the parens BALANCED. `def _plant(..., default=
        # "almendro")` is the helper's own signature — matching it made this
        # demand a planting called "almendro", which is a species — and a lazy
        # `.*?` stops at the first `)`, which is inside `round(tx)`.
        used = set()
        for match in re.finditer(r"(?<!def )_plant\(", build_stage):
            depth, i = 1, match.end()
            while i < len(build_stage) and depth:
                depth += {"(": 1, ")": -1}.get(build_stage[i], 0)
                i += 1
            names = re.findall(r'"(\w+)"', build_stage[match.end():i])
            if names:
                used.add(names[-1])
        self.assertTrue(used, "build_stage plants nothing by name — has `_plant` changed?")
        for name in used:
            self.assertIn(name, self.doc["plantings"],
                          f"build_stage plants '{name}', which flora.json has no planting for")

    def test_every_plant_family_is_in_the_catalog(self):
        # The palma and the mangle were drawn from hardcoded numbers and took
        # their greens from `CANOPY` — the ALMENDRO's array, shared by import —
        # so recolouring one tree would silently have recoloured every frond and
        # every mangrove in the world. A catalog that omits two of the three
        # families it claims to standardise is not a catalog.
        for name in ("palma", "mangle"):
            self.assertIn(name, self.species, f"{name} is drawn but is not a species")

    def test_no_painter_hardcodes_a_plant_palette(self):
        # ground.js must not reach for the arboleda's palette again.
        ground = read(os.path.join(ROOT, "src", "render", "c2d", "ground.js"))
        self.assertNotIn("CANOPY[", ground,
                         "ground.js is indexing the almendro's palette; use its own species row")
        flora = read(FLORA_JS)
        self.assertNotIn("TRUNK_PALM", flora,
                         "the palm's trunk belongs in flora.json, not in a const")

    def test_every_mix_has_a_floor(self):
        # Bare land tan under a wood reads as trees standing on a beach.
        for mix_name, mix in self.mixes.items():
            self.assertIn("floor", mix, f"{mix_name} has no forest floor colour")
