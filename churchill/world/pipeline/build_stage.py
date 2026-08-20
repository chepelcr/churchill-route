"""The last three stages: seat the town kiosks, build the block, plant it.

`seat_town_kiosks` finishes POI placement now that the cuadras exist — a town
kiosk belongs on a block FRONTAGE cell (solid land next to the street), not
wherever OSM put the counter. It also claims the special blocks: the Balneario's
cuadra becomes a sea inlet, the Parque Marino keeps its real aquarium buildings,
and the parks are scattered.

`place_structures` puts everything that STANDS on a block: the estadios, the
parcels a cuadra is cut into, then the buildings — OSM footprints snapped to
the cuadrícula, synthesised infill in the frontage bands, and the named ones
kept at their true outline so the Hotel Tioga is recognisable.

`decorate` is the living puerto: the bridge and estuary, the paseo separators,
and the trees, palms and mangroves. Decoration runs LAST for a reason — it
reads the finished surface to decide where a tree can stand, and a tree line
that ignored the surface class would plant palms down the middle of a lane.
"""
import math
from collections import defaultdict

from ..config import (
    ACERA_CELLS, BLDG_INSET, CLS_ACERA, CLS_BARRO, CLS_BEACH, CLS_BRIDGE,
    CLS_GRAVEL, CLS_LAND, CLS_MALECON,
    CARRIAGEWAY_CLASSES, CLS_PASEO, CLS_ROAD, CLS_WATER, CUAD, CUAD_CELLS, GRID_CELL,
    KIOSK_WATER_CLEAR_PX,
    LEON_END_STREET, MARINE_POOL_GROUND_CLEAR_PX, MARINE_POOL_RAIL_CLEAR_PX,
    MARINE_POOL_MIN_SPACING_PX, MARINE_POOL_SCALE,
    MARINE_STRUCTURE_PARCEL_PAD_PX, PASEO_LEON, PASEO_MEDIAN_W, PASEO_TURISTAS,
    STREET_CLASSES, SYNTH_MAX_TOTAL, flora_registry, px, road_width_px,
)
from ..content import (
    APRON_DEFS, BLDG_PALETTE, FOOTPRINT_LOT_BLOCKS, LANDMARK_DEFS,
    MARINE_BUILDING_NAMES, MARINE_SITE_OSM_ID, ROOF_PALETTE, WATER_INLET_LMS,
    blocks_by_layout,
)

#: La rampa del ferry: de la popa en reposo a la calle. Su LARGO no se autora
#: —es la distancia que resulte— y por eso el registro sólo trae ancho y receta.
_FERRY_RAMP = APRON_DEFS["ferryRamp"]
metres_to_px = px
from ..enums import GreenType, LandmarkType, ParcelUse, SignKind, Surface
from ..logging import log, warn
from ..service.attraction import place_attractions
from ..service.block import (
    block_raster_cells, cells_to_rects, cuadra_cells, outline_poly,
    outline_polys,
)
from ..service.building import (
    _grid_placer, fit_manzana_contents, make_rng, snap_osm_buildings,
    synth_buildings,
)
from ..service.decoration import (
    mangrove_line, paseo_median_runs, paseo_roads, stamp_paseo_median,
)
from ..service.ferry import stern_at_rest
from ..service.lancha import place_beach_accesses, place_lanchas
from ..service.pier import make_pier, stamp as stamp_pier
from ..service.field import FieldService, _largest_part
from ..service.projection import project_way_pts
from ..service.placement import (
    cell_class, kiosk_frontage, nearest_block, nearest_cell, nudge_off_water,
    road_adj,
)
from ..service.street import StreetIndex, half_plane, resample_centerline
from ..service.surface import stamp_pad
from ..util.geometry import (
    dist, pairs, point_in_poly, point_polygon_dist, point_polyline_dist,
    poly_centroid, to_m,
)
from ..util.raster import disk_has_only, disk_within_cells, erode_cells


