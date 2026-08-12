"""THE DRIFT GATE.

`docs/inventory.md` §13 audited the whole tree and found eight live
disagreements between the world's vocabulary and the code that consumes it —
not duplicate-literal risks, actual divergences in the shipped build:

  * the editor knew 8 of 11 surface classes and its palette 10;
  * `malecon` was a pier style the builder produced and the renderer had no
    recipe for, so four bajadas were drawn as concrete muelles on the sand;
  * `living_street` had no render rank, so one would paint UNDER the service
    roads — latent, since nothing is tagged that way yet;
  * `Sign.kind` was `str`, and an unknown kind draws NOTHING, silently;
  * `LandmarkType` had no `museum`/`anchor` while the Canvas drew both;
  * `aceraPx` fell back to 12 in the sim and 8 in both renderers.

Every one of them is the same failure: a closed vocabulary copied by hand into
another file. So the copies are generated now, and this file is the check that
they stay generated and stay covered. It reads the CLIENT SOURCE as text on
purpose — importing it would need a bundler, and the question here is what the
shipped file says.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums import (
    RENDER_RANK, TRAFFIC_MAIN, YIELDS_TO, LandmarkType, PierStyle, RoadClass,
    SignKind,
)
from churchill.world.enums.surface import CLASS_NAMES, Surface

import tools.gen_vocabulary as gen

MANIFEST = os.path.join(ROOT, "src", "world2d", "manifest.json")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def js_cases(text):
    """Every `case "value":` in a JS source."""
    return set(re.findall(r'case\s+"([^"]+)"\s*:', text))


class GeneratedArtifactTests(unittest.TestCase):
    def test_the_artifacts_are_not_stale(self):
        # Generation is one-way and the artifacts are checked in, because the
        # game builds with Vite and must not need Python. That only holds if
        # regenerating is a no-op.
        self.assertEqual(gen.render_js(), read("src", "domain", "vocabulary.generated.js"),
                         "run python3 tools/gen_vocabulary.py")
        self.assertEqual(gen.render_json(), read("src", "assets", "vocabulary.generated.json"),
                         "run python3 tools/gen_vocabulary.py")

    def test_the_shipped_manifest_agrees_with_the_enum_order(self):
        # `grid.classes` is indexed BY the RLE bytes, so a reorder does not read
        # as a bug, it reads as a repainted map.
        with open(MANIFEST, encoding="utf-8") as fh:
            manifest = json.load(fh)
        self.assertEqual(manifest["grid"]["classes"], CLASS_NAMES)

    def test_the_json_artifact_carries_every_role_set(self):
        doc = json.loads(read("src", "assets", "vocabulary.generated.json"))
        self.assertEqual(doc["surface"]["classes"], CLASS_NAMES)
        for name, _ in gen.SURFACE_ROLES:
            self.assertIn(name, doc["surface"]["roles"])


class RendererCoverageTests(unittest.TestCase):
    """A shipped enum value with no renderer implementation is invisible art."""

    def test_every_sign_kind_is_drawn(self):
        cases = js_cases(read("src", "render", "c2d", "streets.js"))
        for kind in SignKind:
            self.assertIn(str(kind.value), cases,
                          f"drawSign has no case for {kind.value} — it would "
                          f"draw nothing at all")

    def test_every_pier_style_has_a_deck_recipe(self):
        text = read("src", "render", "c2d", "structures.js")
        body = text.split("PIER_STYLES = {", 1)[1].split("\n};", 1)[0]
        recipes = set(re.findall(r"^\s{2}(\w+):", body, re.M))
        for style in PierStyle:
            self.assertIn(str(style.value), recipes,
                          f"PIER_STYLES has no recipe for {style.value}; the "
                          f"lookup falls through to concrete")

    def test_every_landmark_type_is_dispatched(self):
        cases = js_cases(read("src", "render", "c2d", "landmarks.js"))
        for kind in LandmarkType:
            self.assertIn(str(kind.value), cases,
                          f"landmarks.js has no case for {kind.value} — it "
                          f"would draw as a generic pin")

    def test_every_road_class_has_a_painting_rank(self):
        # `ROAD_ORDER[a.cls] || 0` is why a missing entry is silent: the class
        # just sorts first and gets painted under everything.
        for cls in RoadClass:
            self.assertIn(cls, RENDER_RANK,
                          f"{cls.value} has no render rank")


class RoleSetTests(unittest.TestCase):
    def test_the_two_road_role_sets_are_deliberately_different(self):
        # The audit found these read as one set. They are not: the Paseo is a
        # road you stop for and also a promenade nobody speeds down. If they
        # ever become equal, one of them is wrong.
        self.assertNotEqual(set(YIELDS_TO), set(TRAFFIC_MAIN))
        self.assertIn(RoadClass.PASEO, YIELDS_TO)
        self.assertNotIn(RoadClass.PASEO, TRAFFIC_MAIN)


class RawLiteralTests(unittest.TestCase):
    """No module may name a surface with a bare number again.

    Scanned over the WHOLE of `src/`, not the six modules the audit listed: the
    audit found `surfaceAt(x, y) === 0`, but the same file also held
    `const PED_CLS = [6]` and `if (surf !== 5) return 0` — the literal moved one
    step away from the call and stopped being greppable by the obvious pattern.
    """

    #: Each is a way of saying a class without naming it. Kept as separate
    #: patterns rather than one clever regex so a failure says which shape.
    PATTERNS = (
        (r"surfaceAt\([^)]*\)\s*[!=]==\s*\d", "compared surfaceAt() to a number"),
        (r"\bsurf[A-Za-z]*\s*[!=]==\s*\d", "compared a surface variable to a number"),
        (r"(?:_CLS|surfaceClasses)\s*=\s*\[\s*\d", "a class list written as numbers"),
    )

    def test_no_surface_is_named_by_a_number(self):
        for dirpath, _, files in os.walk(os.path.join(ROOT, "src")):
            if "tiles" in dirpath:                    # generated tile data
                continue
            for name in sorted(files):
                if not name.endswith((".js", ".jsx")):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, name), ROOT)
                with open(os.path.join(dirpath, name), encoding="utf-8") as fh:
                    text = fh.read()
                for pattern, why in self.PATTERNS:
                    hits = re.findall(pattern, text)
                    self.assertEqual(hits, [], f"{rel}: {why} — use SURFACE.* ({hits})")

    def test_the_acera_depth_has_exactly_one_fallback(self):
        # It had four, and they disagreed: 12 in the sim and the editor, 8 in
        # both renderers, so a stale manifest moved every NPC one way and drew
        # the kerb another. The accessor owns the default now.
        owner = os.path.join("src", "world2d", "index.js")
        for dirpath, _, files in os.walk(os.path.join(ROOT, "src")):
            for name in files:
                if not name.endswith((".js", ".jsx")):
                    continue
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, ROOT)
                if rel == owner:
                    continue
                with open(path, encoding="utf-8") as fh:
                    text = fh.read()
                self.assertNotIn("aceraPx", text,
                                 f"{rel} reads meta.aceraPx directly; ask "
                                 f"W.ACERA_PX so there is one fallback")
