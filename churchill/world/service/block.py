"""Cuadras: finding a block on the raster and turning it back into geometry.

A *cuadra* (manzana, city block) is not stored anywhere — it is whatever the
streets leave behind. Every structure the world places on the street grid asks
the same three questions, so they live here:

    cuadra_cells()      which cells ARE this block, from its bounding streets
    block_raster_cells() the LAND inside a block's cuad cells (no acera ring)
    outline_poly[s]()   those cells back as drawable polygon ring(s)

The polygon starts as an exact raster trace, then its one-cell stair steps are
straightened into the diagonal they describe.  The raster cells remain the
source of truth for collision and ownership; the emitted vector is the clean
map line, like the vector streets and aceras.  Never fit an angle from the
traced vertices (see util.geometry.principal_axis).
"""
from collections import defaultdict, deque

from ..config import (
    BLOCK_MIN_CUADS, BLOCK_MIN_M, CLS_ACERA, CLS_LAND, CUAD, CUAD_CELLS,
    GRID_CELL, SLIVER_MAX_CUADS,
)
from ..logging import log
from ..util.geometry import dp_simplify


def _straighten_raster_ring(flat, cell_px, tolerance_px=None):
    """Replace a raster boundary's one-cell stairs with direct line segments.

    The cell trace is still exact internally.  This only regularises the
    drawable vector: Douglas-Peucker at one raster cell joins the endpoints of
    a diagonal run while preserving corners and larger notches.  Tiny rings can
    collapse to fewer than three vertices at that tolerance, so those retain
    their exact square trace.
    """
    points = list(zip(flat[0::2], flat[1::2]))
    if len(points) <= 4:
        return flat
    simplified = dp_simplify(
        points + [points[0]],
        cell_px if tolerance_px is None else tolerance_px,
    )[:-1]
    if len(simplified) < 3:
        return flat
    return [coord for point in simplified for coord in point]


def cuadra_cells(raster, px0, py0, px1, py1, classes, clip=None):
    """The one cuadra under a street rect, as raster cells: the LARGEST
    connected component of `classes` inside the rect.

    Clipping to the rect is what keeps it local — the acera fringe is continuous
    along every street, so an unbounded flood would swallow the whole city — and
    the rect runs centreline-to-centreline, so the far-side aceras stay out.
    `clip(px, py) -> bool` adds a further half-plane test (see street.half_plane)
    for a block bounded by a street that stops short.
    """
    cell, cols, rows, buf = raster.cell, raster.cols, raster.rows, raster.buf
    gc0 = max(0, int(px0 // cell)); gc1 = min(cols - 1, int(px1 // cell))
    gr0 = max(0, int(py0 // cell)); gr1 = min(rows - 1, int(py1 // cell))
    inside = lambda c, r: (gc0 <= c <= gc1 and gr0 <= r <= gr1
                           and (clip is None or clip(c * cell, r * cell)))
    member = lambda c, r: buf[r * cols + c] in classes
    seen, best = set(), set()
    for r0 in range(gr0, gr1 + 1):
        for c0 in range(gc0, gc1 + 1):
            if (c0, r0) in seen or not member(c0, r0):
                continue
            comp, st = set(), [(c0, r0)]
            while st:
                c, r = st.pop()
                if (c, r) in comp or not inside(c, r) or not member(c, r):
                    continue
                comp.add((c, r))
                st += ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1))
            seen |= comp
            if len(comp) > len(best):
                best = comp
    return best


def block_raster_cells(raster, cuad_cells, cuad_cells_per_side, land_cls):
    """The LAND cells of a block, flooded from the centre of each of its cuad
    cells. Excludes the acera ring by construction: it only walks `land_cls`."""
    cell, cols, rows, buf = raster.cell, raster.cols, raster.rows, raster.buf
    out, seeds = set(), []
    for (cc, cr) in cuad_cells:
        pc = cc * cuad_cells_per_side + cuad_cells_per_side // 2
        pr = cr * cuad_cells_per_side + cuad_cells_per_side // 2
        if 0 <= pc < cols and 0 <= pr < rows and buf[pr * cols + pc] == land_cls:
            seeds.append((pc, pr))
    for s in seeds:
        if s in out:
            continue
        st = [s]
        while st:
            c, r = st.pop()
            if (c, r) in out or not (0 <= c < cols and 0 <= r < rows):
                continue
            if buf[r * cols + c] != land_cls:
                continue
            out.add((c, r))
            st += ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1))
    return out


