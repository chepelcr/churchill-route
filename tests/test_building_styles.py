"""EL COLOR DE UN EDIFICIO SALE DE LO QUE EL EDIFICIO ES.

Lo que se protege acá es la LLAVE, porque es contraintuitiva y la próxima
persona la va a buscar donde no está: la categoría de un edificio NO vive en su
etiqueta `building`. Medido sobre `docs/map.osm`, de las 635 huellas con nombre
de esta ventana **571 dicen `building=yes`** — la etiqueta no distingue nada. La
categoría real está en `amenity`/`shop`/`tourism`/`office`, que es lo que
`poi_category` resuelve y el mundo emite como `cat`.

Si alguien re-teclea este registro contra `building`, estas pruebas lo dicen.
"""
import json
import os
import re
import unittest
from collections import Counter

from churchill.world.config import ROOT

STYLES = os.path.join(ROOT, "src", "assets", "building-styles.json")
MANIFEST = os.path.join(ROOT, "src", "world2d", "manifest.json")
TILES = os.path.join(ROOT, "src", "world2d", "tiles")
HEX = re.compile(r"#[0-9a-f]{6}")


def load():
    with open(STYLES, encoding="utf-8") as fh:
        return json.load(fh)


def emitted_categories():
    """`cat` -> cuántos edificios lo traen, en el mundo publicado."""
    counts = Counter()
    for name in os.listdir(TILES):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(TILES, name), encoding="utf-8") as fh:
            for b in json.load(fh).get("buildings", []):
                if b.get("cat"):
                    counts[b["cat"]] += 1
    return counts


class ShapeTests(unittest.TestCase):
    def setUp(self):
        self.doc = load()
        self.cats = self.doc["byCat"]

    def test_every_colour_is_a_lowercase_hex(self):
        for cat, spec in self.cats.items():
            for key in ("walls", "roofs"):
                for hexa in spec.get(key, []):
                    self.assertRegex(hexa, HEX,
                                     f"{cat}.{key}: {hexa!r} no es un hex de 6")

    def test_a_palette_is_a_non_empty_list(self):
        for cat, spec in self.cats.items():
            for key in ("walls", "roofs"):
                if key in spec:
                    self.assertIsInstance(spec[key], list)
                    self.assertTrue(spec[key], f"{cat}.{key} está vacío: una lista "
                                               f"vacía no elige nada y el edificio "
                                               f"cae al color emitido sin decirlo")

    def test_windows_are_a_flag(self):
        for cat, spec in self.cats.items():
            if "wnd" in spec:
                self.assertIn(spec["wnd"], (0, 1), f"{cat}.wnd")

    def test_a_category_key_is_a_tag_pair(self):
        for cat in self.cats:
            self.assertRegex(cat, r"^[a-z_]+=[a-z_:]+$",
                             f"{cat!r} no tiene forma `clave=valor`")

    def test_the_key_is_not_the_building_tag(self):
        """LA TRAMPA. `building` no distingue nada acá: 571 de 635 dicen `yes`.
        Un registro que se apoye en ella pinta el puerto de un solo color."""
        self.assertNotIn("building=yes", self.cats,
                         "`building=yes` son 571 de las 635 huellas con nombre: "
                         "no es una categoría, es la ausencia de una")


class WorldTests(unittest.TestCase):
    """Contra el mundo EMITIDO, que es donde `cat` de verdad existe."""

    @classmethod
    def setUpClass(cls):
        cls.doc = load()
        cls.counts = emitted_categories()

    def test_the_world_actually_emits_categories(self):
        self.assertGreater(sum(self.counts.values()), 300,
                           "el mundo dejó de emitir `cat`: el registro no tiene "
                           "por dónde entrar y todos los edificios vuelven al "
                           "color del bombo")

    def test_every_styled_category_exists_in_the_world(self):
        """Un estilo para una categoría que nadie produce es deriva — arte que
        espera un valor que no llega, el mismo caso que `LandmarkType` documenta
        desde el otro lado."""
        unseen = [c for c in self.doc["byCat"] if c not in self.counts]
        self.assertEqual(unseen, [], f"categorías con estilo y sin edificios: {unseen}")

    def test_the_busiest_categories_are_styled(self):
        """La cobertura es el punto: si las diez categorías más pobladas no
        están, el registro existe y no se ve."""
        top = [c for c, _ in self.counts.most_common(10)]
        missing = [c for c in top if c not in self.doc["byCat"]]
        self.assertEqual(missing, [],
                         f"las más pobladas del mundo sin estilo: {missing}")





if __name__ == "__main__":
    unittest.main()
