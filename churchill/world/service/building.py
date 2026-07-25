"""Buildings on the cuadrícula.

Every building is a whole-cuadrícula rect placed on the CUAD lattice INSIDE one
block's cell set, so by construction it never straddles an acera or a street —
that is the whole reason the placement is lattice-bound rather than free. A
shared occupancy set (`occ`) keeps OSM footprints and synthesised ones disjoint.

The RNG is a seeded LCG, not `random`: the build must be deterministic, and a
process-wide generator would make placement depend on how many random numbers
some earlier stage happened to draw.
"""
from collections import deque

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
