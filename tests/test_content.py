"""EL CONTENIDO DEL MUNDO — `content/world/*.json` and the loader in content.py.

The highest-risk row in `docs/inventory.md` §12, closed 2026-08-14: 38
landmarks, 24 customers, 8 stages, 12 districts, 16 attractions, the probes and
the palettes were all Python literals, which meant the only person who could add
a customer was somebody willing to edit the builder.

**The gate that actually proves it is a full rebuild** — 33 minutes, all 1001
emitted files byte-identical, which is what was run. This file is what stops it
regressing without paying that again: it compares every table against the
literals as they stood in git, VALUE AND TYPE, and checks the invariants the
build would otherwise discover half an hour in.

`_tuples` is the interesting part of the loader. A coordinate is a tuple in this
builder and JSON has none, so the loader restores them — and `calles` is the one
that makes the rule non-obvious: it is a PAIR OF LISTS (the candidate names for
each of a block's two bounding calles), so "a list whose first item is a list
stays a list" gets it wrong. Arity is what makes a tuple here, not content.
"""
import json
import math
import os
import re
import subprocess
import types
import unittest

from churchill.world import config
from churchill.world import content

ROOT = config.ROOT
CONTENT_DIR = os.path.join(ROOT, "content", "world")

TABLES = ["PROBE_LAND", "PROBE_SEA", "DISTRICT_DEFS", "DISTRICT_BOUNDS_GEO",
          "INLAND_DISTRICT_DEFS", "LANDMARK_DEFS", "MARINE_SITE_OSM_ID",
          "MARINE_BUILDING_NAMES", "CUSTOMER_DEFS", "STAGES", "CROSSING_STAGES",
          "LANCHA_DEFS", "MALECON_EAST_LL", "FERIA_DEF", "ATTRACTION_DEFS",
          "BEACH_ACCESS_DEFS", "BLDG_PALETTE", "ROOF_PALETTE", "SITE_DECOR"]


