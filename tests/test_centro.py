"""EL CENTRO CÍVICO — `content/world/centro.json`: el Parque Mora y Cañas y la
manzana de la Catedral, trazados.

Lo que este registro puede tener mal y NO SE VE:

* una tinta que no existe pinta el cuerpo en el magenta de `missing` — y un
  cuerpo magenta dentro de un edificio de cuarenta se pierde en una captura;
* un `kit` mal escrito no dibuja nada, sin error;
* un largo en píxeles deja de ser verdad en el próximo reescalado;
* y lo de fondo: lo que se DIBUJA y lo que se PISA tienen que ser lo mismo. El
  piso gris es `boulevard` en el ráster, las islas verdes y los edificios son
  pared, y cada boca tiene que llegar del asfalto al piso. Un parque dibujado
  recorrible sobre un ráster que dice `land` es una pared invisible.

Las pruebas de la segunda mitad leen el MUNDO EMITIDO, que es lo único que el
juego ve: se rompen si alguien edita el registro y no corre `pnpm world:centro`.
"""
import base64
import json
import math
import os
import unittest

from churchill.world.config import ROOT
from churchill.world.content import CENTRO_DEF

REG = os.path.join(ROOT, "content", "world", "centro.json")
MATERIALS = os.path.join(ROOT, "src", "assets", "materials.json")
WORLD = os.path.join(ROOT, "src", "world2d")
LAND, ROAD, ACERA, BOULEVARD = 1, 3, 6, 7

#: llaves de un cuerpo cuyo valor es una tinta de `materials.json → centro.inks`
INK_KEYS = ("wall", "cap", "edge", "parapet", "stains")


def tiers_of(doc, structure):
    if structure.get("kit"):
        return doc["kits"][structure["kit"]]["tiers"]
    arms = structure.get("arms")
    out = list(structure.get("tiers", []))
    if arms:
        out.append({"wall": arms["wall"], "cap": arms["cap"], "bands": arms["bands"],
                    "truss": arms["truss"], "stains": arms["stains"], "z": [0, arms["floorsM"][-1]], "box": [1, 1]})
    return out


def inks_of(tier):
    for key in INK_KEYS:
        if tier.get(key):
            yield tier[key]
    for _f0, _f1, ink in tier.get("bands", []):
        yield ink
    for op in tier.get("openings", []):
        yield op["ink"]
    # una cara distinta por arista (`bodies.js → faces`): su pared, sus bandas y sus ventanas
    for face in (tier.get("faces") or {}).values():
        if not isinstance(face, dict):
            continue
        if face.get("wall"):
            yield face["wall"]
        for _f0, _f1, ink in face.get("bands") or []:
            yield ink
        if face.get("windows"):
            yield face["windows"]["ink"]
    if tier.get("windows"):
        yield tier["windows"]["ink"]
    # el mosaico de una tapa (`bodies.js → paintMosaic`): sus cuatro tintas también son de la casa
    yield from (tier.get("mosaic") or {}).get("inks", [])
    if tier.get("truss"):
        yield tier["truss"]["ink"]
    roof = tier.get("roof") or {}
    for key in ("ink", "ink2", "cross"):
        if roof.get(key):
            yield roof[key]


class CentroRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.load(open(REG, encoding="utf-8"))
        self.mat = json.load(open(MATERIALS, encoding="utf-8"))["centro"]

    def test_the_builder_loads_the_same_file(self):
        # `_load` quita las notas (`_…`): se compara lo que identifica, no el archivo crudo
        self.assertEqual([p["id"] for p in CENTRO_DEF["places"]], [p["id"] for p in self.doc["places"]])
        self.assertEqual(sorted(CENTRO_DEF["kits"]), sorted(k for k in self.doc["kits"] if not k.startswith("_")))

    def test_every_place_is_anchored_in_geo_at_the_civic_centre(self):
        self.assertEqual([p["id"] for p in self.doc["places"]], ["mora", "catedral"])
        for place in self.doc["places"]:
            lat, lon = place["originLL"]
            self.assertTrue(9.977 < lat < 9.980 and -84.838 < lon < -84.833,
                            f"{place['id']}: [{lat}, {lon}] no cae en el centro — ¿píxeles, o lon/lat al revés?")
            self.assertTrue(-45 < place["axisDeg"] < 45, f"{place['id']}: el eje no parece grados")

    def test_lengths_are_metres_inside_the_block(self):
        """Ninguna cuadra de acá mide más de 200 m: un número mayor es un píxel."""
        def walk(node, where):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key.startswith("_") or key in ("originLL", "n", "count", "inks"):
                        continue
                    walk(value, f"{where}.{key}")
            elif isinstance(node, list):
                for item in node:
                    walk(item, where)
            elif isinstance(node, (int, float)) and not isinstance(node, bool):
                self.assertLessEqual(abs(node), 360, f"{where}: {node} no es metros ni grados")
        walk(self.doc["places"], "places")
        walk(self.doc["kits"], "kits")

    def test_every_ink_and_floor_exists(self):
        inks = self.mat["inks"]
        for place in self.doc["places"]:
            self.assertIn(place["lawn"], self.mat["lawn"])
            for shape in place["paved"]:
                self.assertIn(shape["floor"], self.mat["floors"], f"{place['id']}/{shape['id']}: piso sin material")
            for s in place["structures"]:
                if s.get("kit"):
                    self.assertIn(s["kit"], self.doc["kits"], f"{place['id']}: kit desconocido {s['kit']}")
                for tier in tiers_of(self.doc, s):
                    for ink in inks_of(tier):
                        if ink == "mural":           # el muro de murales: blanco + franjas de `mural.inks`
                            continue
                        self.assertIn(ink, inks, f"{place['id']}/{s.get('id', s.get('kit'))}: tinta «{ink}» sin color")

    def test_every_body_stands_on_the_ground_or_on_another(self):
        for place in self.doc["places"]:
            for s in place["structures"]:
                tiers = tiers_of(self.doc, s)
                self.assertTrue(any(t["z"][0] == 0 for t in tiers), f"{s.get('id')}: nada toca el suelo")
                for t in tiers:
                    self.assertLessEqual(t["z"][0], t["z"][1])
                    self.assertLess(t["z"][1], 40, f"{s.get('id')}: {t['z'][1]} m es más alto que nada en Puntarenas")
                    self.assertEqual(sum(k in t for k in ("box", "disc", "arc", "ring", "poly")), 1,
                                     f"{s.get('id')}: un cuerpo lleva exactamente una huella")

    def test_benches_are_cement(self):
        """Las bancas de este parque son de cemento; las de madera son del malecón."""
        for tier in self.doc["kits"]["bench"]["tiers"]:
            self.assertTrue(tier["cap"].startswith("cement") and tier["wall"].startswith("cement"))

    def test_the_cathedral_stands_back_from_calle_7(self):
        """El ábside se salía a la calle: OSM lo pone a 2 m del cordón y la calle del juego es más ancha."""
        cat = next(p for p in self.doc["places"] if p["id"] == "catedral")
        church = next(s for s in cat["structures"] if s.get("id") == "catedral")
        apse = next(t for t in church["tiers"] if "arc" in t)
        west_tip = church["at"][0] + apse["at"][0] - apse["arc"]["rM"]
        west_edge = min(u for u, _v in cat["own"])
        self.assertGreater(west_tip - west_edge, 13, "el ábside vuelve a quedar sobre la acera de la Calle 7")

    def test_the_park_is_as_the_author_described_it(self):
        """Cuatro murales en arco alrededor del tanque, y UN cilindro en el Palacio, entre las alas."""
        mora = next(p for p in self.doc["places"] if p["id"] == "mora")
        murals = [s for s in mora["structures"] if str(s.get("id", "")).startswith("mural_")]
        self.assertEqual(len(murals), 4)
        for m in murals:                                  # …arcos concéntricos con el tanque
            tier = m["tiers"][0]
            self.assertIn("ring", tier, f"{m['id']}: un mural es un muro curvo")
            self.assertEqual([m["at"][0] + tier["at"][0], m["at"][1] + tier["at"][1]], [0, 0],
                             f"{m['id']}: el arco no está centrado en el tanque")
        palacio = next(s for s in mora["structures"] if s.get("id") == "palacio")
        discs = [t for t in palacio["tiers"] if "disc" in t]
        self.assertEqual(len(discs), 1, "el Palacio lleva un solo cilindro")
        self.assertLess(discs[0]["z"][1] - palacio["arms"]["floorsM"][-1], 3, "el cilindro va ENTRE las alas, no encima")
        self.assertGreater(palacio["arms"]["fromM"], 0, "las alas nacen de la pared del cilindro")
        self.assertLess(palacio["arms"]["fromM"], discs[0]["disc"], "…sin dejar hueco entre ala y cilindro")

    def test_a_diagonal_mouth_names_where_its_path_comes_from(self):
        for pid, mid in (("mora", "diagonal"), ("catedral", "sur")):
            place = next(p for p in self.doc["places"] if p["id"] == pid)
            mouth = next(m for m in place["mouths"] if m["id"] == mid)
            self.assertIn("from", mouth, f"{pid}/{mid}: sin `from` la boca sale a escuadra de la calle")

    def test_the_build_chain_runs_centro_after_punta(self):
        scripts = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))["scripts"]
        for name in ("world:build", "world:punta"):
            chain = scripts[name]
            self.assertIn("shot-centro-preview.mjs --emit", chain, f"{name}: La Punta reescribe el tile del centro")
            self.assertLess(chain.index("shot-punta-preview.mjs"), chain.index("shot-centro-preview.mjs"))


