"""The Estero opens in the surface stage, without erasing authored ground."""
import inspect
import unittest

from churchill.world.config import (
    CLS_ACERA, CLS_BEACH, CLS_LAND, CLS_PASEO, CLS_ROAD, CLS_WATER,
)
from churchill.world.pipeline.surface_stage import rasterise_surface
from churchill.world.service import lancha
from churchill.world.service.surface import estuary_claim_mask, open_estuary
from churchill.world.util.raster import Raster


class OpenEstuaryTests(unittest.TestCase):
    def test_only_shore_connected_land_beyond_the_rim_opens(self):
        raster = Raster(12, 10, 4, fill=CLS_WATER)
        band = [None] + [(1, 8)] * 10 + [None]

        # A mangrove flat reaches the north cap; two rows are its visible rim.
        shore_flat = {(3, row) for row in range(1, 7)}
        for col, row in shore_flat:
            raster.set(col, row, CLS_LAND)

        # A detached component is a real islet and survives whole.
        islet = {(7, 4), (7, 5), (8, 4), (8, 5)}
        for col, row in islet:
            raster.set(col, row, CLS_LAND)

        # Ground outside the hard band and every non-LAND surface are guards,
        # not candidates for a broad "make it water" write.
        raster.set(0, 4, CLS_LAND)
        protected = {(5, 3): CLS_ROAD, (5, 4): CLS_ACERA,
                     (5, 5): CLS_PASEO, (5, 6): CLS_BEACH}
        for cell, surface in protected.items():
            raster.set(*cell, surface)

        claims = bytearray(len(raster.buf))
        claims[raster.idx(3, 4)] = 1
        stats = open_estuary(raster, band, claims=claims, rim_cells=2)

        self.assertEqual(stats, {
            "mask": 80, "land": 10, "opened": 3, "rim": 2,
            "islets": 1, "islet_cells": 4, "claims": 1,
        })
        self.assertEqual(raster.at(3, 1), CLS_LAND)
        self.assertEqual(raster.at(3, 2), CLS_LAND)
        self.assertEqual(raster.at(3, 4), CLS_LAND)  # authored claim
        for row in (3, 5, 6):
            self.assertEqual(raster.at(3, row), CLS_WATER)
        for cell in islet:
            self.assertEqual(raster.at(*cell), CLS_LAND)
        self.assertEqual(raster.at(0, 4), CLS_LAND)
        for cell, surface in protected.items():
            self.assertEqual(raster.at(*cell), surface)

    def test_claim_bitmap_covers_every_future_ground_family(self):
        raster = Raster(80, 80, 4)
        band = [(0, 79)] * 80
        road = {"pts": [20, 40, 300, 40], "w": 8}
        mask, counts = estuary_claim_mask(
            raster,
            band,
            roads=[road],
            bridge_road=road,  # production passes the same record both ways
            sites=[{"pts": [(160, 160), (240, 160),
                             (240, 240), (160, 240)]}],
            pois=[{"x": 80, "y": 280}],
            authored_pois=[{"x": 280, "y": 280}],
            parcels=[{"poly": [8, 160, 80, 160, 80, 240, 8, 240]}],
            occ={(0, 0)},
        )

        self.assertEqual(counts, {
            "roads": 1, "sites": 1, "pois": 1, "authored": 1,
            "parcels": 1, "occ": 1,
        })
        self.assertEqual(mask[raster.idx(40, 10)], 1)  # road + future acera
        self.assertEqual(mask[raster.idx(50, 50)], 1)  # OSM site
        self.assertEqual(mask[raster.idx(30, 70)], 1)  # exact POI apron
        self.assertEqual(mask[raster.idx(70, 70)], 1)  # authored POI apron
        self.assertEqual(mask[raster.idx(10, 50)], 1)  # parcel polygon
        self.assertEqual(mask[raster.idx(2, 2)], 1)    # coarse occ cell

    def test_the_opening_precedes_the_final_land_contour(self):
        source = inspect.getsource(rasterise_surface)
        self.assertLess(source.index("open_estuary("),
                        source.index("trace_land_contours("))


class NoLateDredgeTests(unittest.TestCase):
    def test_lancha_routes_and_sounds_once_without_mutating_the_coast(self):
        module = inspect.getsource(lancha)
        place = inspect.getsource(lancha.place_lanchas)
        self.assertNotIn("dredge_channel", module)
        self.assertNotIn("DREDGE_HW", module)
        self.assertNotIn("DREDGE_END_PAD", module)
        self.assertEqual(place.count("water_route("), 1)
        self.assertIn("measure_channel(", place)
        self.assertIn("_apron(", place)


if __name__ == "__main__":
    unittest.main()


