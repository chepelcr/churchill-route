"""What the shape interpreter can actually draw, read from the shipped source.

Both art catalogs — `src/assets/vehicles.json` and `src/assets/world-props.json`
— are checked against this, so it lives in one place: a part naming a shape
nobody implements is SKIPPED at draw time, never thrown, which means the failure
ships as a vehicle missing a wheel or a landmark missing its roof.

Read as TEXT rather than imported, for the same reason `test_vocabulary.py` does
it: the question is what the shipped file says, and importing it would need a
bundler.
"""
import os
import re

from churchill.world.config import ROOT

SHAPES_JS = os.path.join(ROOT, "src", "render", "c2d", "shapes.js")
PATHS_JS = os.path.join(ROOT, "src", "render", "vehicleShapes.js")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _object_methods(text, const):
    """Method names of a `const NAME = { foo(a, b) { … } }` object literal."""
    body = text.split(f"{const} = {{", 1)[1]
    depth, i = 1, 0
    while depth and i < len(body):
        depth += {"{": 1, "}": -1}.get(body[i], 0)
        i += 1
    return set(re.findall(r"^  (\w+)\(", body[:i], re.M))


def implemented_shapes():
    """The union of everything a part may name.

    Four sources, because the interpreter is deliberately split: the path verbs
    BOTH backends share (`PATHS`, in vehicleShapes.js — those are the ones a
    silhouette may also be traced from), the Canvas-only ones (`EXTRA`), the
    GENERATORS (`scatter`, `orbit` — n copies placed by a rule the engine owns),
    and the cases the painter handles inline because they are not contours at
    all (`stripes` is a fill pattern, `label` is a pill, `repeat` is control
    flow).

    The generators are spread into `SHAPE_NAMES` rather than quoted there, so
    they have to be read from the object — a scan that only picked up the string
    literals would report them as unimplemented the first time a catalog used
    one.
    """
    shapes = _read(SHAPES_JS)
    names = _object_methods(_read(PATHS_JS), "PATHS")
    names |= _object_methods(shapes, "const EXTRA")
    names |= _object_methods(shapes, "const GENERATORS")
    listed = shapes.split("SHAPE_NAMES = Object.freeze([", 1)[1].split("]);", 1)[0]
    names |= set(re.findall(r'"(\w+)"', listed))
    return names
