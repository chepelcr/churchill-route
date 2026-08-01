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
    ACERA_CELLS, CLS_ACERA, CLS_BEACH, CLS_BRIDGE, CLS_LAND, CLS_PASEO,
    CLS_ROAD, CLS_WATER, CUAD, CUAD_CELLS, GRID_CELL, POI_NUDGE_PX,
)
from ..content import CUSTOMER_DEFS, LANDMARK_DEFS, STAGES
from ..enums import GreenType, LandmarkType
from ..logging import log, warn
from ..service.block import block_raster_cells, cells_to_rects, detect_blocks, outline_poly
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
from ..service.street import planar_muelle_axis
from ..service.surface import acera_fringe, stamp_pad
from ..util.geometry import dist, to_m


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

    landmarks, failures = [], []
    for spec in LANDMARK_DEFS:
        pm, how = resolve(spec)
        if pm is None:
            failures.append(spec["id"])
            continue
        x, y, _, _ = sp.project(pm)
        x += spec.get("dx", 0)
        y += spec.get("dy", 0)
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

    def spread_ok(x, y, placed):
        if any((x - kx) ** 2 + (y - ky) ** 2 < MIN_FROM_KIOSK ** 2 for kx, ky in kiosk_pts):
            return False
        return all((x - c["x"]) ** 2 + (y - c["y"]) ** 2 >= MIN_BETWEEN ** 2 for c in placed)

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
            for rad in range(24, 1920, 16):       # expanding ring, nearest wins
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
                    if spread_ok(tx, ty, customers):
                        cands.append((abs(tx - px) + abs(ty - py), tx, ty))
                if cands:
                    found = min(cands)
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
        if grid[r * GRID_COLS + pc] in (CLS_ROAD, CLS_PASEO):
            raster.stamp_polyline([pier_x, r * GRID_CELL,
                                         pier_x, pier_y0], 2 * CUAD, CLS_ROAD)
            log("pier", f"connector road to y={r * GRID_CELL}")
            break
    mlm["x"], mlm["y"] = pier_x, round(pier_y0 - 16)
    log("pier", f"muelle at x={pier_x}, y {round(pier_y0)}..{pier_y1}")

    return landmarks, customers, failures, mlm, pier, BUILDING_LM, NO_PAD_LM, resolve


def place_kiosks_and_blocks(ctx, *, landmarks, customers, districts, junction_islands, BUILDING_LM, NO_PAD_LM):
    raster = ctx.raster
    grid = raster.buf
    GRID_COLS, GRID_ROWS = ctx.dims.cols, ctx.dims.rows
    # --- aceras (sidewalks) + plaza pads: these define where you can drive
    # off-street; everything left as CLS_LAND becomes solid cuadra interior
    acera_fringe(raster)

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
    # Paseo stands stay pinned where their dy put them (between the Paseo and
    # the sand) — treated like beach kiosks so the frontage pass never re-seats
    # them across the street; their connector may target the Paseo itself.
    PINNED_KIOSKS = {"kios_paseo1", "kios_paseo2"}
    for lm in landmarks:
        if lm["type"] != "kiosk" or lm["id"] == "kios_faro":
            continue                                    # kios_faro goes on the muelle below
        kx, ky = lm["x"], lm["y"]
        surf = _cell_cls(int(kx // GRID_CELL), int(ky // GRID_CELL))
        pinned = lm["id"] in PINNED_KIOSKS
        if surf == CLS_BEACH or pinned:
            classes = (CLS_ROAD, CLS_PASEO, CLS_BRIDGE) if pinned else (CLS_ROAD, CLS_BRIDGE)
            tgt = _nearest_cell(kx, ky, classes, 260)
            if tgt:
                raster.stamp_polyline([kx, ky, tgt[0], tgt[1]], 1.4 * CUAD, CLS_ROAD)
                kiosk_paths.append({"pts": [round(kx), round(ky), round(tgt[0]), round(tgt[1])],
                                    "surface": "paved"})
                log("kiosk", f"{'pinned' if pinned else 'sand'} path {lm['id']} "
                      f"(surf {surf}) -> street ({round(tgt[0])},{round(tgt[1])})")
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
        Rc = 34                                            # bound the tip (~136px)
        if seed:
            q = deque([seed]); esp.add(seed)
            while q:
                cc, cr = q.popleft()
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nb = (cc + dc, cr + dr)
                    if nb in esp or (nb[0] - fcc0) ** 2 + (nb[1] - fcr0) ** 2 > Rc * Rc:
                        continue
                    if _cell_cls(*nb) == CLS_BEACH:        # follow the SAND only
                        esp.add(nb); q.append(nb)
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
                if (cc, cr) not in esp and _cell_cls(cc, cr) in (CLS_ROAD, CLS_PASEO):
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
                if _cell_cls(cc, cr) not in (CLS_ROAD, CLS_PASEO):
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
        if lm["type"] not in BUILDING_LM:
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
        if lm["type"] not in BUILDING_LM:             # all cuadra buildings, not just civic
            continue
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
