"""LOS MATERIALES — one registry for the families that are not surfaces.

`src/assets/surfaces.json` closed the surface half of this on 2026-08-11 and the
audit (`docs/inventory.md` §13) left the rest open: parcels, greens, piers,
street inks, structures and the minimap. This is that rest.

WHAT BELONGS HERE IS MEASURED, NOT ASSUMED. The register said "duplicated
Canvas/Pixi/editor colors"; scanning the tree found `canvas ∩ pixi = 0` — the
Pixi backend has had no hex literals since it started reading `surfaces.json` —
and `canvas ∩ editor = 40`. Of those 40, several only SHARE A NUMBER: `#e85d75`
is the scooter's paint, a feria cabin and the editor's default feature colour.
§13's own rule says an identical number in two files is not one constant, so
those stay where they are; merging them would only move the hard-coding.

Three failures this guards, all of which have actually happened here:

  * a value the builder EMITS with no material to draw it — `malecon` shipped
    for a week as a `PierStyle` with no recipe, and the lookup fell through to
    `concrete`, so four beach ramps were drawn as grey quays with blue railings
    and lamps, lying on the sand. Nothing threw;
  * a family table growing a second copy somewhere else, which is how every
    drift in this audit began;
  * the minimap restating a colour it should be reading — two of its inks were
    literally the pier decks, with a comment pointing at the file it copied.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums import GreenType, ParcelUse, PierStyle

MATERIALS = os.path.join(ROOT, "src", "assets", "materials.json")
STRUCTURES = os.path.join(ROOT, "src", "render", "c2d", "structures.js")
STRUCTURE_SHAPES = os.path.join(ROOT, "src", "render", "c2d", "structureShapes.js")
HEX = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$", re.I)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def rows(table):
    """A family's real entries — `_`-prefixed keys are prose for the reader."""
    return {k: v for k, v in table.items() if not k.startswith("_")}


class MaterialRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(MATERIALS))

    def test_every_parcel_use_has_a_ground(self):
        have = rows(self.doc["parcel"])
        for use in ParcelUse:
            self.assertIn(use.value, have,
                          f"parcel use {use.value} has no ground colour — it would "
                          f"draw as bare land, which is what `market` did in the editor")

    def test_every_green_type_has_a_fill(self):
        have = rows(self.doc["green"])
        for green in GreenType:
            self.assertIn(green.value, have, f"green type {green.value} has no fill")

    def test_every_pier_style_has_a_complete_recipe(self):
        # The one that shipped broken. A style is not just a colour: an unknown
        # one falls through to `concrete` and gets ITS rails, lamps and hut.
        have = rows(self.doc["pier"])
        for style in PierStyle:
            self.assertIn(style.value, have, f"pier style {style.value} has no recipe")
            recipe = have[style.value]
            for field in ("deck", "seam", "cap", "rail", "centre"):
                self.assertIn(field, recipe,
                              f"pier {style.value} does not say what its {field} is "
                              f"(null is an answer; missing is not)")
            self.assertRegex(recipe["deck"], HEX, f"pier {style.value} deck")

    def test_every_colour_is_a_colour(self):
        for family, table in self.doc.items():
            if family.startswith("_") or family == "version":
                continue
            for key, value in rows(table).items():
                if isinstance(value, str):
                    if key.endswith("Note"):
                        continue
                    self.assertRegex(value, HEX, f"{family}.{key}")

    def test_the_minimap_reads_the_pier_recipes_rather_than_copying_them(self):
        # `MINI_PIER` and `MINI_JETTY` were the concrete and timber decks
        # written out again, with a comment naming the file they came from.
        hud = read(os.path.join(ROOT, "src", "render", "c2d", "hud.js"))
        self.assertIn("MATERIALS.pier.concrete.deck", hud)
        self.assertIn("MATERIALS.pier.timber.deck", hud)
        for deck in (self.doc["pier"]["concrete"]["deck"], self.doc["pier"]["timber"]["deck"]):
            self.assertNotIn(deck, hud, f"the minimap restates {deck} instead of reading it")

    #: A family table written as a literal. Each pattern is one of the tables
    #: this file absorbed, so a reappearance is a genuine regression rather than
    #: a stylistic complaint.
    FORBIDDEN = (
        (r"const PARCEL_FILL\s*=\s*\{\s*\w+\s*:", "a parcel→colour table"),
        (r"const GREEN_COLORS\s*=\s*\{\s*\w+\s*:", "a green→colour table"),
        (r"const PIER_STYLES\s*=\s*\{\s*\w+\s*:", "a pier→recipe table"),
        (r"const SURFACE_PRESET_COLORS\s*=\s*\{\s*\w+\s*:", "a terrain preset table"),
    )

    def test_no_module_grows_its_own_copy_back(self):
        for dirpath, _, files in os.walk(os.path.join(ROOT, "src")):
            if "tiles" in dirpath:
                continue
            for name in sorted(files):
                if not name.endswith((".js", ".jsx")):
                    continue
                path = os.path.join(dirpath, name)
                text = read(path)
                rel = os.path.relpath(path, ROOT)
                for pattern, why in self.FORBIDDEN:
                    self.assertIsNone(re.search(pattern, text),
                                      f"{rel} authors {why}; materials.json owns it")

    def test_building_bridge_ferry_and_berth_are_editable_recipes(self):
        structures = self.doc["structure"]
        for asset in ("building", "bridge", "ferry", "berth"):
            with self.subTest(asset=asset):
                self.assertTrue(structures[asset].get("parts"))
                self.assertIsInstance(structures[asset].get("preview"), dict)
        painter = read(STRUCTURES)
        self.assertIn("paintStructureParts(ctx, S.building.parts", painter)
        self.assertIn("paintStructureParts(ctx, S.bridge.parts", painter)

    def test_double_ended_ferry_has_equivalent_ramps_at_both_ends(self):
        ferry = self.doc["structure"]["ferry"]
        self.assertTrue(ferry["preview"]["doubleEnded"])
        hull = next(part for part in ferry["parts"]
                    if part.get("shape") == "group" and not part.get("when")
                    and any(child.get("fill") == "$ramp" for child in part.get("parts", [])))
        ramps = [part for part in hull["parts"] if part.get("fill") == "$ramp"]
        self.assertEqual(len(ramps), 2, "a double-ended ferry needs one ramp at each end")
        for field in ("y", "w", "h", "r"):
            self.assertEqual(ramps[0][field], ramps[1][field],
                             f"the two ferry ramps disagree on {field}")
        # Rect x is its left edge. These two formulas put equal-width ramps at
        # centres -L-3 and +L+3: mirrored, not a decorative stern door.
        self.assertEqual(ramps[0]["x"], [-1, -9])
        self.assertEqual(ramps[1]["x"], [1, -3])

    def test_structure_family_verbs_are_finite_and_implemented(self):
        verbs = set()
        def walk(parts):
            for part in parts or []:
                if part.get("shape") == "family":
                    verbs.add(part.get("verb"))
                walk(part.get("parts"))
        for record in self.doc["structure"].values():
            if isinstance(record, dict):
                walk(record.get("parts"))
        interpreter = read(STRUCTURE_SHAPES)
        for verb in verbs:
            self.assertIn(f'"{verb}"', interpreter)

    def test_renderer_contains_no_authored_colour_literals(self):
        """The renderer composes registries; it must not become another one.

        Dynamic ``rgba(${rgb},${alpha})`` assembly is engine behaviour. A hex or
        numeric rgba literal in ``src/render`` is an authored ink with no editor
        surface and therefore a second source of truth.
        """
        colour = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.,\s]+\)")
        for dirpath, _, files in os.walk(os.path.join(ROOT, "src", "render")):
            for name in files:
                if not name.endswith((".js", ".jsx")):
                    continue
                path = os.path.join(dirpath, name)
                source = re.sub(r"/\*.*?\*/", "", read(path), flags=re.S)
                source = re.sub(r"^\s*//.*$", "", source, flags=re.M)
                found = colour.findall(source)
                self.assertEqual(found, [],
                                 f"{os.path.relpath(path, ROOT)} authors colours {found}; "
                                 "move them to the relevant JSON registry")


