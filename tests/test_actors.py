"""LA GENTE Y EL TRÁFICO — la familia de arte más grande del juego.

26 dibujantes y 116 colores literales en `src/render/c2d/entities.js`: peatones,
playeros, jugadores, nadadores, pasajeros, pescadores, muelleros, tráfico,
trenes, gaviotas, barcos, cardúmenes, vendedores, animales, monedas y la carga
que uno lleva. La mitad del vehículo era data desde 2026-08-13; la multitud no.

LA JUNTURA YA EXISTÍA. `src/game/npcTypes.json` le da a cada tipo un campo
`art`, así que el TIPO —movimiento, hosts, densidad, velocidad— se autora desde
hace tiempo. Lo que ese `art` NOMBRA es lo que seguía en código, y
`src/assets/actors.json` es esa mitad.

Y una línea que estas pruebas fijan tanto como la migración: **esto es la
paleta, no la geometría.** Un peatón se dibuja sobre `pe.ph`, una fase POR
INSTANCIA que la simulación adelanta, y sobre `pe.hue`, que le toca al nacer. Un
`bob` de `sin(ph)·1.4` no es una lista de partes — es una función del estado de
esa persona. Convertirla sería escribir aritmética en JSON, que es exactamente
la línea que `docs/inventory.md` §12 traza.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

ACTORS_JSON = os.path.join(ROOT, "src", "assets", "actors.json")
ENTITIES_JS = os.path.join(ROOT, "src", "render", "c2d", "entities.js")
NPC_TYPES = os.path.join(ROOT, "src", "game", "npcTypes.json")

#: A colour literal: a hex, or an `rgb(...)` whose contents are NUMBERS. An
#: `rgba(${r},${g},${b},…)` assembled from registry channels is the engine doing
#: its job, not a palette left behind — same exemption `test_lights.py` makes.
COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.,\s]+\)")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def data_only(node):
    """The registry with its PROSE removed — every `_x` and `xNote` key gone.

    A scan of the whole blob matches the notes, and the notes are where the
    reasoning lives: this file explains that the shoal's flashes come from
    `hash01` and never from `Math.random`, so a check for "no `Math.` in the
    registry" found that sentence. It is the fourth time a test in this repo has
    read its own explanation as evidence, which is why this is a helper and not
    a regex tightened in place.
    """
    if isinstance(node, dict):
        return {k: data_only(v) for k, v in node.items()
                if not k.startswith("_") and not k.endswith("Note") and k != "note"}
    if isinstance(node, list):
        return [data_only(v) for v in node]
    return node


def source(path):
    """The file with its comments stripped.

    Every scan in this repo that skipped this matched its own prose. Three
    separate tests learned it the same way, which is why it is a helper.
    """
    return re.sub(r"^\s*//.*$", "", read(path), flags=re.M)


class ActorRegistryTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(read(ACTORS_JSON))
        self.actors = self.data["actors"]

    def test_not_one_colour_literal_is_left_in_the_painter(self):
        """The measurement this unit exists to move: 116 -> 0."""
        found = set(COLOUR.findall(source(ENTITIES_JS)))
        self.assertEqual(found, set(),
                         f"these colours belong in actors.json: {sorted(found)}")

    def test_every_art_an_npc_type_names_has_a_record(self):
        """THE JOIN IS `npcTypes.json`'s `art` FIELD, and it is the reason this
        registry is worth having rather than a second list of names. A type
        naming an art with no palette is not an error anybody sees — the drawer
        falls through to the default walker, so an authored fisher silently
        becomes a commuter."""
        types = json.loads(read(NPC_TYPES))["types"]
        arts = {t["art"] for t in types if t.get("art")}
        # TWO GROUPS SHARE A PALETTE ON PURPOSE, and both are worth naming:
        #   * `fan` and `paseante` are the WALKER's drawing with another
        #     movement — the malecón's crowd is the town's crowd, on a Sunday;
        #   * `person`/`vendor`/`worker`/`mascot` are the four styles an
        #     AUTHORED npc may pick, and their colour comes from the instance
        #     (whoever placed it chose it), so what is left to share is one
        #     palette of everything that is not the colour.
        drawn = (set(self.actors) | {"fan", "paseante", "walker"}
                 | {"person", "vendor", "worker", "mascot"})
        self.assertEqual(arts - drawn, set(),
                         f"npcTypes name arts with no palette: {sorted(arts - drawn)}")

    def test_every_hue_pair_is_a_saturation_and_a_lightness(self):
        """`hsl(hue S% L%)` mixes the instance's HUE with the role's S/L. The
        pair was written six times with five different values and no way to tell
        whether the difference was meant; as data it is one glance."""
        for name, spec in self.actors.items():
            for key, value in spec.items():
                # A 2-list is an hsl pair; a 3-list is an RGB triple (the
                # shoal's flash, whose alpha is computed per fish). Both are
                # legitimate and they are told apart by length, which is why
                # this asserts the length rather than assuming it.
                if not isinstance(value, list) or len(value) != 2:
                    continue
                with self.subTest(actor=name, field=key):
                    for v in value:
                        self.assertTrue(0 <= v <= 100, f"{v}% is not a percentage")

    def test_the_school_flash_is_a_triple_not_a_string(self):
        """Its alpha is computed PER FISH (`0.3 + h·0.5`), so storing the colour
        as `rgba(...)` would mean string surgery on a literal at draw time — the
        exact thing `lights.json` deleted when it found four dead alphas."""
        flash = self.actors["school"]["flash"]
        self.assertIsInstance(flash, list)
        self.assertEqual(len(flash), 3)

    def test_the_coins_are_the_generated_vocabulary(self):
        from churchill.world.enums.game import CoinType
        coins = {k for k in self.data["coins"] if not k.startswith("_")}
        self.assertEqual(coins - {"shadow"}, {c.value for c in CoinType})

    def test_every_coin_carries_a_full_metal(self):
        for name, spec in self.data["coins"].items():
            if name.startswith("_") or name == "shadow":
                continue
            with self.subTest(coin=name):
                for field in ("rim", "face", "mark", "r"):
                    self.assertIn(field, spec, f"{name} has no {field}")


class TheLineBetweenPaletteAndGeometryTests(unittest.TestCase):
    """WHAT MUST STAY IN CODE, asserted so that moving it is a deliberate edit
    to this list rather than an accident."""

    def test_the_trigonometry_did_not_move_into_json(self):
        """A per-instance phase is not a part list. If a future edit tries to
        express the bob as data, this is the test that should be argued with
        first — `docs/inventory.md` §12 draws the line and this pins it."""
        blob = json.dumps(data_only(json.loads(read(ACTORS_JSON))))
        for banned in ("Math.", "sin(", "cos(", "=>"):
            self.assertNotIn(banned, blob,
                             f"{banned!r} in a palette registry means it stopped being one")

    def test_the_painter_still_owns_the_motion(self):
        src = source(ENTITIES_JS)
        self.assertIn("pe.ph", src, "the per-instance phase must stay in the painter")
        self.assertIn("Math.sin", src)

    def test_the_melt_gradient_stayed_in_code(self):
        """The cargo's colour walks a hue with `melt/total` — a function of THIS
        delivery's state, not a palette. It is `oklch` in the painter on
        purpose, and the registry says so rather than holding a dead swatch."""
        self.assertIn("oklch", source(ENTITIES_JS))

    def test_the_hue_comes_from_the_instance_and_never_from_the_registry(self):
        """A hue written down here would dress the whole crowd the same."""
        for name, spec in data_only(json.loads(read(ACTORS_JSON)))["actors"].items():
            with self.subTest(actor=name):
                self.assertNotIn("hue", spec, f"{name} pins a hue the world should give it")


class SharedPieceTests(unittest.TestCase):
    """Lo que más de un actor comparte de verdad."""

    def setUp(self):
        self.data = json.loads(read(ACTORS_JSON))

    def test_the_hull_is_one_boat(self):
        """It lived inside `drawBoat`, so the estero's pangas were a SECOND,
        hand-drawn boat — a flat trapezoid — and a panga met on the gulf and one
        met in the channel were visibly different objects for no reason a player
        could name."""
        hull = self.data["hull"]
        for field in ("shadow", "topsides", "boottop"):
            self.assertIn(field, hull)
        self.assertIn("paintHull", source(ENTITIES_JS))

    def test_the_skin_is_written_once(self):
        """Fourteen copies before. The point is not tidiness: it is that
        deciding this town has more than one skin tone should be a field, not a
        find-and-replace over fourteen call sites."""
        skin = self.data["shared"]["skin"]
        self.assertRegex(skin, r"^#[0-9a-f]{6}$")


if __name__ == "__main__":
    unittest.main()
