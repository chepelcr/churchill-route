"""LA GRADERÍA — `world-props.json` -> `scenes.stadium.stands`.

The first one that draws. `CLAUDE.md`, the ROADMAP and `water.json` all
described graderías "stroked over the block's real acera ring" when
`lm.stands`; none of it ran — the build emits no `stands`, nothing read it, and
`drawStadium` was eleven lines that drew the label.

What makes it ONE asset for two stadiums whose blocks are different shapes:
the stand is fitted to an EDGE of the emitted footprint, named by side. A cuadra
here is not square to the screen and not even square to itself, so "the west
side" has to mean an edge — a rect off the bounding box would put a straight
stand on a slanted block, which is the same mistake `P.ang` exists to prevent
everywhere else.
"""
import json
import os
import unittest

from churchill.world.config import ROOT

PROPS = os.path.join(ROOT, "src", "assets", "world-props.json")
LANDMARKS_JS = os.path.join(ROOT, "src", "render", "c2d", "landmarks.js")
MANIFEST = os.path.join(ROOT, "src", "world2d", "manifest.json")

SIDES = {"west", "east", "north", "south"}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class StandsTests(unittest.TestCase):
    def setUp(self):
        # LA RECETA sigue en el registro de arte; QUIÉN LLEVA GRADERÍA y de qué
        # lado se autora con el estadio, en `content/world/blocks.json`, porque
        # un estadio es UN registro. El build lo emite sobre el landmark.
        from churchill.world.content import blocks_by_layout
        self.spec = read(PROPS)["scenes"]["stadium"]["stands"]
        self.own = {b["id"]: b["stands"] for b in blocks_by_layout("streets-quad")
                    if b.get("stands")}
        with open(LANDMARKS_JS, encoding="utf-8") as fh:
            self.js = fh.read()
        self.stadiums = {l["id"]: l for l in read(MANIFEST)["landmarks"]
                         if l.get("type") == "stadium"}

    def test_every_configured_stadium_exists_and_has_a_footprint(self):
        """The stand has NO geometry of its own — it is fitted to the emitted
        footprint. A landmark without one silently gets nothing."""
        for lid in self.own:
            self.assertIn(lid, self.stadiums, f"'{lid}' is not a stadium in the world")
            fp = self.stadiums[lid].get("footprint") or []
            self.assertGreaterEqual(len(fp), 6,
                                    f"'{lid}' has no traced footprint to build a stand on")

    def test_every_side_is_a_real_side(self):
        for lid, rec in self.own.items():
            self.assertIn(rec["side"], SIDES, f"{lid}.side")

    def test_the_side_is_resolved_against_the_polygon(self):
        """Not against the bounding box. The avenidas run -5.4° and the calles
        82.3°, so a rect off the bbox puts a straight stand on a slanted block."""
        self.assertIn("standEdge", self.js)
        body = self.js.split("function standEdge", 1)[1].split("\n}", 1)[0]
        self.assertIn("midpoint" in body.lower() or "mx" in body, [True],
                      "standEdge must pick an EDGE by its midpoint")
        self.assertIn("nx = -nx", body,
                      "the outward normal must be flipped toward the outside — "
                      "the other one builds the stand across the pitch")

    def test_each_stadium_keeps_its_own_colours(self):
        """Lito Pérez is orange (Puntarenas F.C.); Las Playitas is white and
        blue. A shared default with no override would make them the same place."""
        pal = {lid: {**self.spec["palette"], **rec.get("palette", {})}
               for lid, rec in self.own.items()}
        self.assertNotEqual(pal["estadio"]["tierA"], pal["estadio_playitas"]["tierA"],
                            "both stadiums are wearing the same seats")
        for lid, p in pal.items():
            for key in ("tierA", "tierB", "structure", "rail", "shadow", "row"):
                self.assertIn(key, p, f"{lid} has no {key}")

    def test_the_geometry_is_sane(self):
        self.assertGreater(self.spec["tiers"], 0)
        self.assertLessEqual(self.spec["tiers"], 8,
                             "more than about seven rows stop resolving at play zoom")
        self.assertGreater(self.spec["depth"], 0)
        self.assertLess(self.spec["depth"], 60,
                        "a stand deeper than the acera ring stands in the street")
        self.assertTrue(0 < self.spec["rake"] < 1, "the rake is a fraction of the depth")
        self.assertTrue(0 < self.spec["roofFrom"] < 1)

    def test_the_two_tones_split_by_depth_not_by_stripe(self):
        """Alternating whole tiers and ruling a row line every few px BOTH read
        as a barcode at play zoom. Each was tried; this records which."""
        body = self.js.split("function drawStands", 1)[1].split("\nfunction ", 1)[0]
        self.assertIn("roofFrom", body, "the back tone is not split by depth")
        self.assertIn("lineWidth = 1", body, "the row hairlines are not hairlines")