class CentroEmittedWorldTests(unittest.TestCase):
    """Lo que el juego recibe: `manifest.centro` y el ráster de su tile."""

    @classmethod
    def setUpClass(cls):
        cls.doc = json.load(open(REG, encoding="utf-8"))
        cls.manifest = json.load(open(os.path.join(WORLD, "manifest.json"), encoding="utf-8"))
        cls.meta = cls.manifest["meta"]
        cls.tiles = {}

    def cls_at(self, x, y):
        tp, cell = self.meta["tilePx"], self.meta["cell"]
        key = f"{int(x // tp)}_{int(y // tp)}"
        if key not in self.tiles:
            t = json.load(open(os.path.join(WORLD, "tiles", key + ".json"), encoding="utf-8"))
            rle, grid = base64.b64decode(t["rle"]), bytearray()
            for k in range(0, len(rle), 2):
                grid += bytes([rle[k + 1]]) * rle[k]
            self.tiles[key] = (t, grid)
        t, grid = self.tiles[key]
        return grid[int((y - t["y"]) // cell) * t["cols"] + int((x - t["x"]) // cell)]

    def place(self, pid):
        return next(p for p in self.manifest["centro"]["places"] if p["id"] == pid)

    def test_the_world_carries_both_places(self):
        centro = self.manifest.get("centro")
        self.assertIsNotNone(centro, "el mundo no trae el centro cívico: falta `pnpm world:centro`")
        self.assertEqual([p["id"] for p in centro["places"]], [p["id"] for p in self.doc["places"]])
        for src, out in zip(self.doc["places"], centro["places"]):
            self.assertEqual(len(out["paved"]), len(src["paved"]), f"{src['id']}: el registro cambió y no se emitió")
            self.assertEqual(len(out["structures"]), len(src["structures"]))
            self.assertEqual(len(out["mouths"]), len(src["mouths"]))

    def test_the_old_parcels_are_gone(self):
        ids = {p["id"] for p in self.manifest["parcels"]}
        self.assertFalse({i for i in ids if i.startswith("centro_")}, "quedan parcelas del superbloque viejo")
        self.assertNotIn("osm_park_232390078", ids)

    def test_the_grey_floor_is_drivable_and_the_green_is_not(self):
        for place in self.manifest["centro"]["places"]:
            for shape in place["paved"]:
                pts = shape["pts"]
                cx = sum(pts[0::2]) / (len(pts) / 2)
                cy = sum(pts[1::2]) / (len(pts) / 2)
                if (place["id"], shape["id"]) in (("mora", "tanque"), ("mora", "bustos")):
                    # en el centro de estas dos rotondas hay algo macizo (el tanque, la plataforma
                    # de los bustos): no se atraviesa, pero 9 m al sur el piso sí se recorre
                    self.assertEqual(self.cls_at(cx, cy), LAND, f"{shape['id']}: lo macizo del centro se atraviesa")
                    south = 9 * self.meta["pxPerMeter"]
                    cx, cy = cx - math.sin(place["ang"]) * south, cy + math.cos(place["ang"]) * south
                self.assertEqual(self.cls_at(cx, cy), BOULEVARD, f"{place['id']}/{shape['id']}: el piso no se puede recorrer")
        # una isla verde del parque y el jardín norte de la Catedral: pared
        ppm = self.meta["pxPerMeter"]
        for pid, (u, v) in (("mora", (-20, -30)), ("mora", (20, 45)), ("catedral", (0, -30))):
            p = self.place(pid)
            a = p["ang"]
            x = p["ox"] + (u * math.cos(a) - v * math.sin(a)) * ppm
            y = p["oy"] + (u * math.sin(a) + v * math.cos(a)) * ppm
            self.assertEqual(self.cls_at(x, y), LAND, f"{pid}: la isla verde en ({u}, {v}) m se puede pisar")

    def test_every_mouth_reaches_the_asphalt(self):
        cell = self.meta["cell"]
        for place in self.manifest["centro"]["places"]:
            self.assertTrue(place["mouths"], f"{place['id']}: un lugar sin boca es una isla")
            for mo in place["mouths"]:
                ax, ay, bx, by, cx, cy, dx, dy = mo["pts"]
                x0, y0, x1, y1 = (ax + bx) / 2, (ay + by) / 2, (cx + dx) / 2, (cy + dy) / 2
                length = math.hypot(x1 - x0, y1 - y0)
                ux, uy = (x1 - x0) / length, (y1 - y0) / length
                self.assertEqual(self.cls_at(x0 - ux * 3 * cell, y0 - uy * 3 * cell), ROAD, f"{mo['id']}: no arranca en la calle")
                seen = set()
                s = 0.0
                while s <= length + 3 * cell:
                    seen.add(self.cls_at(x0 + ux * s, y0 + uy * s))
                    s += cell / 2
                self.assertLessEqual(seen, {ROAD, BOULEVARD}, f"{place['id']}/{mo['id']}: hay pared entre la calle y el piso")

    def test_the_sidewalk_ring_survives_outside_the_mouths(self):
        """La acera se abre SÓLO en las bocas: el resto del anillo sigue siendo acera."""
        p = self.place("mora")
        ppm, a = self.meta["pxPerMeter"], p["ang"]
        # la acera de la Calle 11, lejos de la boca oeste (v = 0)
        u, v = -30, 28
        x = p["ox"] + (u * math.cos(a) - v * math.sin(a)) * ppm
        y = p["oy"] + (u * math.sin(a) + v * math.cos(a)) * ppm
        self.assertEqual(self.cls_at(x, y), ACERA)

    def test_the_cathedral_block_is_fused_to_its_bulevar(self):
        """Sin acera del lado este: de la cuadra a la calle peatonal es todo boulevard."""
        p = self.place("catedral")
        self.assertTrue(p.get("fused"), "falta la franja pegada al Bulevar de la Casa de la Cultura")
        ppm, a = self.meta["pxPerMeter"], p["ang"]
        for u in (122.5, 124.5, 127, 130):          # del final del paseo central al medio de la calle
            x = p["ox"] + (u * math.cos(a) - 1 * math.sin(a)) * ppm
            y = p["oy"] + (u * math.sin(a) + 1 * math.cos(a)) * ppm
            self.assertEqual(self.cls_at(x, y), BOULEVARD, f"hay un corte entre el paseo y el Bulevar en u = {u} m")

    def test_the_landmarks_sit_on_their_buildings(self):
        lms = {lm["id"]: lm for lm in self.manifest["landmarks"]}
        cat = self.place("catedral")
        for lm_id, sid in (("catedral", "catedral"), ("cultura", "cultura")):
            s = next(q for q in cat["structures"] if q["id"] == sid)
            lm = lms[lm_id]
            self.assertIn(lm_id, self.manifest["centro"]["landmarks"])
            self.assertTrue(s["x0"] <= lm["x"] <= s["x1"] and s["y0"] <= lm["y"] <= s["y1"],
                            f"{lm_id}: el hito no está sobre su edificio")


if __name__ == "__main__":
    unittest.main()


class BodyRecipeTests(unittest.TestCase):
    """LOS CUERPOS DE RECETA (`world-props.json → bodies`): la Capitanía, los quioscos y los
    cañones, pintados por `c2d/bodies.js` como los edificios del centro cívico.

    Una tinta que no existe pinta en el magenta de `missing`, y una `$x` que el hito no
    pone también: un quiosco con el toldo magenta se ve en el mundo y en ninguna prueba."""

    def setUp(self):
        self.props = json.load(open(os.path.join(ROOT, "src", "assets", "world-props.json"), encoding="utf-8"))
        self.inks = json.load(open(MATERIALS, encoding="utf-8"))["centro"]["inks"]

    def test_every_ink_exists_or_is_supplied_by_its_landmark(self):
        bodies = {k: v for k, v in self.props["bodies"].items() if not k.startswith("_")}
        users = {}
        for key, rec in self.props["landmarks"].items():
            if isinstance(rec, dict) and rec.get("body"):
                self.assertIn(rec["body"], bodies, f"{key}: cuerpo desconocido «{rec['body']}»")
                users.setdefault(rec["body"], []).append((key, rec.get("inks") or {}))
        for name, spec in bodies.items():
            # `low`: lo bajo de un lote que es su cuerpo (las maceteras de la UTN), un cuerpo aparte con las mismas reglas
            for tier in spec["tiers"] + spec.get("low", []):
                if tier.get("facet"):
                    # una CARA DE TECHO no tiene huella: es un plano con la altura de cada vértice
                    self.assertGreaterEqual(len(tier["facet"]), 3, f"{name}: una cara de techo pide 3 vértices")
                    self.assertTrue(all(len(p) == 3 for p in tier["facet"]), f"{name}: cada vértice es [u, v, zM]")
                    for key in ("ink", "ink2"):
                        if tier.get(key):
                            self.assertIn(tier[key], self.inks, f"{name}: tinta «{tier[key]}» sin color")
                    continue
                self.assertEqual(sum(k in tier for k in ("box", "disc", "arc", "ring", "poly")), 1, f"{name}: un cuerpo lleva una huella")
                for ink in inks_of(tier):
                    if ink == "mural":           # el muro de murales: blanco + franjas de `mural.inks`
                        continue
                    if ink.startswith("$"):
                        for key, given in users.get(name, []):
                            self.assertIn(ink[1:], given, f"{key}: usa «{name}» y no pone la tinta {ink}")
                    else:
                        self.assertIn(ink, self.inks, f"{name}: tinta «{ink}» sin color")

    def test_a_parcel_that_is_itself_names_a_body_that_exists(self):
        """`parcels.byId`: la UTN se levanta como su propio cuerpo (`bodies.utn`). Un id que nombra
        un cuerpo que no existe no avisa: la parcela vuelve a la escena genérica de su uso."""
        by_id = {k: v for k, v in self.props["parcels"].get("byId", {}).items() if not k.startswith("_")}
        self.assertIn("osm_campus_112244756", by_id, "la UTN dejó de levantarse")
        for pid, rec in by_id.items():
            self.assertIn(rec["body"], self.props["bodies"], f"{pid}: cuerpo desconocido «{rec['body']}»")
        manifest = json.load(open(os.path.join(ROOT, "src", "world2d", "manifest.json"), encoding="utf-8"))
        ids = {p["id"] for p in manifest["parcels"]}
        for pid in by_id:
            self.assertIn(pid, ids, f"{pid}: el mundo no emite esa parcela")

    def test_a_face_names_an_edge_of_its_footprint(self):
        for name, spec in self.props["bodies"].items():
            if name.startswith("_"):
                continue
            for tier in spec["tiers"]:
                if not tier.get("faces"):
                    continue
                self.assertIn("box", tier, f"{name}: `faces` cuenta aristas de una `box`")
                for edge in tier["faces"]:
                    if not edge.startswith("_"):
                        self.assertIn(int(edge), range(4), f"{name}: arista {edge} fuera de la caja")

    def test_low_stays_low_and_trees_name_a_species(self):
        """`low` se pinta ANTES que todo por ser bajo (`centro.lowM`): un bloque de más altura dejaría de
        serlo y taparía las copas; y un árbol de `trees` sin especie del registro no se siembra."""
        flora = json.load(open(os.path.join(ROOT, "src", "assets", "flora.json"), encoding="utf-8"))
        species = flora.get("species", flora)
        low_m = json.load(open(MATERIALS, encoding="utf-8"))["centro"]["lowM"]
        for name, spec in self.props["bodies"].items():
            if name.startswith("_"):
                continue
            for tier in spec.get("low", []):
                self.assertLessEqual(tier["z"][1], low_m, f"{name}: `low` con un bloque de {tier['z'][1]} m")
            for tr in spec.get("trees", []):
                self.assertIn(tr["k"], species, f"{name}: árbol de especie desconocida «{tr['k']}»")

    def test_a_shed_roof_says_which_side_is_high(self):
        """`roof.kind: shed` (a un agua): sin `high` el armador no sabe cuál arista es la cumbrera."""
        for name, spec in self.props["bodies"].items():
            if name.startswith("_"):
                continue
            for tier in spec["tiers"]:
                roof = tier.get("roof") or {}
                if roof.get("kind") == "shed":
                    self.assertIn("box", tier, f"{name}: un techo a un agua pide una `box`")
                    self.assertIn(roof.get("high"), ("n", "e", "s", "w"), f"{name}: techo a un agua sin `high`")

    def test_the_utn_recipe_is_what_its_generator_writes(self):
        """`bodies.utn` lo escribe `tools/gen_utn_body.py`: editado a mano, la próxima corrida lo pisa."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("gen_utn_body", os.path.join(ROOT, "tools", "gen_utn_body.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual(self.props["bodies"]["utn"], json.loads(json.dumps(mod.body, ensure_ascii=False)))

    def test_the_cannons_and_the_capitania_are_bodies(self):
        self.assertEqual(self.props["landmarks"]["capitania"]["body"], "capitania")
        self.assertIn("cannons", self.props["bodies"])
        for product in ("kiosk", "kiosk:vigoron", "kiosk:ceviche", "kiosk:papicarne", "kiosk:mariscada"):
            self.assertTrue(self.props["landmarks"][product].get("body"), f"{product}: el quiosco no se levanta")
