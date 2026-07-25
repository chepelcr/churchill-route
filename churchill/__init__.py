"""La Ruta del Churchill — Python side of the project.

Two packages share one set of models:

    churchill.world    the offline pipeline that turns docs/map.osm into the
                       world the game streams (src/world2d/)
    churchill.server   (later) accounts, cross-device sync and the management
                       API — it reuses churchill.world.dto and the repository
                       Protocols instead of redefining the schema

The layering inside each: dto (Pydantic models = the contracts), util (pure
functions), repository (the ONLY code that touches storage), service (domain
operations), pipeline (ordered stages). Nothing below a layer imports the one
above it.
"""
__version__ = "2.0.0"
