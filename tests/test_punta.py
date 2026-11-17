"""LA PUNTA — `content/world/punta.json`, el registro de El Faro y el Balneario.

Lo que este archivo puede tener mal y NO SE VE: un `use` sin color pinta con el
del terreno, un rumbo en radianes gira la figura a cualquier parte, y un largo
en píxeles deja de ser verdad en el próximo reescalado. Y una cosa que es de
diseño y no de forma: el malecón del Faro es UNO. El piso es el `esplanade` de
siempre y la tinta de sus figuras es la de las comas; si alguno de los dos
reaparece copiado en otro archivo, el lugar vuelve a tener dos pisos.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

REG = os.path.join(ROOT, "content", "world", "punta.json")
MATERIALS = os.path.join(ROOT, "src", "assets", "materials.json")
PAINTER = os.path.join(ROOT, "src", "render", "c2d", "punta.js")


def lls(node):
    """Every [lat, lon] pair under a node."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "ll" or key.endswith("LL"):
                # un ancla suelta es un par; una figura, una lista de pares
                if value and isinstance(value[0], (int, float)):
                    yield value
                else:
                    yield from value
            else:
                yield from lls(value)
    elif isinstance(node, list):
        for item in node:
            yield from lls(item)


class PuntaRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.load(open(REG, encoding="utf-8"))
        self.mat = json.load(open(MATERIALS, encoding="utf-8"))

    def test_every_anchor_is_geo_and_at_la_punta(self):
        pairs = list(lls(self.doc))
        self.assertGreater(len(pairs), 200)
        for lat, lon in pairs:
            self.assertTrue(9.9735 < lat < 9.979 and -84.853 < lon < -84.82,
                            f"[{lat}, {lon}] no cae en el frente de La Punta al Muelle de Cruceros — ¿píxeles, o lon/lat al revés?")

    def test_every_use_has_a_material(self):
        punta = self.mat["punta"]
        pool = json.load(open(os.path.join(ROOT, "src", "assets", "world-props.json"),
                              encoding="utf-8"))["scenes"]["pool"]["palette"]
        for g in self.doc["balneario"]["grounds"] + self.doc["balneario"]["islands"]:
            if g["use"] != "deck":            # el deck es el del Parque Marino
                self.assertIn(g["use"], punta["ground"], f"{g['id']}: sin color de suelo")
        for p in self.doc["balneario"]["pools"]:
            if p.get("zone"):
                self.assertIn(punta["pool"]["zones"][p["use"]], pool, f"{p['id']}: sin tono de agua")

    def test_figures_carry_degrees_and_metres(self):
        ml = self.doc["malecon"]
        for family, size in (("fans", "rM"), ("waves", "lenM")):
            spec = ml[family]
            self.assertTrue(2 < spec[size] < 30, f"{family}.{size} no parece metros")
            self.assertNotIn("rowM", spec, f"{family}: es UNA fila")
            self.assertGreater(spec["spacingM"], spec["halfExtentM"])
            self.assertTrue(-90 <= spec["leanDeg"] <= 90, f"{family}: ladeo fuera de grados")
        w = ml["widthM"]
        self.assertTrue(all(18 < w[k] < 70 for k in ("north", "tip", "south")))
        # el círculo del Faro cabe entero en el malecón: no empuja el borde
        self.assertGreaterEqual(w["tip"], 15 + 2 * self.doc["faro"]["plazaRM"] + 2)
        self.assertEqual(self.doc["paseo"]["until"]["pier"], "muelle_nacional")
        self.assertEqual(self.doc["muelle"]["pier"], "muelle_faro")
        # UNA playa: la del Paseo mide lo que la de entre lenguas
        self.assertEqual(self.doc["paseo"]["beachM"], ml["cove"]["beachM"])
        self.assertEqual(self.doc["cruceros"]["pier"], self.doc["paseo"]["until"]["pier"])
        self.assertGreaterEqual(len(ml["alongLL"]), 10)
        self.assertEqual(len(ml["spurs"]["at"]), 5, "los cinco malecones de OSM")

    def test_there_is_one_malecon_and_it_is_the_faros(self):
        self.assertEqual(self.doc["malecon"]["style"], "esplanade")
        self.assertIn("esplanade", self.mat["malecon"])
        # ni piso propio ni colores de piscina propios: el piso es `malecon.esplanade`
        # y la piscina es la del Parque Marino
        self.assertNotIn("malecon", self.mat["punta"]["ground"])
        self.assertNotIn("deck", self.mat["punta"]["ground"])
        source = open(PAINTER, encoding="utf-8").read()
        self.assertIn("scenes.pool.palette", source)

    def test_the_fit_names_a_building_that_exists(self):
        ids = {b["id"] for b in self.doc["buildings"]}
        self.assertIn(self.doc["gameFit"]["interiorAbout"], ids)
        self.assertTrue(0.5 < self.doc["gameFit"]["interiorScale"] <= 1)

    def test_the_wave_outline_closes_on_its_two_tails(self):
        outline = self.mat["punta"]["wave"]["outline"]
        self.assertEqual(outline[0], [0, 0])
        self.assertIn([1, 0], outline)
        for u, v in outline:
            self.assertTrue(0 <= u <= 1 and abs(v) < 0.5)


