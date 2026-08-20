"""Buildings on the cuadrícula.

Every building is a whole-cuadrícula rect placed on the CUAD lattice INSIDE one
block's cell set, so by construction it never straddles an acera or a street —
that is the whole reason the placement is lattice-bound rather than free. A
shared occupancy set (`occ`) keeps OSM footprints and synthesised ones disjoint.

The RNG is a seeded LCG, not `random`: the build must be deterministic, and a
process-wide generator would make placement depend on how many random numbers
some earlier stage happened to draw.
"""
import math
from collections import defaultdict, deque

from ..config import BLDG_INSET, CASONA_RING_CUADS, CUAD, OSM_MAX_CUADS, PATIO_MIN_CUADS, SYNTH_LOTS, SYNTH_MAX_TOTAL, SYNTH_SEED
from ..content import BLDG_PALETTE, ROOF_PALETTE
from ..logging import log, warn


def make_rng(seed):
    """A tiny seeded LCG. Deterministic and INDEPENDENT: each caller seeds its
    own, so placement never depends on how many numbers an earlier stage drew."""
    s = [seed % 233280]
    def rng():
        s[0] = (s[0] * 9301 + 49297) % 233280
        return s[0] / 233280
    return rng

def _grid_placer(blocks, keepouts):
    """(cell_block, occ): cuad cell -> block index, plus cells pre-occupied by
    POI keep-out zones so buildings never crowd kiosks/customers/pier."""
    cell_block = {}
    for bi, b in enumerate(blocks):
        for cell in b["cells"]:
            cell_block[cell] = bi
    occ = set()
    for (kx, ky, kr) in keepouts:
        for cr in range(int((ky - kr) // CUAD), int((ky + kr) // CUAD) + 1):
            for cc in range(int((kx - kr) // CUAD), int((kx + kr) // CUAD) + 1):
                if ((cc + 0.5) * CUAD - kx) ** 2 + ((cr + 0.5) * CUAD - ky) ** 2 <= kr * kr:
                    occ.add((cc, cr))
    return cell_block, occ

def _fits(cell_block, occ, cc0, cr0, wc, hc):
    """A wc x hc rect at (cc0, cr0) sits fully inside ONE block, unoccupied."""
    bi = cell_block.get((cc0, cr0))
    if bi is None:
        return False
    for cr in range(cr0, cr0 + hc):
        for cc in range(cc0, cc0 + wc):
            if (cc, cr) in occ or cell_block.get((cc, cr)) != bi:
                return False
    return True

def _claim(occ, cc0, cr0, wc, hc):
    for cr in range(cr0, cr0 + hc):
        for cc in range(cc0, cc0 + wc):
            occ.add((cc, cr))

def _emit_rect(cc0, cr0, wc, hc, rng):
    x0, y0 = cc0 * CUAD + BLDG_INSET, cr0 * CUAD + BLDG_INSET
    x1, y1 = (cc0 + wc) * CUAD - BLDG_INSET, (cr0 + hc) * CUAD - BLDG_INSET
    return {"pts": [x0, y0, x1, y0, x1, y1, x0, y1],
            "color": BLDG_PALETTE[int(rng() * len(BLDG_PALETTE))],
            "roof": ROOF_PALETTE[int(rng() * len(ROOF_PALETTE))],
            "wnd": 1 if rng() < 0.7 else 0}

def snap_osm_buildings(raws, cell_block, occ):
    """Snap real OSM footprints to whole-cuadrícula rects: size from the AABB
    (1..OSM_MAX_CUADS per axis), anchored at the centroid's cuad cell, spiral
    search up to ±2 cells, then shrink the larger axis and retry."""
    offsets = [(0, 0)]
    for rad in (1, 2):
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if max(abs(dx), abs(dy)) == rad:
                    offsets.append((dx, dy))
    out, dropped = [], 0
    for raw in raws:
        tw = max(1, min(OSM_MAX_CUADS, round(raw["w"] / CUAD)))
        th = max(1, min(OSM_MAX_CUADS, round(raw["h"] / CUAD)))
        acc, acr = int(raw["cx"] // CUAD), int(raw["cy"] // CUAD)
        placed = None
        while placed is None:
            for (dx, dy) in offsets:
                cc0, cr0 = acc - tw // 2 + dx, acr - th // 2 + dy
                if _fits(cell_block, occ, cc0, cr0, tw, th):
                    placed = (cc0, cr0, tw, th)
                    break
            if placed or (tw == 1 and th == 1):
                break
            if tw >= th:
                tw -= 1
            else:
                th -= 1
        if placed is None:
            dropped += 1
            # INSTRUMENTATION (Stage F): a NAMED footprint must not vanish
            # behind an aggregate counter. `manzana_style` already treats a lost
            # anchor as a build failure for exactly this reason.
            nm = raw.get("name") or raw.get("osm_name")
            if nm:
                warn("buildings", f"NO-FIT named footprint way/{raw['id']} {nm!r} "
                     f"at ({round(raw['cx'])},{round(raw['cy'])}) "
                     f"{round(raw['w'])}x{round(raw['h'])}px — DROPPED")
            continue
        cc0, cr0, tw, th = placed
        _claim(occ, cc0, cr0, tw, th)
        out.append(_emit_rect(cc0, cr0, tw, th, make_rng(raw["id"])))
    log("buildings", f"{len(out)} OSM snapped to the cuadrícula, {dropped} no-fit")
    return out

def block_depths(cells):
    """Distancia en cuadrículas de cada celda al borde de la manzana.

    Era una transformada de distancia local dentro de `synth_buildings`. Salió
    porque ahora responde DOS preguntas con una sola pasada: cuál es el anillo
    construido (`depth <= CASONA_RING_CUADS`) y cuál es el patio que queda
    adentro. Calcularla dos veces sería dos verdades que se pueden despegar.
    """
    depth, q = {}, deque()
    for (cc, cr) in cells:
        if any((cc + dx, cr + dy) not in cells
               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            depth[(cc, cr)] = 1
            q.append((cc, cr))
    while q:
        cc, cr = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb = (cc + dx, cr + dy)
            if nb in cells and nb not in depth:
                depth[nb] = depth[(cc, cr)] + 1
                q.append(nb)
    return depth


def manzana_patios(blocks, occ, min_cuads=PATIO_MIN_CUADS):
    """EL PATIO DE CADA MANZANA — las cuadrículas que el anillo de casonas deja.

    Devuelve `[(block_index, cells)]`. Un patio es lo que queda pasado
    `CASONA_RING_CUADS` desde la calle, MENOS lo que ya está ocupado: una
    parcela de OSM, una huella con nombre, el apron de un kiosco. `occ` ya sabe
    todo eso, así que el patio no se pelea con nadie — simplemente es el resto.

    Una manzana sin resto no tiene patio y no se le inventa uno: en el arenal
    hay cuadras de tres cuadrículas de ancho donde el anillo es la manzana
    entera, y meterles un patio sería meterles un hueco.
    """
    out = []
    for bi, b in enumerate(blocks):
        if b.get("wood") or b.get("green"):
            continue
        cells = b["cells"]
        depth = block_depths(cells)
        inner = {c for c in cells
                 if depth.get(c, 0) > CASONA_RING_CUADS and c not in occ}
        if len(inner) >= min_cuads:
            out.append((bi, inner))
    return out


def _pick_variant(weights, seed_cell):
    """Qué reparto le toca a esta manzana — determinista por su posición.

    Un `random` de proceso haría que el mundo dependiera de cuántos números
    sacó una etapa anterior, que es la razón por la que este módulo trae su
    propio LCG. La semilla es la celda mínima de la cuadra: estable mientras la
    cuadra lo sea, y distinta entre vecinas.
    """
    names = [k for k in weights if not k.startswith("_")]
    total = sum(weights[k] for k in names) or 1.0
    h = ((seed_cell[0] * 73856093) ^ (seed_cell[1] * 19349663)) % 100000 / 100000.0
    acc = 0.0
    for k in names:
        acc += weights[k] / total
        if h <= acc:
            return k
    return names[-1]


def _runs_in_row(row_cells):
    """Maximal contiguous runs of columns in one row — `[(c0, c1), …]`."""
    out, run = [], None
    for c in sorted(row_cells):
        if run is None or c != run[1] + 1:
            if run is not None:
                out.append(run)
            run = [c, c]
        else:
            run[1] = c
    if run is not None:
        out.append(run)
    return [tuple(r) for r in out]


def casona_ring(cells, depth, occ, rng, variant, run_max, walls, roofs):
    """UNA HILERA DE CASONAS sobre las calles de una manzana — fachada continua.

    Se emite POR CORRIDA, no por lote: un tramo contiguo de cuadrículas sobre
    una misma fila sale como UNA huella, con su propio color de cal. Eso es lo
    que separa una hilera de casas pegadas de veinticinco cajitas con costura —
    `BLDG_INSET` deja 4 px entre vecinos a propósito «so adjacent roofs don't
    fuse», y fusionarse es exactamente lo que una casona hace.

    `variant` reparte la manzana sin que todas se vean iguales:
      * `full`   — las cuatro caras;
      * `half`   — sólo las corridas largas, extremos cortos abiertos;
      * `corner` — sólo lo que toca una esquina.
    """
    rows = {}
    for (cc, cr) in cells:
        if depth.get((cc, cr), 99) <= CASONA_RING_CUADS and (cc, cr) not in occ:
            rows.setdefault(cr, set()).add(cc)
    if not rows:
        return []
    r0, r1 = min(rows), max(rows)
    c0 = min(c for row in rows.values() for c in row)
    c1 = max(c for row in rows.values() for c in row)
    out = []
    for cr, row in sorted(rows.items()):
        for (a, b) in _runs_in_row(row):
            long_run = (b - a + 1) > CASONA_RING_CUADS
            if variant == "half" and not long_run:
                continue                       # los extremos cortos quedan abiertos
            if variant == "corner":
                near = (cr - r0 <= CASONA_RING_CUADS or r1 - cr <= CASONA_RING_CUADS)
                if not near and not (a - c0 <= CASONA_RING_CUADS or c1 - b <= CASONA_RING_CUADS):
                    continue
            # Partir la corrida en casonas: una fachada de manzana entera no es
            # un edificio, es una cuadra de edificios pegados.
            x = a
            while x <= b:
                n = min(run_max, b - x + 1)
                if n <= 0:
                    break
                if rng() < 0.06 and n > 1:      # el portón, el solar de en medio
                    x += 1
                    continue
                claimed = [(cx, cr) for cx in range(x, x + n)]
                if any(c in occ for c in claimed):
                    x += n
                    continue
                for c in claimed:
                    occ.add(c)
                i = int(rng() * len(walls))
                j = int(rng() * len(roofs))
                x0 = x * CUAD + BLDG_INSET
                y0 = cr * CUAD + BLDG_INSET
                x1 = (x + n) * CUAD - BLDG_INSET
                y1 = (cr + 1) * CUAD - BLDG_INSET
                out.append({"pts": [x0, y0, x1, y0, x1, y1, x0, y1],
                            "color": walls[i], "roof": roofs[j],
                            "wnd": 1, "casona": 1})
                x += n
    return out


def synth_buildings(blocks, cell_block, occ, n_real, casona=None,
                    is_casona_block=None):
    """UN ANILLO DE CASONAS SOBRE LAS CALLES, y un patio adentro.

    Toda manzana se construye igual: una banda de `CASONA_RING_CUADS` de fondo
    contra la calle, y el interior queda libre. Antes las cuadras chicas se
    llenaban ENTERAS —«dense puerto — no empty centers»— y con el umbral en 188
    cuadrículas eso era, en la práctica, todas: medido sobre 95 cuadras del
    centro daba 25 huellas sueltas por manzana y 54,3 % del suelo cubierto.

    La banda sale de la misma transformada de distancia que ya se calculaba; lo
    único que cambia es que nadie pasa de ella. Determinista: orden de bloque y
    celda ordenado, más un rng con semilla."""
    rng = make_rng(SYNTH_SEED)
    out = []
    n_casona = {}
    for bi in sorted(range(len(blocks)), key=lambda i: min(blocks[i]["cells"])):
        # EL MONTE IS NOT BUILDABLE. These are the rural blobs — 95 % of all
        # cuadra ground — and filling their frontage band is what made the demand
        # 193 271 footprints against a cap of 80 000, i.e. what turned this cap
        # into a hard west-to-east cliff that starved the real villages out east.
        # A forest is not a manzana, so it does not get a frontage.
        if blocks[bi].get("wood"):
            continue
        cells = blocks[bi]["cells"]
        depth = block_depths(cells)
        # ¿ESTA MANZANA LLEVA CASONAS? Dos condiciones, y las dos importan:
        # está en el puerto viejo (del faro a El Cocal — Esparza y Barranca no
        # son eso) y OSM la dejó VACÍA. Donde el mapeador puso edificios, ésos
        # mandan y se rellena alrededor con lotes sueltos: una fachada continua
        # encima de huellas reales sería el mundo peleándose consigo mismo.
        if is_casona_block and is_casona_block(blocks[bi]):
            variant = _pick_variant(casona["variants"], min(cells))
            made = casona_ring(cells, depth, occ, rng, variant,
                               casona.get("runMaxCuads", 4),
                               casona["palette"]["walls"],
                               casona["palette"]["roofs"])
            out.extend(made)
            n_casona[variant] = n_casona.get(variant, 0) + 1
            if n_real + len(out) >= SYNTH_MAX_TOTAL:
                return out
            continue
        # …y si no, el anillo de lotes sueltos de siempre. `depth` es la
        # distancia a la calle en cuadrículas, así que esto es «lo que da al
        # frente» — el interior queda para el patio.
        band = {c for c in cells if depth[c] <= CASONA_RING_CUADS}
        for cell0 in sorted(band, key=lambda c: (c[1], c[0])):
            if cell0 in occ:
                continue
            if rng() < 0.07:                     # organic gap
                continue
            u, acc_p = rng(), 0.0
            wc, hc = 1, 1
            for (lw, lh), p in SYNTH_LOTS:
                acc_p += p
                if u <= acc_p:
                    wc, hc = lw, lh
                    break
            cc0, cr0 = cell0
            while True:
                if _fits(cell_block, occ, cc0, cr0, wc, hc) and \
                        all((cc, cr) in band
                            for cr in range(cr0, cr0 + hc)
                            for cc in range(cc0, cc0 + wc)):
                    _claim(occ, cc0, cr0, wc, hc)
                    out.append(_emit_rect(cc0, cr0, wc, hc, rng))
                    break
                if wc >= hc and wc > 1:
                    wc -= 1
                elif hc > 1:
                    hc -= 1
                else:
                    break
            if n_real + len(out) >= SYNTH_MAX_TOTAL:
                return out
    if n_casona:
        log("buildings", "casonas por manzana: "
            + ", ".join(f"{k} {v}" for k, v in sorted(n_casona.items())))
    return out


# ---------------------------------------------------------------------------
# LA MANZANA ES UN RECIPIENTE, y lo que va adentro se ajusta a ella.
#
# This is the answer to a question that had been answered five different wrong
# ways: why is anything standing on the acera?
#
# THE ARITHMETIC. A 7 m calle is real-world 18 px at this scale, and the game
# needs a corridor of 65 — two cars have to pass on it (a car is 19 px across)
# and it has to read as a street at play zoom. The other 47 px come out of the
# manzanas on either side, 24 px each. Measured over 59 centro blocks, the build
# keeps 81 % of the ground the street grid implies, and 72 % on the small ones.
# So a footprint drawn at its true size, within 24 px of its centreline, HAS
# nowhere to be. Nothing about the fitting was ever wrong.
#
# WHAT A MAP APP DOES, and why it does not help directly. Mapbox, OSM Carto and
# Google keep the geometry TRUE and draw roads as STROKES over the basemap: at
# z16 the casing is far wider than 7 m and it covers the buildings beside it,
# and nobody minds, because the road is paint and the data underneath is
# untouched. That option is closed here — the player drives on this, so the
# roadway has to be real ground, and real ground has to come from somewhere.
#
# WHAT CARTOGRAPHY DOES WHEN SYMBOLS GENUINELY COLLIDE is a named toolkit:
# displacement, aggregation, typification, exaggeration, elimination. The part
# this build kept getting wrong is that displacement is applied to a GROUP,
# preserving its structure — never as a greedy per-feature shove, which is
# exactly why pushing each footprint along its street normal failed on corners
# and on dense rows and left 217 of them to be flattened onto the lattice.
#
# So: take the manzana's real footprints as ONE GROUP and fit that group into
# the manzana's own land, inside the acera ring. One isotropic scale about the
# group's centre, per block. Everything keeps its shape, everything keeps its
# position RELATIVE to its neighbours, the block reads correctly because it all
# shrank together, and nothing has to be pushed, snapped or deleted.
def fit_manzana_contents(raster, blocks, cell_block, named, streets,
                         block_cells, erode, acera_cells, street_classes,
                         min_scale=0.55):
    """Fit each manzana's named footprints inside its own acera ring.

    Mutates `raw["pts"]`. Returns (fitted, skipped, scales) — `skipped` are the
    blocks whose group could not be made to fit above `min_scale`; those are
    left for the per-building push, because a 0.4 scale is not a building any
    more, it is a model of one.
    """
    groups = defaultdict(list)
    for raw in named:
        pts = raw.get("pts")
        if not pts:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        bi = cell_block.get((int(cx // CUAD), int(cy // CUAD)))
        if bi is not None:
            groups[bi].append(raw)

    fitted, skipped, scales = 0, 0, []
    for bi in sorted(groups):
        group = groups[bi]
        inner = erode(block_cells(blocks[bi]["cells"]), acera_cells,
                      street_classes, raster.at)
        if not inner:
            skipped += 1
            continue
        cell = raster.cell
        bx = [(c + 0.5) * cell for c, _ in inner]
        by = [(r + 0.5) * cell for _, r in inner]
        ang = streets.angle_at(sum(bx) / len(bx), sum(by) / len(by))
        ca, sa = math.cos(ang), math.sin(ang)

        def frame(xs, ys):
            us = [x * ca + y * sa for x, y in zip(xs, ys)]
            vs = [-x * sa + y * ca for x, y in zip(xs, ys)]
            return min(us), max(us), min(vs), max(vs)

        bu0, bu1, bv0, bv1 = frame(bx, by)
        gx = [p[0] for raw in group for p in raw["pts"]]
        gy = [p[1] for raw in group for p in raw["pts"]]
        gu0, gu1, gv0, gv1 = frame(gx, gy)
        du, dv = max(1e-6, gu1 - gu0), max(1e-6, gv1 - gv0)
        scale = min(1.0, (bu1 - bu0) / du, (bv1 - bv0) / dv)
        if scale < min_scale:
            skipped += 1
            continue
        # the group's centre in the block frame -> the block's own centre
        gcu, gcv = (gu0 + gu1) / 2, (gv0 + gv1) / 2
        bcu, bcv = (bu0 + bu1) / 2, (bv0 + bv1) / 2
        for raw in group:
            moved = []
            for (x, y) in raw["pts"]:
                u, v = x * ca + y * sa, -x * sa + y * ca
                u = bcu + (u - gcu) * scale
                v = bcv + (v - gcv) * scale
                moved.append((u * ca - v * sa, u * sa + v * ca))
            raw["pts"] = moved
        fitted += len(group)
        if scale < 0.999:
            scales.append(scale)
    return fitted, skipped, scales
