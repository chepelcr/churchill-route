"""LOS EDIFICIOS HISTÓRICOS QUE OSM NO TIENE (`content/world/historic.json`).

Cada lugar es un lote en la esquina de dos calles con nombre que `tools/emit_historic.py` lleva al mundo
sin reconstruir, y un cuerpo de receta que escribe su generador desde su calco. Lo que se fija aquí:

* el registro dice lo que el emit necesita, y lo manejable cae ADENTRO del lote;
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
        # `tools/gen_acon_body.py` arma la receta al importarse y sólo escribe bajo `__main__`
        spec = importlib.util.spec_from_file_location("gen_acon_body", os.path.join(ROOT, "tools", "gen_acon_body.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual(json.loads(json.dumps(mod.body)), self.props["bodies"]["acon"],
                         "bodies.acon no es lo que escribe tools/gen_acon_body.py: corré el generador (no se edita a mano)")

    def test_the_bay_is_narrower_than_the_block_and_sits_in_front_of_it(self):
        # lo que el autor señaló mirando las fotos: el balcón (sobre la bahía) es MÁS ANGOSTO que el bloque
        spec = importlib.util.spec_from_file_location("gen_acon_body", os.path.join(ROOT, "tools", "gen_acon_body.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertLess(mod.BAY_U1 - mod.BAY_U0, (mod.MAIN_U1 - mod.GAP) / 2)
        self.assertGreater(mod.BAY_U0, mod.GAP)
        self.assertLess(mod.BAY_U1, mod.MAIN_U1)
        self.assertLess(mod.BAY_V0, mod.MAIN_V0 - 3, "la bahía sale varios metros adelante de la cara del bloque")
        self.assertGreater(mod.GAP, 0, "el autor pidió concreto entre la acera de Calle 4 y la bomba")

    def test_the_body_verbs_have_their_knobs(self):
        centro = self.mat["centro"]
        for T in self.props["bodies"]["acon"]["tiers"]:
            for op in T.get("openings", []):
                if op.get("roll"):
                    self.assertIn("roll", centro, "una cortina que se enrolla necesita `centro.roll`")
                    a, b = centro["roll"]["band"]
                    self.assertTrue(0 <= a < b <= 1)
            if T.get("capText"):
                self.assertIn("capText", centro, "un nombre en el techo necesita `centro.capText`")
                self.assertTrue(T["capText"]["lines"])
                self.assertIn(T["capText"]["ink"], centro["inks"])
        src = open(os.path.join(ROOT, "src", "render", "c2d", "bodies.js"), encoding="utf-8").read()
        for verb in ("function paintRoll", "function paintCapText"):
            self.assertIn(verb, src)

    def test_no_badge_the_name_is_on_the_roof(self):
        # el autor: «quitá la píldora y poné el nombre sobre el techo, como el del DJ»
        own = self.props["parcels"]["byId"]["hist_acon"]
        self.assertNotIn("pill", own)
        self.assertTrue(any(T.get("capText") for T in self.props["bodies"]["acon"]["tiers"]))


if __name__ == "__main__":
    unittest.main()
