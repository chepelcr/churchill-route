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


class GameMode(StrEnum):
    """The four ways to play, and every one of them changes a rule.

    Not a label. `physics.js` asks it whether the run has a clock; `modes.js`
    picks the sky and the day cycle from it; `delivery.js` pays a different
    bonus per mode; `progress.js` decides whether a restart button exists;
    the results screen and the analytics both group by it.

    It was a raw string in a dozen comparisons — `state.mode === "explore"` —
    and that list was already WRONG in one place: the timer branch handled
    arcade and story and then handled explore separately with a treadmill that
    counted 999 down and reset it, while the HUD asked for a different pair of
    names to decide whether to draw a clock at all."""
    STORY = "story"
    ARCADE = "arcade"
    EXPLORE = "explore"
    TUTORIAL = "tutorial"


class UIScreen(StrEnum):
    """React's screen state machine — a finite internal vocabulary.

    `App.jsx` branches on these fifteen strings in about thirty places, and
    three of them (`settings`, `shop`, `lanchapick`) also decide whether the
    simulation is PAUSED and whether the attract camera runs, so a typo is not
    a blank screen: it is a live game running behind a menu.

    They are also the keys of `src/ui/screens.json`, the per-screen registry the
    world editor authors, and of the manifest's `editorUI.screens` block. Three
    files keyed by the same fifteen names is exactly the shape that drifts."""
    BOOT = "boot"
    INTRO = "intro"
    TITLE = "title"
    STAGEPICK = "stagepick"
    BRIEF = "brief"
    MODEBRIEF = "modebrief"
    TUTBRIEF = "tutbrief"
    VEHPICK = "vehpick"
    LANCHAPICK = "lanchapick"
    PLAYING = "playing"
    PAUSED = "paused"
    OVER = "over"
    SETTINGS = "settings"
    SUPPORTERS = "supporters"
    SHOP = "shop"