def outline_polys(cells, cell_px, tolerance_px=None):
    """Every boundary ring of a raster cell set as flat ``[x, y, …]`` polys.

    A cell set can contain disconnected pieces and holes.  Returning only its
    largest loop silently changes ownership: the raster may say a detached
    lawn belongs to a park while the manifest polygon says it belongs to
    nothing, and a filled outer loop paints straight across any lots punched
    through it.  Rings keep their directed raster orientation (outer loops and
    holes are opposite) and are sorted largest-first for deterministic output.

    At a diagonal pinch two directed boundaries share one vertex.  Following
    the right-most available turn keeps the filled cell on the right and closes
    the two real loops separately instead of making a figure-eight.
    """
    if not cells:
        return []
    boundary = set()
    for c, r in sorted(cells):
        if (c, r - 1) not in cells:
            boundary.add(((c, r), (c + 1, r)))
        if (c + 1, r) not in cells:
            boundary.add(((c + 1, r), (c + 1, r + 1)))
        if (c, r + 1) not in cells:
            boundary.add(((c + 1, r + 1), (c, r + 1)))
        if (c - 1, r) not in cells:
            boundary.add(((c, r + 1), (c, r)))

    outgoing = defaultdict(list)
    for start, end in sorted(boundary):
        outgoing[start].append(end)

    directions = ((1, 0), (0, 1), (-1, 0), (0, -1))
    direction_index = {d: i for i, d in enumerate(directions)}
    remaining, traced = set(boundary), []
    while remaining:
        start_edge = min(remaining)
        start, vertex = start_edge
        previous = start
        loop = [start]
        remaining.remove(start_edge)
        while vertex != start:
            loop.append(vertex)
            incoming = (
                vertex[0] - previous[0],
                vertex[1] - previous[1],
            )
            incoming_i = direction_index[incoming]
            # Screen coordinates run y-down: +1 is the right turn.
            preferred = (
                (incoming_i + 1) % 4,
                incoming_i,
                (incoming_i - 1) % 4,
                (incoming_i + 2) % 4,
            )
            candidates = [
                end for end in outgoing.get(vertex, ())
                if (vertex, end) in remaining
            ]
            if not candidates:
                raise RuntimeError(
                    f"open raster boundary at {vertex} while tracing {len(cells)} cells")
            next_vertex = min(
                candidates,
                key=lambda end: (
                    preferred.index(direction_index[(
                        end[0] - vertex[0], end[1] - vertex[1])]),
                    end,
                ),
            )
            remaining.remove((vertex, next_vertex))
            previous, vertex = vertex, next_vertex

        simple, n = [], len(loop)
        for i in range(n):
            p0, p1, p2 = loop[i - 1], loop[i], loop[(i + 1) % n]
            if ((p1[0] - p0[0]) * (p2[1] - p1[1])
                    == (p1[1] - p0[1]) * (p2[0] - p1[0])):
                continue                       # collinear — drop the midpoint
            simple.append(p1)
        if len(simple) < 3:
            continue
        area2 = sum(
            simple[i][0] * simple[(i + 1) % len(simple)][1]
            - simple[(i + 1) % len(simple)][0] * simple[i][1]
            for i in range(len(simple))
        )
        flat = _straighten_raster_ring([
            coord * cell_px
            for point in simple
            for coord in point
        ], cell_px, tolerance_px)
        traced.append((abs(area2), flat))

    traced.sort(key=lambda item: (-item[0], item[1]))
    return [flat for _, flat in traced]


def outline_poly(cells, cell_px, tolerance_px=None):
    """Largest boundary ring of ``cells`` (backward-compatible helper)."""
    polys = outline_polys(cells, cell_px, tolerance_px)
    return polys[0] if polys else []


def cells_to_rects(cells, cell_px):
    """Merge a set of (cc,cr) cells into axis-aligned [x,y,w,h] px rects
    (row-run merge + vertical span merge). Footprint-accurate."""
    rows = defaultdict(list)
    for (cc, cr) in cells:
        rows[cr].append(cc)
    runs_by_row = {}
    for cr, ccs in rows.items():
        ccs.sort(); runs = []
        for cc in ccs:
            if runs and runs[-1][1] == cc:
                runs[-1][1] = cc + 1
            else:
                runs.append([cc, cc + 1])
        runs_by_row[cr] = runs
    rects = []; open_runs = {}
    def _emit(k, s):
        rects.append([k[0] * cell_px, s[0] * cell_px,
                      (k[1] - k[0]) * cell_px, (s[1] - s[0]) * cell_px])
    for cr in sorted(runs_by_row):
        cur = {tuple(r) for r in runs_by_row[cr]}; nxt = {}
        for k in cur:
            if k in open_runs and open_runs[k][1] == cr:
                open_runs[k][1] = cr + 1; nxt[k] = open_runs[k]
            else:
                if k in open_runs:
                    _emit(k, open_runs[k])
                nxt[k] = [cr, cr + 1]
        for k, s in open_runs.items():
            if k not in nxt:
                _emit(k, s)
        open_runs = nxt
    for k, s in open_runs.items():
        _emit(k, s)
    return rects



