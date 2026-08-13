"""The vocabulary the GAME switches on — as opposed to the world's contents.

`features.py` names what the builder puts in the manifest. These name the closed
states the *runtime* branches on, and they are here for one reason: the client
must not invent them either. A stage whose `kind` is misspelled is a level
nobody can start; a vehicle whose `medium` is wrong is not slow or awkward, it
is spawned inside a wall.

They reach the client through `tools/gen_vocabulary.py` like every other enum,
and each one names the files that must agree with it.
"""
from enum import StrEnum


class StageKind(StrEnum):
    """What a level ASKS of you, and therefore which whole flow starts.

    Not cosmetic and not a label: `modes.js` reads it to pick the required
    medium (a crossing needs a hull), the win condition, the brief, the results
    screen and the vehicle picker. `startStage` in src/game/modes.js,
    StageSelect/StageBrief/ResultsScreen in src/ui/screens/.

    It was a bare `str` on the DTO, so a typo produced a stage that loaded,
    listed, and then started as a delivery run with no kiosk."""
    DELIVERY = "delivery"
    CROSSING = "crossing"


class VehicleMedium(StrEnum):
    """THE GROUND A VEHICLE IS ALLOWED TO EXIST ON — the only concept in the
    vehicle record the collider reads (`isWall` in src/game/physics.js).

    A land vehicle treats water as a wall; a water one treats everything BUT
    water as a wall. Two consequences, both recorded in src/game/vehicles.js:
    the wrong medium is a spawn inside a wall, not a handling quirk; and the
    ownership fallback is per-medium (`resolveVehicle`), so every medium needs
    at least one free vehicle or a player who owns no boat gets a moped in the
    estero."""
    LAND = "land"
    WATER = "water"


class VehicleKind(StrEnum):
    """Which silhouette family draws it — shared by the sprite painter and the
    backend-agnostic path trace (src/render/c2d/entities.js `paintVehicle`,
    src/render/vehicleShapes.js `traceVehicleSilhouette`).

    The vehicle ID stays a REGISTRY key, deliberately: a designer adds a vehicle
    by adding a record, and only a genuinely new BODY PLAN is a member here."""
    BIKE = "bike"
    CAR = "car"
    BOAT = "boat"


class RendererBackend(StrEnum):
    """Which backend owns a visual family, and the value the escape hatch
    stores. `localStorage.churchill_renderer = "canvas"` (or `?canvas`) drops
    the Pixi layer — see src/render/Renderer.js, where the seam lives.

    Canvas2D paints the whole painterly world and the entities; a transparent
    Pixi layer above it carries the structures Canvas cannot do justice. Both
    ship, so "which one draws this family" is a real question that a registry
    has to answer per family rather than globally."""
    CANVAS = "canvas"
    PIXI = "pixi"