#: FIELDS RE-AUTHORED SINCE THE MIGRATION, with the reason. A migration check
#: proves the loader still reproduces the literals; it cannot also demand the
#: world stop changing. So a deliberate edit to an original field is written
#: down HERE rather than silently tolerated — an entry is a decision, an
#: unexpected divergence is still a failure.
REAUTHORED = {
    # LOS DESPLAZAMIENTOS AUTORADOS PASARON A METROS (2026-08-27). Eran píxeles
    # afinados a 2.5 px/m — el faro corrido `dy: 138`, el balneario `dx: 138`,
    # el Muelle de Cruceros `dx: 850` — y el reescalado a 3.125 los habría
    # dejado un 20 % cortos EN METROS sin que nada fallara: el faro se habría
    # movido 44 m donde el autor pidió 55. Hoy se escriben `dyM: 55.2` y el
    # cargador los convierte, así que el número que se lee aquí es el mismo
    # desplazamiento a la escala de hoy. A 2.5 px/m los 52 valores convertidos
    # reproducen su píxel original exacto, que es lo que hace la migración
    # demostrable sin reconstruir el mundo.
    "LANDMARK_DEFS[*].dx":
        "el desplazamiento autorado se escribe en METROS (`dxM`) y el cargador "
        "lo pasa a px de este build — ver METRE_KEYS en content.py",
    "LANDMARK_DEFS[*].dy":
        "idem `dxM`: metros, no píxeles de una escala que ya se movió tres veces",
    "ATTRACTION_DEFS[*].at[0]": "idem — el offset de un juego, en metros",
    "ATTRACTION_DEFS[*].at[1]": "idem — el offset de un juego, en metros",
    "ATTRACTION_DEFS[*].at":
        "el sitio de un juego dentro del campo ferial es un offset EN METROS "
        "(`atM`) desde su centro. El DJ es la excepción y conserva una lat/lon: "
        "se sienta en la frontera del edificio real que toca, no en una posición "
        "dentro del campo.",
    "FERIA_DEF.w": "el suelo del campo ferial en METROS (`wM`)",
    "FERIA_DEF.h": "idem (`hM`)",
    "BEACH_ACCESS_DEFS[*].w": "el ancho de una bajada en METROS (`wM`)",
    "LANCHA_DEFS[*].speed":
        "la velocidad de la lancha en m/s (`speedMS`); era px/s, que sólo "
        "significaba lo mismo a la escala en que se afinó",
    "LANCHA_DEFS[*].deck":
        "LA CUBIERTA NO SE AUTORA AQUÍ. `src/assets/world-units.json` -> "
        "vessels.lancha la tiene en metros y `service/lancha.py` la deriva; "
        "esta copia en píxeles (86x34) coincidía con el registro SÓLO a 2.5 "
        "px/m, así que el reescalado del 2026-08-27 la dejó un 20 % chica y "
        "`tests/test_world_units.py` lo cazó. Es la quinta copia de un contrato "
        "que esa prueba ya había perseguido cuatro veces.",
    "LANCHA_DEFS[*].dockS":
        "idem `deck`: la ampara `world-units.json` -> vessels.lancha.dockOffsetM",
    # LOS TRES KIOSCOS RE-ANCLADOS sobre restaurantes REALES del mapa. Antes
    # eran una coordenada a ojo; ahora cada uno se para sobre un negocio que
    # OSM trae, que es lo que hace que el punto de recogida sea un lugar y no
    # un punto.
    "LANDMARK_DEFS[kios_centro].ll[0]": "kios_centro -> El Cevichito, el ceviche de Puntarenas",
    "LANDMARK_DEFS[kios_centro].ll[1]": "kios_centro -> El Cevichito",
    "LANDMARK_DEFS[kios_cocal].ll[0]": "kios_cocal -> Pata Larga, El Cocal",
    "LANDMARK_DEFS[kios_cocal].ll[1]": "kios_cocal -> Pata Larga",
    "LANDMARK_DEFS[kios_caldera].ll[0]": "kios_caldera -> Marisquería Tabaris, Caldera",
    "LANDMARK_DEFS[kios_caldera].ll[1]": "kios_caldera -> Marisquería Tabaris",
    "LANDMARK_DEFS[kios_roble].ll[0]": "kios_roble -> Soda El Taxista, El Roble",
    "LANDMARK_DEFS[kios_roble].ll[1]": "kios_roble -> Soda El Taxista",
    "LANDMARK_DEFS[kios_barr].ll[0]": "kios_barr -> Marisquería Los Pajaritos, Barranca",
    "LANDMARK_DEFS[kios_barr].ll[1]": "kios_barr -> Marisquería Los Pajaritos",
    "LANDMARK_DEFS[kios_esp].ll[0]": "kios_esp -> Soda Torrejas, Esparza",
    "LANDMARK_DEFS[kios_esp].ll[1]": "kios_esp -> Soda Torrejas",
    # EL TURNO SE REHIZO ENTERO, y son dos decisiones, no veintiocho. Escribir
    # una fila por juego repetiría la misma razón catorce veces y enterraría lo
    # que de verdad pasó, así que la clave admite comodín — el patrón dice
    # exactamente qué campo de qué tabla se re-autoró y sigue fallando si se
    # mueve cualquier otro.
    "ATTRACTION_DEFS[*].r":
        "los juegos se dibujaban a escala de manzana: la rueda medía 34 px de "
        "radio sobre una calzada de 28. Achicados contra medidas de feria de "
        "verdad, que es también lo que los deja estorbar sin tapar la calle.",
    "ATTRACTION_DEFS[*].at[1]":
        "el reparto se rehizo para caber en la calzada que el turno CIERRA. "
        "Medido sobre el mundo emitido, los tres chinamos caían en el centro "
        "de la calzada NORTE —la que queda abierta— y la tapaban de punta a "
        "punta: por el campo ferial no se podía pasar por ningún lado.",
    # EL NOMBRE NO PUEDE MENTIR SOBRE EL PRODUCTO. Tres puestos se llamaban
    # «Churchill …» y vendían vigorón o papi-carne — el detalle que rompe la
    # conexión con el lugar justo cuando se está intentando construirla. Donde
    # hay un negocio REAL debajo, el puesto toma su nombre: es más fiel y no
    # puede volver a contradecirse.
    "LANDMARK_DEFS[kios_paseo2].name": "vendía vigorón anunciándose como churchill",
    "LANDMARK_DEFS[kios_roble].name": "-> Soda El Taxista, el negocio real del ancla",
    "LANDMARK_DEFS[kios_esp].name": "-> Soda Torrejas, el negocio real del ancla",
    "LANDMARK_DEFS[kios_centro].name": "-> El Cevichito, real y además el puesto de ceviche",
    "LANDMARK_DEFS[kios_cocal].name": "-> Pata Larga, el negocio real del ancla",
    "CROSSING_STAGES[s8].after":
        "la Travesía pasó de seguir a s3 a seguir a s7: iba cuarta y dejaba "
        "Las Playitas, El Cocal, Mata de Limón y Caldera detrás de la única "
        "etapa que falta afinar.",
}


