"""EL HUD — `src/assets/hud.json`.

The inks of everything drawn OVER the world: the minimap, the compass, the POI
tags and the three things that take the view away. `c2d/hud.js` keeps the
geometry, the projection and — importantly — the DRAW ORDER, which is not a
preference: casing under everything, then the network, then the Paseo last is
the whole reason the little map reads as a map.

The two gates that matter here are about where a colour comes FROM. The minimap
deliberately has its own palette (it is read in a fifth of a second at a tenth
of the size, so it needs contrast the painted world does not) — but it must NOT
have its own copy of a colour that belongs to a shared registry. It once held
the two pier decks with a comment pointing at the very file it had copied them
from.
"""
import json
import os
import re
import subprocess
import unittest

from churchill.world.config import ROOT

HUD_JSON = os.path.join(ROOT, "src", "assets", "hud.json")
HUD_JS = os.path.join(ROOT, "src", "render", "c2d", "hud.js")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class HudRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(HUD_JSON))
        self.js = read(HUD_JS)

    def test_the_values_are_the_ones_the_module_held(self):
        """Transcription check against the literals, from git."""
        log = subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "-n", "30",
                              "--", "src/render/c2d/hud.js"],
                             capture_output=True, text=True).stdout.split()
        old = ""
        for sha in log:
            src = subprocess.run(["git", "-C", ROOT, "show", f"{sha}:src/render/c2d/hud.js"],
                                 capture_output=True, text=True).stdout
            if 'const MINI_CASING = "#' in src:
                old = src
                break
        if not old:
            self.skipTest("the literal version of hud.js is out of git reach")
        pairs = {
            "casing": "MINI_CASING", "street": "MINI_STREET", "paseo": "MINI_PASEO",
            "water": "MINI_WATER", "land": "MINI_LAND", "sand": "MINI_SAND",
            "park": "MINI_PARK", "field": "MINI_FIELD", "boulevard": "MINI_BULE",
            "malecon": "MINI_MALECON",
        }
        for key, const in pairs.items():
            m = re.search(rf'const {const}\s*=\s*"(#[0-9a-fA-F]+)"', old)
            self.assertIsNotNone(m, f"{const} not found in the old module")
            self.assertEqual(self.doc["minimap"][key], m.group(1),
                             f"minimap.{key} is not what {const} was")

    def test_the_minimap_reads_light_on_dark(self):
        """Its palette is deliberately not the world's. What must hold is the
        CONTRAST: the land is nearly black so the street network reads as light
        on top of it, and a drivable surface is never darker than the land."""
        def lum(hexstr):
            h = hexstr.lstrip("#")
            r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        mini = self.doc["minimap"]
        land = lum(mini["land"])
        self.assertLess(land, 60, "the land is too light for the network to read on")
        for drivable in ("street", "paseo", "sand", "boulevard", "malecon", "field"):
            self.assertGreater(lum(mini[drivable]), land,
                               f"minimap.{drivable} is darker than the land it sits on")

    def test_the_field_is_brighter_than_the_park(self):
        """The brightness IS the information: a plaza you can drive into against
        a green cuadra you cannot."""
        def lum(h):
            h = h.lstrip("#")
            return sum(int(h[i:i + 2], 16) for i in (0, 2, 4))
        self.assertGreater(lum(self.doc["minimap"]["field"]),
                           lum(self.doc["minimap"]["park"]))

    def test_the_shared_inks_still_come_from_materials(self):
        """The minimap's barro, lastre, rail, ferry, bridge and the pier decks
        belong to `materials.json`. A copy here is the exact drift that was
        closed once already."""
        for const in ("MINI_BARRO", "MINI_LASTRE", "MINI_RAIL", "MINI_FERRY",
                      "MINI_BRIDGE", "MINI_PIER", "MINI_JETTY", "MINI_MEDIAN"):
            m = re.search(rf"const {const}\s*=\s*([^;]+);", self.js)
            self.assertIsNotNone(m, f"{const} is gone")
            self.assertIn("MATERIALS", m.group(1),
                          f"{const} no longer reads the shared registry")
        for key in ("barro", "lastre", "rail", "ferry", "bridge"):
            self.assertNotIn(key, self.doc["minimap"],
                             f"minimap.{key} is a second copy of a materials.json ink")

    def test_the_compass_has_three_states(self):
        # A glance has to answer "am I fetching or delivering" without reading.
        needle = self.doc["compass"]["needle"]
        colours = {v for k, v in needle.items() if not k.startswith("_")}
        self.assertEqual(len(colours), 3, "two states share a colour")

    def test_every_poi_tone_is_a_colour(self):
        for key, value in self.doc["poiTags"].items():
            if key.startswith("_"):
                continue
            self.assertRegex(value, r"^#[0-9a-fA-F]{6}$", f"poiTags.{key}")

    def test_the_module_no_longer_holds_the_palette(self):
        self.assertNotRegex(self.js, r'const MINI_CASING\s*=\s*"#',
                            "the minimap palette is back in the module")
        self.assertIn("HUD.minimap", self.js)
        self.assertIn("HUD.poiTags", self.js)
