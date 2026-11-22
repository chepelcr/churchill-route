"""LAS SEÑALES QUE SALEN DE LA CALLE (`service/signs.py`) Y EL ALTO EN LA ESQUINA (`finish.settle_altos`).

Lo que se rompe en silencio aquí no rompe el build: una placa del lado equivocado de la calle, una
UNA VÍA en la punta de salida, una zebra tendida sobre la acera. Todo se dibuja igual; sólo está mal.
"""
import math
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from churchill.world.config import ACERA_CELLS, CLS_ACERA, CLS_LAND, CLS_ROAD, GRID_CELL  # noqa: E402
from churchill.world.enums import SignKind  # noqa: E402
from churchill.world.pipeline.finish import settle_altos  # noqa: E402
from churchill.world.service.signs import derive_altos, derive_road_signs, extract_node_signs  # noqa: E402


def road(pts, **kw):
    return {"cls": "residential", "w": 41, "pts": pts, **kw}


class RoadSignTests(unittest.TestCase):
    def test_a_speed_limit_per_direction_on_the_drivers_right(self):
        # una calle este-oeste de 600 px, de doble sentido, a 40
        out = derive_road_signs([road([0, 0, 600, 0], maxspeed=40)], [])
        v = [s for s in out if s["kind"] == SignKind.VELOCIDAD]
        self.assertEqual(len(v), 2, "una por sentido")
        for s in v:
            self.assertEqual(s["value"], 40)
            ux, uy = math.cos(s["ang"]), math.sin(s["ang"])
            # con y hacia abajo, la derecha de (ux, uy) es (-uy, ux): la placa tiene que caer de ese lado
            side = (-uy) * s["x"] + ux * s["y"]
            self.assertGreater(side, 0, f"VELOCIDAD del lado izquierdo de quien viaja: {s}")

    def test_a_one_way_street_says_so_at_both_ends(self):
        out = derive_road_signs([road([0, 0, 400, 0], oneway=1)], [])
        una = [s for s in out if s["kind"] == SignKind.UNA_VIA]
        nop = [s for s in out if s["kind"] == SignKind.NO_HAY_PASO]
        self.assertEqual((len(una), len(nop)), (1, 1))
        self.assertLess(una[0]["x"], 200, "UNA VÍA va en la punta de ENTRADA")
        self.assertGreater(nop[0]["x"], 200, "NO HAY PASO va en la de salida")
        self.assertAlmostEqual(math.cos(una[0]["ang"]), 1, places=3)      # mira hacia donde se anda
        self.assertAlmostEqual(math.cos(nop[0]["ang"]), -1, places=3)     # y ésta al que viene al revés

    def test_oneway_minus_one_runs_against_the_drawing(self):
        out = derive_road_signs([road([0, 0, 400, 0], oneway=-1)], [])
        una = [s for s in out if s["kind"] == SignKind.UNA_VIA][0]
        self.assertGreater(una["x"], 200)

    def test_service_lanes_carry_no_speed(self):
        out = derive_road_signs([road([0, 0, 600, 0], cls="service", maxspeed=20)], [])
        self.assertEqual(out, [])


class _Grid:
    """Un ráster mínimo: una calle vertical (la que para) que sale a una horizontal (la que cruza)."""

    def __init__(self):
        self.cells = {}
        acera = ACERA_CELLS
        for r in range(-40, 40):
            for c in range(-40, 40):
                self.cells[(c, r)] = CLS_LAND
        # la que cruza: filas -4..3 (calzada), con su acera arriba y abajo
        for c in range(-40, 40):
            for r in range(-4, 4):
                self.cells[(c, r)] = CLS_ROAD
            for k in range(acera):
                self.cells[(c, -5 - k)] = CLS_ACERA
                self.cells[(c, 4 + k)] = CLS_ACERA
        # la que para: columnas -4..3, bajando desde la que cruza, con sus aceras
        for r in range(4, 40):
            for c in range(-4, 4):
                self.cells[(c, r)] = CLS_ROAD
            for k in range(acera):
                self.cells[(-5 - k, r)] = CLS_ACERA
                self.cells[(4 + k, r)] = CLS_ACERA

    def at_px(self, x, y):
        return self.cells.get((math.floor(x / GRID_CELL), math.floor(y / GRID_CELL)), CLS_LAND)


