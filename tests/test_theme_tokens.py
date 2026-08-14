"""LOS TOKENS DE TEMA — `src/styles.css` and `src/ui/themeTokens.json`.

The world editor builds its theme form from the registry, so the registry is the
only thing standing between "the editor can restyle the game" and "the editor
appears to restyle the game". Before 2026-08-14 it was the second one, and the
measurement is the reason this file exists:

  * **183 colour literals against 34 `var()` uses.** Roughly a sixth of the
    colour in the stylesheet was reachable from the editor. Change `--coral`
    and 183 colours stayed exactly where they were.
  * **`--warm` and `--kola` had no `var()` anywhere in `src/`.** Two of the nine
    knobs the form offered were wired to nothing at all. Turn one, watch nothing
    happen, conclude the theming is broken.

And the ROADMAP said tokens "already give the editor real authority over the
screens", which is how a claim like that survives: both sides were internally
consistent, so nothing contradicted it.

The four gates below are what keeps it true. The third one — no dead token — is
the one that would have caught the original bug on the day it was introduced.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

CSS = os.path.join(ROOT, "src", "styles.css")
REGISTRY = os.path.join(ROOT, "src", "ui", "themeTokens.json")
SRC = os.path.join(ROOT, "src")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def split_css():
    """(the :root block, everything else). Literals are legal in :root — that is
    where a token is DEFINED — and nowhere else."""
    css = read(CSS)
    head, rest = css.split(":root {", 1)
    root, body = rest.split("\n}", 1)
    return root, body


def var_uses():
    """Every `var(--x)` anywhere in src/ — the stylesheet, the JSX, the modules.

    A use WITH a fallback (`var(--x, 1)`) is deliberately excluded. That form is
    a property somebody else may set at runtime and the rule works without it —
    the dev-tweaks host's `--dc-inv-zoom` is the live example — so it is not a
    theme token and must not be demanded of the registry.
    """
    uses = set()
    for base, _dirs, files in os.walk(SRC):
        if "world2d" in base:
            continue
        for name in files:
            # CSS and the modules that write inline styles. NOT .json: a
            # registry DECLARES tokens and its prose quotes the composed forms
            # (`oklch(var(--x-oklch) / α)`), which is documentation, not a use.
            if not name.endswith((".css", ".js", ".jsx")):
                continue
            text = read(os.path.join(base, name))
            # A `var()` inside a COMMENT is documentation — the :root block
            # explains the channel form as `oklch(var(--x-oklch) / α)`, and a
            # scan that reads prose would demand a token called `--x-oklch`.
            text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
            text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
            for m in re.finditer(r"var\((--[\w-]+)\s*([,)])", text):
                if m.group(2) == ")":
                    uses.add(m.group(1))
    return uses


class TokenRegistryTests(unittest.TestCase):
    def setUp(self):
        self.root, self.body = split_css()
        self.reg = json.loads(read(REGISTRY))
        self.declared = dict(re.findall(r"^\s*(--[\w-]+):\s*([^;]+);", self.root, re.M))
        self.rows = {t["css"]: t for t in self.reg["tokens"]}

    def test_the_registry_and_the_stylesheet_declare_the_same_tokens(self):
        self.assertEqual(set(self.declared), set(self.rows),
                         "the editor's form and the stylesheet disagree about which "
                         "tokens exist; a row with no declaration is a knob that "
                         "writes a property nothing reads")

    def test_every_default_matches_the_stylesheet(self):
        # `default` is what the editor shows as the baseline. If it drifts, the
        # form opens on a value the game is not using and the first save
        # silently restyles it.
        for css_var, value in self.declared.items():
            self.assertEqual(self.rows[css_var]["default"], value.strip(),
                             f"{css_var}: the registry's default is not what the "
                             f"stylesheet ships")

    def test_no_token_is_dead(self):
        """THE ONE THAT WOULD HAVE CAUGHT IT.

        `--warm` and `--kola` sat in the form for months with no `var()` behind
        them. They are deleted; this is what stops the next pair.
        """
        uses = var_uses()
        dead = [t for t in self.declared if t not in uses]
        self.assertEqual(dead, [],
                         f"these tokens are offered to an author and used by nothing: "
                         f"{dead}. Wire them or delete them — a knob that changes "
                         f"nothing reads as broken theming.")

    def test_every_token_used_is_declared(self):
        # The other direction: `var(--typo)` resolves to nothing, and the
        # declaration is then INVALID AT COMPUTED-VALUE TIME — the property
        # falls back to its initial value, so a colour goes black with no error.
        for used in var_uses():
            if used.startswith("--tw-"):      # not ours
                continue
            self.assertIn(used, self.declared,
                          f"{used} is used but never declared; the declaration "
                          f"using it computes to its initial value, silently")


class StylesheetTests(unittest.TestCase):
    def setUp(self):
        self.root, self.body = split_css()

    def test_no_colour_literal_outside_root(self):
        """Every colour in a RULE goes through a token.

        This is the whole sweep in one assertion. `oklch(var(--x) / 0.6)` is
        fine — the alpha belongs to the rule that chose it, and a token per
        alpha would be a worse file, not a more editable one.
        """
        stripped = re.sub(r"var\(--[\w-]+\)", "TOKEN", self.body)
        stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.S)
        lits = re.findall(r"#[0-9a-fA-F]{3,8}\b|oklch\(\s*[\d.]|rgba?\(\s*\d", stripped)
        self.assertEqual(lits, [], f"colour literals are back in the rules: {lits[:8]}")

    def test_no_font_family_literal_outside_root(self):
        stripped = re.sub(r"/\*.*?\*/", "", self.body, flags=re.S)
        fams = re.findall(r'"(Bungee|JetBrains Mono|Space Grotesk)"', stripped)
        self.assertEqual(fams, [], f"a font stack is written out again: {set(fams)}")

    def test_the_channels_are_bare_triples(self):
        """A channel is a colour WITHOUT its alpha, and the wrapper is the
        rule's. Wrapping one here makes `rgba(rgb(1,2,3), .5)`, which is
        invalid and drops the declaration."""
        for css_var, value in re.findall(r"^\s*(--[\w-]+-rgb):\s*([^;]+);", self.root, re.M):
            self.assertRegex(value.strip(), r"^\d{1,3},\d{1,3},\d{1,3}$",
                             f"{css_var} must be a bare `r,g,b`")
        for css_var, value in re.findall(r"^\s*(--[\w-]+-oklch):\s*([^;]+);", self.root, re.M):
            self.assertNotIn("/", value,
                             f"{css_var} must carry no alpha — the rule adds it")

    def test_the_motion_survived(self):
        """The harness freezes animations to compare styles, so it is blind to
        these: assert them from the source instead."""
        css = read(CSS)
        names = set(re.findall(r"@keyframes\s+([\w-]+)", css))
        self.assertGreaterEqual(len(names), 22,
                                f"{len(names)} keyframe animations; the sweep should "
                                f"not have removed any")
        for used in set(re.findall(r"animation:\s*([\w-]+)", css)):
            if used in ("none",):
                continue
            self.assertIn(used, names, f"`animation: {used}` names no @keyframes")
