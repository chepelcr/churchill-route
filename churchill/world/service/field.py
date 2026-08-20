"""Fields: the estadios and the parcels a cuadra is cut into.

Everything here answers one question — how does a STRUCTURE land on a block of
the real street grid — and the answer is always the same three moves: resolve
the block from its bounding streets, trace it off the raster, hand out pieces.

Read the recipes in CLAUDE.md before changing any of it. The two that cost the
most to learn:

* A MANZANA'S ANGLE COMES FROM ITS BOUNDING STREETS. `place_parcels` cuts
  columns along the calles and rows along the avenidas, projecting each cell on
  the NORMAL of the other family — an affine frame, because the cuadrícula is a
  parallelogram (by El Carmen: avenidas -5.4°, calles 82.3°). A principal-axis
  fit of the block's own cells is degenerate on a square-ish block and snaps to
  the contrary diagonal; it survives only as the fallback when a street will
  not resolve.
* AN ACERA EXISTS WHERE THERE IS A STREET. The ring is eroded directionally, so
  Las Playitas still runs into the sand on its north and the Carmen plaza stays
  flush against the parroquia on its west. A field's ring is shallower than a
  block's (FIELD_ACERA_CELLS): it only has to stop the white lines before the
  asphalt, and every px of it is grass the player does not get.

The drivable stamp always uses a part's UN-eroded cells, so the ring is asphalt
you drive in over, never a wall around the field.
"""
import math
from collections import defaultdict

from ..config import (
    ACERA_CELLS, CLS_ACERA, CLS_BEACH, CLS_BOULEVARD, CLS_LAND, CLS_MALECON,
    CLS_ROAD, CUAD,
    FIELD_ACERA_CELLS, GRID_CELL, STREET_CLASSES, STREET_SPAN_M,
    street_span_px,
)
from ..content import PARCEL_STYLES, SITE_DECOR
from ..enums import GreenType, ParcelUse
from ..logging import log, warn
from .editor_patch import building_source_id
from ..util.geometry import point_in_poly, principal_axis
from ..util.raster import erode_cells
from .block import block_raster_cells, cuadra_cells, outline_poly
from .street import half_plane

HARD_STREET_CLASSES = tuple(cls for cls in STREET_CLASSES if cls != CLS_ACERA)
#: How much of a parcel may sit on the ACERA before it is re-fitted inside
#: strict land. Not zero: the rect is fitted in the manzana's frame against a
#: 4 px raster, so a cell or two of overlap is quantisation, not a park on the
#: pavement. Past this it is the pavement, and the walkers are rail-bound to it.
PARCEL_ACERA_MAX = 0.10


def _cell_frame(cells):
    """Centre + principal axis of a cell set. The CENTRE is what parcels
    want; the axis is only their FALLBACK for when a bounding street's
    direction will not resolve (see _street_dir). It is not trustworthy on
    its own: the fit is degenerate on a square-ish block (sxx≈syy snaps it
    to ±45°, the contrary diagonal), and it is orthogonal by construction,
    which the cuadrícula is not."""
    mx, my, ang = principal_axis(list(cells))
    return mx, my, math.cos(ang), math.sin(ang)

def _largest_part(cells):
    """The biggest 4-connected component of a cell set.

    An erosion does not just shrink a plot, it can BREAK it: a school yard
    pinched by two aceras comes back as a handful of crumbs. `outline_poly`
    already keeps only the largest loop, so the choice is being made either
    way — making it here means the caller can MEASURE what survived and back
    the ring off when the answer is a 4 px sliver.
    """
    seen, best = set(), set()
    for seed in sorted(cells):
        if seed in seen:
            continue
        part, stack = set(), [seed]
        seen.add(seed)
        while stack:
            c, r = stack.pop()
            part.add((c, r))
            for n in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
                if n in cells and n not in seen:
                    seen.add(n); stack.append(n)
        if len(part) > len(best):
            best = part
    return best


def fit_block_rect(cells, ang, cell_px, trim=0.02):
    """The RECTANGLE `cells` occupy in the block's frame.

    A parcel is a piece of a manzana, so its shape is a rectangle turned to the
    manzana's angle — that is what the hand-authored cuadras are, and what a
    raster trace of an OSM outline is not.

    The extent is a PERCENTILE, not a min/max. The mapper's outline regularly
    grows a thin arm — a driveway, a strip along the kerb, the bit of a park
    that runs between two houses — and one such cell would stretch the whole
    rectangle out over the street. Trimming `trim` off each end of each axis
    keeps the rect on the body of the site and cannot collapse it, which an
    iterative shrink very much can (it ate an 883-cell campus down to 12x10 px).

    Returns (u0, u1, v0, v1, cu, cv) — frame extents in px about the centroid,
    which is also in px — or None.
    """
    if not cells:
        return None
    ca, sa = math.cos(ang), math.sin(ang)
    mx = sum(c for c, _ in cells) / len(cells)
    my = sum(r for _, r in cells) / len(cells)
    us = sorted((c - mx) * ca + (r - my) * sa for (c, r) in cells)
    vs = sorted(-(c - mx) * sa + (r - my) * ca for (c, r) in cells)
    k = int(len(us) * trim)
    lo, hi = k, len(us) - 1 - k
    if hi <= lo:
        lo, hi = 0, len(us) - 1
    # +0.5 cell each side: a cell's frame coord is its CENTRE, so the extent of
    # the cells is half a cell short of the ground they actually cover.
    return ((us[lo] - 0.5) * cell_px, (us[hi] + 0.5) * cell_px,
            (vs[lo] - 0.5) * cell_px, (vs[hi] + 0.5) * cell_px,
            mx * cell_px, my * cell_px)


def _largest_mask_rect(mask):
    """Largest all-true rectangle in a row-major boolean mask.

    Returns (col0, row0, col1, row1), with the far edges exclusive. The
    histogram stack makes this O(rows * cols); deterministic tie-breaking
    prefers the less ribbon-like answer, then the north-west one.
    """
    if not mask or not mask[0]:
        return None
    cols = len(mask[0])
    heights = [0] * cols
    best_key = None
    best = None
    for row, values in enumerate(mask):
        for col, value in enumerate(values):
            heights[col] = heights[col] + 1 if value else 0
        stack = []
        for col in range(cols + 1):
            height = heights[col] if col < cols else 0
            start = col
            while stack and stack[-1][1] > height:
                left, popped = stack.pop()
                start = left
                if not popped:
                    continue
                width = col - left
                top = row - popped + 1
                key = (width * popped, min(width, popped), -top, -left)
                if best_key is None or key > best_key:
                    best_key = key
                    best = (left, top, col, row + 1)
            if height and (not stack or stack[-1][1] < height):
                stack.append((start, height))
    return best


def fit_inscribed_rect(cells, ang, cell_px):
    """Largest `ang`-aligned rectangle contained in raster `cells`.

    `fit_block_rect` is an oriented BOUNDING rectangle. That is useful for
    regularising a mapper's outline, but unsafe as the final parcel: a skewed
    outline can make the fitted corners bridge a street. Here the already
    sidewalk-eroded cells become a mask in the street frame and the largest
    all-safe rectangle is selected. A final exact raster check feeds any
    rotation-alias misses back into the mask before accepting the rectangle.
    """
    if not cells:
        return None
    ca, sa = math.cos(ang), math.sin(ang)
    centres = [((c + 0.5) * cell_px, (r + 0.5) * cell_px) for c, r in cells]
    us = [x * ca + y * sa for x, y in centres]
    vs = [-x * sa + y * ca for x, y in centres]
    iu0, iu1 = math.floor(min(us) / cell_px), math.ceil(max(us) / cell_px)
    iv0, iv1 = math.floor(min(vs) / cell_px), math.ceil(max(vs) / cell_px)
    if iu1 <= iu0 or iv1 <= iv0:
        return None

    mask = []
    for iv in range(iv0, iv1):
        row = []
        v = (iv + 0.5) * cell_px
        for iu in range(iu0, iu1):
            u = (iu + 0.5) * cell_px
            x, y = u * ca - v * sa, u * sa + v * ca
            row.append((math.floor(x / cell_px), math.floor(y / cell_px)) in cells)
        mask.append(row)

    # A frame-cell centre sample can miss a source raster cell at a rotated
    # edge. Validate the actual world-cell centres covered by the rounded
    # polygon; each offender invalidates its frame bin and the maximum is
    # recomputed. In practice this converges in one or two passes.
    for _ in range(12):
        hit = _largest_mask_rect(mask)
        if hit is None:
            return None
        c0, r0, c1, r1 = hit
        rect = ((iu0 + c0) * cell_px, (iu0 + c1) * cell_px,
                (iv0 + r0) * cell_px, (iv0 + r1) * cell_px, 0.0, 0.0)
        poly = rect_poly(rect, ang)
        poly_pairs = list(zip(poly[0::2], poly[1::2]))
        xs, ys = poly[0::2], poly[1::2]
        bad = []
        for r in range(math.floor(min(ys) / cell_px),
                       math.ceil(max(ys) / cell_px) + 1):
            for c in range(math.floor(min(xs) / cell_px),
                           math.ceil(max(xs) / cell_px) + 1):
                p = ((c + 0.5) * cell_px, (r + 0.5) * cell_px)
                if point_in_poly(p, poly_pairs) and (c, r) not in cells:
                    bad.append(p)
        if not bad:
            return rect
        changed = False
        for x, y in bad:
            iu = math.floor((x * ca + y * sa) / cell_px) - iu0
            iv = math.floor((-x * sa + y * ca) / cell_px) - iv0
            for dv in (-1, 0, 1):
                for du in (-1, 0, 1):
                    rr, cc = iv + dv, iu + du
                    if (0 <= rr < len(mask) and 0 <= cc < len(mask[0])
                            and mask[rr][cc]):
                        mask[rr][cc] = False
                        changed = True
        if not changed:
            return None
    return None


def _frame_extent(flat_poly, cx, cy, ang):
    """(hw, hh) — half-extents of a flat polygon about (cx, cy), along `ang`."""
    ca, sa = math.cos(ang), math.sin(ang)
    hw = hh = 0.0
    for i in range(0, len(flat_poly), 2):
        dx, dy = flat_poly[i] - cx, flat_poly[i + 1] - cy
        hw = max(hw, abs(dx * ca + dy * sa))
        hh = max(hh, abs(-dx * sa + dy * ca))
    return round(hw, 1), round(hh, 1)


def rect_poly(rect, ang):
    """The four corners of a frame rect as a flat world-px polygon."""
    u0, u1, v0, v1, cu, cv = rect
    ca, sa = math.cos(ang), math.sin(ang)
    out = []
    for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
        out += [round(cu + u * ca - v * sa), round(cv + u * sa + v * ca)]
    return out


def rect_cells(cells, rect, ang, cell_px):
    """The subset of `cells` that falls inside a frame rect."""
    u0, u1, v0, v1, cu, cv = rect
    ca, sa = math.cos(ang), math.sin(ang)
    keep = set()
    for (c, r) in cells:
        dx, dy = c * cell_px - cu, r * cell_px - cv
        u = dx * ca + dy * sa
        v = -dx * sa + dy * ca
        if u0 <= u <= u1 and v0 <= v <= v1:
            keep.add((c, r))
    return keep


