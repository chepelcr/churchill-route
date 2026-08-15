"""LAS MEDIDAS DEL MUNDO — `src/assets/world-units.json` and its two consumers.

`docs/RESCALE.md` step 0: retire the cuadrícula as a SCREEN unit and name the
world's lengths in metres, so that the next scale change cannot silently make a
constant mean something else. It has happened twice — at 1.6 -> 2.0 the street
spans stopped reaching Calle 6 and took Kiosco Playitas off the drivable
network, and at 2.0 -> 2.5 the hand-laid px anchors missed the real manzanas by
4 000 px and the ENTIRE civic centre stopped existing. Neither failed anything.

So this file asserts the two properties that make the conversion worth having:

  * **the derivation is exact today** — every metre value lands on the integer
    it used to be hard-coded as, which is what lets step 0 leave the emitted
    world byte-identical;
  * **there is only one copy** — the numbers the builder, the game and the
    schema all used to carry (a ferry's deck, the channel's pitch, the camera's
    framing, the zoom floor) are gone from the code that reads them.

The zoom floor gets its own case because it is the one that scales INVERSELY,
which is the mistake the doc predicts somebody making.
"""
import json
import os
import re
import unittest

from churchill.world import config
from churchill.world.service import ferry as ferry_service
from churchill.world.service import lancha

ROOT = config.ROOT
UNITS = config.UNITS
MANIFEST = os.path.join(ROOT, "src", "world2d", "manifest.json")
CLIENT_UNITS = os.path.join(ROOT, "src", "domain", "units.js")
GFX = os.path.join(ROOT, "src", "render", "c2d", "gfx.js")
CROSSING = os.path.join(ROOT, "src", "game", "crossing.js")
FERRIES_JS = os.path.join(ROOT, "src", "game", "ferries.js")
DTO = os.path.join(ROOT, "churchill", "world", "dto", "world.py")
MODES = os.path.join(ROOT, "src", "game", "modes.js")
PHYSICS = os.path.join(ROOT, "src", "game", "physics.js")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def manifest():
    return json.loads(read(MANIFEST))


