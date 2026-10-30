"""Shared geometry types.

The world speaks in FLAT coordinate lists — `[x, y, x, y, …]` — everywhere it
crosses a boundary (JSON, the renderer's Path2D helpers). Half the bytes of
`[[x, y], …]` and no per-point object to allocate on the client. These aliases
give that convention a name so a model field says what it holds.
"""
from typing import Annotated

from pydantic import Field

# [x, y, x, y, …] — an even-length flat point list
FlatPoly = Annotated[list[float], Field(description="flat [x,y,x,y,…] polygon or polyline")]
# [x, y, w, h]
Rect = Annotated[list[float], Field(min_length=4, max_length=4, description="[x,y,w,h]")]
