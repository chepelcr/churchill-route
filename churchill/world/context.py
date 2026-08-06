"""The world under construction — the state the stages hand to each other.

A build is a sequence of phases over one growing pile of state: parse, project,
rasterise the surface, detect cuadras, place POIs and structures, decorate,
verify, emit. That pile used to be 144 locals in a 2000-line `main()`, which is
precisely why none of it could be called from anywhere else.

`WorldContext` is that pile, named. Two rules keep it from becoming a junk
drawer:

* it holds what CROSSES a stage boundary, not a stage's working values. If only
  one phase ever reads it, it is a local in that phase.
* the collections are MUTATED IN PLACE, never rebound. A service is handed
  `ctx.landmarks` and appends to it; if a stage rebinds the attribute, anything
  that captured the old list silently stops seeing new entries. (That is a real
  bug this project has already paid for: `buildings` is rebound mid-build, so
  the field service takes it as an argument instead of holding it.)
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class WorldDims:
    """The world's size, computed from the OSM bounds — never a knob.

    Frozen on purpose: it used to be five module globals rebound at runtime by
    the projection setup, so every function that read them was quietly coupled
    to build order. Pass it, don't publish it.
    """
    w: int                     # canvas width in world px
    h: int                     # canvas height in world px
    cell: int                  # raster cell size in px
    cols: int                  # raster columns  (w // cell)
    rows: int                  # raster rows     (h // cell)

    @classmethod
    def of(cls, w, h, cell):
        return cls(w=w, h=h, cell=cell, cols=w // cell, rows=h // cell)

    @property
    def center_y(self) -> int:
        return self.h // 2

    @property
    def cells(self) -> int:
        return self.cols * self.rows


@dataclass
class WorldContext:
    """Everything a stage may read or add to.

    Grouped by the phase that fills it, which is also the order the stages run
    in — a field that is still empty tells you which stage has not run yet.
    """
    # ---- projection + raster (set up first) ---------------------------------
    dims: WorldDims
    projection: object = None          # PlanarProjection
    raster: object = None              # util.raster.Raster — the surface grid

    # ---- raw OSM ------------------------------------------------------------
    nodes: dict = field(default_factory=dict)
    ways: list = field(default_factory=list)
    named: list = field(default_factory=list)
    relations: list = field(default_factory=list)
    poi_nodes: list = field(default_factory=list)

    # ---- extracted geometry -------------------------------------------------
    roads: list = field(default_factory=list)
    rails: list = field(default_factory=list)
    beaches: list = field(default_factory=list)
    waters: list = field(default_factory=list)
    land_polys: list = field(default_factory=list)
    pois: list = field(default_factory=list)
    ferries: list = field(default_factory=list)   # berths + sailing routes
    #: OSM ground sites (parks, canchas, escuelas, iglesias) at their real
    #: outline — turned into parcels once the cuadras are known.
    sites: list = field(default_factory=list)
    #: street furniture (ALTO, semáforo, parada, crossing, tope) in world px
    signs: list = field(default_factory=list)
    sign_nodes: list = field(default_factory=list)

    # ---- the street grid, once the surface is rasterised --------------------
    #: Per raster column, the rows the ESTUARY occupies (or None where the spit
    #: does not exist), from service.surface.estero_band. It is what tells the
    #: mangrove side of the world from the Pacific side: no sand fringe here,
    #: and this is the waterline the mangroves are planted along.
    estero: list = field(default_factory=list)
    streets: object = None             # service.street.StreetIndex
    blocks: list = field(default_factory=list)
    plazas: list = field(default_factory=list)
    greens: list = field(default_factory=list)
    districts: list = field(default_factory=list)
    #: the paved sea front of the Paseo de los Turistas, one entry per
    #: contiguous band: outline rings traced straight off the raster, plus the
    #: street's angle so the renderer lays its courses with the coast.
    malecon: list = field(default_factory=list)

    # ---- placed content -----------------------------------------------------
    landmarks: list = field(default_factory=list)
    customers: list = field(default_factory=list)
    stadiums: list = field(default_factory=list)
    parcels: list = field(default_factory=list)
    kiosk_paths: list = field(default_factory=list)
    #: the turno on the malecón: carrusel, rueda, chocones, tómbola and the DJ
    attractions: list = field(default_factory=list)
    buildings: list = field(default_factory=list)
    #: Semantic additions the current runtime does not render yet. Preserving
    #: them in the manifest is part of the editor contract: no valid edit is
    #: silently dropped merely because its entity catalog lands in a later
    #: milestone.
    editor_features: list = field(default_factory=list)
    editor_ui: dict = field(default_factory=dict)
    editor_content: dict = field(default_factory=dict)
    editor_patch_meta: object = None
    cuadras: list = field(default_factory=list)
    surface_styles: list = field(default_factory=list)

    # ---- decoration ---------------------------------------------------------
    trees: list = field(default_factory=list)
    palms: list = field(default_factory=list)
    mangroves: list = field(default_factory=list)
    medians: list = field(default_factory=list)

    # ---- singletons ---------------------------------------------------------
    bridge: object = None
    estuary: object = None
    #: every muelle, as a polyline record (service/pier.py). The two the map
    #: has are the first two entries; the editor can add more.
    piers: list = field(default_factory=list)
    #: pier id -> the cells its deck covered and what they were. BUILD-ONLY
    #: bookkeeping, never emitted: it is the exact undo an edit needs to move a
    #: muelle without leaving a strip of drivable sea behind.
    pier_restores: dict = field(default_factory=dict)
    balneario: object = None
    hills: list = field(default_factory=list)

    #: POIs that would not resolve or would not reach the street network. A
    #: non-empty list FAILS the build: an unreachable kiosk is an unplayable
    #: stage, and it is invisible in a screenshot.
    failures: list = field(default_factory=list)