def _reauthored(path):
    """¿Está este campo escrito en `REAUTHORED`, exacto o por patrón?

    El comodín existe para el caso en que UNA decisión toca el mismo campo de
    toda una tabla; no afloja la compuerta, porque el patrón nombra el campo.
    """
    if path in REAUTHORED:
        return True
    for key in REAUTHORED:
        # A mano y no con `fnmatch`: estas claves llevan `[id]`, y para fnmatch
        # los corchetes son una CLASE DE CARACTERES — `ATTRACTION_DEFS[*].r`
        # le pedía un asterisco literal y no casaba con nada.
        if "*" not in key:
            continue
        head, _, tail = key.partition("*")
        if path.startswith(head) and path.endswith(tail) \
                and len(path) >= len(head) + len(tail):
            return True
    return False


def deep_diff(a, b, path=""):
    if type(a) is not type(b):
        return [f"{path}: TYPE {type(a).__name__} vs {type(b).__name__}"]
    if isinstance(a, dict):
        # A RECORD MAY HAVE GAINED A FIELD, and that is authored content, not a
        # broken loader — `openAlways` on the crossing, a `_why` note beside a
        # value. What may NOT happen is a field going missing: that is the
        # loader failing to reproduce what the literal held.
        # …Y UNA LLAVE PUEDE DESAPARECER A PROPÓSITO, que es lo que pasa cuando
        # deja de autorarse aquí porque otro registro ya la tenía. `deck` y
        # `dockS` de la lancha eran la QUINTA copia de un contrato que vive en
        # `world-units.json`; borrarlas es el arreglo, no la regresión. Se
        # pregunta a REAUTHORED con el mismo camino que un campo cambiado, así
        # que una desaparición sigue teniendo que estar escrita y razonada.
        gone = sorted(k for k in set(a) - set(b) if not _reauthored(f"{path}.{k}"))
        if gone:
            return [f"{path}: keys VANISHED — {gone}"]
        # …y una llave excusada arriba tampoco se compara: ya no está en `b`.
        return [d for k in a if k in b
                for d in deep_diff(a[k], b[k], f"{path}.{k}")]
    if isinstance(a, (list, tuple)):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} vs {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b))
                for d in deep_diff(x, y, f"{path}[{i}]")]
    if a == b:
        return []
    return [] if _reauthored(path) else [f"{path}: {a!r} vs {b!r}"]


