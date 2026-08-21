"""LA DILATACIÓN — que la manzana recupere su suelo sin deformarse.

Lo que se protege no es un número sino una FORMA DE FALLAR. La primera versión
de esto era un relajador laplaciano sobre las celdas y parecía razonable; medido,
entregaba 5.9 px de los 23.5 que pedía y de paso estiraba la manzana 3.5 px cada
150. La segunda metía al campo abierto en el sistema como un cuerpo rígido, lo
que es inconsistente —no puede estar δ al norte de una manzana y δ al sur de
otra a la vez— y salía un campo uniforme, o sea ninguna separación.

Las dos fallaban EN SILENCIO: el build corría, el mundo se emitía y sólo se veía
mirando muy de cerca dos manzanas. Estas pruebas son lo que lo dice.
"""
import math
import unittest

from churchill.world.service import dilation as D


def grid_town(pitch=300, lines=5, origin=600, cls="residential"):
    """Una cuadrícula de verdad: las manzanas quedan ENCERRADAS.

    Con una sola calle no hay nada que separar — los dos lados son la misma
    componente porque se dan la vuelta por arriba y por abajo. Hace falta una
    retícula cerrada, que es justamente lo que un pueblo es.
    """
    end = origin + (lines - 1) * pitch
    roads = []
    for k in range(lines):
        v = origin + k * pitch
        roads.append({"cls": cls, "pts": [v, origin, v, end]})
        roads.append({"cls": cls, "pts": [origin, v, end, v]})
    return roads


class SeparationTests(unittest.TestCase):
    def setUp(self):
        self.delta = D.steal_px("residential")
        self.field = D.build(grid_town())

    def test_the_street_gets_exactly_what_it_steals(self):
        """Dos manzanas vecinas se separan δ — ni más ni menos."""
        a = self.field.point(1050, 1050)
        b = self.field.point(1350, 1050)
        got = (b[0] - a[0]) - 300
        self.assertAlmostEqual(got, self.delta, delta=1.0,
                               msg=f"separación {got:.1f}px, se pedía {self.delta:.1f}")

    def test_it_adds_up_across_several_streets(self):
        """Tres calles son tres veces δ: el campo no se cansa a mitad de camino,
        que es exactamente lo que hacía el suavizado."""
        a = self.field.point(750, 1050)
        b = self.field.point(1650, 1050)
        got = (b[0] - a[0]) - 900
        self.assertAlmostEqual(got, self.delta * 3, delta=2.0)

    def test_a_manzana_does_not_stretch(self):
        """LA CUADRA SE MUEVE ENTERA. Si se deforma, los edificios de adentro se
        deforman con ella y el mapa deja de ser el mapa."""
        for (x0, x1) in ((1020, 1170), (1320, 1470)):
            p = self.field.point(x0, 1050)
            q = self.field.point(x1, 1050)
            self.assertAlmostEqual((q[0] - p[0]) - (x1 - x0), 0.0, delta=0.35,
                                   msg=f"la manzana se estiró entre {x0} y {x1}")

    def test_it_dies_away_from_the_town(self):
        """Sin esto el desplazamiento se acumularía a lo largo de los 60 km del
        mundo y Caldera acabaría a un kilómetro de donde está."""
        self.assertAlmostEqual(math.hypot(*self.field.at(3200, 1050)), 0.0, delta=0.5)
        self.assertAlmostEqual(math.hypot(*self.field.at(1050, 3200)), 0.0, delta=0.5)

    def test_a_wider_street_takes_more(self):
        """δ sale del ancho de CADA clase, no de una constante: el Paseo se lleva
        10.6 m por lado y una residencial 4.7."""
        self.assertGreater(D.steal_px("paseo"), D.steal_px("secondary"))
        self.assertGreater(D.steal_px("secondary"), D.steal_px("residential"))
        self.assertEqual(D.steal_px("nonexistent-class"), D.steal_px("residential"))


