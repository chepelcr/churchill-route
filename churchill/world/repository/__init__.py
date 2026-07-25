"""Repository layer — the only code that touches storage.

Protocols in base.py, file implementations beside them. A service takes a
`WorldSink`, never a path, which is what will let the accounts/sync service
swap JSON for a database without a domain change.
"""
from .base import OsmSource, WorldSink, WorldSource
from .world_json import JsonWorldRepository

__all__ = ["JsonWorldRepository", "OsmSource", "WorldSink", "WorldSource"]
