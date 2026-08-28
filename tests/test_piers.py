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


#: La escala a la que se demostró la conversión de estas medidas a metros — ver
#: `CONVERSION_PPM` en `tests/test_world_units.py`, mismo razonamiento.
CONVERSION_PPM = 2.5


def at_ref(metres):
    """El píxel del que salió esta medida, a la escala en que se convirtió."""
    return round(metres * CONVERSION_PPM)


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
        1001 files byte-identical.

        LOS ENTEROS SON LOS DE LA ESCALA A LA QUE SE DEMOSTRÓ, no los de hoy. El
        mundo se reescaló a 3.125 px/m el 2026-08-27 y un muelle de 252 m pasó
        a medir 788 px, como tenía que pasar. Fijado al 630 de entonces, esto
        habría prohibido el reescalado en vez de proteger la conversión — que
        es justo lo contrario de para lo que se escribió. Lo que se conserva es
        que la longitud EN METROS reproduzca el píxel del que salió, y que hoy
        se siga derivando del registro. Las que están escritas contra `CUAD` ya
        eran inmunes: se mueven con él.
        """
        px = config.px
        self.assertEqual(at_ref(self.decks["muelle_nacional"]["lengthM"]), 630)
        self.assertEqual(at_ref(self.decks["muelle_pitahaya"]["lengthM"]), 260)
        self.assertEqual(px(self.decks["muelle_faro"]["offsetM"][0]), -7 * config.CUAD)
        self.assertEqual(px(self.decks["muelle_faro"]["offsetM"][1]), 7 * config.CUAD)
        for name in self.decks:
            with self.subTest(pier=name):
                self.assertEqual(px(self.decks[name]["widthM"]), 2 * config.CUAD)

    def test_the_aprons_derive_the_same(self):
        px = config.px
        self.assertEqual(px(APRON_DEFS["ferryRamp"]["widthM"]), 2.0 * config.CUAD)
        self.assertEqual(at_ref(APRON_DEFS["ferryRamp"]["reachM"]), 260)
        self.assertEqual(at_ref(APRON_DEFS["lanchaRamp"]["reachM"]), 260)
        self.assertEqual(at_ref(APRON_DEFS["bajada"]["widthM"]), 30)

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


class TheCalleDoesNotCrossAManzanaTests(unittest.TestCase):
    """UN MUELLE NO SE LLEGA ATRAVESANDO UNA MANZANA.

    El Muelle de Pitahaya se anclaba al extremo norte de la Calle 2 Presbíterio,
    que termina en su cruce con la Avenida 3 — y esa avenida pasa AL SUR de la
    manzana del Mercado Municipal. La calle auxiliar se estampaba recta desde
    ahí hasta la orilla: 247 px de calzada por dentro del mercado, de calle a
    calle. Medido sobre el mundo publicado, con las coordenadas de sus propios
    registros.

    Pasaba la compuerta de alcance porque a la base del muelle SÍ se llegaba.
    «Alcanzable» y «no le pasa por encima a nadie» son dos preguntas.
    """

    def test_a_segment_that_straddles_a_rect_counts_as_crossing_it(self):
        """LA PARTE QUE IMPORTA, y la que una compuerta escrita a la ligera
        pierde: los dos extremos de esa calle caen FUERA de la manzana. Va de
        y 14495 a y 14254 y el Mercado ocupa de 14340 a 14460 — entra por un
        lado y sale por el otro. Una prueba por vértices se ve verde sobre el
        mundo roto."""
        from churchill.world.pipeline.finish import _seg_hits_rect
        X0, Y0, X1, Y1 = 24560, 14340, 24732, 14460      # la parcela del Mercado
        # la calle auxiliar como se publicó: ni un vértice adentro
        for (x, y) in ((24644, 14495), (24644, 14254)):
            self.assertFalse(X0 <= x <= X1 and Y0 <= y <= Y1,
                             "el fixture ya no reproduce el bug: un extremo cae dentro")
        self.assertTrue(_seg_hits_rect(24644, 14495, 24644, 14254, X0, Y0, X1, Y1),
                        "la calle que atravesaba el Mercado no se detecta")
        # …y la que se resolvió sobre la Calle 2A no lo toca
        self.assertFalse(_seg_hits_rect(24683, 14302, 24683, 14248, X0, Y0, X1, Y1))
        # un segmento entero a un lado, y uno que sólo roza el borde
        self.assertFalse(_seg_hits_rect(24000, 14400, 24100, 14400, X0, Y0, X1, Y1))
        self.assertTrue(_seg_hits_rect(24000, 14400, 24600, 14400, X0, Y0, X1, Y1))

    def test_the_pier_resolves_across_a_list_of_calles(self):
        """La calle que llega al estero es la 2A, no la 2, y la resolución tiene
        que poder decirlo: `street_end` acepta una lista de candidatos, el mismo
        patrón que `block_rect` usa para las cuatro calles de una cuadra."""
        from churchill.world.service.street import street_end
        self.assertIsInstance(config.PITAHAYA_STREETS, tuple)
        self.assertIn("calle 2a", config.PITAHAYA_STREETS)
        self.assertEqual(config.PITAHAYA_STREET, config.PITAHAYA_STREETS[0])
        roads = [
            {"name": "Calle 2 Presbíterio Florencio del Castillo",
             "pts": [24644, 14495, 24807, 15700]},
            {"name": "Calle 2A", "pts": [24683, 14302, 24790, 14472]},
            {"name": "Calle 2A", "pts": [40000, 14302, 40000, 14472]},   # otro barrio
        ]
        seed = street_end(roads, config.PITAHAYA_STREET, 24523, 15910, "north")
        self.assertEqual(seed, (24644, 14495))
        end = street_end(roads, config.PITAHAYA_STREETS, seed[0], seed[1], "north",
                         reach=config.PITAHAYA_CONTINUATION_PX)
        self.assertEqual(end, (24683, 14302),
                         "el segundo paso no siguió hasta la calle que sí llega "
                         "al agua, o se llevó la homónima de otro barrio")

    def test_the_continuation_reach_is_metres(self):
        """Un alcance en px sólo es verdad a la escala a la que se afinó, y este
        mundo lleva cuatro reescalados."""
        src = read(os.path.join(config.ROOT, "churchill", "world", "config.py"))
        line = next(ln for ln in src.splitlines()
                    if ln.startswith("PITAHAYA_CONTINUATION_PX ="))
        self.assertIn("px(", line, f"sigue siendo un literal en px: {line.strip()}")


if __name__ == "__main__":
    unittest.main()
