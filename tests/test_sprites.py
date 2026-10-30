"""UN LUGAR PUEDE USAR UNA IMAGEN, y el registro tiene que apuntar a una que exista.

Todo el arte de este juego es vectorial y para casi todo eso es lo correcto —
escala a cualquier zoom, pesa nada, se edita campo por campo. Lo que el vector no
cubre es un lugar CONCRETO que uno quiere que se vea como es: la Catedral de
Puntarenas no es «una catedral del tamaño de su lote», es ese edificio.

Lo que se prueba acá es lo que rompe en silencio:

* **una ruta a un archivo que no está.** El `placeholder` hace que se VEA (un
  bloque liso donde debería ir el edificio) en vez de dejar un hueco, pero un
  bloque liso en producción sigue siendo un bug — y es de los que sólo aparecen al
  desplegar. Se comprueba el archivo, no la intención.
* **una ruta a `src/`.** Vite le pone un hash al nombre en producción, así que la
  ruta escrita a mano deja de existir en el bundle: 404 en dev nunca, 404 en
  producción siempre. Van en `public/`.
* **un tamaño en píxeles.** Los sprites se miden en METROS como todo largo que dos
  runtimes comparten; este mundo se reescaló tres veces y la última se llevó el
  centro cívico entero.
"""
import json
import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "src" / "assets" / "sprites.json"
INTERPRETER = ROOT / "src" / "render" / "c2d" / "shapes.js"
LOADER = ROOT / "src" / "render" / "c2d" / "sprites.js"


def data_only(node):
    """El registro sin su prosa. Sexta vez que una prueba de este repo se lee su
    propio comentario, así que se quita antes de buscar cualquier cosa."""
    if isinstance(node, dict):
        return {k: data_only(v) for k, v in node.items()
                if not k.startswith("_") and not k.endswith("Note") and k != "note"}
    if isinstance(node, list):
        return [data_only(v) for v in node]
    return node


class SpriteRegistry(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.rows = {k: v for k, v in self.doc["sprites"].items() if not k.startswith("_")}

    def test_it_is_versioned(self):
        self.assertEqual(self.doc["version"], 1)

    def test_there_is_at_least_one_row(self):
        """Un verbo que nada ejercita es un verbo roto que nadie ve.

        `casa_prueba` existe para eso y no se borra: si el registro queda vacío,
        `shot-sprites` no tiene qué dibujar y el día que alguien ponga el primer
        edificio de verdad descubre que la ruta, el ancla o los metros nunca
        funcionaron."""
        self.assertTrue(self.rows, "sprites.json quedó sin filas: el verbo `sprite` "
                                   "deja de estar probado contra un archivo real")

    def test_every_row_points_at_a_file_that_exists(self):
        for name, rec in self.rows.items():
            src = rec.get("src", "")
            self.assertTrue(src.startswith("/"),
                            f"{name}.src tiene que ser una ruta servida desde `public/`")
            path = ROOT / "public" / src.lstrip("/")
            self.assertTrue(path.is_file(),
                            f"{name}.src apunta a {src}, que no existe en public/ — "
                            "un 404 que sólo se ve al desplegar")

    def test_no_row_points_into_src(self):
        """Vite le pone un hash al nombre: la ruta a mano no existe en el bundle."""
        for name, rec in self.rows.items():
            self.assertNotIn("/src/", rec.get("src", ""),
                             f"{name}.src apunta a src/, que en producción cambia de nombre")

    def test_sizes_are_in_metres_and_positive(self):
        for name, rec in self.rows.items():
            for k in ("wM", "hM"):
                self.assertIn(k, rec, f"{name} no dice cuánto mide en metros")
                self.assertGreater(rec[k], 0)
            for k in rec:
                self.assertFalse(re.search(r"Px$", k),
                                 f"{name}.{k} está en píxeles; este registro es en METROS")

    def test_every_anchor_is_a_fraction_pair(self):
        for name, rec in self.rows.items():
            a = rec.get("anchor")
            if a is None:
                continue
            self.assertEqual(len(a), 2, f"{name}.anchor tiene que ser un par")
            for v in a:
                self.assertGreaterEqual(v, 0)
                self.assertLessEqual(v, 1, f"{name}.anchor va en FRACCIONES de su propio tamaño")

    def test_every_row_has_a_placeholder(self):
        """Sin él, un sprite que no llega deja un hueco que parece que ahí no
        había nada — y ése es el peor de los dos fallos."""
        for name, rec in self.rows.items():
            self.assertRegex(str(rec.get("placeholder", "")), r"^#[0-9a-fA-F]{3,8}$",
                             f"{name} no tiene un `placeholder` con el que dibujarse roto")


class SpriteVerb(unittest.TestCase):
    def test_the_interpreter_implements_it(self):
        src = INTERPRETER.read_text(encoding="utf-8")
        self.assertRegex(src, r'case "sprite"')
        names = src.split("export const SHAPE_NAMES")[1].split("]")[0]
        self.assertIn('"sprite"', names,
                      "`sprite` no está en SHAPE_NAMES, así que ningún validador lo admite")

    def test_the_scale_comes_from_the_frame_not_from_an_import(self):
        """`domain/units.js` saca los px/m del ACCESOR del mundo, así que
        importarlo acá rompería lo único que hace este archivo cargable solo — y
        eso es de lo que depende la vista previa del editor. Lo trae el marco,
        igual que `X`, `Y` y `S`."""
        src = INTERPRETER.read_text(encoding="utf-8")
        code = re.sub(r"^\s*//.*$", "", src, flags=re.M)
        self.assertNotIn("domain/units.js", code,
                         "el intérprete volvió a importar las unidades del mundo")
        self.assertIn("frame.pxPerM", src, "el marco tiene que traer los px/m")

    def test_the_loader_imports_nothing_but_its_registry(self):
        text = LOADER.read_text(encoding="utf-8")
        text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
        imps = set(re.findall(r"""^\s*import\s+[^;]*?from\s+["']([^"']+)["']""",
                              text, flags=re.M))
        self.assertEqual(imps, {"../../assets/sprites.json"},
                         "el cargador de sprites dejó de ser libre de dependencias")

    def test_the_loader_survives_having_no_Image(self):
        """El editor lo importa bajo Node pelado para preguntarle qué sprites hay.
        Sin la guarda, ese import revienta y el validador entero se cae."""
        self.assertIn('typeof Image === "undefined"', LOADER.read_text(encoding="utf-8"))

    def test_a_failed_sprite_is_not_retried(self):
        """Un 404 reintentado sesenta veces por segundo es una tormenta de red."""
        self.assertIn('"failed"', LOADER.read_text(encoding="utf-8"))

    def test_the_renderer_callers_pass_the_scale(self):
        """El defecto es 1 px/m a propósito —un sprite del tamaño de una uña SE
        VE— pero los llamadores de verdad tienen que pasar el real."""
        for rel in ("entities.js", "streets.js", "landmarks.js", "lights.js"):
            src = (ROOT / "src" / "render" / "c2d" / rel).read_text(encoding="utf-8")
            self.assertIn("pxPerM: PX_PER_M", src, f"{rel} no pasa los px/m al intérprete")
            self.assertIn("domain/units.js", src, f"{rel} no importa PX_PER_M")


if __name__ == "__main__":
    unittest.main()
