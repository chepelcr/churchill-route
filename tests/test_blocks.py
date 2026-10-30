"""LAS CUADRAS HECHAS A MANO — `content/world/blocks.json`.

Todo lo que este mundo dice de una manzana que OSM no dice por sí solo: el
superbloque cívico (Catedral, Casa de la Cultura, Biblioteca, dos parques y los
tres tramos de calle peatonal), la manzana de El Carmen, los dos
estadios/plazas, la cuadra repartida del Parque Marino y el Balneario. Hasta el
2026-08-15 los seis eran literales de Python adentro de un `for` en
`pipeline/build_stage.py`: se podía mover un muelle o un hito desde un JSON y no
la Catedral.

CADA BLOQUE NOMBRA SU ESTRATEGIA y el motor la implementa — la misma línea que
§12 traza para las formas. Son cuatro maneras genuinamente distintas de repartir
una manzana, no cuatro nombres para una, y esa es la razón de que el `layout`
sea un valor cerrado y no texto libre: un `layout` que nadie implementa no da
error, simplemente deja de existir una manzana entera, que es exactamente cómo
el centro cívico se perdió una vez.
"""
import json
import os
import re
import unittest

from churchill.world import content
from churchill.world.config import ROOT
from churchill.world.enums import ParcelUse

BLOCKS_JSON = os.path.join(ROOT, "content", "world", "blocks.json")
BUILD_STAGE = os.path.join(ROOT, "churchill", "world", "pipeline", "build_stage.py")
FIELD_PY = os.path.join(ROOT, "churchill", "world", "service", "field.py")