class MigrationTests(unittest.TestCase):
    """The loaded tables ARE the literals — until the literals leave history."""

    @classmethod
    def setUpClass(cls):
        # The commit that still held them. Once this scrolls out of reach the
        # test becomes a no-op rather than a failure, which is the honest
        # behaviour: it is a migration check, not a permanent contract.
        # The MOST RECENT commit that still held them — not `git log -S`,
        # which returns the commits where the string's count CHANGED and so
        # hands back the one that introduced it years of tables ago.
        out = subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "-n", "40",
                              "--", "churchill/world/content.py"],
                             capture_output=True, text=True)
        cls.ref = None
        for sha in out.stdout.split():
            src = subprocess.run(["git", "-C", ROOT, "show",
                                  f"{sha}:churchill/world/content.py"],
                                 capture_output=True, text=True).stdout
            if all(t in src for t in ("LANDMARK_DEFS = [", "MARINE_SITE_OSM_ID",
                                      "ATTRACTION_DEFS = [")):
                cls.ref = src
                break

    def test_every_table_matches_the_literals_it_replaced(self):
        if not self.ref:
            self.skipTest("the literal version is no longer in reach of git log -S")
        grown = []
        old = types.ModuleType("old_content")
        src = self.ref.replace("from .config import ROOT",
                               "from churchill.world.config import ROOT")
        exec(compile(src, "old_content.py", "exec"), old.__dict__)
        diffs = []
        for name in TABLES:
            was, now = getattr(old, name), getattr(content, name)
            # A LIST OF AUTHORED RECORDS MAY HAVE GROWN, AND THAT IS NOT A
            # REGRESSION. What this test exists to prove is that the JSON loader
            # still reproduces the literals it replaced — not that the world
            # stopped gaining places. Comparing length would make every new
            # landmark, customer or ride fail a MIGRATION check, which teaches
            # exactly the wrong lesson: bump the number and move on.
            #
            # The match is BY ID, never by position: a new place is authored
            # next to its neighbours (Las Brisas belongs beside the Tioga, the
            # Capitanía beside its muelle), so an index-based compare would
            # report every record after the insertion as changed and hide a real
            # regression in the noise.
            if (isinstance(was, list) and isinstance(now, list)
                    and all(isinstance(r, dict) and "id" in r for r in was + now)):
                by_id = {r["id"]: r for r in now}
                # Las claves de `REAUTHORED` se escriben por ID y no por índice:
                # un lugar nuevo se autora junto a sus vecinos, así que un índice
                # señala a otro registro en cuanto alguien inserta uno.
                name = f"{name}[{{id}}]"
                missing = [r["id"] for r in was if r["id"] not in by_id]
                if missing:
                    diffs.append(f"{name}: records vanished — {missing}")
                    continue
                grown.append(f"{name} +{len(now) - len(was)}")
                diffs += [d for r in was
                          for d in deep_diff(r, by_id[r["id"]], name.format(id=r["id"]))]
                continue
            diffs += deep_diff(was, now, name)
        self.assertEqual(diffs, [], f"the loader no longer reproduces the "
                                    f"original tables: {diffs[:5]}")


class StageChainTests(unittest.TestCase):
    """WHAT A PLAYER CAN REACH. `StageSelect` chains strictly — a stage opens
    when the one before it is cleared — so WHERE a stage sits in the list is a
    gate on everything after it."""

    def setUp(self):
        from churchill.world.pipeline.finish import ordered_stages
        self.stages = ordered_stages()

    def test_num_is_the_position_and_never_authored(self):
        for i, s in enumerate(self.stages):
            self.assertEqual(s["num"], i + 1, f"{s['id']} labels position {i + 1}")

    def test_the_travesia_does_not_stand_between_two_delivery_stages(self):
        """It is the level that still needs tuning, and it used to sit FOURTH:
        Las Playitas, El Cocal, Mata de Limón and Caldera were all behind it.
        A stage that is not a delivery run may not gate one unless it says
        `openAlways`."""
        for i, s in enumerate(self.stages):
            if s.get("kind") != "crossing" or s.get("openAlways"):
                continue
            after = self.stages[i + 1:]
            self.assertFalse(
                [x for x in after if x.get("kind", "delivery") == "delivery"],
                f"{s['id']} is a crossing that gates "
                f"{[x['id'] for x in after]} and is not openAlways")

    def test_the_delivery_stages_chain_among_themselves(self):
        """Walking only the stages that GATE must reach every delivery stage —
        i.e. removing the open ones leaves an unbroken run."""
        chain = [s for s in self.stages if not s.get("openAlways")]
        self.assertEqual([s["id"] for s in chain],
                         [s["id"] for s in self.stages
                          if s.get("kind", "delivery") == "delivery"],
                         "the gating chain is not exactly the delivery stages")


