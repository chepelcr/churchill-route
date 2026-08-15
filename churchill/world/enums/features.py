"""The vocabulary of what the world contains.

These strings cross into the client, where a `switch` picks how to draw each
one, so a value added here without its case there falls through to a generic
pin — silently. Each enum names the file that must agree with it.

`StrEnum`: a member IS its string, so it compares, formats and JSON-encodes
exactly as the bare literal it replaces.
"""
from enum import StrEnum


class BlockLayout(StrEnum):
    """CÓMO SE REPARTE UNA CUADRA HECHA A MANO — cuatro maneras genuinamente
    distintas, no cuatro nombres para una.

    Es la juntura de `content/world/blocks.json`: el JSON escoge la estrategia y
    la parametriza, el motor la implementa. La misma línea que `SHAPE_NAMES` le
    pone al vocabulario de formas, y por la misma razón — un `layout` que nadie
    implementa NO da error: la manzana simplemente deja de existir, que es
    exactamente cómo el centro cívico se perdió una vez, con dos líneas WARN en
    un log de 900.

    Leído por churchill/world/pipeline/build_stage.py y por el validador del
    editor, que no puede volver a escribir la lista a mano."""
    #: columnas y filas con pesos; cada parte toma una banda o un tramo de
    #: bandas. El superbloque cívico y la manzana de El Carmen.
    BANDS = "bands"
    #: un cuadrilátero armado con las LÍNEAS de las calles que lo bordean, no
    #: con su caja: una manzana diagonal necesita las líneas. Los estadios.
    STREETS_QUAD = "streets-quad"
    #: cada huella mapeada se queda con el suelo más cercano y el parque es el
    #: residual. La cuadra del Parque Marino.
    FOOTPRINT_LOTS = "footprint-lots"
    #: la cuadra entera se vuelve mar abierto. El Balneario.
    WATER_INLET = "water-inlet"


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
    FUEL = "fuel"            # gasolinera: a canopy over its islands, with the pumps
    MARKET = "market"        # el Mercado Central: its own manzana, like an estadio


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
    # Drawn but never yet produced. They belong here anyway: the audit found
    # them as cases in landmarks.js with no member to authorise them, which is
    # drift in the direction nobody notices — art waiting for a value that the
    # DTO would have refused the moment a stage tried to use it.
    MUSEUM = "museum"
    ANCHOR = "anchor"


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


class SignKind(StrEnum):
    """A piece of street furniture. Drives the `switch` in `drawSign`
    (src/render/c2d/streets.js) — and an unknown kind draws NOTHING, silently,
    which is why `Sign.kind` may not stay a bare `str`: one typo in a producer
    and a junction quietly loses its lights.

    The members are what the renderer can draw, which is deliberately more than
    the build currently emits (`alto`, `banca`, `bus`, `crossing`, `semaforo`,
    `tope`). Art that exists and has no value to select it is drift too."""
    ALTO = "alto"                            # stop sign
    CEDA = "ceda"                            # yield
    SEMAFORO = "semaforo"                    # traffic light on its pole
    SEMAFORO_CENTERED = "semaforo_centered"  # on a mast over the lane
    SEMAFORO_OVERHEAD = "semaforo_overhead"  # on a gantry, two heads
    SPEED_LIMIT = "speed_limit"
    CROSSING = "crossing"                    # zebra, painted across the lane
    TOPE = "tope"                            # hump, with its yellow hatching
    BANCA = "banca"                          # a bench
    BUS = "bus"                              # a parada's caseta


class PierStyle(StrEnum):
    """Which deck `drawPier` paints (`PIER_STYLES` in c2d/structures.js). Every
    value the builder produces must have a recipe there: `malecon` shipped for a
    week without one and four bajadas were drawn as concrete muelles, complete
    with blue railings and lamps, lying on the sand."""
    CONCRETE = "concrete"
    TIMBER = "timber"
    APRON = "apron"      # a terminal's asphalt: no rails, no lamps, on the ground
    CALZADA = "calzada"  # the muelle's own access street, lane dashes and all
    MALECON = "malecon"  # a bajada onto the sand, in the promenade's pavers