#: Las estrategias que el motor implementa hoy. Mover una fila de acá es una
#: edición deliberada a esta lista, no un accidente.
LAYOUTS = {
    "bands": "FieldService.place_parcels",
    "streets-quad": "FieldService.place_stadium",
    "footprint-lots": "_partition_marine_cuadra",
    "water-inlet": "the pool branch in seat_town_kiosks",
}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def source(path):
    """Python sin comentarios — la prosa de este builder explica justo los
    literales que estas pruebas verifican que ya no están."""
    return re.sub(r"^\s*#.*$", "", read(path), flags=re.M)


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.raw = json.loads(read(BLOCKS_JSON))
        self.blocks = content.BLOCKS

    def test_every_block_names_a_strategy_the_engine_implements(self):
        for block in self.blocks:
            with self.subTest(block=block["id"]):
                self.assertIn(block.get("layout"), LAYOUTS,
                              f"{block['id']} names a layout nobody implements")

    def test_the_six_blocks_are_all_here(self):
        self.assertEqual([b["id"] for b in self.blocks],
                         ["carmen", "centro", "estadio", "estadio_playitas",
                          "parquemar", "balneario"])

    def test_the_order_within_a_strategy_is_preserved(self):
        """EL ORDEN IMPORTA. Dos cuadras hechas a mano pueden tocar el mismo
        suelo y la primera en colocarse se lo queda, así que el archivo conserva
        el orden que tenía la tupla de Python."""
        self.assertEqual([b["id"] for b in content.blocks_by_layout("bands")],
                         ["carmen", "centro"])
        self.assertEqual([b["id"] for b in content.blocks_by_layout("streets-quad")],
                         ["estadio", "estadio_playitas"])

    def test_every_anchor_is_geo(self):
        """La regla que costó el centro cívico entero. Un ancla en píxeles no
        sobrevive un reescalado; `at` sobrevive sólo como el camino que falla
        ruidosamente."""
        for block in content.blocks_by_layout("bands"):
            with self.subTest(block=block["id"]):
                self.assertIn("ll", block, f"{block['id']} has no geo anchor")
                self.assertNotIn("at", block)
                lat, lon = block["ll"]
                self.assertTrue(9.8 < lat < 10.1, f"{lat} is not a Puntarenas latitude")
                self.assertTrue(-84.95 < lon < -84.6, f"{lon} is not a Puntarenas longitude")

    def test_calles_is_a_pair_of_candidate_lists(self):
        """Un par, no una lista de nombres: las calles impares suelen no tener
        nombre y hay que caer a la par que las flanquea. La aridad es lo que lo
        hace una tupla, no lo que contiene — por eso `calles` está en
        `TUPLE_KEYS` y sus dos listas de adentro siguen siendo listas."""
        for block in self.blocks:
            if "calles" not in block:
                continue
            with self.subTest(block=block["id"]):
                self.assertIsInstance(block["calles"], tuple)
                self.assertEqual(len(block["calles"]), 2)
                for side in block["calles"]:
                    self.assertIsInstance(side, list)
                    self.assertTrue(all(isinstance(n, str) for n in side))

    def test_every_part_names_a_parcel_use(self):
        uses = {u.value for u in ParcelUse}
        for block in content.blocks_by_layout("bands"):
            for part in block["parts"]:
                with self.subTest(part=part["id"]):
                    self.assertIn(part["use"], uses)

    def test_a_row_or_col_span_stays_inside_the_declared_weights(self):
        """Una parte que apunta a una banda que no existe no da error: sale una
        parcela vacía o mal dimensionada, y lo que se ve es un edificio que no
        está."""
        for block in content.blocks_by_layout("bands"):
            ncols, nrows = len(block["cols"]), len(block["rows"])
            for part in block["parts"]:
                with self.subTest(part=part["id"]):
                    for key, count in (("col", ncols), ("row", nrows)):
                        band = part[key]
                        lo, hi = (band, band) if isinstance(band, int) else (band[0], band[1])
                        self.assertTrue(0 <= lo <= hi < count,
                                        f"{part['id']}.{key}={band} outside 0..{count - 1}")

    def test_part_ids_are_unique(self):
        ids = [p["id"] for b in content.blocks_by_layout("bands") for p in b["parts"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_the_prose_never_reaches_the_builder(self):
        """El diagrama de la H de calle peatonal y el porqué de cada parte viven
        en el archivo, que es donde sirven. El cargador quita toda llave que
        empiece con `_` en cada nivel, así que nada de eso llega al build."""
        def keys(node):
            # LAS LLAVES, no el texto serializado. Buscar `_bulevar` como
            # subcadena encuentra el id de parte `centro_bulevar`, que es
            # legítimo — la misma trampa de leer texto donde hay estructura que
            # este repo ya pagó cuatro veces del lado del arte.
            if isinstance(node, dict):
                for k, v in node.items():
                    yield k
                    yield from keys(v)
            elif isinstance(node, list):
                for v in node:
                    yield from keys(v)

        loaded = [k for k in keys(self.blocks) if k.startswith("_")]
        self.assertEqual(loaded, [], f"prose reached the builder: {loaded}")
        # …y sigue estando en el archivo, que es donde sirve.
        authored = {k for k in keys(self.raw) if k.startswith("_")}
        self.assertIn("_diagram", authored)
        self.assertIn("_bulevar", authored)


class TheLiteralsAreGoneTests(unittest.TestCase):
    """Un registro que el builder sombrea con su propio literal es peor que no
    tener registro: el editor mostraría un número que el build ignora."""

    def test_the_two_spec_tuples_left_build_stage(self):
        src = source(BUILD_STAGE)
        for gone in ('"id": "carmen"', '"id": "centro"',
                     '"id": "estadio"', '"id": "estadio_playitas"'):
            self.assertNotIn(gone, src, f"{gone} is still a literal in build_stage.py")
        self.assertIn('blocks_by_layout("bands")', src)
        self.assertIn('blocks_by_layout("streets-quad")', src)

    def test_the_whole_cuadra_landmarks_are_a_registry_question(self):
        """`lm["id"] == "parquemar"` y `lm["type"] == "pool"` eran dos ids
        escritos en una rama. Preguntárselo al registro es lo que permite un
        segundo balneario sin editar el builder."""
        src = source(BUILD_STAGE)
        self.assertNotIn('lm["id"] == "parquemar"', src)
        self.assertNotIn('lm["type"] == "pool"', src)
        self.assertIn("FOOTPRINT_LOT_BLOCKS", src)
        self.assertIn("WATER_INLET_LMS", src)

    def test_the_marine_anchor_and_lot_names_come_from_the_spec(self):
        src = source(BUILD_STAGE)
        self.assertNotIn('== "train_station"', src)
        self.assertNotIn("marino_lote_", src)
        self.assertNotIn("marino_cuadra_", src)

    def test_the_marine_site_id_is_not_duplicated(self):
        """Vive en `landmarks.json` → `marineSiteOsmId`, junto a los ocho
        nombres verificados. Un número en dos archivos es la deriva que estos
        registros existen para cerrar."""
        blob = json.dumps(json.loads(read(BLOCKS_JSON)))
        self.assertNotIn(str(content.MARINE_SITE_OSM_ID), blob)


class WholeCuadraTests(unittest.TestCase):
    def test_each_whole_cuadra_block_names_a_landmark_that_exists(self):
        ids = {lm["id"] for lm in content.LANDMARK_DEFS}
        for layout in ("footprint-lots", "water-inlet"):
            for block in content.blocks_by_layout(layout):
                with self.subTest(block=block["id"]):
                    self.assertIn(block["lm"], ids,
                                  f"{block['id']} names a landmark that does not exist")

    def test_the_marine_partition_carries_its_parameters(self):
        block = content.FOOTPRINT_LOT_BLOCKS["parquemar"]
        self.assertEqual(block["anchor"]["takes"], "east")
        self.assertTrue(block["anchor"]["building"])
        for key in ("prefix", "siteId", "blockId"):
            self.assertIn(key, block["lots"])
        self.assertEqual(block["residual"]["green"], "marine")

    def test_the_two_lot_prefixes_are_distinct(self):
        """`finish.verify` exige que cada id OSM de la cuadra tenga EXACTAMENTE
        un lote. Si los dos prefijos coincidieran, dos huellas distintas podrían
        producir el mismo id y una desaparecería bajo el césped."""
        lots = content.FOOTPRINT_LOT_BLOCKS["parquemar"]["lots"]
        self.assertNotEqual(lots["siteId"], lots["blockId"])


if __name__ == "__main__":
    unittest.main()


class StadiumIsOneRecordTests(unittest.TestCase):
    """LA GRADERÍA Y LAS TORRES VIENEN CON EL ESTADIO.

    Vivían en `world-props.json` llaveadas por hito
    (`scenes.stadium.stands.byLandmark`), o sea aparte del estadio al que
    pertenecen. Y eso cerró además una mentira vieja: CLAUDE.md, el ROADMAP y
    `water.json` describían graderías dibujadas «cuando `lm.stands`» — el build
    no emitía `stands`, nadie lo leía, y `drawStadium` eran once líneas.
    """

    def setUp(self):
        self.quads = content.blocks_by_layout("streets-quad")

    def test_the_placement_left_the_art_registry(self):
        props = json.loads(read(os.path.join(ROOT, "src", "assets", "world-props.json")))
        stadium = props["scenes"]["stadium"]
        for key in ("stands", "towers"):
            self.assertNotIn("byLandmark", stadium[key],
                             f"{key} still keys placement by landmark in the art registry")

    def test_the_recipe_stayed_in_the_art_registry(self):
        """El corte: el mundo dice CUÁL estadio lleva gradería y de qué colores;
        el registro de arte dice QUÉ ES una gradería. Es el mismo corte que
        `surfaces.json` y `lights.json` hacen entre identidad y propiedades."""
        props = json.loads(read(os.path.join(ROOT, "src", "assets", "world-props.json")))
        stands = props["scenes"]["stadium"]["stands"]
        for key in ("depth", "tiers", "rake", "roofFrom", "palette"):
            self.assertIn(key, stands, f"the recipe lost {key}")

    def test_each_stadium_carries_its_own(self):
        with_stands = {b["id"] for b in self.quads if b.get("stands")}
        with_towers = {b["id"] for b in self.quads if b.get("towers")}
        self.assertEqual(with_stands, {"estadio", "estadio_playitas"})
        self.assertEqual(with_towers, with_stands)

    def test_a_stand_names_a_real_side(self):
        for block in self.quads:
            if not block.get("stands"):
                continue
            with self.subTest(block=block["id"]):
                stands = block["stands"]
                sides = stands.get("sides") or [stands.get("side")]
                self.assertTrue(sides)
                self.assertEqual(len(sides), len(set(sides)))
                self.assertTrue(set(sides) <= {"north", "south", "east", "west"})


class CrowdTests(unittest.TestCase):
    """QUIÉN ESTÁ EN ESTA CANCHA.

    `maintainStadiumPeds` tenía `"fan"` escrito cuatro veces, así que TODA
    cancha del mundo recibía la misma multitud y no había forma de quitársela a
    una. Y el registro ya ofrecía más de lo que el código leía: `supporter` y
    `mascot` estaban definidos, hospedaban `parcel:stadium` y `parcel:plaza`, y
    no se generaban nunca.
    """

    def setUp(self):
        with open(os.path.join(ROOT, "src", "game", "npcTypes.json"), encoding="utf-8") as fh:
            self.types = {t["id"]: t for t in json.load(fh)["types"]}

    def _crowds(self):
        for block in content.BLOCKS:
            if block.get("crowd") is not None:
                yield block["id"], block["crowd"], block
            for part in block.get("parts", []):
                if part.get("crowd") is not None:
                    yield part["id"], part["crowd"], block

    def test_every_crowd_names_a_type_that_exists(self):
        for owner, crowd, _ in self._crowds():
            for entry in crowd:
                with self.subTest(owner=owner, type=entry["type"]):
                    self.assertIn(entry["type"], self.types)

    def test_every_crowd_type_may_actually_stand_there(self):
        """El fallo NO es ruidoso: un tipo que no puede pararse en esa parcela no
        da error, simplemente no aparece nadie."""
        for owner, crowd, block in self._crowds():
            use = block.get("use", "stadium")
            for entry in crowd:
                hosts = self.types[entry["type"]]["hosts"]
                with self.subTest(owner=owner, type=entry["type"]):
                    self.assertIn(f"parcel:{use}", hosts,
                                  f"{entry['type']} does not host parcel:{use} — "
                                  f"it would simply never appear")

    def test_the_dead_registry_entries_are_alive_now(self):
        """`supporter` y `mascot` existían y no se generaban nunca — la misma
        forma de deriva que los cuatro alfas muertos de `lightPalette` y que
        `ParcelUse.PLAZA` con cero usuarios."""
        used = {e["type"] for _, crowd, _ in self._crowds() for e in crowd}
        self.assertIn("supporter", used)
        self.assertIn("mascot", used)


class PlazaIdentityTests(unittest.TestCase):
    def test_plaza_is_no_longer_an_unused_member(self):
        """`ParcelUse.PLAZA` existía con CERO parcelas usándolo, y
        `materials.json` le daba el MISMO hex que a `stadium` — así que Plaza
        Las Playitas se dibujaba idéntica al Estadio Lito Pérez."""
        uses = {b.get("use") for b in content.BLOCKS}
        uses |= {p.get("use") for b in content.BLOCKS for p in b.get("parts", [])}
        self.assertIn("plaza", uses, "nothing uses ParcelUse.PLAZA")

    def test_a_plaza_no_longer_looks_like_a_stadium(self):
        mats = json.loads(read(os.path.join(ROOT, "src", "assets", "materials.json")))
        self.assertNotEqual(mats["parcel"]["plaza"], mats["parcel"]["stadium"],
                            "a barrio plaza still paints as a stadium")


class ManzanaStyleTests(unittest.TestCase):
    """EL SUELO DE UNA MANZANA, autorado — y direccionado por GEO."""

    def setUp(self):
        self.raw = json.loads(read(BLOCKS_JSON))

    def test_a_manzana_is_addressed_by_geo_and_never_by_id(self):
        """El id de una cuadra es `"cuadra_" + hash(contorno)` y su nombre es
        posicional: un edificio nuevo o un reescalado lo cambian y el override
        se despega EN SILENCIO."""
        for style in self.raw["manzanas"]:
            with self.subTest(style=style.get("name")):
                self.assertIn("at", style)
                self.assertNotIn("id", style)
                self.assertNotIn("cuadra", style)
                lat, lon = style["at"]
                self.assertTrue(9.8 < lat < 10.1 and -84.95 < lon < -84.6)

    def test_a_missing_anchor_fails_the_build_rather_than_warning(self):
        src = read(os.path.join(ROOT, "churchill", "world", "service", "manzana_style.py"))
        self.assertIn("ctx.failures.append", src)
        self.assertNotIn("warn(", src.replace("from ..logging import log, warn", ""))

    def test_the_emitted_record_is_the_shape_the_painter_reads(self):
        """`drawSurfaceStyleGround` existe desde que hay editor y llega VACÍO al
        mundo publicado. Esto lo llena, y sólo sirve si la forma coincide."""
        src = read(os.path.join(ROOT, "churchill", "world", "service", "manzana_style.py"))
        for field_name in ("groundColor", "aceraColor", "aceraWidthCells",
                           "groundPreset", "surfaceClass", "pts"):
            self.assertIn(f'"{field_name}"', src)

    def test_the_style_step_runs_before_verify(self):
        """Un `surface` cambia la MANEJABILIDAD. Correr antes de `verify` es lo
        que hace que una manzana convertida en muro falle la compuerta de red
        en vez de dejar una entrega inalcanzable."""
        runner = read(os.path.join(ROOT, "churchill", "world", "pipeline", "runner.py"))
        self.assertLess(runner.index("apply_manzana_styles("), runner.index("verify(ctx"))


class StreetLightTests(unittest.TestCase):
    """EL ALUMBRADO PÚBLICO — y por qué va por tile."""

    def test_the_spacing_is_metres(self):
        from churchill.world.config import LAMP_POOL_R_M, LAMP_SPACING_M
        self.assertGreater(LAMP_SPACING_M, 0)
        # Un pozo más chico que medio vano deja la calle en islas; más grande
        # que el vano funde todo y la noche vuelve a ser plana.
        self.assertGreater(LAMP_POOL_R_M, LAMP_SPACING_M * 0.5)
        self.assertLess(LAMP_POOL_R_M, LAMP_SPACING_M)

    def test_lamps_are_emitted_per_tile_not_globally(self):
        """Los rótulos son globales porque son ~470; las lámparas son miles. Una
        lista global las cargaría todas para dibujar las que se ven."""
        emit = read(os.path.join(ROOT, "churchill", "world", "pipeline", "emit.py"))
        self.assertIn('add_point("lamps", lamps)', emit)

    def test_a_lamp_record_is_tiny(self):
        """Qué ES una lámpara ya lo dice `lights.json`; repetirlo por poste
        multiplicaría el peso del mundo por nada."""
        src = read(os.path.join(ROOT, "churchill", "world", "service", "streetlights.py"))
        body = src.split('lamps.append({', 1)[1].split('})', 1)[0]
        for banned in ("core", "halo", "radius", "parts"):
            self.assertNotIn(banned, body, f"a lamp record carries {banned}")
