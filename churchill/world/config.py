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
DEBUG_PNG = os.path.join(ROOT, "tools", "debug_map.png")
DEBUG_SVG = os.path.join(ROOT, "tools", "debug_features.svg")
# chunked output — the tiled world the src/world2d accessor streams by camera
# region (416 tiles + manifest.json).
WORLD2D_DIR = os.path.join(ROOT, "src", "world2d")

# World SIZE is not a knob: it is computed from the OSM bounds at build time
# (see _planar_setup) and lives with the grid, not here.
CROSS_EXAG = 1.95               # emitted in meta.crossExag; nothing reads it
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
PLANAR_PX_PER_M = float(os.environ.get("PLANAR_PX_PER_M", "1.6"))   # world zoom
ARCADE_STREET_MUL = float(os.environ.get("ARCADE_STREET_MUL", "3.2"))  # widen streets
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

BUILDING_SCALE = 1.4            # match footprints to exaggerated road widths
POI_NUDGE_PX = 600

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
SERVICE_MIN_PX = 120
DP_ROAD_PX = 1.0
DP_BUILDING_PX = 2.0
DP_COAST_PX = 2.5
MIN_BUILDING_AREA_PX2 = 216

# Surface classes come from the enum layer; these aliases are what the builder
# has always called them (a member IS its int, so nothing else changes).
CLS_WATER = Surface.WATER
CLS_LAND = Surface.LAND
CLS_BEACH = Surface.BEACH
CLS_ROAD = Surface.ROAD
CLS_PASEO = Surface.PASEO
CLS_BRIDGE = Surface.BRIDGE
CLS_ACERA = Surface.ACERA
ACERA_CELLS = CUAD_CELLS        # sidewalk depth: 1 cuadrícula (20 px) each side
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

# ---- buildings on the cuadrícula --------------------------------------------
SYNTH_MAX_TOTAL = 80000         # cap on real + synthesized buildings (raised so
                                # fully-filled small cuadras don't exhaust it
                                # mid-map and leave far blocks empty)
SYNTH_SEED = 77
BLDG_INSET = 2                  # px seam per side so adjacent roofs don't fuse
FRONTAGE_DEPTH = 3              # buildable band (CUADs) from the block edge
SMALL_BLOCK_CUADS = 120         # blocks <= this many cuadrículas fill completely
                                # (dense town); bigger ones keep patio interiors
OSM_MAX_CUADS = 4               # cap OSM footprints at 4x4 cuadrículas
# weighted synth footprint mix (w x h in cuadrículas)
SYNTH_LOTS = [((2, 2), 0.25), ((2, 1), 0.20), ((1, 2), 0.20),
              ((1, 1), 0.30), ((3, 2), 0.05)]
