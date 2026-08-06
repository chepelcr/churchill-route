"""The world's entities, as Pydantic models.

These are the CONTRACT for what the builder emits and the game reads — and the
same models a controller will return once accounts and sponsored lotes have a
server (`Parcel.slot` is literally the rect a sponsor's art fills, so a lote
record points at a parcel id).

Two rules they all follow:

* `extra="allow"`. The emitted objects are heterogeneous by design — a landmark
  carries `pools` only if it is the Parque Marino, a parcel `whole` only if it
  is a whole cuadra — and a model that rejected unknown keys would make every
  new feature a schema migration. Validation is here to catch what is MISSING
  or MISTYPED, not to police what is extra.
* They validate the emit; they do not serialize it. The emitted key order is
  historical and differs between producers of the same type (a feature parcel
  writes `use` before `name`, a block parcel after), so dumping from a model
  would rewrite every file. Normalising that is a deliberate world change, not
  a side effect of adding types — see tools/world_snapshot.py.
"""
from pydantic import BaseModel, ConfigDict, Field

from ..enums import GreenType, LandmarkType, ParcelUse, PathSurface, Weather
from .geo import FlatPoly, Rect


class WorldModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Geo(WorldModel):
    """geo→world affine: x = ax·lon + bx, y = ay·lat + by.

    Ships in the manifest so a CLIENT can place remote content (a server NPC, a
    sponsored lote) from real lat/lon without the projection code.
    """
    ax: float
    bx: float
    ay: float
    by: float


class Meta(WorldModel):
    W: int
    H: int
    centerY: int
    cell: int = Field(description="raster cell size in world px")
    cuad: int = Field(description="px per cuadrícula, the base city tile")
    cuadsPerView: int = Field(description="advisory; the renderer owns the framing")
    aceraPx: int
    pxPerMeter: float
    geo: Geo | None = None
    tilePx: int
    tileCells: int
    tileCols: int
    tileRows: int


class GridInfo(WorldModel):
    cols: int
    rows: int
    classes: list[str] = Field(description="index -> surface class name")


class District(WorldModel):
    id: str
    name: str
    short: str | None = None
    tone: str
    x0: int
    x1: int
    y0: int = 0
    y1: int
    poly: FlatPoly


class Landmark(WorldModel):
    """A placed POI. `type` drives how the renderer draws it, so an unknown type
    silently falls through to the generic pin — keep it in sync with the
    switch in src/render/c2d/landmarks.js.
    """
    id: str
    name: str
    x: int
    y: int
    type: LandmarkType
    district: str
    w: int | None = None
    h: int | None = None
    # NOT a flag: the build-authored player start [x, y], snapped to the
    # nearest drivable street. The kiosk's own x/y is its beach-facing icon, and
    # spawning there dropped the car on the sand.
    spawn: list[int] | None = Field(default=None, min_length=2, max_length=2)
    footprint: FlatPoly | None = Field(default=None, description="drawn shape (a pitch)")
    outline: FlatPoly | None = Field(default=None, description="whole drivable cuadra")


class Customer(WorldModel):
    id: str
    name: str
    x: int
    y: int
    district: str
    line: str = Field(description="what they say when you deliver")


class Stage(WorldModel):
    """A level. `kind` is what it ASKS of you: a delivery stage (the default)
    or a `crossing`, which has no kiosks and no customers because the level is
    the passage itself."""
    id: str
    num: int
    name: str
    district: str
    brief: str
    kiosks: list[str]
    targetDeliveries: int
    timeLimit: int
    weather: Weather
    customers: list[str]
    unlock: str | None = None
    kind: str = Field(default="delivery", description="delivery | crossing")
    ferry: str | None = Field(default=None, description="which boat a crossing sails")


class Parcel(WorldModel):
    """A named piece of a cuadra — and the unit of sponsorship.

    `slot` is a rect INSIDE the parcel that a remote `lote` can claim: the world
    owns its position and size, so nothing a sponsor sends can cover a street or
    dwarf the block. `ang` is the manzana's own angle (radians), which
    everything drawn on the parcel rotates by — see the recipe in CLAUDE.md.
    """
    id: str
    name: str
    use: ParcelUse
    poly: FlatPoly
    cx: int
    cy: int
    x0: int
    y0: int
    x1: int
    y1: int
    slot: Rect
    ang: float = Field(default=0.0, description="manzana angle in radians")
    # Half-extents in the parcel's OWN frame. Everything drawn on a parcel used
    # to size itself off the axis-aligned bbox, which on a turned parcel is
    # bigger than the parcel — so the art spilled over its own kerb.
    hw: float | None = Field(default=None, description="half-width along ang")
    hh: float | None = Field(default=None, description="half-height along ang")
    sport: str | None = Field(default=None, description="a cancha's sport, from OSM")
    whole: bool | None = Field(default=None, description="a whole cuadra; ground already painted")
    built: bool | None = Field(default=None, description="the footprint IS a building")
    # Civic furniture the renderer draws ON the parcel. The world only says
    # WHICH parcel has one and roughly where; what a river or a statue looks
    # like belongs to src/render/c2d/landmarks.js.
    river: bool | None = Field(default=None, description="a stream + footbridge crosses this park")
    statue: str | None = Field(default=None, description="statue kind, e.g. 'virgen'")
    kiosco: bool | None = Field(default=None, description="the old round bandstand of a parque central")
    bus: Rect | None = Field(default=None, description="[x, y, w, h] bus stop on the acera outside this parcel")
    lm: str | None = Field(default=None, description="landmark id this parcel IS; the landmark pass draws only its pill")
    # WHAT STANDS ON THIS GROUND. The world computed the pairing every build and
    # threw it away; written down, assigning a building to a plot is an edit.
    buildingRef: str | None = Field(default=None, description="content-addressed id of the building this parcel IS")

    @property
    def sponsorable(self) -> bool:
        return bool(self.slot)