class KioskTests(unittest.TestCase):
    """LOS PUNTOS DE RECOGIDA Y LO QUE VENDEN. Salieron de `landmarks.json`
    porque un kiosco no es «un hito de tipo kiosk»: es el arranque de una
    entrega y tiene producto."""

    def setUp(self):
        with open(os.path.join(CONTENT_DIR, "kiosks.json"), encoding="utf-8") as fh:
            self.kiosks = json.load(fh)["kiosks"]
        with open(os.path.join(CONTENT_DIR, "products.json"), encoding="utf-8") as fh:
            self.products = json.load(fh)["products"]

    def test_every_kiosk_sells_something_the_registry_knows(self):
        """Un producto que nadie define es un kiosco que no entrega nada — y
        nada lo diría: el reparto seguiría corriendo con el reloj por defecto."""
        for k in self.kiosks:
            self.assertIn(k.get("product"), self.products,
                          f"{k['id']} vende {k.get('product')!r}, que no está en products.json")

    def test_every_product_is_sold_somewhere(self):
        """Arte y datos sin quién los seleccione es deriva, en la dirección que
        nadie nota — la misma lección que `SignKind`."""
        sold = {k["product"] for k in self.kiosks}
        for pid in self.products:
            self.assertIn(pid, sold, f"{pid} no lo vende ningún kiosco")

    def test_a_product_names_a_spoil_model_the_game_implements(self):
        """`spoil` SELECCIONA un modelo que la física implementa; no lo inventa.
        Es el mismo contrato que `effects.json` le pone a un vehículo.

        LA LISTA SE LEE DEL JUEGO. Estuvo escrita a mano aquí durante toda la
        vida del registro, y mientras tanto NINGUNO de los cuatro modelos
        existía: los cinco productos corrían el reloj del churchill y esta
        prueba pasaba igual, porque comparaba el dato contra una copia del dato.
        Un contrato que no toca el código no es un contrato."""
        implemented = self._implemented_spoil_models()
        self.assertEqual(len(implemented), 4,
                         f"delivery.js implementa {sorted(implemented)} — "
                         "¿cambió la forma del objeto SPOIL?")
        for pid, p in self.products.items():
            self.assertIn(p.get("spoil"), implemented,
                          f"{pid} pide un modelo de deterioro que nadie implementa")
            self.assertGreater(p.get("budgetMul", 0), 0, f"{pid} sin presupuesto")

    @staticmethod
    def _implemented_spoil_models():
        """Las claves del objeto `SPOIL` en `src/game/delivery.js`."""
        with open(os.path.join(ROOT, "src", "game", "delivery.js"),
                  encoding="utf-8") as fh:
            js = fh.read()
        body = js.split("const SPOIL = {", 1)
        assert len(body) == 2, "no hay un `const SPOIL = {` en delivery.js"
        body = body[1].split("\n};", 1)[0]
        return set(re.findall(r"^\s*(\w+):", body, re.M))

    def test_every_spoil_model_can_speak(self):
        """Un modelo sin copia sale como su propia clave en pantalla: `t()` cae
        al nombre de la clave, así que el jugador lee `quip.sog.2` donde iba una
        frase — y sólo lo ve quien entrega ESE producto, que es lo que hace que
        no se note."""
        cats = {}
        for lang in ("es", "en"):
            with open(os.path.join(ROOT, "src", "i18n", f"{lang}.json"),
                      encoding="utf-8") as fh:
                cats[lang] = json.load(fh)
        for model in self._implemented_spoil_models():
            keys = ([f"hud.keep.{model}", f"float.spoiled.{model}",
                     f"tip.spoiled.{model}"]
                    + [f"quip.{model}.{i}" for i in range(4)])
            for lang, cat in cats.items():
                for key in keys:
                    self.assertIn(key, cat,
                                  f"el modelo '{model}' no tiene {key} en {lang}.json")

    def test_a_customer_line_only_claims_a_product_that_exists(self):
        """`product` en una frase dice DE QUÉ HABLA. Apuntando a un id que no
        existe la frase no se usaría nunca y nadie lo diría."""
        with open(os.path.join(CONTENT_DIR, "customers.json"), encoding="utf-8") as fh:
            customers = json.load(fh)["customers"]
        for c in customers:
            if "product" in c:
                self.assertIn(c["product"], self.products,
                              f"{c['id']} habla de {c['product']!r}, que no existe")

    def test_a_line_tag_actually_reaches_the_game(self):
        """UNA ETIQUETA QUE NADIE PUEDE LEER ES UNA ETIQUETA QUE NO EXISTE.

        `product` en una frase se autora en `customers.json`, y **el mundo
        emitido no lo lleva**: el builder emite id/nombre/posición/distrito/
        línea, y un campo que no está en ese modelo se cae sin decir nada. Con
        eso, `customerLine` tomaba siempre la rama «esta frase sirve para
        cualquiera» y los repuestos por producto no se usaban NUNCA — se vio
        porque el propio smoke del HUD imprimió «¡La mía sin tanto rojo!», que
        es el sirope de cola de un churchill, sobre un vigorón en hoja.

        Así que el cliente lee la tabla autorada. Esta prueba fija ese camino:
        es la única forma de que el arreglo no se deshaga en silencio la próxima
        vez que alguien mueva el import."""
        with open(os.path.join(ROOT, "src", "game", "delivery.js"),
                  encoding="utf-8") as fh:
            js = fh.read()
        self.assertIn("content/world/customers.json", js,
                      "el cliente no lee las etiquetas autoradas: los repuestos "
                      "por producto quedan muertos otra vez")
        self.assertIn("LINE_PRODUCT", js)
        # …y se comprueba la premisa, para que la prueba no proteja un rodeo que
        # ya no hace falta: si algún día el emit SÍ lleva `product`, esto falla
        # y alguien decide a conciencia dónde vive la respuesta.
        man = os.path.join(ROOT, "src", "world2d", "manifest.json")
        if os.path.exists(man):
            with open(man, encoding="utf-8") as fh:
                emitted = json.load(fh)["customers"]
            self.assertFalse(
                any(c.get("product") for c in emitted),
                "el mundo emitido ya lleva `product` en los clientes: el rodeo "
                "del cliente sobra, decidí dónde vive la respuesta")

    def test_a_product_that_replaces_a_line_has_lines_to_replace_it_with(self):
        """Si un cliente sólo sabe hablar de churchill y le entregan otra cosa,
        habla el producto. Sin `lines` se cae a la frase propia — que es
        exactamente la que nombra el churchill, y entonces el arreglo no
        arregla nada."""
        with open(os.path.join(CONTENT_DIR, "customers.json"), encoding="utf-8") as fh:
            customers = json.load(fh)["customers"]
        claimed = {c["product"] for c in customers if c.get("product")}
        for pid, p in self.products.items():
            if pid in claimed:
                continue          # los clientes YA son la voz de este producto
            self.assertTrue(p.get("lines"),
                            f"{pid} no tiene `lines`: un cliente con frase de "
                            "otra comida se la diría igual")

    def test_kiosk_ids_are_unique_and_no_kiosk_is_left_in_landmarks(self):
        ids = [k["id"] for k in self.kiosks]
        self.assertEqual(len(ids), len(set(ids)), "dos kioscos con el mismo id")
        with open(os.path.join(CONTENT_DIR, "landmarks.json"), encoding="utf-8") as fh:
            lms = json.load(fh)["landmarks"]
        self.assertEqual([l["id"] for l in lms if l.get("type") == "kiosk"], [],
                         "quedó un kiosco en landmarks.json — se autoran en kiosks.json")

    def test_no_two_kiosks_land_on_the_same_spot(self):
        """Contra el MUNDO EMITIDO, no contra el ancla autorada: el asiento mueve
        un kiosco a la calle más cercana, así que dos anclas a 75 px pueden
        acabar en la misma celda — y dos puntos de recogida encima uno del otro
        son uno disfrazado de dos. Un par CERCANO está bien: los dos del Paseo
        van a 148 px y venden cosas distintas, que es lo que los hace dos."""
        man = os.path.join(ROOT, "src", "world2d", "manifest.json")
        if not os.path.exists(man):
            self.skipTest("el mundo no está construido")
        with open(man, encoding="utf-8") as fh:
            ks = [l for l in json.load(fh)["landmarks"] if l["type"] == "kiosk"]
        for i, a in enumerate(ks):
            for b in ks[i + 1:]:
                d = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
                self.assertGreater(
                    d, 40, f"{a['id']} y {b['id']} caen a {round(d)} px: "
                           f"son el mismo punto de recogida")

    def test_every_kiosk_has_an_anchor(self):
        for k in self.kiosks:
            self.assertTrue(k.get("osm") or k.get("ll"),
                            f"{k['id']} no tiene ni `osm` ni `ll`: no se puede colocar")


