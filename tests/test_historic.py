"""LOS EDIFICIOS HISTÓRICOS QUE OSM NO TIENE (`content/world/historic.json`).

Cada lugar es un lote en la esquina de dos calles con nombre que `tools/emit_historic.py` lleva al mundo
sin reconstruir, y un cuerpo de receta que escribe su generador desde su calco. Lo que se fija aquí:

* el registro dice lo que el emit necesita, y lo manejable cae ADENTRO del lote; un lote sobre UNA calle dice
  dónde está su punta, y una parcela que un lugar reemplaza ya no está en el mundo;
* cada lugar que no es borrador tiene su cuerpo y su parcela en el mundo emitido, y la parcela lo levanta;
* el generador reproduce la receta que está en `world-props.json` (editar la receta a mano se pierde la
  próxima vez que alguien corra el generador, así que no se edita a mano);
* los dos verbos nuevos del pintor de cuerpos —la cortina que se enrolla con el día y el nombre pintado en
  el techo— tienen su perilla en el registro de la casa.
"""
import importlib.util
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load = lambda *p: json.load(open(os.path.join(ROOT, *p), encoding="utf-8"))
_TOOLS = {}


def load_tool(name):
    """un generador de `tools/`, importado una vez: arma sus recetas al importarse y sólo escribe bajo `__main__`"""
    if name not in _TOOLS:
        spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "tools", f"{name}.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _TOOLS[name] = mod
    return _TOOLS[name]


