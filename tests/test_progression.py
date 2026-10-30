"""LA PROGRESIÓN Y LA SIMULACIÓN — `src/content/progression.json` + `simulation.json`.

Two registries with the same split as everywhere else: the state machine and the
algorithms stay in the engine, the judgements move out. "Drive 260 px and turn
1.6 radians" is a decision about when somebody has understood steering; reading
the input and accumulating the distance is not.

The gate worth having here is the TUTORIAL's. A step names the condition the
engine implements, so a step naming one that does not exist is a step nobody can
pass — the run would simply stop, with no error, on whichever control the typo
was on. That was a `switch` on the step index before, where the same mistake was
impossible; making it data made it possible, so it needs a test.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

PROGRESSION = os.path.join(ROOT, "src", "content", "progression.json")
SIMULATION = os.path.join(ROOT, "src", "content", "simulation.json")
TUTORIAL_JS = os.path.join(ROOT, "src", "game", "tutorial.js")
PROGRESS_JS = os.path.join(ROOT, "src", "game", "progress.js")
SPAWNS_JS = os.path.join(ROOT, "src", "game", "spawns.js")
I18N = os.path.join(ROOT, "src", "i18n")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TutorialTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(PROGRESSION))["tutorial"]
        self.js = read(TUTORIAL_JS)
        body = self.js.split("const GATES = {", 1)[1].split("\n};", 1)[0]
        self.gates = set(re.findall(r"^\s*(\w+):", body, re.M))

    def test_every_step_names_a_gate_the_engine_implements(self):
        for step in self.doc["steps"]:
            self.assertIn(step["gate"], self.gates,
                          f"step '{step['id']}' waits on gate '{step['gate']}', "
                          f"which nothing implements — the run would stop there "
                          f"with no error at all")

    def test_no_gate_is_unreachable(self):
        used = {s["gate"] for s in self.doc["steps"]}
        self.assertEqual(self.gates - used, set(),
                         f"these gates are implemented but no step uses them: "
                         f"{self.gates - used}")

    def test_every_step_has_the_numbers_its_gate_reads(self):
        """A threshold the gate reads and the step does not define is
        `undefined`, and every comparison against it is false — the step never
        passes, which reads as a broken control rather than a missing field."""
        body = self.js.split("const GATES = {", 1)[1].split("\n};", 1)[0]
        for step in self.doc["steps"]:
            m = re.search(rf"^\s*{step['gate']}:.*?(?=\n  \w+:|\Z)", body, re.S | re.M)
            reads = set(re.findall(r"\bS\.(\w+)", m.group(0)))
            missing = reads - set(step) - {"count"}      # `count` has a default
            self.assertEqual(missing, set(),
                             f"step '{step['id']}' does not define {sorted(missing)}, "
                             f"which its gate reads")

    def test_the_platform_steps_have_both_wordings(self):
        """`platform: true` means the HUD appends `.touch` or `.keys` — a phone
        must not be told to press X. A step marked platform whose catalog has
        only one of the two shows a raw key to half the players."""
        cat = json.loads(read(os.path.join(I18N, "es.json")))
        for step in self.doc["steps"]:
            if not step.get("platform"):
                self.assertIn(step["key"], cat, f"{step['id']}: no copy for {step['key']}")
                continue
            for io in ("touch", "keys"):
                self.assertIn(f"{step['key']}.{io}", cat,
                              f"{step['id']} is platform-aware but has no `{io}` wording")

    def test_the_last_step_ends_the_run(self):
        # It is the only one that does, and it ends it as a WIN so the results
        # screen says so rather than reading as a timeout.
        self.assertIn("state.over = true; state.won = true;", self.js)
        self.assertEqual(self.doc["steps"][-1]["gate"], "linger")

    def test_the_advance_sound_exists(self):
        recipes = json.loads(read(os.path.join(ROOT, "src", "assets", "audio.json")))["recipes"]
        coded = ("horn", "combo")
        name = self.doc["sound"]
        self.assertTrue(name in recipes or name in coded,
                        f"the tutorial advances with '{name}', which is not a sound")


class UnlockTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(PROGRESSION))["unlocks"]
        self.js = read(PROGRESS_JS)

    def test_a_new_save_can_reach_something(self):
        self.assertTrue(self.doc["startsUnlocked"], "a new save opens nothing")
        for d in self.doc["startsUnlocked"]:
            self.assertNotIn(d, self.doc["mvpLocked"],
                             f"'{d}' is both where a new player starts and closed "
                             f"for the MVP")

    def test_the_start_is_written_down_once(self):
        """It was THREE literals in progress.js — the no-save path, the
        empty-list repair and the parse-failure path — which is three places to
        forget when a district opens."""
        self.assertNotIn('["faro", "carmen"]', self.js,
                         "the starting districts are a literal in progress.js again")
        self.assertIn("STARTS_UNLOCKED", self.js)

    def test_the_locked_districts_all_exist(self):
        world = json.loads(read(os.path.join(ROOT, "content", "world", "geography.json")))
        ids = ({d["id"] for d in world["districts"]}
               | {d["id"] for d in world["inlandDistricts"]})
        for d in self.doc["mvpLocked"] + self.doc["startsUnlocked"]:
            self.assertIn(d, ids, f"'{d}' is not a district in the world")


class SimulationTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(SIMULATION))
        self.spawns = read(SPAWNS_JS)

    def test_life_is_created_outside_the_view(self):
        """`spawnMin` is what stops somebody appearing in plain sight. The
        viewport's half-diagonal is about 230 px."""
        s = self.doc["streaming"]
        self.assertGreater(s["spawnMin"], 230,
                           "things would pop into existence on screen")
        self.assertGreater(s["spawnRadius"], s["spawnMin"])
        self.assertGreater(s["keepRadius"], s["spawnRadius"],
                           "life must be kept further out than it is spawned, or "
                           "it is reaped the moment it is created")

    def test_the_day_phases_are_a_whole_day(self):
        shares = [p["share"] for p in self.doc["day"]["phases"]]
        self.assertAlmostEqual(sum(shares), 1.0, places=6,
                               msg=f"the phases sum to {sum(shares)}, so the clock "
                                   f"either skips or repeats a stretch of the day")
        weathers = set(json.loads(read(os.path.join(
            ROOT, "src", "assets", "materials.json")))["weather"])
        for p in self.doc["day"]["phases"]:
            self.assertIn(p["weather"], weathers,
                          f"'{p['weather']}' has no palette in materials.json, so "
                          f"that stretch of the day would draw as nothing")

    def test_the_storm_windows_make_sense(self):
        every = self.doc["day"]["stormEverySeconds"]
        lasts = self.doc["day"]["stormLastsSeconds"]
        self.assertLess(every[0], every[1])
        self.assertLess(lasts[0], lasts[1])
        self.assertLess(lasts[1], every[0],
                        "the longest storm outlasts the shortest gap between "
                        "storms, so it would never stop raining")

    def test_the_tide_is_semidiurnal(self):
        # Two highs and two lows a day, like the real gulf.
        self.assertEqual(self.doc["tide"]["periodFraction"], 0.5)
        self.assertLess(self.doc["tide"]["stormSurge"], 0.5,
                        "a surge this big turns a bajamar into a pleamar, and the "
                        "banks the crossing is about stop existing")

    def test_the_bus_radii_are_ordered(self):
        b = self.doc["buses"]
        self.assertLess(b["haltRadius"], b["brakeRadius"],
                        "a bus must start braking before it must stop")
        self.assertLess(b["stopSpawnRadius"], b["stopKeepRadius"])
        self.assertLess(b["dwellSeconds"][0], b["dwellSeconds"][1])

    def test_the_numbers_left_the_module(self):
        self.assertNotRegex(self.spawns, r"const KEEP_R = \d",
                            "the streaming radii are literals in spawns.js again")
        self.assertIn("SIM.streaming", self.spawns)

    def test_the_pedestrian_count_stays_with_the_npc_registry(self):
        """'How many people are on the sidewalk' belongs to the TYPE, which the
        editor already authors — putting a second copy here is the drift this
        whole project has been removing."""
        self.assertNotIn("pedestrians", self.doc["population"])
        self.assertIn('npcType("walker")', self.spawns)
