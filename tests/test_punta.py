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
            self.assertTrue(9.974 < lat < 9.979 and -84.853 < lon < -84.848,
                            f"[{lat}, {lon}] no cae en La Punta — ¿píxeles, o lon/lat al revés?")

    def test_every_use_has_a_material(self):
        ground, pool = self.mat["punta"]["ground"], self.mat["punta"]["pool"]
        for g in self.doc["balneario"]["grounds"] + self.doc["balneario"]["islands"]:
            self.assertIn(g["use"], ground, f"{g['id']}: sin color de suelo")
        for p in self.doc["balneario"]["pools"]:
            self.assertIn(p["use"], pool, f"{p['id']}: sin color de agua")
        for p in self.doc["balneario"]["props"]:
            self.assertIn(p["kind"], self.mat["punta"]["props"], f"{p['id']}: sin arte")

    def test_figures_carry_degrees_and_metres(self):
        ml = self.doc["malecon"]
        for family, size in (("fans", "rM"), ("waves", "lenM")):
            spec = ml[family]
            self.assertTrue(2 < spec[size] < 30, f"{family}.{size} no parece metros")
            self.assertGreater(spec["rowM"], 0)
            self.assertGreater(spec["spacingM"], spec["halfExtentM"])
            self.assertTrue(-90 <= spec["leanDeg"] <= 90, f"{family}: ladeo fuera de grados")
        w = ml["widthM"]
        self.assertGreater(w["tip"], max(w["north"], w["south"]), "la punta es lo más ancho")
        self.assertGreaterEqual(len(ml["alongLL"]), 10)

    def test_there_is_one_malecon_and_it_is_the_faros(self):
        self.assertEqual(self.doc["malecon"]["style"], "esplanade")
        self.assertIn("esplanade", self.mat["malecon"])
        # ni piso ni tinta propios: el piso es `malecon.esplanade`, la tinta las comas
        self.assertNotIn("malecon", self.mat["punta"]["ground"])
        for family in ("fan", "wave"):
            self.assertNotIn("ink", self.mat["punta"][family])
        source = open(PAINTER, encoding="utf-8").read()
        self.assertIn("scenes.faro.palette.comma", source)

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