class LineEnd(StrEnum):
    """Which end of a polyline a rule applies to. `Pier.seaEnd` is the one that
    hangs over open water, and it decides whether the stamp is pulled back by
    w/2 (a muelle: drivable cells past the drawn deck are where the car gets
    trapped) or left overhanging (a ferry ramp: the cap IS the overlap you board
    across). `None` means neither end — an apron on the ground."""
    FIRST = "first"
    LAST = "last"


#: PAINTING ORDER: a road with a higher rank is stroked over one with a lower,
#: so a trunk's asphalt covers the service road that runs into it instead of
#: being cut by it. Read by `ROAD_ORDER` in src/render/c2d/cache.js — which had
#: no entry for `living_street`, so such a calle would fall to `|| 0` and paint
#: UNDER the service roads. LATENT, not live: `docs/map.osm` tags no
#: living_street today, which is exactly why nobody would have found it before a
#: mapper added one. EVERY RoadClass must appear here; the vocabulary test says
#: so.
RENDER_RANK = {
    RoadClass.SERVICE: 0,
    RoadClass.PEDESTRIAN: 1,
    RoadClass.LIVING_STREET: 2,
    RoadClass.RESIDENTIAL: 2,
    RoadClass.UNCLASSIFIED: 3,
    RoadClass.TERTIARY: 4,
    RoadClass.TERTIARY_LINK: 4,
    RoadClass.SECONDARY: 5,
    RoadClass.PRIMARY_LINK: 6,
    RoadClass.PRIMARY: 7,
    RoadClass.TRUNK_LINK: 8,
    RoadClass.TRUNK: 9,
    RoadClass.PASEO: 10,
    RoadClass.BRIDGE: 11,
}

#: A street this class or wider never yields to the one crossing it — the set
#: `service/signs.py` uses to decide which end of which calle gets an ALTO.
#: The Paseo is in it: two lanes with a palm median is not something you cross
#: without stopping.
YIELDS_TO = (RoadClass.TRUNK, RoadClass.TRUNK_LINK, RoadClass.PRIMARY,
             RoadClass.PRIMARY_LINK, RoadClass.SECONDARY, RoadClass.PASEO)

#: Where ambient traffic is allowed to run at main-road speed (`MAIN_ROAD` in
#: src/game/spawns.js). NOT the same set as `YIELDS_TO`, and the audit was right
#: to flag that they had been treated as one: the Paseo de los Turistas is a
#: road you stop for and also a promenade nobody does 76 px/s down. Two names
#: because they are two questions.
TRAFFIC_MAIN = (RoadClass.TRUNK, RoadClass.TRUNK_LINK, RoadClass.PRIMARY,
                RoadClass.PRIMARY_LINK, RoadClass.SECONDARY)


class IslandKind(StrEnum):
    """A hand-placed junction fix. Both are stamped, not decorative: `median`
    blocks as acera, `cuadra` as solid land. Nothing uses them since junction
    geometry started emerging from detect_blocks — kept because the emit and
    the client still accept them."""
    MEDIAN = "median"
    CUADRA = "cuadra"


class FieldSport(StrEnum):
    """What a cancha is FOR, normalised to what the renderer can draw.

    OSM's `sport` is open-ended and semicolon-separated; this is the closed set
    `paintField` knows, and the distinction it actually makes is narrower than
    the list looks: `basketball` and `skateboard` draw a COURT (a hard rectangle
    with a centre circle) and everything else draws a PITCH (grass, mow stripes,
    fútbol markings). The other three are here because they are real values on
    this map and naming them is how a future court style gets a place to go.

    THE RAW OSM VALUE IS NOT REPLACED BY THIS — a sport the game cannot draw is
    normalised to None and SAID SO in the build log, rather than emitted and
    silently drawn as a football pitch. That is the difference between "we do
    not draw padel yet" and "padel is football"."""
    SOCCER = "soccer"
    BASKETBALL = "basketball"
    SKATEBOARD = "skateboard"
    BASEBALL = "baseball"
    TENNIS = "tennis"


#: The two that draw a COURT rather than a pitch — `paintField` in
#: src/render/c2d/streets.js. A role set, not a second enum, for the same reason
#: the road roles are: it answers one question about the members.
COURT_SPORTS = frozenset({FieldSport.BASKETBALL, FieldSport.SKATEBOARD})
