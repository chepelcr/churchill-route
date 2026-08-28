"""LAS PANTALLAS — `src/ui/screens.json`, `Slots.jsx` and the UIScreen vocabulary.

The last surface the editor could not reach. The copy has been fully authored
for a while and every colour goes through a token since the sweep; what a screen
SHOWS, and in what order, was still welded into the JSX.

The rule that keeps this from becoming a homegrown layout language — the trade
that was explicitly rejected — is one line: **the JSON selects and orders, the
engine implements**. A slot is a named React component. There are no positions
in the registry, no styles, no nesting and no expressions, and the tests below
are what stop each of those creeping in.

The failure this exists to prevent is silent in the worst way: a slot id with no
component, or a `when` the screen does not provide, renders NOTHING. The screen
still draws, still looks deliberate, and a block a designer expected is simply
absent.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

REGISTRY = os.path.join(ROOT, "src", "ui", "screens.json")
SLOTS_JS = os.path.join(ROOT, "src", "ui", "Slots.jsx")
APP = os.path.join(ROOT, "src", "ui", "App.jsx")
SCREENS_DIR = os.path.join(ROOT, "src", "ui", "screens")
VOCAB = os.path.join(ROOT, "src", "assets", "vocabulary.generated.json")

#: Which component file renders each slot-driven screen.
IMPLEMENTED = {"over": "ResultsScreen.jsx", "title": "TitleScreen.jsx",
               "realmpick": "RealmPick.jsx", "passage": "PassageScreen.jsx"}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def code(path):
    src = read(path)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(REGISTRY))
        self.screens = self.doc["screens"]
        self.vocab = json.loads(read(VOCAB))["enums"]["UI_SCREEN"]

    def test_every_screen_is_a_known_screen(self):
        for sid in self.screens:
            self.assertIn(sid, self.vocab,
                          f"'{sid}' is not a UIScreen — the registry, App.jsx and "
                          f"the manifest's editorUI block are all keyed by the same "
                          f"fifteen names, which is exactly the shape that drifts")

    def test_every_slot_has_a_component(self):
        """A slot id with no component renders NOTHING and says nothing —
        `Slots` warns once to the console and carries on, which is right at
        runtime and invisible in review."""
        for sid, rec in self.screens.items():
            src = read(os.path.join(SCREENS_DIR, IMPLEMENTED[sid]))
            body = src.split("const SLOTS = {", 1)[1].split("\n  };", 1)[0]
            have = set(re.findall(r"^\s{4}(\w+):", body, re.M))
            for slot in rec["slots"]:
                self.assertIn(slot["id"], have,
                              f"{sid}.{slot['id']} has no component in {IMPLEMENTED[sid]}")

    def test_no_component_is_unreachable(self):
        for sid, rec in self.screens.items():
            src = read(os.path.join(SCREENS_DIR, IMPLEMENTED[sid]))
            body = src.split("const SLOTS = {", 1)[1].split("\n  };", 1)[0]
            have = set(re.findall(r"^\s{4}(\w+):", body, re.M))
            listed = {s["id"] for s in rec["slots"]}
            self.assertEqual(have - listed, set(),
                             f"{sid} implements {sorted(have - listed)}, which the "
                             f"registry never renders")

    def test_every_when_is_provided_by_the_screen(self):
        """A `when` the screen's context does not define is `undefined`, which
        is falsey — so the block never appears, on every run, silently."""
        for sid, rec in self.screens.items():
            src = read(os.path.join(SCREENS_DIR, IMPLEMENTED[sid]))
            ctx = src.split("const ctx = {", 1)[1].split("\n  };", 1)[0]
            keys = set(re.findall(r"(\w+)\s*[:,]", ctx))
            for slot in rec["slots"]:
                if "when" not in slot:
                    continue
                self.assertIn(slot["when"], keys,
                              f"{sid}.{slot['id']} waits on '{slot['when']}', which "
                              f"the screen's context does not provide")

    def test_the_registry_holds_no_layout(self):
        """THE LINE THAT KEEPS THIS FROM BECOMING A LAYOUT LANGUAGE.

        A slot may carry an id, a region, a `when`, a `hidden` flag and a note.
        The moment it can carry a style, a size or a position, this file is a
        worse React than the React it replaced.
        """
        allowed = {"id", "region", "when", "hidden", "note"}
        for sid, rec in self.screens.items():
            for slot in rec["slots"]:
                extra = set(slot) - allowed
                self.assertEqual(extra, set(),
                                 f"{sid}.{slot['id']} carries {sorted(extra)}; the "
                                 f"registry selects and orders, it does not lay out")

    def test_slots_cannot_parse_an_expression(self):
        # `when` is a KEY of the context, looked up directly. If this ever
        # starts parsing `!a` or `a && b`, screens.json has become a language.
        src = code(SLOTS_JS)
        self.assertIn("ctx[s.when]", src)
        for forbidden in ("eval(", "new Function", "split(\"&&\")", "startsWith(\"!\")"):
            self.assertNotIn(forbidden, src,
                             f"Slots.jsx is interpreting `when` ({forbidden})")


class VocabularyTests(unittest.TestCase):
    def test_the_app_branches_on_the_vocabulary(self):
        """`App.jsx` had ~30 comparisons against raw strings, and three of the
        screens (`settings`, `shop`, `lanchapick`) also decide whether the
        SIMULATION is paused — so a typo there is not a blank screen, it is a
        live game running behind a menu."""
        src = code(APP)
        raw = re.findall(r'(?:screen|current)\s*[!=]==\s*"(\w+)"', src)
        self.assertEqual(raw, [], f"App.jsx compares screens to raw strings: {raw}")
        raw_modes = re.findall(r'(?:mode|pendingMode)\s*[!=]==\s*"(\w+)"', src)
        self.assertEqual(raw_modes, [], f"App.jsx compares modes to raw strings: {raw_modes}")

    def test_the_picker_medium_is_the_runs_not_a_leftover_stages(self):
        """`pendingStage` outlived the run that set it, and the picker read the
        medium straight off it.

        So once La Traves\u00eda had been chosen in a session, `briefStage.kind`
        stayed CROSSING for ever and every later Arcade or Recorrer opened the
        vehicle picker on BOATS — for a run that is driven. Two things close it,
        and this asserts both: `pickMode` clears the stage for a non-story mode,
        and the medium is derived PER MODE, so a stage that does not belong to
        this run cannot reach the answer at all.
        """
        src = code(APP)
        self.assertIn("setPendingStage(mode === GAME_MODE.STORY ? pendingStage : null)", src,
                      "pickMode no longer clears the stale pendingStage")
        m = re.search(r"const runMedium = (.*?);\n", src, re.S)
        self.assertIsNotNone(m, "the picker medium is not derived through `runMedium`")
        self.assertIn("pendingMode === GAME_MODE.STORY", m.group(1),
                      "runMedium does not ask which mode is starting")
        # the stage may only be consulted inside the story branch
        head = m.group(1).split("?", 1)[0]
        self.assertNotIn("briefStage", head,
                         "runMedium reaches for briefStage before asking the mode")
        self.assertNotIn("medium={briefStage", src,
                         "the picker still reads its medium straight off a stage")

    def test_both_vocabularies_reached_the_client(self):
        vocab = json.loads(read(VOCAB))["enums"]
        self.assertEqual(len(vocab["UI_SCREEN"]), 16)
        self.assertEqual(set(vocab["GAME_MODE"]), {"story", "arcade", "explore", "tutorial"})
