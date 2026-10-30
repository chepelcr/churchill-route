"""The NPC registry, read from the game's `src/game/npcTypes.json`.

The registry lives in the GAME, not here, for the same reason the theme tokens
do: it is what the runtime spawns from, and a second copy would be a second
truth. The build reads it to answer ONE question the editor cannot —

    MAY THIS TYPE STAND HERE?

The editor validates the SHAPE of an authored NPC (does the type exist, is the
host kind spelled right); only the build has the finished surface raster, so
only the build can say that the swimmer somebody dropped is on asphalt. Same
split as `properties.host`, and for the same reason.

A `hosts` entry is either a SURFACE class name (`water`, `acera`, …) or a host
reference `kind` / `kind:use` (`parcel`, `parcel:stadium`). An entry that is
neither matches nothing, rather than quietly matching everything.
"""
import json
import os

from ..config import GAME_ROOT
from ..enums import Surface

NPC_TYPES_PATH = os.path.join(GAME_ROOT, "src", "game", "npcTypes.json")

_SURFACE_BY_NAME = {surface.label: surface for surface in Surface}


def load_npc_types(path=NPC_TYPES_PATH):
    """{id: type} — empty when the registry is absent, so a checkout without it
    still builds the unedited world."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as source:
        registry = json.load(source)
    return {entry["id"]: entry for entry in registry.get("types", []) if entry.get("id")}


def may_stand(npc_type, surface, host=None, host_use=None):
    """(ok, allowed) for one placement.

    `surface` is the raster class under the point, `host` the feature's declared
    host kind and `host_use` that host's `use` when it has one.
    """
    hosts = (npc_type or {}).get("hosts") or []
    if not hosts:
        return True, hosts
    for entry in hosts:
        kind, _, use = str(entry).partition(":")
        wanted = _SURFACE_BY_NAME.get(kind)
        if wanted is not None and surface is not None and int(wanted) == int(surface):
            return True, hosts
        if wanted is None and host == kind and (not use or use == host_use):
            return True, hosts
    return False, hosts
