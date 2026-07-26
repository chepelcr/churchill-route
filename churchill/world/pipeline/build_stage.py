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
from collections import defaultdict, deque

from ..config import (
    ACERA_CELLS, BLDG_INSET, CLS_ACERA, CLS_BEACH, CLS_BRIDGE, CLS_LAND,
    CLS_PASEO, CLS_ROAD, CLS_WATER, CUAD, CUAD_CELLS, GRID_CELL,
    LEON_END_STREET, PASEO_LEON, PASEO_MEDIAN_W, PASEO_TURISTAS, STREET_CLASSES,
    SYNTH_MAX_TOTAL, road_width_px,
)
from ..content import BLDG_PALETTE, LANDMARK_DEFS, ROOF_PALETTE
from ..enums import GreenType, LandmarkType, ParcelUse
from ..logging import log, warn
from ..service.block import (
    block_raster_cells, cells_to_rects, cuadra_cells, outline_poly,
)
from ..service.building import (
    _grid_placer, make_rng, snap_osm_buildings, synth_buildings,
)
from ..service.decoration import (
    paseo_median_runs, paseo_roads, stamp_paseo_median,
)
from ..service.ferry import stern_at_rest
from ..service.field import FieldService
from ..service.placement import (
    cell_class, kiosk_frontage, nearest_block, nearest_cell, road_adj,
)
from ..service.street import StreetIndex, half_plane, resample_centerline
from ..service.surface import stamp_pad
from ..util.geometry import dist, pairs, point_in_poly, poly_centroid, to_m
from ..util.raster import erode_cells


