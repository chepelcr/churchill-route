"""The surface vocabulary is a WIRE FORMAT: these values are the bytes inside
every tile's RLE, and `src/game/surfaces.js` mirrors them on the client. A
renumbering silently repaints the map and changes what the car can drive on, so
the two lists are checked against each other here rather than by eye."""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums.surface import (
    CALLE, CARRIAGEWAY, CLASS_NAMES, DRIVABLE, STREET, Surface, WALL,
)

SURFACES_JS = os.path.join(ROOT, "src", "game", "surfaces.js")


def _js_array(name):
    text = open(SURFACES_JS, encoding="utf-8").read()
    match = re.search(rf"{name} = (\[[^\]]*\])", text, re.S)
    return json.loads(match.group(1).replace("'", '"'))


def _js_object(name):
    text = open(SURFACES_JS, encoding="utf-8").read()
    match = re.search(rf"{name} = (\{{[^}}]*\}})", text, re.S)
    body = re.sub(r"//[^\n]*", "", match.group(1))
    body = re.sub(r",(\s*\})", r"\1", body)          # JS allows a trailing comma
    return json.loads(re.sub(r"(\d+):", r'"\1":', body))


class SurfaceVocabularyTests(unittest.TestCase):
    def test_the_client_mirrors_the_enum_exactly(self):
        self.assertEqual(_js_array("SURFACE_CLASSES"), CLASS_NAMES)

    def test_every_class_has_a_speed(self):
        # SURFACE_MUL is the whole driving model of a surface. A class without
        # one falls back to 0.78 in physics.js, which is a silent wrong answer.
        multipliers = _js_object("SURFACE_MUL")
        for surface in Surface:
            self.assertIn(str(int(surface)), multipliers,
                          f"{surface.label} has no speed multiplier")

    def test_the_unpaved_calles_are_streets_you_drive_slower_on(self):
        multipliers = _js_object("SURFACE_MUL")
        road = multipliers[str(int(Surface.ROAD))]
        for surface in (Surface.BARRO, Surface.GRAVEL):
            self.assertIn(surface, DRIVABLE)
            self.assertIn(surface, STREET)      # so the acera ring still forms
            self.assertIn(surface, CALLE)       # so a POI can link to one
            self.assertNotIn(surface, WALL)
            self.assertLess(multipliers[str(int(surface))], road,
                            f"{surface.label} should be slower than asphalt")

    def test_a_deck_is_a_carriageway_but_not_a_calle(self):
        # Pointing the faro's access lane at a muelle connected it to itself and
        # left the spawn on an island of 559 cells.
        self.assertIn(Surface.BRIDGE, CARRIAGEWAY)
        self.assertNotIn(Surface.BRIDGE, CALLE)
