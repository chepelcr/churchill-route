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
FERIA = ROOT / "src" / "render" / "c2d" / "feriaShapes.js"

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



class FeriaInterpreterStandsAloneToo(unittest.TestCase):
    """EL SEGUNDO INTÉRPRETE, y sigue siendo el segundo a propósito.

    Los 28 verbos de la feria NO se fundieron con los 21 de `shapes.js`, y la
    razón está medida: la feria mide en FRACCIONES DEL RADIO del juego (con
    sufijo `Px` para lo absoluto) — un tercer marco — y sólo `disc` y `ring`
    coinciden de nombre. El resto no son primitivas sino RECETAS de un puesto de
    feria: `counter`, `awning`, `facade`, `prizes`, `goods`. Reescribir 71 partes
    afinadas a mano para que hablen el otro vocabulario cambiaría los píxeles del
    campo ferial sin que el jugador gane nada.

    Lo que sí se cerró es la deriva que importaba: los NOMBRES ya no están
    copiados en el validador del editor, se exportan desde acá.
    """

    ALLOWED = {"./primitives.js", "./feriaAssets.json"}

    def test_it_does_not_import_the_game_either(self):
        imps = imports_of(FERIA)
        self.assertNotIn("./gfx.js", imps,
                         "feriaShapes.js volvió a importar gfx.js: la hoja "
                         "sintética y la vista previa del editor dejan de cargar")
        self.assertEqual(imps - self.ALLOWED, set())

    def test_the_json_import_carries_its_attribute(self):
        """Vite acepta un import de JSON sin atributo y Node NO.

        La misma trampa que documenta `game/surfaces.js`, y acá muerde igual: el
        editor lo carga bajo Node pelado para preguntarle sus verbos."""
        self.assertRegex(FERIA.read_text(encoding="utf-8"),
                         r'feriaAssets\.json"\s+with\s*\{\s*type:\s*"json"\s*\}')

    def test_every_verb_takes_its_surface_first(self):
        """Si uno solo escribe en un `ctx` compartido, dibuja en el canvas
        equivocado — y no falla, que es lo peor. La hoja lo encontró: 66 164 px
        de tinta que eran SÓLO las sombras, porque la tabla escribía en `ctx`
        mientras el resto de la función escribía en `g`."""
        body = FERIA.read_text(encoding="utf-8").split("export const FERIA_SHAPES = {", 1)[1]
        verbs = re.findall(r"^  (\w+)\(([^)]*)\)", body, re.M)
        self.assertGreater(len(verbs), 20, "no se encontraron los verbos")
        for name, args in verbs:
            self.assertEqual(args.split(",")[0].strip(), "g",
                             f"el verbo {name} no recibe su superficie")
        # SIN COMENTARIOS. Uno de los verbos lleva escrito por qué su gradiente se
        # llama `grad` y no `g`, y la palabra `ctx` aparece en esa explicación —
        # sexta vez que una prueba de este repo se lee su propia prosa.
        code = re.sub(r"^\s*//.*$", "", body, flags=re.M)
        self.assertNotIn("ctx", code,
                         "quedó un `ctx` en la tabla: ese verbo pinta en el "
                         "canvas del juego pase lo que pase")

    def test_the_names_are_exported_for_the_editor(self):
        text = FERIA.read_text(encoding="utf-8")
        self.assertIn("export const FERIA_SHAPE_NAMES", text,
                      "el editor pregunta esta lista en vez de copiarla")


if __name__ == "__main__":
    unittest.main()


