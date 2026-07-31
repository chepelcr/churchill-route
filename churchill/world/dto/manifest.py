"""The two files the world IS: the manifest, and a tile.

`manifest.json` is small and eager — world size, tiling, districts, POIs and the
backdrop polygons. Everything heavy (the surface RLE, roads, buildings, flora)
lives in `tiles/<tc>_<tr>.json` and streams by camera region: the full planar
grid is ~101M cells and cannot be held whole on a phone.
"""
from pydantic import Field

from .geo import FlatPoly
from .world import (
    Balneario, Bridge, Customer, District, Estuary, FaroPier, Ferry, Green,
    GridInfo, Hill, KioskPath, Landmark, Meta, Parcel, Pier, Poi, Sign, Stadium,
    Stage, WorldModel,
)


class Manifest(WorldModel):
    meta: Meta
    grid: GridInfo
    districts: list[District]
    landmarks: list[Landmark]
    customers: list[Customer]
    stages: list[Stage]
    bridge: Bridge | None = None
    estuary: Estuary | None = None
    pier: Pier | None = None
    hills: list[Hill] = Field(default_factory=list)
    beaches: list[FlatPoly] = Field(default_factory=list)
    waters: list[FlatPoly] = Field(default_factory=list)
    landPolys: list[FlatPoly] = Field(default_factory=list)
    # [x, y, w, h, kind] ground rects — colour under the land base, so a park is
    # green before its tile arrives
    plazas: list[list] = Field(default_factory=list)
    greens: list[Green] = Field(default_factory=list)
    stadiums: list[Stadium] = Field(default_factory=list)
    balneario: Balneario | None = None
    kioskPaths: list[KioskPath] = Field(default_factory=list)
    faroPier: FaroPier | None = None
    pois: list[Poi] = Field(default_factory=list)
    parcels: list[Parcel] = Field(default_factory=list)
    ferries: list[Ferry] = Field(default_factory=list)
    signs: list[Sign] = Field(default_factory=list)
    # Present only when a semantic editor patch participated in the build.
    # Unknown/future entity kinds are retained here until their runtime catalog
    # knows how to consume them.
    editorPatch: dict | None = None
    editorFeatures: list[dict] = Field(default_factory=list)
    editorUI: dict = Field(default_factory=dict)
    cuadras: list[dict] = Field(default_factory=list)
    surfaceStyles: list[dict] = Field(default_factory=list)

    def parcel(self, parcel_id: str) -> Parcel | None:
        return next((p for p in self.parcels if p.id == parcel_id), None)


class Tile(WorldModel):
    """One streamed slab. `rle` is (count, class) byte pairs, base64'd.

    A feature whose bbox straddles a border is written into EVERY tile it
    overlaps, so anything counting features across tiles must de-duplicate by
    geometry (see tools/gen-inventory.mjs).
    """
    tc: int
    tr: int
    x: int
    y: int
    cols: int
    rows: int
    rle: str
    roads: list[dict] = Field(default_factory=list)
    rails: list[dict] = Field(default_factory=list)
    medians: list[dict] = Field(default_factory=list)
    buildings: list[dict] = Field(default_factory=list)
    trees: list[dict] = Field(default_factory=list)
    palms: list[dict] = Field(default_factory=list)
    mangroves: list[dict] = Field(default_factory=list)
    islands: list[dict] = Field(default_factory=list)
