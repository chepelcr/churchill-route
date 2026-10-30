"""Cuadra classification at the thin old-port edge.

El Cocal's street-bounded manzanas can be three cuadrículas wide after the
arcade road treatment. They are urban blocks, not coastal green strips; the
rescue is deliberately bounded by the authored district edge so it cannot
turn the rural coast into synthesized frontage.
"""
import unittest

from churchill.world.config import CLS_LAND, CUAD, CUAD_CELLS, GRID_CELL
from churchill.world.service.block import detect_blocks
from churchill.world.util.raster import Raster


def thin_component(width_cuads=3, height_cuads=9):
    """One isolated, CUAD-aligned land component with area above sliver size."""
    margin = CUAD_CELLS
    cols = width_cuads * CUAD_CELLS + margin * 2
    rows = height_cuads * CUAD_CELLS + margin * 2
    raster = Raster(cols, rows, GRID_CELL)
    for row in range(margin, margin + height_cuads * CUAD_CELLS):
        for col in range(margin, margin + width_cuads * CUAD_CELLS):
            raster.set(col, row, CLS_LAND)
    return raster


class OldPortBlockRescueTests(unittest.TestCase):
    def test_thin_cocal_manzana_is_green_without_the_authored_band(self):
        blocks, _ = detect_blocks(thin_component())
        self.assertEqual(len(blocks), 1)
        self.assertTrue(blocks[0]["green"])

    def test_same_manzana_is_buildable_inside_the_cocal_edge(self):
        blocks, _ = detect_blocks(thin_component(), old_port_x1=5 * CUAD)
        self.assertEqual(len(blocks), 1)
        self.assertFalse(blocks[0]["green"])

    def test_component_crossing_the_cocal_edge_stays_green(self):
        blocks, _ = detect_blocks(thin_component(), old_port_x1=3 * CUAD)
        self.assertEqual(len(blocks), 1)
        self.assertTrue(blocks[0]["green"])

    def test_one_cuadricula_shore_strip_is_not_rescued(self):
        blocks, _ = detect_blocks(thin_component(width_cuads=1, height_cuads=26),
                                  old_port_x1=5 * CUAD)
        self.assertEqual(len(blocks), 1)
        self.assertTrue(blocks[0]["green"])


if __name__ == "__main__":
    unittest.main()
