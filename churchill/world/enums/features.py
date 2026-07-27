"""The vocabulary of what the world contains.

These strings cross into the client, where a `switch` picks how to draw each
one, so a value added here without its case there falls through to a generic
pin — silently. Each enum names the file that must agree with it.

`StrEnum`: a member IS its string, so it compares, formats and JSON-encodes
exactly as the bare literal it replaces.
"""
from enum import StrEnum


class ParcelUse(StrEnum):
    """A named piece of a cuadra. Drawn by `paintParcels`/`drawParcels` in
    src/render/c2d/ — and `PARCEL_FILL` there must have a colour for each."""
    CHURCH = "church"
    CATHEDRAL = "cathedral"  # stone, grey and much larger than a parish church
    GARDEN = "garden"
    PARK = "park"            # a garden with civic furniture (river, statue…)
    PLAZA = "plaza"
    STADIUM = "stadium"      # an open field: gets the estadio's own pitch painter
    BOULEVARD = "boulevard"  # calle peatonal: stone paving, transitable (Surface.BOULEVARD)
    CIVIC = "civic"          # a public building drawn to fill the parcel
    LOT = "lot"              # a feature parcel derived from a real footprint
    SCHOOL = "school"        # escuela / liceo: a yard with a building along one edge
    KINDER = "kinder"        # jardín de niños / CEN-CINAI: a small school with a patio
    CAMPUS = "campus"        # colegio / universidad: several pavilions on open grounds


class GreenType(StrEnum):
    """A green cuadra's fill. Colour + dilation per type in `GREEN_COLORS` /
    `drawGreenPoly` (src/render/c2d/ground.js): parks tuck 28 px under the acera
    band, `pool`/`stadium` draw the EXACT cuad edge."""
    PARK = "park"
    PLAZA = "plaza"
    POOL = "pool"
    STADIUM = "stadium"
    MARINE = "marine"
    ESPLANADE = "esplanade"  # ground rects in `plazas`, not `greens`


class LandmarkType(StrEnum):
    """Drives the `switch` in src/render/c2d/landmarks.js. An unknown type
    reaches the default branch and draws as a generic pin."""
    KIOSK = "kiosk"          # a churchill stand: where a delivery starts
    FERRY = "ferry"
    CRUISE = "cruise"
    PORT = "port"
    MARINA = "marina"
    TRAINSTATION = "trainstation"
    LIGHTHOUSE = "lighthouse"
    CHURCH = "church"
    CATHEDRAL = "cathedral"
    MARKET = "market"
    SUPER = "super"
    RESTAURANT = "restaurant"
    HOTEL = "hotel"
    HOUSE = "house"
    CIVIC = "civic"
    PARK = "park"
    POOL = "pool"
    STADIUM = "stadium"
    BEACHSIGN = "beachsign"
    SIGN = "sign"
    BRIDGE = "bridge"
    ESTUARY = "estuary"
    HIGHWAY = "highway"
    VILLAGE = "village"


class PathSurface(StrEnum):
    """How a beach kiosk's access path is drawn (src/render/c2d/ground.js)."""
    PAVED = "paved"
    SAND = "sand"


class Weather(StrEnum):
    """A stage's weather. Read by the sim (grip, melt rate, rain) and the
    renderer (light, lit windows) — src/game/physics.js and c2d/structures.js."""
    SUNNY = "sunny"
    SUNSET = "sunset"
    STORM = "storm"          # wet asphalt: less grip, faster melt, rain
    NIGHT = "night"


class RoadClass(StrEnum):
    """OSM highway classes the builder keeps. Width per class is
    config.ROAD_WIDTH_M; `paseo` and `bridge` are ours, not OSM's."""
    TRUNK = "trunk"
    TRUNK_LINK = "trunk_link"
    PRIMARY = "primary"
    PRIMARY_LINK = "primary_link"
    SECONDARY = "secondary"
    TERTIARY = "tertiary"
    TERTIARY_LINK = "tertiary_link"
    RESIDENTIAL = "residential"
    UNCLASSIFIED = "unclassified"
    LIVING_STREET = "living_street"
    SERVICE = "service"
    PEDESTRIAN = "pedestrian"
    PASEO = "paseo"
    BRIDGE = "bridge"


class IslandKind(StrEnum):
    """A hand-placed junction fix. Both are stamped, not decorative: `median`
    blocks as acera, `cuadra` as solid land. Nothing uses them since junction
    geometry started emerging from detect_blocks — kept because the emit and
    the client still accept them."""
    MEDIAN = "median"
    CUADRA = "cuadra"
