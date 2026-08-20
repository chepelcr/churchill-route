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
        gone = set(a) - set(b)
        if gone:
            return [f"{path}: keys VANISHED — {sorted(gone)}"]
        return [d for k in a for d in deep_diff(a[k], b[k], f"{path}.{k}")]
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
        Es el mismo contrato que `effects.json` le pone a un vehículo."""
        implemented = {"melt", "cool", "sog", "sun"}
        for pid, p in self.products.items():
            self.assertIn(p.get("spoil"), implemented,
                          f"{pid} pide un modelo de deterioro que nadie implementa")
            self.assertGreater(p.get("budgetMul", 0), 0, f"{pid} sin presupuesto")

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
