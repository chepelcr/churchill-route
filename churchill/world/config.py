"""World-builder knobs — every tuning constant in one place.

Nothing here reads the OSM file or touches the grid; these are the dials the
pipeline turns. World SIZE is not here on purpose: it is computed from the OSM
bounds at build time and belongs to the grid the projection service creates.

Changing any value here changes the emitted world, so pair the edit with
`python3 tools/world_snapshot.py save` in the same commit.
"""
import math
import os

# CLASS_NAMES is re-exported: the builder has always imported it from config.
from .enums import CLASS_NAMES, Surface  # noqa: F401
from .enums import surface as surface_enum

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OSM_PATH = os.path.join(ROOT, "docs", "map.osm")
EDITOR_PATCH_PATH = os.path.join(ROOT, "docs", "world-editor.patch.json")
DEBUG_PNG = os.path.join(ROOT, "tools", "debug_map.png")
DEBUG_SVG = os.path.join(ROOT, "tools", "debug_features.svg")
# chunked output — the tiled world the src/world2d accessor streams by camera
# region (416 tiles + manifest.json).
WORLD2D_DIR = os.path.join(ROOT, "src", "world2d")

# World SIZE is not a knob: it is computed from the OSM bounds at build time
# (see planar_setup) and lives with the grid, not here.
GRID_CELL = 4                   # raster cell size in world px

# Cuadrícula (tile) standardization: one CUAD is the base city tile. Streets and
# cuadras are whole numbers of cuadrículas so sizes read uniform and identical
# across devices. CUAD is a multiple of GRID_CELL so it aligns to the raster.
#   street: secondary = 4 cuadrículas (2/lane), principal = 6 (3/side)
#   cuadra: >= 6x6 cuadrículas of land + 1 cuadrícula of acera on every side
#   view:   the engine frames at most CUADS_PER_VIEW cuadrículas (responsive zoom)
CUAD = 20                       # px per cuadrícula (a lane ~= 2 cuadrículas)
CUADS_PER_VIEW = 20             # advisory; the renderer owns the actual framing
CUAD_CELLS = CUAD // GRID_CELL  # raster cells per cuadrícula side
assert CUAD % GRID_CELL == 0, "CUAD must align to the raster grid"
# Planar tiling: the world is emitted as a grid of square tiles the accessor
# streams by camera region. A tile is a whole number of cuadrículas (so it
# aligns to CUAD and the raster grid) ~2000 px on a side.
TILE_CUADS = 100                # 100 CUAD = 2000 px per tile side
TILE_PX = TILE_CUADS * CUAD     # 2000
TILE_CELLS = TILE_PX // GRID_CELL   # 500 raster cells per tile side

# local equirectangular projection anchor (Faro de La Punta)
LAT0, LON0 = 9.9770, -84.8512
M_PER_DEG_LAT = 110540.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