def seat_town_kiosks(ctx, *, landmarks, customers, roads, waters, blocks, greens, kiosk_paths, beach_kiosks, mlm, pier, balneario, balneario_cells, marine_site, _nearest_cell, _block_containing, _block_raster_cells, _green_poly):
    raster = ctx.raster
    grid = raster.buf
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    # --- TOWN kiosks: seat each on a NEARBY cuadra FRONTAGE cell (solid land next
    # to a street, never the roadway/acera/median) and carve a short paved
    # connector + apron to the nearest street. Bounded to a small radius so a
    # kiosk with no cuadra beside it (e.g. on the Paseo boardwalk) stays put and
    # just gets the pad+connector instead of teleporting to a far block.
    KIOSK_SNAP_CUAD = 10                       # ≤ this many cuadrículas from anchor
    # How far the paved connector will reach for a street. In CUADRÍCULAS, not
    # px: a frontage cell is against its cuadra's edge, so the asphalt is half a
    # street plus the acera away — a distance that grows with the world's scale.
    KIOSK_LINK_R = 6 * CUAD
    nongreen_blocks = []
    for b in blocks:
        if b.get("green"):
            continue
        cs = b["cells"]
        bc0 = min(c for c, _ in cs); bc1 = max(c for c, _ in cs)
        br0 = min(r for _, r in cs); br1 = max(r for _, r in cs)
        nongreen_blocks.append((bc0, bc1, br0, br1, cs))

    _road_adj = lambda cc, cr: road_adj(raster, cc, cr)

    _kiosk_frontage = lambda x, y: kiosk_frontage(raster, nongreen_blocks, KIOSK_SNAP_CUAD, x, y)

    # A KIOSK MUST CLEAR THE SEA, and the anchor is not what has to: the stand is
    # 32 px of drawn art with a shadow reaching 22 px to its right. The build
    # tests for water exactly once, on the geo anchor, and never again after a
    # reseat — so the 1.6 -> 2.0 rescale left three of them (Paseo 2, Centro,
    # Mata de Limón) standing 14 px from open water, drawn half in the gulf.
    # Checked AFTER the frontage seat, since that is what moves them last, and
    # BEFORE the apron, so the pad follows the kiosk rather than the other way
    # round. `kios_faro` is exempt: it is seated on the timber deck on purpose.
    KIOSK_STAND = (CLS_LAND, CLS_ACERA, CLS_ROAD, CLS_BEACH, CLS_MALECON,
                   CLS_BARRO, CLS_GRAVEL)
    n_dry = 0

    def keep_off_the_sea(lm):
        nonlocal n_dry
        if lm["id"] == "kios_faro":
            return
        # A STAND KEEPS ITS OWN GROUND. Pushing it away from the water must not
        # also push it off the surface the build deliberately seated it on —
        # the first cut of this took Kioscos Paseo 1 off the malecón it had just
        # been placed on and left it eight px away, standing on the sand.
        here = cell_class(raster, lm["x"] // GRID_CELL, lm["y"] // GRID_CELL)
        stand = (here,) if here in KIOSK_STAND else KIOSK_STAND
        dry = nudge_off_water(raster, lm["x"], lm["y"], KIOSK_WATER_CLEAR_PX, stand)
        if dry is None and stand is not KIOSK_STAND:
            dry = nudge_off_water(raster, lm["x"], lm["y"], KIOSK_WATER_CLEAR_PX, KIOSK_STAND)
        if dry is None:
            warn("kiosk", f"{lm['id']} ({lm['x']},{lm['y']}) has no dry ground within "
                 f"{KIOSK_WATER_CLEAR_PX}px — it will be drawn over the water")
            return
        if round(dry[0]) == lm["x"] and round(dry[1]) == lm["y"]:
            return
        log("kiosk", f"{lm['id']} pushed off the sea "
            f"({lm['x']},{lm['y']}) -> ({round(dry[0])},{round(dry[1])})")
        lm["x"], lm["y"] = round(dry[0]), round(dry[1])
        n_dry += 1

    for lm in landmarks:
        if lm["type"] != "kiosk":
            continue
        if lm["id"] in beach_kiosks:
            keep_off_the_sea(lm)
            stamp_pad(raster, lm["x"], lm["y"], 44)   # apron for the beach stand
            continue
        spot = _kiosk_frontage(lm["x"], lm["y"])
        if spot:
            lm["x"], lm["y"] = round(spot[0]), round(spot[1])
        keep_off_the_sea(lm)
        # WHERE THE STREET IS — asked BEFORE the apron is stamped. `stamp_pad`
        # paints a 44 px CLS_ROAD pocket around the kiosk, so asking afterwards
        # finds the POCKET ITSELF: the "connector" comes out a 4 px stub from a
        # cell to its neighbour, and the pad stays an island ringed by acera,
        # which the car cannot cross. Five of the fourteen town kiosks shipped
        # with a stub like that; they only played because the pad happened to
        # overlap the asphalt. Rescaling the world moved the cuadras apart and
        # Kiosco Playitas stopped touching its calle — which is the failure the
        # gate then caught.
        tgt = _nearest_cell(lm["x"], lm["y"], CARRIAGEWAY_CLASSES, KIOSK_LINK_R)
        stamp_pad(raster, lm["x"], lm["y"], 44)            # drivable pocket
        if tgt:
            raster.stamp_polyline([lm["x"], lm["y"], tgt[0], tgt[1]], 1.4 * CUAD, CLS_ROAD)
            kiosk_paths.append({"pts": [round(lm["x"]), round(lm["y"]),
                                        round(tgt[0]), round(tgt[1])], "surface": "paved"})
            log("kiosk", f"{lm['id']} -> cuadra frontage ({lm['x']},{lm['y']}), paved connector")
    log("kiosk", f"{n_dry} kiosk(s) pushed clear of the water "
        f"({KIOSK_WATER_CLEAR_PX}px of dry ground around the stand)")

    # Player spawn per kiosk: run starts place the player beside the run's first
    # kiosk. Snap that point to the nearest DRIVABLE street cell now (build time,
    # so modes.js never spawns on the beach beside a sand kiosk and never probes
    # tiles that aren't resident yet). kios_faro keeps its muelle-deck spawn.
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm.get("spawn"):
            continue
        tgt = _nearest_cell(lm["x"], lm["y"], CARRIAGEWAY_CLASSES, 260)
        if tgt:
            lm["spawn"] = [round(tgt[0]), round(tgt[1])]
        else:
            log("kiosk", f"WARN no street spawn near {lm['id']} ({lm['x']},{lm['y']})")

    # FERRY RAMPS — piers, like the two muelles, and for the same reason: a deck
    # you drive on that leaves the land. The berths sit over water with a strip
    # of sand between them and the terminal road, and sand is a WALL to the car,
    # so without this you could see both ferries and never board one.
    #
    # ONE THING IS THE OPPOSITE OF A MUELLE'S, and it is why `seaEnd` is a field
    # and not an assumption. A muelle's free end must NOT overhang: there is
    # nothing past it but water, and drivable cells past the drawn deck are
    # where the both-ends-blocked snap-back traps you. A ferry ramp's end MUST
    # overhang, because what is past it is the ferry — `stamp_polyline`'s round
    # cap is the 20 px of overlap you drive across onto a deck the raster does
    # not know about (deckAt answers for that). Pull this one back and the
    # boarding gap becomes open sea.
    #
    # They stay CLS_ROAD rather than the muelles' CLS_BRIDGE: the terminal is
    # asphalt, and `surfLevel` would otherwise start lifting the car onto a
    # pier deck the moment it left the street.
    for fy in ctx.ferries:
        sx, sy = stern_at_rest(fy)
        tgt = _nearest_cell(sx, sy, CARRIAGEWAY_CLASSES, px(_FERRY_RAMP["reachM"]))
        if not tgt:
            log("ferry", f"WARN no street near the {fy['id']} berth to ramp to"); continue
        # 2 cuadrículas wide — a shade under the deck, so the ramp is as wide as
        # the door you drive through rather than a footpath to it
        ramp = make_pier(f"ramp_{fy['id']}", f"Rampa {fy['name']}",
                         [sx, sy, tgt[0], tgt[1]], px(_FERRY_RAMP["widthM"]),
                         style=_FERRY_RAMP["style"], surface=_FERRY_RAMP["surface"],
                         sea_end=None)
        ctx.piers.append(ramp)
        ctx.pier_restores[ramp["id"]] = stamp_pier(raster, ramp)
        log("ferry", f"{fy['id']} ramp stern ({round(sx)},{round(sy)}) -> street "
            f"({round(tgt[0])},{round(tgt[1])}), {round(dist((sx, sy), tgt))}px")

    # THE LANCHA over the estero, and the ways down onto the sand. Both come
    # after the ferry ramps because both use the same apron recipe, and both
    # need the street grid to already be stamped: an access that finds no road
    # is a ramp to nowhere.
    _ll_px = lambda lat, lon: ctx.projection.project(to_m(lat, lon))[:2]
    _street_near = lambda x, y, reach: _nearest_cell(x, y, CARRIAGEWAY_CLASSES, reach)
    place_lanchas(ctx, _ll_px, _street_near)
    place_beach_accesses(ctx, _ll_px, _street_near)

    # OSM parks (parquemar, cocal_park) + the Balneario pool: paint their green
    # on the containing block's footprint so the cuadra is OPEN (no buildings),
    # tagged by type for the renderer's colour-by-type fill.
    _nearest_block = lambda x, y, min_cells=12: nearest_block(blocks, x, y, min_cells)
    for lm in landmarks:
        if lm["type"] not in ("park", "pool"):
            continue
        # WHICH LANDMARKS OWN THEIR WHOLE CUADRA IS A REGISTRY QUESTION now
        # (`content/world/blocks.json`), not two ids written into this branch.
        # That is what makes a second balneario possible without editing here.
        marine = lm["id"] in FOOTPRINT_LOT_BLOCKS
        inlet = lm["id"] in WATER_INLET_LMS
        bi = _block_containing(lm["x"], lm["y"])
        if bi is None and (inlet or marine):
            # These two landmarks ARE their cuadra. After the acera resize the
            # Parque Marino anchor landed on a mixed LAND/ACERA cell just
            # outside detect_blocks, so exact containment silently deleted its
            # lawn, aquarium metadata and tanks. The intended block is the
            # immediately adjacent one; use the same explicit fallback that
            # already keeps the Balneario inside its inlet.
            bi = _nearest_block(lm["x"], lm["y"])
        if bi is None:
            if marine:
                raise RuntimeError("Parque Marino has no resolvable cuadra")
            continue
        blocks[bi]["green"] = True
        cells = blocks[bi]["cells"]
        bc0 = min(c for c, _ in cells); bc1 = max(c for c, _ in cells)
        br0 = min(r for _, r in cells); br1 = max(r for _, r in cells)
        if inlet:
            # The Balneario is a SEA-WATER inlet: the whole cuadra becomes open
            # water (drawn with the living-sea effect, no pool graphic). Keep OSM
            # buildings off it (occ, applied once occ exists), stamp the interior
            # CLS_WATER, and emit its outline into `waters` so it renders exactly
            # like the ocean. A boat + swimmers spawn inside its bbox
            # (maintainBalneario).
            balneario_cells = list(cells)
            g = _green_poly(cells, "pool")
            if g:
                wp = g["pts"]
                waters.append([round(v) for v in wp])
                raster.fill_poly([(wp[i], wp[i + 1]) for i in range(0, len(wp), 2)], CLS_WATER)
            ccx = sum(c for c, _ in cells) / len(cells); ccy = sum(r for _, r in cells) / len(cells)
            tcx, tcy = min(cells, key=lambda c: (c[0] - ccx) ** 2 + (c[1] - ccy) ** 2)
            lm["x"] = int((tcx + 0.5) * CUAD); lm["y"] = int((tcy + 0.5) * CUAD)
            px0, py0 = bc0 * CUAD, br0 * CUAD
            px1, py1 = (bc1 + 1) * CUAD, (br1 + 1) * CUAD
            lm["w"] = px1 - px0; lm["h"] = py1 - py0
            balneario = {"x0": px0, "y0": py0, "x1": px1, "y1": py1,
                         "cx": lm["x"], "cy": lm["y"]}
            continue
        # Ordinary parks can paint their cuadra now. Parque Marino cannot: its
        # final lawn is the RESIDUAL after the UNA campus, all OSM building
        # lots, and the station's eastern parcel claim their cells. It is traced
        # later by `_partition_marine_cuadra`.
        g = _green_poly(cells, "marine" if marine else "park")
        if g and not marine:
            greens.append(g)
        lm["x"] = (bc0 + bc1 + 1) * CUAD // 2; lm["y"] = (br0 + br1 + 1) * CUAD // 2
        if marine:
            lm["marine"] = True
            lm["w"] = (bc1 - bc0 + 1) * CUAD; lm["h"] = (br1 - br0 + 1) * CUAD
            # The aquarium is a REAL place: its own OSM buildings are kept at
            # their true footprints (see marine_site below) instead of snapped
            # into generic cuadrícula boxes, and the tanks are placed after them
            # so a tank can never end up under a building or on the acera.
            marine_site = {"lm": lm, "cells": set(cells),
                           "grass": _block_raster_cells(cells)}
        else:
            lm["w"] = min(160, (bc1 - bc0 + 1) * CUAD); lm["h"] = min(140, (br1 - br0 + 1) * CUAD)

    # The town's parks are NOT invented here any more. Until 2026-07-27 this
    # stage scattered 16 synthetic green cuadras (`park_syn_*`, all named
    # "Parque") over whatever mid-sized block happened to be free — a stand-in
    # from before the parcel system existed. The map carries 205 real park areas
    # of its own; they are placed as parcels by `FieldService.place_osm_sites`
    # (place_structures), on the ground the mapper actually drew.

    # The avenue's separators (final layout, user-iterated):
    # - Paseo de los Turistas: its classic PALM median — dashes with crossing
    #   gaps aligned to the coming streets (paseo_median_runs).
    # - The kiosks street (Paseo León Cortés): ONE continuous tree strip from
    #   the first cuadra's corner (the Turistas→León Cortés curve stays fully
    #   drivable) up to just before the muelle street; beyond, normal street.
    planting_specs = flora_registry()["plantingRuns"]
    palm_spec = planting_specs["paseo_median"]
    leon_spec = planting_specs["leon_cortes"]
    tzx1 = mlm["x"] - px(leon_spec["stopClearM"])  # stop clear of the muelle street

    def continuous_runs(pieces, x0=None, x1=None, sample_step=4):
        out = []
        for r in pieces:
            samples = resample_centerline(r["pts"], sample_step)
            ks = [k for k, (_, x, _) in enumerate(samples)
                  if (x0 is None or x >= x0) and (x1 is None or x <= x1)]
            run = []
            for k in ks + [-99]:                 # sentinel flushes the tail
                if run and k != run[-1] + 1:
                    if len(run) >= 2:
                        out.append((samples, [(run[0], run[-1])]))
                    run = []
                run.append(k)
        return out

    turistas = [r for r in paseo_roads(roads)
                if palm_spec["streetName"] in (r.get("name") or "").lower()]
    leon = [r for r in paseo_roads(roads)
            if leon_spec["streetName"] in (r.get("name") or "").lower()]

    # the tree strip starts at the SW corner of the first cuadra facing the
    # León Cortés stretch — never inside the curve that leads into it
    leon_cl = [(x, y) for r in leon
               for (_, x, y) in resample_centerline(
                   r["pts"], px(leon_spec["cornerProbeStepM"]))]
    lx0, lx1 = min(x for x, _ in leon_cl), max(x for x, _ in leon_cl)

    def _leon_y(x):
        return min(leon_cl, key=lambda p: abs(p[0] - x))[1]

    corner_xs = []
    for b in blocks:
        for (cc, cr) in b["cells"]:
            bx, by = cc * CUAD, (cr + 1) * CUAD          # cell SW corner
            if lx0 <= bx <= min(lx1, tzx1) \
                    and 0 < _leon_y(bx) - by <= px(leon_spec["cornerSearchM"]):
                corner_xs.append(bx)
    tzx0 = min(corner_xs, default=lx0)
    log("median", f"León Cortés tree strip x{tzx0}-{tzx1} (cuadra corner start)")

    palm_runs = paseo_median_runs(roads, turistas, palm_spec)
    tree_runs = continuous_runs(
        leon, x0=tzx0, x1=tzx1,
        sample_step=px(leon_spec["sampleStepM"]))
    medians = (stamp_paseo_median(raster, palm_runs, palm_spec)
               + stamp_paseo_median(raster, tree_runs, leon_spec))

    # --- buildings on the cuadrícula: snap OSM footprints, then fill the
    # cuadras' frontage bands with synth lots (shared occupancy, POI keepouts)
    keepouts = []
    for lm in landmarks:
        keepouts.append((lm["x"], lm["y"], 100 if lm["type"] == "kiosk" else 68))
    for cu in customers:
        keepouts.append((cu["x"], cu["y"], 100))
    # the muelle's shore end: nothing synthesised on the apron in front of it
    keepouts.append((pier["pts"][0], pier["pts"][1], 120))
    return balneario, balneario_cells, marine_site, keepouts, medians, palm_runs, tree_runs


def place_structures(ctx, *, landmarks, roads, blocks, greens, plazas, beaches, balneario, balneario_cells, marine_site, keepouts, streets, raw_bldgs, sites, _green_poly, _block_raster_cells):
    raster = ctx.raster
    grid = raster.buf
    CANVAS_W, CANVAS_H = ctx.dims.w, ctx.dims.h
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    cell_block, occ = _grid_placer(blocks, keepouts)
    if balneario_cells:                 # keep OSM buildings off the Balneario water
        occ.update(balneario_cells)

    # A LANDMARK THAT DRAWS ITSELF OWNS THE FOOTPRINT IT WAS RESOLVED FROM.
    # The two Paseo stands are anchored on OSM way 232193746 — `amenity=food_court`,
    # `building=roof`, "Kioscos Paseo de los Turistas" — which is the real thing
    # they ARE. It is also a NAMED footprint, and named footprints bypass `occ`
    # unconditionally, so the mapped roof was extracted and drawn on top of the
    # two churchill stands standing on the same spot. Exactly the reason
    # `SITE_BUILT` clears a church's way when the parcel draws the church.
    #
    # Keyed off `osmRef`, which the POI stage already records as the PROVENANCE
    # of each anchor, so this cannot drift from whatever the resolver picked.
    # `kios_faro` resolves to a NODE and is untouched by the `way/` test.
    drawn_ways = {int(str(lm["osmRef"]).split("/")[1])
                  for lm in landmarks
                  if lm.get("type") == "kiosk"
                  and str(lm.get("osmRef", "")).startswith("way/")}
    if drawn_ways:
        before = len(raw_bldgs)
        raw_bldgs = [b for b in raw_bldgs if b.get("id") not in drawn_ways]
        log("kiosk", f"cleared {before - len(raw_bldgs)} OSM footprint(s) a kiosk "
            f"draws itself: ways {sorted(drawn_ways)}")

    # --- Estadios: DRIVABLE green pitches placed on a named street-grid cuadra.
    # Lito Pérez = the block bounded by Calle 15-17 x Avenida 0-2 (actual size);
    # Las Playitas = Calle 6-8 x Avenida 1, extended NORTH so it reads vertical.
    # The pitch grid is stamped CLS_ROAD (you can drive on it — coins + NPCs
    # stream inside like Recorrer), interior cross-streets are clipped, and the
    # cuad footprint polygon + a "stadium" green poly are emitted for drawing.
    stadiums = []
    parcels = []        # named cuadra parts (church / plaza / sponsor lots)

    # Streets by name — one index, four questions (see the service for which
    # to use when: a MEAN coordinate, the coordinate AT a point, the street as
    # an infinite line, or its direction).
    streets = StreetIndex(roads)
    _street_vals = streets.vals
    _street_at = streets.at
    _street_edge = streets.edge
    _street_dir = lambda names, ref, axis, span=520: streets.direction(names, ref, axis, span)
    _half_plane = half_plane

    _cuadra_cells = lambda px0, py0, px1, py1, classes, clip=None: cuadra_cells(
        raster, px0, py0, px1, py1, classes, clip)

    # Erosion lives in util now; this binds it to THIS build's raster so the
    # directional test can read the class outside a boundary cell.
    def _erode_cells(cells, depth, facing=None):
        return erode_cells(cells, depth, facing, raster.at)

    # Aquarium tanks: best-of-all-seeds farthest-point spread over the FINAL
    # park residual. A centre on LAND is insufficient: campus, building lots,
    # station and park are all the same surface class, so the complete ownership
    # disk must stay in `grass` as well. All five belong WEST (screen-left) of
    # the station parcel and clear the decorative rail centreline.
    def _place_marine_pools(site, raws, want=5):
        grass = site["grass"]                 # residual park cells (CLS_LAND only)
        rail_lines = [pairs(rail["pts"]) for rail in ctx.rails
                      if len(rail.get("pts", [])) >= 4]
        # The same anchor the partition uses — asked once, from the registry, so
        # the tanks and the lots can never disagree about which building it is.
        _anchor = FOOTPRINT_LOT_BLOCKS[site["lm"]["id"]]["anchor"]
        station = next((raw for raw in raws
                        if raw.get("building") == _anchor["building"]), None)
        if station is None:
            raise RuntimeError("Parque Marino has no OSM train-station footprint")
        station_x0 = min(p[0] for p in station["pts"])
        structure_polys = [raw["pts"] for raw in raws]
        ground_clear = lambda px, py: (
            disk_has_only(
                raster, px, py, MARINE_POOL_GROUND_CLEAR_PX, (CLS_LAND,))
            and disk_within_cells(
                raster, px, py, MARINE_POOL_GROUND_CLEAR_PX, grass))
        structure_clear = lambda px, py: all(
            point_polygon_dist((px, py), poly) >= MARINE_POOL_GROUND_CLEAR_PX
            for poly in structure_polys)
        rail_clear = lambda px, py: all(
            point_polyline_dist((px, py), line) >= MARINE_POOL_RAIL_CLEAR_PX
            for line in rail_lines)
        left_of_station = lambda px: (
            px + MARINE_POOL_GROUND_CLEAR_PX <= station_x0)
        cand = []
        for c, rr in sorted(grass):
            px, py = int((c + 0.5) * GRID_CELL), int((rr + 0.5) * GRID_CELL)
            if (left_of_station(px) and ground_clear(px, py)
                    and structure_clear(px, py) and rail_clear(px, py)):
                cand.append((px, py))
        if len(cand) < want:
            raise RuntimeError(
                f"Parque Marino has only {len(cand)} tank spots clear of "
                "station, OSM structures, acera and rail")
        log("marino", f"{len(grass)} grass cells -> {len(cand)} tank candidates "
            f"west of station x={station_x0:.1f}, "
            f">={MARINE_POOL_GROUND_CLEAR_PX}px ground/structure and "
            f">={MARINE_POOL_RAIL_CLEAR_PX}px rail clearance")
        # One centroid seed is not enough on a residual with parcel-shaped
        # notches: it chose a locally attractive centre and forced the fifth
        # tank into another. Try every legal seed, grow by farthest insertion,
        # and keep the deterministic layout with the best minimum separation.
        best_pts, best_sep2 = None, -1.0
        for seed in cand:
            trial = [seed]
            while len(trial) < want:
                trial.append(max(
                    cand,
                    key=lambda p: (
                        min((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
                            for q in trial),
                        -p[0], -p[1])))
            sep2 = min((
                (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
                for i, p in enumerate(trial) for q in trial[:i]
            ), default=math.inf)
            if (sep2 > best_sep2
                    or (sep2 == best_sep2
                        and tuple(trial) < tuple(best_pts or trial))):
                best_pts, best_sep2 = trial, sep2
        pts = best_pts or []
        nearest_tank = min((
            dist(p, q) for i, p in enumerate(pts) for q in pts[:i]
        ), default=math.inf)
        if nearest_tank < MARINE_POOL_MIN_SPACING_PX:
            raise RuntimeError(
                f"Parque Marino tanks only spread {nearest_tank:.1f}px "
                f"(<{MARINE_POOL_MIN_SPACING_PX}px)")
        site["lm"]["pools"] = [[int(p[0]), int(p[1])] for p in pts]
        site["lm"]["poolScale"] = MARINE_POOL_SCALE
        nearest_rail = min(
            (point_polyline_dist(p, line) for p in pts for line in rail_lines),
            default=math.inf)
        if math.isfinite(nearest_rail):
            log("marino", f"nearest tank is {nearest_rail:.1f}px from the rail "
                f"centreline (>={MARINE_POOL_RAIL_CLEAR_PX}px)")

    # Estadios and parcels: one service over the world under construction.
    fields = FieldService(raster=raster, streets=streets, landmarks=landmarks,
                          blocks=blocks, greens=greens, plazas=plazas,
                          stadiums=stadiums, parcels=parcels, occ=occ,
                          project_ll=lambda lat, lon: ctx.projection.project(to_m(lat, lon))[:2])

    def _partition_marine_cuadra(site, park_raw, block_raw):
        # LA REGLA ES CÓDIGO; SUS PARÁMETROS SON DATA. Cuál edificio ancla se
        # queda con un lado, cómo se llaman los lotes y qué es el residual
        # vienen de `content/world/blocks.json`, así que una segunda cuadra
        # repartida así no pide editar esta función.
        _blk = FOOTPRINT_LOT_BLOCKS[site["lm"]["id"]]
        _anchor, _lots = _blk["anchor"], _blk["lots"]
        """Hand the shared cuadra to its real occupants, then keep the residual.

        OSM supplies footprints, not cadastral lot lines. Each non-station
        footprint therefore owns the nearest LAND cells in an 8 px band; close
        neighbours split that band by distance. Existing OSM ground parcels
        (most importantly the UNA campus and Iglesia Cristiana) already sit in
        `fields.claimed_cells` and win first. The train station then takes every
        remaining cell east of its west wall. What remains to the west is the
        Parque Marino lawn and the only legal pool ground.
        """
        grass = set(site["grass"])
        available = grass - fields.claimed_cells
        park_ids = {raw["id"] for raw in park_raw}
        station = next((raw for raw in park_raw
                        if raw.get("building") == _anchor["building"]), None)
        if station is None:
            raise RuntimeError("Parque Marino has no station for its east parcel")
        station_x0 = min(p[0] for p in station["pts"])

        def raw_name(raw):
            return (raw.get("osm_name")
                    or MARINE_BUILDING_NAMES.get(raw["id"])
                    or raw.get("name"))

        non_station = [raw for raw in block_raw if raw is not station]
        assigned = {raw["id"]: set() for raw in non_station}
        for cell in sorted(available):
            px = (cell[0] + 0.5) * GRID_CELL
            py = (cell[1] + 0.5) * GRID_CELL
            near = []
            for raw in non_station:
                d = point_polygon_dist((px, py), raw["pts"])
                if d <= MARINE_STRUCTURE_PARCEL_PAD_PX:
                    near.append((d, raw["id"]))
            if near:
                assigned[min(near)[1]].add(cell)

        lot_cells = set()
        for raw in sorted(non_station, key=lambda b: b["id"]):
            cells = _largest_part(assigned[raw["id"]])
            if not cells:
                raise RuntimeError(
                    f"OSM building {raw['id']} has no LAND parcel in Marino cuadra")
            name = raw_name(raw)
            is_park = raw["id"] in park_ids
            part = {
                "id": (f"{_lots['siteId']}_{raw['id']}" if is_park
                       else f"{_lots['blockId']}_{raw['id']}"),
                "name": name or "Estructura de la cuadra",
                "use": ParcelUse.LOT,
                "label": bool(name),
                "osmId": raw["id"],
            }
            if is_park:
                part["marine"] = 1
            polys = outline_polys(cells, GRID_CELL)
            part["polys"] = polys
            fields._emit_parcel(
                _lots["prefix"], part, cells, cells,
                poly=polys[0] if polys else None)
            lot_cells |= cells

        remaining = available - lot_cells
        station_cells = {
            cell for cell in remaining
            if (cell[0] + 0.5) * GRID_CELL >= station_x0
        }
        station_cells = _largest_part(station_cells)
        if not station_cells:
            raise RuntimeError("Parque Marino station east parcel has no LAND")
        station_part = {
            "id": f"{_lots['siteId']}_{station['id']}",
            "name": raw_name(station) or "Antigua Estación del Ferrocarril",
            "use": ParcelUse.LOT,
            "label": True,
            "osmId": station["id"],
            "marine": 1,
        }
        station_polys = outline_polys(station_cells, GRID_CELL)
        station_part["polys"] = station_polys
        fields._emit_parcel(
            _lots["prefix"], station_part, station_cells, station_cells,
            poly=station_polys[0] if station_polys else None)

        park_cells = remaining - station_cells
        east_leak = {
            cell for cell in park_cells
            if (cell[0] + 0.5) * GRID_CELL >= station_x0
        }
        if east_leak:
            raise RuntimeError(
                f"Parque Marino residual leaked {len(east_leak)} cells east "
                "of the station parcel")
        park_polys = outline_polys(park_cells, GRID_CELL)
        if not park_polys:
            raise RuntimeError("Parque Marino residual has no drawable lawn")
        park_poly = park_polys[0]
        greens.append({
            "pts": park_poly, "polys": park_polys, "type": _blk["residual"]["green"],
        })
        park_rec = fields._emit_parcel(
            "marino",
            {"id": "marino_parque", "name": "Parque Marino del Pacífico",
             "use": ParcelUse.PARK, "label": False, "whole": True,
             "marine": 1, "decor": False, "polys": park_polys},
            park_cells, park_cells, poly=park_poly)

        # The landmark frames every residual component.  Pools are selected
        # from this exact same cell set, so a tank in a legitimate detached
        # lawn is still rendered and represented by the park geometry.
        park_coords = [coord for ring in park_polys for coord in ring]
        px, py = park_coords[0::2], park_coords[1::2]
        lm = site["lm"]
        lm["x"], lm["y"] = int((min(px) + max(px)) / 2), int((min(py) + max(py)) / 2)
        lm["w"], lm["h"] = max(px) - min(px), max(py) - min(py)
        lm["parkCells"] = len(park_cells)
        site["grass"] = park_cells
        site["stationCells"] = station_cells
        site["lotCells"] = lot_cells

        campus = next((p for p in parcels
                       if p["id"] == "osm_campus_232386868"), None)
        campus_area = (abs(sum(
            campus["poly"][i] * campus["poly"][(i + 3) % len(campus["poly"])]
            - campus["poly"][(i + 2) % len(campus["poly"])]
              * campus["poly"][i + 1]
            for i in range(0, len(campus["poly"]), 2))) / 2
                       if campus else 0)
        log("marino", f"cuadra partition: UNA {campus_area:.0f}px², "
            f"{len(non_station)} building lots {len(lot_cells)} cells, "
            f"station-east {len(station_cells)} cells, "
            f"park-west {len(park_cells)} cells")
        return park_rec

    # LOS ESTADIOS Y LAS PLAZAS, desde `content/world/blocks.json`. Los nombres
    # de calle son listas de candidatos porque son los que OSM trae acá: las
    # calles impares suelen no tener nombre (se cae a la par que la flanquea) y
    # la avenida central es "Avenida Centenario", no "Avenida 0".
    # `place_stadium` imprime el quad resuelto.
    for _sp in blocks_by_layout("streets-quad"):
        fields.place_stadium(_sp)

    # ---- PARCELS -----------------------------------------------------------
    # Una cuadra partida en PARTES con nombre, cada una con un `use` que decide
    # cómo se dibuja y con un `slot` donde un patrocinador puede poner su arte.
    # Es la forma general de lo que los estadios hacen a mano: resolver la
    # manzana desde sus calles y después repartirla.
    #
    # Las dos que hay —el superbloque cívico y la manzana de El Carmen— y el
    # porqué de cada parte están en `content/world/blocks.json`, incluido el
    # diagrama de la H de calle peatonal que las organiza.
    for _pc in blocks_by_layout("bands"):
        claimed = fields.place_parcels(_pc)
        # A HAND-LAID CUADRA THAT RESOLVES TO NOTHING FAILS THE BUILD. It used
        # to log a WARN and carry on, and that is how the Catedral, the Casa de
        # la Cultura, the Biblioteca, the Parroquia del Carmen and the Plaza
        # Deportes El Carmen all quietly stopped existing when a px anchor went
        # stale — the whole civic centre of the game, gone, and two lines in a
        # 900-line log to say so. Somebody sat down and drew these blocks; the
        # build does not get to decide they are optional.
        if not claimed:
            ctx.failures.append(f"hand-laid cuadra {_pc['id']} resolved to nothing")
        # A hand-laid cuadra owns its ground. Named OSM footprints are kept at
        # their real outline unconditionally (see `named_raw` below), so without
        # this the capilla, the curia and the parroquia's offices would still be
        # standing in the middle of the parks and across the calle peatonal.
        if _pc.get("clear_buildings") and claimed:
            before = len(raw_bldgs)
            raw_bldgs = [b for b in raw_bldgs
                         if (int(b["cx"] // CUAD), int(b["cy"] // CUAD)) not in claimed]
            log("parcel", f"{_pc['id']}: cleared {before - len(raw_bldgs)} OSM "
                f"footprints off the {len(claimed)} cuad cells the block claimed")

    # ---- OSM SITES ---------------------------------------------------------
    # …and now the same primitive, driven by the MAP instead of by the table
    # above: every park, cancha, escuela, jardín de niños, campus and iglesia
    # that docs/map.osm draws as a closed area becomes a parcel on the cuadra
    # under it. Runs AFTER the hand-laid blocks so those always win their
    # ground, and BEFORE the building passes so a claimed site is already off
    # limits to the snapper and the synthesiser.
    #
    # The Balneario is claimed here: its cuadra is a sea inlet and must not be
    # re-derived as an ordinary OSM site. Parque Marino deliberately is NOT.
    # The Escuela de Biología Marina is a mapped campus in the same cuadra; when
    # the whole marine block was pre-claimed, its 21,272 px² source parcel was
    # starved down to 836 px² and two tanks landed on it. OSM sites take their
    # ground first; the aquarium receives only the residual later.
    #
    # Expanded from CUAD cells to RASTER cells, because that is the resolution
    # the site test works at — a CUAD-coarse claim is 20 px, which merges a site
    # with whatever is across the street from it.
    _cpc = CUAD // GRID_CELL
    for _cc, _cr in list(balneario_cells or ()):
        fields.claimed_cells.update(
            (_cc * _cpc + dc, _cr * _cpc + dr)
            for dc in range(_cpc) for dr in range(_cpc))
    n_before = len(parcels)
    site_cuads = fields.place_osm_sites(sites)
    # …and the landmarks that neither a hand-laid part nor an OSM site gave
    # ground to. Runs AFTER both, so it only fills in what is left and never
    # overrides the better geometry.
    fields.place_landmark_lots(landmarks)
    # The SAME OSM way is also a named POI dot (extract_pois reads every named
    # feature with an amenity/leisure tag). Where the new parcel carries a name
    # PILL — a church, a school, a cancha — the dot is a second copy of the same
    # label sitting on top of the first, and the parcel is the better one: it is
    # the shape of the real place, not a point in the middle of it.
    #
    # A park keeps its dot. `UNLABELLED_USES` in the renderer leaves parks,
    # gardens and bulevares unlabelled on purpose (a caption in the middle of a
    # lawn covers exactly the tree scatter that makes it read as a park), so
    # dropping their dot would leave Parque Victoria with no name at all.
    PILLED = {ParcelUse.CHURCH, ParcelUse.CATHEDRAL, ParcelUse.STADIUM,
              ParcelUse.SCHOOL, ParcelUse.KINDER, ParcelUse.CAMPUS}
    site_names = {(p["name"], p["x0"], p["y0"], p["x1"], p["y1"])
                  for p in parcels[n_before:] if p["use"] in PILLED}
    if site_names:
        before = len(ctx.pois)
        ctx.pois[:] = [poi for poi in ctx.pois
                       if not any(poi["name"] == nm and x0 <= poi["x"] <= x1
                                  and y0 <= poi["y"] <= y1
                                  for (nm, x0, y0, x1, y1) in site_names)]
        log("site", f"{before - len(ctx.pois)} POI dots dropped — their parcel "
            f"now carries the name")
    # A site whose parcel DRAWS the building (a church, a school) owns its
    # ground the same way a hand-laid manzana does. `occ` is not enough: NAMED
    # footprints bypass it (that is why the capilla used to stand in the middle
    # of a park), and a worship way IS the church — left standing it puts a
    # pastel box on top of the drawn church.
    if site_cuads:
        before = len(raw_bldgs)
        raw_bldgs = [b for b in raw_bldgs
                     if (int(b["cx"] // CUAD), int(b["cy"] // CUAD)) not in site_cuads]
        log("site", f"cleared {before - len(raw_bldgs)} OSM footprints off the "
            f"{len(site_cuads)} cuad cells the built sites claimed")

    # Every OTHER building that is a NAMED place also keeps its real outline, for
    # the same reason: Hotel Tioga, the Catedral, Súper Salinas et al. should be
    # recognisable on the map, not another anonymous pastel rect. They bypass the
    # cuadrícula snap, so claim the cuad cells they cover — otherwise a snapped
    # or synthesised neighbour lands on top of them.
    # …but ONLY when the real outline is actually clear of the streets. Snapping
    # guaranteed that (a snapped rect must fit inside one block); a raw OSM
    # polygon does not, and a few were sitting across the auxiliary calles by
    # the Paseo kiosks. Any that overlaps drivable ground goes back to the
    # snapper rather than being drawn over a road.
    def _poly_over(pts, classes, step=4):
        """Does the polygon cover any cell of these surface classes?"""
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        for py in range(int(min(ys)), int(max(ys)) + 1, step):
            for px in range(int(min(xs)), int(max(xs)) + 1, step):
                if not (0 <= px < CANVAS_W and 0 <= py < CANVAS_H):
                    return True
                if not point_in_poly((px, py), pts):
                    continue
                if grid[(py // GRID_CELL) * GRID_COLS + (px // GRID_CELL)] in classes:
                    return True
        return False

    ROADISH = CARRIAGEWAY_CLASSES
    STREETISH = ROADISH + (CLS_ACERA,)

    # THE SIDEWALK IS NOT SOMEWHERE A BUILDING MAY STAND, and until now only the
    # ROADWAY was checked — so a named footprint overlapping just the acera was
    # kept at its real outline and drawn straight over the sidewalk. That was
    # 245 of the 306 named buildings sitting mostly on their own acera, which is
    # most of the recognisable buildings on the map.
    #
    # It is not the mapper's fault and it is not fixable by testing harder: the
    # painted roadway is ~3x a real carriageway and the acera is carved INWARD
    # from it, so the game's building line stands metres inside the true
    # property line. A footprint drawn where it really is has to overlap.
    #
    # So it gets PUSHED — straight back off the street, along the normal of the
    # nearest centreline, in whole cells until it clears. That keeps the real
    # outline, which is the whole point of a named building; only when the push
    # cannot find room does it fall through to the cuadrícula snapper.
    # How far the push may go. It has to cover the whole lie: the painted
    # roadway is ~3x a real carriageway, so on a 7 m calle the game's kerb sits
    # ~13 px inside the true one, and the acera adds 16 more — a footprint flush
    # with its real property line starts about 29 px over. At 24 px the push
    # could not clear that and 254 named buildings fell through to the snapper,
    # which is worse: snapping loses the real outline, and the outline is the
    # entire reason a named building is kept. Beyond 40 px it would be a lie of
    # a different kind, and those go to the snapper on purpose.
    PUSH_STEP = GRID_CELL
    PUSH_MAX = 10 * GRID_CELL         # 40 px

    def _push_off_street(raw):
        pts = raw["pts"]
        if not _poly_over(pts, STREETISH):
            return pts                      # already clear
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        hit = streets.nearest_normal(cx, cy)   # unit normal AWAY from the street
        if hit is None:
            return None
        nx, ny = hit
        for k in range(1, PUSH_MAX // PUSH_STEP + 1):
            d = k * PUSH_STEP
            moved = [(p[0] + nx * d, p[1] + ny * d) for p in pts]
            if not _poly_over(moved, STREETISH):
                return moved
        return None

    # …and when the straight push has nowhere to go, LOOK AROUND rather than
    # give up. The push only ever tries ONE direction — straight back off the
    # nearest centreline — so a footprint on a corner, or one whose retreat is
    # blocked by the far kerb of a second street, fails even when there is real
    # cuadra land a few px to the side. It then went to the snapper, which finds
    # it a lattice rect and THROWS THE REAL OUTLINE AWAY; that outline is the
    # entire reason a named building is kept. 217 of them ended up there.
    #
    # In a real port there are no buildings standing on the sidewalk, so what a
    # footprint with no room needs is a piece of ground INSIDE its manzana. This
    # walks a ring of offsets out to RESEAT_MAX and takes the nearest one where
    # the whole outline stands on cuadra interior — same shape, same size, same
    # name, just moved off the pavement.
    RESEAT_MAX = 3 * CUAD
    RESEAT_STEP = GRID_CELL

    def _reseat_in_block(raw):
        pts = raw["pts"]
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        for rad in range(RESEAT_STEP, RESEAT_MAX + 1, RESEAT_STEP):
            best = None
            for a in range(0, 360, 15):
                dx = rad * math.cos(math.radians(a))
                dy = rad * math.sin(math.radians(a))
                moved = [(p[0] + dx, p[1] + dy) for p in pts]
                if _poly_over(moved, STREETISH):
                    continue
                cc, cr = int((cx + dx) // CUAD), int((cy + dy) // CUAD)
                if cell_block.get((cc, cr)) is None:
                    continue            # not inside a detected cuadra at all
                key = (abs(dx) + abs(dy), round(dx), round(dy))
                if best is None or key < best[0]:
                    best = (key, moved)
            if best:
                return best[1]
        return None


    # Parque Marino: exact OSM membership decides WHICH structures belong to
    # the aquarium and receive facility names. The surrounding CUADRA decides
    # which additional real buildings need their own ordinary lot before the
    # residual becomes park. Keeping those two questions separate fixes both
    # old failures: a block/AABB must not rename Plaza Centenario or Max Outlet
    # "Parque Marino", but neither may disappear under the lawn.
    marine_raw, marine_neighbour_raw, marine_block_raw = [], [], []
    if marine_site:
        marine_way = next((way for way in ctx.ways
                           if int(way["id"]) == MARINE_SITE_OSM_ID), None)
        if marine_way is None:
            raise RuntimeError(
                f"Parque Marino OSM boundary {MARINE_SITE_OSM_ID} is missing")
        marine_boundary, _ = project_way_pts(ctx.projection, marine_way["pts"])
        if len(marine_boundary) > 1 and dist(marine_boundary[0], marine_boundary[-1]) < 1e-6:
            marine_boundary = marine_boundary[:-1]
        marine_site["boundary"] = marine_boundary
        block_flat = outline_poly(marine_site["grass"], GRID_CELL)
        block_boundary = pairs(block_flat)
        if not block_boundary:
            raise RuntimeError("Parque Marino cuadra has no raster boundary")
        mc = marine_site["cells"]
        keep = []
        for raw in raw_bldgs:
            pts = raw.get("pts")
            if pts and point_in_poly(poly_centroid(pts), marine_boundary):
                marine_raw.append(raw)
            elif pts and (
                    point_in_poly(poly_centroid(pts), block_boundary)
                    or any(point_in_poly(p, block_boundary) for p in pts)):
                marine_neighbour_raw.append(raw)
            else:
                keep.append(raw)
        marine_raw.sort(key=lambda raw: raw["id"])
        marine_neighbour_raw.sort(key=lambda raw: raw["id"])
        marine_block_raw = sorted(
            marine_raw + marine_neighbour_raw, key=lambda raw: raw["id"])
        # THE MARINE BLOCK GETS THE SAME PUSH AS EVERY OTHER NAMED FOOTPRINT.
        # It never did: these are lifted OUT of `raw_bldgs` right here, and the
        # push loop below only ever walked what was left — so the one cuadra
        # whose buildings are all kept at their real outline was the one cuadra
        # where nothing was checked against the street. Max Outlet Puntarenas
        # was 49 % on the roadway and the acera, the LABM módulo 17 %, Plaza
        # Centenario 13 %.
        #
        # It has to happen HERE, before `_partition_marine_cuadra`: the lots are
        # cut from these footprints, so a building moved afterwards would leave
        # its own parcel behind on the asphalt.
        # NOT the group fit, on this one block. The Parque Marino's cuadra is
        # partitioned by hand — every structure's OSM id must end up owning
        # exactly one lot, and `finish.verify` fails the build if one does not.
        # Scaling the group toward the block's centre moved 911250915 off the
        # last LAND under it and the partition raised. The per-building push is
        # enough here: it already takes all ten to zero overlap.
        n_marine_moved = 0
        for raw in marine_block_raw:
            moved = _push_off_street(raw) or _reseat_in_block(raw)
            if moved is None or moved is raw["pts"]:
                continue
            raw["pts"] = moved
            n_marine_moved += 1
        log("marino", f"{n_marine_moved} of {len(marine_block_raw)} block footprints "
            f"pushed clear of the calzada/acera — BEFORE the lots are cut, or a "
            f"building would leave its own parcel behind on the asphalt")
        raw_bldgs = keep
        occ.update(mc)
        log("marino", f"{len(marine_raw)} OSM buildings inside exact park "
            f"boundary way {MARINE_SITE_OSM_ID}")
        if marine_neighbour_raw:
            log("marino", f"{len(marine_neighbour_raw)} neighbouring cuadra "
                "buildings keep ordinary named lots: "
                + ", ".join(
                    f"{raw['id']} {raw.get('osm_name') or raw.get('name') or '—'}"
                    for raw in marine_neighbour_raw))
        _partition_marine_cuadra(
            marine_site, marine_raw, marine_block_raw)
    # THE MANZANA IS A CONTAINER: fit its contents to it, as ONE GROUP, before
    # anything is shoved individually. See service/building.fit_manzana_contents
    # for why this is the operation and the per-feature push was not.
    _named_now = [b for b in raw_bldgs if b.get("name") and b.get("pts")]
    n_fit, n_nofit, _scales = fit_manzana_contents(
        raster, blocks, cell_block, _named_now, streets,
        lambda cells: block_raster_cells(raster, cells, CUAD_CELLS, CLS_LAND),
        erode_cells, ACERA_CELLS, STREET_CLASSES)
    log("buildings", f"{n_fit} named footprints fitted into their own manzana "
        f"(median scale {sorted(_scales)[len(_scales) // 2]:.2f} over {len(_scales)} "
        f"blocks that needed one); {n_nofit} manzanas left to the push"
        if _scales else
        f"{n_fit} named footprints already fitted their manzana; {n_nofit} left to the push")

    named_raw, keep, n_onroad, n_pushed, n_reseat = [], [], 0, 0, 0
    for raw in raw_bldgs:
        if not (raw.get("name") and raw.get("pts")):
            keep.append(raw)
            continue
        moved = _push_off_street(raw)
        if moved is None:
            moved = _reseat_in_block(raw)
            if moved is None:
                n_onroad += 1
                keep.append(raw)            # the snapper will find it a block
                continue
            n_reseat += 1
        if moved is not raw["pts"]:
            n_pushed += 1
            raw = {**raw, "pts": moved}
        named_raw.append(raw)
    raw_bldgs = keep
    if n_onroad:
        log("buildings", f"{n_onroad} named footprints had no room off the street — snapped instead")
    if n_pushed:
        log("buildings", f"{n_pushed} named footprints pushed back off the acera "
            f"(up to {PUSH_MAX} px, along the nearest street's normal)")
    if n_reseat:
        log("buildings", f"{n_reseat} named footprints reseated onto cuadra land "
            f"(the straight push had nowhere to go; the real outline is kept)")
    for raw in named_raw:
        xs = [p[0] for p in raw["pts"]]; ys = [p[1] for p in raw["pts"]]
        for cc in range(int(min(xs) // CUAD), int(max(xs) // CUAD) + 1):
            for cr in range(int(min(ys) // CUAD), int(max(ys) // CUAD) + 1):
                occ.add((cc, cr))
    buildings = snap_osm_buildings(raw_bldgs, cell_block, occ)
    synth = synth_buildings([b for b in blocks if not b["green"]],
                            cell_block, occ, len(buildings))
    log("buildings", f"+{len(synth)} synthesized in cuadra frontage bands "
          f"(total {len(buildings) + len(synth)})")
    buildings = buildings + synth
    # gate: every footprint sits on the cuadrícula (inset seam on each edge)
    for b in buildings:
        xs, ys = b["pts"][0::2], b["pts"][1::2]
        for v in (min(xs), max(xs), min(ys), max(ys)):
            if v % CUAD not in (BLDG_INSET, CUAD - BLDG_INSET):
                raise SystemExit(f"[gate] building edge off the cuadrícula: {v}")
    # after the gate: real footprints are deliberately OFF the lattice
    marine_buildings, marine_cuadra_buildings = [], []
    if marine_site:
        # Muted aquarium palette so the site reads as one complex, not a row of
        # houses in the random pastel mix. Neighbouring businesses keep the
        # ordinary deterministic building palette and their own OSM names.
        MARINE_WALL = ["#8fb8b0", "#a8c6be", "#7fa9a6", "#b7c9bd"]
        MARINE_ROOF = ["#3f5f63", "#4d6f70", "#35545a"]
        park_ids = {raw["id"] for raw in marine_raw}
        for i, raw in enumerate(marine_block_raw):
            flat = [round(v) for p in raw["pts"] for v in p]
            if raw["id"] in park_ids:
                real_name = (raw.get("osm_name")
                             or MARINE_BUILDING_NAMES.get(raw["id"]))
                if not real_name:
                    raise RuntimeError(
                        f"Parque Marino OSM building {raw['id']} has no real label")
                building = {
                    "pts": flat,
                    "color": MARINE_WALL[i % len(MARINE_WALL)],
                    "roof": MARINE_ROOF[i % len(MARINE_ROOF)], "wnd": 0,
                    "osmId": raw["id"], "building": raw.get("building"),
                    "marine": 1, "marineBlock": 1,
                    "name": real_name, "label": True,
                }
                marine_buildings.append(building)
            else:
                rng = make_rng(raw["id"])
                real_name = raw.get("osm_name") or raw.get("name")
                building = {
                    "pts": flat,
                    "color": BLDG_PALETTE[int(rng() * len(BLDG_PALETTE))],
                    "roof": ROOF_PALETTE[int(rng() * len(ROOF_PALETTE))],
                    "wnd": 1 if rng() < 0.7 else 0,
                    "osmId": raw["id"], "building": raw.get("building"),
                    "name": real_name or "Estructura de la cuadra",
                    "label": bool(real_name), "cat": raw.get("cat"),
                    "marineBlock": 1,
                }
                marine_cuadra_buildings.append(building)
            buildings.append(building)
        _place_marine_pools(marine_site, marine_block_raw)
        log("marino", f"{len(marine_raw)} aquarium buildings at their real OSM "
              f"footprints + {len(marine_cuadra_buildings)} named neighbours, "
              f"{len(marine_site['lm'].get('pools', []))} tanks placed clear")
    for raw in named_raw:
        rng = make_rng(raw["id"])
        buildings.append({"pts": [round(v) for p in raw["pts"] for v in p],
                          "color": BLDG_PALETTE[int(rng() * len(BLDG_PALETTE))],
                          "roof": ROOF_PALETTE[int(rng() * len(ROOF_PALETTE))],
                          "wnd": 1 if rng() < 0.7 else 0,
                          "name": raw["name"], "cat": raw.get("cat")})
    log("buildings", f"{len(named_raw)} NAMED buildings kept at their real OSM footprint")
    # The Balneario cuadra is a SEA inlet, so any building whose real footprint
    # lands inside it was floating on the water. Give each one a sand pad: a
    # dilated bbox emitted into `beaches` (painted AFTER the water, so it shows)
    # and stamped CLS_BEACH so the ground under the building is solid too.
    # ---- FEATURE PARCELS ---------------------------------------------------
    # Marino was already partitioned from raster cells above: its records are
    # real ground lots, not aliases of the building footprints. Balneario still
    # uses the generic footprint-derived form because its irregular block is a
    # water inlet rather than shared cadastral ground.
    fields.place_feature_parcels(
        {"id": "balneario_lote", "lm": "balneario", "name": "Balneario",
         "use": "lot"},
        buildings)

    if balneario:
        pads = 0
        for b in buildings:
            xs, ys = b["pts"][0::2], b["pts"][1::2]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            if not (balneario["x0"] <= cx <= balneario["x1"] and
                    balneario["y0"] <= cy <= balneario["y1"]):
                continue
            px0, py0 = min(xs) - 10, min(ys) - 10
            px1, py1 = max(xs) + 10, max(ys) + 10
            beaches.append([round(px0), round(py0), round(px1), round(py0),
                            round(px1), round(py1), round(px0), round(py1)])
            raster.fill_poly([(px0, py0), (px1, py0), (px1, py1), (px0, py1)], CLS_BEACH)
            pads += 1
        if pads:
            log("balneario", f"{pads} buildings given a sand pad (were floating on the inlet)")

    # WHAT STANDS ON WHAT. The world computed this pairing every build and threw
    # it away: a parcel knew its ground, a building knew its outline, and
    # nothing said the school building belongs to the school's plot. Written
    # down, "assign this building to that parcel" becomes an edit instead of a
    # guess, and the editor can show a parcel's contents without a spatial
    # search over 80k footprints.
    #
    # Bucketed by cuadra, not brute-forced: 80k buildings against 421 parcels is
    # 34M point-in-polygons, and this runs on every build.
    by_cuad = defaultdict(list)
    for parcel in parcels:
        for cc in range(int(parcel["x0"] // CUAD), int(parcel["x1"] // CUAD) + 1):
            for cr in range(int(parcel["y0"] // CUAD), int(parcel["y1"] // CUAD) + 1):
                by_cuad[(cc, cr)].append(parcel)
    linked = 0
    for b in buildings:
        xs, ys = b["pts"][0::2], b["pts"][1::2]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        for parcel in by_cuad.get((int(cx // CUAD), int(cy // CUAD)), ()):
            if not (parcel["x0"] <= cx <= parcel["x1"]
                    and parcel["y0"] <= cy <= parcel["y1"]):
                continue
            if not point_in_poly((cx, cy), list(zip(parcel["poly"][0::2],
                                                    parcel["poly"][1::2]))):
                continue
            b["parcelId"] = parcel["id"]
            linked += 1
            break
    log("parcel", f"{linked} buildings linked to the parcel they stand on")

    return buildings, occ, stadiums, parcels


def decorate(ctx, *, sp, roads, blocks, occ, waters, topY, botY, bridge_road, palm_runs, tree_runs, resolve, buildings):
    raster = ctx.raster
    grid = raster.buf
    CANVAS_W, CENTER_Y = ctx.dims.w, ctx.dims.center_y
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    # LA FERIA DEL MALECÓN — seated here, in the stage that runs last, for the
    # same reason everything else in it is: the rides snap onto the FINISHED
    # promenade, and the DJ onto the frontage of a building that only exists
    # once place_structures has run.
    # The campo ferial is laid out in the PASEO'S frame, so this stage needs a
    # street index of its own — `decorate` never had one, and reaching for the
    # name that exists in `place_structures` is how this failed the first time.
    ctx.attractions.extend(place_attractions(
        ctx, lambda lat, lon: ctx.projection.project(to_m(lat, lon))[:2],
        buildings, StreetIndex(roads)))
    # --- bridge / estuary / decorations
    if bridge_road:
        bp = bridge_road["pts"]
        xs = bp[0::2]
        ys = bp[1::2]
        bx0, bx1 = min(xs), max(xs)
        bcy = sum(ys) / len(ys)
    else:
        pm, _, _ = resolve({"osm": "puente colgante mata de limón"})
        if pm is None:
            # region has no Mata bridge (e.g. a bounded build) — stub it off-map
            x, y = CANVAS_W - 40, 40
        else:
            x, y, _, _ = sp.project(pm)
        bx0, bx1, bcy = x - 80, x + 80, y
        bw = road_width_px("bridge")
        roads.append({"cls": "bridge", "w": bw,
                      "pts": [round(bx0), round(bcy), round(bx1), round(bcy)]})
        raster.stamp_polyline(roads[-1]["pts"], bw + 6, CLS_BRIDGE)
    span = bx1 - bx0
    bridge = {"x0": round(bx0), "x1": round(bx1), "cy": round(bcy), "deckW": 60,
              "towers": [round(bx0 + span * 0.15), round(bx1 - span * 0.15)], "towerH": 180,
              "pts": bridge_road["pts"] if bridge_road else roads[-1]["pts"]}

    # estuary ellipse from the largest water poly near the bridge
    est = None
    for wp in waters:
        pts = [(wp[i], wp[i + 1]) for i in range(0, len(wp), 2)]
        cx, cy = poly_centroid(pts)
        if abs(cx - (bx0 + bx1) / 2) < 2700:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            cand = {"cx": round(cx), "cy": round(cy),
                    "rx": round((max(xs) - min(xs)) / 2), "ry": round((max(ys) - min(ys)) / 2)}
            if est is None or cand["rx"] * cand["ry"] > est["rx"] * est["ry"]:
                est = cand
    if est is None:
        est = {"cx": round((bx0 + bx1) / 2 + 900), "cy": CENTER_Y - 360, "rx": 840, "ry": 210}
        warn("estuary", "no water poly near bridge; synthetic ellipse")

    # EL MANGLAR. The mangroves used to ring this estuary ELLIPSE, which is a
    # bbox by another name: it is fitted to the largest water polygon near the
    # bridge, so its rim ran through open ground kilometres from any bank. They
    # follow the real waterline now — the same estero band that keeps the sand
    # fringe off the north shore (see service.surface.estero_band).
    mangroves = mangrove_line(raster, ctx.estero)

    # palms: along shores where land is present, plus along the paseo road
    palms = []
    seed = 33
    def rng():
        nonlocal seed
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280
    x = 140.0
    while x < CANVAS_W - 60:
        c = int(x / GRID_CELL)
        if 0 <= c < GRID_COLS and botY[c] - topY[c] > 60:
            palms.append({"x": round(x), "y": round(botY[c] - 12 - rng() * 6),
                          "s": round(0.9 + rng() * 0.4, 2), "sway": round(rng() * 6.28, 2)})
        x += 45 + rng() * 30
    x = 220.0
    while x < CANVAS_W - 60:
        c = int(x / GRID_CELL)
        if 0 <= c < GRID_COLS and botY[c] - topY[c] > 60:
            palms.append({"x": round(x), "y": round(topY[c] + 10 + rng() * 6),
                          "s": round(0.8 + rng() * 0.4, 2), "sway": round(rng() * 6.28, 2)})
        x += 70 + rng() * 60
    # WHICH SPECIES EACH PLANTED TREE IS. From a POSITION HASH, never from
    # `rng()`: the seeded stream is shared by every scatter in this stage, so
    # taking one draw per tree would shift every value after it and a change of
    # species would come out of the diff looking like the whole world moved.
    # Hashing the position also means a tree keeps its species if something
    # unrelated upstream changes.
    _FLORA = flora_registry()
    _DEFAULT_TREE = _FLORA["defaults"]["treeSpecies"]
    _DEFAULT_PALM = _FLORA["defaults"]["palmSpecies"]
    run_specs = _FLORA["plantingRuns"]
    palm_spec = run_specs["paseo_median"]
    leon_spec = run_specs["leon_cortes"]
    ferro_spec = run_specs["ferrocarril"]
    cocal_spec = run_specs["cocal_median"]

    def _species(mix_name, x, y, default):
        weights = _FLORA["plantings"][mix_name]["weights"]
        v = math.sin(x * 12.9898 + y * 78.233) * 43758.5453
        roll = (v - math.floor(v)) * sum(w for _, w in weights)
        for name, w in weights:
            roll -= w
            if roll <= 0:
                return name
        return weights[-1][0]

    def _plant(out, x, y, s, mix_name, default=None, line=None):
        """Append a tree, naming its species only when it is not the default —
        22 000 records, so the common case must cost no bytes.

        `line` NAMES THE PLANTING RUN a tree belongs to, and it is the whole
        difference between a line you can edit and 100-odd anonymous records.
        The editor derives an id per tree from its geometry, so without this you
        can hide ONE tree of the Ferrocarril shoulder — never the shoulder. It
        is absent on the patio scatter, which genuinely belongs to no run.
        """
        default = default or _DEFAULT_TREE
        rec = {"x": x, "y": y, "s": s}
        kind = _species(mix_name, x, y, default)
        if kind != default:
            rec["k"] = kind
        if line:
            rec["line"] = line
        out.append(rec)

    # Paseo de los Turistas: PALMS on the median dashes, planted inside the
    # same street-aligned runs the median stamp uses.
    PALM_PITCH = metres_to_px(palm_spec["spacingM"])
    PALM_END_MARGIN = metres_to_px(palm_spec["endMarginM"])
    n_median_palms = 0
    for samples, runs in palm_runs:
        for (k0, k1) in runs:
            s0, s1 = samples[k0][0] + PALM_END_MARGIN, samples[k1][0] - PALM_END_MARGIN
            nxt = s0
            for (s, x, y) in samples[k0:k1 + 1]:
                if s >= nxt and s <= s1:
                    # paintPalm anchors the trunk base at y+4 (shadow at y+5), so
                    # planting on the island centerline drops the visible palm to
                    # the strip's lower edge. Lift by that base offset so the
                    # trunk sits centered ON the median island.
                    offset = palm_spec["anchorOffsetM"]
                    px_x = round(x + metres_to_px(offset[0]))
                    px_y = round(y + metres_to_px(offset[1]))
                    scale = palm_spec["scale"][0]
                    rec = {"x": px_x, "y": px_y, "s": scale,
                           "sway": round(rng() * 6.28, 2),
                           "line": "paseo_median"}
                    species = _species(palm_spec["mix"], px_x, px_y, _DEFAULT_PALM)
                    if species != _DEFAULT_PALM:
                        rec["k"] = species
                    palms.append(rec)
                    n_median_palms += 1
                    nxt = s + PALM_PITCH
    # Trees (almendros/robles) along the continuous tree lines only.
    TREE_PITCH = metres_to_px(leon_spec["spacingM"])
    TREE_END_MARGIN = metres_to_px(leon_spec["endMarginM"])
    trees = []
    for samples, runs in tree_runs:
        for (k0, k1) in runs:
            s0, s1 = samples[k0][0] + TREE_END_MARGIN, samples[k1][0] - TREE_END_MARGIN
            nxt = s0
            for (s, x, y) in samples[k0:k1 + 1]:
                if s >= nxt and s <= s1:
                    lo, hi = leon_spec["scale"]
                    _plant(trees, round(x), round(y), round(lo + rng() * (hi - lo), 2),
                           leon_spec["mix"], line="leon_cortes")
                    nxt = s + TREE_PITCH

    # Tree line on the north SHOULDER of the elevated barro route — Avenida 2
    # del Ferrocarril and the Cocal-side avenue — separating it from the
    # parallel Avenida Alberto Echandi Montero. Decorative trees, NOT a median:
    # nothing is stamped, so the barro avenue stays fully drivable. Gapped at
    # every cross street.
    #
    # IT RUNS THE WHOLE ROUTE, and until now the code said otherwise. There was
    # a `FERRO_TREE_X0 = 6892` here with a comment promising the line started
    # there — a CORRIDOR-ERA world-px anchor, left behind by the planar rebuild
    # exactly like the one that had the Cocal median planting nothing. Measured
    # on the shipped world: the elevated route spans x 26 200..57 648, so the
    # guard could never fire and cut off 0 points. Removing it changes no tree;
    # keeping it would have been a number that looks like a decision and is not.
    # (`EVERY ANCHOR IS GEO` in CLAUDE.md is the rule it broke.)
    selector = ferro_spec["streetSelector"]
    ferro = [r for r in roads if selector == "elevated" and r.get("elev")]
    other_pts = [(x, y) for r in roads
                 if not r.get("elev")
                 for x, y in zip(r["pts"][0::2], r["pts"][1::2])]
    def _near_crossing(point_x, point_y,
                       rad=metres_to_px(ferro_spec["crossingRadiusM"])):
        rr = rad * rad
        return any((point_x - ox) ** 2 + (point_y - oy) ** 2 < rr
                   for ox, oy in other_pts)
    n_ferro_trees = 0
    for r in ferro:
        samples = resample_centerline(
            r["pts"], metres_to_px(ferro_spec["spacingM"]))
        for i, (s, cx, cy) in enumerate(samples):
            j = i + 1 if i + 1 < len(samples) else max(0, i - 1)
            hx, hy = samples[j][1] - cx, samples[j][2] - cy
            h = math.hypot(hx, hy) or 1.0
            nx, ny = -hy / h, hx / h
            off = r["w"] / 2 + metres_to_px(ferro_spec["roadEdgeOffsetM"])
            tx, ty = cx + nx * off, cy + ny * off
            if ferro_spec["side"] == "north" and ty > cy:
                tx, ty = cx - nx * off, cy - ny * off
            elif ferro_spec["side"] == "south" and ty < cy:
                tx, ty = cx - nx * off, cy - ny * off
            if _near_crossing(cx, cy):       # respect intersections (leave gaps)
                continue
            c, gr = int(tx / GRID_CELL), int(ty / GRID_CELL)
            if not (0 <= c < GRID_COLS and 0 <= gr < GRID_ROWS):
                continue
            # only BESIDE the lane: never on the drivable lane (or a cross
            # street / paseo / bridge / water) — this is the Cocal-side tree
            # line the user saw sitting on top of streets.
            if grid[gr * GRID_COLS + c] in CARRIAGEWAY_CLASSES + (CLS_WATER,):
                continue
            lo, hi = ferro_spec["scale"]
            _plant(trees, round(tx), round(ty), round(lo + rng() * (hi - lo), 2),
                   ferro_spec["mix"],
                   line="ferrocarril")
            n_ferro_trees += 1
    # Planted median down the middle of the divided Cocal avenue.
    #
    # THE WINDOW COMES FROM THE ROADS, NOT FROM TWO NUMBERS. This asked for
    # x 8139..11921 — a corridor-era anchor — while both avenues actually run
    # x 26200..70786, so it had been planting NOTHING for as long as the planar
    # world has existed, and the comment above it said "planar never divides
    # that avenue" as though that were a finding rather than a consequence of
    # looking 15 000 px away from it. Measured on the real geometry: of 130
    # sample points where both avenues are present, 55 have them within 120 px
    # of each other. It IS a divided avenue. (`EVERY ANCHOR IS GEO` in
    # CLAUDE.md is the rule this broke.)
    def _centerline_pts(name):
        out = []
        for r in roads:
            if (r.get("name") or "") == name:
                out += [(x, y) for (_, x, y) in resample_centerline(
                    r["pts"], metres_to_px(cocal_spec["sampleStepM"]))]
        return sorted(out)
    A = _centerline_pts(cocal_spec["streetNames"][0])
    B = _centerline_pts(cocal_spec["streetNames"][1])
    n_dc = 0
    if A and B:
        # where the two carriageways overlap in x, which is the only stretch on
        # which "the middle of a divided avenue" means anything
        span0, span1 = max(A[0][0], B[0][0]), min(A[-1][0], B[-1][0])
        for xs in range(int(span0), int(span1) + 1,
                        round(metres_to_px(cocal_spec["spacingM"]))):
            a = min(A, key=lambda p: abs(p[0] - xs))
            b = min(B, key=lambda p: abs(p[0] - xs))
            tolerance = metres_to_px(cocal_spec["matchToleranceM"])
            separation = metres_to_px(cocal_spec["maxSeparationM"])
            if (abs(a[0] - xs) < tolerance and abs(b[0] - xs) < tolerance
                    and abs(a[1] - b[1]) < separation):
                mx, my = xs, round((a[1] + b[1]) / 2)
                c, gr = int(mx / GRID_CELL), int(my / GRID_CELL)
                if 0 <= c < GRID_COLS and 0 <= gr < GRID_ROWS and \
                        grid[gr * GRID_COLS + c] not in CARRIAGEWAY_CLASSES + (CLS_WATER,):
                    # scale from the POSITION HASH, not `rng()`: this used to
                    # plant nothing, so taking 55 draws would shift every value
                    # the scatters after it pull from the shared stream and the
                    # whole patio planting would move for no reason.
                    h = math.sin(mx * 12.9898 + my * 78.233) * 43758.5453
                    lo, hi = cocal_spec["scale"]
                    _plant(trees, mx, my,
                           round(lo + (h - math.floor(h)) * (hi - lo), 2),
                           cocal_spec["mix"],
                           line="cocal_median")
                    n_dc += 1
    log("median", f"{n_median_palms} palms on the paseo median dashes, "
          f"{len(trees)} trees on the tree lines ({n_ferro_trees} Ferrocarril, "
          f"{n_dc} Cocal divided-avenue median)")

    # --- living puerto: trees in the cuadra patios (the open interiors behind
    # the frontage band) and parks, plus coconut palms scattered on open beach.
    # Deterministic: sorted block/cell order + the shared seeded rng.
    n_patio = 0
    PATIO_MAX = 45000
    for bi in sorted(range(len(blocks)), key=lambda i: min(blocks[i]["cells"])):
        b = blocks[bi]
        # A WOOD PLANTS ITSELF. These are the rural blobs, and the renderer
        # scatters a whole forest over them from `cuadra.wood` — emitting the
        # old handful of patio trees here as well would be both redundant and
        # the only part of it that costs tile bytes.
        if b.get("wood"):
            continue
        green = b.get("green")
        size = len(b["cells"])
        p = 0.55 if green else 0.30
        if size > 400:                       # huge rural blocks: bounded, not carpeted
            p *= 400.0 / size
        for (cc, cr) in sorted(b["cells"], key=lambda c: (c[1], c[0])):
            if n_patio >= PATIO_MAX:
                break
            if (cc, cr) in occ:
                continue
            if rng() > p:
                continue
            _plant(trees, round(cc * CUAD + CUAD / 2 + (rng() - 0.5) * 8),
                   round(cr * CUAD + CUAD / 2 + (rng() - 0.5) * 8),
                   round(0.85 + rng() * 0.4, 2), "parque")
            n_patio += 1
    n_beach_palms = 0
    _lat = 6                                     # 6 cells = 24 px lattice
    for gr in range(0, GRID_ROWS, _lat):
        row = gr * GRID_COLS
        for gc in range(0, GRID_COLS, _lat):
            if grid[row + gc] != CLS_BEACH:
                continue
            if rng() > 0.16:
                continue
            palms.append({"x": round(gc * GRID_CELL + (rng() - 0.5) * 18),
                          "y": round(gr * GRID_CELL + (rng() - 0.5) * 18),
                          "s": round(0.75 + rng() * 0.45, 2),
                          "sway": round(rng() * 6.28, 2)})
            n_beach_palms += 1
    # LA ARBOLEDA DEL MALECÓN. The beach sampler above looks for CLS_BEACH, so
    # the moment the sea front became its own class it stopped being planted —
    # and a promenade that is only paving is a slab, not a paseo. Two rows, and
    # which row a tree joins is decided by what the cell BORDERS, so both follow
    # the band's real wandering edge instead of a fitted line:
    #   * a PALMA where the paving meets the sand — the row you see against the
    #     sea from anywhere on the Paseo;
    #   * an ALMENDRO where it meets the street, the shade side, where the
    #     benches and the stands are.
    # Spacing is enforced on a coarse lattice rather than by probability: at
    # 0.16 per cell the band came out a thicket at its wide points and bare at
    # the narrow ones, because the roll does not know how much promenade is
    # there. Deterministic — the shared seeded rng, walked in sorted order.
    # HOW FAR APART, MEASURED IN CROWNS. A palm is drawn ~26 px across at play
    # zoom, and the camera frames 20 cuadrículas — so a lattice of 30 px, which
    # is what this had first, put one plant every 15 px along the band's
    # wandering edge and turned the whole sea front into one canopy with the
    # paving invisible under it. A row of palms is a row: you have to see
    # between them.
    n_mal_palms, n_mal_trees = 0, 0
    PLANT_GAP = {_DEFAULT_PALM: 110, _DEFAULT_TREE: 150}
    placed = {_DEFAULT_PALM: [], _DEFAULT_TREE: []}

    def _room(kind, px, py):
        gap2 = PLANT_GAP[kind] ** 2
        for (qx, qy) in placed[kind]:
            if (px - qx) ** 2 + (py - qy) ** 2 < gap2:
                return False
        placed[kind].append((px, py))
        return True

    def malecon_cells():
        """The band's own cells, bounded to its bbox — the grid is 158M cells."""
        for band in ctx.malecon:
            c0, r0 = int(band["x0"] // GRID_CELL), int(band["y0"] // GRID_CELL)
            c1, r1 = int(band["x1"] // GRID_CELL) + 1, int(band["y1"] // GRID_CELL) + 1
            for gr in range(max(0, r0), min(GRID_ROWS, r1)):
                for gc in range(max(0, c0), min(GRID_COLS, c1)):
                    if grid[gr * GRID_COLS + gc] == CLS_MALECON:
                        yield gc, gr, band

    # LAS BANCAS. Emitted as street furniture, like the paradas: the world says
    # where one is and which way it looks, the renderer draws it. A bench on a
    # sea front faces the SEA, which is the whole reason it carries an angle —
    # the coast wanders, so "seaward" is the band's own normal, its sign taken
    # from the side the sand is actually on at that cell.
    n_bancas, bancas = 0, set()
    BANCA_GAP = 96                                 # px between two bancas
    for gc, gr, band in malecon_cells():
        row = gr * GRID_COLS
        nbs = {(1, 0): grid[row + gc + 1] if gc + 1 < GRID_COLS else CLS_WATER,
               (-1, 0): grid[row + gc - 1] if gc else CLS_WATER,
               (0, 1): grid[row + GRID_COLS + gc] if gr + 1 < GRID_ROWS else CLS_WATER,
               (0, -1): grid[row - GRID_COLS + gc] if gr else CLS_WATER}
        px = gc * GRID_CELL + GRID_CELL / 2
        py = gr * GRID_CELL + GRID_CELL / 2
        sand = [d for d, v in nbs.items() if v == CLS_BEACH]
        if sand:
            if _room(_DEFAULT_PALM, px, py):
                palms.append({"x": round(px + (rng() - 0.5) * 8),
                              "y": round(py + (rng() - 0.5) * 8),
                              "s": round(0.85 + rng() * 0.35, 2),
                              "sway": round(rng() * 6.28, 2)})
                n_mal_palms += 1
            key = (int(px // BANCA_GAP), int(py // BANCA_GAP))
            if key not in bancas:
                bancas.add(key)
                a = band.get("ang", 0.0)
                nx, ny = -math.sin(a), math.cos(a)      # the band's normal
                if nx * sand[0][0] + ny * sand[0][1] < 0:
                    nx, ny = -nx, -ny                   # …pointed at the sand
                ctx.signs.append({"x": round(px - nx * 6), "y": round(py - ny * 6),
                                  "kind": SignKind.BANCA, "ang": round(math.atan2(ny, nx), 3)})
                n_bancas += 1
        elif any(v in (CLS_ROAD, CLS_ACERA) for v in nbs.values()):
            if _room(_DEFAULT_TREE, px, py):
                trees.append({"x": round(px + (rng() - 0.5) * 8),
                              "y": round(py + (rng() - 0.5) * 8),
                              "s": round(0.8 + rng() * 0.35, 2)})
                n_mal_trees += 1
    if n_bancas:
        log("malecon", f"{n_bancas} bancas facing the sea")
    log("verde", f"{n_patio} patio/park trees, {n_beach_palms} beach palms, "
        f"{n_mal_palms} palmas + {n_mal_trees} almendros on the malecón")

    return bridge, est, trees, palms, mangroves
