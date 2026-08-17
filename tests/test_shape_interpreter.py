"""EL INTÉRPRETE DE FORMAS SE PUEDE IMPORTAR SOLO, y esto lo mantiene así.

`src/render/c2d/shapes.js` es el motor de todo catálogo de arte del juego, y el
editor lo carga para dibujar la vista previa del registro que está editando. Eso
exige que se pueda importar SIN el juego detrás: `gfx.js` es el fondo del
renderer y arrastra el accesor del mundo, el `state` mutable, el ciclo del día,
`tuning`, `units` y `materials.json`.

Es una invariante frágil y silenciosa: alguien agrega `import { ctx } from
"./gfx.js"` en shapes.js, todo el juego sigue funcionando igual, y la vista
previa del editor se rompe sin un solo error acá. Por eso se prueba.

**Y el editor dibujando por su cuenta NO es la alternativa.** Eso ya pasó: el
editor previsualizaba un `park` en `#5ba362` mientras el juego lo pintaba
`#4f9d5b`. Un intérprete o la vista previa es mentira.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHAPES = ROOT / "src" / "render" / "c2d" / "shapes.js"
PRIMS = ROOT / "src" / "render" / "c2d" / "primitives.js"
GFX = ROOT / "src" / "render" / "c2d" / "gfx.js"

#: los módulos que el intérprete tiene permitido tocar. `vehicleShapes.js` entra
#: porque sólo depende de `game/vehicles.js`, que por contrato (CLAUDE.md) es
#: libre de DOM y de `window` para que Node lo pueda importar.
ALLOWED_IMPORTS = {"../vehicleShapes.js", "./primitives.js"}


def imports_of(path):
    """Los especificadores que un módulo importa, sin leer los comentarios.

    Un `grep` de `gfx.js` sobre este archivo da tres aciertos y los tres están en
    la prosa que explica por qué NO se importa. Es la quinta vez en este repo que
    una prueba se lee su propio comentario, así que acá se parsea el `import`."""
    text = path.read_text(encoding="utf-8")
    # fuera comentarios de bloque y de línea antes de buscar un import
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    return set(re.findall(r"""^\s*import\s+[^;]*?from\s+["']([^"']+)["']""",
                          text, flags=re.M))


class ShapeInterpreterStandsAlone(unittest.TestCase):
    def test_shapes_does_not_import_gfx(self):
        imps = imports_of(SHAPES)
        self.assertNotIn("./gfx.js", imps,
                         "shapes.js volvió a importar gfx.js: la vista previa del "
                         "editor deja de poder cargar el intérprete del juego")

    def test_shapes_imports_only_the_allowed_two(self):
        imps = imports_of(SHAPES)
        extra = imps - ALLOWED_IMPORTS
        self.assertEqual(extra, set(),
                         f"shapes.js importa {sorted(extra)}; si de verdad hace "
                         "falta, agregarlo a ALLOWED_IMPORTS **y comprobar que se "
                         "puede importar bajo Node pelado**, que es lo que se está "
                         "protegiendo")

    def test_primitives_imports_nothing_at_all(self):
        """La razón de existir de `primitives.js`: es la hoja del árbol."""
        self.assertEqual(imports_of(PRIMS), set(),
                         "primitives.js dejó de ser libre de dependencias")

    def test_the_four_helpers_take_their_context(self):
        """Nada acá puede escribir en un `ctx` de módulo, o no sirve fuera del juego."""
        text = PRIMS.read_text(encoding="utf-8")
        body = re.sub(r"^\s*//.*$", "", text, flags=re.M)
        for fn in ("label", "areaLabel"):
            m = re.search(rf"export function {fn}\(([^)]*)\)", body)
            self.assertIsNotNone(m, f"{fn} no está exportada desde primitives.js")
            first = m.group(1).split(",")[0].strip()
            self.assertEqual(first, "g",
                             f"{fn} tiene que recibir su superficie como primer "
                             f"argumento, no tomarla de un binding compartido")

    def test_gfx_still_reexports_them_at_the_old_signature(self):
        """Los ~30 dibujantes del renderer siguen llamando `label(x, y, …)`.

        El lift no vale si hay que tocar cada llamador: gfx.js envuelve las dos
        con el `ctx` compartido, y esa es la razón de que las nueve hojas de arte
        salieran idénticas."""
        text = GFX.read_text(encoding="utf-8")
        for name in ("areaLabel", "hash01", "label", "roundRect"):
            self.assertRegex(text, rf"\b{name}\b",
                             f"gfx.js dejó de re-exportar {name}")
        self.assertIn("./primitives.js", imports_of(GFX),
                      "gfx.js tiene que tomarlas de primitives.js, no volver a "
                      "definirlas — dos copias de hash01 son dos dispersiones")

    def test_paintAt_has_no_hidden_default_surface(self):
        """`opts.g || sharedCtx` era un fallback SILENCIOSO.

        Un llamador que se olvidaba de `g` dibujaba en el canvas del juego en vez
        del suyo, que es un error con la forma de «no pasó nada»."""
        body = re.sub(r"^\s*(//|\*|/\*).*$", "", SHAPES.read_text(encoding="utf-8"),
                      flags=re.M)
        self.assertNotIn("sharedCtx", body,
                         "paintAt volvió a tener una superficie por defecto")


if __name__ == "__main__":
    unittest.main()
