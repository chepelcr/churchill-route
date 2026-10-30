"""EL TREN AL PUERTO — las compuertas de sus cuatro registros.

El modo tren es cuatro archivos de datos y un motor que los compone:
`src/assets/railway-art.json` (lo que se ve), `src/assets/railway-sim.json` (lo
que la física hace), `src/content/railway/catalog.json` (las máquinas y sus
mejoras) y `src/content/railway/levels/*.json` (el corredor). Lo que puede
podrirse ahí es exactamente lo que ya se podría en el resto de la casa, y cada
caso de abajo es un fallo que ya ocurrió de verdad mientras se construía:

* **una parte que nombra una forma que nadie implementa** se SALTA en silencio:
  una locomotora pierde la chimenea y no hay ni un aviso;
* **una tinta `$nombre` sin entrada en la paleta** llega a Canvas como
  `undefined`, que no lanza: la pieza se pinta del color de la anterior;
* **un `fit` o un `repeat` con `x`/`y` propios** no es un error — el verbo los
  IGNORA, la fila arranca en el origen del registro y las ventanas de un coche
  se van marchando fuera de su carrocería. Pasó en cinco de los seis registros
  de material rodante y lo destapó la hoja de arte, no una prueba;
* **una mejora que afecta un campo que la máquina no tiene** es una barra que
  sube y no mueve nada, y se ve igual que una barra equilibrada;
* **un perfil retipeado a mano** deja de ser el corredor que dice ser, así que
  se vuelve a derivar del DEM y se compara.
"""
import json
import math
import os
import unittest

from churchill.world.config import ROOT
from tests.shapevocab import implemented_shapes

ART = os.path.join(ROOT, "src", "assets", "railway-art.json")
SIM = os.path.join(ROOT, "src", "assets", "railway-sim.json")
CATALOG = os.path.join(ROOT, "src", "content", "railway", "catalog.json")
LEVELS = os.path.join(ROOT, "src", "content", "railway", "levels")
I18N = os.path.join(ROOT, "src", "i18n")


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


ART_D = load(ART)
SIM_D = load(SIM)
CAT_D = load(CATALOG)
LEVEL_D = {name[:-5]: load(os.path.join(LEVELS, name))
           for name in sorted(os.listdir(LEVELS)) if name.endswith(".json")}


def walk(parts):
    """Cada parte del árbol, incluidos los hijos de los verbos generadores."""
    for part in parts or []:
        if not isinstance(part, dict):
            continue
        yield part
        yield from walk(part.get("parts"))


def records():
    for group in ("stock", "structures", "props"):
        for key, rec in ART_D[group].items():
            yield f"{group}.{key}", rec


def part_lists(rec):
    for key in ("parts", "front"):
        if key in rec:
            yield key, rec[key]