def detect_blocks(raster, old_port_x1=None, named_cells=None):
    """Classify every CLS_LAND component (after roads/aceras/pads are stamped)
    at cuadrícula resolution:
      - block: fits a BLOCK_MIN_CUADS square of buildable CUAD cells somewhere
        -> kept as solid cuadra; its organic CUAD cell set (L-shapes, triangle
        and trapezoid arms included) is returned for building placement;
      - sliver: nowhere near the minimum AND small -> paved to CLS_ACERA and
        emitted as plaza rects (intersection corners, alley wedges);
      - green: large but nowhere BLOCK_MIN_CUADS (thin coastal strips) ->
        stays CLS_LAND with no buildings, never paved (no concrete oceans).
    Returns (blocks, plazas): blocks = [{"cells": set[(cc, cr)]}], plazas =
    flat [x, y, w, h] px rects for the renderer.

    THE BAR IS A REAL SIZE (`BLOCK_MIN_M`, 32 m), not a count of cuadrículas.
    It was 6 cuadrículas = 48 m, which is bigger than a Puntarenas manzana: a
    normal one inscribes 4.6, so 61 % of the land components over 4 cuadrículas
    failed the test and were filed as coastal strip (no buildings at all) or
    paved over as wedge. Measured over the same 2 108 land components, at 48 m
    against at 32 m:

        cuadras  416 -> 599      green  566 -> 383      slivers  1126 -> 1126

    Every one of the 183 that moved came out of GREEN — a manzana that had been
    filed as a thin coastal strip and given no buildings at all. Not one sliver
    changed class, which is the reassuring half: nothing that had been paved as
    an intersection wedge turned out to be a block, so the bar came down through
    empty ground and not into the junctions.

    THE 183 DID NOT ADD HOUSES, THEY MOVED THEM, and that is `SYNTH_MAX_TOTAL`,
    not this function. The synth stage logged `+79306 synthesized (total 80000)`
    in BOTH builds — identical line, because the cap is saturated and has been.

    Measuring what the map really wants (cap set non-binding, 2026-08-11) then
    turned up something worse, and it is worth knowing here because it is a
    judgement about WHAT COUNTS AS A BLOCK: the demand is 193 271 footprints, and
    it is not a density target. The eastern "cuadras" this returns include land
    blobs of 339 MILLION px² — hinterland, not manzanas — and `synth_buildings`
    fills their frontage band, so meeting the demand would carpet 4.8 km of rural
    coast. The cap is the only thing preventing that, and it prevents it in the
    worst way: a west-to-east cliff at x ~= 68 000 that also leaves real mapped
    villages out there without a single synthesized neighbour.

    None of which this change caused — those blobs clear a 6x6 bar comfortably —
    but it is the same root as the note above. A size threshold cannot tell a
    manzana from the countryside.

    The slivers still outnumber the cuadras, and that is NOT the same finding —
    a wedge is left at every junction of the ~2 200 mapped ways, so there are
    honestly more corners in this town than manzanas.

    A SIZE THRESHOLD IS STILL THE WRONG QUESTION, and lowering it does not make
    it the right one: this looks for leftover raster blobs, so it cannot tell a
    manzana from an intersection wedge except by how big it is. The
    size-independent definition is topological — a manzana is a FACE of the
    planar graph of street centrelines, bounded by four streets at any size.
    `docs/RESCALE.md` records what that would cost (hand-rolled noding plus
    half-edge cycles, or a shapely dependency the builder deliberately avoids)."""
    cols, rows, grid = raster.cols, raster.rows, raster.buf
    from array import array
    N = cols * rows
    label = array("i", [0]) * N
    comp_n = [0]            # raster cell count per component id (1-based)
    for start in range(N):
        if grid[start] != CLS_LAND or label[start]:
            continue
        cid = len(comp_n)
        comp_n.append(0)
        q = deque([start])
        label[start] = cid
        n = 0
        while q:
            i = q.popleft()
            n += 1
            r, c = divmod(i, cols)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < rows and 0 <= nc < cols:
                    ni = nr * cols + nc
                    if grid[ni] == CLS_LAND and not label[ni]:
                        label[ni] = cid
                        q.append(ni)
        comp_n[cid] = n
    n_comps = len(comp_n) - 1
    # buildable CUAD cells (fully CLS_LAND — such a 5x5 is 4-connected, so it
    # belongs to exactly one component) + max-inscribed-square DP per cell
    ccols, crows = cols // CUAD_CELLS, rows // CUAD_CELLS
    bcomp = array("i", [0]) * (ccols * crows)      # component id per cuad cell
    for cr in range(crows):
        for cc in range(ccols):
            ok = True
            for r in range(cr * CUAD_CELLS, (cr + 1) * CUAD_CELLS):
                row = r * cols
                for c in range(cc * CUAD_CELLS, (cc + 1) * CUAD_CELLS):
                    if grid[row + c] != CLS_LAND:
                        ok = False
                        break
                if not ok:
                    break
            if ok:
                bcomp[cr * ccols + cc] = label[cr * CUAD_CELLS * cols + cc * CUAD_CELLS]
    dp = [0] * (ccols * crows)
    comp_ins = [0] * (len(comp_n))                 # max inscribed per component
    comp_cells = defaultdict(set)
    for cr in range(crows):
        for cc in range(ccols):
            i = cr * ccols + cc
            cid = bcomp[i]
            if not cid:
                continue
            dp[i] = 1 if (cr == 0 or cc == 0) else \
                min(dp[i - 1], dp[i - ccols], dp[i - ccols - 1]) + 1
            comp_ins[cid] = max(comp_ins[cid], dp[i])
            comp_cells[cid].add((cc, cr))
    # classify
    blocks, paved_ids = [], set()
    n_green = 0
    n_named_kept = 0
    for cid in range(1, len(comp_n)):
        area_cuads = comp_n[cid] / (CUAD_CELLS * CUAD_CELLS)
        cells = comp_cells[cid]
        # Faro through El Cocal: the fine street grid leaves real urban
        # manzanas below the normal inscribed-square bar. Keep those thin but
        # substantial components BUILDABLE when the whole component is inside
        # the authored old-port band. The 2x2 + area floors still reject true
        # shore strips, and the Cocal edge keeps the rescue out of the rural
        # coast east of La Angostura.
        in_band = (old_port_x1 is not None and cells and
                   max(cc for cc, _ in cells) * CUAD < old_port_x1)
        if comp_ins[cid] >= BLOCK_MIN_CUADS:
            blocks.append({"cells": cells, "green": False})
        elif in_band and comp_ins[cid] >= 2 and area_cuads >= 4:
            blocks.append({"cells": cells, "green": False})
        elif named_cells and (cells & named_cells):
            # UNA MANZANA CON UN EDIFICIO CON NOMBRE NO ES UNA ESQUINA DE ACERA.
            #
            # El resto de esta rama pavimenta el sobrante pequeño porque casi
            # siempre ES un sobrante: la cuña que queda en un cruce, el pico
            # entre dos calles que se juntan. Pero el mapeador dibujó ahí una
            # imprenta, una torre, una pulpería — y lo que pasa entonces es lo
            # peor de los dos mundos: el suelo se convierte en acera, la cadena
            # de colocación descubre que el edificio no tiene dónde pararse, y
            # acaba de `ghost` DIBUJADO ENCIMA DE LA ACERA que se acaba de crear.
            #
            # Medido sondeando el mundo emitido alrededor de la Antigua Torre
            # Millicom y la Imprenta La Violeta: **en 80 px a la redonda no hay
            # ni una celda de LAND** — sólo acera, calzada y barro. No es que la
            # cadena no supiera moverlas: es que no quedaba suelo al que
            # moverlas, y este pavimentado es quien se lo llevó.
            #
            # Entra como bloque VERDE, que en esta función significa «sin relleno
            # sintético, pero las huellas reales de OSM pueden asentarse encima»
            # — que es exactamente lo que hace falta. Un sobrante de cruce no
            # tiene edificios mapeados, así que la regla no puede rescatar una
            # cuña de verdad.
            blocks.append({"cells": comp_cells[cid] or cells, "green": True})
            n_named_kept += 1
        elif area_cuads <= SLIVER_MAX_CUADS:
            paved_ids.add(cid)
        else:
            # green strip: no synth fill, but real OSM buildings may still
            # snap onto its buildable cells (rural villages on thin coast land)
            if comp_cells[cid]:
                blocks.append({"cells": comp_cells[cid], "green": True})
            n_green += 1
    # pave the slivers (concrete corners — deliberately NOT painted green: a
    # sliver is a partial-cuadra shape, and partial green reads as a bad paint
    # job; cuadras are all-green (parks) or all-ground)
    for i in range(N):
        if label[i] in paved_ids:
            grid[i] = CLS_ACERA
    n_cuadras = sum(1 for b in blocks if not b["green"])
    # The bar is in the line on purpose: this census is only readable against
    # the threshold that produced it, and that threshold used to be invisible.
    log("blocks", f"{n_comps} land components -> {n_cuadras} cuadras, "
          f"{len(paved_ids)} paved slivers, {n_green} green, "
          f"{n_named_kept} slivers SPARED for holding a named footprint "
          f"(bar {BLOCK_MIN_M:.0f} m = {BLOCK_MIN_CUADS}x{BLOCK_MIN_CUADS} cuadrículas)")
    return blocks, []
