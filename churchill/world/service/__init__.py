"""Service layer — the domain operations, composed from util and fed by
repositories. A service takes what it needs as arguments (a raster, a road
list, a sink); it does not reach for globals, which is what makes it callable
from a stage, a test, or later an API route.
"""
from .street import StreetIndex, half_plane, resample_centerline

__all__ = ["StreetIndex", "half_plane", "resample_centerline"]
