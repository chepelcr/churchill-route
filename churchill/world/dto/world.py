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
    whole: bool | None = Field(default=None, description="a whole cuadra; ground already painted")
    built: bool | None = Field(default=None, description="the footprint IS a building")
    # Civic furniture the renderer draws ON the parcel. The world only says
    # WHICH parcel has one and roughly where; what a river or a statue looks
    # like belongs to src/render/c2d/landmarks.js.
    river: bool | None = Field(default=None, description="a stream + footbridge crosses this park")
    statue: str | None = Field(default=None, description="statue kind, e.g. 'virgen'")
    bus: Rect | None = Field(default=None, description="[x, y, w, h] bus stop on the acera outside this parcel")

    @property
    def sponsorable(self) -> bool:
        return bool(self.slot)


class Stadium(WorldModel):
    x0: int
    y0: int
    x1: int
    y1: int
    cx: int
    cy: int
    footprint: FlatPoly = Field(description="the drawn pitch")
    outline: FlatPoly = Field(description="the whole drivable cuadra")


class Green(WorldModel):
    pts: FlatPoly
    type: GreenType


class KioskPath(WorldModel):
    """The walk from a beach kiosk to the street it is reached from."""
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
    x: int
    y0: int
    y1: int
    w: int


class Balneario(WorldModel):
    x0: int
    y0: int
    x1: int
    y1: int
    cx: int
    cy: int


class FaroPier(WorldModel):
    x0: int
    y0: int
    x1: int
    y1: int
    w: int
