"""Enum layer — the world's vocabulary, and the lowest layer of all.

Everything else imports from here: config builds its class constants out of
Surface, the DTOs type their fields with these, services compare against them,
and the emitted JSON carries their values verbatim.

Two things every enum here must respect, because these values LEAVE the
process — into src/world2d/*.json and from there into the client:

  * the value is the wire format. Surface members are the bytes in the RLE;
    the string enums are what a `switch` in src/render/c2d/ matches on. Renaming
    a member is free, changing its VALUE is a world change.
  * they are `IntEnum`/`StrEnum`, so a member IS an int or a str. It indexes a
    bytearray, compares to a raw value read back from JSON, and serialises with
    no encoder help. Nothing downstream can tell it apart from the literal.
"""
from .features import (
    GreenType, IslandKind, LandmarkType, ParcelUse, PathSurface, RoadClass,
    Weather,
)
from .surface import CLASS_NAMES, Surface

__all__ = [
    "CLASS_NAMES", "GreenType", "IslandKind", "LandmarkType", "ParcelUse",
    "PathSurface", "RoadClass", "Surface", "Weather",
]
