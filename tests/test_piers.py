"""LOS MUELLES — qué se puede decidir de una cubierta sin editar el builder.

Tres de las cuatro mitades ya eran data antes de esto y vale decirlo, porque
cambia dónde estaba el hueco:

  * el ASPECTO: `materials.json` -> `pier`, cinco recetas (`concrete`,
    `timber`, `apron`, `calzada`, `malecon`) con cubierta, juntas, cantonera,
    baranda, línea central, lámparas y caseta;
  * los REGISTROS emitidos: los once llevan `style`, `surface` y `seaEnd`
    tipados, y el DTO los valida — un estilo inventado hace fallar el build en
    vez de caer a concreto, que es el bug que se envió durante una semana;
  * la EXISTENCIA: no la había. Los once se construían con llamadas a
    `make_pier(...)` adentro del pipeline, con su tamaño en PÍXELES.

`content/world/piers.json` cierra el tercero. Lo que NO cierra —a propósito— son
los extremos, y esa decisión es lo que la mitad de este archivo prueba.
"""
import json
import os
import re
import unittest

from churchill.world import config
from churchill.world.content import APRON_DEFS, PIER_DECKS

ROOT = config.ROOT
PIERS_JSON = os.path.join(ROOT, "content", "world", "piers.json")
POI_STAGE = os.path.join(ROOT, "churchill", "world", "pipeline", "poi_stage.py")
BUILD_STAGE = os.path.join(ROOT, "churchill", "world", "pipeline", "build_stage.py")
LANCHA = os.path.join(ROOT, "churchill", "world", "service", "lancha.py")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def source(path):
    """Python with its comments stripped — the prose in this builder explains
    the very pixel values these tests check are gone."""
    return re.sub(r"^\s*#.*$", "", read(path), flags=re.M)


class DeckRegistryTests(unittest.TestCase):
    def setUp(self):
        self.decks = PIER_DECKS

    def test_every_deck_derives_to_the_pixels_it_was_written_as(self):
        """The conversion changes nothing, and that is asserted rather than
        assumed — it is also what let the 33-minute rebuild come back with all
        1001 files byte-identical."""
        px = config.px
        self.assertEqual(px(self.decks["muelle_nacional"]["lengthM"]), 630)
        self.assertEqual(px(self.decks["muelle_pitahaya"]["lengthM"]), 260)
        self.assertEqual(px(self.decks["muelle_faro"]["offsetM"][0]), -7 * config.CUAD)
        self.assertEqual(px(self.decks["muelle_faro"]["offsetM"][1]), 7 * config.CUAD)
        for name in self.decks:
            with self.subTest(pier=name):
                self.assertEqual(px(self.decks[name]["widthM"]), 2 * config.CUAD)

    def test_the_aprons_derive_the_same(self):
        px = config.px
        self.assertEqual(px(APRON_DEFS["ferryRamp"]["widthM"]), 2.0 * config.CUAD)
        self.assertEqual(px(APRON_DEFS["ferryRamp"]["reachM"]), 260)
        self.assertEqual(px(APRON_DEFS["lanchaRamp"]["reachM"]), 260)
        self.assertEqual(px(APRON_DEFS["bajada"]["widthM"]), 30)

    def test_no_pier_size_is_left_as_a_pixel_literal_in_the_builder(self):
        """`630`, `260` and `PITAHAYA_LEN` were the sizes, and they were only
        true at the scale they were tuned at: a 630 px muelle measured 394 m at
        1.6 px/m and 252 m at 2.5. Nobody decided that shortening."""
        src = source(POI_STAGE)
        self.assertNotIn("PITAHAYA_LEN = 260", src)
        self.assertNotIn("pier_y0 + 630", src)
        self.assertIn("PIER_DECKS", src)

    def test_a_deck_names_a_style_and_a_surface_the_vocabulary_admits(self):
        from churchill.world.enums import PierStyle
        from churchill.world.enums.surface import Surface
        styles = {s.value for s in PierStyle}
        labels = {s.label for s in Surface}
        for name, spec in self.decks.items():
            with self.subTest(pier=name):
                self.assertIn(spec["style"], styles)
                self.assertIn(spec["surface"], labels)

    def test_the_surface_is_a_LABEL_and_the_service_accepts_one(self):
        """`Surface` is an IntEnum whose values ARE the RLE bytes, so
        `Surface("bridge")` is a ValueError rather than a lookup — and a label
        is exactly what an authored record carries, because the label is the
        wire format the DTO validates and the client reads. The one-minute
        smoke build is what caught this; a full one would have cost 33."""
        from churchill.world.service.pier import make_pier
        rec = make_pier("t", "T", [0, 0, 10, 0], 8, style="timber", surface="bridge")
        self.assertEqual(rec["surface"], "bridge")

    def test_the_calle_del_muelle_carries_no_length(self):
        """It runs from the calle to the pier's base, and THAT is its length.
        Writing one down would pin the distance between two things the build
        places."""
        self.assertNotIn("lengthM", PIER_DECKS["calle_muelle_pitahaya"])


class TheEndsAreDerivedOnPurposeTests(unittest.TestCase):
    """LOS EXTREMOS NO SE AUTORAN, Y ESO NO ES UNA LIMITACIÓN.

    A pier does not start at a point somebody chose: it starts at the RESOLVED
    shoreline (`botY[col]`, the coast the build has just rasterised), or at the
    north end of a named calle, or at a boat's stern at rest. That derivation is
    what survives a rescale — the shore moves and the pier moves with it. A geo
    anchor, safe as it is against scale, stays where the surveyor left it: after
    a rescale it can be out in the water or inland, and the pier is left
    floating or buried.

    Which is the opposite of the rule for a LANDMARK, and the difference is
    worth keeping straight: a landmark is a place somebody chose, so its anchor
    is geo. A pier is a structure that meets the water, so its anchor is the
    water.
    """

    def test_no_deck_carries_coordinates_of_any_kind(self):
        data = json.loads(read(PIERS_JSON))
        blob = json.dumps({k: v for k, v in data["decks"].items()})
        for banned in ("ll", "geo", "pts", "x0", "y0"):
            self.assertNotIn(f'"{banned}"', blob,
                             f"a deck carries {banned!r} — its ends are the build's to resolve")

    def test_the_file_says_why(self):
        """This is the kind of decision that gets 'fixed' by somebody later
        unless the reason travels with it."""
        data = json.loads(read(PIERS_JSON))
        self.assertIn("_whyNotGeo", data)
        self.assertGreater(len(data["_whyNotGeo"]), 200)

    def test_the_lancha_ramp_takes_its_width_from_the_boat(self):
        """A ramp narrower than the hull is a ramp nobody can use, and the
        lancha is already authored. The registry RECORDS that it derives rather
        than holding a second copy of her beam."""
        self.assertNotIn("widthM", APRON_DEFS["lanchaRamp"])
        self.assertEqual(APRON_DEFS["lanchaRamp"]["widthFrom"], "vessel.deckWidth")
        self.assertIn("deck[1]", source(LANCHA))

    def test_the_ferry_ramp_still_starts_at_the_stern(self):
        self.assertIn("stern_at_rest", source(BUILD_STAGE))


if __name__ == "__main__":
    unittest.main()
