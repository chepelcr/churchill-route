"""LAS SIEMBRAS — the derived planting runs, and what makes one editable.

The Paseo's palm median, the León Cortés strip, the Ferrocarril shoulder and the
Cocal divided-avenue median are all DERIVED in `pipeline/build_stage.py`: from
the streets named after the Paseo, from a measured cuadra corner, from the normal
to a centreline. That derivation is the good part — it survives a rescale, which
a hand-placed coordinate does not, and this repo has twice found a corridor-era
px anchor still sitting in the builder pointing 15 000 px away from anything.

What it cost was identity. Every one of these is emitted as LOOSE TREES, and the
editor derives a tree's id from its geometry — so a human could hide one tree of
the Ferrocarril shoulder and never the shoulder. `line` is the fix: it names the
run a plant belongs to, and the editor aggregates one source per run.

Three things this guards:

  * a run losing its `line` (the plants are still drawn, so nothing looks wrong —
    the run just silently stops being addressable);
  * a `line` value the editor has no name for, which would surface as a raw slug
    in somebody's sidebar;
  * the SCATTERED plantings acquiring one, which would invent a line that is not
    there — the patio trees belong to no run and must stay anonymous.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

BUILD_STAGE = os.path.join(ROOT, "churchill", "world", "pipeline", "build_stage.py")
EDITOR_CFG = os.path.join(ROOT, "world-editor", "vite.config.js")
FLORA = os.path.join(ROOT, "src", "assets", "flora.json")
MANIFEST_DIR = os.path.join(ROOT, "src", "world2d", "tiles")

#: The four runs the build derives, with the count each emitted when the `line`
#: field landed. Counts are asserted as a FLOOR rather than an equality: the
#: geometry may legitimately shift with the map, but a run dropping to zero is
#: the failure this file exists to catch — the Cocal median planted NOTHING for
#: as long as the planar world existed and no test noticed.
RUNS = {
    "paseo_median": 106,
    "leon_cortes": 34,
    "ferrocarril": 79,
    "cocal_median": 14,
}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def emitted_lines():
    """Every `line` value in the shipped world, counted."""
    seen = {}
    for name in sorted(os.listdir(MANIFEST_DIR)):
        if not name.endswith(".json"):
            continue
        tile = json.loads(read(os.path.join(MANIFEST_DIR, name)))
        for key in ("trees", "palms"):
            for rec in tile.get(key) or ():
                if "line" in rec:
                    seen[rec["line"]] = seen.get(rec["line"], 0) + 1
    return seen


class PlantingRunTests(unittest.TestCase):
    def setUp(self):
        self.emitted = emitted_lines()

    def test_every_run_still_plants_something(self):
        for line, floor in RUNS.items():
            self.assertIn(line, self.emitted,
                          f"the {line} run emitted nothing — it is either not "
                          f"planting or it lost its `line` tag, and neither "
                          f"shows up as an error anywhere else")
            self.assertGreaterEqual(self.emitted[line], floor // 2,
                                    f"{line} planted {self.emitted[line]}, less than "
                                    f"half of the {floor} it did when tagged")

    def test_no_run_appeared_that_nothing_names(self):
        # A `line` the editor has no label for reaches a human as a raw slug.
        for line in self.emitted:
            self.assertIn(line, RUNS, f"the world emits a run '{line}' this test "
                                      f"does not know; add it here and to flora.json")

    def test_the_builder_names_all_four(self):
        src = read(BUILD_STAGE)
        for line in RUNS:
            self.assertIn(f'"{line}"', src,
                          f"build_stage.py no longer names the {line} run")

    def test_the_editor_labels_every_run(self):
        # The editor turns each run into one source; an unlabelled one is
        # addressable but unreadable. Names belong beside the recipes in JSON,
        # not in another editor-only table.
        cfg = read(EDITOR_CFG)
        flora = json.loads(read(FLORA))
        labelled = {line for line, spec in flora["plantingRuns"].items()
                    if not line.startswith("_") and spec.get("name")}
        for line in RUNS:
            self.assertIn(line, labelled,
                          f"the editor has no display name for the {line} run")
        self.assertIn("plantingDefinitions[line]?.name", cfg)
        self.assertNotIn("const RUN_NAMES", cfg)

    def test_the_scattered_plantings_stay_anonymous(self):
        # `_plant` takes `line=None` by default precisely so the patio scatter
        # does not claim a run. Its botanical default must also stay indirect:
        # flora.json, not this Python helper, owns what an omitted `k` means.
        # If the line default ever flips, 14 000 patio trees become one enormous
        # fake "line".
        src = read(BUILD_STAGE)
        self.assertIn("def _plant(out, x, y, s, mix_name, default=None, line=None)", src,
                      "`_plant` must default `line` to None — the patio scatter "
                      "belongs to no run")
        self.assertIn('_DEFAULT_TREE = _FLORA["defaults"]["treeSpecies"]', src,
                      "the compact tree wire default must come from flora.json")
        self.assertNotIn('default="almendro"', src,
                         "the builder must not duplicate flora.json's default species")
        total_tagged = sum(self.emitted.values())
        self.assertLess(total_tagged, 1000,
                        f"{total_tagged} plants carry a `line`; the derived runs are "
                        f"a few hundred, so the scatter has started claiming one")

    def test_no_corridor_era_pixel_anchor_came_back(self):
        """The bug class this file was written next to.

        `FERRO_TREE_X0 = 6892` sat in the builder with a comment promising the
        Ferrocarril line started there. It was a corridor-era world-px anchor;
        the planar route runs x 26 200..57 648, so it could never fire. The same
        thing had the Cocal median planting zero for as long as the planar world
        existed. CLAUDE.md's rule is `EVERY ANCHOR IS GEO`.
        """
        src = read(BUILD_STAGE)
        # a bare `NAME_X0 = <4-5 digit literal>` is the shape of that mistake
        hits = re.findall(r"^\s*[A-Z_]*_X0\s*=\s*\d{3,5}\s*$", src, re.M)
        self.assertEqual(hits, [], f"a world-px anchor is back in the builder: {hits}")