class SettleTests(unittest.TestCase):
    """La calle que para (vertical, 40 px, sube desde y = 300) sale a la que cruza (horizontal, 40 px,
    en y = 0), como en `_Grid`. El cuadro de acera de la esquina, a la derecha del que sube, es
    x, y ∈ [20, 35]: su centro, (27.5, 27.5), es donde va el ALTO."""

    ROADS = [road([-400, 0, 400, 0], cls="secondary", w=40), road([0, 300, 0, 2], w=40)]

    def alto(self):
        return next(s for s in derive_altos(self.ROADS) if s["kind"] == SignKind.ALTO
                    and math.sin(s["ang"]) < -0.9)

    def test_the_alto_stands_in_the_middle_of_the_corner_square(self):
        a = self.alto()
        corner = 4 * GRID_CELL + ACERA_CELLS * GRID_CELL / 2
        self.assertLess(abs(a["x"] - corner), 1.01, a)
        self.assertLess(abs(a["y"] - corner), 1.01, a)
        self.assertEqual(_Grid().at_px(a["x"], a["y"]), CLS_ACERA)

    def test_an_oblique_junction_still_lands_on_the_crossing_sidewalk(self):
        # la que para llega a 60° de la que cruza: medido a lo largo del eje, el retiro crece
        k = 300 / math.tan(math.radians(60))
        a = next(s for s in derive_altos([self.ROADS[0], road([k, 300, 0, 2], w=40)])
                 if s["kind"] == SignKind.ALTO)
        # la distancia al eje de la que cruza sigue siendo media calzada + media acera
        self.assertLess(abs(a["y"] - (20 + ACERA_CELLS * GRID_CELL / 2)), 1.01, a)

    def test_settle_keeps_the_corner_and_lays_the_zebra_on_its_axis(self):
        g = _Grid()
        a = self.alto()
        out = settle_altos(g, [a], [{"use": "school", "cx": 0, "cy": 60}])
        a = next(s for s in out if s["kind"] == SignKind.ALTO)
        self.assertNotIn("_side", a)
        z = [s for s in out if s["kind"] == SignKind.CROSSING]
        self.assertEqual(len(z), 1, "cerca de una escuela, la esquina lleva zebra")
        self.assertEqual(g.at_px(z[0]["x"], z[0]["y"]), CLS_ROAD, "la zebra va en la calzada, no en la acera")
        self.assertLess(abs(z[0]["x"]), 1.01, "…sobre el eje de la calle que para")
        self.assertEqual(z[0]["y"], a["y"], "…en línea con la acera de la que se cruza")

    def test_no_zebra_far_from_where_people_cross(self):
        out = settle_altos(_Grid(), [self.alto()], [{"use": "school", "cx": 99999, "cy": 99999}])
        self.assertFalse([s for s in out if s["kind"] == SignKind.CROSSING])


class CrossingTests(unittest.TestCase):
    def test_a_mapped_crossing_takes_its_streets_angle_and_width(self):
        class SP:
            def project(self, m):
                return m[0], m[1], 0, 0
        import churchill.world.util.geometry as geo
        real = geo.to_m
        geo.to_m = lambda lat, lon: (lon, lat)
        try:
            out = extract_node_signs(SP(), [((100, 3), {"highway": "crossing"})], 1000, 1000,
                                     [road([0, 0, 0, 400])])
        finally:
            geo.to_m = real
        z = out[0]
        self.assertEqual((z["x"], z["y"]), (0, 100))
        self.assertAlmostEqual(abs(math.sin(z["ang"])), 1, places=3)   # la calle es vertical
        self.assertEqual(z["hw"], 20.5)


if __name__ == "__main__":
    unittest.main()