def cells_in_poly(cells, flat_poly, cell_px):
    """Subset whose raster-cell CENTRES fall inside `flat_poly`."""
    poly = list(zip(flat_poly[0::2], flat_poly[1::2]))
    return {c for c in cells
            if point_in_poly(((c[0] + 0.5) * cell_px,
                              (c[1] + 0.5) * cell_px), poly)}


def grow_cells(cells, allowed, steps):
    """Dilate `cells` by `steps` cardinal cells, never leaving `allowed`."""
    out = set(cells)
    edge = set(cells)
    for _ in range(steps):
        nxt = set()
        for c, r in edge:
            for n in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
                if n in allowed and n not in out:
                    nxt.add(n)
        if not nxt:
            break
        out |= nxt
        edge = nxt
    return out


def poly_surface_count(flat_poly, raster, classes):
    """Raster-cell centres inside `flat_poly` whose surface is in `classes`."""
    return len(raster_cells_in_poly(flat_poly, raster, classes))


def raster_cells_in_poly(flat_poly, raster, classes, excluded=()):
    """Raster cells in `classes` whose centres fall inside `flat_poly`.

    The mapper's site outline is deliberately regularised to a rectangle, so
    this samples the finished surface rather than intersecting the rectangle
    back with that irregular outline. That distinction matters for a park
    spanning two manzanas: the largest safe rectangle must be able to fill one
    whole manzana, while the intervening street remains a hard gap.
    """
    poly = list(zip(flat_poly[0::2], flat_poly[1::2]))
    xs, ys = flat_poly[0::2], flat_poly[1::2]
    cell = raster.cell
    excluded = set(excluded)
    found = set()
    for r in range(max(0, math.floor(min(ys) / cell)),
                   min(raster.rows, math.ceil(max(ys) / cell) + 1)):
        for c in range(max(0, math.floor(min(xs) / cell)),
                       min(raster.cols, math.ceil(max(xs) / cell) + 1)):
            p = ((c + 0.5) * cell, (r + 0.5) * cell)
            if ((c, r) not in excluded and point_in_poly(p, poly)
                    and raster.at(c, r) in classes):
                found.add((c, r))
    return found


def _bands(vals, weights):
    """Cut [min..max] into len(weights) bands sized by the weights."""
    lo, hi = min(vals), max(vals)
    total = sum(weights) or 1
    edges, acc = [lo], 0.0
    for w in weights:
        acc += w
        edges.append(lo + (hi - lo) * acc / total)
    edges[-1] = hi + 1e-6
    return edges