class TheFrameCarriesSizesToo(unittest.TestCase):
    """`S`: EL EVALUADOR DE TAMAÑOS, y por qué un radio no puede ir por `X`.

    `X`/`Y` son AFINES: los anchos se calculan como diferencias (`X(w) - X(0)`),
    así que el desplazamiento del marco se cancela solo. Un radio no tiene de
    dónde restar — pasarlo por `X` le sumaría el origen del marco y pondría el
    círculo en otro lado, con otro tamaño.

    El defecto es la IDENTIDAD, y ésa es la garantía de que el día que se agregó
    no cambió un píxel: las diez hojas de arte salieron idénticas.
    """

    def test_the_frame_documents_S(self):
        text = SHAPES.read_text(encoding="utf-8")
        self.assertIn("frame.S", text, "el contrato del marco no documenta `S`")

    def test_no_size_is_left_raw_in_the_switch(self):
        """Un tamaño que no pasa por `S` es un tamaño que un marco proporcional
        no puede escalar — que es exactamente el defecto que esto vino a cerrar:
        `part.r` y `part.width` no pasaban, así que un vehículo al doble escalaba
        sus posiciones y no sus radios."""
        text = SHAPES.read_text(encoding="utf-8")
        code = re.sub(r"^\s*//.*$", "", text, flags=re.M)
        for bad in ("g.lineWidth = part.width;", "part.r, 0, Math.PI * 2"):
            self.assertNotIn(bad, code,
                             f"`{bad}` volvió a saltarse el marco de tamaños")

    def test_fit_is_a_verb_the_interpreter_admits(self):
        """La cuenta desde un tamaño: lo único que ningún verbo hacía.

        `repeat` toma una cuenta autorada; `stripes` divide un ancho ENTRE una
        cuenta autorada, que es lo contrario. Doce de los dieciocho pintores que
        siguen en código tienen esta forma."""
        text = SHAPES.read_text(encoding="utf-8")
        self.assertRegex(text, r'case "fit"', "el verbo `fit` no está implementado")
        self.assertIn('"fit"', text.split("export const SHAPE_NAMES")[1].split("]")[0],
                      "`fit` no está en SHAPE_NAMES, así que ningún validador lo admite")

    def test_the_recursive_verbs_pass_the_clock_and_the_sizes(self):
        """Una parte anidada perdía el marco de tamaños y, peor, el RELOJ: un
        `spin` dentro de un `repeat` no se movía. Ningún catálogo lo hacía —se
        midió— así que cerrarlo fue gratis."""
        text = SHAPES.read_text(encoding="utf-8")
        body = text.split("export function paintParts")[1]
        # cada llamada recursiva tiene que llevar S y t
        calls = re.findall(r"paintParts\(g, part\.parts, \{(.*?)\}\);", body, re.S)
        self.assertGreaterEqual(len(calls), 3, "no se encontraron las llamadas recursivas")
        for i, c in enumerate(calls):
            self.assertIn("S:", c, f"la llamada recursiva {i} no pasa el marco de tamaños")
            self.assertIn("t:", c, f"la llamada recursiva {i} no pasa el reloj")

    def test_no_arithmetic_leaked_into_the_catalogs(self):
        """`fit` existe para que la cuenta NO se escriba en el JSON. Si un
        catálogo trae una expresión, el verbo falló en su propósito.

        `data_only` SE IMPORTA de `test_actors`, que ya la escribió: es la que
        quita `_x`, `xNote` **y `note`**, y esa tercera es la que importa — sin
        ella este chequeo encuentra la frase de `actors.json` que explica que los
        destellos salen de `hash01` y nunca de `Math.random`. Séptima vez que una
        prueba de este repo se lee su propia prosa, y la razón de importar el
        ayudante en vez de copiarlo."""
        import json
        from tests.test_actors import data_only
        for name in ("vehicles", "world-props", "lights", "actors"):
            path = ROOT / "src" / "assets" / f"{name}.json"
            doc = json.loads(path.read_text(encoding="utf-8"))
            blob = json.dumps(data_only(doc))
            for banned in ("Math.", "=>"):
                self.assertNotIn(banned, blob,
                                 f"{name}.json trae {banned!r}: un registro con una "
                                 "expresión dejó de ser un registro")