class ArtCatalogTests(unittest.TestCase):
    def test_every_part_names_a_shape_the_interpreter_implements(self):
        known = implemented_shapes()
        for name, rec in records():
            for key, parts in part_lists(rec):
                for part in walk(parts):
                    self.assertIn(part.get("shape"), known,
                                  f"{name}.{key}: forma desconocida {part.get('shape')!r}")

    def test_every_ink_resolves_against_its_own_palette(self):
        for name, rec in records():
            palette = rec.get("palette", {})
            for key, parts in part_lists(rec):
                for part in walk(parts):
                    for slot in ("fill", "stroke"):
                        spec = part.get(slot)
                        for value in (spec if isinstance(spec, list) else [spec]):
                            if not isinstance(value, str) or not value.startswith("$"):
                                continue
                            self.assertIn(value[1:], palette,
                                          f"{name}.{key}: {value} no está en la paleta")

    def test_fit_and_repeat_never_carry_their_own_origin(self):
        # `shapes.js` no traslada estos dos verbos: sus hijos viven en el marco
        # del padre. Un `x`/`y` acá se ignora SIN avisar.
        for name, rec in records():
            for key, parts in part_lists(rec):
                for part in walk(parts):
                    if part.get("shape") not in ("fit", "repeat"):
                        continue
                    for axis in ("x", "y"):
                        self.assertNotIn(axis, part,
                                         f"{name}.{key}: un {part['shape']} no tiene origen propio; "
                                         f"la coordenada va en sus hijos")

    def test_every_text_size_comes_from_the_records_font_table(self):
        # El intérprete lee `font.size` CRUDO, sin pasar por el marco: en un
        # registro que mide en metros un `0.62` literal sale de 0,62 px.
        for name, rec in records():
            fonts = rec.get("fonts", {})
            for key, parts in part_lists(rec):
                for part in walk(parts):
                    if part.get("shape") != "text":
                        continue
                    size = part.get("font", {}).get("size")
                    self.assertIsInstance(size, str,
                                          f"{name}.{key}: el tamaño de un texto se nombra con $")
                    self.assertIn(size[1:], fonts, f"{name}.{key}: {size} no está en `fonts`")

    def test_rolling_stock_declares_its_wheels_and_its_extent(self):
        for key, rec in ART_D["stock"].items():
            self.assertGreater(rec.get("lengthM", 0), 0, key)
            self.assertGreater(rec.get("heightM", 0), 0, key)
            self.assertTrue(rec.get("wheels"), f"{key}: las ruedas son datos, el giro es código")
            for key in ("wheel", "tyre", "hub", "rod"):
                self.assertIn(key, rec["palette"],
                              f"{key}: la rueda la dibuja el motor, pero su tinta es del registro")
            for wheel in rec["wheels"]:
                self.assertLessEqual(abs(wheel["x"]), rec["lengthM"] / 2 + 0.1,
                                     f"{key}: un eje fuera del coche")
                self.assertGreater(wheel["r"], 0)

    def test_every_body_declares_its_sticker_outline(self):
        # El contorno oscuro es lo que separa al convoy del paisaje. Sin la
        # llave el `$outline` llega a Canvas como `undefined` y la pieza se
        # pinta del color de la anterior: no falla, se ve mal.
        for key, rec in ART_D["stock"].items():
            self.assertIn("outline", rec["palette"], key)

    def test_every_era_but_the_default_declares_its_whole_bath(self):
        eras = ART_D["eras"]
        self.assertIn("moderno", eras)
        self.assertNotIn("wash", eras["moderno"],
                         "la época por defecto no baña el cuadro, y por eso no cuesta nada")
        for name, era in eras.items():
            if name.startswith("_") or not era.get("wash"):
                continue
            for key in ("grey", "desaturate", "washAlpha", "vignetteClear", "vignetteEdge"):
                self.assertIn(key, era, f"{name}: falta {key}")
            self.assertTrue(era["vignetteClear"].endswith("00"),
                            f"{name}: el centro de la viñeta tiene que ser transparente")

    def test_every_level_names_an_era_that_exists(self):
        for name, level in LEVEL_D.items():
            self.assertIn(level.get("era", "moderno"), ART_D["eras"], name)

    def test_scene_layers_stack_against_the_ground_line(self):
        # La cámara sigue al tren, así que el suelo cae siempre cerca de
        # `view.anchorY`: una capa con el horizonte por debajo no se ve NUNCA.
        anchor = SIM_D["view"]["anchorY"]
        for sid, scene in ART_D["scenes"].items():
            self.assertTrue(scene["layers"], sid)
            for layer in scene["layers"]:
                self.assertLess(layer["horizon"], anchor + 0.02,
                                f"{sid}.{layer['id']}: el horizonte queda bajo la tierra")
                self.assertGreater(layer["bandH"], 0.02, f"{sid}.{layer['id']}")
                self.assertLessEqual(layer["yParallax"], 0.08,
                                     f"{sid}.{layer['id']}: un parallax vertical grande saca la capa "
                                     f"del cuadro en un nivel que baja cuatro mil píxeles")

    def test_every_scene_tile_closes_on_itself(self):
        # Un mosaico cuyo primer y último punto no coinciden en `y` deja una
        # costura recta cada copia, que a plena luz se ve como un alambre.
        for sid, scene in ART_D["scenes"].items():
            for layer in scene["layers"]:
                pts = layer["pts"]
                self.assertEqual(pts[0][0], 0, f"{sid}.{layer['id']}")
                self.assertEqual(pts[-1][0], 1, f"{sid}.{layer['id']}")
                self.assertEqual(pts[0][1], pts[-1][1],
                                 f"{sid}.{layer['id']}: el mosaico no empalma consigo mismo")

    def test_every_scatter_names_a_prop_that_exists(self):
        for sid, scene in ART_D["scenes"].items():
            for spec in scene.get("scatter", []):
                self.assertIn(spec["art"], ART_D["props"], f"{sid}: {spec['art']}")
                self.assertGreater(spec["pitchM"], 0, sid)


