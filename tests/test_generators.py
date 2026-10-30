"""LOS VERBOS GENERADORES — `scatter`, `orbit`, `arcs` en `c2d/shapes.js`.

They exist so an ALGORITHMIC drawing can be a parts list. A tuna boil is 22 fish
on a position hash and seven broken arcs; writing that as data leaves two
options, and only one of them is honest:

  * a loop-and-arithmetic language in JSON — a worse language than the JS it
    replaces, and exactly the line `docs/inventory.md` §12 draws between an
    asset and a Canvas command stream;
  * a verb the ENGINE implements and the catalog invokes with parameters.

The feria settled that argument long before this, with `bulbs` and `spokes`.
These are the general form, and the tests below are the three properties that
make them safe to build catalogs on.
"""
import os
import re
import sys
import unittest

from churchill.world.config import ROOT

sys.path.insert(0, os.path.join(ROOT, "tests"))
from shapevocab import implemented_shapes  # noqa: E402

SHAPES_JS = os.path.join(ROOT, "src", "render", "c2d", "shapes.js")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def code(path):
    """Source with comments stripped — the note above GENERATORS explains WHY a
    `Math.random()` there would be fatal, and a scan that reads prose would
    call that explanation the offence."""
    src = read(path)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


class GeneratorTests(unittest.TestCase):
    def setUp(self):
        self.js = code(SHAPES_JS)
        self.body = self.js.split("const GENERATORS = {", 1)[1].split("\n};", 1)[0]
        self.scatter = self.js.split("export function scatterPlacements", 1)[1].split(
            "const GENERATORS = {", 1)[0]

    def test_all_three_are_reachable_from_a_catalog(self):
        """`SHAPE_NAMES` is the list every catalog is validated against. A verb
        missing from it is one a part may not name — the check `test_world_props`
        runs would call it unimplemented."""
        names = implemented_shapes()
        for verb in ("scatter", "orbit", "arcs"):
            self.assertIn(verb, names, f"`{verb}` is not in the shape vocabulary")

    def test_the_hash_is_the_shared_one(self):
        """THE PROPERTY EVERYTHING ELSE RESTS ON. `hash01` is what `flora.js`
        plants trees with, so a fish is in the same place every frame. A
        `Math.random()` here would make the shoal boil — and would make every art
        sheet un-diffable, which is how this repo proves art changes at all.
        """
        self.assertIn("hash01", self.body)
        self.assertNotIn("Math.random", self.js,
                         "the interpreter must never roll dice — the sheets "
                         "would stop being comparable")

    def test_turns_not_radians(self):
        # A power-of-two turn times TAU is exact in binary floating point, so a
        # catalog holds no irrational literal. Same rule `polyN`'s `rot` follows.
        self.assertIn("TAU", self.body)
        self.assertNotRegex(self.body, r"Math\.PI\s*\*\s*2",
                            "use TAU; the file already defines it")

    def test_scatter_spreads_evenly_over_the_area(self):
        """`sqrt` of the radial hash. Without it every copy piles toward the
        centre, because a uniform radius is not a uniform AREA — it reads as a
        clump rather than a shoal, and that is the whole point of the verb."""
        self.assertIn("Math.sqrt", self.scatter)

    def test_box_scatter_keeps_clearings_inside_the_lot(self):
        """A parcel garden pushes trees out of its centre, then drops a tree if
        that push crosses the declared local bounds. The tree silhouette remains
        in flora.js; this is only the reusable placement rule."""
        for token in ('layout === "box"', "clear", "boundX", "boundY", "continue"):
            self.assertIn(token, self.scatter)

    def test_a_generator_draws_its_copies_in_their_own_frame(self):
        """A sub-list is written ONCE about its own origin and the verb puts each
        copy where it goes. If the copies inherited the parent's anchor instead,
        every one would be drawn at the same place plus an offset — which looks
        right for `repeat` on a line and wrong for anything rotated."""
        painter = self.js.split('case "scatter":', 1)[1].split("break;", 1)[0]
        self.assertIn("g.save()", painter)
        self.assertIn("g.restore()", painter)
        self.assertIn("rawX(str(v)) - rawX(0)", painter,
                      "the copy's frame must be relative to itself")

    def test_the_clock_reaches_them(self):
        # `orbit` may turn and `arcs` may breathe, so both need the frame's `t`.
        self.assertIn("frame.t", self.js)