class ShapeTests(unittest.TestCase):
    """Invariants the build would otherwise find half an hour in."""

    def test_every_coordinate_is_a_tuple_of_two(self):
        for lm in content.LANDMARK_DEFS:
            if "ll" in lm:
                self.assertIsInstance(lm["ll"], tuple, f"{lm['id']}: ll is not a tuple")
                self.assertEqual(len(lm["ll"]), 2)
        for c in content.CUSTOMER_DEFS:
            self.assertIsInstance(c["ll"], tuple, f"{c['id']}: ll is not a tuple")

    def test_calles_is_a_pair_of_lists(self):
        """The rule that makes the loader non-obvious. If this becomes a tuple
        of tuples or a flat list, `_street_vals` reads the wrong thing."""
        found = 0
        for lm in content.LANDMARK_DEFS:
            calles = (lm.get("block") or {}).get("calles")
            if calles is None:
                continue
            found += 1
            self.assertIsInstance(calles, tuple, "the PAIR must be a tuple")
            self.assertEqual(len(calles), 2)
            for side in calles:
                self.assertIsInstance(side, list,
                                      "each side is a LIST of candidate names — "
                                      "odd calles are often unnamed, so there is "
                                      "more than one thing to try")
        self.assertGreater(found, 0, "no hand-laid block left to check")

    def test_every_anchor_is_geo(self):
        """`EVERY ANCHOR IS GEO` — CLAUDE.md's rule, and it was learned the hard
        way: the 2.0 -> 2.5 rescale moved the real manzanas 4 000 px away from
        the last two hand-laid px anchors and the entire civic centre stopped
        existing, with two WARN lines to say so."""
        for lm in content.LANDMARK_DEFS:
            ll = lm.get("ll")
            if not ll:
                continue
            lat, lon = ll
            self.assertTrue(9.0 < lat < 11.0, f"{lm['id']}: {lat} is not a Costa Rican latitude")
            self.assertTrue(-85.5 < lon < -84.0, f"{lm['id']}: {lon} is not a longitude here")

    def test_stage_references_resolve(self):
        kiosks = {lm["id"] for lm in content.LANDMARK_DEFS}
        customers = {c["id"] for c in content.CUSTOMER_DEFS}
        districts = ({d["id"] for d in content.DISTRICT_DEFS}
                     | {d["id"] for d in content.INLAND_DISTRICT_DEFS})
        for s in content.STAGES:
            for k in s.get("kiosks", []):
                self.assertIn(k, kiosks, f"stage {s['id']} picks up at a kiosk that does not exist")
            for c in s.get("customers", []):
                self.assertIn(c, customers, f"stage {s['id']} delivers to nobody")
            self.assertIn(s["district"], districts, f"stage {s['id']} is in no district")
            if s.get("unlock"):
                self.assertIn(s["unlock"], districts, f"stage {s['id']} unlocks nothing")

    def test_the_files_are_the_only_source(self):
        py = open(os.path.join(ROOT, "churchill", "world", "content.py"),
                  encoding="utf-8").read()
        for marker in ("LANDMARK_DEFS = [", "CUSTOMER_DEFS = [", "STAGES = ["):
            self.assertNotIn(marker, py,
                             f"`{marker}` is a literal in content.py again — the "
                             f"table has to live in content/world/*.json or only "
                             f"somebody editing the builder can change it")

    def test_every_emitted_file_is_read(self):
        """NINGÚN ARCHIVO DE CONTENIDO HUÉRFANO. Lo que esto atrapa es un JSON
        autorado que nadie lee: se edita, no pasa nada, y nadie se entera.

        Se busca en TODO el paquete y no sólo en `content.py`. La mayoría entra
        por ahí, pero no todos pueden: `contours.json` pesa 3,2 MB y
        `service/elevation.py` lo carga PEREZOSAMENTE, porque `content.py` se
        importa en cada prueba y parsear tres megas para no usarlos es un peaje
        que se paga siempre. La compuerta sigue fallando con un huérfano — que es
        lo que vino a impedir— y deja de exigir un solo cargador."""
        on_disk = {f for f in os.listdir(CONTENT_DIR) if f.endswith(".json")}
        src = []
        for base, _dirs, files in os.walk(os.path.join(ROOT, "churchill")):
            for name in files:
                if name.endswith(".py"):
                    with open(os.path.join(base, name), encoding="utf-8") as fh:
                        src.append(fh.read())
        py = "\n".join(src)
        read_by = {f for f in on_disk if f in py}
        self.assertEqual(on_disk, read_by,
                         f"these content files are not loaded by anything: "
                         f"{on_disk - read_by}")