class SanityTests(unittest.TestCase):
    def test_the_map_never_folds(self):
        """UN PLIEGUE ES GEOMETRÍA INVERTIDA, y no avisa: el build termina, el
        mundo se emite, y un pedazo de ciudad sale del revés. Se pide que el mapa
        sea monótono a lo largo de una línea que cruza el pueblo entero."""
        field = D.build(grid_town())
        xs = [field.point(x, 1050)[0] for x in range(500, 2000, 10)]
        for i in range(1, len(xs)):
            self.assertGreater(xs[i], xs[i - 1],
                               "el mapa se dobló sobre sí mismo")
        ys = [field.point(1050, y)[1] for y in range(500, 2000, 10)]
        for i in range(1, len(ys)):
            self.assertGreater(ys[i], ys[i - 1])

    def test_no_streets_is_no_field(self):
        """Un mundo sin calles exageradas no se mueve — el camino que mantiene
        honesto el cambio."""
        field = D.build([])
        self.assertEqual(field.at(1000, 1000), (0.0, 0.0))
        self.assertEqual(field.point(1000, 1000), (1000, 1000))

    def test_a_lone_country_road_is_not_a_town(self):
        """Un camino suelto en el campo no tiene manzanas que separar, así que no
        debe inventar desplazamiento a su alrededor."""
        field = D.build([{"cls": "residential", "pts": [1000, 0, 1000, 4000]}])
        self.assertAlmostEqual(math.hypot(*field.at(1400, 2000)), 0.0, delta=0.5)


class WaterTests(unittest.TestCase):
    """EL AGUA NO SE MUEVE, y esto es lo que hace jugable la Travesía.

    Sin clavarla, el pueblo se mete en el corredor navegable al separarse: el
    canal dragado se cerró a 12 px de media caña contra un casco de 34 y el
    propio build lo avisó. Ganar suelo de manzana a cambio de una etapa entera
    no es un cambio, es un mal intercambio."""

    def test_water_stays_exactly_where_it_was(self):
        # un pueblo, y un canal justo al lado
        town = grid_town()
        canal = [2100, 400, 2600, 400, 2600, 2200, 2100, 2200]
        field = D.build(town, waters=[canal])
        for (x, y) in ((2150, 800), (2350, 1300), (2550, 2000)):
            self.assertAlmostEqual(math.hypot(*field.at(x, y)), 0.0, delta=0.6,
                                   msg=f"el agua se movió en ({x},{y})")

    def test_the_town_still_opens_up_beside_the_water(self):
        """Clavar el agua no puede costar la separación: si la costase, el
        arreglo habría cambiado un problema por otro."""
        delta = D.steal_px("residential")
        field = D.build(grid_town(), waters=[[2100, 400, 2600, 400, 2600, 2200, 2100, 2200]])
        a = field.point(1050, 1050)
        b = field.point(1350, 1050)
        self.assertAlmostEqual((b[0] - a[0]) - 300, delta, delta=2.0)


class WireTests(unittest.TestCase):
    """EL FORMATO QUE VIAJA. `meta.geo` describe una afín y con dilatación la
    proyección deja de serlo, así que el cliente necesita además esta
    corrección para colocar contenido remoto por lat/lon. Si el formato se
    desincroniza, un patrocinio aterriza en la manzana de al lado y nada avisa.
    """

    def test_the_exported_field_matches_the_real_one(self):
        import base64
        import struct
        field = D.build(grid_town())
        patches = D.export_patches(field)
        self.assertTrue(patches)
        worst = 0.0
        for p in patches:
            raw = base64.b64decode(p["d"])
            self.assertEqual(len(raw), p["cols"] * p["rows"] * 4,
                             "el buffer no cuadra con cols x rows x 4 bytes")
            for r in range(p["rows"]):
                for c in range(p["cols"]):
                    i = (r * p["cols"] + c) * 4
                    dx, dy = struct.unpack_from("<hh", raw, i)
                    x = p["x"] + c * p["step"]
                    y = p["y"] + r * p["step"]
                    rx, ry = field.at(x, y)
                    worst = max(worst, abs(dx - rx), abs(dy - ry))
        self.assertLess(worst, 1.5, f"el campo exportado se desvía {worst:.1f}px "
                                    f"del real en sus propios nodos")

    def test_an_empty_field_ships_nothing(self):
        self.assertEqual(D.export_patches(D.build([])), [])


if __name__ == "__main__":
    unittest.main()
