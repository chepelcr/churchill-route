"""The surface vocabulary is a WIRE FORMAT: these values are the bytes inside
every tile's RLE. Identity is generated (`tools/gen_vocabulary.py`, checked by
tests/test_vocabulary.py); what is checked here is the REGISTRY that hangs
properties off each class — `src/assets/surfaces.json`, the single home for how a
surface drives and what it is made of.

It replaced FIVE copies of the same palette, two of them wrong: the Python debug
renderer drew the bulevar `#d8d4c8` where every client drew `#d9d6cd`, and the
dev viewer knew 7 of the 11 classes and painted the rest magenta. Both were
invisible to review, so they are asserted here instead.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT, surface_registry
from churchill.world.enums.surface import (
    CALLE, CARRIAGEWAY, DRIVABLE, STREET, Surface, WALL,
)

HEX = re.compile(r"^#[0-9a-f]{6}$")


class SurfaceRegistryTests(unittest.TestCase):
    def setUp(self):
        self.rows = surface_registry()

    def test_every_class_has_a_row(self):
        # A class with no row is `undefined` in SURFACE_MUL, and physics.js then
        # silently falls back to 0.78 — a wrong answer that reads as a right one.
        for surface in Surface:
            self.assertIn(surface.label, self.rows,
                          f"{surface.label} has no registry row")

    def test_the_registry_names_no_surface_that_does_not_exist(self):
        labels = {s.label for s in Surface}
        for name in self.rows:
            self.assertIn(name, labels, f"registry names an unknown class: {name}")

    def test_every_row_is_complete_and_well_formed(self):
        for name, row in self.rows.items():
            self.assertGreater(row["speed"], 0, f"{name}: speed must be positive")
            self.assertLessEqual(row["speed"], 1.0, f"{name}: asphalt is the 1.0 reference")
            for key in ("day", "night"):
                self.assertRegex(row[key], HEX, f"{name}.{key} is not #rrggbb")

    def test_the_unpaved_calles_are_streets_you_drive_slower_on(self):
        road = self.rows[Surface.ROAD.label]["speed"]
        for surface in (Surface.BARRO, Surface.GRAVEL):
            self.assertIn(surface, DRIVABLE)
            self.assertIn(surface, STREET)      # so the acera ring still forms
            self.assertIn(surface, CALLE)       # so a POI can link to one
            self.assertNotIn(surface, WALL)
            self.assertLess(self.rows[surface.label]["speed"], road,
                            f"{surface.label} should be slower than asphalt")


class NoSecondPaletteTests(unittest.TestCase):
    """Nobody may keep their own class -> colour table again.

    The five copies were the whole problem, and four of them looked perfectly
    reasonable in isolation.
    """

    #: An object/dict literal mapping a class KEY to a colour: `3: "#3a3540"`,
    #: `[SURFACE.ROAD]: [0x3a,`, `CLS_ROAD: (58,`. The number must be the whole
    #: key — the lookbehind is why: without it `sky1: "#3a4a5e"` in a weather
    #: palette matches on the `1`, and those are not surface colours.
    PALETTE = re.compile(
        r"(?:\[SURFACE\.\w+\]|\bCLS_\w+|(?<![\w.])\d+)\s*:\s*"
        r"(?:\"#[0-9a-fA-F]{6}\"|'#[0-9a-fA-F]{6}'|\[\s*0x[0-9a-fA-F]{2}\s*,|"
        r"\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))")

    def test_no_module_hardcodes_a_surface_palette(self):
        offenders = []
        for base in ("src", "churchill"):
            for dirpath, _, files in os.walk(os.path.join(ROOT, base)):
                if "tiles" in dirpath or "__pycache__" in dirpath:
                    continue
                for name in sorted(files):
                    if not name.endswith((".js", ".jsx", ".py")):
                        continue
                    path = os.path.join(dirpath, name)
                    with open(path, encoding="utf-8") as fh:
                        text = fh.read()
                    hits = self.PALETTE.findall(text)
                    if hits:
                        offenders.append(f"{os.path.relpath(path, ROOT)} ({len(hits)})")
        self.assertEqual(offenders, [],
                         "read src/assets/surfaces.json instead: " + ", ".join(offenders))

    def test_a_deck_is_a_carriageway_but_not_a_calle(self):
        # Pointing the faro's access lane at a muelle connected it to itself and
        # left the spawn on an island of 559 cells.
        self.assertIn(Surface.BRIDGE, CARRIAGEWAY)
        self.assertNotIn(Surface.BRIDGE, CALLE)