# ---- Planar (true-scale 2-D) projection -------------------------------------
# THESE TWO MOVE TOGETHER. The painted width of a street is
# ROAD_WIDTH_M · ARCADE_STREET_MUL · PLANAR_PX_PER_M, so raising the scale while
# lowering the multiplier by the same factor leaves every street exactly the
# width it was in px — and makes the CUADRAS bigger, which is the whole point.
#
# At 1.6 / 3.2 a 7 m residential street was painted 36 px, i.e. 22 m wide, and it
# ate into the buildings beside it: the Parque Marino's own footprints, kept at
# their true outline, came out overlapping the roadway. At 2.0 / 2.56 the street
# is still 36 px and the block around it is 25 % bigger, so the same footprint
# clears it. Anything measured in px against a STREET (a car, a sign, a ped)
# keeps its proportions; anything measured against a BLOCK gains room.
#
# THE STREET IS ALSO A WIDTH ON SCREEN, and holding it fixed through the rescale
# left it looking thin against the bigger manzanas — the corridor read as a lane
# between two large blocks rather than as a calle. So the multiplier goes back
# up: 2.56 -> 2.9 puts a 7 m residential street at 41 px instead of 36.
#
# It is paid for out of the ACERA, not out of the cuadra — see ACERA_CELLS,
# which drops from 5 cells to 4 in the same breath. The street corridor (asphalt
# + both sidewalks) goes from 76 px to 73, and the ASPHALT's share of it from
# 47 % to 56 %, which is the part that reads as "a calle" rather than "a lane".
#
# 3.1 was one step too far. Every px of roadway is a px a real OSM footprint
# beside it has to be pushed out of, and at 43 px the push ran out of room for
# 254 named buildings — which then lost their real outlines to the snapper, and
# the outline is the entire reason a named building is kept.
#
# 2.0 / 2.9 -> 2.5 / 2.32, the same move again and for the same reason. The
# question it answers is "why is anything standing on the acera at all", and the
# answer is arithmetic: a 7 m calle painted 41 px is 20.5 m of asphalt, and the
# sidewalk is then carved 6 m INTO the manzana — so the game's building line
# stood 12.8 m inside the true property line, on all four sides of every block,
# and a footprint drawn where it really is HAD to overlap. Nothing about the
# fitting was wrong.
#
# Raising the scale and lowering the multiplier by the same factor leaves every
# street exactly the width it was ON SCREEN while shrinking the exaggeration in
# METRES: the same 41 px of asphalt is now 16.4 m, the same 12 px of sidewalk is
# 4.8 m, and the encroachment drops to 9.5 m. The manzana's interior grows ~37 %,
# which is the room the push actually needs.
#
# What it costs: the raster goes from 158M cells to 247M (build ~15 min, ~22 MB
# emitted), and since speed is px/s a delivery is a longer drive in seconds —
# measure before touching the stage timers, do not assume.
PLANAR_PX_PER_M = float(os.environ.get("PLANAR_PX_PER_M", "2.5"))   # world zoom
ARCADE_STREET_MUL = float(os.environ.get("ARCADE_STREET_MUL", "2.32"))  # widen streets
# real-ish carriageway widths (metres) per OSM highway class; painted width =
# ROAD_WIDTH_M · ARCADE_STREET_MUL · px_per_m (kept modest so junction gores survive)
ROAD_WIDTH_M = {
    "trunk": 16, "trunk_link": 12, "primary": 14, "primary_link": 11,
    "secondary": 11, "tertiary": 9, "tertiary_link": 8,
    "residential": 7, "unclassified": 7, "living_street": 6,
    "service": 4.5, "pedestrian": 5, "paseo": 16, "bridge": 12,
}
# optional bbox clip "lon0,lat0,lon1,lat1" for a bounded smoke build.
# docs/map.osm actually spans ~85x92 km (stray inland highways / distant
# villages far outside Puntarenas) — projecting it whole gives a 1.2-billion-cell,
# 99.96%-water world. So planar defaults to the documented Puntarenas region
# bbox (9.8539-10.0304 N, -84.9188--84.6328 E), clipping the outliers. Override
# with PLANAR_BBOX (e.g. a small centro sub-bbox for a fast smoke).
PLANAR_FULL_BBOX = "-84.9188,9.8539,-84.6328,10.0304"
PLANAR_BBOX = os.environ.get("PLANAR_BBOX") or PLANAR_FULL_BBOX

# StreetIndex search spans, in METRES, converted to px at build time.
#
# These were px constants tuned at px_per_m 1.6, and the rescale broke them
# silently: Calle 6 sits 744 px from the Las Playitas anchor at 2.0, just past a
# 700 px span that used to reach it — so the estadio fell back to its anchor
# rect and took Kiosco Playitas out of the drivable network with it. A distance
# that means "about half a manzana away" belongs in metres.
STREET_SPAN_M = 440             # vals() / edge(): samples near a reference
STREET_AT_SPAN_M = 560          # at(): the coordinate AT a point
STREET_DIR_SPAN_M = 325         # direction(): a manzana's angle
STREET_NEAR_SPAN_M = (500, 315)  # near(): the build-log diagnostic


