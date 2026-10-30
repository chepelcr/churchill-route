"""The world pipeline: docs/map.osm -> src/world2d/ (manifest + 416 tiles).

Layers, top to bottom — nothing imports the layer above it:

    config / content   the knobs, and the hand-authored map content
    dto                Pydantic models: the emitted JSON's schema, shared with
                       the future server so a route never redefines a Parcel
    util               pure functions (geometry, raster grid, spatial hash)
    repository         the only code that touches storage (OSM in, JSON out)
    service            domain operations (streets, blocks, buildings, fields)
    pipeline           the ordered stages, and the runner that composes them

Determinism is a hard requirement: same OSM in, byte-identical world out
(tools/world_snapshot.py).
"""
