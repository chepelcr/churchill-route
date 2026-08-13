"""The vocabulary the world EDITOR writes and the game reads back.

The editor is a separate repo, which is exactly why these belong here. It
authors features into `content.json`; the game and the builder consume them. If
the two ends keep their own spelling of `polygon` or `modify`, the failure is
the one this layer exists to stop — a feature that validates, saves, ships, and
then matches no branch at the far end.

The editor already consumes `src/assets/vocabulary.generated.json` and refuses
to start without it, so adding a member here is how its validator learns a new
value; it may not invent one.
"""
from enum import StrEnum


class HostKind(StrEnum):
    """What a feature is anchored TO. An authored element may declare a host,
    and the containment check ("is it still inside?") is the editor's, the
    server's and the builder's — three places, one vocabulary.

    `HOST_KINDS` in world-editor/src/hosts.js, the `/api/validate` shape check
    in its vite.config.js, and the NPC standing rules in its npcs.js."""
    CUADRA = "cuadra"
    PARCEL = "parcel"
    LANDMARK = "landmark"
    STADIUM = "stadium"
    GREEN = "green"


class GeometryKind(StrEnum):
    """How a feature is drawn on the map, and which payload field carries it:
    `point` -> `geometry.point`, the other two -> `geometry.points`.

    Read by the editor's per-type geometry table and its validator, and by
    `featureAnchor`/`featureNear` in src/game/physics.js — which branch on
    `point` and treat everything else as a vertex list."""
    POINT = "point"
    LINE = "line"
    POLYGON = "polygon"


class EditorOperation(StrEnum):
    """Whether an authored feature ADDS something to the generated world or
    REPLACES something already in it. `modify` carries a source reference and
    means the generated element is suppressed in its favour, so the two are not
    interchangeable — the semantics are closed and validated
    (world-editor/vite.config.js, `featureSourceRef` in its main.js)."""
    ADD = "add"
    MODIFY = "modify"
