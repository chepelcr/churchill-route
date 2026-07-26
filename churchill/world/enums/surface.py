"""The surface grid's vocabulary.

Every cell of the world is one byte holding one of these. The VALUES ARE THE
WIRE FORMAT: they index `manifest.grid.classes`, they are what the RLE encodes,
and `src/game/surfaces.js` mirrors them on the client. Renumbering one silently
repaints the whole map and changes what the car can drive on — add at the end,
never in the middle.

`IntEnum`, deliberately: a member IS an int, so it can be written straight into
a `bytearray`, compared to a raw cell, and JSON-encoded as the number it always
was. Nothing downstream can tell the difference.
"""
from enum import IntEnum


class Surface(IntEnum):
    WATER = 0
    LAND = 1     # solid cuadra interior — a WALL in physics, not walkable ground
    BEACH = 2
    ROAD = 3
    PASEO = 4
    BRIDGE = 5   # bridge deck and pier deck
    ACERA = 6    # sidewalk
    BOULEVARD = 7  # sub-auxiliary calle peatonal: stone paving, transitable

    @property
    def label(self) -> str:
        """The name the client reads out of `manifest.grid.classes`."""
        return self.name.lower()


#: index -> name, exactly as it ships in the manifest
CLASS_NAMES = [s.label for s in Surface]

#: What a vehicle may drive on. BEACH is included on purpose — the sand is
#: slow (see SURFACE_MUL on the client), not a wall. So is BOULEVARD: a calle
#: peatonal here is paving you may cross, not a barrier — you just crawl.
DRIVABLE = (Surface.ROAD, Surface.PASEO, Surface.BRIDGE, Surface.BEACH,
            Surface.BOULEVARD)

#: What counts as "a street is on the other side of this edge" when eroding an
#: acera. A cuadra edge facing the sea, the sand or the next parcel has no
#: sidewalk — see the directional erosion in util.raster.
STREET = (Surface.ROAD, Surface.PASEO, Surface.BRIDGE, Surface.ACERA,
          Surface.BOULEVARD)

#: Blocks the car: the cuadra interiors and the sidewalks around them.
WALL = (Surface.LAND, Surface.ACERA)