class CatalogTests(unittest.TestCase):
    def test_every_ladder_moves_a_stat_every_train_has(self):
        for ladder in CAT_D["upgrades"]["ladders"]:
            self.assertEqual(len(ladder["costs"]), CAT_D["upgrades"]["maxLevel"],
                             f"{ladder['id']}: un coste por escalón")
            for train in CAT_D["trains"]:
                for field in ladder["affects"]:
                    self.assertIn(field, train["stats"],
                                  f"{ladder['id']} mueve {field}, que {train['id']} no tiene")

    def test_every_train_has_its_own_ceiling_and_no_ladder_is_dead(self):
        # CADA MÁQUINA SU TOPE: con uno común las seis convergían a la misma y
        # la última comprada era estrictamente mejor. Y si NINGUNA llegara al
        # tope de una barra, esa escalera tendría escalones que nadie puede
        # comprar — un coste en el registro que no compra nada.
        ids = [l["id"] for l in CAT_D["upgrades"]["ladders"]]
        maxlevel = CAT_D["upgrades"]["maxLevel"]
        reach = {i: 0 for i in ids}
        for train in CAT_D["trains"]:
            caps = train.get("caps")
            self.assertIsNotNone(caps, f"{train['id']}: sin `caps`")
            self.assertEqual(sorted(caps), sorted(ids), train["id"])
            for ladder, cap in caps.items():
                self.assertTrue(1 <= cap <= maxlevel, f"{train['id']}.{ladder} = {cap}")
                reach[ladder] = max(reach[ladder], cap)
        for ladder, top in reach.items():
            self.assertEqual(top, maxlevel,
                             f"ninguna máquina llega al tope de «{ladder}»: sus últimos escalones "
                             f"son un coste que nadie puede pagar")
        spread = {t["id"]: sorted(t["caps"].values()) for t in CAT_D["trains"]}
        self.assertGreater(len({tuple(v) for v in spread.values()}), 1,
                           "si todas las máquinas tienen el mismo reparto de topes, no hay elección")

    def test_the_line_covers_the_whole_corridor_in_order(self):
        line = CAT_D["line"]
        self.assertEqual([row["number"] for row in line], list(range(1, len(line) + 1)))
        for a, b in zip(line, line[1:]):
            self.assertAlmostEqual(a["toKm"], b["fromKm"], places=2,
                                   msg=f"hueco entre {a['id']} y {b['id']}")
            self.assertLess(a["fromKm"], a["toKm"], a["id"])
        for row in line:
            self.assertIn(row["scene"], ART_D["scenes"], row["id"])
            if row["level"] is not None:
                self.assertIn(row["level"], LEVEL_D, row["id"])
        playable = [row for row in line if row["level"]]
        self.assertEqual([row["level"] for row in playable], CAT_D["campaign"],
                         "la campaña y los tramos jugables de la línea son la misma lista")

    def test_every_train_resolves_its_art_and_its_consist(self):
        for train in CAT_D["trains"]:
            self.assertIn(train["art"], ART_D["stock"], train["id"])
            self.assertTrue(train["consist"], train["id"])
            for car in train["consist"]:
                self.assertIn(car["art"], ART_D["stock"], f"{train['id']}: {car['art']}")

    def test_exactly_one_train_is_free_and_it_is_the_first(self):
        # El garaje abre en `trains[0]`; si no fuera el gratuito, el jugador
        # entraría a una pantalla que sólo le ofrece comprar.
        free = [t["id"] for t in CAT_D["trains"] if t["price"] == 0]
        self.assertEqual(free, [CAT_D["trains"][0]["id"]])

    def test_the_campaign_names_levels_that_exist(self):
        for level_id in CAT_D["campaign"]:
            self.assertIn(level_id, LEVEL_D)


class SimTests(unittest.TestCase):
    def test_every_loop_size_a_level_uses_is_declared(self):
        for name, level in LEVEL_D.items():
            for loop in level.get("loops", []):
                self.assertIn(loop["size"], SIM_D["loops"]["sizes"], name)

    def test_a_loop_leaves_room_for_its_own_circle(self):
        for size, spec in SIM_D["loops"]["sizes"].items():
            self.assertAlmostEqual(spec["leadM"] * 2, spec["advanceM"], msg=size)
            self.assertGreaterEqual(spec["leadM"], spec["radiusM"],
                                    f"{size}: el círculo se monta sobre la vía de aproximación")

    def test_no_loop_asks_for_more_than_the_starter_tops_out_at(self):
        # LA ENTRADA DE UN RIZO ES ENERGÍA: v² = 4gR (subir el lazo) + grip·gR
        # (el sostén de pestaña en la cima). Si pide más de lo que la máquina
        # gratuita puede dar, el nivel 1 tiene un muro y no una meta — y eso no
        # se ve en ninguna captura.
        #
        # Esta es la compuerta BARATA: compara contra `topSpeed`, que es el
        # techo teórico. Si de verdad se llega a esa velocidad en la bajada que
        # entra al rizo lo mide `pnpm smoke:railway`, corriendo la partida.
        sim_loops = SIM_D["loops"]
        gravity = SIM_D["physics"]["g"] * sim_loops["gravityFactor"]
        starter = CAT_D["trains"][0]["stats"]
        for level in LEVEL_D.values():
            for loop in level.get("loops", []):
                r = sim_loops["sizes"][loop["size"]]["radiusM"]
                need = math.sqrt(4 * gravity * r + sim_loops["railGrip"] * gravity * r)
                self.assertLess(need, starter["topSpeed"],
                                f"rizo {loop['size']} (R={r} m) pide {need * 3.6:.0f} km/h y la "
                                f"máquina de salida tiene techo de {starter['topSpeed'] * 3.6:.0f}")

    def test_only_one_knob_in_the_whole_mode_converts_to_pixels(self):
        # Las medidas del modo son METROS y SEGUNDOS; `view.pxPerM` es el único
        # convertidor y tiene que seguir siéndolo, o afinar la cámara vuelve a
        # mover la física.
        def knobs(node, path=""):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key.startswith("_"):
                        continue
                    yield f"{path}.{key}".lstrip("."), value
                    yield from knobs(value, f"{path}.{key}")
        pixelish = sorted(name for name, _ in knobs(SIM_D)
                          if "px" in name.split(".")[-1].lower())
        self.assertEqual(pixelish, ["view.pxPerM"], f"perillas en píxeles: {pixelish}")


