"""Sponsored lotes — the commercial side of the world.

A *lote* is a place a real business can claim: either a building footprint from
the catalog, or a parcel `slot` the world reserved. The catalog is an ADMIN
artifact (docs/lotes_catalog.json), not shipped — a sponsor picks an id from it
and the claim goes into content.json, which the app fetches at runtime, so a new
sponsor needs no release.

These models are the reason the DTO layer exists at all: when accounts and
device sync get a server, a lote claim is a row that points at one of these ids,
and the API returns THIS model rather than describing it again.
"""
from pydantic import Field

from .world import WorldModel


class Lote(WorldModel):
    """A claimable spot. `id` is a hash of the rounded centroid, so it survives
    a world rebuild as long as the geometry does not move."""
    id: str = Field(pattern=r"^L-[0-9a-f]{8}$")
    x: int
    y: int
    lat: float
    lon: float
    w: int
    h: int
    district: str | None = None


class LoteCatalog(WorldModel):
    generated_from: str
    playable_max_x: int
    count: int
    lotes: list[Lote]
