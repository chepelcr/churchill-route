"""CADA BARRIO SE VE COMO ÉL MISMO — `materials.json → districts`.

Los doce distritos viajan en el manifest desde siempre y el renderer los usaba
para exactamente dos cosas: un contorno de depuración y la píldora del nombre de
calle. El puerto entero se pintaba con una paleta, así que El Cocal, el Paseo,
el Centro y Esparza salían del mismo bombo.

Las compuertas de abajo son las tres formas que este registro tiene de pudrirse
en silencio, y las tres ya cobraron una pieza en este repo:

* una paleta para un barrio que el mundo NO emite — es la deriva exacta que
  `test_building_styles` caza para las categorías, y que ya cobró tres
  (`amenity=school`, `building=industrial`, `building=warehouse`);
* un color escrito en el intérprete en vez de en el registro — el barrido de
  tokens y `test_world_props` existen por eso;
* un segundo resolvedor de «qué distrito manda aquí» — el editor ya pintó una
  vez un `park` de un verde mientras el juego lo pintaba de otro.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

MATERIALS = os.path.join(ROOT, "src", "assets", "materials.json")
MANIFEST = os.path.join(ROOT, "src", "world2d", "manifest.json")
DISTRICTS_JS = os.path.join(ROOT, "src", "render", "c2d", "districts.js")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def code(src):
    """El fuente SIN comentarios.

    Sin esto, una compuerta que prohíbe una palabra la encuentra en el
    comentario que explica por qué no se usa — y castiga precisamente al que se
    tomó el trabajo de dejarlo escrito.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


class DistrictPaletteTests(unittest.TestCase):
    def setUp(self):
        self.styles = json.loads(read(MATERIALS)).get("districts", {})
        self.world = {d["id"] for d in json.loads(read(MANIFEST))["districts"]}
        self.js = code(read(DISTRICTS_JS))

    def test_every_styled_district_is_one_the_world_emits(self):
        for did in self.styles:
            self.assertIn(did, self.world,
                          f"'{did}' no es un distrito de este mundo — una paleta "
                          f"para un barrio que no existe no se ve nunca y no "
                          f"falla nunca")

    def test_every_colour_is_a_real_hex(self):
        for did, spec in self.styles.items():
            for key, value in (spec.get("building") or {}).items():
                if key.startswith("_") or not isinstance(value, list):
                    continue
                for col in value:
                    self.assertRegex(col, HEX,
                                     f"{did}.building.{key}: '{col}' no es un hex")

    def test_a_palette_offers_more_than_one_colour(self):
        """Una lista de un solo color pinta el barrio entero de ese color.

        Es lo mismo que no tener paleta, pero con la apariencia de tenerla — y
        se ve como una manzana de casas clonadas, que es peor que el bombo
        único que esto vino a arreglar.
        """
        for did, spec in self.styles.items():
            for key in ("walls", "roofs"):
                got = (spec.get("building") or {}).get(key)
                if got is None:
                    continue
                self.assertGreaterEqual(len(got), 2, f"{did}.building.{key}")

    def test_the_engine_owns_no_colour(self):
        lits = re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d", self.js)
        self.assertEqual(lits, [],
                         f"districts.js autora color: {lits} — el registro es "
                         f"el dueño, el motor sólo lo resuelve")

    def test_it_asks_the_accessor_instead_of_resolving_districts_again(self):
        """`W.districtAt` hace MÁS de lo que uno escribiría: prueba primero los
        polígonos autorados en el editor y sólo después cae al centroide más
        cercano. Un segundo resolvedor aquí empezaría a discrepar el día que
        alguien autore un polígono."""
        self.assertIn("W.districtAt(", self.js)
        for forbidden in ("pointInPoly", "centroid", "DIST_CENTROID"):
            self.assertNotIn(forbidden, self.js,
                             f"districts.js reimplementa la búsqueda ({forbidden})")

    def test_the_choice_is_seeded_never_random(self):
        """Dos casas vecinas no pueden salir del mismo color, y ninguna puede
        cambiar de color al volver a mirarla."""
        self.assertIn("hash01", self.js)
        self.assertNotIn("Math.random", self.js)


if __name__ == "__main__":
    unittest.main()
