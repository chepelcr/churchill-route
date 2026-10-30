"""LAS TRADUCCIONES — `src/i18n/`.

Measured before touching anything, 2026-08-14, and the measurement changed what
this phase should be: **the copy is already fully authored.** 259 keys, Spanish
and English both complete, zero missing either way. Across 2 254 lines of JSX
there is exactly ONE hardcoded string a translator would want (`LA RUTA`, the
game's own wordmark) plus the four `<kbd>` keycaps, which are the physical keys
on a keyboard and not language.

So "manage translations" was not the gap. What this file does is protect the
thing that is already right, because the two ways it degrades are both silent:

  * a key added to one catalog and not the other. `t()` falls back to the key
    itself, so a player of the second language sees `title.hint.drift` where a
    sentence should be — and only somebody playing in that language sees it.
  * a sentence typed straight into the JSX. It renders perfectly in the
    language it was written in and can never be translated at all.

`stages.json` is deliberately NOT a catalog: it is the per-language overlay of
stage names and briefs, keyed by stage id, so it is checked on its own terms.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

I18N = os.path.join(ROOT, "src", "i18n")
UI = os.path.join(ROOT, "src", "ui")
BASE = "es"


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def catalogs():
    """{lang: {key: text}} — the language files, not the stage overlay."""
    out = {}
    for name in sorted(os.listdir(I18N)):
        if not name.endswith(".json") or name == "stages.json":
            continue
        out[name[:-5]] = json.loads(read(os.path.join(I18N, name)))
    return out


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.cats = catalogs()
        self.base = self.cats[BASE]

    def test_every_language_has_every_key(self):
        """The silent one. `t()` falls back to the KEY, so a missing string
        shows `title.hint.drift` on screen — and only to somebody playing in
        that language."""
        for lang, cat in self.cats.items():
            missing = set(self.base) - set(cat)
            self.assertEqual(missing, set(),
                             f"{lang}.json is missing {len(missing)} keys, e.g. "
                             f"{sorted(missing)[:4]}")

    def test_no_language_invents_a_key(self):
        for lang, cat in self.cats.items():
            extra = set(cat) - set(self.base)
            self.assertEqual(extra, set(),
                             f"{lang}.json has {sorted(extra)[:4]}, which nothing "
                             f"asks for — either dead copy or a typo hiding a "
                             f"missing translation")

    def test_no_string_is_empty(self):
        for lang, cat in self.cats.items():
            blank = [k for k, v in cat.items() if not str(v).strip()]
            self.assertEqual(blank, [], f"{lang}.json has empty strings: {blank[:4]}")

    def test_the_placeholders_match_across_languages(self):
        """A `{name}` the translation drops renders as nothing; one it invents
        renders as the literal braces."""
        for lang, cat in self.cats.items():
            if lang == BASE:
                continue
            for key, text in cat.items():
                want = set(re.findall(r"\{(\w+)\}", str(self.base[key])))
                got = set(re.findall(r"\{(\w+)\}", str(text)))
                self.assertEqual(got, want,
                                 f"{lang}.{key}: placeholders {got} vs {want} in {BASE}")

    def test_every_language_is_registered(self):
        """A catalog nobody can select is dead weight; a LANGUAGES entry with no
        catalog is a picker item that shows every key raw."""
        index = read(os.path.join(I18N, "index.js"))
        block = index.split("export const LANGUAGES = [", 1)[1].split("];", 1)[0]
        listed = set(re.findall(r'id:\s*"(\w+)"', block))
        self.assertEqual(listed, set(self.cats),
                         f"LANGUAGES lists {listed} and the folder has {set(self.cats)}")


class StageOverlayTests(unittest.TestCase):
    """`stages.json` — names and briefs per language, keyed by stage id."""

    def setUp(self):
        self.overlay = json.loads(read(os.path.join(I18N, "stages.json")))
        stages = json.loads(read(os.path.join(ROOT, "content", "world", "stages.json")))
        # BOTH LISTS. La Travesía (s8) is a `crossingStages` entry, not a
        # delivery stage — it has a name and a brief on the carousel like every
        # other, so a check that only read `stages` would report the one stage
        # that IS translated as an orphan.
        self.ids = ({s["id"] for s in stages["stages"]}
                    | {s["id"] for s in stages["crossingStages"]})

    def test_every_overlay_stage_exists(self):
        for lang, table in self.overlay.items():
            for sid in table:
                self.assertIn(sid, self.ids,
                              f"{lang}: stage '{sid}' is not in the world")

    def test_the_overlay_covers_every_stage(self):
        for lang, table in self.overlay.items():
            missing = self.ids - set(table)
            self.assertEqual(missing, set(),
                             f"{lang} has no name/brief for {sorted(missing)} — the "
                             f"stage card would fall back to the Spanish original")

    def test_each_entry_has_both_fields(self):
        for lang, table in self.overlay.items():
            for sid, rec in table.items():
                for field in ("name", "brief"):
                    self.assertTrue(str(rec.get(field, "")).strip(),
                                    f"{lang}.{sid} has no {field}")


class JsxTests(unittest.TestCase):
    """No sentence typed straight into a component."""

    ALLOWED = {
        "LA RUTA",          # the game's own wordmark, not copy
    }

    def test_no_untranslatable_fallback_in_an_expression(self):
        """THE ONE THE FIRST VERSION OF THIS FILE MISSED.

        `TitleScreen` rendered `{editorConfig?.title || "LA RUTA DEL CHURCHILL"}`
        while the subtitle immediately below it fell back to `t("title.sub")` —
        so the game's own title was NOT translatable and its tagline was, and
        nothing said so. The original scan only looked at text between `>` and
        `<`, which is not where that lives.
        """
        offenders = []
        for base, _dirs, files in os.walk(UI):
            for name in files:
                if not name.endswith(".jsx"):
                    continue
                src = read(os.path.join(base, name))
                # `something || "Some words"` inside an expression
                for m in re.finditer(r'\|\|\s*"([^"]*\s[^"]*)"', src):
                    text = m.group(1).strip()
                    if not text or text in self.ALLOWED:
                        continue
                    offenders.append(f"{name}: {text[:48]}")
        self.assertEqual(offenders, [],
                         f"a string fallback in a JSX expression cannot be "
                         f"translated: {offenders[:5]}")

    def test_no_untranslatable_copy_in_the_screens(self):
        """A sentence in the JSX renders perfectly in the language it was
        written in and can never be translated at all."""
        offenders = []
        for base, _dirs, files in os.walk(UI):
            for name in files:
                if not name.endswith(".jsx"):
                    continue
                src = read(os.path.join(base, name))
                for m in re.finditer(r">([^<>{}\n]*[A-Za-zÁÉÍÓÚáéíóúñ]{2,}[^<>{}\n]*)<", src):
                    text = m.group(1).strip()
                    # single words that are markup-ish (keycaps, units) are not
                    # copy; a sentence has a space in it.
                    if not text or text in self.ALLOWED or " " not in text:
                        continue
                    offenders.append(f"{name}: {text[:48]}")
        self.assertEqual(offenders, [],
                         f"untranslatable copy in the JSX: {offenders[:5]}")
