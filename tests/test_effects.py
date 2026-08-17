"""EL REPERTORIO DE EFECTOS — `src/assets/effects.json` and its painters.

A vehicle used to be a shape and nothing else. What it DID — the wake astern,
the swirls off a hard turn, the shadow it throws, the way a hull heels into a
bend, the wind at speed — was welded into `drawPlayer` as `if (afloat)`, so an
editor-authored boat got a car's treatment and there was no way to say
otherwise. The effects are a repository now: the ALGORITHM stays in the
renderer, the SELECTION and every number belong to the vehicle.

That split only holds if three things are checked, and none of them is visible
in review:

  * **an effect a vehicle names must have a painter.** Otherwise it silently
    does nothing — the exact failure `PierStyle` shipped for a week (four
    `malecon` piers falling through to `concrete`).
  * **a painter must be in the registry.** Art with no value to select it is
    drift too, which is why `SignKind` deliberately holds ten kinds when the
    build emits six.
  * **every parameter a painter READS must be defined.** A missing one is
    `undefined`, which in this arithmetic is `NaN`, which draws nothing at all —
    no error, no warning, and a pixel diff of an animated effect is noise, so
    nothing else would catch it.

The paint ORDER is asserted too. It is the registry's key order, not each
vehicle's, and it is load-bearing: the swirls and the wash go down first and the
shadow lies over them.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

EFFECTS = os.path.join(ROOT, "src", "assets", "effects.json")
VEHICLES = os.path.join(ROOT, "src", "assets", "vehicles.json")
ENTITIES = os.path.join(ROOT, "src", "render", "c2d", "entities.js")
CANVAS2D = os.path.join(ROOT, "src", "render", "canvas2d.js")
SHAPES = os.path.join(ROOT, "src", "render", "c2d", "shapes.js")

#: Where each effect's painter lives, and the marker its body starts at. The
#: scan is scoped per painter rather than run over the whole file on purpose:
#: `drawArcadeCoin(c, t)` also names its argument `c`, and a blanket sweep for
#: `c.<name>` would demand the coin's `palette` be an effect parameter.
PAINTERS = {
    "turnWind": (ENTITIES, "function drawTurnWind(", "\n}"),
    "wake": (ENTITIES, "function drawWake(", "\n}"),
    "shadow": (ENTITIES, "  shadow: {", "\n  },"),
    "heel": (ENTITIES, "  heel: {", "\n  },"),
    "speedLines": (CANVAS2D, "if (id !== \"speedLines\"", "\n  }"),
    # Los faros son DOS pintores porque los usan tres cosas distintas: el
    # jugador por la vía de efectos, y el tráfico y las lanchas llamando
    # directo — un carro del tráfico no tiene registro de vehículo del que
    # escoger un efecto, y aun así tiene que alumbrar.
    "headlights": (ENTITIES, "export function paintHeadlights(", "\n}"),
}

#: Params whose name ends in `Note` are prose for whoever opens the file, and
#: the `_`-prefixed keys are the file's own commentary. Neither is read.
def is_param(name):
    return not name.startswith("_") and not name.endswith("Note")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def code(path):
    """Source with comments stripped.

    These files DOCUMENT what they replaced — the comment where
    `DELIVERY_BAG_MOUNTS` used to stand names it, and the note above
    `paintVehicle` quotes the `key === "tuktuk"` chain it deleted. That history
    is the most useful thing in the file and a scan that reads it as a relapse
    would push somebody to delete it."""
    src = read(path)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def body(effect_id):
    path, start, end = PAINTERS[effect_id]
    src = read(path)
    i = src.index(start)
    j = src.index(end, i + len(start))
    return src[i:j]


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.reg = json.loads(read(EFFECTS))
        self.veh = json.loads(read(VEHICLES))["vehicles"]
        self.effects = {k: v for k, v in self.reg["vehicle"].items() if not k.startswith("_")}

    def test_every_effect_a_vehicle_names_exists(self):
        for key, v in self.veh.items():
            for eid in (v.get("effects") or {}):
                self.assertIn(eid, self.effects,
                              f"vehicle '{key}' asks for effect '{eid}', which the "
                              f"repository does not have — it would silently do nothing")

    def test_every_effect_has_a_painter(self):
        for eid in self.effects:
            self.assertIn(eid, PAINTERS,
                          f"effect '{eid}' is offered but no painter implements it; "
                          f"selecting it in the editor would change nothing")

    def test_every_painter_is_offered(self):
        for eid in PAINTERS:
            self.assertIn(eid, self.effects,
                          f"'{eid}' is implemented but not in the repository — art "
                          f"with nothing to select it is drift too")

    def test_every_parameter_a_painter_reads_is_defined(self):
        """The one that cannot be seen in review or in a pixel diff.

        A parameter the painter reads and the registry does not define is
        `undefined`; every use here is arithmetic, so it becomes `NaN` and the
        effect draws NOTHING — no error, no warning.
        """
        for eid, effect in self.effects.items():
            params = {k for k in (effect.get("params") or {}) if is_param(k)}
            used = set(re.findall(r"\b(?:c|cfg)\.([A-Za-z_]\w*)", body(eid)))
            missing = used - params
            self.assertEqual(missing, set(),
                             f"effect '{eid}' reads {sorted(missing)}, which its "
                             f"`params` do not define — they resolve to NaN")

    def test_no_parameter_is_dead(self):
        # The other direction: a knob in the editor that moves nothing is a lie
        # to whoever turns it.
        for eid, effect in self.effects.items():
            params = {k for k in (effect.get("params") or {}) if is_param(k)}
            used = set(re.findall(r"\b(?:c|cfg)\.([A-Za-z_]\w*)", body(eid)))
            dead = params - used
            self.assertEqual(dead, set(),
                             f"effect '{eid}' offers {sorted(dead)}, which its painter "
                             f"never reads — a knob that moves nothing")

    def test_the_paint_order_is_the_registrys(self):
        """Swirls and wash first, the shadow over them — as shipped.

        A vehicle's `effects` map is a SELECTION, not a z-order, so this order
        has to live in one place. `vehicleEffects` walks the registry.
        """
        order = [k for k in self.reg["vehicle"] if not k.startswith("_")]
        under = [k for k in order if self.effects[k].get("layer") == "under"]
        self.assertLess(under.index("turnWind"), under.index("shadow"))
        self.assertLess(under.index("wake"), under.index("shadow"))

    def test_the_media_still_make_sense(self):
        # A `medium` on an effect is advisory — nothing enforces it at runtime —
        # so this is the enforcement: a hull should not be throwing tyre swirls.
        for key, v in self.veh.items():
            for eid in (v.get("effects") or {}):
                media = self.effects[eid].get("medium")
                if not media:
                    continue
                self.assertIn(v["medium"], media,
                              f"'{key}' is a {v['medium']} vehicle carrying '{eid}', "
                              f"which is for {media}")

    def test_every_vehicle_has_a_shadow(self):
        # Not decoration: without one a vehicle floats with nothing under it,
        # and the shipped game gave every vehicle a shadow unconditionally.
        for key, v in self.veh.items():
            self.assertIn("shadow", v.get("effects") or {},
                          f"'{key}' throws no shadow")


class CargoTests(unittest.TestCase):
    def setUp(self):
        self.reg = json.loads(read(EFFECTS))["cargo"]
        self.veh = json.loads(read(VEHICLES))["vehicles"]
        self.entities = code(ENTITIES)

    def test_every_cargo_style_a_vehicle_uses_is_implemented(self):
        styles = set(re.findall(r"^  (\w+): \(g, mount, veh, carrying\)",
                                self.entities.split("const CARGO_STYLES = {", 1)[1], re.M))
        self.assertTrue(styles, "CARGO_STYLES no longer parses")
        for key, v in self.veh.items():
            style = (v.get("cargo") or {}).get("style")
            if style is None:
                continue
            self.assertIn(style, self.reg, f"'{key}' carries an unknown cargo '{style}'")
            self.assertIn(style, styles, f"cargo style '{style}' has no drawer")

    def test_the_renderer_no_longer_knows_a_vehicle_by_name(self):
        """`DELIVERY_BAG_MOUNTS` and the key dispatch were the last of it.

        Four per-vehicle mount points sat in the renderer while every other
        per-vehicle fact had moved to `vehicles.json`, and `drawCarriedCargo`
        branched on `key === "pickup"`.
        """
        # the DECLARATION, not the word — the comment where it used to stand
        # still names it, and that history is the point of the comment.
        self.assertNotRegex(self.entities, r"const DELIVERY_BAG_MOUNTS\s*=")
        self.assertNotRegex(self.entities, r'key === "\w+"',
                            "the cargo dispatch is branching on a vehicle key again")

    def test_the_fallback_style_exists(self):
        self.assertIn(self.reg["_fallback"], self.reg,
                      "the fallback cargo names a style the registry does not have")


class PartMotionTests(unittest.TestCase):
    """The verbs a single part may carry — the feria's, shared."""

    def setUp(self):
        self.reg = json.loads(read(EFFECTS))["partMotion"]
        self.shapes = read(SHAPES)

    def test_every_documented_verb_is_interpreted(self):
        for verb in (v for v in self.reg if not v.startswith("_")):
            self.assertRegex(self.shapes, rf"part\.{verb}\b",
                             f"`{verb}` is documented as a part motion but "
                             f"shapes.js never reads it")

    def test_turns_not_radians(self):
        # A power-of-two turn times TAU is exact in binary floating point; a
        # catalog holding `0.7853981633974483` is a rounding of a quarter turn.
        self.assertIn("TAU", self.shapes)
        self.assertIn("turns", self.reg["_units"].lower())

    def test_motion_is_free_for_a_part_that_has_none(self):
        # Every existing catalog draws pixel for pixel as before BECAUSE a part
        # with no motion takes no save/restore. If this becomes unconditional,
        # the four art sheets are no longer proof of anything.
        self.assertIn("if (moved) {", self.shapes)
        self.assertIn("if (moved) g.restore();", self.shapes)


