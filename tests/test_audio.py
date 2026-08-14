"""EL SONIDO — `src/assets/audio.json` and `src/game/audio.js`.

There is not one audio file in this game: every sound is synthesised at runtime
from oscillators and a shared noise buffer, which is why the whole soundtrack
costs zero bytes of download. What moved on 2026-08-14 is the part a person
tuning by ear wants to change — the step list of each one-shot, the numbers each
continuous voice is tuned to, and (new) the mixer.

**THE MIXER IS THE INTERESTING PART.** Until this commit there was exactly ONE
gain node in the whole game, the master, so mixing was not something you could
do badly — it was something you could not do at all. Ambience could not be set
quieter than the SFX. The buses ship at 1.0 because a gain of 1 in series is
arithmetically transparent, so their existence changes nothing until somebody
moves one.

Audio cannot be diffed the way a sprite sheet can, so the proof here is
structural: every recipe's steps are compared against the literals the module
used to hold, and the two recipes that KEEP their code are asserted to still be
code rather than quietly half-migrated.
"""
import json
import os
import re
import subprocess
import unittest

from churchill.world.config import ROOT

AUDIO_JSON = os.path.join(ROOT, "src", "assets", "audio.json")
AUDIO_JS = os.path.join(ROOT, "src", "game", "audio.js")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def git_show(path, must_contain=()):
    """The most recent version of a file that still contained `must_contain`.

    Not `HEAD:` — the migration has been committed, so HEAD no longer holds the
    literals this compares against. Walking back for the last version that did
    keeps the check meaningful, and it degrades to a skip rather than a failure
    once that scrolls out of reach: it is a migration check, not a permanent
    contract.
    """
    log = subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "-n", "40", "--", path],
                         capture_output=True, text=True).stdout.split()
    for sha in log:
        src = subprocess.run(["git", "-C", ROOT, "show", f"{sha}:{path}"],
                             capture_output=True, text=True).stdout
        if all(m in src for m in must_contain):
            return src
    return ""


def parse_calls(src):
    """[(kind, {k: v})] for every tone()/noiseHit() call in a chunk of source."""
    calls = []
    for m in re.finditer(r"\b(tone|noiseHit)\(\{([^}]*)\}\)", src):
        args = {}
        for k, v in re.findall(r"(\w+):\s*([^,}]+)", m.group(2)):
            v = v.strip().strip('"')
            try:
                args[k] = float(v) if "." in v or "e" in v.lower() else int(v)
            except ValueError:
                args[k] = v
        calls.append((m.group(1), args))
    return calls


class MixerTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(AUDIO_JSON))
        self.js = read(AUDIO_JS)

    def test_the_buses_ship_transparent(self):
        """A bus at 1.0 is arithmetically transparent.

        This is what lets the mixer land without re-tuning the game by ear —
        and if somebody changes a default here, they are changing the shipped
        balance, which this makes them do on purpose.
        """
        for bus, spec in self.doc["mixer"]["buses"].items():
            if bus.startswith("_"):
                continue
            self.assertEqual(spec["gain"], 1.0,
                             f"bus '{bus}' does not ship transparent; the mix in "
                             f"the tuning notes assumes every bus is at unity")

    def test_every_bus_a_recipe_or_voice_names_exists(self):
        buses = {b for b in self.doc["mixer"]["buses"] if not b.startswith("_")}
        for rid, spec in self.doc["recipes"].items():
            if rid.startswith("_"):
                continue
            self.assertIn(spec["bus"], buses,
                          f"recipe '{rid}' plays on bus '{spec['bus']}', which does "
                          f"not exist — it would fall back to the master and be "
                          f"unmixable")
        for vid, spec in self.doc["voices"].items():
            if vid.startswith("_") or "bus" not in spec:
                continue
            self.assertIn(spec["bus"], buses, f"voice '{vid}' names a missing bus")

    def test_the_graph_is_voice_bus_master(self):
        self.assertIn("g.connect(master)", self.js,
                      "the buses must hang off the master, which is what mute and "
                      "the volume slider drive")
        self.assertIn("buses.sfx || master", self.js,
                      "a one-shot must fall back to the master if the buses have "
                      "not been built — `play` can be called before unlock")