class FieldService:
    """Places estadios and parcels on the world under construction.

    Takes the pieces it mutates rather than reaching for them: the raster it
    stamps drivable, the street index it resolves blocks from, and the world's
    collections (landmarks, blocks, greens, plazas, stadiums, parcels, occ,
    buildings). That is what makes it callable from a stage — or from a test
    with a 200x200 raster.
    """

    def __init__(self, *, raster, streets, landmarks, blocks, greens, plazas,
                 stadiums, parcels, occ, project_ll=None):
        self.raster = raster
        #: geo -> world px, so a hand-authored block can be anchored the way
        #: every other place in this world is (see place_parcels).
        self.project_ll = project_ll or (lambda lat, lon: (0, 0))
        self.streets = streets
        self.landmarks = landmarks
        self.blocks = blocks
        self.greens = greens
        self.plazas = plazas
        self.stadiums = stadiums
        self.parcels = parcels
        self.occ = occ
        # RASTER cells this service has already handed to a field or a parcel.
        # `occ` cannot answer that question — it also holds the POI keep-outs,
        # so a park next to a customer would read as taken — and it is CUAD
        # coarse, which at 20 px merges a site with its neighbour across the
        # street. Used by `place_osm_sites`: hand-authored ground wins, and two
        # OSM sites never share the same ground.
        self.claimed_cells = set()

    def place_stadium(self, spec):
        lm = next((l for l in self.landmarks if l["id"] == spec["id"]), None)
        if lm is None:
            log("estadio", f"WARN landmark {spec['id']} missing"); return
        ref = (lm["x"], lm["y"])
        # DIAGNOSTIC: named streets near the anchor, to tune the grid refs
        log("estadio", f"{spec['id']} anchor {ref} nearby streets: {self.streets.near(ref)}")

        # Resolve the stadium's street RECT, then trace the actual cuadra under
        # it straight from the grid (these blocks classify as green plazas, not
        # buildable blocks, so we don't rely on block detection). TWO polygons
        # come out of the trace:
        #   outline = the cuadra incl. its acera ring (all of it drivable, so it
        #             touches the streets and the car drives straight in)
        #   footprint = the PITCH — outline eroded by the acera depth, or the
        #             whole outline when the spec says the block has no aceras
        # Both follow the manzana's true grid angles, exactly like a park green
        # (_green_poly) — never an axis rect slapped over the streets.
        cxa = self.streets.vals(spec["calles"][0], "x", ref)
        cxb = self.streets.vals(spec["calles"][1], "x", ref)
        ay = self.streets.vals(spec["ave_south"], "y", ref)
        ayn = self.streets.vals(spec["ave_north"], "y", ref) if spec.get("ave_north") else None
        if cxa is not None and cxb is not None and ay is not None:
            xa, xb = min(cxa, cxb), max(cxa, cxb)
            if ayn is not None:
                ylo, yhi = min(ay, ayn), max(ay, ayn)
            else:                                # extend NORTH from Avenida 1
                yhi = ay; ylo = ay - abs(cxb - cxa) * 1.2
        else:                                    # ll-anchor fallback rect
            log("estadio", f"WARN {spec['id']} street resolve failed; anchor fallback")
            xa, xb = ref[0] - 5 * CUAD, ref[0] + 5 * CUAD
            ylo, yhi = ref[1] - 6 * CUAD, ref[1] + 6 * CUAD
        # `beach`: let the cuadra run out to the shoreline (Las Playitas ends at
        # the sand, not at a street). `aceras: False`: no sidewalk ring at all —
        # the pitch IS the whole cuadra. Left unset, the ring is DIRECTIONAL:
        # it forms only along the block's street edges (see _erode_cells), which
        # is what keeps the pitch's white lines off the asphalt while Las
        # Playitas still runs into the sand on its north side.
        classes = (CLS_LAND, CLS_ACERA) + ((CLS_BEACH,) if spec.get("beach") else ())
        # `edge`: bound the block on a street that STOPS SHORT. Calle 8 dead-ends
        # in the sand, and its round end cap was what the block wrapped around —
        # so the plaza's right-hand wall ended in a notch instead of running out
        # to the shoreline. Clipping on the street's straight LINE, extended,
        # gives a wall that reads as the street continuing.
        clip = None
        if spec.get("edge"):
            line = self.streets.edge(spec["edge"], ref)
            if line is None:
                log("estadio", f"WARN {spec['id']} edge street {spec['edge']} unresolved")
            else:
                clip = half_plane(line, ((xa + xb) / 2, (ylo + yhi) / 2), spec.get("edge_gap", 18))
        outer_cells = cuadra_cells(self.raster, xa, ylo, xb, yhi, classes, clip)
        # A WHOLE-CUADRA ESTADIO GETS THE BLOCK'S SIDEWALK, NOT A FIELD'S.
        # `FIELD_ACERA_CELLS` (8 px) is the shallow ring a PARCEL takes — it
        # only has to stop the white lines before the asphalt, and every px of
        # it is grass the player does not get. But this cuadra is stamped
        # drivable over its own manzana, so the ring drawn here is the ONLY
        # acera the block has, and at 8 px it read as a seam rather than as the
        # 12 px sidewalk every other manzana in the port has. Lito Pérez had
        # `aceras: True` and no sidewalk anybody could see.
        inner_cells = (outer_cells if spec.get("aceras") is False
                       else erode_cells(outer_cells, ACERA_CELLS, STREET_CLASSES, self.raster.at)) if outer_cells else set()
        # A whole-cuadra field can request a slightly stronger display-only
        # simplification when a long raster edge still contains shoulders after
        # the default one-cell pass. Ownership and drivability remain the exact
        # cell sets above.
        tolerance = GRID_CELL * spec.get("straighten_cells", 1)
        outline = outline_poly(outer_cells, GRID_CELL, tolerance) if outer_cells else None
        footprint = outline_poly(inner_cells, GRID_CELL, tolerance) if inner_cells else None
        if not outline or not footprint:
            log("estadio", f"WARN {spec['id']} no cuadra in rect "
                  f"({round(xa)},{round(ylo)})-({round(xb)},{round(yhi)})"); return
        g = {"pts": footprint, "type": GreenType.STADIUM}
        # no buildings on the block: occ (OSM) + green-flag it (synth). Use the
        # cuad cells the traced cuadra actually covers, not the raw street rect.
        cuad_cells = {(c * GRID_CELL // CUAD, r * GRID_CELL // CUAD) for (c, r) in outer_cells}
        self.occ.update(cuad_cells)
        self.claimed_cells |= outer_cells
        for b in self.blocks:
            if not b.get("green") and any(c in cuad_cells for c in b["cells"]):
                b["green"] = True
        # DRIVABLE: stamp the traced cuadra (pitch + acera ring) CLS_ROAD — and
        # ONLY that. The ring touches the bounding streets so the car can drive
        # straight in with no acera wall, while everything outside the block
        # keeps its own class: at Las Playitas the sea north of the pitch stays
        # CLS_WATER (a wall) instead of becoming drivable asphalt.
        for (c, r) in outer_cells:
            self.raster.set(c, r, CLS_ROAD)
        fx = footprint[0::2]; fy = footprint[1::2]
        bx0, by0, bx1, by1 = min(fx), min(fy), max(fx), max(fy)
        # drop any pre-existing green/plaza whose CENTRE falls on this block,
        # then add the pitch (a bbox-overlap test would also eat a neighbour)
        _in = lambda x, y: bx0 <= x <= bx1 and by0 <= y <= by1
        self.plazas[:] = [pz for pz in self.plazas if not _in(pz[0] + pz[2] / 2, pz[1] + pz[3] / 2)]
        self.greens[:] = [gg for gg in self.greens
                     if not _in(sum(gg["pts"][0::2]) / (len(gg["pts"]) / 2),
                                sum(gg["pts"][1::2]) / (len(gg["pts"]) / 2))]
        self.greens.append(g)
        cxpx = int(sum(fx) / len(fx)); cypx = int(sum(fy) / len(fy))
        lm["x"], lm["y"] = cxpx, cypx
        lm["footprint"] = footprint      # the pitch (grass + white markings)
        lm["outline"] = outline          # the whole drivable cuadra
        # LA GRADERÍA Y LAS TORRES VIENEN CON EL BLOQUE. Vivían en el registro
        # de arte llaveadas por hito (`scenes.stadium.stands.byLandmark`), o sea
        # aparte del estadio al que pertenecen; ahora un estadio es UN registro.
        # Y esto cierra una mentira vieja: CLAUDE.md, el ROADMAP y water.json
        # describían graderías dibujadas «cuando `lm.stands`» — el build no
        # emitía `stands`, nadie lo leía, y `drawStadium` eran once líneas.
        # Sigue siendo COLOCACIÓN: qué ES una gradería (fondo, escalones, rake)
        # se queda en `world-props.json`, como la receta de una luminaria se
        # queda en `lights.json`.
        for key in ("stands", "towers"):
            if spec.get(key):
                lm[key] = spec[key]
        # The pitch's own FRAME, not just its bbox. The match sim places the two
        # goals off it, and it is the same thing the renderer's `fieldFrame` was
        # re-deriving from the polygon every time — badly, since a raster-traced
        # outline's principal axis lands on the contrary diagonal.
        sang = self.streets.direction(spec["ave_north"], ref, "x") or \
            self.streets.direction(spec["ave_south"], ref, "x")
        sa = math.atan2(sang[1], sang[0]) if sang else 0.0
        shw, shh = _frame_extent(footprint, cxpx, cypx, sa)
        self.stadiums.append({"x0": bx0, "y0": by0, "x1": bx1, "y1": by1,
                         "cx": cxpx, "cy": cypx, "footprint": footprint,
                         "outline": outline, "ang": round(sa, 4),
                         "hw": shw, "hh": shh, "sport": "soccer",
                         "aceras": spec.get("aceras", True),
                         # QUIÉN ESTÁ EN ESTA CANCHA. `maintainStadiumPeds`
                         # tenía "fan" escrito cuatro veces, así que toda cancha
                         # del mundo recibía la misma multitud y no había forma
                         # de quitársela a una. Ausente = el `fan` de siempre;
                         # lista vacía = sin gente.
                         **({"crowd": spec["crowd"]} if spec.get("crowd") is not None else {})})
        # …and as a sponsorable space. A stadium is a WHOLE cuadra, not a part
        # of one, so `whole` tells the renderer its ground is already painted
        # (by paintStadiumCuadras) and only the slot art belongs to the parcel.
        # The slot is centred — the middle of the pitch is where a club crest
        # goes.
        sw = max(40, (bx1 - bx0) // 3); sh = max(28, (by1 - by0) // 3)
        self.parcels.append({"id": f"{spec['id']}_field", "name": lm.get("name") or spec["id"],
                        # UNA PLAZA DE BARRIO NO ES UN ESTADIO. `ParcelUse.PLAZA`
                        # existía con CERO usuarios y `materials.json` le daba el
                        # mismo hex que a `stadium`, así que Plaza Las Playitas
                        # se dibujaba idéntica al Estadio Lito Pérez.
                        "use": spec.get("use", ParcelUse.STADIUM),
                        "whole": True, "poly": footprint,
                        "cx": cxpx, "cy": cypx,
                        "x0": bx0, "y0": by0, "x1": bx1, "y1": by1,
                        "slot": [int(cxpx - sw // 2), int(cypx - sh // 2), int(sw), int(sh)]})
        log("parcel", f"{spec['id']}_field ({spec.get('use', ParcelUse.STADIUM)}, whole cuadra) "
              f"slot[{int(cxpx - sw // 2)}, {int(cypx - sh // 2)}, {int(sw)}, {int(sh)}]")
        # …Y SUS SUB-ÁREAS, si el bloque las trae. Un estadio emitía UNA parcela
        # de cuadra entera, así que a una plaza de barrio no se le podía agregar
        # una cancha multiuso o un kiosco sin tocar su contorno — que es lo que
        # no se quería tocar. El mismo repartidor de bandas que usa una cuadra
        # hecha a mano, sobre el marco del quad y no sobre su caja.
        if spec.get("parts"):
            av = self.streets.direction(spec["ave_north"], ref, "x") or \
                self.streets.direction(spec["ave_south"], ref, "x")
            cl = self.streets.direction(spec["calles"][0], ref, "y") or \
                self.streets.direction(spec["calles"][1], ref, "y")
            if av and cl:
                mx = sum(c[0] for c in outer_cells) / len(outer_cells)
                my = sum(c[1] for c in outer_cells) / len(outer_cells)
                shallow = erode_cells(outer_cells, FIELD_ACERA_CELLS,
                                      STREET_CLASSES, self.raster.at)
                self._band_parts(spec, outer_cells, inner_cells, shallow, sa,
                                 (cl[1], -cl[0]), (-av[1], av[0]), mx, my)
            else:
                log("estadio", f"WARN {spec['id']} parts skipped — street "
                    f"direction unresolved (avenida {av}, calle {cl})")
        ox = outline[0::2]; oy = outline[1::2]
        log("estadio", f"{spec['id']} rect ({round(xa)},{round(ylo)})-({round(xb)},{round(yhi)}) "
              f"-> cuadra ({min(ox)},{min(oy)})-({max(ox)},{max(oy)})px {len(outline)//2}v, "
              f"pitch ({bx0},{by0})-({bx1},{by1})px {len(footprint)//2}v, "
              f"{len(outer_cells)} cells drivable")

    def _emit_parcel(self, spec_id, part, cells, keep_cells, ang=0.0, poly=None):
        # `poly` given = the caller already knows the shape. A site parcel is a
        # RECTANGLE in the manzana's frame (four corners), which is what a piece
        # of a cuadra actually is; a raster trace of the mapper's outline is not,
        # and 257 of 377 came out as blobs of 8+ vertices. The hand-authored
        # cuadras still trace because they are cut from the block itself, but
        # outline_poly straightens their one-cell stairs into direct diagonals.
        if poly is None:
            # Most raster outlines use a one-cell tolerance. A deliberately
            # quadrilateral field can ask for two cells: that removes the last
            # half-side kinks left by the raster trace without changing the
            # cells that own or drive the parcel.
            tolerance = GRID_CELL * part.get("straighten_cells", 1)
            poly = outline_poly(keep_cells, GRID_CELL, tolerance) if keep_cells else None
        if not poly:
            log("parcel", f"WARN {part['id']} nothing left after erosion"); return None
        # A residual parcel can have detached components and holes around lots.
        # `poly` remains the largest ring for old clients; `polys` is the exact
        # even-odd ownership geometry used by current renderers.
        geometry = part.get("polys") or [poly]
        coords = [coord for ring in geometry for coord in ring]
        px = coords[0::2]; py = coords[1::2]
        x0, y0, x1, y1 = min(px), min(py), max(px), max(py)
        ay = y0 + (y1 - y0) // 4 if part.get("anchor") == "north" else (y0 + y1) // 2
        # SPONSOR SLOT: a rect inside the parcel a remote `lote` can claim. The
        # WORLD owns its place and size, so nothing a sponsor sends can cover a
        # street or dwarf the block.
        sw = max(24, (x1 - x0) // 3); sh = max(16, (y1 - y0) // 3)
        slot = [int((x0 + x1) // 2 - sw // 2), int((y0 + y1) // 2 - sh // 2), int(sw), int(sh)]
        # `ang` = the BLOCK's angle (its avenidas' direction), radians. Whatever
        # the renderer draws ON a parcel — mow stripes, pitch markings, the
        # church, the sponsor plate — rotates by it, so nothing sits square to
        # the screen on a manzana that is not. Do NOT re-derive this from the
        # poly: a traced outline's vertices are staircase steps, and fitting
        # them puts a square-ish parcel on the contrary diagonal (carmen_plaza
        # fitted to -67°).
        rec = {"id": part["id"], "name": part["name"], "use": part["use"],
               "poly": poly, "cx": int((x0 + x1) // 2), "cy": int(ay),
               "x0": x0, "y0": y0, "x1": x1, "y1": y1, "slot": slot,
               "ang": round(ang, 4)}
        # Stable/source identity and drawing semantics used by feature blocks.
        # A marine structure's parcel is real GROUND around its OSM footprint,
        # while the residual park is already painted by `greens` (`whole`).
        # `crowd` = quién se para en esta parcela; `groundColor`/`kerbColor` =
        # de qué color es SU suelo, no el de su `use`. Las tres son de la
        # INSTANCIA, que es justo lo que faltaba: 193 parques compartían una
        # perilla y toda cancha del mundo recibía la misma multitud.
        for k in ("label", "osmId", "marine", "whole", "built", "decor",
                  "polys", "crowd", "groundColor", "kerbColor"):
            if k in part:
                rec[k] = part[k]
        # …y el estilo autorado POR ID, que gana sobre lo que traiga la parte.
        # Las parcelas sí tienen ids estables y con significado
        # (`osm_park_232390078`, `centro_catedral`), a diferencia de una cuadra,
        # cuyo id es el hash de su contorno.
        for k, v in PARCEL_STYLES.get(rec["id"], {}).items():
            rec[{"ground": "groundColor", "kerb": "kerbColor"}.get(k, k)] = v
        # HALF-EXTENTS in the parcel's OWN frame. Every drawer used to size
        # itself off the AXIS-ALIGNED bbox (P.x1 - P.x0), which on a turned
        # parcel is bigger than the parcel — so the church, the schoolyard and
        # the sponsor plate all came out oversized and spilled over their kerb.
        # `hw`/`hh` are the real half-width and half-height along `ang`.
        if part.get("hw") is not None:
            rec["hw"], rec["hh"] = part["hw"], part["hh"]
        # DECORATION the renderer draws ON this parcel, declared by the part and
        # passed through untouched (`river`, `statue`, `kiosco`…). The world says
        # WHICH parcel has a river; the client owns what a river looks like.
        for k in ("river", "statue", "kiosco", "sport"):
            if part.get(k):
                rec[k] = part[k]
        # `bus: "south"|"north"` — a paradita at the parcel's own edge, aligned
        # with its centre, on the side that faces the avenida. INSIDE the edge,
        # not past it: the road pass paints its 20 px acera band OVER the block
        # edge, so a shelter tucked just inside lands on the drawn sidewalk,
        # while anything past it stands in the roadway.
        side = part.get("bus")
        if side in ("south", "north"):
            bw, bh = 46, 14
            by = (y1 - bh * 0.6) if side == "south" else (y0 + bh * 0.6)
            rec["bus"] = [int((x0 + x1) // 2 - bw // 2), int(by - bh // 2), bw, bh]
        # `lm`: re-anchor a landmark onto the parcel that now IS it. The POI was
        # placed from its geo anchor long before the block was laid out, so its
        # label and its minimap pin would otherwise sit a few metres off the
        # thing they name.
        # It also rides into the manifest, because the two now draw the SAME
        # thing: the parcel owns the building, so the landmark pass must skip
        # its own art and contribute only the name pill. Without it the catedral
        # got a small stucco church stamped on the middle of the stone one.
        if part.get("lm"):
            lm = next((l for l in self.landmarks if l["id"] == part["lm"]), None)
            if lm is None:
                log("parcel", f"WARN {part['id']} landmark {part['lm']} missing")
            else:
                lm["x"], lm["y"] = rec["cx"], rec["cy"]
                rec["lm"] = part["lm"]
                log("parcel", f"{part['id']} re-anchored {part['lm']} to ({rec['cx']},{rec['cy']})")
        self.parcels.append(rec)
        cuads = {(c * GRID_CELL // CUAD, r * GRID_CELL // CUAD) for (c, r) in cells}
        self.occ.update(cuads)                        # no buildings inside a parcel
        self.claimed_cells |= set(cells)
        # `green` on a BLOCK excludes the WHOLE cuadra from synth_buildings, and
        # a hand-laid manzana is laid out part by part, so every part of it says
        # yes. An OSM site is a different animal: a 27-cell cancha can sit in the
        # middle of a residential block, and blanking that block's houses over it
        # would empty half the barrio. `occ` already keeps buildings off the
        # parcel's own cuad cells at cell granularity — the block flag is only
        # for a parcel that IS most of its cuadra, which is what `green: False`
        # (set by place_osm_sites) opts out of.
        if part.get("green", True):
            for b in self.blocks:
                if not b.get("green") and any(c in cuads for c in b["cells"]):
                    b["green"] = True
        if part["use"] in (ParcelUse.PLAZA, ParcelUse.STADIUM):   # drivable open field
            for (c, r) in cells:
                self.raster.set(c, r, CLS_ROAD)
        elif part["use"] == ParcelUse.BOULEVARD:
            # A calle peatonal is its OWN surface class, not asphalt: transitable
            # (Surface.DRIVABLE) but slow, and the client paints it as stone
            # instead of road. Stamped on the UN-eroded cells like the open
            # fields, so it meets the bounding streets and you can turn into it.
            for (c, r) in cells:
                self.raster.set(c, r, CLS_BOULEVARD)
            # …PLUS one cell of dilation. This is the mismatch CLAUDE.md warns
            # about, seen from the other side: `paintParcels` strokes the drawn
            # slab's outline at lineWidth 8 to hide the trace's 4 px staircase,
            # so the STONE YOU SEE is 4 px wider than the cells you may drive
            # on, and the car stops against an invisible wall while it still
            # looks to be on the pavement. The drivable stamp has to be >= the
            # drawn feature. Only LAND/ACERA is taken — never a street, the sea
            # or the sand.
            edge = set()
            for (c, r) in cells:
                for n in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
                    if n in cells or n in edge:
                        continue
                    if self.raster.at(*n) in (CLS_LAND, CLS_ACERA):
                        edge.add(n)
            for (c, r) in edge:
                self.raster.set(c, r, CLS_BOULEVARD)
        log("parcel", f"{part['id']} ({part['use']}) ({x0},{y0})-({x1},{y1})px "
              f"{len(poly)//2}v slot{slot}")
        return self.parcels[-1]

    # ---- PARCELS -----------------------------------------------------------
    # A cuadra cut into named PARTS, each with a `use` that drives how it is
    # drawn and a `slot` a sponsor can claim. The general form of what the
    # estadios do by hand: resolve the block, then hand out pieces of it.
    #
    #   cols/rows  — an N×M subdivision, sized by optional weights, cut in the
    #                block's OWN frame: columns along the calles, rows along the
    #                avenidas (see _street_dir).
    #   aceras     — True takes the part's cells from the block's ERODED set, so
    #                what sits on it (a church, a pitch's white lines) can never
    #                land on the acera; False keeps the ring so the part fills
    #                the block edge to edge. The erosion is the BLOCK's and it is
    #                directional, so a part only loses the edges that face a
    #                street — the Carmen plaza keeps its west edge flush against
    #                the parroquia next door. A `plaza`/`stadium` part is stamped
    #                drivable on its UN-eroded cells either way, so the ring is
    #                asphalt you can drive on, not a wall around the field.
    def _reclaim(self, spec_id, rx0, ry0, rx1, ry1):
        """Give a hand-laid manzana its interior back before tracing it.

        `cuadra_cells` looks for LAND/ACERA, and by this point in the build the
        block may be neither. Two earlier stages pave right through a cuadra
        and neither knows a parcel plan is coming:

          * `stamp_pad` carves a 6-cuadrícula CLS_ROAD apron under every kiosk
            and customer so you can pull off the street to it. One customer
            seated on the civic block cut it clean in half — the trace then
            returned the biggest surviving fragment, an L of sidewalk, and the
            parts came out as 8x16 px slivers.
          * `detect_blocks` paves a cuadra that fits no 6x6 square of buildable
            cells to CLS_ACERA as a "sliver". A short, wide manzana like this
            one qualifies.

        The rect runs centreline to centreline, so what tells the interior from
        the bounding calles is not geometry but the ROAD LIST: any cell inside
        it that no real centreline paints goes back to CLS_LAND. That follows a
        diagonal avenida exactly, which an inset rect cannot.
        """
        raster = self.raster
        cell = raster.cell
        c0, c1 = int(rx0 // cell), int(rx1 // cell)
        r0, r1 = int(ry0 // cell), int(ry1 // cell)
        n = 0
        for r in range(max(0, r0), min(raster.rows, r1 + 1)):
            for c in range(max(0, c0), min(raster.cols, c1 + 1)):
                if raster.buf[r * raster.cols + c] not in (CLS_ROAD, CLS_ACERA):
                    continue
                if self.streets.on_street(c * cell + cell / 2, r * cell + cell / 2):
                    continue
                raster.set(c, r, CLS_LAND)
                n += 1
        log("parcel", f"{spec_id} reclaimed {n} cells inside the manzana "
            f"(POI aprons + sliver paving) back to land")

    def _band_parts(self, spec, outer, inner, field, ang, ncol, nrow, mx, my):
        """Cut `outer` into the spec's columns and rows and emit each part.

        SHARED BY LOS DOS REPARTOS DE BANDAS — la cuadra hecha a mano y, desde
        el 2026-08-15, un `streets-quad` que trae `parts`. Escrito dos veces se
        habrían separado en los detalles, que es justamente lo que le pasó a la
        gradería y a la torre viviendo aparte del estadio.

        Cada celda se proyecta sobre el NORMAL DE LA OTRA FAMILIA — las columnas
        se cortan con líneas paralelas a las CALLES y las filas con líneas
        paralelas a las AVENIDAS. Es un marco afín, y es lo que hace que encaje
        en un paralelogramo: la cuadrícula no es cuadrada con la pantalla ni
        consigo misma.
        """
        uv = {c: ((c[0] - mx) * ncol[0] + (c[1] - my) * ncol[1],
                  (c[0] - mx) * nrow[0] + (c[1] - my) * nrow[1])
              for c in outer}
        cw = spec.get("cols", [1]); rw = spec.get("rows", [1])
        ue = _bands([v[0] for v in uv.values()], cw)
        ve = _bands([v[1] for v in uv.values()], rw)
        # CUÁNTAS CELDAS LE TOCAN A UNA PARTE, por sus PESOS y no por reparto
        # parejo. `len(outer) / (ncols·nrows)` supone bandas iguales, y con pesos
        # desiguales eso rechaza partes legítimas: en el centro cívico las
        # columnas van 4.4 / 1.8 / 1.3 / 2.2, así que la celda de la columna
        # angosta tiene la mitad de las celdas del reparto parejo y la Capilla se
        # caía por «el split no le queda a este bloque» estando perfectamente
        # bien. El área esperada es la FRACCIÓN de peso que la parte abarca.
        tw_c, tw_r = sum(cw), sum(rw)
        def nominal_for(c0, c1, r0, r1):
            fc = sum(cw[c0:c1 + 1]) / tw_c
            fr = sum(rw[r0:r1 + 1]) / tw_r
            return len(outer) * fc * fr
        # `col`/`row` take an int or an inclusive [from, to] SPAN, so parts do
        # not all have to be the same size: the Carmen block is one column of
        # two (church over garden) beside one column spanning both rows (the
        # plaza). That is what lets a cuadra hold commerce of different sizes.
        rng = lambda v: (v, v) if isinstance(v, int) else (v[0], v[1])
        claimed = set()
        for part in spec["parts"]:
            c0, c1 = rng(part.get("col", 0))
            r0, r1 = rng(part.get("row", 0))
            src = ((field if part["use"] in (ParcelUse.PLAZA, ParcelUse.STADIUM) else inner)
                   if part.get("aceras") else outer)
            cells = {c for c in src
                     if ue[c0] <= uv[c][0] < ue[c1 + 1] and ve[r0] <= uv[c][1] < ve[r1 + 1]}
            # cells the part OWNS on the block (for occ / drivability), which is
            # the un-eroded slice — the ring in front of a church is still its
            # frontage, no building may land there
            own = {c for c in outer
                   if ue[c0] <= uv[c][0] < ue[c1 + 1] and ve[r0] <= uv[c][1] < ve[r1 + 1]}
            want = nominal_for(c0, c1, r0, r1)
            # A part that came out mostly EMPTY means the split does not suit
            # this block (it is a ribbon, not a rectangle) — fail loudly in the
            # log instead of quietly emitting a sliver out in the street.
            if len(own) < want * 0.35:
                log("parcel", f"WARN {part['id']} only {len(cells)} cells vs "
                      f"{want:.0f} nominal — split does not suit this block"); continue
            self._emit_parcel(spec["id"], part, own, cells, ang)
            claimed |= own
        return claimed

    def _boulevard_street(self, spec, ref):
        """UNA CALLE QUE ES BULEVAR, no una franja de manzana que lo parece.

        Hasta hoy `Surface.BOULEVARD` sólo salía de una PARCELA: para que una
        calle peatonal se leyera como tal había que robarle al bloque una franja
        pegada al borde, que es lo que cerraba la H del centro cívico y se comía
        el ancho de la cuadra. El Bulevar de la Casa de la Cultura no es una
        franja de la manzana — **es la calle**, y así se llama en la vida real.

        Se estampa sobre la CALZADA de la vía nombrada, con su propio ancho, así
        que queda transitable-pero-lenta. No se le toca la acera: el cordón sigue
        siendo cordón.

        **TODAVÍA NO SE DIBUJA EN PIEDRA, y esto estampa el suelo, no lo pinta.**
        Decía que `paintStone` la dibujaba y es falso: `paintStone` se llama sólo
        desde `paintParcels` cuando `P.use == "boulevard"`, y una calle no es una
        parcela. Peor, el propio `paintStone` documenta que «el asfalto todavía
        repinta lo que llegó a la calzada» — correcto para una franja de manzana,
        fatal para una CALLE, porque la calzada es la pieza entera. Medido: la
        clase 7 de esta calle sale `#513842` (el asfalto) contra `#ddc6be` de la
        T. Para arreglarlo hay que EMITIR el tramo estampado (estos `flat` y este
        ancho) como entidad propia y pintarla después del asfalto; mientras no
        exista, el jugador la siente lenta y la ve asfalto.
        """
        names = spec.get("boulevardStreet")
        if not names:
            return
        # El alcance es el mismo que usa StreetIndex para resolver una calle
        # junto a un ancla — en METROS, así que sobrevive un reescalado.
        span = street_span_px(STREET_SPAN_M)
        for name, roads in self.streets.named(names):
            n = 0
            for road in roads:
                pts = road.get("pts") or []
                if len(pts) < 4:
                    continue
                # Sólo el tramo que de verdad bordea ESTA manzana: la misma vía
                # puede seguir diez cuadras más y no todas son peatonales.
                near = [(pts[i], pts[i + 1]) for i in range(0, len(pts), 2)
                        if abs(pts[i] - ref[0]) < span
                        and abs(pts[i + 1] - ref[1]) < span]
                if len(near) < 2:
                    continue
                flat = [v for xy in near for v in xy]
                self.raster.stamp_polyline(flat, road.get("w") or CUAD, CLS_BOULEVARD)
                n += 1
            log("parcel", f"{spec['id']}: {name} estampada como bulevar "
                f"({n} tramo(s) junto a la manzana)")
            return
        log("parcel", f"WARN {spec['id']} boulevardStreet {names} no resolvió")

    def place_parcels(self, spec):
        # `ll` is the anchor; `at` is the legacy world-px one and is only still
        # read so an old spec fails loudly rather than silently. A px anchor
        # does not survive a rescale — see the comment on the carmen block.
        ref = self.project_ll(*spec["ll"]) if spec.get("ll") else spec["at"]
        cxa = self.streets.at(spec["calles"][0], "x", ref)
        cxb = self.streets.at(spec["calles"][1], "x", ref)
        ayn = self.streets.at(spec["ave_north"], "y", ref)
        ays = self.streets.at(spec["ave_south"], "y", ref)
        if None in (cxa, cxb, ayn, ays):
            log("parcel", f"WARN {spec['id']} street resolve failed "
                  f"(calles {cxa},{cxb} avenidas {ayn},{ays})"); return set()
        rx0, ry0 = min(cxa, cxb), min(ayn, ays)
        rx1, ry1 = max(cxa, cxb), max(ayn, ays)
        if spec.get("reclaim"):
            self._reclaim(spec["id"], rx0, ry0, rx1, ry1)
        outer = cuadra_cells(self.raster, rx0, ry0, rx1, ry1, (CLS_LAND, CLS_ACERA))
        if not outer:
            log("parcel", f"WARN {spec['id']} no cuadra in rect"); return set()
        # Erode ONCE, for the block. The acera ring is around the CUADRA, not
        # around every part of it: eroding per part also inset each one from the
        # internal split lines, which are not streets, and on a small block that
        # left 4px slivers. `aceras: True` therefore means "respect the block's
        # ring", and a part just takes its cells from the eroded set.
        inner = erode_cells(outer, ACERA_CELLS, STREET_CLASSES, self.raster.at)
        # …and a shallower one for the open fields (see FIELD_ACERA_CELLS): a
        # church must clear the whole sidewalk, a pitch only has to stop at the
        # kerb, and on a small cuadra the difference is most of the plaza.
        field = erode_cells(outer, FIELD_ACERA_CELLS, STREET_CLASSES, self.raster.at)
        # THE BLOCK'S FRAME COMES FROM ITS BOUNDING STREETS, not from a fit of
        # its own cells. A principal-axis fit (_cell_frame) is wrong here twice
        # over: on a square-ish cuadra sxx≈syy, the fit is degenerate and snaps
        # to ±45°, cutting the parts along the CONTRARY diagonal to the manzana;
        # and even when it lands, it can only return ORTHOGONAL axes, while the
        # cuadrícula is a parallelogram. So COLUMNS are cut by lines parallel to
        # the CALLES and ROWS by lines parallel to the AVENIDAS — each cell is
        # projected on the NORMAL of the other family, an affine frame that fits
        # a non-square block. `ang` (the avenida direction) rides into the
        # manifest so the renderer draws on the block's angle too.
        av = self.streets.direction(spec["ave_north"], ref, "x") or self.streets.direction(spec["ave_south"], ref, "x")
        cl = self.streets.direction(spec["calles"][0], ref, "y") or self.streets.direction(spec["calles"][1], ref, "y")
        mx, my, ca, sa = _cell_frame(outer)          # centre (+ fallback axes)
        if av and cl:
            ang = math.atan2(av[1], av[0])
            nrow = (-av[1], av[0])                   # normal of the avenidas → row coord (south+)
            ncol = (cl[1], -cl[0])                   # normal of the calles   → col coord (east+)
        else:
            log("parcel", f"WARN {spec['id']} street direction unresolved "
                  f"(avenida {av}, calle {cl}) — principal-axis fallback")
            ang = math.atan2(sa, ca)
            nrow, ncol = (-sa, ca), (ca, sa)
        log("parcel", f"{spec['id']} block frame {math.degrees(ang):+.1f}° "
              f"(avenida {av}, calle {cl}), {len(outer)} cells")
        claimed = self._band_parts(spec, outer, inner, field, ang, ncol, nrow, mx, my)
        self._boulevard_street(spec, ref)
        # The CUAD cells the block's parts took. A caller that is laying a whole
        # cuadra out by hand uses this to clear the OSM footprints standing on
        # it: named buildings are kept at their real outline unconditionally, so
        # without this the parroquia's capilla ends up in the middle of a park.
        return {(c * GRID_CELL // CUAD, r * GRID_CELL // CUAD) for (c, r) in claimed}

    # ---- OSM SITES ----------------------------------------------------------
    # The general case of what `place_parcels` does by hand, driven by the map
    # instead of by a table: `extract_sites` finds 438 of them on this map —
    # 205 parks, 85 canchas, 68 escuelas y jardines, 63 iglesias, 17 campus —
    # and until now none of them was ground. They reached the client as a name
    # dot, while the player looked at 16 SYNTHETIC parks scattered on whatever
    # cuadra happened to be free.
    #
    # A hand-authored block names its bounding streets and cuts itself into
    # parts. A site does neither: it arrives as one real outline, and the only
    # question is which of the cells under it are actually its ground.
    #: use per site kind. Open ground (park/pitch) is drawn as a field and
    #: STAMPED DRIVABLE by _emit_parcel; the rest are buildings on a plot.
    SITE_USE = {"park": ParcelUse.PARK, "pitch": ParcelUse.STADIUM,
                "worship": ParcelUse.CHURCH, "school": ParcelUse.SCHOOL,
                "kinder": ParcelUse.KINDER, "campus": ParcelUse.CAMPUS,
                "fuel": ParcelUse.FUEL, "market": ParcelUse.MARKET}
    #: the kinds whose parcel replaces a BUILDING: their OSM footprints have to
    #: be cleared, or a pastel box lands on top of the drawn church/school.
    # `market` is here because the parcel IS the market hall's own outline —
    # the same OSM way — so leaving the footprint would stack a pastel box on
    # top of the exact shape it was traced from.
    SITE_BUILT = ("worship", "school", "kinder", "campus", "fuel", "market")
    SITE_FALLBACK_NAME = {"park": "Parque", "pitch": "Plaza de Deportes",
                          "worship": "Iglesia", "school": "Escuela",
                          "kinder": "Jardín de Niños", "campus": "Centro Educativo",
                          "fuel": "Gasolinera", "market": "Mercado"}
    #: a site has to keep this much of its outline as real cuadra ground, and
    #: this many cells, or it is a ribbon along a street rather than a place.
    #: Parque del Muellero is 855x297 px of mostly Paseo asphalt.
    SITE_MIN_KEPT = 0.25
    SITE_MIN_CELLS = 12
    #: …and it has to be a PLOT: at least this many cells on its SHORT side.
    #: This is also what decides whether a plot can afford its acera ring — a
    #: hand-authored part is a quarter of a manzana and takes 20 px on every
    #: side without noticing; a 30-cell chapel would be eroded out of existence.
    #: 3 cells = 12 px, under which the trace is a smear, not a lot.
    SITE_MIN_SIDE = 3
    #: a site covering this much of the cuadra it touches OWNS it — the block
    #: goes green and its synth houses go away. Below it the site is a piece of
    #: a live manzana and the neighbours keep their buildings.
    SITE_OWNS_BLOCK = 0.6

    def _manzana_ground(self, under, cell):
        """The whole cuadra a site FILLS, as that site's ground.

        A few mapped places are not a plot inside a manzana — they ARE the
        manzana. The Mercado Municipal's outline runs calle to calle (Calle 0B
        to Calle 2A, Avenida 5 to Avenida 3 Filiberto Sinfontes, which is its
        own `addr:street`), exactly like an estadio's.

        Clipping such an outline to LAND is the wrong question, and it fails
        QUIETLY: the 65 px carriageways eat the block centreline to centreline,
        so 1 300 cells of market hall come back as the 266-cell acera fringe
        they did not reach. Everything downstream then works on a frontage
        strip — and because a 110 px strip does not fit the 59 px interior of
        its OWN block, the manzana seat slid the Mercado 250 px into a
        neighbour's. Shape preserved, place wrong.

        THE BLOCK LIST CANNOT ANSWER THIS EITHER, and that is not a detection
        bug: `detect_blocks` paves a cuadra that holds no 6x6 square of
        buildable cells as an acera SLIVER, which a short wide manzana like
        this one is — so no detected block covers the Mercado at all. Asking
        the ROAD LIST is the move `"reclaim": True` already makes for a
        hand-laid cuadra, and `on_street` exists for exactly this: the surface
        raster says "acera" for both a sliver and a real sidewalk, while the
        centrelines know which cells are actually calle.

        So: the cells inside the mapper's own outline that no road centreline
        paints. The outline IS the manzana, so this cannot reach across a
        street into a neighbour, and it follows a diagonal avenida exactly.
        The cells keep their acera class here; the accepted lot is RECLAIMED to
        CLS_LAND at the end (see the `cuadra` stamp below), which leaves the
        eroded-away frontage as the acera ring the market stands back from.

        THE TEST IS THE CENTRELINES, NOT THE SURFACE, and the difference is the
        whole point. Measured here: the asphalt splitting this manzana is 70 px
        from the nearest centreline — it is the Mercado's OWN POI apron from
        `stamp_pad`, and Calle 0B to Calle 2A is 176 px of which 41 is
        carriageway, so the block is a comfortable 135 px. Adding a
        `HARD_STREET_CLASSES` surface filter "for safety" re-excluded exactly
        those apron cells, split the ground 1022 → 491 and left the market on a
        44 px ribbon east of its own pad. The surface cannot tell a pad from a
        calle; the road list can. That is why `on_street` exists.

        Returns those cells, or None when the outline is all roadway.
        """
        ground = _largest_part({
            (c, r) for (c, r) in under
            if (c, r) not in self.claimed_cells
            and not self.streets.on_street(c * cell + cell / 2, r * cell + cell / 2)
        })
        return ground or None

    def _slide_cells_into(self, keep, ang, cell, reach=44):
        """Slide a plot into its manzana WITHOUT changing its shape.

        The rect seat below is right for a plot whose outline was never the
        point; a `trace` site's outline IS the point. So this looks for a whole
        -cell TRANSLATION that puts every cell of the shape on real cuadra
        ground inside the acera ring, and takes the smallest one — the Mercado
        Municipal keeps its four mapped vertices and simply steps off the
        esplanade. Rigid: no scale, no re-fit, so the contour that comes out is
        the contour that went in.

        Returns (cells, None) — no rect, because a traced parcel is emitted from
        its cells, not from a frame rect — or None when nothing fits.
        """
        cx = sum(c for c, _ in keep) / len(keep) * cell
        cy = sum(r for _, r in keep) / len(keep) * cell
        block = min((b for b in self.blocks if not b.get("green")),
                    key=lambda b: min((cc * CUAD + CUAD / 2 - cx) ** 2
                                      + (cr * CUAD + CUAD / 2 - cy) ** 2
                                      for cc, cr in b["cells"]),
                    default=None)
        if block is None:
            return None
        inner = erode_cells(
            block_raster_cells(self.raster, block["cells"], CUAD // cell, CLS_LAND),
            ACERA_CELLS, STREET_CLASSES, self.raster.at) - self.claimed_cells
        if not inner:
            return None
        shape = sorted(keep)
        for radius in range(0, reach + 1):          # smallest move first
            for dc in range(-radius, radius + 1):
                for dr in (-radius, radius) if abs(dc) < radius else range(-radius, radius + 1):
                    moved = {(c + dc, r + dr) for (c, r) in shape}
                    if moved <= inner:
                        return moved, None
        return None

    #: A hard ceiling on how many manzanas to TRY when reseating a plot. Rarely
    #: reached: the search stops as soon as no remaining block could beat the
    #: best seat found (see `_seat_site_in_manzana`), and this only bounds the
    #: pathological case where every candidate in a row has no room.
    SEAT_BLOCK_CANDIDATES = 12

    def _seat_site_in_manzana(self, keep, krect, ang, cell):
        """Put a plot that is still on the sidewalk INSIDE its manzana.

        Same principle as `fit_manzana_contents` does for buildings, one plot at
        a time: the block is the container. The site keeps the SIZE its own fit
        gave it (clamped to what the manzana can hold) and is placed as near as
        the block allows to where the mapper actually drew it — so a chapel does
        not teleport across the barrio, it steps off the kerb.

        THE NEAREST BLOCK IS NOT THE NEAREST SEAT, and picking one by the first
        used to lose the second. This chose the manzana whose nearest CELL was
        closest and then committed to it — but the plot is clamped into that
        block's single largest free rectangle, which on a big manzana can be at
        the far end of it. Measured: `osm_worship_964088820` (Iglesia Cristana,
        21 of its 30 mapped cells are sidewalk) came out 1 464 px from its own
        outline, having been 586 px away in the build before. Committing also
        meant that a candidate which turned out to have no room returned None
        instead of trying the next manzana along.

        So SCORE THE SEAT, not the block: walk the manzanas nearest-first and
        keep whichever seat actually lands closest to where the mapper drew the
        place. The walk stops on a bound rather than a guess — a seat is inside
        its block, so no remaining block can beat the best seat already found.

        Returns (cells, rect) or None when no candidate has room for a plot.
        """
        cx = sum(c for c, _ in keep) / len(keep) * cell
        cy = sum(r for _, r in keep) / len(keep) * cell
        reach = [(b, min((cc * CUAD + CUAD / 2 - cx) ** 2
                         + (cr * CUAD + CUAD / 2 - cy) ** 2
                         for cc, cr in b["cells"]))
                 for b in self.blocks if not b.get("green")]
        # sorted by distance, tie broken explicitly so the order is stable
        near = sorted(reach, key=lambda pair: (pair[1], min(pair[0]["cells"])))
        best = None
        for block, reach2 in near[:self.SEAT_BLOCK_CANDIDATES]:
            # PROVABLY DONE: a seat sits inside this block, so it cannot be
            # nearer than the block's own nearest cell — less one cuadrícula,
            # since `reach2` is measured to cell CENTRES and a seat may sit at a
            # cell's edge. Once no remaining block can beat what we have, stop.
            if best is not None and math.sqrt(reach2) - CUAD > math.sqrt(best[0]):
                break
            got = self._seat_in_one_block(block, krect, ang, cell, cx, cy)
            if got is None:
                continue
            _, seat = got
            away = (seat[4] - cx) ** 2 + (seat[5] - cy) ** 2
            if best is None or away < best[0]:
                best = (away, got)
        return best[1] if best else None

    def _seat_in_one_block(self, block, krect, ang, cell, cx, cy):
        """The seat this ONE manzana can offer, or None. Split out of
        `_seat_site_in_manzana` so several candidates can be compared instead of
        the first being committed to."""
        inner = erode_cells(
            block_raster_cells(self.raster, block["cells"], CUAD // cell, CLS_LAND),
            ACERA_CELLS, STREET_CLASSES, self.raster.at)
        inner -= self.claimed_cells        # …and not on top of another parcel
        if not inner:
            return None
        room = fit_inscribed_rect(inner, ang, cell)
        if not room:
            return None
        ru0, ru1, rv0, rv1, rcu, rcv = room
        # the plot's own size, but never larger than the manzana's usable rect
        hw = min((krect[1] - krect[0]) / 2, (ru1 - ru0) / 2)
        hh = min((krect[3] - krect[2]) / 2, (rv1 - rv0) / 2)
        if min(hw, hh) * 2 / cell + 1 < self.SITE_MIN_SIDE:
            return None
        # …centred where it really is, clamped into the room it has. A rect is
        # (u0, u1, v0, v1) about a WORLD anchor (cu, cv), so the site's own
        # centre goes into the room's frame, gets clamped there, and comes back.
        ca, sa = math.cos(ang), math.sin(ang)
        dx, dy = cx - rcu, cy - rcv
        u = min(max(dx * ca + dy * sa, ru0 + hw), ru1 - hw)
        v = min(max(-dx * sa + dy * ca, rv0 + hh), rv1 - hh)
        seat = (-hw, hw, -hh, hh,
                rcu + u * ca - v * sa, rcv + u * sa + v * ca)
        cells = cells_in_poly(inner, rect_poly(seat, ang), cell)
        if len(cells) < self.SITE_MIN_CELLS:
            return None
        return cells, seat

    #: Which landmark types an OSM site of each kind can BE. A worship area is
    #: the church landmark standing in it; a pitch is the estadio. A school or a
    #: gasolinera has no landmark counterpart, so it is absent rather than
    #: mapped to something loosely related.
    SITE_TWIN_TYPES = {"worship": ("church", "cathedral"),
                       "park": ("park",),
                       "pitch": ("stadium",),
                       "market": ("market",)}

    #: Landmark types that stand on a plot of their own. A kiosk does not (it is
    #: a chinamo on the acera), and neither does a pier, a beach sign or a
    #: lighthouse — those ARE their ground already.
    LOT_LANDMARKS = ("church", "cathedral", "market", "super", "hotel", "civic",
                     "house", "museum", "restaurant")
    #: How big a landmark's lot is when nothing else says. The drawn art is
    #: ~56x44 px, and the lot is the ground it stands on plus a little yard.
    LOT_SIZE = (76, 60)

    def place_landmark_lots(self, landmarks):
        """Give every building landmark a PLOT, not just an icon on the ground.

        A landmark used to be a point with a drawing at it — so it had no
        ground, could not be sponsored, and nothing could tell you whether the
        Hotel Tioga was on the manzana or on the pavement. Here it becomes what
        it is on the map: a piece of a block. Anything already carried by a
        hand-laid part or an OSM site keeps that (they are better geometry, cut
        from the real outline); this only fills in the rest.
        """
        have = {p.get("lm") for p in self.parcels if p.get("lm")}
        made = 0
        for lm in self.landmarks:
            if lm["type"] not in self.LOT_LANDMARKS or lm["id"] in have:
                continue
            cell = self.raster.cell
            hw, hh = self.LOT_SIZE[0] / 2, self.LOT_SIZE[1] / 2
            seed = {(int(lm["x"] // cell), int(lm["y"] // cell))}
            seat = self._seat_site_in_manzana(seed, (-hw, hw, -hh, hh, 0, 0),
                                              self.streets.angle_at(lm["x"], lm["y"]), cell)
            if seat is None:
                continue
            cells, rect = seat
            part = {"id": f"lote_{lm['id']}", "use": ParcelUse.LOT,
                    "name": lm["name"], "lm": lm["id"]}
            ang = self.streets.angle_at(lm["x"], lm["y"])
            if self._emit_parcel(part["id"], part, cells, cells, ang,
                                 poly=rect_poly(rect, ang)):
                made += 1
        log("parcel", f"{made} landmark lots — a landmark is a piece of a "
            f"manzana now, not a drawing floating on one")

    def place_osm_sites(self, sites):
        """Turn each OSM ground site into a parcel on the cuadra under it.

        `self.claimed` already holds the CUAD cells the hand-authored blocks,
        the estadios and the feature blocks own — hand-authored ground always
        wins, so the Carmen parroquia, the Catedral's manzana and Plaza Las
        Playitas are never re-derived from OSM on top of themselves. It grows as
        this runs, so two OSM sites mapped over each other resolve by OSM id:
        the lower id takes the ground, deterministically.

        Returns the CUAD cells claimed by BUILDING sites, for the caller's
        footprint clear (see `SITE_BUILT`).
        """
        raster = self.raster
        cell = raster.cell
        built_cuads = set()
        placed, skipped = 0, defaultdict(int)

        for site in sites:                       # sorted by OSM id upstream
            use = self.SITE_USE.get(site["kind"])
            if use is None:
                continue
            if use == ParcelUse.CHURCH and site.get("cathedral"):
                use = ParcelUse.CATHEDRAL
            pts = site["pts"]
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            c0, c1 = int(min(xs) // cell), int(max(xs) // cell)
            r0, r1 = int(min(ys) // cell), int(max(ys) // cell)
            # cells under the outline, then ONLY the ones that are real cuadra
            # ground. Testing the SURFACE is what keeps a parcel out of the
            # roadway and lets it follow a diagonal avenida exactly — the same
            # move `_reclaim` makes, from the other side.
            # A GASOLINERA'S GROUND IS PAVED. Every other site is a plot cut out
            # of a cuadra, so LAND/ACERA is the test that keeps it off the road —
            # but a forecourt is by definition open to the street, and testing it
            # the same way rejected all 12 stations on the map (the Delta at
            # 6/40 cells). It is not stamped, so the asphalt still wins the
            # ground; only the canopy and the pumps draw on top.
            # UN LUGAR DEL FRENTE MARÍTIMO NO ESTÁ SOBRE TIERRA, y por eso
            # desaparecía. LAND/ACERA es la prueba correcta para un lote cortado
            # de una cuadra, pero el Parque del Muellero es una cinta de 1 336 px
            # entre el Paseo y el muelle y la cancha de playa está sobre la
            # arena: su suelo es MALECÓN y ARENA, ninguno de los dos elegible.
            # El parque salía a 252x96 px de una huella de 1336x463 —el 4 %— con
            # su rótulo flotando fuera de lo que quedaba. `shore` en
            # `site-decor.json` es el mismo permiso explícito que `fuel` ya tiene
            # para su asfalto: el sitio NO se estampa, así que el malecón sigue
            # ganando el suelo; sólo se dibuja encima.
            _decor0 = SITE_DECOR.get(f"osm_{site['kind']}_{site['id']}", {})
            ground = ((CLS_LAND, CLS_ACERA, CLS_ROAD) if site["kind"] == "fuel"
                      else (CLS_LAND, CLS_ACERA, CLS_MALECON, CLS_BEACH)
                      if _decor0.get("shore")
                      else (CLS_LAND, CLS_ACERA))
            under, own = set(), set()
            for r in range(max(0, r0), min(raster.rows, r1 + 1)):
                for c in range(max(0, c0), min(raster.cols, c1 + 1)):
                    if not point_in_poly(
                            (c * cell + cell / 2, r * cell + cell / 2), pts):
                        continue
                    under.add((c, r))
                    if raster.at(c, r) in ground:
                        own.add((c, r))
            if not under:
                skipped["off-grid"] += 1; continue
            # Ground already handed out is not available — measured CELL BY
            # CELL. At CUAD granularity two sites on opposite sides of the same
            # calle share the 20 px cell the street runs through, and the
            # Iglesia de Las Playitas came out "claimed" by the estadio across
            # the road. Here a church inside a school yard still yields (the
            # school owns those cells) while the one next door keeps its lot.
            # `taken` counts ALL the cells under the outline that are spoken for,
            # not just the buildable ones: an estadio's cuadra was stamped
            # drivable when it was placed, so a site on top of it would otherwise
            # be reported as "in the street" when the real reason is the estadio.
            taken = under & self.claimed_cells
            own -= taken
            if len(own) < self.SITE_MIN_CELLS or len(own) < len(under) * self.SITE_MIN_KEPT:
                claimed = len(taken) >= len(under) * self.SITE_MIN_KEPT
                log("site", f"skip {site['id']} {site['kind']} "
                    f"{(site['name'] or '—')[:34]}: "
                    + (f"{len(taken)}/{len(under)} cells already claimed" if claimed else
                       f"{len(own)}/{len(under)} cells are cuadra ground "
                       f"(street, sand or water)"))
                skipped["already-claimed" if claimed else "not-on-a-cuadra"] += 1
                continue
            pid = f"osm_{site['kind']}_{site['id']}"
            # THE JOIN. A landmark and an OSM site are regularly the SAME place
            # — the Iglesia del Carmen is `carmenig` in content.py and a
            # `worship` area in OSM — and there was no way to say so, which is
            # how one church could end up with two unrelated records.
            #
            # It is CONTAINMENT, not id equality, and the first cut of this got
            # that wrong: a landmark resolves against NAMED features, which are
            # overwhelmingly nodes, while a site is a closed way — disjoint id
            # spaces, so nothing ever matched. Worse, the id is not an identity
            # at all: `faro`, `balneario` and `kios_faro` all carry the same one
            # because all three anchor off the "faro de la punta" node with
            # different offsets. What actually relates a POI to its area in OSM
            # is that the point lies INSIDE it — plus a type check, so the
            # cathedral does not adopt the park it stands beside.
            owned = {p.get("lm") for p in self.parcels if p.get("lm")}
            ok_types = self.SITE_TWIN_TYPES.get(site["kind"], ())
            way_ref = f"way/{site['id']}"

            def is_twin(l):
                if l["id"] in owned or l["type"] not in ok_types:
                    return False
                # The landmark RESOLVED TO THIS VERY WAY. Rare but exact, and
                # the only test that works for the Mercado: `seat_on_block`
                # moves a landmark onto the nearest cuadra ground, which for a
                # market hall on an esplanade is a block east of its own
                # outline — so containment alone says no.
                if l.get("osmRef") == way_ref:
                    return True
                return point_in_poly((l["x"], l["y"]), site["pts"])
            twin = next((l for l in self.landmarks if is_twin(l)), None)
            # Most mapped sites are regularised into safe rectangles. A rare
            # site whose real identity is its angled cuadra edge can opt into
            # the source-supported raster contour; gameplay still uses those
            # exact cells and outline_poly only straightens their vector edge.
            decor = dict(SITE_DECOR.get(pid, {}))
            trace = bool(decor.pop("trace", False))
            # `cuadra`: this place OCCUPIES the whole block (see
            # `_manzana_ground`). It implies `trace`, because the contour of
            # the manzana — skewed to the real grid — is the shape.
            cuadra = bool(decor.pop("cuadra", False))
            if cuadra:
                whole = self._manzana_ground(under, cell)
                if whole:
                    log("site", f"{site['id']} {(site['name'] or '—')[:34]}: "
                        f"occupies its cuadra — {len(own)} cells of ground under "
                        f"the outline replaced by the manzana's {len(whole)}")
                    own, trace = whole, True
                else:
                    cuadra = False
                    warn("site", f"{pid}: 'cuadra' asked for, but the outline is all "
                         f"roadway — kept the ordinary plot fit")
            # THE PARCEL IS A RECTANGLE IN THE MANZANA'S FRAME. `own` is the
            # mapper's outline clipped to real ground, which wanders; a piece of
            # a cuadra does not. Fit the rect first, then everything after works
            # on a regular shape — which is also why the acera survives below:
            # eroding a ragged set destroys its thin arms, and the graded
            # fallback was dropping 169 of 377 rings to save the parcel.
            ang = self.streets.angle_at(
                sum(c for c, _ in own) / len(own) * cell,
                sum(r for _, r in own) / len(own) * cell)
            if trace:
                own = _largest_part(own)
            else:
                rect = fit_block_rect(own, ang, cell)
                own = rect_cells(own, rect, ang, cell) if rect else set()
            if len(own) < self.SITE_MIN_CELLS:
                skipped["too-thin"] += 1
                log("site", f"skip {site['id']} {site['kind']} "
                    f"{(site['name'] or '—')[:34]}: no drawable ground fits")
                continue
            # An acera exists where there is a street: a building plot pulls back
            # the full sidewalk, an open field only far enough to keep its white
            # lines off the asphalt (the split place_parcels makes).
            #
            # …but a hand-authored parcel is a QUARTER OF A MANZANA and a site
            # can be a 33x40 px chapel, where a 20 px ring on every side leaves
            # nothing at all. So the depth is graded: take the deepest ring the
            # plot can actually afford. A small plot is already deep inside its
            # cuadra — it is the block that fronts the street, not the chapel.
            # The ring the plot can AFFORD, deepest first. The test is whether
            # what survives is still a plot — not how many cells it kept: a
            # rectangle eroded by 5 cells on each of four sides legitimately
            # loses most of a small lot, and judging it by area was cutting the
            # sidewalk off 21 of 26 parcels that had room for a full one.
            #
            # Keep the established percentile fit while it covers only the
            # site's LAND + ACERA frontage. If that BOUNDING rect would cover a
            # hard surface, inscribe a strict-LAND rectangle in the site's own
            # safe cells. Mora y Cañas was the regression — 162x262 px including
            # 540 ROAD cells — while its safe manzana is ~84x250 px.
            # UN SITIO DE ORILLA NO SE APARTA DE UNA ACERA QUE NO EXISTE. La
            # erosión graduada tira el lote hacia adentro para que sus líneas
            # blancas paren en el cordón — pero una cancha sobre la arena no
            # tiene cordón del que apartarse, y a 91x31 px de huella real dos
            # celdas por lado se llevan la mitad. Una sola celda, no cero: a
            # cero el filtro de «esto sigue siendo un lote» la rechaza entera.
            deep = (1 if _decor0.get("shore")
                    else FIELD_ACERA_CELLS
                    if use in (ParcelUse.PARK, ParcelUse.STADIUM, ParcelUse.FUEL)
                    else ACERA_CELLS)
            keep, krect, used = set(), None, 0
            for depth in [d for d in (deep, FIELD_ACERA_CELLS, 1, 0) if d <= deep]:
                used = depth
                keep = _largest_part(erode_cells(own, depth, STREET_CLASSES, raster.at)
                                     if depth else own)
                krect = fit_block_rect(keep, ang, cell) if keep else None
                candidate_poly = rect_poly(krect, ang) if krect else None
                # An AUTHORED rect is exempt from both spill tests. The safety
                # re-fit exists for rectangles nobody looked at; `SITE_DECOR`
                # fractions are somebody's decision about one specific place,
                # applied further down to whatever rect survives here — so a
                # re-fit does not correct them, it compounds with them. The
                # Escuela de Biología Marina came out at 2 324 px² that way, and
                # failed the build's own marine gate.
                authored = trace or bool(decor.get("rect"))
                hard_spill = (poly_surface_count(
                    candidate_poly, raster, HARD_STREET_CLASSES)
                    if candidate_poly and site["kind"] != "fuel" and not authored else 0)
                # THE SIDEWALK IS NOT PARCEL GROUND EITHER. It used to be — an
                # acera-only fit was accepted as "the frontage the site already
                # owns" — and the result was 69 parcels sitting more than a
                # quarter on the acera and a dozen sitting entirely on it, a
                # park's lawn painted over the pavement the walkers are rail-
                # bound to. A few cells of overlap are raster quantisation and
                # are left alone; past PARCEL_ACERA_MAX the plot is re-fitted
                # inside strict LAND, exactly like a hard-surface spill.
                #
                # …but ONLY AS AN IMPROVEMENT. A hard spill that cannot be
                # re-fitted is dropped, because a park over the ROADWAY is worse
                # than no park. A sidewalk one is not: the first cut of this
                # deleted 61 mapped places — four escuelas, four gasolineras,
                # the INA and a dozen iglesias — for the crime of having no land
                # of their own. So when the inscribe finds nothing, an
                # acera-only spill keeps the fit it already had.
                acera_spill = (poly_surface_count(candidate_poly, raster, (CLS_ACERA,))
                               if candidate_poly and not authored else 0)
                acera_only = (not hard_spill
                              and acera_spill > PARCEL_ACERA_MAX * max(1, len(keep)))
                if hard_spill or acera_only:
                    # Stay inside THIS mapped site's source-supported LAND.
                    # Its hard-surface holes are what prevent the maximum
                    # rectangle from bridging into a neighbouring manzana.
                    land_keep = _largest_part({
                        c for c in keep
                        if c not in self.claimed_cells and raster.at(*c) == CLS_LAND
                    })
                    inscribed = fit_inscribed_rect(land_keep, ang, cell)
                    if inscribed:
                        inscribed_keep = cells_in_poly(
                            land_keep, rect_poly(inscribed, ang), cell)
                        iw = (inscribed[1] - inscribed[0]) / cell + 1
                        ih = (inscribed[3] - inscribed[2]) / cell + 1
                        if (len(inscribed_keep) >= self.SITE_MIN_CELLS
                                and min(iw, ih) >= self.SITE_MIN_SIDE):
                            keep, krect = inscribed_keep, inscribed
                            log("site", f"{site['id']} "
                                f"{(site['name'] or '—')[:34]}: rect crossed "
                                f"{hard_spill or acera_spill} "
                                f"{'hard-surface' if hard_spill else 'acera'} "
                                f"cells; using inscribed land rect")
                        elif hard_spill:
                            krect = None
                    elif hard_spill:
                        krect = None
                # Both fitters return physical edge-to-edge extents. Preserve
                # the established SITE_MIN_SIDE convention (+1) so switching
                # fitters does not delete an 8 px-deep mapped chapel.
                side_pad = 1
                if krect and len(keep) >= self.SITE_MIN_CELLS and min(
                        (krect[1] - krect[0]) / cell + side_pad,
                        (krect[3] - krect[2]) / cell + side_pad) >= self.SITE_MIN_SIDE:
                    break
            # A PLOT STILL ON THE PAVEMENT MOVES INTO ITS MANZANA. Everything
            # above works on the site's OWN cells, so a chapel or an escuela the
            # mapper drew where the game's acera now runs has no land to be
            # re-fitted into and keeps its place on the sidewalk. But it is not
            # homeless — it is content of a block, exactly like a building — so
            # the last resort is the same one: put it inside the manzana, at its
            # own size, as near as the block allows to where it really is.
            # A TRACED SITE MOVES WITH ITS SHAPE, it does not get an exemption.
            # `trace` means the real outline is the point of this place — but
            # "the real outline, standing on the sidewalk" is not the objective,
            # it is the bug. So a traced plot is TRANSLATED into its manzana as
            # a rigid shape (see `_slide_cells_into`), and only if no whole-shape
            # placement fits does it fall back to the rect seat.
            #
            # A `cuadra` site is exempt, and this one is not a rationalisation:
            # the seat's whole purpose is "put this plot inside its manzana",
            # and the cuadra path did that already, from the manzana's side. Its
            # cells read as acera only because the block was paved as a sliver.
            # …Y UN SITIO DE ORILLA TAMPOCO SE MUEVE, por la misma razón que un
            # `cuadra`: el asiento existe para meter un lote DENTRO de su
            # manzana, y la orilla no tiene manzana. Un parque del frente
            # marítimo está sobre la acera del paseo porque ESO es lo que hay
            # ahí — moverlo tierra adentro lo saca del sitio que le da nombre.
            # El Parque del Muellero se sentaba así y salía a 252 px de una
            # cinta de 1 336.
            if krect and keep and not cuadra and not _decor0.get("shore"):
                on_acera = sum(1 for c in keep if raster.at(*c) == CLS_ACERA)
                if on_acera > PARCEL_ACERA_MAX * len(keep):
                    moved = (self._slide_cells_into(keep, ang, cell) if trace else None) \
                        or self._seat_site_in_manzana(keep, krect, ang, cell)
                    if moved:
                        # A rigid slide returns no rect — a traced parcel is
                        # emitted from its CELLS — so re-measure the bounding
                        # rect off the moved shape for the size checks and the
                        # half-extents. The polygon still comes from the cells.
                        if moved[1] is None:
                            moved = (moved[0], fit_block_rect(moved[0], ang, cell))
                        # OWNERSHIP MOVES WITH THE PLOT. `own` is the site's
                        # original ground, and everything downstream intersects
                        # the accepted shape with it — so a parcel that moved
                        # and left `own` behind came out with "no ground" and
                        # was skipped. 39 of them, the first time.
                        keep, krect = moved
                        own = set(keep)
                        log("site", f"{site['id']} {(site['name'] or '—')[:34]}: "
                            f"{on_acera}/{len(keep)} cells were sidewalk — seated "
                            f"inside its manzana instead")
            # …and what is left has to be a PLOT, not a ribbon. A 12-cell strip
            # is an 8 px-wide parcel, which draws as a smear rather than as the
            # church or the cancha it is supposed to be.
            side_pad = 1
            kw = (krect[1] - krect[0]) / cell + side_pad if krect else 0
            kh = (krect[3] - krect[2]) / cell + side_pad if krect else 0
            if not krect or len(keep) < self.SITE_MIN_CELLS or min(kw, kh) < self.SITE_MIN_SIDE:
                skipped["too-thin"] += 1
                log("site", f"skip {site['id']} {site['kind']} "
                    f"{(site['name'] or '—')[:34]}: {round(kw)}x{round(kh)} cells left "
                    f"after the acera ring — too thin to draw")
                continue
            if used != deep:
                log("site", f"{site['id']} {(site['name'] or '—')[:34]}: acera ring "
                    f"{used} cells, not {deep} — a {len(own)}-cell plot has no room "
                    f"for it (kept {len(keep)})")
            part = {"id": pid, "use": use,
                    "name": site["name"] or self.SITE_FALLBACK_NAME[site["kind"]],
                    "sport": site.get("sport"),
                    "osmId": int(site["id"]),
                    "hw": round((krect[1] - krect[0]) / 2, 1),
                    "hh": round((krect[3] - krect[2]) / 2, 1)}
            if twin is not None:
                # …and this site IS that landmark. `lm` re-anchors the POI onto
                # the ground and tells the renderer the two are one thing.
                part["lm"] = twin["id"]
                log("site", f"{pid} is the landmark {twin['id']} "
                    f"({twin['name']}) — joined on OSM id {site['id']}")
            # Anything a real place has that OSM does not record — the old round
            # kiosco in the middle of Parque Victoria — is declared by parcel id
            # in content.SITE_DECOR and rides through untouched.
            # `rect`: (u0, u1, v0, v1) as FRACTIONS of the fitted rect — the one
            # override that shapes the parcel rather than decorating it. The
            # mapper's outline is the ground a place is ON, which is not always
            # the ground it USES: the Escuela Delia Urbina is drawn tall over a
            # whole manzana in OSM and is really a wide building on its
            # south-west corner. u runs along the avenidas (east +), v along the
            # calles (south +), so (0, .85, .65, 1) is "the west 85%, the south
            # 35%" — the SW corner, landscape.
            fr = decor.pop("rect", None)
            part.update(decor)
            if fr:
                u0, u1, v0, v1, cu, cv = krect
                du, dv = u1 - u0, v1 - v0
                krect = (u0 + du * fr[0], u0 + du * fr[1],
                         v0 + dv * fr[2], v0 + dv * fr[3], cu, cv)
                part["hw"] = round((krect[1] - krect[0]) / 2, 1)
                part["hh"] = round((krect[3] - krect[2]) / 2, 1)
                log("site", f"{pid}: rect overridden to {fr} -> "
                    f"{part['hw'] * 2:.0f}x{part['hh'] * 2:.0f}px")
            # Ownership, collision and any open-field surface stamp follow the
            # accepted rectangle too. Keeping the pre-fit `own` here would fix
            # the drawing while leaving an invisible drivable/occupied spill.
            if trace:
                accepted_poly = outline_poly(keep, cell)
                parcel_keep = keep
                parcel_own = grow_cells(keep, own, used)
                log("site", f"{site['id']} "
                    f"{(site['name'] or '—')[:34]}: preserving angled cuadra contour "
                    f"({len(accepted_poly) // 2} vertices)")
            else:
                accepted_poly = rect_poly(krect, ang)
                parcel_keep = cells_in_poly(keep, accepted_poly, cell)
                # The polygon is the eroded building/pitch footprint, but
                # ownership includes the local frontage ring. Open fields stamp
                # that ring drivable so the acera is an entrance, not a wall;
                # grow only inside this site's source cells, never across a road.
                parcel_own = grow_cells(
                    cells_in_poly(own, accepted_poly, cell), own, used)
            if cuadra:
                # RECLAIM THE LOT TO REAL GROUND — the move `"reclaim": True`
                # makes for a hand-laid cuadra. These cells read as CLS_ACERA
                # only because `detect_blocks` paved this short wide manzana as
                # a sliver; left that way the Mercado's lot IS pavement, drawn
                # as sidewalk and indistinguishable from the ring the erosion
                # just cut for it. Stamping ONLY the accepted shape is what
                # makes that ring mean something: what stays acera is the
                # market's own frontage, which is where the walkers belong.
                # ACERA *and* the pad's ROAD: the apron `stamp_pad` laid under
                # this site's own POI dot is asphalt inside the lot, and leaving
                # it drivable would let the player cut through the market hall.
                # Safe because no customer or kiosk depends on it — the network
                # gate in `finish.verify` is the check that keeps it that way.
                for (c, r) in parcel_keep:
                    if raster.at(c, r) != CLS_LAND:
                        raster.set(c, r, CLS_LAND)
                log("site", f"{site['id']} {(site['name'] or '—')[:34]}: "
                    f"{len(parcel_keep)} cells reclaimed to cuadra ground, "
                    f"{len(parcel_own) - len(parcel_keep)} left as its acera ring")
            if not parcel_own or len(parcel_keep) < self.SITE_MIN_CELLS:
                skipped["too-thin"] += 1
                log("site", f"skip {site['id']} {site['kind']} "
                    f"{(site['name'] or '—')[:34]}: accepted shape has no ground")
                continue
            cuads = {(c * cell // CUAD, r * cell // CUAD) for (c, r) in parcel_own}
            # Does this site OWN its cuadra, or is it a piece of one? A park
            # that fills the manzana should clear the manzana's houses; a small
            # cancha in a residential block must not. Measured against the
            # blocks the accepted rectangle actually touches.
            touched = [b for b in self.blocks if any(c in cuads for c in b["cells"])]
            block_cells = sum(len(b["cells"]) for b in touched)
            part["green"] = (bool(touched)
                             and len(cuads) >= block_cells * self.SITE_OWNS_BLOCK)
            if self._emit_parcel("osm", part, parcel_own, parcel_keep, ang,
                                 poly=accepted_poly) is None:
                skipped["no-outline"] += 1; continue
            if site["kind"] in self.SITE_BUILT:
                built_cuads |= cuads
            placed += 1
        log("site", f"{placed} OSM sites placed as parcels, "
            f"{sum(skipped.values())} skipped: {dict(sorted(skipped.items()))}")
        return built_cuads

    def place_feature_parcels(self, spec, buildings):
        # `buildings` is an ARGUMENT, not state: the feature parcels are derived
        # from the footprints that exist at THIS point in the build, and the
        # buildings list is rebound (snapped + synthesised) after the estadios
        # are placed.
        lm = next((l for l in self.landmarks if l["id"] == spec["lm"]), None)
        if lm is None:
            log("parcel", f"WARN feature block {spec['lm']} missing"); return
        hw = (lm.get("w") or 200) / 2 + spec.get("pad", 20)
        hh = (lm.get("h") or 160) / 2 + spec.get("pad", 20)
        bx0, by0, bx1, by1 = lm["x"] - hw, lm["y"] - hh, lm["x"] + hw, lm["y"] + hh
        n = 0
        for b in buildings:
            xs, ys = b["pts"][0::2], b["pts"][1::2]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            if not (bx0 <= cx <= bx1 and by0 <= cy <= by1):
                continue
            x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            sw = max(20, int((x1 - x0) * 0.7)); sh = max(12, int((y1 - y0) * 0.55))
            source_id = b.get("osmId")
            suffix = (source_id if spec.get("stable_osm_ids")
                      and source_id is not None else n)
            fallback = (f"{spec['name']} {n + 1}"
                        if spec.get("numbered_fallback", True) else spec["name"])
            name = b.get("name") or fallback
            self.parcels.append({
                "id": f"{spec['id']}_{suffix}",
                "use": spec.get("use", ParcelUse.LOT),
                "name": name, "label": b.get("label", bool(name)),
                "poly": [round(v) for v in b["pts"]],
                "cx": int(cx), "cy": int(cy),
                "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "slot": [int(cx - sw / 2), int(cy - sh / 2), sw, sh],
                "built": True,          # the footprint IS a building; don't paint ground
                # THE LINK, written down. This parcel IS that footprint, and
                # the id is the content-addressed one the editor and the patch
                # already use — an OSM id would name something they cannot find.
                "buildingRef": building_source_id(b),
            })
            if source_id is not None:
                self.parcels[-1]["osmId"] = source_id
            n += 1
        log("parcel", f"{spec['id']}: {n} feature parcels from footprints inside "
              f"{spec['lm']} ({round(bx1-bx0)}x{round(by1-by0)}px)")
