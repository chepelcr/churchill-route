"""Actors are complete editable assets, not palettes attached to JS drawers.

The game/editor share ``actorShapes.js``.  ``actors.json`` owns ordered parts,
poses, variants, palette roles, height and every visual animation channel; the
renderer maps live simulation state into that finite interpreter.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

ACTORS_JSON = os.path.join(ROOT, "src", "assets", "actors.json")
PRODUCTS_JSON = os.path.join(ROOT, "content", "world", "products.json")
ENTITIES_JS = os.path.join(ROOT, "src", "render", "c2d", "entities.js")
ESTERO_JS = os.path.join(ROOT, "src", "render", "c2d", "estero.js")
INTERPRETER_JS = os.path.join(ROOT, "src", "render", "c2d", "actorShapes.js")
NPC_TYPES = os.path.join(ROOT, "src", "game", "npcTypes.json")

COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.,\s]+\)")
WAVES = {"sin", "cos", "abs-sin", "abs-cos", "saw", "triangle", "constant"}
FAMILY_VERBS = {
    "cycle-puffs", "boil-arcs", "swirl-flashes", "fish-flashes",
    "root-fan", "whirlpool-rings", "whirlpool-foam", "wake-rings",
}
PLACEMENTS = {"vehicle-mount", "pickup-bed", "cart-lid"}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def source(path):
    return re.sub(r"^\s*//.*$", "", read(path), flags=re.M)


def records(block):
    return {key: value for key, value in block.items() if not key.startswith("_")}


def data_only(value):
    """Remove human documentation before checking the executable data contract."""
    if isinstance(value, list):
        return [data_only(item) for item in value]
    if isinstance(value, dict):
        return {
            key: data_only(item)
            for key, item in value.items()
            if not key.startswith("_") and key != "note" and not key.endswith("Note")
        }
    return value


def walk_parts(parts):
    for part in parts:
        yield part
        if isinstance(part.get("parts"), list):
            yield from walk_parts(part["parts"])


class ActorRegistryTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(read(ACTORS_JSON))
        self.actors = records(self.data["actors"])
        self.forms = records(self.data["forms"])

    def resolve(self, actor_id, active=None):
        active = set() if active is None else active
        self.assertNotIn(actor_id, active, f"actor alias cycle at {actor_id}")
        actor = self.actors[actor_id]
        if not actor.get("sameAs"):
            return dict(actor)
        active.add(actor_id)
        base = self.resolve(actor["sameAs"], active)
        active.remove(actor_id)
        return {**base, **actor}

    def test_registry_is_the_full_v2_contract(self):
        self.assertEqual(self.data["version"], 2)
        self.assertGreaterEqual(len(self.forms), 29)
        for form_id, form in self.forms.items():
            with self.subTest(form=form_id):
                self.assertIsInstance(form.get("parts"), list)
                self.assertTrue(form["parts"])

    def test_not_one_colour_literal_is_left_in_the_actor_painter(self):
        found = set(COLOUR.findall(source(ENTITIES_JS)))
        self.assertEqual(found, set(), f"these colours belong in actors.json: {sorted(found)}")

    def test_every_npc_art_maps_to_a_resolvable_actor(self):
        types = json.loads(read(NPC_TYPES))["types"]
        for art in {record.get("art") for record in types if record.get("art")}:
            with self.subTest(art=art):
                actor_id = self.data["artMap"].get(art)
                self.assertIn(actor_id, self.actors)
                resolved = self.resolve(actor_id)
                self.assertIn(resolved.get("form"), self.forms)

    def test_every_visual_actor_has_form_height_and_valid_aliases(self):
        for actor_id, actor in self.actors.items():
            if actor_id in {"traffic", "car"}:
                continue
            with self.subTest(actor=actor_id):
                resolved = self.resolve(actor_id)
                self.assertIn(resolved.get("form"), self.forms)
                self.assertGreaterEqual(resolved.get("heightM", -1), 0)

    def test_animations_use_only_the_finite_wave_vocabulary(self):
        hosts = {f"forms.{key}": value for key, value in self.forms.items()}
        hosts.update({f"actors.{key}": value for key, value in self.actors.items()})
        found = 0
        for where, host in hosts.items():
            for channel, spec in host.get("animations", {}).items():
                found += 1
                with self.subTest(where=where, channel=channel):
                    self.assertIn(spec.get("wave", "sin"), WAVES)
                    self.assertTrue(isinstance(spec.get("rate", 1), (int, float)))
                    self.assertTrue(isinstance(spec.get("amplitude", 1), (int, float)))
        self.assertGreater(found, 12, "the visual motion did not migrate with the drawings")

    def test_procedural_forms_select_only_finite_family_verbs(self):
        used = set()
        for form in self.forms.values():
            for part in walk_parts(form["parts"]):
                if part.get("shape") == "family":
                    used.add(part.get("verb"))
        self.assertEqual(used, FAMILY_VERBS)
        interpreter = source(INTERPRETER_JS)
        for verb in used:
            self.assertIn(f'"{verb}"', interpreter)

    def test_no_executable_javascript_is_hidden_in_json(self):
        blob = json.dumps(data_only(self.data))
        for banned in ("Math.", "=>", "function(", "function ("):
            self.assertNotIn(banned, blob)

    def test_coins_and_cargo_name_reusable_forms(self):
        from churchill.world.enums.game import CoinType

        coins = records(self.data["coins"])
        coins.pop("shadow", None)
        self.assertEqual(set(coins), {coin.value for coin in CoinType})
        for coin in coins.values():
            self.assertIn(coin["form"], self.forms)
            for field in ("rim", "face", "mark", "r"):
                self.assertIn(field, coin)
        for cargo in records(self.data["cargo"]).values():
            self.assertIn(cargo["form"], self.forms)
            self.assertIn(cargo["placement"], PLACEMENTS)

    def test_every_product_cargo_names_a_reusable_contents_form(self):
        """The vehicle chooses the container; ``products.json`` chooses what
        appears inside it.  The renderer derives one actor form from the token,
        so every token must be a safe suffix and that form must exist."""
        products = json.loads(read(PRODUCTS_JSON))["products"]
        kinds = {product.get("cargo") for product in products.values()}
        self.assertEqual(kinds, {"cup", "box", "leaf"})
        for kind in kinds:
            with self.subTest(cargo=kind):
                self.assertRegex(kind, r"^[a-z][a-z0-9]*$")
                form = f"cargo{kind[0].upper()}{kind[1:]}"
                self.assertIn(form, self.forms,
                              f"products.json cargo {kind!r} has no {form} actor form")

    def test_carried_cargo_composes_container_and_product_contents(self):
        """One order draws twice at one resolved mount: first the container
        selected by ``vehicleCargo``, then the product form on top."""
        painter = source(ENTITIES_JS).split("function drawCarriedCargo(", 1)[1].split("\n}", 1)[0]
        self.assertIn("vehicleCargo(key)", painter)
        self.assertIn("cargoContentsForm(carrying.product)", painter)
        self.assertIn("paintActorForm(g, ACTORS, container.form", painter)
        self.assertIn("const { contents, ...containerFrame } = placed", painter)
        self.assertEqual(painter.count("paintActorForm(g, ACTORS,"), 2,
                         "carried cargo must paint one container and one contents form")

    def test_melt_ramps_and_hull_geometry_live_in_json(self):
        self.assertNotIn("oklch", source(ENTITIES_JS))
        self.assertIn('"model": "oklch"', read(ACTORS_JSON))
        self.assertIn(self.data["hull"]["form"], self.forms)
        hull_shapes = {part.get("shape") for part in walk_parts(self.forms[self.data["hull"]["form"]]["parts"])}
        self.assertIn("poly", hull_shapes)

    def test_entities_delegates_actor_identity_to_the_registry(self):
        painter = source(ENTITIES_JS).split("// THE VEHICLE SPRITE IS AN INTERPRETER NOW.", 1)[0]
        for forbidden in ("if (art ===", "switch (art", "fillRect(", "quadraticCurveTo("):
            self.assertNotIn(forbidden, painter)
        self.assertIn("ACTORS.artMap[art]", painter)
        self.assertIn("paintActor(ctx, ACTORS", painter)

    def test_estero_objects_delegate_their_silhouettes_and_motion(self):
        expected = {
            "esteroPanga", "esteroFish", "esteroGull", "esteroRoots",
            "esteroRemolino", "esteroPescadorBoat", "esteroYacht",
        }
        self.assertTrue(expected.issubset(self.actors))
        painter = source(ESTERO_JS)
        for actor_id in expected:
            self.assertIn(f'"{actor_id}"', painter)
        for forbidden in ("E.panga", "E.fish", "E.gulls", "E.roots", "E.remolino", "E.yate"):
            self.assertNotIn(forbidden, painter)
        self.assertEqual(set(COLOUR.findall(painter)), set())


if __name__ == "__main__":
    unittest.main()
