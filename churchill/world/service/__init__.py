"""Service layer — the domain operations, composed from util and fed by
repositories. A service takes what it needs as arguments (a raster, a road
list, the collections it appends to); it does not reach for globals, which is
what makes it callable from a stage, from a test, or later from an API route.
"""
from .block import (
    block_raster_cells, cells_to_rects, cuadra_cells, detect_blocks, outline_poly,
)
from .building import make_rng, snap_osm_buildings, synth_buildings
from .decoration import paseo_median_runs, paseo_roads, stamp_paseo_median
from .field import FieldService
from .network import block_census, largest_drivable_component, verify_connectivity
from .projection import PlanarProjection, project_way_pts
from .street import StreetIndex, half_plane, resample_centerline
from .surface import (
    acera_fringe, beach_fringe, raster_coast_barrier, raster_poly_barrier,
    stamp_pad, trace_land_contours,
)

__all__ = [
    "FieldService", "PlanarProjection", "StreetIndex", "acera_fringe",
    "block_census", "cells_to_rects", "detect_blocks", "paseo_median_runs",
    "paseo_roads", "stamp_paseo_median",
    "largest_drivable_component", "verify_connectivity",
    "beach_fringe", "block_raster_cells", "cuadra_cells", "half_plane",
    "make_rng", "outline_poly", "project_way_pts", "raster_coast_barrier",
    "raster_poly_barrier", "resample_centerline", "snap_osm_buildings",
    "stamp_pad", "synth_buildings", "trace_land_contours",
]
