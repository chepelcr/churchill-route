"""EL GARAJE as data, and the joins that have to hold.

`src/assets/vehicles.json` is the whole of a vehicle: how it drives, what it is
made of, what it costs, how it sounds and what it looks like. Before it, those
five things lived in four files that had to be edited together — the stats in
`game/vehicles.js`, the price in `economy.js`, the engine voice in `audio.js`,
and the art as a branch of a 90-line if/else chain in `c2d/entities.js`.

Four things can rot silently here, and every one of them is invisible in a
screenshot because the failure is something that is *not* drawn or *not*
reachable:

  * a part naming a `shape` the interpreter does not implement — it is skipped,
    so the vehicle simply loses a wheel;
  * a `{"ref": …}` naming a template that does not exist — same, but a whole run;
  * a medium with no free vehicle — `modes.js` falls back per medium, so this
    strands a player who owns no boat *inside the estero*;
  * a price for a key that is not a vehicle, which buys nothing.

The fifth thing — "does it still look the same" — a test cannot answer. That is
`tools/shot-vehicles.mjs` piped through `tools/png-diff.mjs`, and it is how this
migration was proved: 310 500 pixels, zero changed.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT
from churchill.world.enums import VehicleKind, VehicleMedium

REGISTRY = os.path.join(ROOT, "src", "assets", "vehicles.json")
ENTITIES = os.path.join(ROOT, "src", "render", "c2d", "entities.js")
SHAPES_JS = os.path.join(ROOT, "src", "render", "vehicleShapes.js")
LOADER = os.path.join(ROOT, "src", "game", "vehicles.js")
HEX = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$", re.I)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def implemented_shapes():
    """Every shape the two interpreters between them can draw.

    Read as TEXT rather than imported, for the same reason `test_vocabulary.py`
    does it: the question is what the shipped file says, and importing it would
    need a bundler.
    """
    art, trace = read(ENTITIES), read(SHAPES_JS)
    names = set()
    # `PATHS = { rect(g, …) {`, `VEHICLE_SHAPES = { …, ellipse(g, …) {`
    for text, const in ((trace, "PATHS"), (art, "VEHICLE_SHAPES")):
        body = text.split(f"{const} = {{", 1)[1]
        names |= set(re.findall(r"^  (\w+)\(", body, re.M))
    # …plus the ones the painter handles inline, because they are not contours
    names |= set(re.findall(r'part\.shape === "(\w+)"', art))
    return names


class VehicleRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(REGISTRY))
        self.vehicles = self.doc["vehicles"]
        self.templates = self.doc["templates"]
        self.shapes = implemented_shapes()

    def parts_of(self, rec):
        """A vehicle's parts with every `ref` spliced in — the same flatten
        `vehicleParts` does, so the test walks what the renderer walks."""
        listed = rec.get("parts") or [{"ref": r} for r in
                                      self.doc["defaults"][rec["kind"]]]
        out = []
        for part in listed:
            if "ref" in part:
                out.extend(self.templates[part["ref"]])
            else:
                out.append(part)
        return out

    def test_every_ref_names_a_template(self):
        for key, rec in self.vehicles.items():
            for part in rec.get("parts", []):
                if "ref" in part:
                    self.assertIn(part["ref"], self.templates,
                                  f"{key} splices '{part['ref']}', which is not a template")
        for kind, refs in self.doc["defaults"].items():
            if kind.startswith("_"):
                continue
            for ref in refs:
                self.assertIn(ref, self.templates,
                              f"the {kind} fallback splices '{ref}', which is not a template")

    def test_every_part_names_a_shape_the_interpreter_implements(self):
        # An unknown shape is SKIPPED, not thrown — so this failure ships as a
        # vehicle quietly missing a wheel.
        for key, rec in self.vehicles.items():
            for part in self.parts_of(rec):
                self.assertIn(part["shape"], self.shapes,
                              f"{key} wants shape '{part['shape']}', which no "
                              f"interpreter implements ({sorted(self.shapes)})")

    def test_every_kind_has_a_fallback_run(self):
        # `editorContent.js` writes editor-authored vehicles into VEHICLES with
        # no art at all. Before the migration they reached the `else` at the end
        # of each paint branch; `defaults` is that same answer written down.
        for kind in VehicleKind:
            self.assertIn(kind.value, self.doc["defaults"],
                          f"a vehicle of kind {kind.value} with no parts would draw nothing")

    def test_every_vehicle_uses_the_vocabulary(self):
        kinds = {k.value for k in VehicleKind}
        media = {m.value for m in VehicleMedium}
        for key, rec in self.vehicles.items():
            self.assertIn(rec["kind"], kinds, f"{key} has an unknown kind")
            self.assertIn(rec["medium"], media, f"{key} has an unknown medium")

    def test_every_medium_has_a_free_vehicle(self):
        """The one that strands a player rather than merely looking wrong.

        `resolveVehicle` falls back to the first FREE vehicle of the medium a
        run demands. With none, a player who has bought no boat starts the
        Travesía on whatever `undefined` resolves to — historically a moped, in
        the middle of the estero, inside a wall.
        """
        free = {rec["medium"] for rec in self.vehicles.values() if rec.get("free")}
        for medium in VehicleMedium:
            self.assertIn(medium.value, free,
                          f"no free vehicle for medium {medium.value}")

    def test_every_price_belongs_to_a_vehicle_and_no_free_one_has_one(self):
        for key, rec in self.vehicles.items():
            if rec.get("free"):
                self.assertNotIn("price", rec, f"{key} is free and also priced")
            else:
                self.assertGreater(rec.get("price", 0), 0,
                                   f"{key} is neither free nor purchasable")

    def test_every_vehicle_is_drivable_and_drawable(self):
        for key, rec in self.vehicles.items():
            for field in ("accel", "top", "turn", "grip"):
                self.assertGreater(rec["stats"][field], 0, f"{key} has no {field}")
            self.assertGreater(rec["w"], 0, f"{key} has no width")
            self.assertGreater(rec["h"], 0, f"{key} has no height")
            for field in ("color", "roof"):
                self.assertRegex(rec[field], HEX, f"{key} {field}")

    def test_the_colour_placeholders_resolve(self):
        # `$color`/`$roof` are the only two the resolver knows; anything else
        # starting with `$` would be painted as the literal string, which
        # Canvas silently treats as transparent black.
        known = {"$color", "$roof"}
        for key, rec in self.vehicles.items():
            for part in self.parts_of(rec):
                for spec in [part.get("fill"), part.get("stroke"), *part.get("palette", [])]:
                    if isinstance(spec, str) and spec.startswith("$"):
                        self.assertIn(spec, known, f"{key}: unknown placeholder {spec}")
                    elif isinstance(spec, str):
                        self.assertRegex(spec, HEX, f"{key}: bad colour {spec}")

    def test_every_vehicle_casts_a_shadow(self):
        # A vehicle with no silhouette part is drawn with NO ground shadow, and
        # nothing else in the game would report it.
        for key, rec in self.vehicles.items():
            self.assertTrue(any(p.get("silhouette") for p in self.parts_of(rec)),
                            f"{key} has no part in its silhouette — it would cast no shadow")

    def test_the_catalog_is_the_only_authority(self):
        # The four files that used to hold a piece of a vehicle must not grow
        # their own copy back. Each of these was a real table here before.
        economy = read(os.path.join(ROOT, "src", "game", "economy.js"))
        audio = read(os.path.join(ROOT, "src", "game", "audio.js"))
        self.assertNotIn("export const VEHICLE_PRICES = {", economy,
                         "economy.js is authoring prices again; vehicles.json owns them")
        self.assertNotIn("export const FREE_VEHICLES = [", economy,
                         "economy.js is authoring the free list again")
        self.assertNotIn("const ENGINE_VOICES = {", audio,
                         "audio.js is authoring engine voices again")
        loader = read(LOADER)
        self.assertIn('vehicles.json" with { type: "json" }', loader,
                      "the loader must keep the import attribute — plain Node "
                      "(tools/gen-inventory.mjs) refuses a bare JSON import")