def street_span_px(metres):
    """A street-search span in world px, whatever the world's scale is."""
    return round(metres * PLANAR_PX_PER_M)


BUILDING_SCALE = 1.4            # match footprints to exaggerated road widths
POI_NUDGE_PX = 750

ROAD_CLASSES = set(ROAD_WIDTH_M) - {"paseo", "bridge"}

def road_width_px(cls):
    """Painted street width: real metres · ARCADE_STREET_MUL · px_per_m —
    arcade-wide but modest, so junction gores survive."""
    return max(GRID_CELL * 2,
               round(ROAD_WIDTH_M.get(cls, 7) * ARCADE_STREET_MUL * PLANAR_PX_PER_M))
# Keep every OSM street for a faithful map — the cuadrícula grid standardizes
# cuadra/street sizes by snapping to the tile grid, so we no longer prune
# streets to control block size.
DROP_ROAD_CLASSES = set()
SERVICE_MIN_PX = 150
DP_ROAD_PX = 1.0
DP_BUILDING_PX = 2.0
DP_COAST_PX = 2.5
# The DRAWN sand is traced from the raster (service.surface.sand_outlines), not
# from the OSM beach polygons — that disagreement is what put two tones on the
# playa. 12 px keeps the shape and costs ~120 KB of manifest; the raster cells
# stay authoritative for physics either way.
DP_SAND_PX = 12.0
MIN_BUILDING_AREA_PX2 = 216

# ---- the coast, widened on purpose ------------------------------------------
# The one deliberate lie this map tells about its own geography. Puntarenas'
# playa is 15-40 m of sand, and the camera frames twenty cuadrículas — so at
# true scale the beach is a stripe you cross, not a place you are at, and the
# malecón beside it has nothing to be beside. Twenty metres of reclaimed sea
# makes the playa read at play zoom; the spit does not visibly fatten, and the
# ESTUARY gains nothing (it is mangrove down to the waterline, by design).
SHORE_RECLAIM_M = 20
# …and how far around the paseos' own waterfront it is allowed to reach. This
# is the beach the camera is ever pointed at — Las Playitas is inside it, the
# 60 km of coast east of the spit is not.
SHORE_RECLAIM_REACH_M = 600
SHORE_RECLAIM_CELLS = int(round(SHORE_RECLAIM_M * PLANAR_PX_PER_M / GRID_CELL))

# Parque Marino is the RESIDUAL of its cuadra after the UNA campus and every
# mapped building lot have taken their ground. Five 0.38-scale tanks no longer
# fit that honest remainder without one entering a parcel. At 0.32 the 78 px
# source deck has a 25.0 px major radius. A 28 px ownership disk includes the
# raster cell's 2.83 px half-diagonal quantisation margin, so the rendered deck
# stays inside marine ground; 72 px between centres leaves a visible gap. The
# disk also defines "entirely west of the station parcel".
MARINE_POOL_SCALE = 0.32
MARINE_POOL_GROUND_CLEAR_PX = 28
MARINE_POOL_MIN_SPACING_PX = 72
# A building lot owns an 8 px band around its mapped footprint. Close structures
# divide shared cells by nearest-footprint distance, so parcels never overlap.
MARINE_STRUCTURE_PARCEL_PAD_PX = 8
# The Ferrocarril's longest ties reach ~6 px from its centreline. Keep the
# established conservative rail envelope: these are WORLD constraints, not
# renderer nudges, so a later projection/acera resize cannot silently put a
# tank back on the tracks.
MARINE_POOL_RAIL_CLEAR_PX = 52

