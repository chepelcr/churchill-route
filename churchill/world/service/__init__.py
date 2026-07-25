"""Service layer — the domain operations, composed from util and fed by
repositories. A service takes what it needs as arguments (a raster, a road
list, the collections it appends to); it does not reach for globals, which is
what makes it callable from a stage, from a test, or later from an API route.
"""
from .block import block_raster_cells, cuadra_cells, outline_poly
from .building import make_rng, snap_osm_buildings, synth_buildings
from .field import FieldService
from .street import StreetIndex, half_plane, resample_centerline

__all__ = [
    "FieldService", "StreetIndex", "block_raster_cells", "cuadra_cells",
    "half_plane", "make_rng", "outline_poly", "resample_centerline",
    "snap_osm_buildings", "synth_buildings",
]