class RecipeTests(unittest.TestCase):
    """Every step list, against the literals the module used to hold."""

    def setUp(self):
        self.doc = json.loads(read(AUDIO_JSON))
        self.old = git_show("src/game/audio.js",
                            ("menu_move:", "noiseHit({", "const RECIPES = {"))
        self.js = read(AUDIO_JS)

    def old_recipe(self, name):
        i = self.old.index(f"  {name}:")
        j = self.old.index("\n  ", i + len(name) + 4)
        while self.old[j:j + 4] == "\n   ":       # continuation lines
            j = self.old.index("\n  ", j + 3)
        return self.old[i:j]

    def test_every_migrated_recipe_kept_its_steps(self):  # noqa: C901
        """Step-for-step against the literals — with one caveat worth stating.

        `delivery` and `perfect` were written as `[523,659,784].forEach(...)`,
        i.e. ONE `tone(` call in the source that fires three notes. So a source
        scan sees one step where the registry has three, and both are right.
        Those two are compared by their NOTE SET instead; the audible proof for
        all ten is `tools/render-audio.mjs`, which renders each recipe offline
        and compares the envelope (see the module docstring).
        """
        if not self.old:
            self.skipTest("the literal version of audio.js is out of git reach")
        for name in [r for r in self.doc["recipes"] if not r.startswith("_")]:
            src = self.old_recipe(name)
            was = parse_calls(src)
            now = [("tone", s["tone"]) if "tone" in s else ("noiseHit", s["noise"])
                   for s in self.doc["recipes"][name]["steps"]]
            looped = ".forEach" in src
            if not looped:
                self.assertEqual(len(was), len(now),
                                 f"'{name}': {len(was)} steps before, {len(now)} now")
                for i, ((k0, a0), (k1, a1)) in enumerate(zip(was, now)):
                    self.assertEqual(k0, k1, f"'{name}' step {i}: {k0} became {k1}")
                    for key, val in a0.items():
                        self.assertEqual(a1.get(key, 0 if key == "at" else val), val,
                                         f"'{name}' step {i}: {key} was {val}, now {a1.get(key)}")
            else:
                # every frequency the loop iterated over must still be played
                notes = {float(f) for f in re.findall(r"\[([\d,\s]+)\]\.forEach", src)[0].split(",")}
                played = {float(a.get("from")) for _, a in now if a.get("from")}
                self.assertTrue(notes <= played,
                                f"'{name}' lost {notes - played} from its arpeggio")

    def test_the_two_coded_recipes_are_still_code(self):
        """`horn` and `combo` are deliberately not data, and the registry says so.

        The horn loops over an interval table doubling each note with a twin
        detuned 0.6 % so the pair BEATS — that beating is what makes it read as
        air rather than a bass note. `combo` is a function of the streak. Both
        as JSON would be arithmetic in JSON.
        """
        self.assertNotIn("horn", [r for r in self.doc["recipes"] if not r.startswith("_")])
        self.assertNotIn("combo", [r for r in self.doc["recipes"] if not r.startswith("_")])
        self.assertIn("_coded", self.doc["recipes"], "the registry must say why they are absent")
        self.assertIn("horn:", self.js)
        self.assertIn("combo:", self.js)

    def test_the_interpreter_covers_both_step_kinds(self):
        # The step handling lives in the SHARED module now (src/audio/recipe.js),
        # so that is where to look — `playSteps` is one line of delegation.
        shared = read(os.path.join(ROOT, "src", "audio", "recipe.js"))
        body = shared.split("export function playRecipe", 1)[1].split("\n}", 1)[0]
        self.assertIn("step.tone", body)
        self.assertIn("step.noise", body)


