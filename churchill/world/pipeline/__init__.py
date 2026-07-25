"""Pipeline layer — the ordered stages that build a world, and the runner that
composes them. A stage takes the world under construction, does one phase of
work, and logs what it did; the build log is the review surface.
"""
from .emit import emit_world2d

__all__ = ["emit_world2d"]