class SmoothedCentreTests(unittest.TestCase):
    """EL SUAVIZADO NO PUEDE COSTAR AGUA.

    `measure_channel` suaviza el CENTRO del canal para que un manglar suelto no
    le ponga un codo a la línea marcada, y después recorta el ancho contra lo
    que hay de verdad — «puede redondear un ancho HACIA ABAJO pero nunca
    inventar agua». Le faltaba la otra mitad de esa misma regla.

    Medido sobre el mundo emitido el 2026-08-23: en la curva de (25708, 10032)
    el filtro de caja arrastró el centro 85 px a babor, fuera de una corrida que
    por ese lado sólo llegaba a 48 px. La estación entonces informaba —con toda
    honestidad— media caña 0, y el carril desaparecía justo donde el estero mide
    200 px de ancho. Dos muestras de 355, y eran las que dejaban `smoke:crossing`
    en rojo después de abrir la cuenca.
    """

    @staticmethod
    def _bend_raster():
        """Una ría recta que dobla: el canal es ancho en todas partes, pero el
        codo es lo bastante cerrado como para que la media móvil ponga el centro
        suavizado en el manglar."""
        raster = Raster(60, 60, 4, fill=CLS_LAND)
        route = []
        for step in range(30):
            col = 8 + step
            row = 30 if step < 15 else 30 - (step - 15) * 2
            for wide in range(-6, 7):
                if 0 <= row + wide < 60:
                    raster.set(col, row + wide, CLS_WATER)
            route.append((col * 4 + 2, row * 4 + 2))
        return raster, route

    def test_no_station_loses_water_to_the_filter(self):
        raster, route = self._bend_raster()
        hw, off = lancha.measure_channel(raster, route)
        self.assertTrue(hw, "la ría de prueba no produjo estaciones")
        self.assertEqual(len(hw), len(off))
        # Cada estación está sobre agua por construcción, así que ninguna puede
        # informar un carril de ancho cero: eso sólo pasa si el centro se salió.
        self.assertGreater(min(hw), 0,
                           f"una estación quedó sin carril: {sorted(hw)[:6]}")

    def test_the_fallback_only_fires_where_it_is_needed(self):
        """El centro suavizado se conserva donde sirve — si no, esto dejaría de
        ser un suavizado y volveríamos al codo que motivó el filtro."""
        raster, route = self._bend_raster()
        _hw, off = lancha.measure_channel(raster, route)
        raw = []
        for (_s, x, y, nx, ny) in lancha._stations(route, lancha.CHANNEL_PITCH):
            dl = lancha._water_run(raster, x, y, -nx, -ny)
            dr = lancha._water_run(raster, x, y, nx, ny)
            raw.append((dr - dl) / 2.0)
        kept = sum(1 for i, v in enumerate(off) if abs(v - raw[i]) > 0.5)
        self.assertGreater(kept, 0,
                           "ninguna estación conservó el centro suavizado: "
                           "el filtro dejó de hacer algo")


class LandContourPinchTests(unittest.TestCase):
    """UNA COSTA NO SE PUEDE PERDER EN SILENCIO.

    `trace_land_contours` encadena aristas de frontera con un diccionario
    `inicio -> fin`. Un punto de la retícula donde dos celdas de tierra se tocan
    ESQUINA CON ESQUINA a través del agua —un pellizco diagonal— es el inicio de
    DOS aristas, y en un diccionario la segunda pisaba a la primera: el paseo
    que llegaba a la perdida se salía de la cadena, y la prueba de cierre
    entonces descartaba EL LAZO ENTERO.

    Medido el 2026-08-23: abrir la cuenca del estero agregó suficientes
    pellizcos nuevos como para tumbar el único lazo de 24 200 vértices que es
    toda la tierra firme más el arenal. `landPolys` pasó de 26 a 54 mientras la
    península donde se juega dejaba de tener silueta, y los patios de El Cocal
    se dibujaban como mar abierto. El error siempre estuvo ahí; la costa vieja
    simplemente no se pellizcaba.
    """

    @staticmethod
    def _pinched_raster():
        """Dos bloques de tierra que se tocan sólo por una esquina."""
        raster = Raster(24, 24, 4, fill=CLS_WATER)
        for col in range(2, 11):
            for row in range(2, 11):
                raster.set(col, row, CLS_LAND)
        for col in range(11, 20):
            for row in range(11, 20):
                raster.set(col, row, CLS_LAND)
        return raster

    def test_a_diagonal_pinch_does_not_delete_a_coastline(self):
        """Medido sobre este mismo fixture: con el diccionario se perdía UNA
        arista, y esa arista sola dejaba **0 lazos** y 17 cadenas descartadas —
        o sea, ninguna silueta para dos bloques de tierra perfectamente sólidos.

        No se exige que salgan DOS lazos: atravesar el pellizco y volver traza
        los dos bloques como un ocho, y un ocho relleno cubre los dos. Lo que se
        exige es que salga silueta."""
        from churchill.world.service.surface import trace_land_contours
        polys = trace_land_contours(self._pinched_raster())
        self.assertTrue(polys, "un pellizco diagonal se tragó la costa entera")
        for flat in polys:
            self.assertGreaterEqual(len(flat) // 2, 4)

    def test_every_land_cell_ends_up_inside_a_contour(self):
        """La prueba que habría cazado esto: no cuántos lazos salen, sino que la
        tierra que hay quede DENTRO de alguno."""
        from churchill.world.service.surface import trace_land_contours
        polys = trace_land_contours(self._pinched_raster())

        def inside(flat, x, y):
            n, hit, j = len(flat) // 2, False, len(flat) // 2 - 1
            for i in range(n):
                xi, yi = flat[2 * i], flat[2 * i + 1]
                xj, yj = flat[2 * j], flat[2 * j + 1]
                if (yi > y) != (yj > y) and \
                        x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
                    hit = not hit
                j = i
            return hit

        for (col, row) in ((6, 6), (15, 15)):
            x, y = col * 4 + 2, row * 4 + 2
            self.assertTrue(any(inside(p, x, y) for p in polys),
                            f"la celda ({col},{row}) es tierra y no está en "
                            "ninguna silueta — se dibujaría como mar")