class AuthoredLengthsAreMetresTests(unittest.TestCase):
    """LO QUE UN REGISTRO AUTORA EN LARGO, LO AUTORA EN METROS.

    El reescalado a 3.125 px/m (2026-08-27) destapó que cinco registros llevaban
    desplazamientos y tamaños EN PÍXELES afinados a 2.5: los `dx`/`dy` de tres
    kioscos y tres hitos, el campo ferial (560x200 px), el `at`/`r` de cada juego
    de la feria, el ancho de cada bajada, los focos de la plaza de Playitas y la
    cubierta de la lancha. Ninguno hacía fallar nada — se quedaban un 20 % cortos
    en METROS, con el faro corrido 11 m de menos y el turno un quinto más chico.

    La cubierta de la lancha SÍ falló, porque `tests/test_world_units.py` compara
    la de cada barco contra `world-units.json`, y coincidía con el registro sólo
    a 2.5 px/m. Esa prueba destapó las otras cinco: es exactamente lo que quería
    decir su propio nombre, «la fila decía tres copias y la prueba encontró una
    cuarta».
    """

    def test_no_authored_length_is_left_in_pixels(self):
        """Las llaves en px ya no existen en los registros. `content.py` sigue
        aceptándolas —para que una migración a medias no reviente en silencio—
        así que esto es lo que dice que la migración está entera."""
        import glob
        from churchill.world.content import METRE_KEYS, CONTENT_DIR
        # `at` NO entra: la llave está sobrecargada — en un juego de la feria es
        # un offset (y hoy se autora `atM`), pero en el DJ y en cada bajada es
        # una LAT/LON. Lo que se comprueba de los juegos es que usen `atM`.
        px_keys = set(METRE_KEYS.values()) - {"at"}
        offenders = []

        def walk(node, path, where):
            if isinstance(node, dict):
                for k, v in node.items():
                    if k.startswith("_"):
                        continue
                    if k in px_keys:
                        offenders.append(f"{where}:{path}.{k} = {v}")
                    walk(v, f"{path}.{k}", where)
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, f"{path}[{i}]", where)

        for path in sorted(glob.glob(os.path.join(CONTENT_DIR, "*.json"))):
            with open(path, encoding="utf-8") as fh:
                walk(json.load(fh), "", os.path.basename(path))
        self.assertEqual(offenders, [], "authored in pixels; use the metre key")

    def test_every_ride_offset_is_metres(self):
        """La otra mitad de lo de arriba: `at` se excluye por estar sobrecargada,
        así que los juegos —los únicos cuyo `at` ES un offset— se comprueban por
        su nombre."""
        with open(os.path.join(CONTENT_DIR, "attractions.json"), encoding="utf-8") as fh:
            raw = json.load(fh)
        for ride in raw["attractions"]:
            if ride["id"] == "dj_urtech":
                continue                      # ancla geo, ver la prueba de abajo
            self.assertIn("atM", ride, f"{ride['id']} sigue con su offset en px")
            self.assertNotIn("at", ride, f"{ride['id']} tiene las dos llaves")

    def test_the_dj_keeps_a_GEO_anchor_and_not_an_offset(self):
        """LA EXCEPCIÓN, y casi se pierde en la migración. Los juegos llevan un
        offset EN METROS desde el centro del campo ferial; el DJ se sienta en la
        FRONTERA del edificio real que toca, así que su `at` es una lat/lon. La
        conversión automática lo tomó por un offset y lo dejó en (4, -34) — a
        cuatro metros del origen del mundo, en el golfo."""
        from churchill.world.content import ATTRACTION_DEFS
        dj = next(a for a in ATTRACTION_DEFS if a["id"] == "dj_urtech")
        lat, lon = dj["at"]
        self.assertTrue(9.8 < lat < 10.1, f"el DJ perdió su latitud: {lat}")
        self.assertTrue(-85.0 < lon < -84.6, f"el DJ perdió su longitud: {lon}")

    def test_the_lancha_takes_her_deck_from_the_vessel_registry(self):
        """No se autora aquí: `world-units.json` -> vessels.lancha la tiene en
        metros, y tenerla en los dos sitios es cómo se acaba con una lancha que
        encoge un 20 % cuando el mundo se reescala."""
        from churchill.world.content import LANCHA_DEFS
        for spec in LANCHA_DEFS:
            self.assertNotIn("deck", spec)
            self.assertNotIn("dockS", spec)

