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
