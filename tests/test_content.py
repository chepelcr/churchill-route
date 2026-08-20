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
    "CROSSING_STAGES[0].after":
        "la Travesía pasó de seguir a s3 a seguir a s7: iba cuarta y dejaba "
        "Las Playitas, El Cocal, Mata de Limón y Caldera detrás de la única "
        "etapa que falta afinar.",
}


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
    return [] if path in REAUTHORED else [f"{path}: {a!r} vs {b!r}"]


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
                missing = [r["id"] for r in was if r["id"] not in by_id]
                if missing:
                    diffs.append(f"{name}: records vanished — {missing}")
                    continue
                grown.append(f"{name} +{len(now) - len(was)}")
                now = [by_id[r["id"]] for r in was]
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
        on_disk = {f for f in os.listdir(CONTENT_DIR) if f.endswith(".json")}
        read_by = set()
        py = open(os.path.join(ROOT, "churchill", "world", "content.py"),
                  encoding="utf-8").read()
        for f in on_disk:
            if f in py:
                read_by.add(f)
        self.assertEqual(on_disk, read_by,
                         f"these content files are not loaded by anything: "
                         f"{on_disk - read_by}")
