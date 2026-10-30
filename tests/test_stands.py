"""Stadium stands are one world contract: geometry, collision and paint.

The builder resolves authored cardinal sides against the traced pitch, emits
the exact trapezoids on ``lm.stands.quads`` and stamps only the raster cells
below them as ACERA walls. Canvas consumes those quads and gives the same shape
a solar shadow. Four trimmed trapezoids must still leave four ROAD mouths.
"""
import json
import math
import os
import unittest

from churchill.world.config import CLS_ACERA, CLS_ROAD, GRID_CELL, ROOT
from churchill.world.pipeline.finish import field_escape_status
from churchill.world.service.field import (
    STAND_DEPTH_PX,
    STAND_RAKE,
    stadium_stand_cells,
    stadium_stand_quads,
    stadium_stand_sides,
)
from churchill.world.util.raster import Raster

PROPS = os.path.join(ROOT, "src", "assets", "world-props.json")
LANDMARKS_JS = os.path.join(ROOT, "src", "render", "c2d", "landmarks.js")
MANIFEST = os.path.join(ROOT, "src", "world2d", "manifest.json")
SIDES = ("west", "east", "north", "south")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class StandContractTests(unittest.TestCase):
    def setUp(self):
        from churchill.world.content import blocks_by_layout

        self.recipe = read(PROPS)["scenes"]["stadium"]["stands"]
        self.own = {b["id"]: b["stands"] for b in blocks_by_layout("streets-quad")
                    if b.get("stands")}
        with open(LANDMARKS_JS, encoding="utf-8") as fh:
            self.js = fh.read()

    def test_lito_has_all_four_sides_and_singular_side_stays_compatible(self):
        self.assertEqual(stadium_stand_sides(self.own["estadio"]), SIDES)
        self.assertNotIn("side", self.own["estadio"])
        self.assertEqual(self.own["estadio_playitas"]["side"], "west")
        self.assertNotIn("sides", self.own["estadio_playitas"])
        self.assertEqual(stadium_stand_sides(self.own["estadio_playitas"]),
                         ("west",))

    def test_every_configured_stadium_has_a_traced_footprint(self):
        # The checked-in world may precede this intended world rebuild, but its
        # true footprints are the inputs whose geometry the new builder uses.
        stadiums = {lm["id"]: lm for lm in read(MANIFEST)["landmarks"]
                    if lm.get("type") == "stadium"}
        for lid in self.own:
            self.assertGreaterEqual(len(stadiums[lid].get("footprint") or []), 6)

    def test_edge_midpoints_not_a_bbox_resolve_the_four_quads(self):
        # A slanted parallelogram: no edge lies on a bbox side.
        footprint = [36, 28, 164, 16, 176, 112, 48, 124]
        quads = stadium_stand_quads(footprint, {"sides": list(SIDES)})
        self.assertEqual(len(quads), 4)
        cx = sum(footprint[0::2]) / 4
        cy = sum(footprint[1::2]) / 4
        for side, quad in zip(SIDES, quads):
            self.assertEqual(len(quad), 8)
            inner = ((quad[0] + quad[2]) / 2, (quad[1] + quad[3]) / 2)
            outer = ((quad[4] + quad[6]) / 2, (quad[5] + quad[7]) / 2)
            # The back wall must point farther out than the rail for its side.
            axis = {"west": (-1, 0), "east": (1, 0),
                    "north": (0, -1), "south": (0, 1)}[side]
            self.assertGreater((outer[0] - inner[0]) * axis[0]
                               + (outer[1] - inner[1]) * axis[1], 0)
            # The rail is deliberately inset from both source vertices: this
            # is the corner mouth, not four stands meeting at one sealed point.
            vertices = list(zip(footprint[0::2], footprint[1::2]))
            for p in ((quad[0], quad[1]), (quad[2], quad[3])):
                self.assertGreater(min(math.dist(p, v) for v in vertices),
                                   GRID_CELL)
            self.assertGreater(math.dist(inner, (cx, cy)), 0)

    def test_recipe_matches_the_ring_and_authors_a_real_height(self):
        self.assertEqual(self.recipe["depth"], STAND_DEPTH_PX)
        self.assertEqual(self.recipe["rake"], STAND_RAKE)
        self.assertGreater(self.recipe["heightM"], 0)
        self.assertGreater(self.recipe["tiers"], 0)
        self.assertLessEqual(self.recipe["tiers"], 8)
        self.assertTrue(0 < self.recipe["roofFrom"] < 1)

    def test_four_wall_bands_leave_corner_road_and_the_pitch_can_escape(self):
        # An isolated, axis-aligned stadium makes every raster answer obvious.
        # The surrounding ROAD represents its bounding streets.
        raster = Raster(64, 52, GRID_CELL, fill=CLS_ROAD)
        # EL CONTORNO SE DERIVA DE LAS CELDAS, no se escribe en píxeles al lado
        # de ellas. Estaba como `[60, 60, 180, 60, …]`, que es el mismo
        # rectángulo que `range(15, 45)` x `range(15, 35)` SÓLO si la celda mide
        # 4 px — y el reescalado a 3.125 px/m la puso en 5, con lo que el
        # contorno y el anillo dejaron de solaparse y no salía ni una grada. El
        # fixture no estaba mal: estaba escrito en dos unidades a la vez.
        C0, C1, R0, R1 = 15, 45, 15, 35
        footprint = [C0 * GRID_CELL, R0 * GRID_CELL, C1 * GRID_CELL, R0 * GRID_CELL,
                     C1 * GRID_CELL, R1 * GRID_CELL, C0 * GRID_CELL, R1 * GRID_CELL]
        inner = {(c, r) for r in range(R0, R1) for c in range(C0, C1)}
        outer = {(c, r) for r in range(R0 - 3, R1 + 3) for c in range(C0 - 3, C1 + 3)}
        ring = outer - inner
        quads = stadium_stand_quads(footprint, {"sides": list(SIDES)})
        walls = stadium_stand_cells(ring, quads)
        self.assertGreater(len(walls), 0)
        for c, r in walls:
            raster.set(c, r, CLS_ACERA)

        # Mid-side is wall; the four outer corner wedges remain road.
        for cell in ((30, 13), (46, 25), (30, 36), (13, 25)):
            self.assertEqual(raster.at(*cell), CLS_ACERA, cell)
        for cell in ((13, 13), (46, 13), (46, 36), (13, 36)):
            self.assertEqual(raster.at(*cell), CLS_ROAD, cell)
        self.assertEqual(raster.at(30, 25), CLS_ROAD, "pitch became wall")

        # …y la parcela también: es EL MISMO rectángulo que el contorno, así que
        # escribirlo otra vez en píxeles era la tercera copia de un número.
        parcel = {"id": "estadio_field", "use": "stadium",
                  "cx": (C0 + C1) / 2 * GRID_CELL, "cy": (R0 + R1) / 2 * GRID_CELL,
                  "x0": C0 * GRID_CELL, "y0": R0 * GRID_CELL,
                  "x1": C1 * GRID_CELL, "y1": R1 * GRID_CELL}
        self.assertEqual(field_escape_status(raster, parcel)[0], "escaped")

        # Prove this is the final gate doing work, not a trivially passing test:
        # sealing the whole ring is rejected by the same predicate.
        sealed = Raster(64, 52, GRID_CELL, fill=CLS_ROAD)
        for c, r in ring:
            sealed.set(c, r, CLS_ACERA)
        self.assertEqual(field_escape_status(sealed, parcel)[0], "walled")

    def test_renderer_consumes_quads_and_casts_their_solar_shadow(self):
        body = self.js.split("function standQuads", 1)[1].split(
            "\nfunction drawStadium", 1)[0]
        self.assertIn("own.quads", body)
        self.assertIn("for (const quad", body)
        self.assertIn("sunShadow(spec.heightM)", body)
        self.assertIn("shadowInk(sh.alpha)", body)
        self.assertIn("-Math.abs(sh.dy)", body,
                      "the requested north-side cast is negative world Y")
        self.assertNotIn("quad(-3", self.js)

    def test_each_stadium_keeps_its_own_colours(self):
        palettes = {lid: {**self.recipe["palette"], **rec.get("palette", {})}
                    for lid, rec in self.own.items()}
        self.assertNotEqual(palettes["estadio"]["tierA"],
                            palettes["estadio_playitas"]["tierA"])
        for lid, palette in palettes.items():
            for key in ("tierA", "tierB", "structure", "rail", "row"):
                self.assertIn(key, palette, f"{lid} has no {key}")
            self.assertNotIn("shadow", palette,
                             "stand shadows must use the shared solar ink")


if __name__ == "__main__":
    unittest.main()
