"""LA COTA DEL TERRENO — que la fuente diga la verdad y el canal la conserve.

Lo que se está protegiendo no es una cifra sino una LECTURA DEL MUNDO: el arenal
de Puntarenas es plano y cualquier DEM global miente sobre él. Medido el
2026-08-19, SRTM30m y Mapzen levantan Carmen/Paseo/Centro/Playitas 6–8 m sobre el
faro, y eso son TECHOS — son modelos de superficie. Si algún día alguien cambia
la fuente por «un DEM que es más fácil de bajar», esta prueba es lo que lo dice.
"""
import base64
import inspect
import json
import os
import unittest

from churchill.world.config import ROOT
from churchill.world.service.elevation import ELEV_CELL, elevation_field
from churchill.world.util.raster import rle_encode_u16

CONTOURS = os.path.join(ROOT, "content", "world", "contours.json")


def read_contours():
    with open(CONTOURS, encoding="utf-8") as fh:
        return json.load(fh)


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.doc = read_contours()

    def test_the_spit_is_flat_in_the_source_itself(self):
        """Sobre el arenal la fuente sólo trae curvas BAJAS. No es una opinión
        del builder: es lo que el IGN midió, y es la diferencia con un DEM."""
        geo = json.load(open(os.path.join(ROOT, "src", "world2d", "manifest.json"),
                             encoding="utf-8"))["meta"]["geo"]
        # LA CAJA DE LA PENÍNSULA, no el promedio de la curva. Una curva del
        # juego nacional puede medir kilómetros: promediar su x la sitúa sobre
        # el arenal cuando su geometría está tierra adentro. Lo que se pregunta
        # es si alguna curva PASA por el banco de arena.
        X0, X1, Y0, Y1 = 15000, 30000, 14000, 17000
        spit = set()
        for row in self.doc["contours"]:
            elev, flat = row[0], row[1]
            for i in range(0, len(flat), 2):
                x = geo["ax"] * flat[i] + geo["bx"]
                y = geo["ay"] * flat[i + 1] + geo["by"]
                if X0 <= x <= X1 and Y0 <= y <= Y1:
                    spit.add(elev)
                    break
        self.assertTrue(spit, "no hay curvas sobre el arenal")
        self.assertLessEqual(
            max(spit), 20,
            f"el arenal trae una curva de {max(spit)} m. Puntarenas es un banco "
            f"de arena a nivel del mar: eso es un DEM de superficie midiendo "
            f"techos, no el suelo")

    def test_both_sets_are_present_and_neither_is_redundant(self):
        """El urbano hace honesto el arenal; el nacional cubre los cerros que
        el urbano no mapea. Quitar cualquiera de los dos deja un agujero."""
        tags = {row[2] for row in self.doc["contours"] if len(row) > 2}
        self.assertEqual(tags, {"fine", "coarse"})
        fine = max(r[0] for r in self.doc["contours"] if r[2] == "fine")
        coarse = max(r[0] for r in self.doc["contours"] if r[2] == "coarse")
        self.assertGreater(coarse, fine,
                           "el juego nacional tiene que llegar más alto que el "
                           "urbano, o no está aportando la cobertura por la que está")

    def test_elevation_is_metres_and_never_negative(self):
        for row in self.doc["contours"]:
            self.assertIsInstance(row[0], (int, float))
            self.assertGreaterEqual(row[0], 0, "una curva bajo el cero")
            self.assertLess(row[0], 4000, "una curva más alta que el Chirripó")


class ChannelTests(unittest.TestCase):
    """El formato de cable: tripletas de 3 bytes, y un tile plano no paga."""

    def test_a_flat_tile_emits_nothing(self):
        self.assertIsNone(rle_encode_u16([0] * 625))
        self.assertIsNone(rle_encode_u16([]))

    def test_values_survive_the_round_trip(self):
        vals = [0, 0, 120, 120, 120, 4000, 65535, 7]
        raw = base64.b64decode(rle_encode_u16(vals))
        out = []
        for i in range(0, len(raw), 3):
            out.extend([raw[i + 1] | (raw[i + 2] << 8)] * raw[i])
        self.assertEqual(out, vals)

    def test_a_run_longer_than_a_byte_splits(self):
        raw = base64.b64decode(rle_encode_u16([9] * 600))
        counts = [raw[i] for i in range(0, len(raw), 3)]
        self.assertEqual(sum(counts), 600)
        self.assertTrue(all(c <= 255 for c in counts))