if __name__ == "__main__":
    unittest.main()


class PuntaEmittedWorldTests(unittest.TestCase):
    """Lo que la emisión de La Punta deja en el mundo publicado (`src/world2d`)."""

    WORLD = os.path.join(ROOT, "src", "world2d")
    #: los tiles del frente del Paseo, de El Faro al muelle de cruceros
    FRONT = ("9_7", "10_7", "11_7", "12_7")
    MALECON = 10

    def _tile(self, key):
        with open(os.path.join(self.WORLD, "tiles", f"{key}.json"), encoding="utf-8") as fh:
            return json.load(fh)

    @staticmethod
    def _grid(tile):
        import base64
        raw, out = base64.b64decode(tile["rle"]), bytearray()
        for k in range(0, len(raw) - 1, 2):
            out.extend([raw[k + 1]] * raw[k])
        return out

    def test_the_malecon_keeps_its_palms(self):
        """LA LIMPIEZA DEL FRENTE SE LLEVÓ TODAS LAS PALMERAS DEL MALECÓN (57 → 3) y la fila de
        reemplazo iba en la arena: el Paseo se veía pelado. La fila sobre la baldosa es la que
        las devuelve; menos de la mitad de las de antes es que volvió a pasar."""
        with open(os.path.join(self.WORLD, "manifest.json"), encoding="utf-8") as fh:
            cell = json.load(fh)["meta"]["cell"]
        on_malecon = 0
        for key in self.FRONT:
            tile = self._tile(key)
            grid, cols = self._grid(tile), tile["cols"]
            for palm in tile.get("palms", []):
                c = int((palm["x"] - tile["x"]) // cell)
                r = int((palm["y"] - tile["y"]) // cell)
                if 0 <= c < cols and 0 <= r < tile["rows"] and grid[r * cols + c] == self.MALECON:
                    on_malecon += 1
        self.assertGreaterEqual(on_malecon, 60, f"sólo {on_malecon} palmeras sobre el malecón del Paseo")

    def test_each_terminal_tent_stands_by_its_own_ramp(self):
        """Los toldos del patio buscaban sus rampas DESPUÉS de que el bucle de las rampas las sacara
        del manifest, y los dos caían al mismo punto de respaldo, uno encima del otro."""
        with open(os.path.join(self.WORLD, "manifest.json"), encoding="utf-8") as fh:
            tents = json.load(fh)["punta"]["yard"]["tents"]
        spots = {(t["x"], t["y"]) for t in tents}
        self.assertEqual(len(spots), len(tents), f"toldos apilados en el mismo punto: {tents}")