class TextureRegistryTests(unittest.TestCase):
    """EL GRANO DE CADA SUPERFICIE — `materials.json -> textures`.

    Tres fallos que este bloque puede tener y que NO SE VEN, que es lo que los
    hace peligrosos: los tres se dibujan como «no pasó nada».

      * **un verbo que el intérprete no implementa.** `textureFor` devuelve
        `null` a propósito para que una superficie sin textura se vea como
        ayer, así que un `kind` mal escrito es indistinguible de no haber
        autorado nada;
      * **un nombre que ningún pintor pide.** Una entrada huérfana es trabajo
        de autoría que no llega a la pantalla;
      * **un pintor que pide un nombre que no existe.** El mismo silencio, del
        otro lado.
    """

    doc = json.load(open(MATERIALS))
    textures = {k: v for k, v in doc["textures"].items() if not k.startswith("_")}

    def _kinds(self):
        source = read(os.path.join(ROOT, "src", "render", "c2d", "materials.js"))
        block = re.search(r"const VERBS = \{([^}]*)\}", source)
        self.assertIsNotNone(block, "materials.js no expone su tabla de verbos")
        kinds = set(re.findall(r"(\w+):", block.group(1)))
        # `scatter` no está en esa tabla porque NO es un mosaico: se siembra
        # sobre el rectángulo visible en vez de rellenarse. Se comprueba que el
        # intérprete lo reconozca por su nombre, que es lo que decide la rama.
        if 'spec.kind !== "scatter"' in source:
            kinds.add("scatter")
        return kinds

    def test_every_texture_names_a_kind_the_interpreter_implements(self):
        kinds = self._kinds()
        for name, spec in self.textures.items():
            self.assertIn(spec.get("kind"), kinds,
                          f"texture {name} usa el verbo {spec.get('kind')!r}, "
                          f"que `c2d/materials.js` no implementa — se dibujaría "
                          f"como si no existiera")

    def test_inks_are_rgb_triplets_with_their_own_alpha(self):
        """Un `rgba()` armado dejaría la opacidad como una perilla muerta, y
        `mottle` no podría desvanecer su propia tinta sin escribir un color."""
        for name, spec in self.textures.items():
            inks = spec.get("inks")
            self.assertTrue(inks, f"texture {name} no tiene tintas")
            for ink in inks:
                channels = str(ink["rgb"]).split(",")
                self.assertEqual(len(channels), 3, f"{name}: rgb debe ser r,g,b")
                for channel in channels:
                    self.assertTrue(0 <= int(channel) <= 255, f"{name}: canal fuera de rango")
                self.assertTrue(0 < float(ink["a"]) <= 1, f"{name}: alfa fuera de rango")

    def test_each_kind_carries_what_its_verb_reads(self):
        """Un mosaico se llena por CUENTA y un sembrado por DENSIDAD.

        No son la misma perilla con dos nombres: `count` es cuántos elementos
        caben en un mosaico de lado `tile`, y `density` qué fracción de las
        celdas de una retícula global de paso `tile` lleva mancha. Escribir uno
        donde va el otro se dibuja como una superficie vacía, sin error.
        """
        for name, spec in self.textures.items():
            self.assertGreater(spec.get("tile", 0), 0, f"{name}: sin `tile`")
            if spec["kind"] == "scatter":
                self.assertTrue(0 < spec.get("density", 0) <= 1, f"{name}: sin `density`")
                self.assertEqual(len(spec.get("r", [])), 2, f"{name}: `r` debe ser [min, max]")
            else:
                self.assertGreater(spec.get("count", 0), 0, f"{name}: sin `count`")

    def test_registry_and_painters_ask_for_the_same_names(self):
        asked = set()
        for dirpath, _, files in os.walk(os.path.join(ROOT, "src", "render")):
            for name in files:
                if not name.endswith(".js") or name == "materials.js":
                    continue
                source = read(os.path.join(dirpath, name))
                asked |= set(re.findall(
                    r'(?:overlayTexture|textureFor|paintScatter)\(\w+,\s*"([^"]+)"', source))
        self.assertEqual(asked - set(self.textures), set(),
                         "un pintor pide una textura que el registro no trae")
        self.assertEqual(set(self.textures) - asked, set(),
                         "una textura autorada que ningún pintor pide no llega a la pantalla")
