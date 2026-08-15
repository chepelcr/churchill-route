"""`inventory.json` — the machine index, and whether it can be trusted.

`docs/inventory.md` §16 asks for this: an asset family that is not listed here
is one nobody can audit, and the document's own conclusions are only worth
reading if the numbers under them come from the tree rather than from memory.

The reason it needed a test is that it was already wrong. `gen-inventory.mjs`
typed several vocabularies out BY HAND, and the NPC movements were listed as
`stationary, wander, route` while the registry has `rail, bounded-random,
route, stationary` — an inventory inventing its own copy of a vocabulary is
precisely the drift it exists to report.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

INVENTORY = os.path.join(ROOT, "inventory.json")
VOCAB = os.path.join(ROOT, "src", "assets", "vocabulary.generated.json")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class RegistryIndexTests(unittest.TestCase):
    def setUp(self):
        self.inv = read(INVENTORY)

    def test_every_listed_registry_exists(self):
        for r in self.inv["registries"]:
            self.assertTrue(os.path.exists(os.path.join(ROOT, r["path"])),
                            f"{r['id']} points at {r['path']}, which is not there")

    def test_every_registry_is_versioned(self):
        """A file the editor writes needs a version before its shape can change.
        `feriaAssets.json` shipped without one for months and was the last."""
        for r in self.inv["registries"]:
            self.assertIsNotNone(r["version"], f"{r['id']} has no version")

    def test_no_registry_is_missing_from_the_index(self):
        """The check that keeps this honest: a new registry that nobody adds
        here is invisible to every audit that reads this file."""
        listed = {r["path"] for r in self.inv["registries"]}
        found = set()
        for base in ("src/assets", "src/content", "src/ui"):
            d = os.path.join(ROOT, base)
            for name in os.listdir(d):
                if not name.endswith(".json"):
                    continue
                rel = f"{base}/{name}"
                doc = read(os.path.join(ROOT, rel))
                # a REGISTRY declares a version; a data dump does not
                if isinstance(doc, dict) and ("version" in doc or "schemaVersion" in doc):
                    found.add(rel)
        self.assertEqual(found - listed, set(),
                         f"these versioned registries are not in inventory.json: "
                         f"{sorted(found - listed)}")

    def test_every_test_module_is_actually_run(self):
        """A suite is only as good as the list that invokes it.

        `pnpm test` names its modules one by one rather than discovering them,
        which is deliberate — the list is a review surface. The cost is that a
        NEW test file runs green by never running at all, and that is not
        hypothetical: `tests/test_lights.py` shipped 20 passing cases and the
        total stayed at 227 until this check was written.
        """
        script = read_text(os.path.join(ROOT, "package.json"))
        listed = set(re.findall(r"tests\.(test_\w+)", script))
        found = {name[:-3] for name in os.listdir(os.path.join(ROOT, "tests"))
                 if name.startswith("test_") and name.endswith(".py")}
        self.assertEqual(found - listed, set(),
                         f"these test modules exist and `pnpm test` never runs them: "
                         f"{sorted(found - listed)}")

    def test_the_catalogs_come_from_the_vocabulary(self):
        """Not typed out again. Each of these was a hand-written list."""
        vocab = read(VOCAB)["enums"]
        cat = self.inv["catalogs"]
        for key, enum in [("coinTypes", "COIN_TYPE"), ("npcMovements", "NPC_MOVEMENT"),
                          ("weatherModes", "WEATHER"), ("fieldSports", "FIELD_SPORT"),
                          ("esteroEncounters", "ESTERO_ENCOUNTER"),
                          ("gameModes", "GAME_MODE"), ("uiScreens", "UI_SCREEN"),
                          ("trafficSigns", "SIGN_KIND")]:
            self.assertEqual(cat[key], vocab[enum],
                             f"catalogs.{key} disagrees with the generated {enum}")

    def test_the_screens_carry_their_slots(self):
        for sid, rec in self.inv["screens"].items():
            self.assertTrue(rec["slots"], f"screen {sid} lists no slots")

    def test_the_sounds_and_effects_are_indexed(self):
        self.assertIn("horn", self.inv["sounds"])
        self.assertIn("wake", self.inv["vehicleEffects"])
        self.assertEqual(set(self.inv["mixerBuses"]), {"sfx", "engine", "ambience", "music"})
