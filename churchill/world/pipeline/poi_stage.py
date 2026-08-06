"""Stage 4: put the POIs and the kiosks where the player can actually reach them.

This is the stage that decides whether the game is playable. A landmark comes
out of OSM at the mapper's coordinate, which is regularly inside a building, in
the water, or on a sidewalk — so each one is resolved, nudged onto land, given
a drivable apron, and (for a building landmark) snapped into its cuadra
interior. The reachability gate at the end of the build is what proves it
worked; everything here is the attempt.

The kiosks get their own treatment because they are where a delivery STARTS:
a beach kiosk keeps its sand position but gains a path to the street and an
authored `spawn` on that street, since dropping the car at the icon put it on
the sand. Town kiosks are seated on a cuadra frontage cell instead.

Block detection runs here too: once roads, aceras and pads are stamped, the
land that is left IS the cuadras, and everything placed later needs them.
"""
import math
from collections import defaultdict, deque

from ..config import (
    ACERA_CELLS, CLS_ACERA, CLS_BEACH, CLS_BRIDGE, CLS_LAND, CLS_MALECON, CLS_PASEO,
    CALLE_CLASSES, CARRIAGEWAY_CLASSES, CLS_BARRO, CLS_GRAVEL, CLS_ROAD, CLS_WATER, CUAD,
    CUAD_CELLS, FARO_ESP_MAX_CELLS, FARO_ESP_R_M, FARO_POCKET_MAX_CELLS,
    GRID_CELL, PITAHAYA_STREET,
    PLANAR_PX_PER_M, POI_NUDGE_PX,
)
from ..content import CUSTOMER_DEFS, LANDMARK_DEFS, MALECON_EAST_LL, STAGES
from ..enums import GreenType, LandmarkType, Surface
from ..logging import log, warn
from ..service.block import block_raster_cells, cells_to_rects, detect_blocks, outline_poly
from ..service.malecon import stamp_malecon
from ..service.network import largest_drivable_component
from ..service.pier import log_pier, make_pier, stamp as stamp_pier
from ..service.placement import (
    block_containing, cell_class, drivable_cell, kiosk_frontage, nearest_block,
    nearest_cell, resolve_poi, road_adj,
)
from ..service.placement import (
    near_drivable as _near_drivable,
    nudge_off_acera,
    nudge_to_land as _nudge_to_land,
    snap_into_block as _snap_into_block,
    snap_into_block_cell as _snap_into_block_cell,
)
from ..service.street import StreetIndex, block_rect, planar_muelle_axis, street_end
from ..service.surface import acera_fringe, stamp_pad
from ..util.geometry import dist, to_m


#: Landmarks whose manzana is named in `content.LANDMARK_DEFS["block"]`. Their
#: cuadra is already resolved from its four bounding streets, so they skip the
#: "step into the nearest cuadra interior" snap and the acera nudge — both of
#: those look for CLS_LAND and will happily cross a calle to find it.
BLOCK_SEATED = {s["id"] for s in LANDMARK_DEFS if "block" in s}