# Surface classes come from the enum layer; these aliases are what the builder
# has always called them (a member IS its int, so nothing else changes).
CLS_WATER = Surface.WATER
CLS_LAND = Surface.LAND
CLS_BEACH = Surface.BEACH
CLS_ROAD = Surface.ROAD
CLS_PASEO = Surface.PASEO
CLS_BRIDGE = Surface.BRIDGE
CLS_ACERA = Surface.ACERA
CLS_BOULEVARD = Surface.BOULEVARD
CLS_BARRO = Surface.BARRO
CLS_GRAVEL = Surface.GRAVEL
CLS_MALECON = Surface.MALECON
# Sidewalk depth per side, in raster cells. It is carved INTO the cuadra, so
# every cell of it is block frontage the town does not get — and at 5 cells the
# ring was 20 px, which at 2 px/m is a TEN METRE sidewalk. That is what put 245
# of the 306 real named footprints on top of their own acera: a building mapped
# at its true property line has nowhere else to be once the painted roadway and
# a ten-metre kerb strip have both eaten inward from the centreline.
# 3 cells = 12 px = 6 m. Still wider than a real Puntarenas sidewalk, because an
# arcade one has to be walkable and legible at game zoom, but every cell taken
# off it is a cell of cuadra INTERIOR handed back — 8 px per street, on all four
# sides of every manzana, which is what makes the blocks read as blocks.
ACERA_CELLS = 3                 # sidewalk depth: 12 px each side
# A FIELD's ring is shallower than a block's. All it has to do is keep the
# pitch's white lines off the asphalt, and every px of it is grass and markings
# the player doesn't get: at full depth the Carmen plaza went from 84x92 to
# 60x48. 8 px still reads as a kerb strip (the drawn sidewalk band is 20 px, so
# the pitch tucks under most of it, exactly like a park's green skirt).
FIELD_ACERA_CELLS = 2           # 8 px — estadio / plaza pitches
# see enums.surface: an acera exists only where there is a street to walk beside
STREET_CLASSES = surface_enum.STREET
# what a vehicle may drive on (BEACH included: the sand is slow, not a wall)
DRIVABLE_CLASSES = surface_enum.DRIVABLE
CARRIAGEWAY_CLASSES = surface_enum.CARRIAGEWAY
CALLE_CLASSES = surface_enum.CALLE

# ---- the estero vs the open sea ---------------------------------------------
# Puntarenas is a sand spit: SOUTH of it is the Pacific and the sand really is a
# beach; NORTH of it is the Estero de Puntarenas, which is mangrove down to the
# waterline. `estero_band` derives that split from the raster instead of an
# authored bbox, by tracing the ONE landform that has water on both sides — the
# spit — and calling everything north of its north shore estuary.
SPIT_MAX_WIDTH_PX = 4000        # a land run wider than this in its column is the
                                # mainland, not the spit (the spit is ~1100 px at
                                # the Muelle Nacional, 2200 at its widest)
SPIT_SHORE_TOL_PX = 200         # column-to-column jump the spit's Pacific shore
                                # may make and still be the same shore; a bigger
                                # jump is a different landmass (the tip)
ESTERO_MAINLAND_PX = 4000       # walking north from the spit, a land run this
                                # wide is the estuary's FAR shore — stop there.
                                # Anything narrower is an island in the estero,
                                # whose own shores are mangrove too.
MANGROVE_PITCH_PX = 56          # column stride of the mangrove clumps along the
                                # waterline: a touch under the mean clump
                                # DIAMETER, so the bank reads as one dense
                                # fringe rather than a dotted line
MANGROVE_R_MIN = 16             # clump radius range (px)
MANGROVE_R_MAX = 40
MANGROVE_SEED = 57              # deterministic scatter (jitter + radius)

# ---- buildings on the cuadrícula --------------------------------------------
SYNTH_MAX_TOTAL = 80000         # cap on real + synthesized buildings (raised so
                                # fully-filled small cuadras don't exhaust it
                                # mid-map and leave far blocks empty)
SYNTH_SEED = 77
BLDG_INSET = 2                  # px seam per side so adjacent roofs don't fuse
FRONTAGE_DEPTH = 3              # buildable band (CUADs) from the block edge
SMALL_BLOCK_CUADS = 188         # blocks <= this many cuadrículas fill completely
                                # (dense town); bigger ones keep patio interiors