class DerivationTests(unittest.TestCase):
    """Every metre lands on the pixel the world was built with."""

    def setUp(self):
        self.m = manifest()

    def test_the_scale_is_the_one_the_world_was_built_at(self):
        # Everything below is `metres * this`. If the manifest and the builder
        # disagree about the scale, no other assertion here means anything.
        self.assertEqual(self.m["meta"]["pxPerMeter"], config.PLANAR_PX_PER_M)

    def test_the_three_quantisations(self):
        self.assertEqual(config.GRID_CELL, self.m["meta"]["cell"],
                         "the raster cell derived from rasterCellM is not the "
                         "cell the shipped world is rastered at")
        self.assertEqual(config.CUAD, self.m["meta"]["cuad"])
        self.assertEqual(config.TILE_PX, self.m["meta"]["tilePx"])
        self.assertEqual(config.TILE_CELLS, self.m["meta"]["tileCells"])
        # CUAD is the coarse grid `detect_blocks` walks; it must land on the
        # raster or a block's cells are not cells.
        self.assertEqual(config.CUAD % config.GRID_CELL, 0)
        self.assertEqual(config.TILE_PX % config.CUAD, 0)

    def test_the_kerb(self):
        # ACERA_CELLS is counted in RASTER CELLS and the depth is a real width,
        # which is exactly why it was worth converting: at a 6 px cell the bare
        # `3` would quietly have become 18 px of sidewalk.
        self.assertEqual(config.ACERA_CELLS * config.GRID_CELL,
                         self.m["meta"]["aceraPx"])
        self.assertEqual(config.px(UNITS["kerb"]["sidewalkM"]),
                         self.m["meta"]["aceraPx"])
        self.assertEqual(config.FIELD_ACERA_CELLS * config.GRID_CELL,
                         config.px(UNITS["kerb"]["fieldSidewalkM"]))
        self.assertLess(config.FIELD_ACERA_CELLS, config.ACERA_CELLS,
                        "a parcel's ring is shallower than a manzana's — all it "
                        "has to do is keep the pitch's lines off the asphalt")

    def test_the_camera_framing_is_still_the_advisory_the_manifest_carries(self):
        # `meta.cuadsPerView` is advisory and the renderer owns the real
        # framing, but it is emitted, so it has to keep agreeing with the
        # metres the renderer now frames.
        self.assertEqual(config.CUADS_PER_VIEW, self.m["meta"]["cuadsPerView"])
        self.assertEqual(config.px(UNITS["camera"]["viewWidthM"]),
                         config.CUADS_PER_VIEW * config.CUAD)

    def deck_of(self, vessel):
        v = UNITS["vessels"][vessel]
        return ([config.px(v["deckLengthM"]), config.px(v["deckWidthM"])],
                config.px(v["dockOffsetM"]))

    def test_each_vessel_is_one_boat_not_four_copies_of_her(self):
        """The row said three copies. The test found a fourth.

        `service/lancha.py` carried a bare `(86, 34)` / `dockS 20` for the
        estero boat — a different vessel, correctly, but written down where
        nothing else could see it. She is in the registry now, and the two
        gulf ferries and the lancha are checked against the shipped world.
        """
        ferry_deck, ferry_dock = self.deck_of("ferry")
        lancha_deck, lancha_dock = self.deck_of("lancha")
        self.assertEqual([int(ferry_service.DECK_L), int(ferry_service.DECK_W)], ferry_deck)
        self.assertEqual(int(ferry_service.DOCK_S), ferry_dock)
        self.assertEqual(list(lancha.LANCHA_DECK), lancha_deck)
        self.assertEqual(lancha.LANCHA_DOCK_S, lancha_dock)

        ferries = self.m.get("ferries") or []
        self.assertTrue(ferries, "the world ships no ferries to check")
        seen = set()
        for f in ferries:
            # a one-way boat over the estero IS the lancha; the gulf pair are
            # the ferries. The world says which by the field it emits.
            want, dock = (lancha_deck, lancha_dock) if f.get("oneWay") else (ferry_deck, ferry_dock)
            self.assertEqual(f["deck"], want,
                             f"{f['id']} sails a different deck from the one authored")
            self.assertEqual(int(f["dockS"]), dock, f"{f['id']} berths differently")
            seen.add(bool(f.get("oneWay")))
        self.assertEqual(seen, {True, False},
                         "the world used to ship both a gulf ferry and the "
                         "lancha; if one is gone this test covers half of what "
                         "it says it does")

    def test_the_channel_pitch_is_emitted_and_derived(self):
        self.assertEqual(lancha.CHANNEL_PITCH, config.px(UNITS["channel"]["pitchM"]))
        self.assertEqual(lancha.TANGENT_SPAN, config.px(UNITS["channel"]["tangentSpanM"]))
        chans = [f["channel"] for f in self.m.get("ferries") or [] if f.get("channel")]
        self.assertTrue(chans, "no channel in the shipped world to check")
        for c in chans:
            self.assertEqual(c["pitch"], lancha.CHANNEL_PITCH)

    def test_the_zoom_floor_scales_inversely(self):
        """The trap `docs/RESCALE.md` predicts somebody falling into.

        The floor is a MAGNIFICATION — screen px per WORLD px — so when the
        world gains pixels per metre the floor must LOSE them. Raising it with
        the scale, which is the intuitive guess, crops a phone from 145 m of
        view to 57. Authored as screen px per METRE it cannot be got wrong.
        """
        floor = UNITS["camera"]["minScreenPxPerM"] / config.PLANAR_PX_PER_M
        self.assertAlmostEqual(floor, 2.2, places=12,
                               msg="the floor no longer derives to the 2.2 the "
                                   "game has always used at this scale")
        # …and at a hypothetical 4.0 px/m it must fall, not rise.
        self.assertLess(UNITS["camera"]["minScreenPxPerM"] / 4.0, floor)


