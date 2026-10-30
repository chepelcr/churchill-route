"""Repository layer — the only code that touches storage.

Protocols in base.py, implementations beside them: an .osm export in, the tiled
world out, plus the debug renders. A service takes a `WorldSink`, never a path,
which is what will let the accounts/sync service swap JSON for a database
without a domain change.
"""
from .base import OsmSource, WorldSink, WorldSource
from .debug_render import render_debug, write_png
from .osm_file import OsmFileRepository, parse_osm, poi_category
from .world_json import JsonWorldRepository

__all__ = [
    "JsonWorldRepository", "OsmFileRepository", "OsmSource", "WorldSink",
    "WorldSource", "parse_osm", "poi_category", "render_debug", "write_png",
]