class SunShadowRegistry(unittest.TestCase):
    """LA SOMBRA SIGUE AL SOL, y sus números viven acá.

    Antes eran **19 desplazamientos fijos** en cuatro archivos —cada peatón, los
    barcos, la boya, el banco, la caseta, el ferry, la placa de un hito y todo
    edificio con `ctx.translate(4, 4)`— y ninguno sabía qué hora era.
    """

    def setUp(self):
        self.doc = json.loads(read(EFFECTS))
        self.sun = self.doc["sunShadow"]
        self.heights = self.doc["buildingHeight"]

    def test_the_reach_is_in_multiples_of_height(self):
        """Es lo que hace el 2.5D: sin altura, un peatón y una bodega tiran la
        misma sombra y la escena se aplana."""
        self.assertLess(self.sun["reachAtNoon"], self.sun["reachAtDusk"],
                        "la sombra tiene que ser MÁS CORTA al mediodía que al atardecer")
        for k in ("reachAtNoon", "reachAtDusk", "squashY", "figureHeightM"):
            self.assertIsInstance(self.sun[k], (int, float))
            self.assertGreater(self.sun[k], 0)

    def test_a_noon_shadow_is_harder_than_a_dusk_one(self):
        self.assertGreater(self.sun["alphaAtNoon"], self.sun["alphaAtDusk"])
        self.assertLessEqual(self.sun["alphaAtNoon"], 1.0)

    def test_the_colour_is_a_triple_because_the_painter_builds_the_alpha(self):
        self.assertRegex(str(self.sun["color"]), r"^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$")

    def test_the_height_bands_are_ordered_and_end_open(self):
        """Una banda fuera de orden le da a una huella grande la altura de una
        chica, y sin la banda abierta el mercado no tiene altura ninguna."""
        bands = self.heights["bands"]
        areas = [b["maxAreaM2"] for b in bands]
        self.assertIsNone(areas[-1], "la última banda tiene que quedar abierta")
        finite = [a for a in areas if a is not None]
        self.assertEqual(finite, sorted(finite), "las bandas no están ordenadas por área")
        storeys = [b["storeys"] for b in bands]
        self.assertEqual(storeys, sorted(storeys),
                         "una huella más grande no puede dar menos plantas")

    def test_a_windowless_building_is_lower(self):
        """Sin ventanas emitidas es un galpón: ancho y bajo."""
        self.assertLess(self.heights["windowlessScale"], 1.0)
        self.assertGreater(self.heights["windowlessScale"], 0)

    def test_the_nineteen_fixed_offsets_are_going_away(self):
        """El `translate(4, 4)` de todo edificio del mundo era el más visible."""
        # sin comentarios: el propio archivo EXPLICA que antes era `translate(4, 4)`,
        # y buscarlo en crudo encuentra esa frase. Octava vez en este repo.
        def source(path):
            return re.sub(r"^\s*//.*$", "", read(path), flags=re.M)
        src = source(os.path.join(ROOT, "src", "render", "c2d", "structures.js"))
        self.assertNotIn("ctx.translate(4, 4)", src,
                         "la sombra de un edificio volvió a ser un desplazamiento fijo")
        ents = source(os.path.join(ROOT, "src", "render", "c2d", "entities.js"))
        self.assertIn("figureShadow", ents,
                      "las figuras de pie tienen que pasar por el ayudante del sol")