OSM_MAX_CUADS = 4               # cap OSM footprints at 4x4 cuadrículas
# weighted synth footprint mix (w x h in cuadrículas)
SYNTH_LOTS = [((2, 2), 0.25), ((2, 1), 0.20), ((1, 2), 0.20),
              ((1, 1), 0.30), ((3, 2), 0.05)]

# ---- cuadra detection --------------------------------------------------------
BLOCK_MIN_CUADS = 6       # a real cuadra fits >= 6x6 buildable cuadrículas
SLIVER_MAX_CUADS = 25.0   # smaller-and-thinner land paves to plaza concrete

# ---- paseo separators --------------------------------------------------------
# The Paseo de los Turistas is a divided avenue: a dashed palm median runs down
# the centerline as a solid (blocking) separator between the two sides, with
# periodic gaps ("aperturas") where you can cross.
PASEO_MEDIAN_W = 0.5 * CUAD     # separator strips (palm median / tree lines) — ½ cuad planter
PASEO_MIN_DASH = 2.0 * CUAD     # drop palm-median slivers shorter than this
PASEO_GAP_MARGIN = CUAD         # extra turn room on each side of a crossing

# ---- el malecón: the paved sea front of the Paseo de los Turistas -----------
# Depth in METRES, on purpose. Every constant on this coast that was tuned in px
# broke at the 1.6 -> 2.0 rescale (see STREET_SPAN_M above and the faro's
# esplanade radius), and this one describes a promenade, which is a real width.
MALECON_BAND_M = 30             # ~60 px at 2.0 px/m = 3 cuadrículas of paving
# HOW FAR PAST THE KERB THE SAND MAY BE. This was 30 m (75 px) and that one
# number is why the sea front arrived in seven disjoint pieces. Measured on the
# finished raster, the strip between the Paseo's acera and the playa is a solar
# 80 px deep along the whole Muelle de Cruceros frontage (x 23 900..24 300) and
# 116 px at the faro end — so the probe gave up before it ever saw sand and
# those stretches got no promenade at all. At x 24 300 it missed by ONE PIXEL.
# Measured, not guessed: over the 1 589 cross-sections of the two paseos that
# actually have sea front, the kerb-to-sand gap runs a median of 94 px, p90 140,
# p99 150, max 168. At the old 75 px only 7.1 % of them could even SEE the sand.
MALECON_SHOULDER_M = 70         # 175 px: reaches every one of them
# …and the other half of the same fault. The band used to START at the first
# sand cell, so where the solar was narrow enough to cross the promenade still
# floated 24-56 px off the street with a stripe of land colour between the two.
# The paving walks BACK to the kerb through that gap — bounded, because an
# unbounded walk landward is how a cuadra gets paved. Sites stay reserved, so
# El Planché and the canchas de playa are flowed around, never crossed.
# …and the cap comes off the same distribution: 40 m links 60 % of the sea
# front, 50 m links 80 %, 60 m links 99.9 %. Above that it is one pathological
# section and a wider licence to pave, so the last 0.1 % keeps its short float.
MALECON_KERB_LINK_M = 60        # non-sand the band may cross to reach the kerb
# THE SAND HAS A VETO. The beach is 88-150 px wide along most of the Paseo and
# ~28 px by the faro; taking a flat band would pave the playa away at that end.
MALECON_MIN_SAND_PX = 24        # sand that must survive seaward of the paving
MALECON_MIN_TAKE_PX = 12        # below this the cross-section gets no promenade
MALECON_ENTRADA_W = 1.2 * CUAD  # the ramp down at each opening of the median
# By the faro the sea is on BOTH sides of the Paseo, so the sand rule finds a
# few dozen cells of "sea front" on the estero side too. A patch this small is a
# square of paving in the middle of a beach, not a promenade: it goes back to
# sand rather than being quietly left out of the emit (see stamp_malecon).
MALECON_MIN_PATCH_CELLS = 120   # ~45x45 px — below this it is raster noise