class VoiceTests(unittest.TestCase):
    """The continuous voices: the numbers are data, the graph is not."""

    def setUp(self):
        self.doc = json.loads(read(AUDIO_JSON))["voices"]

    def test_the_beds_and_lfos_are_intact(self):
        # Each of these three is a specific claim about what the sound IS, and
        # dropping a bed is the difference between a fountain and a shower.
        self.assertEqual(len(self.doc["fountain"]["beds"]), 3,
                         "a fountain is THREE noise beds — jet, spray, body. With "
                         "two it reads as shower noise, which is what it used to be")
        self.assertEqual(len(self.doc["pool"]["beds"]), 2)
        self.assertEqual(len(self.doc["waves"]["beds"]), 2)
        # The surf's LFO is the number that turns a noise bed into waves.
        self.assertLess(self.doc["waves"]["lfo"]["hz"], 0.2,
                        "the swell must stay slow — a nine-second breath")
        self.assertGreater(self.doc["fountain"]["lfo"]["hz"], 1.0,
                           "the jet flutters fast and shallow; slow it down and it "
                           "reads as an engine, which it once did")

    def test_the_dj_is_filtered_not_faded(self):
        # DISTANCE IS A FILTER, NOT A FADER. From down the Paseo you get the
        # kick; only at the booth do you get the whole set.
        f = self.doc["dj"]["filter"]
        self.assertLess(f["farHz"], f["nearHz"])
        self.assertLess(f["farHz"], 500, "far away must be a kick, not a muffled set")


class SharedInterpreterTests(unittest.TestCase):
    """One synth, three consumers."""

    def setUp(self):
        self.js = read(AUDIO_JS)
        self.shared = read(os.path.join(ROOT, "src", "audio", "recipe.js"))

    def test_the_interpreter_is_pure(self):
        """No DOM, no window, no imports.

        `tools/render-audio.mjs` and the world editor both load this outside the
        game's module graph — the editor is a separate repo that reads the
        game's DATA and never its modules, and this file is the single aliased
        exception. It stops being loadable the moment it reaches for a global.
        """
        self.assertNotIn("import ", self.shared.split("export")[0],
                         "the shared interpreter must have no imports")
        for forbidden in ("window.", "document.", "localStorage"):
            self.assertNotIn(forbidden, self.shared,
                             f"the shared interpreter touches {forbidden}")

    def test_the_game_does_not_keep_its_own_copy(self):
        # `tone`/`noiseHit` survive as thin wrappers that bind this module's
        # live ctx and default destination; the SYNTHESIS must be the shared one.
        self.assertIn("toneStep(ctx,", self.js)
        self.assertIn("noiseStep(ctx,", self.js)
        self.assertNotIn("o.frequency.exponentialRampToValueAtTime", self.js,
                         "audio.js is building oscillators again instead of "
                         "calling the shared interpreter")


class AuthoredSoundTests(unittest.TestCase):
    """SONIDOS PERSONALIZADOS — a custom sound, without a rebuild."""

    def setUp(self):
        self.js = read(AUDIO_JS)
        self.remote = read(os.path.join(ROOT, "src", "content", "remote.js"))

    def test_authored_replaces_and_clearing_restores(self):
        self.assertIn("const BUILT_IN = { ...RECIPES };", self.js)
        body = self.js.split("export function applySounds", 1)[1].split("\n}", 1)[0]
        self.assertIn("BUILT_IN[id]", body,
                      "clearing an authored sound must put the built-in back, not "
                      "leave silence — the same rule applyTheme follows for a "
                      "cleared token")

    def test_an_authored_recipe_is_validated_before_it_reaches_webaudio(self):
        """It arrives over the network from content.json, so it is untrusted.

        A gain outside 0..1 or a duration that is not a positive number is
        dropped: a custom sound must not be a way to make somebody's speakers do
        something unexpected.
        """
        block = self.remote.split("ui.sounds", 1)[1][:2000]
        self.assertIn("num(v.gain, 0, 1", block, "gain is not clamped")
        self.assertIn("num(v.dur, 0.001, 5", block, "duration is not clamped")
        self.assertIn("num(v.from, 20, 20000", block, "frequency is not clamped")
        self.assertIn('["sine", "square", "sawtooth", "triangle"]', block,
                      "the oscillator type is not restricted to the four real ones")

    def test_the_render_prefers_the_authored_spec(self):
        # An export has to show what the game will PLAY. Reading the static
        # registry would export the stock sound while the game plays the custom.
        self.assertIn("AUTHORED[name] || AUDIO.recipes[name]", self.js)
