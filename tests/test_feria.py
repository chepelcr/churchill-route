"""LA FERIA — `src/render/c2d/feriaAssets.json`.

The campo ferial's twelve rides and three chinamos, as data. It was the LAST
catalog in the game with no validator: `docs/inventory.md` §12 flagged it as
"the template and the only one without a DTO/version", and the reason it matters
is the failure mode — `drawAttraction` warns ONCE to the console for a shape it
cannot draw and carries on drawing the rest of the ride. That is exactly right
at runtime and completely invisible in review: the wheel keeps turning, it just
has no gondolas.

The feria is also where the MOTION VERBS in this project come from. `spin`,
`bob`, `swing` and `pump` were animating rides from data since the campo shipped,
and `src/assets/effects.json` adopted the same four for vehicle parts in
2026-08-14 rather than inventing a second set — so this file's vocabulary is
checked against that one.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

FERIA = os.path.join(ROOT, "src", "render", "c2d", "feriaAssets.json")
ATTRACTIONS = os.path.join(ROOT, "src", "render", "c2d", "attractions.js")
EFFECTS = os.path.join(ROOT, "src", "assets", "effects.json")
CONTENT = os.path.join(ROOT, "content", "world", "attractions.json")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def shapes_used(node, out=None):
    out = set() if out is None else out
    if isinstance(node, dict):
        if "shape" in node:
            out.add(node["shape"])
        for v in node.values():
            shapes_used(v, out)
    elif isinstance(node, list):
        for v in node:
            shapes_used(v, out)
    return out


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(FERIA))
        self.rides = {k: v for k, v in self.doc.items() if not k.startswith("$")
                      and k != "version"}
        body = read(ATTRACTIONS).split("const SHAPES = {", 1)[1]
        self.impl = set(re.findall(r"^  (\w+)\(", body, re.M)) - {"drawFeriaGround"}

    def test_it_is_versioned(self):
        # It was the last catalog without one — a file the editor is meant to
        # write needs a version before its shape can ever change.
        self.assertEqual(self.doc["version"], 1)

    def test_every_shape_a_ride_names_is_implemented(self):
        """The invisible failure. A missing drawer costs the ride ONE PIECE and
        a single console warning; the wheel still turns, it just has no
        gondolas."""
        for name, ride in self.rides.items():
            for shape in shapes_used(ride):
                self.assertIn(shape, self.impl,
                              f"'{name}' names shape '{shape}', which nothing draws")

    def test_no_drawer_is_unreachable(self):
        """The other direction, and it is not empty: `tarp`, `banderines` and
        `neon` are implemented and no ride uses them. That is art with nothing
        to select it — the same thing `SignKind` deliberately allows, so this
        records the list rather than failing on it."""
        unused = self.impl - shapes_used(self.doc)
        self.assertEqual(unused, {"tarp", "banderines", "neon"},
                         f"the set of unused feria drawers changed: {sorted(unused)}. "
                         f"Either a ride started using one (delete it from here) or "
                         f"a new drawer landed with nothing selecting it.")

    def test_every_ride_has_a_name_and_parts(self):
        for name, ride in self.rides.items():
            self.assertTrue(ride.get("name"), f"'{name}' has no display name")
            self.assertTrue(ride.get("parts"), f"'{name}' draws nothing")

    def test_the_motion_verbs_are_the_shared_four(self):
        """One vocabulary, not two. `effects.json` adopted these for vehicle
        parts rather than inventing its own set."""
        verbs = {v for v in json.loads(read(EFFECTS))["partMotion"] if not v.startswith("_")}
        self.assertEqual(verbs, {"spin", "bob", "swing", "pump"})
        found = set()
        def walk(n):
            if isinstance(n, dict):
                found.update(verbs & set(n))
                for v in n.values():
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)
        walk(self.doc)
        self.assertTrue(found, "no ride in the feria animates at all")
        self.assertTrue(found <= verbs, f"the feria uses verbs nothing documents: {found - verbs}")

    def test_every_attraction_in_the_world_has_a_ride(self):
        """The join that actually matters: the world places `kind`s, this file
        draws them. A `kind` with no entry is an attraction standing in the
        campo with no art."""
        world = json.loads(read(CONTENT))
        for a in world["attractions"]:
            self.assertIn(a["kind"], self.rides,
                          f"attraction '{a['id']}' is a '{a['kind']}', which the "
                          f"feria catalog does not draw")

    def test_fractions_stay_fractions(self):
        """`r`, `spread` and `drop` are fractions of the ride's own radius;
        anything in absolute pixels carries a `Px` suffix. Mixing them is how a
        3 px detail becomes three times the size of the ride."""
        def walk(node, path):
            if isinstance(node, dict):
                for k, v in node.items():
                    if k in ("r", "spread", "drop") and isinstance(v, (int, float)):
                        self.assertLessEqual(abs(v), 3.0,
                                             f"{path}.{k} = {v} looks like pixels; "
                                             f"fractions of the radius are ~0..1 and "
                                             f"px fields end in `Px`")
                    walk(v, f"{path}.{k}")
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, f"{path}[{i}]")
        for name, ride in self.rides.items():
            walk(ride, name)