class HistoricRegistry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = load("content", "world", "historic.json")
        cls.props = load("src", "assets", "world-props.json")
        cls.manifest = load("src", "world2d", "manifest.json")
        cls.mat = load("src", "assets", "materials.json")

    def places(self, drafts=False):
        return [p for p in self.doc["places"] if drafts or not p.get("draft")]

    def test_every_place_says_what_the_emit_needs(self):
        ids = set()
        for P in self.places(drafts=True):
            for key in ("id", "name", "use", "body", "anchorLL", "front", "side", "lotM"):
                self.assertIn(key, P, f"{P.get('id')}: le falta `{key}`")
            self.assertNotIn(P["id"], ids, f"{P['id']}: repetido")
            ids.add(P["id"])
            self.assertEqual(len(P["lotM"]), 2)
            self.assertTrue(all(v > 0 for v in P["lotM"]), f"{P['id']}: lote sin tamaño")
            lat, lon = P["anchorLL"]
            self.assertTrue(9.9 < lat < 10.1 and -85.0 < lon < -84.6, f"{P['id']}: el ancla no cae en Puntarenas")

    def test_drivable_ground_and_mouths_stay_inside_the_lot(self):
        for P in self.places():
            LU, LV = P["lotM"]
            for d in P.get("drive", []):
                u0, v0, u1, v1 = d["rectM"]
                self.assertTrue(0 <= u0 < u1 <= LU and 0 <= v0 < v1 <= LV, f"{P['id']}/{d['id']}: se sale del lote {LU} x {LV}")
            for mo in P.get("mouths", []):
                self.assertIn(mo["street"], (P["front"], P["side"]), f"{P['id']}/{mo['id']}: una boca va a una de las dos calles")
                span = LU if mo["street"] == P["front"] else LV
                self.assertTrue(0 <= mo["fromM"] < mo["toM"] <= span, f"{P['id']}/{mo['id']}: la boca se sale del frente del lote")

    def test_every_place_is_in_the_world_with_its_body(self):
        parcels = {p["id"]: p for p in self.manifest["parcels"]}
        by_id = self.props["parcels"]["byId"]
        for P in self.places():
            pid = "hist_" + P["id"]
            self.assertIn(pid, parcels, f"{pid}: no está en el mundo — falta `pnpm world:historic` y `world_snapshot.py save`")
            self.assertIn(P["body"], self.props["bodies"], f"{pid}: no existe `bodies.{P['body']}`")
            self.assertEqual(by_id.get(pid, {}).get("body"), P["body"], f"{pid}: `parcels.byId` no levanta su cuerpo")
            rec = parcels[pid]
            ppm = self.manifest["meta"]["pxPerMeter"]
            self.assertAlmostEqual(rec["hw"] * 2 / ppm, P["lotM"][0], delta=0.1, msg=f"{pid}: el lote del mundo no es el del registro")
            self.assertAlmostEqual(rec["hh"] * 2 / ppm, P["lotM"][1], delta=0.1, msg=f"{pid}: el lote del mundo no es el del registro")
            self.assertEqual(rec["historic"], P["id"])
        # un borrador no está en el mundo, y no se le pide cuerpo todavía
        for P in self.doc["places"]:
            if P.get("draft"):
                self.assertNotIn("hist_" + P["id"], parcels, f"{P['id']}: es borrador y ya está en el mundo")

    def test_the_generator_reproduces_the_recipe(self):
        # cada generador arma sus recetas al importarse y sólo escribe bajo `__main__`
        for tool, bodies in (("gen_acon_body", {"acon": "body"}), ("gen_matadero_body", {"matadero": "hall", "matadero_muro": "muro"})):
            mod = load_tool(tool)
            for key, attr in bodies.items():
                self.assertEqual(json.loads(json.dumps(getattr(mod, attr))), self.props["bodies"][key],
                                 f"bodies.{key} no es lo que escribe tools/{tool}.py: corré el generador (no se edita a mano)")

    def test_a_lot_on_one_street_names_its_end(self):
        # el salón del Matadero cierra la punta de Calle 10: está sobre la avenida, no en una esquina
        for P in self.places(drafts=True):
            if P["side"] is None:
                self.assertIn("cornerLL", P, f"{P['id']}: un lote sobre una sola calle dice dónde está su punta (`cornerLL`)")
                self.assertEqual(P.get("sideSlope", 0.0), 0.0, f"{P['id']}: sin `side` no hay pendiente que seguir")
                self.assertFalse([m for m in P.get("mouths", []) if m["street"] != P["front"]], f"{P['id']}: sin `side`, toda boca va a `front`")

    def test_a_replaced_parcel_is_gone(self):
        # `dropParcels`: el cuadro de la Antigua Fábrica de Hielo era el suelo del recinto del Matadero
        ids = {p["id"] for p in self.manifest["parcels"]}
        dropped = [pid for P in self.places() for pid in P.get("dropParcels", [])]
        self.assertIn("osm_market_232393978", dropped)
        for pid in dropped:
            self.assertNotIn(pid, ids, f"{pid}: un lugar lo reemplaza y sigue en el mundo — falta `pnpm world:historic`")
            self.assertNotIn(pid, self.props["parcels"]["byId"], f"{pid}: reemplazado, y todavía tiene receta en `parcels.byId`")

    def test_the_matadero_closes_calle_10_and_its_wall_meets_the_gate(self):
        # lo que costó leer en las fotos: la fachada mira al sur, por Calle 10 abajo, y el muro de los círculos y
        # los arcos baja por Calle 10 desde el portón del costado. Los dos lotes se tocan ahí
        mod = load_tool("gen_matadero_body")
        hall = next(P for P in self.places() if P["id"] == "matadero")
        muro = next(P for P in self.places() if P["id"] == "matadero_muro")
        self.assertIsNone(hall["side"])
        self.assertEqual(muro["front"], "Calle 10")
        self.assertTrue(0 < mod.U_FACADE < muro["lotM"][0], "la línea de la fachada cae adentro del recinto, pasando la curva")
        self.assertTrue(mod.U_GATE_E < 0, "el portón del costado sigue al este, fuera del lote del salón, hasta el muro del recinto")
        self.assertGreater(mod.NAVE_U1, mod.U_FACADE, "la nave larga pasa la línea de la fachada, al lado del salón (el satélite)")
        self.assertNotIn("pill", self.props["parcels"]["byId"]["hist_matadero"])
        self.assertTrue(any(T.get("facet") and T.get("capText") for T in self.props["bodies"]["matadero"]["tiers"]),
                        "el nombre del Matadero va sobre un faldón de su techo, sin píldora")

    def test_the_bay_is_narrower_than_the_block_and_sits_in_front_of_it(self):
        # lo que el autor señaló mirando las fotos: el balcón (sobre la bahía) es MÁS ANGOSTO que el bloque
        mod = load_tool("gen_acon_body")
        self.assertLess(mod.BAY_U1 - mod.BAY_U0, (mod.MAIN_U1 - mod.GAP) / 2)
        self.assertGreater(mod.BAY_U0, mod.GAP)
        self.assertLess(mod.BAY_U1, mod.MAIN_U1)
        self.assertLess(mod.BAY_V0, mod.MAIN_V0 - 3, "la bahía sale varios metros adelante de la cara del bloque")
        self.assertGreater(mod.GAP, 0, "el autor pidió concreto entre la acera de Calle 4 y la bomba")

    def test_the_ice_factory_roof_meets_the_matadero_shed(self):
        tiers = self.props["bodies"]["matadero_muro"]["tiers"]
        factory = [tier for tier in tiers if tier.get("roof", {}).get("ink") == "mtNeighborRoof"]
        shed = [tier for tier in tiers if tier.get("facet") and tier.get("ink") == "mtLeanTo"]
        self.assertEqual(len(factory), 1, "la cubierta roja lleva una sola cumbrera")
        self.assertEqual(len(shed), 1, "el cobertizo sigue el cambio de ancho en un solo faldón")
        factory_eave = factory[0]["at"][1] - factory[0]["box"][1] / 2
        self.assertLessEqual(factory_eave, max(v for _, v, _ in shed[0]["facet"]),
                             "el alero de la fábrica solapa el cobertizo sin dejar una franja descubierta")
        white = next(tier for tier in tiers if any(op["ink"] == "mtNeighborBand" for op in tier.get("openings", [])))
        factory_end = factory[0]["at"][0] - factory[0]["box"][0] / 2
        white_end = max(u for u, _ in white["poly"])

        # En una pantalla 16:9 el encuentro puede verse a media pantalla de la cámara.
        camera_height = load("src", "assets", "effects.json")["parallax"]["cameraHeightM"]
        view_width = load("src", "assets", "world-units.json")["camera"]["viewWidthM"]
        half_view_depth = view_width * 9 / 32
        factory_eave_height = factory[0]["z"][1]
        factory_ridge = factory_eave_height + factory[0]["roof"]["riseM"]
        self.assertLess(white_end, factory_end - half_view_depth * factory_ridge / camera_height,
                        "desde el norte, la cumbrera proyectada queda antes del pie del muro blanco")
        white_top_from_south = white_end + half_view_depth * white["z"][1] / camera_height
        factory_eave_from_south = factory_end + (half_view_depth + factory_end - white_end) * factory_eave_height / camera_height
        self.assertLess(white_top_from_south, factory_eave_from_south,
                        "desde la avenida, quedan separados el techo plano y el alero rojo")

    def test_the_inner_slope_of_the_matadero_nave_is_continuous(self):
        mod = load_tool("gen_matadero_body")
        tiers = self.props["bodies"]["matadero_muro"]["tiers"]
        ridge_v = round(mod.RIDGE_V - mod.OMV, 2)
        slopes = [tier["facet"] for tier in tiers if tier.get("facet") and tier.get("ink") == "mtRoof"
                  and min(v for _, v, _ in tier["facet"]) >= ridge_v]
        self.assertEqual(len(slopes), 1, "un faldón entero entre la cumbrera y el cobertizo")
        self.assertEqual(len(slopes[0]), 4, "el faldón va de un extremo de la nave al otro")
        eave_depths = [v for _, v, z in slopes[0] if z == mod.EAVE_Z]
        rear_v = round(mod.REAR_EAVE - mod.OMV, 2)
        self.assertEqual(eave_depths, [rear_v, rear_v], "el alero va paralelo a la cumbrera")

    def test_the_body_verbs_have_their_knobs(self):
        centro = self.mat["centro"]
        rolls = [T for T in self.props["bodies"]["acon"]["tiers"] if T.get("roll")]
        self.assertTrue(rolls, "la bahía de la ACON abre de día y cierra de noche: su cortina y sus rejas son `roll`")
        self.assertIn("roll", centro, "una cortina que se enrolla necesita `centro.roll`")
        a, b = centro["roll"]["band"]
        self.assertTrue(0 <= a < b <= 1)
        for T in self.props["bodies"]["acon"]["tiers"]:
            if T.get("capText"):
                self.assertIn("capText", centro, "un nombre en el techo necesita `centro.capText`")
                self.assertTrue(T["capText"]["lines"])
                self.assertIn(T["capText"]["ink"], centro["inks"])
        src = open(os.path.join(ROOT, "src", "render", "c2d", "bodies.js"), encoding="utf-8").read()
        for verb in ("function rolledDown", "function paintCapText"):
            self.assertIn(verb, src)

    def test_no_badge_the_name_is_on_the_roof(self):
        # el autor: «quitá la píldora y poné el nombre sobre el techo, como el del DJ»
        own = self.props["parcels"]["byId"]["hist_acon"]
        self.assertNotIn("pill", own)
        self.assertTrue(any(T.get("capText") for T in self.props["bodies"]["acon"]["tiers"]))


if __name__ == "__main__":
    unittest.main()