class LevelTests(unittest.TestCase):
    def test_the_profile_is_the_dem_and_not_a_retyped_copy(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "gen_railway_profile", os.path.join(ROOT, "tools", "gen_railway_profile.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        for name, level in LEVEL_D.items():
            ground, deck = gen.derive(level)
            self.assertEqual(level["profile"]["groundM"], ground,
                             f"{name}: corré tools/gen_railway_profile.py")
            self.assertEqual(level["profile"]["deckM"], deck, f"{name}")

    def test_every_milestone_sits_inside_the_corridor(self):
        for name, level in LEVEL_D.items():
            lo, hi = level["corridor"]["fromKm"], level["corridor"]["toKm"]
            for station in level["stations"]:
                self.assertTrue(lo <= station["km"] <= hi, f"{name}: {station['id']}")
            for km in level["fuelKm"]:
                self.assertTrue(lo < km < hi, f"{name}: bidón en km {km}")
            for loop in level["loops"]:
                self.assertTrue(lo < loop["km"] < hi, f"{name}: rizo en km {loop['km']}")
            for s in level["structures"]:
                self.assertTrue(lo <= s["fromKm"] < s["toKm"] <= hi, f"{name}: {s}")

    def test_a_level_starts_and_finishes_at_a_station(self):
        for name, level in LEVEL_D.items():
            roles = [s.get("role") for s in level["stations"]]
            self.assertEqual(roles.count("start"), 1, name)
            self.assertEqual(roles.count("finish"), 1, name)

    def test_every_scene_a_level_names_is_in_the_art_registry(self):
        for name, level in LEVEL_D.items():
            self.assertIn(level["scene"], ART_D["scenes"], name)
            for cut in level["scenes"]:
                self.assertIn(cut["id"], ART_D["scenes"], f"{name}: {cut['id']}")
            self.assertEqual(level["scenes"][0]["km"], level["corridor"]["fromKm"],
                             f"{name}: el primer corte de escena abre el tramo")

    def test_the_loops_are_declared_as_a_liberty(self):
        # La investigación dice por escrito que el rizo vertical no pertenece a
        # la vía histórica. Mientras exista, tiene que estar DICHO en el nivel y
        # separado de `structures`, que es lo documentado.
        for name, level in LEVEL_D.items():
            if not level.get("loops"):
                continue
            self.assertIn("_loops", level, f"{name}: un rizo sin su nota de licencia")
            self.assertNotIn("loop", json.dumps(level["structures"]).lower(), name)


class CopyTests(unittest.TestCase):
    def test_every_key_the_mode_names_exists_in_both_catalogs(self):
        catalogs = {lang: load(os.path.join(I18N, f"{lang}.json")) for lang in ("es", "en")}
        keys = set()
        for train in CAT_D["trains"]:
            keys |= {train["nameKey"], train["taglineKey"], train["fiche"]["yearKey"],
                     f"railway.fuel.{train['fuelKind']}"}
        for ladder in CAT_D["upgrades"]["ladders"]:
            keys |= {ladder["nameKey"], ladder["descKey"]}
        keys |= {row["nameKey"] for row in CAT_D["line"]}
        for level in LEVEL_D.values():
            keys |= {level["nameKey"], level["briefKey"]}
            keys |= {s["nameKey"] for s in level["stations"]}
            keys |= {s["riverKey"] for s in level["structures"] if s.get("riverKey")}
        keys |= {scene["nameKey"] for scene in ART_D["scenes"].values()}
        keys |= {era["nameKey"] for name, era in ART_D["eras"].items()
                 if not name.startswith("_")}
        for lang, catalog in catalogs.items():
            for key in sorted(keys):
                self.assertIn(key, catalog, f"{lang}: falta {key}")


if __name__ == "__main__":
    unittest.main()