# A CHURCHILL STAND IS 32 px WIDE and throws a shadow 22 px to its right, so a
# kiosk 14 px from open water is drawn half in the gulf — which is exactly where
# the rescale put three of them. What has to clear the sea is the ART, not the
# anchor the build nudged onto land once and never re-checked.
# `kios_faro` is exempt: it stands on the Muelle del Faro's deck on purpose.
KIOSK_WATER_CLEAR_PX = 30

# ---- La Punta: the faro's plazoleta ----------------------------------------
# How far the paved sand tip reaches from the lighthouse, IN METRES. It was 34
# raster cells — 136 px, tuned at 1.6 px/m — so the rescale to 2.0 shrank the
# plaza from 85 m to 68 m while the loop road around it moved outward, and the
# sand left between the two is the yellow ring the player sees against the grey.
# Radial probes put the road at ~200 px from the flood origin on the east side.
FARO_ESP_R_M = 120
# The flood follows SAND, and sand runs the length of the coast. If the tip's
# beach ever joins the playa, the plazoleta stops being a plazoleta — so a flood
# this big is a leak, and the radius falls back with a warning rather than
# paving the Paseo. (~2400 cells is the tip; the whole beach is 400k.)
FARO_ESP_MAX_CELLS = 6000
# …and the other half of the same fix, which took two goes to state correctly.
# The line the player sees between the grey plazoleta and the loop road is NOT
# sand and it was never a matter of radius: measured off the finished raster it
# is `CLS_LAND` — 52 px of it at y 15 340, 60 px at y 15 560 — painted in the
# land tan `#cfb27a`, which against the plaza's `#cbc6ba` and the acera's
# `#b8b6b0` reads as a yellow stripe down the middle of one place. The flood
# follows SAND, so it can never take that ground, and a pocket rule bounded by
# a radius box and vetoed by "does it touch the sea" could not either.
#
# So the plazoleta is CLOSED TO ITS KERB instead: from the flooded sand it
# absorbs land and beach outward until it meets the sidewalk, the roadway or
# the water. This is the same move the malecón's `MALECON_KERB_LINK_M` makes
# on the other side of the spit, and for the same reason — a paved place with
# a verge between it and the street is two things, not one.
FARO_ESP_KERB_LINK_M = 30

PASEO_TURISTAS = "paseo de los turistas"
# THE TWO PASEOS ARE ONE WATERFRONT. Turistas runs the spit from the faro to
# x≈19099 and León Cortés Castro picks up at that exact point and carries on
# east past the Muelle de Cruceros to the Parque Marino — both facing the
# PACIFIC. (The estuary is the other shore of the spit and neither of them is
# on it; a comment in service/malecon.py claimed otherwise for a while.)
PASEO_LEON = "paseo león cortés"
PASEO_NAMES = (PASEO_TURISTAS, PASEO_LEON)

MUELLE_STREET = "calle central"
# The estero pier gets its OWN street, and it has to: Calle Central SLANTS
# (x 19429..19552 over y 11507..12619), so its north end is 122 px west of the
# south end the Muelle Nacional stands on. Anchoring the twin to the Nacional's
# x put it off the end of every calle, on ground no road reaches — a pier you
# can see and never drive onto. Calle 2 runs to the estero on its own.
PITAHAYA_STREET = "calle 2 presbíterio florencio del castillo"
LEON_END_STREET = "calle 20"    # the calle at the paseo's east end

# LA ANGOSTURA — where the spit runs out and El Cocal with it. Measured off the
# finished raster rather than guessed: the peninsula's land run in the y band
# 10500..13800 falls from 1256 px at the centro to ~210 px (about 100 m) around
# x 27200..27600, then widens again into the mainland past x 30400. That neck is
# the barrio's east end, and the Cocal POIs — the Yacht Club (27266), the parque
# (27550) and the kiosco (27766) — sit right against it.
#
# It is also the cutoff for anything that must stay INSIDE the town: promoting a
# street by name matches namesakes in Chacarita and Barranca otherwise.
COCAL_END_X = 28000
