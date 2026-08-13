"""EL MONTE — the cuadras that are not manzanas at all, but countryside.

`detect_blocks` hands back every leftover `CLS_LAND` component as a buildable
block, and it cannot tell a manzana from the hinterland except by size. Measured
on the shipped world: **55 cuadras over 2 M px² hold 95 % of all cuadra ground**
(1 514 of 1 599 M px²). Those are not city blocks. The largest is 270 M px².

That had two visible consequences. `synth_buildings` filled their frontage bands,
so the only thing keeping 4.8 km of rural coast from being carpeted with houses
was the building budget running out — as a hard cliff at x ~= 68 000 that also
left the real villages out there without neighbours. And what the player actually
saw on that ground was nothing: bare tan land.

So they become WOODS.

A WOOD IS AN AREA AND A MIX, NEVER A LIST OF TREES. At any sensible forest
density that ground wants 300 000 to 950 000 trees; the whole world is 16.7 MB
and every emitted tree is a record in a streamed tile. So the build says only
*this ground is forest, of this kind, this thick* — 55 small records — and the
renderer scatters it deterministically at draw time from the position hash it
already uses for the roadside planting. The cost is a few hundred bytes and the
density is free.

WHICH forest is decided by DISTANCE FROM THE SEA, because that is the only
terrain signal this world actually has. `manifest.hills` is a painted backdrop
band, not elevation, so it cannot answer "is this highland" — using it would have
been inventing a fact. Distance to real water is measured off the finished
raster:

    near the coast   -> `seco`    tropical dry forest, what Puntarenas really is
    inland           -> `monte`   the ordinary green hinterland
    far from any sea -> `altura`  the cordillera behind the port: pino, ciprés,
                                  and the cerezos

The mix names are keys in `src/assets/flora.json`; the renderer looks up the
species and weights there, so adding a species to a forest is a data edit.
"""
import math

from ..config import (
    CLS_BEACH, CLS_WATER, CUAD, PLANAR_PX_PER_M, WOOD_ALTURA_M,
    WOOD_COAST_M, WOOD_MIN_M2,
)
from ..logging import log

#: How coarsely the sea search steps, in raster cells. The answer only has to be
#: right to within a mix boundary, and a fine walk over a 6 km radius for each of
#: 55 blocks is millions of cells for a three-way decision.
SEA_STEP = 8


def _sea_distance_px(raster, cx, cy, max_px):
    """Distance from (cx, cy) to the nearest water or sand, or None past
    `max_px`. Rings outward so it stops at the first hit rather than scanning
    the whole disc."""
    cols, rows, buf = raster.cols, raster.rows, raster.buf
    cell = raster.cell
    gc0, gr0 = int(cx / cell), int(cy / cell)
    max_r = int(max_px / cell)
    for r in range(SEA_STEP, max_r + SEA_STEP, SEA_STEP):
        # the ring at radius r, sampled every SEA_STEP around it
        steps = max(8, int(2 * math.pi * r / SEA_STEP))
        for i in range(steps):
            a = (i / steps) * math.pi * 2
            gc = gc0 + int(math.cos(a) * r)
            gr = gr0 + int(math.sin(a) * r)
            if not (0 <= gc < cols and 0 <= gr < rows):
                continue
            if buf[gr * cols + gc] in (CLS_WATER, CLS_BEACH):
                return r * cell
    return None


def classify(raster, blocks):
    """Mark every block big enough to be countryside as a wood, in place.

    Sets `block["wood"] = mix`. Runs BEFORE `decorate`, because the answer has
    two consumers: the patio scatter must not sprinkle its handful of trees over
    ground a whole forest is about to cover, and `build_cuadra_catalog` copies the
    mix onto the record the manifest emits.

    Measured in the block's own cuadrícula cells rather than its traced polygon —
    the cells ARE the block, and the threshold only has to separate 32 ha of
    countryside from a city block of at most a few thousand m².
    """
    min_px2 = WOOD_MIN_M2 * PLANAR_PX_PER_M * PLANAR_PX_PER_M
    coast_px = WOOD_COAST_M * PLANAR_PX_PER_M
    altura_px = WOOD_ALTURA_M * PLANAR_PX_PER_M
    census = {"seco": 0, "monte": 0, "altura": 0}
    area_px2 = 0.0
    for block in blocks:
        cells = block.get("cells") or ()
        area = len(cells) * CUAD * CUAD
        if area < min_px2:
            continue
        cx = (sum(c for c, _ in cells) / len(cells) + 0.5) * CUAD
        cy = (sum(r for _, r in cells) / len(cells) + 0.5) * CUAD
        sea = _sea_distance_px(raster, cx, cy, altura_px)
        if sea is None:
            mix = "altura"
        elif sea <= coast_px:
            mix = "seco"
        else:
            mix = "monte"
        block["wood"] = mix
        census[mix] += 1
        area_px2 += area
    total = sum(census.values())
    log("woods", f"{total} woods over {area_px2 / 1e6:.0f} M px² of countryside "
                 f"({census['seco']} seco, {census['monte']} monte, "
                 f"{census['altura']} altura) — drawn, never emitted as trees")
    return total
