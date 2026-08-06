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

from ..config import BLDG_INSET, CUAD, FRONTAGE_DEPTH, OSM_MAX_CUADS, SMALL_BLOCK_CUADS, SYNTH_LOTS, SYNTH_MAX_TOTAL, SYNTH_SEED
from ..content import BLDG_PALETTE, ROOF_PALETTE
from ..logging import log


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
            continue
        cc0, cr0, tw, th = placed
        _claim(occ, cc0, cr0, tw, th)
        out.append(_emit_rect(cc0, cr0, tw, th, make_rng(raw["id"])))
    log("buildings", f"{len(out)} OSM snapped to the cuadrícula, {dropped} no-fit")
    return out

def synth_buildings(blocks, cell_block, occ, n_real):
    """Fill cuadras with whole-cuadrícula lots. Small town blocks fill
    COMPLETELY (dense puerto — no empty centers); large blocks keep only a
    frontage band so their interiors read as patios/parks. Deterministic:
    sorted block/cell order + seeded rng."""
    rng = make_rng(SYNTH_SEED)
    out = []
    for bi in sorted(range(len(blocks)), key=lambda i: min(blocks[i]["cells"])):
        cells = blocks[bi]["cells"]
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
        # small blocks: fill the whole cuadra; large blocks: frontage band only
        if len(cells) <= SMALL_BLOCK_CUADS:
            band = set(cells)
        else:
            band = {c for c in cells if depth[c] <= FRONTAGE_DEPTH}
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