class Ferry(WorldModel):
    """A ferry berth and the line it sails.

    Both come straight out of OSM — the `amenity=ferry_terminal` node and the
    `route=ferry` way — with the route ORIENTED to start at the berth and cut to
    a short scenic loop. The real crossing ends on the Nicoya side, where this
    world has no shore to arrive at.

    `deck` and `dockS` are here because THE BUILD NEEDS THEM TOO: the boarding
    ramp has to reach the stern at rest, and where the stern is at rest is a
    function of all three (service/ferry.py `stern_at_rest`). The client reads
    them back off the manifest instead of keeping a second copy.
    """
    id: str
    name: str
    berth: list[int]
    ang: float = Field(default=0.0, description="heading out of the berth, radians")
    deck: list[int] = Field(default=[124, 46], description="[length, width] in world px")
    dockS: float = Field(default=28.0, description="px seaward of the berth node she lies")
    route: FlatPoly


class Stadium(WorldModel):
    x0: int
    y0: int
    x1: int
    y1: int
    cx: int
    cy: int
    footprint: FlatPoly = Field(description="the drawn pitch")
    outline: FlatPoly = Field(description="the whole drivable cuadra")
    # The pitch's own frame. The match sim places the goals off it, and the
    # renderer draws the markings in it instead of fitting the traced polygon.
    ang: float = Field(default=0.0, description="pitch angle in radians")
    hw: float | None = Field(default=None, description="half-width along ang")
    hh: float | None = Field(default=None, description="half-height along ang")
    sport: str | None = Field(default=None, description="drives the markings + the match")
    aceras: bool = Field(default=True, description="pitch is inset from a visible sidewalk ring")


class Sign(WorldModel):
    """A piece of street furniture. `kind` drives `drawSign` in
    src/render/c2d/streets.js — an unknown kind draws nothing."""
    x: int
    y: int
    kind: str
    ang: float = 0.0


class Green(WorldModel):
    pts: FlatPoly
    type: GreenType


class MaleconBand(WorldModel):
    """One contiguous piece of the paved sea front (`Surface.MALECON`).

    `polys` is every boundary ring straight off the raster — a band can have
    holes where a bajada or a kiosk pad interrupts it — so the renderer fills it
    even-odd and the drawn paving is exactly the paving you drive on. `ang` is
    the Paseo's own angle at the band's centre, which is what lets the courses
    run with the coast instead of with the screen.
    """
    polys: list[FlatPoly]
    ang: float = 0.0
    x0: int
    y0: int
    x1: int
    y1: int
    cells: int = 0


class Attraction(WorldModel):
    """A ride on the malecón — or the DJ outside La Takería.

    `kind` drives a `switch` in src/render/c2d/attractions.js, and an unknown
    one draws nothing rather than a generic pin: a feria is art, not a marker.
    Nothing here is stamped into the raster, so `r` is a DRAWN radius only.
    """
    id: str
    name: str
    kind: str
    x: int
    y: int
    r: int = 24


class KioskPath(WorldModel):
    """A short paved connector from something standing on the sand to the street
    it is reached from: a beach kiosk, or a ferry berth. Both exist for the same
    reason — sand is a wall to the car, so without a ramp the thing is visible
    and unreachable."""
    pts: FlatPoly
    surface: PathSurface


class Poi(WorldModel):
    """A named real-world place from OSM. 1160 of them — debug overlay only at
    play zoom, but the raw material for business listings later."""
    x: int
    y: int
    name: str
    cat: str


class Hill(WorldModel):
    x0: int
    x1: int
    baseY: int
    color: str


class Bridge(WorldModel):
    x0: int
    x1: int
    cy: int
    deckW: int
    towers: list[int]
    towerH: int
    pts: FlatPoly


class Estuary(WorldModel):
    cx: int
    cy: int
    rx: int
    ry: int


class Pier(WorldModel):
    """A muelle: a polyline the car may drive on, over open water.

    It is shaped like a road on purpose — `pts` + `w` — because that is what
    makes it authorable: move it, extend it, or draw a third one. `seaEnd` names
    the end that hangs over the water, which is the end whose stamp has to be
    pulled back by w/2 (service/pier.py explains why).
    """
    id: str
    name: str
    pts: FlatPoly
    w: int
    style: str = Field(default="concrete", description="which deck the renderer draws")
    surface: PathSurface | str = Field(default="bridge", description="stamped surface class")
    seaEnd: str | None = Field(default="last", description="'first', 'last' or null")


class Balneario(WorldModel):
    x0: int
    y0: int
    x1: int
    y1: int
    cx: int
    cy: int



