"""LA FLORA V2: recipes in JSON, finite geometry in one shared interpreter.

Every authored colour, layer and silhouette knob belongs to flora.json. The
game and editor both import floraShapes.js; neither keeps a pine, cypress,
cherry, palm or mangrove drawing of its own. Placement, seeds, tide and world
clipping remain engine state.
"""
import ast
import json
import os
import re
import subprocess
import unittest

from churchill.world.config import ROOT

FLORA = os.path.join(ROOT, "src", "assets", "flora.json")
FLORA_JS = os.path.join(ROOT, "src", "render", "c2d", "flora.js")
FLORA_SHAPES = os.path.join(ROOT, "src", "render", "c2d", "floraShapes.js")
GROUND_JS = os.path.join(ROOT, "src", "render", "c2d", "ground.js")
WOODS_PY = os.path.join(ROOT, "churchill", "world", "service", "woods.py")
HEX = re.compile(r"^#[0-9a-f]{6}$", re.I)
RGB = re.compile(r"^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def code(path):
    text = re.sub(r"/\*.*?\*/", "", read(path), flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def data_values(value):
    """Yield authored values, excluding prose keys that may name JS syntax."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key.startswith("_") or key in {"note"}:
                continue
            yield from data_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from data_values(child)
    else:
        yield value


class FloraRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        module = os.path.abspath(FLORA_SHAPES).replace("\\", "\\\\")
        script = (
            f'import {{ FLORA_GENERATOR_NAMES as n, FLORA_GENERATOR_CONTRACTS as c, '
            f'FLORA_ROOT_ARCHITECTURES as r }} from "file://{module}"; '
            f'console.log(JSON.stringify({{n,c,r}}));'
        )
        exported = json.loads(subprocess.check_output(
            ["node", "--input-type=module", "-e", script], cwd=ROOT, text=True))
        cls.generators = set(exported["n"])
        cls.contracts = exported["c"]
        cls.root_architectures = exported["r"]

    def setUp(self):
        self.doc = json.loads(read(FLORA))
        self.forms = {k: v for k, v in self.doc["forms"].items()
                      if not k.startswith("_")}
        self.species = {k: v for k, v in self.doc["species"].items()
                        if not k.startswith("_")}
        self.mixes = {k: v for k, v in self.doc["mixes"].items()
                      if not k.startswith("_")}

    def test_the_registry_is_v2_and_every_form_names_a_real_generator(self):
        self.assertEqual(self.doc["version"], 2)
        self.assertGreaterEqual(len(self.forms), 12)
        for name, form in self.forms.items():
            self.assertIn(form.get("generator"), self.generators,
                          f"{name} names an engine generator that does not exist")

    def test_generator_contract_and_form_are_the_same_schema(self):
        """A form cannot claim a dead override or omit a block its painter reads."""
        for name, form in self.forms.items():
            contract = self.contracts[form["generator"]]
            self.assertEqual(form.get("paletteRoles"), contract["paletteRoles"],
                             f"{name}'s palette roles drifted from its painter")
            self.assertEqual(form.get("overrides"), contract["overrides"],
                             f"{name} exposes an override its painter does not read")
            for field in contract["fields"]:
                self.assertIsInstance(form.get(field), dict,
                                      f"{name} is missing recipe block {field}")

    def test_species_only_carry_fields_their_form_consumes(self):
        base = {
            "commonName", "scientificName", "kind", "origin", "occurrence",
            "habitats", "sourceRefs", "form", "r", "trunkH", "heightM", "note",
        }
        for name, species in self.species.items():
            self.assertIn(species.get("form"), self.forms)
            form = self.forms[species["form"]]
            allowed = base | set(form["paletteRoles"]) | set(form["overrides"])
            self.assertEqual(set(species) - allowed, set(),
                             f"{name} has dead/unrecognised authored fields")

    def test_every_species_has_physical_height_and_drawable_proportions(self):
        for name, species in self.species.items():
            self.assertGreater(species["r"], 0, f"{name} has no crown radius")
            self.assertGreater(species["heightM"], 0, f"{name} has no physical height")
            self.assertGreaterEqual(species["trunkH"], 0)
            generator = self.forms[species["form"]]["generator"]
            if generator != "tidal-root-crown":
                self.assertGreater(species["trunkH"], 0, f"{name} has no trunk")

    def test_botanical_identity_is_controlled_and_sourced(self):
        vocabulary = self.doc["vocabulary"]
        sources = self.doc["sources"]
        self.assertEqual(vocabulary["rootArchitectures"], self.root_architectures)
        for name, species in self.species.items():
            self.assertIn(species["kind"], vocabulary["kinds"])
            self.assertIn(species["origin"], vocabulary["origins"])
            self.assertIn(species["occurrence"], vocabulary["occurrences"])
            self.assertTrue(species["commonName"])
            self.assertTrue(species["habitats"])
            for habitat in species["habitats"]:
                self.assertIn(habitat, vocabulary["habitats"], f"{name}.{habitat}")
            for source in species["sourceRefs"]:
                self.assertIn(source, sources, f"{name}.{source}")
            if species["kind"] == "taxon":
                self.assertIsInstance(species["scientificName"], str)
                self.assertTrue(species["scientificName"].strip())
                self.assertTrue(species["sourceRefs"])
            else:
                self.assertIsNone(species["scientificName"])

    def test_wire_defaults_are_data_and_resolve_to_catalog_records(self):
        defaults = self.doc["defaults"]
        self.assertIn(defaults["treeSpecies"], self.species)
        self.assertIn(defaults["palmSpecies"], self.species)
        self.assertIn(defaults["mangroveMix"], self.doc["mangroveMixes"])
        flora_code = code(FLORA_JS)
        ground_code = code(GROUND_JS)
        self.assertIn("FLORA.defaults.treeSpecies", flora_code)
        self.assertIn("FLORA.defaults.palmSpecies", flora_code)
        self.assertIn("FLORA.defaults.mangroveMix", ground_code)

    def test_local_occurrence_does_not_masquerade_as_native(self):
        self.assertEqual(self.species["almendro"]["occurrence"], "observed_local")
        self.assertEqual(self.species["almendro"]["origin"], "introduced")
        self.assertEqual(self.species["cana_fistula"]["origin"], "introduced")
        self.assertEqual(self.species["palma_abanico"]["origin"], "introduced")
        self.assertEqual(self.species["cedro_amargo"]["origin"], "native")

    def test_exact_route_evidence_is_attached_to_the_native_records_it_supports(self):
        """Do not let a generic Costa Rica citation replace Puntarenas evidence."""
        mata = "mata_limon_mangrove_2022"
        tivives = "tivives_coastal_dry_forest_2018"
        self.assertIn(mata, self.doc["sources"])
        self.assertIn(tivives, self.doc["sources"])
        for name in ("guanacaste", "roble_sabana", "cedro_amargo", "indio_desnudo"):
            self.assertEqual(self.species[name]["occurrence"], "observed_local", name)
            self.assertIn(mata, self.species[name]["sourceRefs"], name)
        for name in ("cedro_amargo", "indio_desnudo", "tempisque", "seco"):
            self.assertIn(tivives, self.species[name]["sourceRefs"], name)
        self.assertIn(mata, self.doc["mangroveMixes"]["channel_edge"]["sourceRefs"])

    def test_native_wood_mixes_exclude_introduced_and_unresolved_assets(self):
        allowed = {"native", "not_applicable"}
        for mix_name, mix in self.mixes.items():
            for species_name, _ in mix["weights"]:
                self.assertIn(
                    self.species[species_name]["origin"], allowed,
                    f"{mix_name} is an ecological mix but plants {species_name}",
                )
        planted = {name for mix in self.mixes.values() for name, _ in mix["weights"]}
        self.assertNotIn("pino", planted)
        self.assertNotIn("cipres", planted)
        self.assertNotIn("cerezo", planted)
        self.assertIn("roble_sabana", planted)

    def test_every_palette_role_has_the_format_its_generator_consumes(self):
        for name, species in self.species.items():
            for role in self.forms[species["form"]]["paletteRoles"]:
                value = species.get(role)
                if role == "canopy":
                    self.assertGreaterEqual(len(value or []), 3,
                                            f"{name}: canopy needs dark/mid/highlight")
                    for colour in value:
                        self.assertRegex(colour, HEX)
                elif role == "trunk":
                    self.assertRegex(value or "", HEX)
                else:
                    match = RGB.fullmatch(str(value or ""))
                    self.assertIsNotNone(match, f"{name}.{role} is not r,g,b")
                    self.assertTrue(all(0 <= int(channel) <= 255 for channel in match.groups()))

    def test_recipes_are_data_not_executable_strings(self):
        for value in data_values(self.doc):
            if isinstance(value, str):
                for banned in ("Math.", "=>", "function(", "function ("):
                    self.assertNotIn(banned, value)

    def test_recipe_ranges_are_safe_for_the_canvas_interpreter(self):
        def walk(value, path="forms"):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key.startswith("_") or key == "note":
                        continue
                    if key == "points":
                        self.assertIsInstance(child, int, path)
                        self.assertTrue(5 <= child <= 32, path)
                    if "wobble" in key.lower() and isinstance(child, (int, float)):
                        self.assertTrue(0 <= child <= 0.75, path)
                    if "alpha" in key.lower() and isinstance(child, (int, float)):
                        self.assertTrue(0 <= child <= 1, path)
                    walk(child, f"{path}.{key}")
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    walk(child, f"{path}[{index}]")
        walk(self.forms)

    def test_tidal_forms_name_a_real_root_architecture(self):
        for name, form in self.forms.items():
            if form["generator"] != "tidal-root-crown":
                continue
            self.assertIn(form["roots"]["architecture"], self.root_architectures, name)

    def test_conifer_and_column_own_each_visible_layer_in_json(self):
        for form_name, block_name in (("conifer", "tiers"), ("column", "column")):
            block = self.forms[form_name][block_name]
            self.assertGreaterEqual(len(block["layers"]), 7)
            for layer in block["layers"]:
                for field in (
                        "xR", "yR", "radiusR", "scaleX", "scaleY",
                        "tone", "wobble", "points", "seedOffset"):
                    self.assertIn(field, layer, f"{form_name} layer hides {field} in code")
            for derived in ("count", "spanR", "taper", "steps", "heightR", "toneStart"):
                self.assertNotIn(derived, block, f"{form_name} still derives layers in the engine")

    def test_interpreter_and_placement_have_no_authored_colour_literals(self):
        """Geometry code may compose colours from JSON; it may not own one."""
        for path in (FLORA_SHAPES, FLORA_JS):
            source = code(path)
            self.assertNotRegex(source, r"#[0-9a-fA-F]{3,8}")
            self.assertNotRegex(source, r"rgba?\(\s*\d")

    def test_game_delegates_every_plant_silhouette_to_the_shared_interpreter(self):
        flora = code(FLORA_JS)
        ground = code(GROUND_JS)
        for old in ("paintBroadleaf", "paintConifer", "paintColumn", "paintBare"):
            self.assertNotIn(old, flora)
        self.assertIn("paintFloraSpecies", flora)
        self.assertIn("paintFloraSpecies", ground)
        self.assertIn("FLORA.mangroveMixes[FLORA.defaults.mangroveMix]", ground)
        self.assertNotIn("FLORA.species.mangle", ground)
        self.assertNotRegex(ground.split("function paintMangrove", 1)[1].split("}", 1)[0],
                            r"#[0-9a-fA-F]{3,8}|rgba?\(\s*\d")

    def test_interpreter_never_branches_on_a_species_identity(self):
        source = code(FLORA_SHAPES)
        for species_name in self.species:
            self.assertNotIn(f'"{species_name}"', source)

    def test_every_mix_names_species_that_exist_and_has_a_floor(self):
        for mix_name, mix in self.mixes.items():
            self.assertGreater(mix["d"], 0, f"{mix_name} has no density")
            self.assertTrue(mix["weights"], f"{mix_name} plants nothing")
            self.assertRegex(mix.get("floor", ""),
                             r"^rgba?\([\d.,\s]+\)$", f"{mix_name} has no floor ink")
            for name, weight in mix["weights"]:
                self.assertIn(name, self.species)
                self.assertGreater(weight, 0)

    def test_mangrove_zones_only_name_tidal_native_taxa(self):
        zones = {k: v for k, v in self.doc["mangroveMixes"].items()
                 if not k.startswith("_")}
        self.assertEqual(set(zones), {"channel_edge", "interior"})
        for zone_name, zone in zones.items():
            self.assertTrue(zone["sourceRefs"])
            for name, weight in zone["weights"]:
                self.assertGreater(weight, 0)
                self.assertEqual(self.species[name]["origin"], "native")
                form = self.forms[self.species[name]["form"]]
                self.assertEqual(form["generator"], "tidal-root-crown", zone_name)
        channel = {name for name, _ in zones["channel_edge"]["weights"]}
        self.assertIn("mangle_rojo_caballero", channel)
        self.assertIn("mangle_pinuela", channel)

    def test_the_builder_only_names_mixes_the_registry_has(self):
        used = set(re.findall(r'mix = "(\w+)"', read(WOODS_PY)))
        self.assertTrue(used)
        for name in used:
            self.assertIn(name, self.mixes)

    def test_every_planting_names_species_that_exist(self):
        plantings = {k: v for k, v in self.doc["plantings"].items()
                     if not k.startswith("_")}
        self.assertTrue(plantings)
        for name, mix in plantings.items():
            for species_name, weight in mix["weights"]:
                self.assertIn(species_name, self.species,
                              f"planting {name} plants missing {species_name}")
                self.assertGreater(weight, 0)

    def test_the_builder_only_names_plantings_the_registry_has(self):
        build_stage = read(os.path.join(ROOT, "churchill", "world", "pipeline", "build_stage.py"))
        tree = ast.parse(build_stage)
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == "_plant"]
        used = {node.args[4].value for node in calls if len(node.args) > 4
                and isinstance(node.args[4], ast.Constant)
                and isinstance(node.args[4].value, str)}
        self.assertTrue(used)
        for name in used:
            self.assertIn(name, self.doc["plantings"])
        for run_id, run in self.doc["plantingRuns"].items():
            if run_id.startswith("_"):
                continue
            self.assertIn(run["mix"], self.doc["plantings"],
                          f"derived run {run_id} names a missing planting mix")


if __name__ == "__main__":
    unittest.main()
