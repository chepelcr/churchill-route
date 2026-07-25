"""Pipeline layer — the ordered stages that build a world.

    extract_world()   read the OSM source, project it, pull out the features
    ...               (the middle phases still live in tools/build_world.py)
    verify()          the gate: every POI reachable, or the build fails
    write_world()     tiles + manifest + the debug renders

A stage takes the world under construction, does one phase, and logs what it
did — the build log is the review surface, so a stage that places 47 things
says so.
"""
from .emit import emit_world2d
from .extract import extract_world
from .finish import build_meta, geo_affine, verify, write_world

__all__ = [
    "build_meta", "emit_world2d", "extract_world", "geo_affine", "verify",
    "write_world",
]
