"""DTO layer — Pydantic models that define the emitted JSON's schema.

Shared, deliberately, with the future server: a controller returning a Parcel
or a Stage imports it from here rather than describing it again. See
churchill.world.dto.world for the two rules every model follows (extra="allow",
and validate-don't-serialize).
"""
from .geo import FlatPoly, Rect
from .lote import Lote, LoteCatalog
from .manifest import Manifest, Tile
from .world import (
    Balneario, Bridge, Customer, District, Estuary, Geo, Green,
    Ferry, GridInfo, Hill, KioskPath, Landmark, Meta, Parcel, Pier, Sign, Poi, Sign, Stadium,
    Stage, WorldModel,
)

__all__ = [
    "Balneario", "Bridge", "Customer", "District", "Estuary",
    "FlatPoly", "Geo", "Green", "GridInfo", "Hill", "KioskPath", "Landmark",
    "Lote", "LoteCatalog",
    "Ferry", "Manifest", "Meta", "Parcel", "Pier", "Poi", "Rect", "Stadium", "Stage",
    "Tile", "WorldModel",
]