class WorldDistanceTests(unittest.TestCase):
    """`docs/RESCALE.md` step 2 — the rest of the audit list.

    THE PROOF IS THE ARITHMETIC, not a rebuild. The build is deterministic, so
    if every constant derives to the integer it was hard-coded as, the emitted
    world is identical BY CONSTRUCTION — and that is a stronger statement than a
    33-minute rebuild, which could mask a difference under other noise. What the
    rebuild would add is confidence that nothing ELSE moved, which
    `world_snapshot.py verify` already answers for the files on disk.
    """

    def setUp(self):
        self.w = UNITS["world"]

    def px2(self, m2):
        """An AREA in px². These scale as the SQUARE of the projection, which is
        the easiest thing in this file to get wrong by hand."""
        return round(m2 * config.PLANAR_PX_PER_M ** 2)

    def test_the_lengths_land_on_their_original_pixels(self):
        want = {
            "POI_NUDGE_PX": (750, config.px(self.w["poi"]["nudgeM"])),
            "SERVICE_MIN_PX": (150, config.px(self.w["poi"]["serviceMinM"])),
            "MARINE_POOL_GROUND_CLEAR_PX": (28, config.px(self.w["marine"]["poolGroundClearM"])),
            "MARINE_POOL_MIN_SPACING_PX": (72, config.px(self.w["marine"]["poolSpacingM"])),
            "MARINE_POOL_RAIL_CLEAR_PX": (52, config.px(self.w["marine"]["railClearM"])),
            "MARINE_STRUCTURE_PARCEL_PAD_PX": (8, config.px(self.w["marine"]["structurePadM"])),
            "SPIT_MAX_WIDTH_PX": (4000, config.px(self.w["estero"]["spitMaxWidthM"])),
            "SPIT_SHORE_TOL_PX": (200, config.px(self.w["estero"]["spitShoreTolM"])),
            "ESTERO_MAINLAND_PX": (4000, config.px(self.w["estero"]["mainlandM"])),
            "MANGROVE_PITCH_PX": (56, config.px(self.w["estero"]["mangrovePitchM"])),
            "MALECON_MIN_SAND_PX": (24, config.px(self.w["malecon"]["minSandM"])),
            "MALECON_MIN_TAKE_PX": (12, config.px(self.w["malecon"]["minTakeM"])),
        }
        for name, (was, now) in want.items():
            self.assertEqual(now, was, f"{name}: {now} px, was {was}")
            self.assertEqual(getattr(config, name), was, f"config.{name} drifted")

    def test_the_areas_scale_as_the_square(self):
        self.assertEqual(config.MIN_BUILDING_AREA_PX2,
                         self.px2(self.w["poi"]["minBuildingM2"]))
        cell2 = config.GRID_CELL ** 2
        self.assertEqual(config.MALECON_MIN_PATCH_CELLS,
                         round(self.px2(self.w["malecon"]["minPatchM2"]) / cell2))
        self.assertEqual(config.FARO_ESP_MAX_CELLS,
                         round(self.px2(self.w["faro"]["esplanadeMaxM2"]) / cell2))

    def test_the_services_derive_the_same(self):
        from churchill.world.service import ferry, lancha
        self.assertEqual(lancha.CHANNEL_HW, 150)
        self.assertEqual(lancha.DREDGE_END_PAD, 220)
        self.assertEqual(lancha.SIMPLIFY_PX, 60.0)
        self.assertEqual(lancha.SNAP_PX, 400.0)
        self.assertEqual(lancha.MIN_ACCESS_PX, 24.0)
        self.assertEqual(lancha.SEARCH_PAD_PX, 6000)
        self.assertEqual(ferry.RIDE_PX, 1800.0)

    def test_the_marine_clearance_clears_the_raster(self):
        """The drawn deck is continuous and the ground it must sit inside is
        quantised, so the clearance has to exceed the cell's half-diagonal or a
        tank that passes in metres fails on the raster."""
        half_diag = config.GRID_CELL * 2 ** 0.5 / 2
        self.assertGreater(config.MARINE_POOL_GROUND_CLEAR_PX, half_diag)

    def test_the_px_native_ones_are_documented(self):
        """`docs/RESCALE.md` says to decide per constant and not convert
        blindly. A value left in px needs a REASON on the record, or the next
        person converts it for tidiness and it breaks in the direction nobody
        expects."""
        native = self.w["_pxNative"]
        for key in ("kioskWaterClearPx", "channelHwCapPx", "bldgInsetPx",
                    "dpTolerancePx", "buildingScale"):
            self.assertIn(key, native, f"{key} has no recorded reason for staying px")
            self.assertGreater(len(native[key]), 40, f"{key}'s reason is too thin to be one")
        # …and they must actually still be px in the source.
        self.assertEqual(config.KIOSK_WATER_CLEAR_PX, 30)
        self.assertEqual(config.BLDG_INSET, 2)


