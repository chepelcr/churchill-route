"""Storage Protocols — the seam between the domain and where bytes live.

Every read and write in the pipeline goes through one of these. Today the
implementations are files (docs/map.osm in, src/world2d/*.json out); the reason
they are Protocols is what comes next: accounts, device sync and sponsored
lotes need the same shape with a database or an HTTP API behind it, and a
service that only knows `WorldSink` does not care which it got.

Structural typing (typing.Protocol), not inheritance: an implementation just has
to have the methods, so a test double is a small class, not a subclass.
"""
from typing import Protocol, runtime_checkable

from ..dto import Manifest


@runtime_checkable
class OsmSource(Protocol):
    """Where the raw map comes from."""

    def load(self) -> tuple[dict, list, list, list, list]:
        """-> (nodes, ways, named, relations, poi_nodes)."""
        ...


@runtime_checkable
class WorldSink(Protocol):
    """Where the built world goes."""

    def clear_tiles(self) -> None: ...

    def write_tile(self, tc: int, tr: int, tile: dict) -> None: ...

    def write_manifest(self, manifest: dict) -> None:
        """Persist the manifest. Implementations VALIDATE against the DTO first:
        a missing field is a bug that must fail the build, not ship."""
        ...

    def total_bytes(self) -> int: ...


@runtime_checkable
class WorldSource(Protocol):
    """Reading a built world back — the inventory, a management API, tests."""

    def read_manifest(self) -> Manifest: ...

    def read_tile(self, tc: int, tr: int) -> dict: ...