def seat_on_block(raster, streets, spec, ref):
    """Seat a landmark on the cuadra its `block` spec names.

    The rect runs centreline to centreline, so the seat is the ground cell
    nearest its centre — CLS_LAND (cuadra interior) if the manzana has any,
    else CLS_ACERA, which on a market esplanade is all the ground there is.
    Logs the resolved rect AND the nearby-street diagnostic, because that log
    line is the only place a bad name resolve is visible (CLAUDE.md).
    """
    rect, parts = block_rect(streets, spec["block"], ref)
    if rect is None:
        log("poi", f"WARN {spec['id']} block resolve failed "
            f"(calles {parts[0]},{parts[1]} avenidas {parts[2]},{parts[3]}); "
            f"near {streets.near(ref)}")
        return None
    x0, y0, x1, y1 = rect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    cell = raster.cell
    c0, c1 = int(x0 // cell), int(x1 // cell)
    r0, r1 = int(y0 // cell), int(y1 // cell)
    best = {}
    for r in range(max(0, r0), min(raster.rows, r1 + 1)):
        for c in range(max(0, c0), min(raster.cols, c1 + 1)):
            cls = raster.at(c, r)
            if cls not in (CLS_LAND, CLS_ACERA):
                continue
            px, py = (c + 0.5) * cell, (r + 0.5) * cell
            key = ((px - cx) ** 2 + (py - cy) ** 2, px, py)
            if cls not in best or key < best[cls]:
                best[cls] = key
    ground = CLS_LAND if CLS_LAND in best else CLS_ACERA
    seat = best.get(ground)
    log("poi", f"{spec['id']} block ({round(x0)},{round(y0)})-({round(x1)},{round(y1)})px "
        f"from calles {round(parts[0])}/{round(parts[1])}, avenidas "
        f"{round(parts[2])}/{round(parts[3])}; near {streets.near(ref)}")
    if seat is None:
        log("poi", f"WARN {spec['id']} no land or acera inside its block")
        return None
    log("poi", f"{spec['id']} seated at ({round(seat[1])},{round(seat[2])}) on "
        f"{'land' if ground == CLS_LAND else 'acera'}")
    return seat[1], seat[2]


def place_pois(ctx, *, sp, roads, named, districts, botY):
    raster = ctx.raster
    grid = raster.buf
    CANVAS_H = ctx.dims.h
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    # --- POI resolution
    resolve = lambda spec: resolve_poi(named, spec)

    main_net = largest_drivable_component(raster)

    near_drivable = lambda c, r, reach=ACERA_CELLS + 1: _near_drivable(raster, main_net, c, r, reach)

    nudge_to_land = lambda x, y, radius_px=POI_NUDGE_PX, need_drivable=False: _nudge_to_land(raster, near_drivable, x, y, radius_px, need_drivable)

    # Building landmarks (church, market, hotel…) must sit INSIDE a cuadra, not
    # on the street. From a drivable anchor, walk into the nearest block
    # interior (CLS_LAND) so the footprint fronts the road it was next to.
    # (the estadio is NOT a building landmark: its anchor must stay put so the
    # dedicated stadium pass can grow the footprint from it — snapping it into
    # a block interior is what left the fallback rect straddling streets)
    BUILDING_LM = {"church", "cathedral", "market", "super", "hotel", "civic",
                   "house", "museum", "restaurant"}
    # Scenery that must NOT get a drivable apron: buildings above + green areas
    # (parks/pool). The stadium is placed by place_stadium (its own drivable
    # pitch) so it gets no apron here either. Excluded from the reachability gate.
    # `lighthouse` and `beachsign` belong here and never were: the faro stands
    # in the middle of its own 1485-cell pedestrian esplanade and the beach sign
    # on the sand, neither has a drivable apron, and no stage has ever targeted
    # either (stage 1 is called "El Faro" but delivers from `kios_faro`, which
    # is a kiosk and is gated on its own). The faro passed the gate only because
    # the reach happened to be a cuadrícula wide; narrowing the acera by one
    # cell narrowed the reach with it and the build failed on a lighthouse.
    NO_PAD_LM = BUILDING_LM | {"park", "pool", "stadium", "lighthouse", "beachsign"}
    _drivable_cell = lambda c, r: drivable_cell(raster, c, r)
    snap_into_block = lambda x, y, reach_px=160, inset_px=32: _snap_into_block(raster, x, y, reach_px, inset_px)
    streets = StreetIndex(roads)

    landmarks, failures = [], []
    for spec in LANDMARK_DEFS:
        pm, how = resolve(spec)
        if pm is None:
            failures.append(spec["id"])
            continue
        x, y, _, _ = sp.project(pm)
        x += spec.get("dx", 0)
        y += spec.get("dy", 0)
        if "block" in spec:
            seat = seat_on_block(raster, streets, spec, (x, y))
            if seat is not None:
                x, y = seat
        # every landmark must sit near the street network so its stamped pad
        # merges with it (a pad enclosed by solid land is unreachable in-game)
        pos = nudge_to_land(x, y, need_drivable=True)
        if pos is None:
            failures.append(spec["id"] + "(water)")
            continue
        # NB: building landmarks get repositioned INTO their cuadra later, once
        # roads + aceras are rasterized into the grid (snap_into_block needs the
        # final surface classes to find real block interior).
        landmarks.append({"id": spec["id"], "name": spec["name"], "x": round(pos[0]),
                          "y": round(pos[1]), "type": spec["type"], "district": spec["district"],
                          "_how": how})
    # Customers: nudge to land, then ENFORCE spread so every delivery is a
    # real trip — ≥150px from any kiosk, ≥120px from every other customer.
    MIN_FROM_KIOSK, MIN_BETWEEN = 450, 360
    kiosk_pts = [(l["x"], l["y"]) for l in landmarks if l["type"] == "kiosk"]
    dist_edges = {d["id"]: (d["x0"], d["x1"]) for d in districts}

    def spread_ok(x, y, placed, between=MIN_BETWEEN):
        if any((x - kx) ** 2 + (y - ky) ** 2 < MIN_FROM_KIOSK ** 2 for kx, ky in kiosk_pts):
            return False
        return all((x - c["x"]) ** 2 + (y - c["y"]) ** 2 >= between ** 2 for c in placed)

    customers = []
    for spec in CUSTOMER_DEFS:
        x, y, _, _ = sp.project(to_m(*spec["ll"]))
        pos = nudge_to_land(x, y, need_drivable=True)
        if pos is None:
            failures.append(spec["id"] + "(water)")
            continue
        px, py = pos
        if not spread_ok(px, py, customers):
            x0, x1 = dist_edges[spec["district"]]
            found = None
            # HOW FAR APART IS A PREFERENCE; BEING ON THE MAP IS NOT. `between`
            # exists so a delivery is a real trip, and 360 px is what that
            # deserves — but a barrio can genuinely run out of room (Las
            # Playitas holds a kiosk and three customers, and content.py says
            # so). Failing the whole build because two of them would be 300 px
            # apart instead of 360 loses a customer AND the stage that names
            # it, which is a far worse answer than a slightly shorter trip. So
            # the ring is tried at the full spread first and relaxed only if
            # that finds nothing, and the log says which customer settled.
            def ring(between):
                for rad in range(24, 1920, 16):    # expanding ring, nearest wins
                    cands = []
                    for a in range(0, 360, 20):
                        tx = px + rad * math.cos(math.radians(a))
                        ty = py + rad * math.sin(math.radians(a))
                        if not (x0 + 20 <= tx <= x1 - 20):
                            continue
                        c, r = int(tx / GRID_CELL), int(ty / GRID_CELL)
                        if not (0 <= c < GRID_COLS and 0 <= r < GRID_ROWS):
                            continue
                        if grid[r * GRID_COLS + c] == CLS_WATER or not near_drivable(c, r):
                            continue
                        if spread_ok(tx, ty, customers, between):
                            cands.append((abs(tx - px) + abs(ty - py), tx, ty))
                    if cands:
                        return min(cands)
                return None

            for between in (MIN_BETWEEN, MIN_BETWEEN * 3 // 4, MIN_BETWEEN // 2):
                found = ring(between)
                if found is None:
                    continue
                if between != MIN_BETWEEN:
                    log("poi", f"{spec['id']} settled for {between}px between "
                        f"customers, not {MIN_BETWEEN} — {spec['district']} is full")
                break
            if found is None:
                failures.append(spec["id"] + "(crowded)")
                continue
            px, py = found[1], found[2]
        customers.append({"id": spec["id"], "name": spec["name"], "x": round(px),
                          "y": round(py), "district": spec["district"], "line": spec["line"]})
    if failures:
        log("poi", f"WARNING — unplaced (fix geo anchors): {failures}")
    # assert stage refs exist
    lm_ids = {l["id"] for l in landmarks}
    cu_ids = {c["id"] for c in customers}
    for st in STAGES:
        for k in st["kiosks"]:
            if k not in lm_ids:
                failures.append(f"stage {st['id']} kiosk {k}")
        for c in st["customers"]:
            if c not in cu_ids:
                failures.append(f"stage {st['id']} customer {c}")
    for lm in landmarks:
        how = lm.pop("_how")
        log("poi", f"{lm['id']:<12} ({how:4}) -> {lm['x']},{lm['y']} [{lm['district']}]")

    # --- Muelle (the long pier into the gulf, faithful to muelle-nacional)
    mlm = next(l for l in landmarks if l["id"] == "muellecruc")
    # anchor to the real Calle Central south end (the road at the Paseo's
    # east entry)
    end = planar_muelle_axis(roads, mlm["x"], mlm["y"])
    if end is not None:
        mlm["x"] = round(end[0])
        log("pier", f"planar anchor: Calle Central south end at x={mlm['x']}")
    else:
        warn("pier", "Calle Central not found near the muelle anchor")
    pier_col = min(GRID_COLS - 1, max(0, int(mlm["x"] / GRID_CELL)))
    pier_y0 = botY[pier_col] - 6
    pier_y1 = round(min(CANVAS_H - 30, pier_y0 + 630))
    # A PIER IS A POLYLINE, like a road that is allowed to leave the land. The
    # service owns the one rule both muelles need — the stamp's round cap is
    # pulled back at the sea end so no drivable cell sits past the drawn deck.
    pier = make_pier("muelle_nacional", "Muelle Nacional",
                     [mlm["x"], round(pier_y0), mlm["x"], pier_y1], 2 * CUAD,
                     style="concrete")
    ctx.piers.append(pier)
    ctx.pier_restores[pier["id"]] = stamp_pier(raster, pier)
    log_pier(pier)
    # connect the pier base to the street grid (walk north to the first road)
    pier_x = pier["pts"][0]
    pc = int(pier_x // GRID_CELL)
    pr = int(pier_y0 // GRID_CELL)
    for r in range(pr, max(0, pr - 120), -1):
        if grid[r * GRID_COLS + pc] in CALLE_CLASSES:
            raster.stamp_polyline([pier_x, r * GRID_CELL,
                                         pier_x, pier_y0], 2 * CUAD, CLS_ROAD)
            log("pier", f"connector road to y={r * GRID_CELL}")
            break
    mlm["x"], mlm["y"] = pier_x, round(pier_y0 - 16)
    log("pier", f"muelle at x={pier_x}, y {round(pier_y0)}..{pier_y1}")

    # --- Muelle de Pitahaya (the twin pier north into the estero)
    #
    # IT STANDS AT THE END OF ITS OWN CALLE, and it has to. The twin used to
    # reuse the Nacional's resolved x on the theory that one axis kept the two
    # piers aligned — but CALLE CENTRAL SLANTS (x 19429..19552 over
    # y 11507..12619), so its NORTH end is 122 px west of the south end the
    # Nacional stands on, and the twin ended up off the end of every street.
    # The connector loop below then "found" a calle cell 38 px away and paved a
    # stub to nothing: a pier you could see and never drive onto.
    #
    # Calle 2 Presbíterio Florencio del Castillo runs to the estero on its own,
    # so resolve ITS north end and put the pier there.
    pit_end = street_end(roads, PITAHAYA_STREET, mlm["x"], mlm["y"], "north")
    if pit_end is None:
        warn("pier", f"muelle_pitahaya: {PITAHAYA_STREET} not found near the "
             f"muelle anchor — pier skipped")
        return landmarks, customers, failures, mlm, pier, BUILDING_LM, NO_PAD_LM, resolve
    pitahaya_x = round(pit_end[0])
    street_y = pit_end[1]
    log("pier", f"planar anchor: {PITAHAYA_STREET.title()} north end at "
        f"x={pitahaya_x}, y={round(street_y)}")
    pitahaya_col = min(GRID_COLS - 1, max(0, int(pitahaya_x / GRID_CELL)))
    # THE ESTERO SHORE IS NOT `topY`, and that is the whole difficulty here.
    # `botY[col]` works for the Nacional because the spit IS the southernmost
    # land in its column, so botY is its Pacific shore. There is no mirror:
    # `topY[col]` is the first land in the WHOLE column, which this far north
    # is the mainland at Pitahaya, ~11 km away across the estuary. The spit's
    # own north shore is an INTERIOR coastline that neither array records.
    #
    # So walk for it, north from the calle's own end — a cell known to be on
    # the spit, and now in the pier's OWN column rather than the Nacional's —
    # and take the first water. The walk is bounded because an unbounded one
    # that misses the shore silently returns the top of the map, which is how
    # the first attempt put this pier at y=6 and left the lancha with no
    # navigable water to start from.
    MAX_SPIT_WALK = 4000                       # px; the spit is ~1100 px here
    start_row = int(street_y // GRID_CELL)
    limit_row = max(0, start_row - int(MAX_SPIT_WALK / GRID_CELL))
    shore_row = None
    r = start_row
    while r > limit_row:
        if grid[r * GRID_COLS + pitahaya_col] == CLS_WATER:
            shore_row = r
            break
        r -= 1
    if shore_row is None:
        warn("pier", f"muelle_pitahaya: no estero shore within {MAX_SPIT_WALK}px "
             f"north of the spit at x={pitahaya_x} — pier skipped")
        return landmarks, customers, failures, mlm, pier, BUILDING_LM, NO_PAD_LM, resolve
    shore_y = (shore_row + 1) * GRID_CELL
    log("pier", f"estero shore at x={pitahaya_x}, y={round(shore_y)} "
        f"({round(street_y - shore_y)}px north of the calle's end)")
    # Base a few px inside the land, then run NORTH into the estero. Far
    # shorter than the Nacional's 630: the channel is close on this side, and
    # a deck that overshoots it is a wall across the water the boat needs.
    PITAHAYA_LEN = 260
    pitahaya_y0 = shore_y + 6
    pitahaya_y1 = round(max(30, pitahaya_y0 - PITAHAYA_LEN))
    pitahaya_pier = make_pier(
        "muelle_pitahaya", "Muelle de Pitahaya",
        [pitahaya_x, round(pitahaya_y0), pitahaya_x, pitahaya_y1], 2 * CUAD,
        style="concrete",
    )
    ctx.piers.append(pitahaya_pier)
    ctx.pier_restores[pitahaya_pier["id"]] = stamp_pier(raster, pitahaya_pier)
    log_pier(pitahaya_pier)
    # THE WAY IN IS A STREET, not a stub. The calle ends short of the water —
    # the last block before the estero is the shore itself — so the pier's base
    # and the end of Calle 2 are joined by a real auxiliary calle at street
    # width, emitted as a pier (the same record the ferry ramps and the bajadas
    # use) instead of being invisible drivable cells.
    #
    # `calzada`, not `apron`: it is DRAWN IN THE MUELLE'S GREY CONCRETE rather
    # than in street asphalt, so the surface under the car does not change
    # between the calle and the deck. The muelles themselves are already
    # concrete; this is the piece that was still black.
    aux_len = round(street_y - pitahaya_y0)
    calle_muelle = make_pier(
        "calle_muelle_pitahaya", "Calle del Muelle de Pitahaya",
        [pitahaya_x, round(street_y), pitahaya_x, round(pitahaya_y0)], 2 * CUAD,
        style="calzada", surface=Surface.ROAD, sea_end=None,
    )
    ctx.piers.append(calle_muelle)
    ctx.pier_restores[calle_muelle["id"]] = stamp_pier(raster, calle_muelle)
    log_pier(calle_muelle)
    log("pier", f"muelle_pitahaya auxiliary street {aux_len}px from the pier "
        f"base to the north end of {PITAHAYA_STREET.title()} "
        f"({pitahaya_x},{round(street_y)})")
    # …and PROVE the calle it joins is the one the player is on. `main_net` is
    # the largest drivable component of the raster as it stood when this stage
    # began — i.e. the street network — so a base whose calle is not in it is a
    # pier on an island, which is exactly the failure this move repairs. The
    # deck itself is re-checked against the spawn's own flood in `finish.verify`.
    scol = min(GRID_COLS - 1, max(0, int(pitahaya_x / GRID_CELL)))
    srow = min(GRID_ROWS - 1, max(0, int(street_y / GRID_CELL)))
    on_net = bool(main_net[srow * GRID_COLS + scol])
    log("pier", f"muelle_pitahaya landward calle ({pitahaya_x},{round(street_y)}) "
        f"{'IS' if on_net else 'is NOT'} on the main drivable network")
    if not on_net:
        failures.append("muelle_pitahaya(landward calle off the street network)")
    log("pier", f"muelle_pitahaya at x={pitahaya_x}, "
        f"y {round(pitahaya_y0)}..{pitahaya_y1}")

    return landmarks, customers, failures, mlm, pier, BUILDING_LM, NO_PAD_LM, resolve


def place_kiosks_and_blocks(ctx, *, landmarks, customers, districts, junction_islands, BUILDING_LM, NO_PAD_LM):
    raster = ctx.raster
    grid = raster.buf
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    # --- aceras (sidewalks) + plaza pads: these define where you can drive
    # off-street; everything left as CLS_LAND becomes solid cuadra interior
    acera_fringe(raster)

    # --- el malecón: the sand between the Paseo de los Turistas and the beach
    # becomes paved sea front. AFTER the fringe (so nothing re-rings it with
    # sidewalk, exactly like the palm median) and BEFORE the faro esplanade,
    # whose flood follows sand only and would otherwise run east along this band
    # instead of stopping where the plazoleta ends.
    ctx.malecon.extend(stamp_malecon(
        raster, ctx.roads, StreetIndex(ctx.roads), sites=ctx.sites,
        east_x=ctx.projection.project(to_m(*MALECON_EAST_LL))[0]))

    # --- Kiosk placement: real aceras are respected everywhere (walls), so
    #   (a) kiosks sitting mid-lane shift onto the adjacent sidewalk, and
    #   (b) BEACH kiosks get a drivable SAND PATH from the nearest street so
    #       you can actually reach them. Runs BEFORE the pad stamp so the apron
    #       lands at the final position.
    _cell_cls = lambda cc, cr: cell_class(raster, cc, cr)
    _nearest_cell = lambda x, y, classes, max_cells: nearest_cell(raster, x, y, classes, max_cells)
    # BEACH kiosks: keep them on the sand and carve a drivable SAND PATH from the
    # nearest street. TOWN kiosks are re-seated INSIDE a cuadra (on the frontage
    # cell nearest a street) with a paved connector — done after block detection
    # below, so nothing is left mid-lane.
    kiosk_paths = []
    beach_kiosks = set()
    # THE PASEO STANDS NOW LIVE ON THE MALECÓN, and that is the whole change:
    # they used to keep their anchor between the Paseo and the sand and have a
    # 28 px lane of ASPHALT stamped across the beach to reach them — the "kiosk
    # street into the playa". The promenade is a drivable surface running the
    # length of the sea front, so the access is simply the place they stand on,
    # and the sand goes back to being sand you enter by a bajada.
    PINNED_KIOSKS = {"kios_paseo1", "kios_paseo2"}
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm["id"] == "kios_faro":
            continue                                    # kios_faro goes on the muelle below
        kx, ky = lm["x"], lm["y"]
        surf = _cell_cls(int(kx // GRID_CELL), int(ky // GRID_CELL))
        if lm["id"] in PINNED_KIOSKS:
            spot = _nearest_cell(kx, ky, (CLS_MALECON,), 60)
            if spot:
                lm["x"], lm["y"] = round(spot[0]), round(spot[1])
                log("kiosk", f"{lm['id']} seated on the malecón "
                    f"({lm['x']},{lm['y']}) — no lane over the sand")
            else:
                warn("kiosk", f"{lm['id']} found no malecón within 240px; it keeps "
                     f"its anchor and the frontage pass will seat it")
                continue
            beach_kiosks.add(lm["id"])
            continue
        if surf == CLS_BEACH:
            # A stand out on the open playa somewhere else in the world still
            # needs its ramp: sand is slow and loose, but a kiosk with no paved
            # way to it is a delivery that starts in a dune.
            tgt = _nearest_cell(kx, ky, (CLS_ROAD, CLS_BRIDGE, CLS_BARRO, CLS_GRAVEL), 260)
            if tgt:
                raster.stamp_polyline([kx, ky, tgt[0], tgt[1]], 1.4 * CUAD, CLS_ROAD)
                kiosk_paths.append({"pts": [round(kx), round(ky), round(tgt[0]), round(tgt[1])],
                                    "surface": "paved"})
                log("kiosk", f"sand path {lm['id']} (surf {surf}) -> street "
                    f"({round(tgt[0])},{round(tgt[1])})")
            beach_kiosks.add(lm["id"])

    for lm in landmarks:
        # scenery (buildings + green areas) gets NO drivable apron; kiosks get
        # theirs in the cuadra-frontage pass after block detection
        if lm["type"] in NO_PAD_LM or lm["type"] == "kiosk":
            continue
        stamp_pad(raster, lm["x"], lm["y"], 48)
    for cu in customers:
        stamp_pad(raster, cu["x"], cu["y"], 56)
    faro_lm = next((l for l in landmarks if l["id"] == "faro"), None)
    faro_pier = None
    faro_esp = None
    if faro_lm:
        fx, fy = faro_lm["x"], faro_lm["y"]
        fcc0, fcr0 = int(fx // GRID_CELL), int(fy // GRID_CELL)
        # La Punta plaza: pave the SAND TIP following its NATURAL SHAPE (flood the
        # beach around the faro, bounded so it never reaches the street), then
        # VIRTUALLY EXTEND it a few cells into the sea so the shape is respected
        # and the muelle starts at the extended edge. Emitted as a gray
        # "esplanade" ground fill (single colour-by-type draw — no sand below).
        esp = set()
        seed = None
        for rad in range(0, 16):
            for a in range(0, 360, 15):
                cc = fcc0 + int(round(math.cos(math.radians(a)) * rad))
                cr = fcr0 + int(round(math.sin(math.radians(a)) * rad))
                if _cell_cls(cc, cr) == CLS_BEACH:
                    seed = (cc, cr); break
            if seed:
                break
        # HOW BIG THE PLAZOLETA IS, IN METRES. This was `Rc = 34` CELLS — 136 px,
        # a budget tuned when the world was 1.6 px/m. The rescale to 2.0 shrank
        # the plaza to 68 m of ground while the loop road around it grew, and
        # what was left between the two was a ring of bare sand: the yellow
        # crescent between the grey plazoleta and the street. A radius that
        # means "the sand tip out to the road" is a real distance, so it is
        # written as one.
        Rc = int(round(FARO_ESP_R_M * PLANAR_PX_PER_M / GRID_CELL))
        def flood(radius):
            out = set()
            if not seed:
                return out
            q = deque([seed]); out.add(seed)
            while q:
                cc, cr = q.popleft()
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nb = (cc + dc, cr + dr)
                    if nb in out or (nb[0] - fcc0) ** 2 + (nb[1] - fcr0) ** 2 > radius * radius:
                        continue
                    if _cell_cls(*nb) == CLS_BEACH:        # follow the SAND only
                        out.add(nb); q.append(nb)
            return out
        esp = flood(Rc)
        # …and the leak guard. The flood follows sand, and sand is continuous
        # along the whole coast: if the tip's beach ever joins the playa east of
        # it, a bigger radius stops being a plazoleta and starts being a paved
        # kilometre of Paseo. The malecón is stamped BEFORE this and takes the
        # street-side sand out of the flood's way, which is the other half of
        # the same guard.
        if len(esp) > FARO_ESP_MAX_CELLS:
            warn("faro", f"esplanade flooded {len(esp)} cells at {FARO_ESP_R_M}m — "
                 f"the tip's sand is not bounded; falling back to 136px")
            Rc = int(round(136 / GRID_CELL))
            esp = flood(Rc)
        # THE YELLOW PATCHES. What was left between the grey plazoleta and the
        # loop road was never a matter of RADIUS — it is sand the flood could
        # not reach, because the plaza and the street had already closed around
        # it. A pocket of beach with no way to the sea is not a beach; it is a
        # hole in the esplanade, so it is paved with it. Bounded to the tip and
        # to pockets small enough to BE pockets, so this can never swallow the
        # playa if a rebuild opens a path.
        pockets, seen = 0, set()
        for cc in range(fcc0 - Rc, fcc0 + Rc + 1):
            for cr in range(fcr0 - Rc, fcr0 + Rc + 1):
                if (cc, cr) in seen or (cc, cr) in esp:
                    continue
                if _cell_cls(cc, cr) != CLS_BEACH:
                    continue
                comp, q, open_sea = {(cc, cr)}, deque([(cc, cr)]), False
                seen.add((cc, cr))
                while q and len(comp) <= FARO_POCKET_MAX_CELLS:
                    pc, pr = q.popleft()
                    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nb = (pc + dc, pr + dr)
                        cls = _cell_cls(*nb)
                        if cls == CLS_WATER:
                            open_sea = True
                        # THE ESPLANADE IS A WALL HERE. Its cells are still
                        # CLS_BEACH in the grid — they are only written as acera
                        # further down — so without this every pocket walks
                        # straight through the plaza to the open sea and no
                        # pocket is ever found, which is exactly what the first
                        # run of this did.
                        if cls != CLS_BEACH or nb in comp or nb in esp:
                            continue
                        comp.add(nb); seen.add(nb); q.append(nb)
                if open_sea or len(comp) > FARO_POCKET_MAX_CELLS:
                    continue                      # a real beach, not a pocket
                esp |= comp
                pockets += 1
        if pockets:
            log("faro", f"{pockets} pockets of enclosed sand paved into the "
                f"esplanade — the yellow ring between the plazoleta and the calle")
        esp.add((fcc0, fcr0))
        for _ in range(7):                                 # dilate into the sea
            add = set()
            for (cc, cr) in esp:
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    nb = (cc + dc, cr + dr)
                    if nb not in esp and _cell_cls(*nb) == CLS_WATER:
                        add.add(nb)
            esp |= add
        for (cc, cr) in esp:
            if 0 <= cc < GRID_COLS and 0 <= cr < GRID_ROWS:
                grid[cr * GRID_COLS + cc] = CLS_ACERA       # pedestrian plaza (NON-drivable)
        faro_esp = esp
        ecc0 = min(c for c, _ in esp); ecc1 = max(c for c, _ in esp)
        ecr0 = min(r for _, r in esp); ecr1 = max(r for _, r in esp)
        faro_lm["plaza"] = [ecc0 * GRID_CELL, ecr0 * GRID_CELL,
                            (ecc1 - ecc0 + 1) * GRID_CELL, (ecr1 - ecr0 + 1) * GRID_CELL]
        espl = sorted(esp)                                 # comma islands across the shape
        faro_lm["commas"] = [[int((espl[(i * len(espl)) // 12][0] + 0.5) * GRID_CELL),
                              int((espl[(i * len(espl)) // 12][1] + 0.5) * GRID_CELL)] for i in range(12)]
        # riprap rim: only the esplanade cells that border the SEA (so the rocks
        # follow the real sand/water edge, never a bbox circle into the town)
        rim = [c for c in esp if any(_cell_cls(c[0] + dc, c[1] + dr) == CLS_WATER
               for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)))]
        rim.sort(key=lambda c: math.atan2(c[1] - fcr0, c[0] - fcc0))
        rstep = max(1, len(rim) // 46)
        faro_lm["rim"] = [[int((rim[i][0] + 0.5) * GRID_CELL), int((rim[i][1] + 0.5) * GRID_CELL)]
                          for i in range(0, len(rim), rstep)]
        # Faro muelle: jut SOUTH-WEST from the beach line (the edge of the paved
        # tip) into the open water, kiosk at the sea end; the player spawns on it.
        scc, scr = fcc0, fcr0                              # walk SW to the water's edge
        for _ in range(60):
            if _cell_cls(scc - 1, scr + 1) == CLS_WATER:
                break
            scc -= 1; scr += 1
        sx, sy = scc * GRID_CELL, scr * GRID_CELL          # muelle base (beach line)
        ex, ey = sx - 7 * CUAD, sy + 7 * CUAD              # SW sea end
        pw = 2 * CUAD
        # Shore end first, sea end last — the service pulls the stamp back at
        # the free end so the round cap leaves no drivable cell past the deck.
        faro_pier = make_pier("muelle_faro", "Muelle del Faro",
                              [sx, sy, ex, ey], pw, style="timber")
        ctx.piers.append(faro_pier)
        ctx.pier_restores[faro_pier["id"]] = stamp_pier(raster, faro_pier)
        log_pier(faro_pier)
        # ONE drivable lane tying the muelle base to the nearest loop road (the
        # pedestrian plaza itself stays non-drivable); drawn asphalt.
        aux = None
        for rad in range(4, 70):
            for a in range(0, 360, 10):
                cc = fcc0 + int(round(math.cos(math.radians(a)) * rad))
                cr = fcr0 + int(round(math.sin(math.radians(a)) * rad))
                if (cc, cr) not in esp and _cell_cls(cc, cr) in CALLE_CLASSES:
                    aux = (cc, cr); break
            if aux:
                break
        if aux:
            # AIM INTO THE ROADWAY, not at its first cell. `aux` is the first
            # drivable cell the outward scan meets, i.e. the near KERB, so a
            # lane ending there meets the road at a shallow angle and leaves a
            # wedge of acera between the two — the grey gap where the faro's
            # auxiliary street looked like it stopped short of the road. Walking
            # on to the far kerb and taking the middle puts the lane's end
            # inside the carriageway, where the two surfaces simply merge.
            ux = aux[0] - fcc0; uy = aux[1] - fcr0
            ul = math.hypot(ux, uy) or 1.0
            ux /= ul; uy /= ul
            far = aux
            for k in range(1, 13):
                cc = aux[0] + int(round(ux * k)); cr = aux[1] + int(round(uy * k))
                if _cell_cls(cc, cr) not in CALLE_CLASSES:
                    break
                far = (cc, cr)
            mid = ((aux[0] + far[0]) / 2, (aux[1] + far[1]) / 2)
            axp, ayp = (mid[0] + 0.5) * GRID_CELL, (mid[1] + 0.5) * GRID_CELL
            # straight lane from the muelle base to the road (the lighthouse sits
            # to its left/west, over on the tip)
            raster.stamp_polyline([sx, sy, axp, ayp], round(1.6 * CUAD), CLS_ROAD)
            kiosk_paths.append({"pts": [int(sx), int(sy), round(axp), round(ayp)], "surface": "paved"})
            log("pier", f"faro drivable lane -> ({round(axp)},{round(ayp)})")
        kf = next((l for l in landmarks if l["id"] == "kios_faro"), None)
        if kf:
            kf["x"] = int(sx + 0.85 * (ex - sx)); kf["y"] = int(sy + 0.85 * (ey - sy))   # sea end
            kf["spawn"] = [int(sx + 0.4 * (ex - sx)), int(sy + 0.4 * (ey - sy))]         # on the deck
            beach_kiosks.add("kios_faro")                     # skip the frontage pass
        # Nudge the drawn lighthouse NORTH-WEST so the tower no longer sits on top
        # of the drivable connection lane (which runs SW→NE). NW is perpendicular
        # to that lane, so the faro clears it to the left; the esplanade / commas /
        # rim / muelle geometry all stay put (already computed from the original
        # anchor above). Kept modest so the faro stays within the reachability
        # gate's acera reach of the lane (≤ ACERA_CELLS+1 cells from drivable).
        faro_lm["x"] = int(faro_lm["x"] - 1.6 * CUAD)
        faro_lm["y"] = int(faro_lm["y"] - 1.6 * CUAD)
        log("pier", f"faro muelle SW ({sx},{sy})->({ex},{ey}); esplanade {len(esp)} cells; "
              f"faro icon -> ({faro_lm['x']},{faro_lm['y']})")
    # Hand-placed junction islands: medians carve non-drivable acera, cuadras
    # carve solid land — stamped last so they override the road/apron beneath.
    for isl in junction_islands:
        raster.fill_poly(isl["pts"], CLS_ACERA if isl["kind"] == "median" else CLS_LAND)
    acera_cells = sum(1 for v in grid if v == CLS_ACERA)
    log("acera", f"{acera_cells} sidewalk cells; {len(junction_islands)} junction islands")

    # --- cuadrícula blocks: classify land into cuadras / paved plazas / green.
    # The Faro + Carmen barrios by the lighthouse have a fine street grid whose
    # small cuadras would pave to green plazas — keep them BUILDABLE (houses)
    # out to the east edge of Carmen so the tip reads as a town, not a lawn.
    faro_band_x1 = next((d["x1"] for d in districts if d["id"] == "carmen"),
                        next((d["x1"] for d in districts if d["id"] == "faro"), None))
    blocks, plazas = detect_blocks(raster, build_band_x1=faro_band_x1)
    # Faro esplanade: paint the paved sand-tip as a gray ground fill by TYPE
    # (single draw — no sand shows under it; follows the sand, never the street).
    if faro_esp:
        plazas.extend([r + ["esplanade"] for r in cells_to_rects(faro_esp, GRID_CELL)])

    # Step each building landmark off its street anchor into a cuadra INTERIOR
    # cell — nearest block, cell ≥1 cuadrícula from any edge so it clears the
    # acera fringe and sits solidly inside the block (church-in-the-street fix).
    snap_into_block_cell = lambda x, y, max_d_cuads=8: _snap_into_block_cell(blocks, x, y, max_d_cuads)
    n_snap = 0
    for lm in landmarks:
        if lm["type"] not in BUILDING_LM or lm["id"] in BLOCK_SEATED:
            continue
        inb = snap_into_block_cell(lm["x"], lm["y"])
        if inb is not None:
            lm["x"], lm["y"] = round(inb[0]), round(inb[1])
            n_snap += 1
    log("poi", f"{n_snap} building landmarks snapped into cuadra interiors")

    # Building POIs often keep their geo anchor (dense/sliver cuadras make the
    # snap above return None) and land on the acera fringe or a street — the icon
    # then straddles the sidewalk. Pull each to the NEAREST grid point with as
    # much solid-land clearance as its cuadra allows (±16 px if possible, down to
    # ±8 px), so the icon sits inside the block, not on the sidewalk.
    _nudge_off_acera = lambda x, y, reach_cells=16: nudge_off_acera(raster, x, y, reach_cells)
    n_nudge = 0
    for lm in landmarks:
        if lm["type"] not in BUILDING_LM or lm["id"] in BLOCK_SEATED:
            continue                                  # all cuadra buildings, not just civic
        nx, ny = _nudge_off_acera(lm["x"], lm["y"])
        if round(nx) != lm["x"] or round(ny) != lm["y"]:
            lm["x"], lm["y"] = round(nx), round(ny)
            n_nudge += 1
    log("poi", f"{n_nudge} building landmarks nudged off the acera fringe")

    # A green block's ground is emitted as ONE outline from the 4 px raster
    # cells, straightened within one cell so diagonals become direct lines while
    # still following the acera inner edge. The renderer fills it and dilates it
    # a few px under the painted acera band, so lawns meet the sidewalks with no
    # sand slivers and none of the old blocky steps.
    _block_raster_cells = lambda cells: block_raster_cells(raster, cells, CUAD_CELLS, CLS_LAND)
    _outline_poly = lambda cells: outline_poly(cells, GRID_CELL)

    def _green_poly(cells, typ):
        poly = _outline_poly(_block_raster_cells(cells))
        return {"pts": poly, "type": typ} if poly else None
    greens = []
    balneario = None          # sea-water inlet bbox (boat + swimmers spawn inside)
    balneario_cells = None    # its cuad cells → added to `occ` once that exists
    marine_site = None        # Parque Marino: {lm, cells, grass} → real OSM footprints + tanks

    _block_containing = lambda x, y: block_containing(blocks, x, y)

    return blocks, plazas, greens, kiosk_paths, beach_kiosks, faro_lm, balneario, balneario_cells, marine_site