class SingleCopyTests(unittest.TestCase):
    """The numbers are gone from the code that used to carry them."""

    def test_the_camera_no_longer_frames_cuadriculas(self):
        src = read(GFX)
        body = src.split("function computeZoom", 1)[1].split("}", 1)[0]
        self.assertNotIn("2.2", body,
                         "the zoom floor is back as a literal in computeZoom — "
                         "it belongs in world-units.json, in screen px per METRE")
        self.assertIn("MIN_ZOOM", body)
        self.assertIn("VIEW_WIDTH_PX", body)
        self.assertNotIn("CUADS_PER_VIEW *", body,
                         "the camera is framing the block-detection grid again")

    def test_the_client_channel_constants_come_from_the_registry(self):
        src = read(CROSSING)
        self.assertIn('from "../domain/units.js"', src)
        self.assertNotRegex(src, r"const TANGENT_SPAN\s*=\s*\d",
                            "TANGENT_SPAN is written down twice again; the "
                            "build sounds the channel over the same span")
        self.assertNotIn("c.pitch || 40", src,
                         "the legacy pitch fallback is a literal again")

    def test_the_client_ferry_fallbacks_come_from_the_registry(self):
        src = read(FERRIES_JS)
        self.assertNotRegex(src, r"const DEF_DECK_L\s*=\s*\d")
        self.assertIn("FERRY_DECK_L", src)

    def test_the_schema_carries_no_ferry_default(self):
        """A DTO default is a copy that only ever fires when something broke.

        `deck: list[int] = Field(default=[124, 46])` could only paper over a
        producer that had stopped emitting the field — silently, at whatever
        size the ferry happened to be in 2026.
        """
        src = read(DTO)
        block = src.split("class Ferry(", 1)[1].split("class ", 1)[0]
        self.assertNotIn("default=[124, 46]", block)
        self.assertNotIn("default=28.0", block)

    def test_the_client_derives_rather_than_restates(self):
        src = read(CLIENT_UNITS)
        self.assertIn("world-units.json", src)
        # every exported px must be a px(...) of a registry field
        for name in ("VIEW_WIDTH_PX", "CHANNEL_PITCH", "TANGENT_SPAN",
                     "FERRY_DECK_L", "FERRY_DECK_W", "FERRY_DOCK_S"):
            self.assertRegex(src, rf"export const {name} = px\(UNITS\.",
                             f"{name} is not derived from the registry")


class RunClockTests(unittest.TestCase):
    """`180` meant two things and `999` meant 'no clock'."""

    def test_arcade_and_a_stage_are_two_constants(self):
        src = read(MODES)
        self.assertIn("ARCADE_DURATION_S", src)
        self.assertIn("DEFAULT_STAGE_DURATION_S", src)
        self.assertNotRegex(src, r"state\.timeLeft = \d",
                            "a run length is a literal in modes.js again")

    def test_the_magic_near_infinity_is_gone(self):
        src = read(MODES)
        self.assertNotIn("999", src,
                         "999 is back as a stand-in for 'untimed'; a run without "
                         "a clock sets timeLeft = UNTIMED")
        self.assertIn("UNTIMED", src)

    def test_the_tick_asks_the_clock_not_the_mode_list(self):
        src = read(PHYSICS)
        self.assertIn("isTimed(state)", src)
        self.assertNotIn('state.mode === "explore"', src.split("isTimed(state)", 1)[0][-800:],
                         "the timer is branching on mode names again — that list "
                         "was already wrong once (Recorrer counted down to 999 "
                         "and reset, a treadmill with no consumer)")
