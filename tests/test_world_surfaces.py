"""The surface vocabulary is a WIRE FORMAT: these values are the bytes inside
every tile's RLE, and the client reads them back. The client's copy of the LIST
is generated now (`tools/gen_vocabulary.py` → src/domain/vocabulary.generated.js,
checked by tests/test_vocabulary.py), so what is left to check here is the part
the client still authors: `SURFACE_MUL`, the driving model of each class."""
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums.surface import (
    CALLE, CARRIAGEWAY, DRIVABLE, STREET, Surface, WALL,
)

SURFACES_JS = os.path.join(ROOT, "src", "game", "surfaces.js")


def _surface_mul():
    """`SURFACE_MUL` keyed by Surface member name.

    The table is written `[SURFACE.BARRO]: 0.82` — computed keys off the
    generated vocabulary, so a reader can see which surface a number belongs to
    without counting commas, and a renumbering cannot silently reassign one."""
    with open(SURFACES_JS, encoding="utf-8") as fh:
        text = fh.read()
    body = text.split("SURFACE_MUL = {", 1)[1].split("\n};", 1)[0]
    return {name: float(value)
            for name, value in re.findall(r"\[SURFACE\.(\w+)\]:\s*([\d.]+)", body)}


class SurfaceVocabularyTests(unittest.TestCase):
    def test_every_class_has_a_speed(self):
        # SURFACE_MUL is the whole driving model of a surface. A class without
        # one falls back to 0.78 in physics.js, which is a silent wrong answer.
        multipliers = _surface_mul()
        for surface in Surface:
            self.assertIn(surface.name, multipliers,
                          f"{surface.label} has no speed multiplier")

    def test_the_table_names_no_surface_that_does_not_exist(self):
        # The keys are `SURFACE.<NAME>` from the generated vocabulary, so a stale
        # name would be `undefined` — an object with one `undefined` key, and
        # every class after it reading the wrong speed.
        names = {s.name for s in Surface}
        for key in _surface_mul():
            self.assertIn(key, names, f"SURFACE_MUL names an unknown class: {key}")

    def test_the_unpaved_calles_are_streets_you_drive_slower_on(self):
        multipliers = _surface_mul()
        road = multipliers[Surface.ROAD.name]
        for surface in (Surface.BARRO, Surface.GRAVEL):
            self.assertIn(surface, DRIVABLE)
            self.assertIn(surface, STREET)      # so the acera ring still forms
            self.assertIn(surface, CALLE)       # so a POI can link to one
            self.assertNotIn(surface, WALL)
            self.assertLess(multipliers[surface.name], road,
                            f"{surface.label} should be slower than asphalt")

    def test_a_deck_is_a_carriageway_but_not_a_calle(self):
        # Pointing the faro's access lane at a muelle connected it to itself and
        # left the spawn on an island of 559 cells.
        self.assertIn(Surface.BRIDGE, CARRIAGEWAY)
        self.assertNotIn(Surface.BRIDGE, CALLE)
