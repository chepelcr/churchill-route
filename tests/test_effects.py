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
ACTORS = os.path.join(ROOT, "src", "assets", "actors.json")
ENTITIES = os.path.join(ROOT, "src", "render", "c2d", "entities.js")
CANVAS2D = os.path.join(ROOT, "src", "render", "canvas2d.js")
SHAPES = os.path.join(ROOT, "src", "render", "c2d", "shapes.js")
SYSTEM_SHAPES = os.path.join(ROOT, "src", "render", "c2d", "systemShapes.js")
SHADOWS = os.path.join(ROOT, "src", "render", "c2d", "shadows.js")
SUN_DIRECTION = os.path.join(ROOT, "src", "render", "sun.js")

#: Where each effect's painter lives, and the marker its body starts at. The
#: scan is scoped per painter rather than run over the whole file on purpose:
#: `drawArcadeCoin(c, t)` also names its argument `c`, and a blanket sweep for
#: `c.<name>` would demand the coin's `palette` be an effect parameter.
PAINTERS = {
    # These painters are shared with the editor's animated labs. The runtime
    # wrappers in entities/canvas2d provide state; the canonical algorithm —
    # and therefore every parameter read — lives in systemShapes.js.
    "turnWind": (SYSTEM_SHAPES, "export function paintTurnWind(", "\n}"),
    "wake": (SYSTEM_SHAPES, "export function paintWake(", "\n}"),
    "shadow": (SYSTEM_SHAPES, "export function paintVehicleShadow(", "\n}"),
    "heel": (SYSTEM_SHAPES, "export function applyVehicleHeel(", "\n}"),
    "speedLines": (SYSTEM_SHAPES, "export function paintSpeedLines(", "\n}"),
    # Los faros son DOS pintores porque los usan tres cosas distintas: el
    # jugador por la vía de efectos, y el tráfico y las lanchas llamando
    # directo — un carro del tráfico no tiene registro de vehículo del que
    # escoger un efecto, y aun así tiene que alumbrar.
    "headlights": (SYSTEM_SHAPES, "export function paintHeadlights(", "\n}"),
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
            used = set(re.findall(r"\b(?:c|cfg|config)\.([A-Za-z_]\w*)", body(eid)))
            missing = used - params
            self.assertEqual(missing, set(),
                             f"effect '{eid}' reads {sorted(missing)}, which its "
                             f"`params` do not define — they resolve to NaN")

    def test_no_parameter_is_dead(self):
        # The other direction: a knob in the editor that moves nothing is a lie
        # to whoever turns it.
        for eid, effect in self.effects.items():
            params = {k for k in (effect.get("params") or {}) if is_param(k)}
            used = set(re.findall(r"\b(?:c|cfg|config)\.([A-Za-z_]\w*)", body(eid)))
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
        self.actors = json.loads(read(ACTORS))
        self.entities = code(ENTITIES)

    def test_every_cargo_style_a_vehicle_uses_is_implemented(self):
        # The three identity drawers moved with the rest of the actor art.  The
        # effect registry owns selection/mount, actors.json owns the visible
        # form, and the renderer only implements the finite placement verbs.
        styles = {key for key in self.actors["cargo"] if not key.startswith("_")}
        forms = self.actors["forms"]
        placements = set(re.findall(r'^  "([\w-]+)":',
                                    self.entities.split("const CARGO_PLACERS = Object.freeze({", 1)[1], re.M))
        self.assertTrue(placements, "CARGO_PLACERS no longer parses")
        for key, v in self.veh.items():
            style = (v.get("cargo") or {}).get("style")
            if style is None:
                continue
            self.assertIn(style, self.reg, f"'{key}' carries an unknown cargo '{style}'")
            self.assertIn(style, styles, f"cargo style '{style}' has no JSON asset")
            cargo = self.actors["cargo"][style]
            self.assertIn(cargo["form"], forms, f"cargo style '{style}' has no form")
            self.assertIn(cargo["placement"], placements,
                          f"cargo style '{style}' has no placement implementation")

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

    def test_one_backend_free_module_owns_the_2d_and_3d_sun(self):
        """Three must consume the art's sun, not invent a geometric second one.

        The shared module may read the live clock and its data registry; it may
        not depend on Canvas, Three, the DOM, or a browser global. That keeps it
        usable by either renderer and by deterministic diagnostics.
        """
        solar = read(SUN_DIRECTION)
        self.assertIn("export function sunDirection3", solar)
        for forbidden in ('from "three"', "/c2d/", "window.", "document."):
            self.assertNotIn(forbidden, solar,
                             f"la autoridad solar volvió a depender de {forbidden}")
        shadows = read(SHADOWS)
        self.assertIn('import { sunShadow2 } from "../sun.js"', shadows)
        self.assertNotIn('import { sunVector }', shadows,
                         "Canvas sigue calculando un segundo sol por su cuenta")

    def test_the_3d_ray_keeps_the_authored_anisotropy(self):
        """The signs are load-bearing because Three's Y is minus Canvas Y."""
        solar = read(SUN_DIRECTION)
        self.assertIn("const rawX = -sun.x * reach", solar)
        self.assertIn("const rawY = sun.y * reach * SUN.squashY", solar)
        self.assertIn("Math.hypot(rawX, rawY, 1)", solar)
        self.assertIn("Math.atan2(z, Math.hypot(x, y))", solar)

        # The public Three contract is intentionally small and stable. Canvas'
        # exact-IEEE adapter is another export, not hidden backend fields on the
        # direction object.
        returned = re.search(
            r"export function sunDirection3\(.*?return\s*\{(.*?)\n\s*\};",
            solar,
            flags=re.S,
        )
        self.assertIsNotNone(returned, "sunDirection3's return object no longer parses")
        keys = re.findall(r"^\s*([A-Za-z_]\w*)\s*(?=[:,])", returned.group(1), flags=re.M)
        self.assertEqual(
            keys,
            ["x", "y", "z", "reach", "shadowAlpha", "elevationRad"],
            "the renderer-neutral solar contract drifted",
        )

        # Normalise/divide is algebraically equal but moves a few components by
        # ~1e-14. This adapter consumes direction reach/alpha and keeps the old
        # multiplication order; smoke-shadows proves every IEEE value exactly.
        self.assertIn("const direction = sunDirection3(sun)", solar)
        self.assertIn("heightM * pxPerM * direction.reach", solar)
        self.assertIn("dx: sun.x * reach", solar)
        self.assertIn("dy: sun.y * reach * SUN.squashY", solar)
        self.assertIn("alpha: direction.shadowAlpha", solar)
        shadows = read(SHADOWS)
        self.assertIn("return sunShadow2(heightM, PX_PER_M)", shadows)

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
        self.assertIn("sunShadow(record.heightM", ents,
                      "la sombra del actor tiene que derivarse de su altura y del sol")
        self.assertIn("shadowDx: sh.dx", ents)
        self.assertIn("shadowDy: sh.dy", ents)
        actor_data = read(ACTORS)
        self.assertIn('"x": "$shadowDx"', actor_data,
                      "la silueta JSON no está consumiendo el vector solar")
        self.assertIn('"y": "$shadowDy"', actor_data,
                      "la silueta JSON no está consumiendo el vector solar")