class WiringTests(unittest.TestCase):
    """QUE EL EMIT PUEDA LLAMARSE. El smoke de `PLANAR_BBOX` corre la tubería
    entera MENOS `write_world` —sale en `[poi] BUILD INCOMPLETE` antes de
    emitir— así que nada de lo que vive ahí está cubierto por él. Un
    `ctx.dims.W` en vez de `ctx.dims.w` costó una corrida completa de 33 minutos
    para reventar en el último minuto."""

    def test_world_dims_exposes_the_names_write_world_uses(self):
        from churchill.world.context import WorldDims
        d = WorldDims.of(1000, 800, 4)
        for name in ("w", "h", "cell", "cols", "rows"):
            self.assertTrue(hasattr(d, name), f"WorldDims perdió `{name}`")

    def test_the_emit_signature_takes_the_elevation_channel(self):
        from churchill.world.pipeline.emit import emit_world2d
        self.assertIn("elev", inspect.signature(emit_world2d).parameters)

    def test_the_lattice_width_is_manifest_protocol_not_a_client_literal(self):
        from churchill.world.pipeline import emit
        emit_src = inspect.getsource(emit.emit_world2d)
        self.assertIn('manifest_meta["elevSamplesPerTile"] = elev["perTile"]', emit_src)
        with open(os.path.join(ROOT, "src", "world2d", "index.js"), encoding="utf-8") as fh:
            client = fh.read()
        self.assertNotRegex(client, r"elevSamplesPerTile\s*\|\|\s*\d",
                            "the elevation wire width is a magic client fallback again")

    def test_write_world_asks_dims_by_its_real_attribute_names(self):
        import os
        from churchill.world.config import ROOT
        with open(os.path.join(ROOT, "churchill", "world", "pipeline",
                               "finish.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotIn("ctx.dims.W", src, "`WorldDims` no tiene `.W`, tiene `.w`")
        self.assertNotIn("ctx.dims.H", src, "`WorldDims` no tiene `.H`, tiene `.h`")


class FieldTests(unittest.TestCase):
    """El campo, sobre una caja chica — la forma, no el mundo entero."""

    def test_the_field_interpolates_between_two_contours(self):
        # Dos curvas rectas, 0 m y 100 m, separadas por 40 celdas.
        span = ELEV_CELL * 40
        contours = [
            (0.0, [(0.0, 0.0), (0.0, 1.0)], "fine"),
            (100.0, [(1.0, 0.0), (1.0, 1.0)], "fine"),
        ]
        # proyección de juguete: lon 0..1 -> x 0..span, lat 0..1 -> y 0..span
        def project(lat, lon):
            return lon * span, lat * span
        cols, rows, z = elevation_field(project, span, span, contours)
        at = lambda fx: z[(rows // 2) * cols + int(fx * (cols - 1))]
        self.assertLess(at(0.02), 12, "el borde de 0 m no está cerca de 0")
        self.assertGreater(at(0.98), 88, "el borde de 100 m no está cerca de 100")
        mid = at(0.5)
        self.assertTrue(30 < mid < 70,
                        f"el medio entre 0 y 100 salió {mid:.0f}: la relajación "
                        f"no está interpolando, está dejando terrazas")

    def test_far_from_any_contour_is_sea_level(self):
        """Sin este tope el relleno extrapola la cota del cerro más cercano
        sobre el golfo y el estero."""
        span = ELEV_CELL * 200
        contours = [(50.0, [(0.0, 0.0), (0.0, 0.01)], "fine")]
        def project(lat, lon):
            return lon * span, lat * span
        cols, rows, z = elevation_field(project, span, span, contours)
        self.assertEqual(z[(rows - 1) * cols + (cols - 1)], 0.0)


if __name__ == "__main__":
    unittest.main()