def seat_town_kiosks(ctx, *, landmarks, customers, districts, roads, waters, blocks, greens, kiosk_paths, beach_kiosks, mlm, pier, balneario, balneario_cells, marine_site, _nearest_cell, _block_containing, _block_raster_cells, _green_poly):
    raster = ctx.raster
    grid = raster.buf
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    # --- TOWN kiosks: seat each on a NEARBY cuadra FRONTAGE cell (solid land next
    # to a street, never the roadway/acera/median) and carve a short paved
    # connector + apron to the nearest street. Bounded to a small radius so a
    # kiosk with no cuadra beside it (e.g. on the Paseo boardwalk) stays put and
    # just gets the pad+connector instead of teleporting to a far block.
    KIOSK_SNAP_CUAD = 10                       # ≤ this many cuadrículas from anchor
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
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm["id"] in beach_kiosks:
            if lm["type"] == "kiosk":
                stamp_pad(raster, lm["x"], lm["y"], 44)   # apron for the beach stand
            continue
        spot = _kiosk_frontage(lm["x"], lm["y"])
        if spot:
            lm["x"], lm["y"] = round(spot[0]), round(spot[1])
        stamp_pad(raster, lm["x"], lm["y"], 44)            # drivable pocket
        tgt = _nearest_cell(lm["x"], lm["y"], (CLS_ROAD, CLS_BRIDGE, CLS_PASEO), 60)
        if tgt:
            raster.stamp_polyline([lm["x"], lm["y"], tgt[0], tgt[1]], 1.4 * CUAD, CLS_ROAD)
            kiosk_paths.append({"pts": [round(lm["x"]), round(lm["y"]),
                                        round(tgt[0]), round(tgt[1])], "surface": "paved"})
            log("kiosk", f"{lm['id']} -> cuadra frontage ({lm['x']},{lm['y']}), paved connector")

    # Player spawn per kiosk: run starts place the player beside the run's first
    # kiosk. Snap that point to the nearest DRIVABLE street cell now (build time,
    # so modes.js never spawns on the beach beside a sand kiosk and never probes
    # tiles that aren't resident yet). kios_faro keeps its muelle-deck spawn.
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm.get("spawn"):
            continue
        tgt = _nearest_cell(lm["x"], lm["y"], (CLS_ROAD, CLS_BRIDGE, CLS_PASEO), 260)
        if tgt:
            lm["spawn"] = [round(tgt[0]), round(tgt[1])]
        else:
            log("kiosk", f"WARN no street spawn near {lm['id']} ({lm['x']},{lm['y']})")

    # FERRY RAMPS. The berths sit over water with a strip of sand between them
    # and the terminal road, and sand is a WALL to the car — so without this you
    # could see both ferries and never board one. Same recipe as a beach kiosk's
    # connector: pave from the berth to the nearest street and emit the segment
    # so it is DRAWN as asphalt too. Paving without emitting would leave a strip
    # of invisible drivable sea, which is worse than the wall.
    for fy in ctx.ferries:
        sx, sy = stern_at_rest(fy)
        tgt = _nearest_cell(sx, sy, (CLS_ROAD, CLS_BRIDGE, CLS_PASEO), 260)
        if not tgt:
            log("ferry", f"WARN no street near the {fy['id']} berth to ramp to"); continue
        # 2 cuadrículas wide — a shade under the deck, so the ramp is as wide as
        # the door you drive through rather than a footpath to it
        raster.stamp_polyline([sx, sy, tgt[0], tgt[1]], 2.0 * CUAD, CLS_ROAD)
        kiosk_paths.append({"pts": [round(sx), round(sy), round(tgt[0]), round(tgt[1])],
                            "surface": "paved"})
        log("ferry", f"{fy['id']} ramp stern ({round(sx)},{round(sy)}) -> street "
            f"({round(tgt[0])},{round(tgt[1])}), {round(dist((sx, sy), tgt))}px")

    # OSM parks (parquemar, cocal_park) + the Balneario pool: paint their green
    # on the containing block's footprint so the cuadra is OPEN (no buildings),
    # tagged by type for the renderer's colour-by-type fill.
    _nearest_block = lambda x, y, min_cells=12: nearest_block(blocks, x, y, min_cells)
    for lm in landmarks:
        if lm["type"] not in ("park", "pool"):
            continue
        bi = _block_containing(lm["x"], lm["y"])
        if bi is None and lm["type"] == "pool":
            bi = _nearest_block(lm["x"], lm["y"])   # the Balneario must sit IN a cuadra
        if bi is None:
            continue
        blocks[bi]["green"] = True
        cells = blocks[bi]["cells"]
        bc0 = min(c for c, _ in cells); bc1 = max(c for c, _ in cells)
        br0 = min(r for _, r in cells); br1 = max(r for _, r in cells)
        if lm["type"] == "pool":
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
        marine = lm["id"] == "parquemar"     # Parque Marino fills its whole cuadra
        g = _green_poly(cells, "marine" if marine else "park")
        if g: greens.append(g)
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

    # Synthetic parks: scatter green spaces (each with a fountain) across the
    # town so parks aren't rare. Pick well-sized cuadras clear of other POIs,
    # mark them green (no synth buildings), and add a park landmark sized to
    # the block. Spatially spread by sorting candidates on x.
    _pts = [(l["x"], l["y"]) for l in landmarks] + [(c["x"], c["y"]) for c in customers]
    def _dcls(cc, cr):
        d = {d["id"]: (d["x0"], d["x1"]) for d in districts}
        for did, (x0, x1) in d.items():
            if x0 <= cc * CUAD < x1:
                return did
        return districts[0]["id"]
    park_cands = []
    for bi, b in enumerate(blocks):
        if b.get("green"):
            continue
        cells = b["cells"]; sz = len(cells)
        if sz < 6 or sz > 160:              # a small-to-mid cuadra (green render covers it)
            continue
        bc0 = min(c for c, _ in cells); bc1 = max(c for c, _ in cells)
        br0 = min(r for _, r in cells); br1 = max(r for _, r in cells)
        cx = (bc0 + bc1 + 1) * CUAD // 2; cy = (br0 + br1 + 1) * CUAD // 2
        if any((cx - px) ** 2 + (cy - py) ** 2 < 220 ** 2 for px, py in _pts):
            continue
        w = min(300, (bc1 - bc0 + 1) * CUAD); h = min(240, (br1 - br0 + 1) * CUAD)
        park_cands.append((cx, cy, bi, w, h))
    log("parks", f"{len(park_cands)} candidate blocks")
    park_cands.sort()
    TARGET_PARKS = 16
    n_park = 0
    if park_cands:
        step = max(1, len(park_cands) // TARGET_PARKS)
        for j in range(0, len(park_cands), step):
            if n_park >= TARGET_PARKS:
                break
            cx, cy, bi, w, h = park_cands[j]
            blocks[bi]["green"] = True       # keep the interior open (no buildings)
            # paint the park's green on the block footprint (never over streets)
            g = _green_poly(blocks[bi]["cells"], "park")
            if g: greens.append(g)
            landmarks.append({"id": f"park_syn_{n_park}", "name": "Parque",
                              "x": int(cx), "y": int(cy), "type": "park",
                              "district": _dcls(cx // CUAD, cy // CUAD),
                              "w": min(160, int(w)), "h": min(140, int(h))})
            _pts.append((cx, cy))
            n_park += 1
    log("parks", f"+{n_park} synthetic parks scattered across the town")

    # The avenue's separators (final layout, user-iterated):
    # - Paseo de los Turistas: its classic PALM median — dashes with crossing
    #   gaps aligned to the coming streets (paseo_median_runs).
    # - The kiosks street (Paseo León Cortés): ONE continuous tree strip from
    #   the first cuadra's corner (the Turistas→León Cortés curve stays fully
    #   drivable) up to just before the muelle street; beyond, normal street.
    tzx1 = mlm["x"] - 3 * CUAD          # stop clear of the muelle street

    def continuous_runs(pieces, x0=None, x1=None):
        out = []
        for r in pieces:
            samples = resample_centerline(r["pts"], 4.0)
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
                if PASEO_TURISTAS in (r.get("name") or "").lower()]
    leon = [r for r in paseo_roads(roads)
            if PASEO_LEON in (r.get("name") or "").lower()]

    # the tree strip starts at the SW corner of the first cuadra facing the
    # León Cortés stretch — never inside the curve that leads into it
    leon_cl = [(x, y) for r in leon
               for (_, x, y) in resample_centerline(r["pts"], 8.0)]
    lx0, lx1 = min(x for x, _ in leon_cl), max(x for x, _ in leon_cl)

    def _leon_y(x):
        return min(leon_cl, key=lambda p: abs(p[0] - x))[1]

    corner_xs = []
    for b in blocks:
        for (cc, cr) in b["cells"]:
            bx, by = cc * CUAD, (cr + 1) * CUAD          # cell SW corner
            if lx0 <= bx <= min(lx1, tzx1) and 0 < _leon_y(bx) - by <= 6 * CUAD:
                corner_xs.append(bx)
    tzx0 = min(corner_xs, default=lx0)
    log("median", f"León Cortés tree strip x{tzx0}-{tzx1} (cuadra corner start)")

    palm_runs = paseo_median_runs(roads, turistas)
    tree_runs = continuous_runs(leon, x0=tzx0, x1=tzx1)
    medians = stamp_paseo_median(raster, palm_runs + tree_runs)

    # --- buildings on the cuadrícula: snap OSM footprints, then fill the
    # cuadras' frontage bands with synth lots (shared occupancy, POI keepouts)
    keepouts = []
    for lm in landmarks:
        keepouts.append((lm["x"], lm["y"], 100 if lm["type"] == "kiosk" else 68))
    for cu in customers:
        keepouts.append((cu["x"], cu["y"], 100))
    keepouts.append((pier["x"], pier["y0"], 120))
    return balneario, balneario_cells, marine_site, keepouts, medians, palm_runs, tree_runs


def place_structures(ctx, *, landmarks, roads, blocks, greens, plazas, beaches, balneario, balneario_cells, marine_site, keepouts, streets, raw_bldgs, _green_poly, _block_raster_cells):
    raster = ctx.raster
    grid = raster.buf
    CANVAS_W, CANVAS_H = ctx.dims.w, ctx.dims.h
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    cell_block, occ = _grid_placer(blocks, keepouts)
    if balneario_cells:                 # keep OSM buildings off the Balneario water
        occ.update(balneario_cells)

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

    # Aquarium tanks: farthest-point spread over grass cells that CLEAR both the
    # acera and every aquarium building. drawPool paints a 78x48 ellipse at
    # s=0.46 (~36x22 px) with a tree/palm at (px-26, py+12), so a tank needs
    # TANK_CLEAR px of lawn all round or it spills onto the sidewalk.
    TANK_CLEAR = 26
    def _place_marine_pools(site, raws, want=5):
        grass = site["grass"]                         # grass cells (CLS_LAND only)
        # distance (in cells) from every grass cell to the nearest non-grass one
        dist = {}
        q = deque()
        for cell in grass:
            c, rr = cell
            if any((c + dc, rr + dr) not in grass for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                dist[cell] = 1; q.append(cell)
        while q:
            c, rr = q.popleft()
            d = dist[(c, rr)] + 1
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (c + dc, rr + dr)
                if n in grass and n not in dist:
                    dist[n] = d; q.append(n)
        boxes = []
        for raw in raws:
            xs = [p[0] for p in raw["pts"]]; ys = [p[1] for p in raw["pts"]]
            boxes.append((min(xs) - TANK_CLEAR, min(ys) - TANK_CLEAR,
                          max(xs) + TANK_CLEAR, max(ys) + TANK_CLEAR))
        free = lambda px, py: not any(x0 <= px <= x1 and y0 <= py <= y1
                                      for (x0, y0, x1, y1) in boxes)
        # Relax the clearance until the lawn offers enough well-separated spots:
        # this block is cut by interior paths, so a hard 26 px leaves one pocket
        # and all five tanks pile up in it.
        cand = []
        for need in (TANK_CLEAR, 22, 18, 14, 10):
            r = need / GRID_CELL
            cand = [(c * GRID_CELL, rr * GRID_CELL) for (c, rr) in grass
                    if dist.get((c, rr), 0) >= r and not (c % 3 or rr % 3)
                    and free(c * GRID_CELL, rr * GRID_CELL)]
            if len(cand) >= want * 8:
                break
        if not cand:
            log("marino", "WARN no clear spot for the aquarium tanks"); return
        log("marino", f"{len(grass)} grass cells -> {len(cand)} tank candidates "
              f"at >={round(need)}px clearance")
        mx = sum(p[0] for p in cand) / len(cand); my = sum(p[1] for p in cand) / len(cand)
        pts = [min(cand, key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2)]
        while len(pts) < want and len(pts) < len(cand):
            pts.append(max(cand, key=lambda p: min((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 for q in pts)))
        site["lm"]["pools"] = [[int(p[0]), int(p[1])] for p in pts]

    # Estadios and parcels: one service over the world under construction.
    fields = FieldService(raster=raster, streets=streets, landmarks=landmarks,
                          blocks=blocks, greens=greens, plazas=plazas,
                          stadiums=stadiums, parcels=parcels, occ=occ)

    # Calle/Avenida refs mapped to the OSM names actually present here (odd
    # calles are unnamed → fall back to the flanking even calle; the central
    # avenue is "Avenida Centenario"). place_stadium prints the resolved quad.
    for _sp in (
        {"id": "estadio",                    # Lito Pérez: Calle 15-17 x Avenida 0-2
         "calles": (["Calle 15 José Joaquín Escalante"], ["Calle 17"]),
         "ave_south": ["Avenida 2"],
         "ave_north": ["Avenida Centenario", "Avenida 0"]},
        {"id": "estadio_playitas",           # Las Playitas: Calle 6-8, between Av
         "calles": (["Calle 6"], ["Calle 8"]),   # Centenario and the shoreline
         "ave_north": ["Avenida 1", "Avenida 1 Dr. Sergio Fallas Badilla"],
         "ave_south": ["Avenida Centenario"],
         "beach": True,                      # the cuadra runs out to the sand
         "edge": ["Calle 8"]},               # right wall on Calle 8's line, extended
    ):
        fields.place_stadium(_sp)

    # ---- PARCELS -----------------------------------------------------------
    # A cuadra split into named PARTS, each with a `use` that drives how it is
    # drawn, and each carrying a `slot` rect a sponsor can paint a logo into.
    # This is the general form of what the estadios do by hand: resolve the
    # block from its bounding streets, then hand out pieces of it.
    #
    #   aceras: True  -> the part is eroded by the sidewalk depth, so whatever
    #                    sits on it (a church) never lands on the acera.
    #   aceras: False -> the part keeps the ring, filling the block edge to edge
    #                    (how Plaza Las Playitas reads as one open field).
    for _pc in (
        {"id": "carmen", "at": (12620, 9755),      # Calle 35-33 x Av Centenario-Av 1
         "calles": (["Calle 35"], ["Calle 33"]),
         "ave_north": ["Avenida Centenario", "Avenida 0"],
         "ave_south": ["Avenida 1 Dr. Sergio Fallas Badilla", "Avenida 1"],
         "cols": [1, 1], "rows": [1, 1],
         "parts": [
             # left column, split in two: the church up top…
             {"id": "carmen_parroquia", "col": 0, "row": 0, "use": "church",
              "name": "Parroquia Nuestra Señora de El Carmen",
              "aceras": True, "anchor": "north"},
             # …and its garden below it
             {"id": "carmen_jardin", "col": 0, "row": 1, "use": "garden",
              "name": "Jardín de la Parroquia", "aceras": True},
             # right column, spanning BOTH rows
             {"id": "carmen_plaza", "col": 1, "row": [0, 1], "use": "stadium",
              "name": "Plaza Deportes El Carmen", "aceras": True},
         ]},
        # THE CIVIC SUPERBLOCK of Puntarenas: Calle 7 -> Bulevar de la Casa de
        # la Cultura, Avenida 1 (north) -> Avenida Centenario (south). No calle
        # crosses it — Calle 5 only exists SOUTH of Centenario — so the catedral,
        # the parks and the Casa de la Cultura share one manzana, and the thing
        # that organises them is a T of calle peatonal:
        #
        #     Av 1  ┌──────────────┬──┬───────────────┐  Bulevar
        #           │ parque río   │▓▓│  biblioteca   │
        #     Calle │──────────────│▓▓├───────────────┤
        #       7   │ ⛪ CATEDRAL  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ← arm, ends at the Bulevar
        #           │──────────────│▓▓├───────────────┤
        #           │ parque virgen│▓▓│ Casa Cultura  │
        #    Av Cent└──────[bus]───┴──┴───────────────┘
        #
        # The N-S bar runs avenida to avenida in FRONT of (east of) the catedral;
        # the E-W arm leaves that bar on the catedral's own axis and finishes at
        # the Bulevar. Both are `boulevard` parts: stamped Surface.BOULEVARD, so
        # they are transitable but slow, and drawn as stone rather than asphalt.
        {"id": "centro", "at": (15121, 9636),
         "calles": (["Calle 7"], ["Bulevar de la Casa de la Cultura", "Calle 3 Francisco de Paula Amador"]),
         "ave_north": ["Avenida 1 Dr. Sergio Fallas Badilla", "Avenida 1"],
         "ave_south": ["Avenida Centenario", "Avenida 0"],
         # the catedral row is the widest so the stone church can be as big as
         # the manzana allows; the bar is wide enough to read as a calle
         "cols": [4.4, 1.8, 3.8], "rows": [2.8, 3.8, 2.8],
         # the manzana was NOT land by this point: a customer's apron cut it in
         # half and detect_blocks had paved the rest as a sliver
         "reclaim": True,
         "clear_buildings": True,   # the parroquia's own OSM footprints stood here
         "parts": [
             # the parks keep the acera ring (`aceras: False`): a green tucks
             # UNDER the sidewalk band the road pass paints, exactly like the
             # block greens, and at 2.8 rows of a 120px manzana the erosion
             # would have left a 16px sliver
             {"id": "centro_parque_norte", "col": 0, "row": 0, "use": "park",
              "name": "Parque del Río", "aceras": False, "river": True},
             {"id": "centro_catedral", "col": 0, "row": 1, "use": "cathedral",
              "name": "Catedral de Puntarenas", "aceras": True, "lm": "catedral"},
             # the virgen stands at this park's NORTH edge, beside the catedral
             {"id": "centro_parque_sur", "col": 0, "row": 2, "use": "park",
              "name": "Parque de la Virgen", "aceras": False,
              "statue": "virgen", "bus": "south"},
             {"id": "centro_bulevar", "col": 1, "row": [0, 2], "use": "boulevard",
              "name": "Bulevar de la Catedral", "aceras": False},
             {"id": "centro_bulevar_este", "col": 2, "row": 1, "use": "boulevard",
              "name": "Bulevar de la Casa de la Cultura", "aceras": False},
             {"id": "centro_biblioteca", "col": 2, "row": 0, "use": "civic",
              "name": "Biblioteca Pública", "aceras": False},
             {"id": "centro_cultura", "col": 2, "row": 2, "use": "civic",
              "name": "Casa de la Cultura", "aceras": False, "lm": "cultura"},
         ]},
    ):
        claimed = fields.place_parcels(_pc)
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

    # Parque Marino: the aquarium's own OSM ways stay at their TRUE footprints
    # (a snapped pastel box reads as a generic house, not the theme park), and
    # occ keeps every other building — OSM or synth — off the cuadra. green=True
    # alone only excludes a block from synth_buildings, which is why generic
    # buildings used to land on the lawn, one of them right on an aquarium tank.
    marine_raw = []
    if marine_site:
        mc = marine_site["cells"]
        keep = []
        for raw in raw_bldgs:
            if (int(raw["cx"] // CUAD), int(raw["cy"] // CUAD)) in mc and raw.get("pts"):
                marine_raw.append(raw)
            else:
                keep.append(raw)
        raw_bldgs = keep
        occ.update(mc)
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
    def _poly_on_road(pts, step=4):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        for py in range(int(min(ys)), int(max(ys)) + 1, step):
            for px in range(int(min(xs)), int(max(xs)) + 1, step):
                if not (0 <= px < CANVAS_W and 0 <= py < CANVAS_H):
                    return True
                if not point_in_poly((px, py), pts):
                    continue
                if grid[(py // GRID_CELL) * GRID_COLS + (px // GRID_CELL)] in \
                        (CLS_ROAD, CLS_PASEO, CLS_BRIDGE):
                    return True
        return False

    named_raw, keep, n_onroad = [], [], 0
    for raw in raw_bldgs:
        if raw.get("name") and raw.get("pts") and not _poly_on_road(raw["pts"]):
            named_raw.append(raw)
        else:
            if raw.get("name"):
                n_onroad += 1
            keep.append(raw)
    raw_bldgs = keep
    if n_onroad:
        log("buildings", f"{n_onroad} named footprints overlapped a street — snapped instead")
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
    if marine_site:
        # Muted aquarium palette so the site reads as one complex, not a row of
        # houses in the random pastel mix.
        MARINE_WALL = ["#8fb8b0", "#a8c6be", "#7fa9a6", "#b7c9bd"]
        MARINE_ROOF = ["#3f5f63", "#4d6f70", "#35545a"]
        for i, raw in enumerate(marine_raw):
            flat = [round(v) for p in raw["pts"] for v in p]
            buildings.append({"pts": flat,
                              "color": MARINE_WALL[i % len(MARINE_WALL)],
                              "roof": MARINE_ROOF[i % len(MARINE_ROOF)], "wnd": 0})
        _place_marine_pools(marine_site, marine_raw)
        log("marino", f"{len(marine_raw)} aquarium buildings at their real OSM "
              f"footprints, {len(marine_site['lm'].get('pools', []))} tanks placed clear")
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
    # An irregular block cannot be quartered: Parque Marino fills 32% of its
    # bbox and the Balneario 46%, so a grid cut would hand out parts that are
    # mostly street or water. Their real parcels are the things already STANDING
    # in them, so derive one parcel per building footprint inside the block.
    # Same output shape, same sponsor slot — only the source differs.
    for _fp in (
        {"id": "marino_lote", "lm": "parquemar", "name": "Parque Marino", "use": "lot"},
        {"id": "balneario_lote", "lm": "balneario", "name": "Balneario", "use": "lot"},
    ):
        fields.place_feature_parcels(_fp, buildings)

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

    return buildings, occ, stadiums, parcels


def decorate(ctx, *, sp, roads, blocks, occ, waters, topY, botY, bridge_road, palm_runs, tree_runs, resolve, buildings):
    raster = ctx.raster
    grid = raster.buf
    CANVAS_W, CENTER_Y = ctx.dims.w, ctx.dims.center_y
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    # --- bridge / estuary / decorations
    if bridge_road:
        bp = bridge_road["pts"]
        xs = bp[0::2]
        ys = bp[1::2]
        bx0, bx1 = min(xs), max(xs)
        bcy = sum(ys) / len(ys)
    else:
        pm, _ = resolve({"osm": "puente colgante mata de limón"})
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

    # mangroves around the estuary
    seed = 57
    def rng():
        nonlocal seed
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280
    mangroves = []
    for a in [i * 0.12 for i in range(int(2 * math.pi / 0.12) + 1)]:
        rx = est["rx"] + 60 + rng() * 78
        ry = est["ry"] + 60 + rng() * 60
        mangroves.append({"x": round(est["cx"] + math.cos(a) * rx),
                          "y": round(est["cy"] + math.sin(a) * ry),
                          "r": round(24 + rng() * 24)})
    for _ in range(10):
        ang = rng() * math.pi * 2
        rr = rng() * est["rx"] * 0.6
        mangroves.append({"x": round(est["cx"] + math.cos(ang) * rr),
                          "y": round(est["cy"] + math.sin(ang) * rr * est["ry"] / max(est["rx"], 1)),
                          "r": round(4 + rng() * 4)})

    # palms: along shores where land is present, plus along the paseo road
    palms = []
    seed = 33
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
    # Paseo de los Turistas: PALMS on the median dashes, planted inside the
    # same street-aligned runs the median stamp uses.
    PALM_PITCH = 22
    PALM_END_MARGIN = 10
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
                    palms.append({"x": round(x), "y": round(y - 4),
                                  "s": 1.05, "sway": round(rng() * 6.28, 2)})
                    n_median_palms += 1
                    nxt = s + PALM_PITCH
    # Trees (almendros/robles) along the continuous tree lines only.
    TREE_PITCH = 26
    TREE_END_MARGIN = 12
    trees = []
    for samples, runs in tree_runs:
        for (k0, k1) in runs:
            s0, s1 = samples[k0][0] + TREE_END_MARGIN, samples[k1][0] - TREE_END_MARGIN
            nxt = s0
            for (s, x, y) in samples[k0:k1 + 1]:
                if s >= nxt and s <= s1:
                    trees.append({"x": round(x), "y": round(y),
                                  "s": round(0.9 + rng() * 0.3, 2)})
                    nxt = s + TREE_PITCH
    # Tree line on the north shoulder of Avenida 2 del Ferrocarril (from
    # x≈6892 to the avenue's end), separating it from the parallel Avenida
    # Alberto Echandi Montero. Decorative trees (no blocking median → the barro
    # avenue stays fully drivable), GAPPED at every cross street.
    FERRO_TREE_X0 = 6892
    # tree line along the whole elevated barro route (Av. 2 del Ferrocarril AND
    # the Cocal-side avenue) from x≈6892 to where it ends at the estero
    ferro = [r for r in roads if r.get("elev")]
    other_pts = [(x, y) for r in roads
                 if not r.get("elev")
                 for x, y in zip(r["pts"][0::2], r["pts"][1::2])]
    def _near_crossing(px, py, rad=1.8 * CUAD):
        rr = rad * rad
        return any((px - ox) ** 2 + (py - oy) ** 2 < rr for ox, oy in other_pts)
    n_ferro_trees = 0
    for r in ferro:
        samples = resample_centerline(r["pts"], 26)
        for i, (s, cx, cy) in enumerate(samples):
            if cx < FERRO_TREE_X0:
                continue
            j = i + 1 if i + 1 < len(samples) else max(0, i - 1)
            hx, hy = samples[j][1] - cx, samples[j][2] - cy
            h = math.hypot(hx, hy) or 1.0
            nx, ny = -hy / h, hx / h
            off = r["w"] / 2 + 0.6 * CUAD
            tx, ty = cx + nx * off, cy + ny * off
            if ty > cy:                      # force the NORTH side (smaller y)
                tx, ty = cx - nx * off, cy - ny * off
            if _near_crossing(cx, cy):       # respect intersections (leave gaps)
                continue
            c, gr = int(tx / GRID_CELL), int(ty / GRID_CELL)
            if not (0 <= c < GRID_COLS and 0 <= gr < GRID_ROWS):
                continue
            # only BESIDE the lane: never on the drivable lane (or a cross
            # street / paseo / bridge / water) — this is the Cocal-side tree
            # line the user saw sitting on top of streets.
            if grid[gr * GRID_COLS + c] in (CLS_ROAD, CLS_PASEO, CLS_BRIDGE, CLS_WATER):
                continue
            trees.append({"x": round(tx), "y": round(ty), "s": round(0.9 + rng() * 0.3, 2)})
            n_ferro_trees += 1
    # Planted median down the middle of the divided Cocal avenue (corridor-only;
    # planar never divides that avenue, so this is inert there).
    def _centerline_pts(name, x0, x1):
        out = []
        for r in roads:
            if (r.get("name") or "") == name:
                out += [(x, y) for (_, x, y) in resample_centerline(r["pts"], 10) if x0 <= x <= x1]
        return sorted(out)
    A = _centerline_pts("Avenida 1", 8139, 11921)
    B = _centerline_pts("Avenida Alberto Echandi Montero", 8139, 11921)
    n_dc = 0
    if A and B:
        for xs in range(8200, 11900, 40):
            a = min(A, key=lambda p: abs(p[0] - xs))
            b = min(B, key=lambda p: abs(p[0] - xs))
            if abs(a[0] - xs) < 90 and abs(b[0] - xs) < 90 and abs(a[1] - b[1]) < 6 * CUAD:
                mx, my = xs, round((a[1] + b[1]) / 2)
                c, gr = int(mx / GRID_CELL), int(my / GRID_CELL)
                if 0 <= c < GRID_COLS and 0 <= gr < GRID_ROWS and \
                        grid[gr * GRID_COLS + c] not in (CLS_ROAD, CLS_PASEO, CLS_BRIDGE, CLS_WATER):
                    trees.append({"x": mx, "y": my, "s": round(0.9 + rng() * 0.3, 2)})
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
            trees.append({"x": round(cc * CUAD + CUAD / 2 + (rng() - 0.5) * 8),
                          "y": round(cr * CUAD + CUAD / 2 + (rng() - 0.5) * 8),
                          "s": round(0.85 + rng() * 0.4, 2)})
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
    log("verde", f"{n_patio} patio/park trees, {n_beach_palms} beach palms")

    return bridge, est, trees, palms, mangroves
