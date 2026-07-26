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

from ..config import (
    ACERA_CELLS, CLS_ACERA, CLS_BEACH, CLS_BOULEVARD, CLS_LAND, CLS_ROAD, CUAD,
    FIELD_ACERA_CELLS, GRID_CELL, STREET_CLASSES,
)
from ..enums import GreenType, ParcelUse
from ..logging import log
from ..util.geometry import principal_axis
from ..util.raster import erode_cells
from .block import cuadra_cells, outline_poly
from .street import half_plane


def _cell_frame(cells):
    """Centre + principal axis of a cell set. The CENTRE is what parcels
    want; the axis is only their FALLBACK for when a bounding street's
    direction will not resolve (see _street_dir). It is not trustworthy on
    its own: the fit is degenerate on a square-ish block (sxx≈syy snaps it
    to ±45°, the contrary diagonal), and it is orthogonal by construction,
    which the cuadrícula is not."""
    mx, my, ang = principal_axis(list(cells))
    return mx, my, math.cos(ang), math.sin(ang)

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
                 stadiums, parcels, occ):
        self.raster = raster
        self.streets = streets
        self.landmarks = landmarks
        self.blocks = blocks
        self.greens = greens
        self.plazas = plazas
        self.stadiums = stadiums
        self.parcels = parcels
        self.occ = occ

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
        inner_cells = (outer_cells if spec.get("aceras") is False
                       else erode_cells(outer_cells, FIELD_ACERA_CELLS, STREET_CLASSES, self.raster.at)) if outer_cells else set()
        outline = outline_poly(outer_cells, GRID_CELL) if outer_cells else None
        footprint = outline_poly(inner_cells, GRID_CELL) if inner_cells else None
        if not outline or not footprint:
            log("estadio", f"WARN {spec['id']} no cuadra in rect "
                  f"({round(xa)},{round(ylo)})-({round(xb)},{round(yhi)})"); return
        g = {"pts": footprint, "type": GreenType.STADIUM}
        # no buildings on the block: occ (OSM) + green-flag it (synth). Use the
        # cuad cells the traced cuadra actually covers, not the raw street rect.
        cuad_cells = {(c * GRID_CELL // CUAD, r * GRID_CELL // CUAD) for (c, r) in outer_cells}
        self.occ.update(cuad_cells)
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
        self.stadiums.append({"x0": bx0, "y0": by0, "x1": bx1, "y1": by1,
                         "cx": cxpx, "cy": cypx, "footprint": footprint,
                         "outline": outline})
        # …and as a sponsorable space. A stadium is a WHOLE cuadra, not a part
        # of one, so `whole` tells the renderer its ground is already painted
        # (by paintStadiumCuadras) and only the slot art belongs to the parcel.
        # The slot is centred — the middle of the pitch is where a club crest
        # goes.
        sw = max(40, (bx1 - bx0) // 3); sh = max(28, (by1 - by0) // 3)
        self.parcels.append({"id": f"{spec['id']}_field", "name": lm.get("name") or spec["id"],
                        "use": ParcelUse.STADIUM, "whole": True, "poly": footprint,
                        "cx": cxpx, "cy": cypx,
                        "x0": bx0, "y0": by0, "x1": bx1, "y1": by1,
                        "slot": [int(cxpx - sw // 2), int(cypx - sh // 2), int(sw), int(sh)]})
        log("parcel", f"{spec['id']}_field (stadium, whole cuadra) "
              f"slot[{int(cxpx - sw // 2)}, {int(cypx - sh // 2)}, {int(sw)}, {int(sh)}]")
        ox = outline[0::2]; oy = outline[1::2]
        log("estadio", f"{spec['id']} rect ({round(xa)},{round(ylo)})-({round(xb)},{round(yhi)}) "
              f"-> cuadra ({min(ox)},{min(oy)})-({max(ox)},{max(oy)})px {len(outline)//2}v, "
              f"pitch ({bx0},{by0})-({bx1},{by1})px {len(footprint)//2}v, "
              f"{len(outer_cells)} cells drivable")

    def _emit_parcel(self, spec_id, part, cells, keep_cells, ang=0.0):
        poly = outline_poly(keep_cells, GRID_CELL) if keep_cells else None
        if not poly:
            log("parcel", f"WARN {part['id']} nothing left after erosion"); return None
        px = poly[0::2]; py = poly[1::2]
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
        # DECORATION the renderer draws ON this parcel, declared by the part and
        # passed through untouched (`river`, `statue`, `bus`…). The world says
        # WHICH parcel has a river; the client owns what a river looks like.
        for k in ("river", "statue"):
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
        if part.get("lm"):
            lm = next((l for l in self.landmarks if l["id"] == part["lm"]), None)
            if lm is None:
                log("parcel", f"WARN {part['id']} landmark {part['lm']} missing")
            else:
                lm["x"], lm["y"] = rec["cx"], rec["cy"]
                log("parcel", f"{part['id']} re-anchored {part['lm']} to ({rec['cx']},{rec['cy']})")
        self.parcels.append(rec)
        cuads = {(c * GRID_CELL // CUAD, r * GRID_CELL // CUAD) for (c, r) in cells}
        self.occ.update(cuads)                        # no buildings inside a parcel
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

    def place_parcels(self, spec):
        ref = spec["at"]
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
        uv = {c: ((c[0] - mx) * ncol[0] + (c[1] - my) * ncol[1],
                  (c[0] - mx) * nrow[0] + (c[1] - my) * nrow[1])
              for c in outer}
        cw = spec.get("cols", [1]); rw = spec.get("rows", [1])
        ue = _bands([v[0] for v in uv.values()], cw)
        ve = _bands([v[1] for v in uv.values()], rw)
        nominal = len(outer) / (len(cw) * len(rw))
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
            span = (c1 - c0 + 1) * (r1 - r0 + 1)
            # A part that came out mostly EMPTY means the split does not suit
            # this block (it is a ribbon, not a rectangle) — fail loudly in the
            # log instead of quietly emitting a sliver out in the street.
            if len(own) < nominal * span * 0.35:
                log("parcel", f"WARN {part['id']} only {len(cells)} cells vs "
                      f"{nominal * span:.0f} nominal — split does not suit this block"); continue
            self._emit_parcel(spec["id"], part, own, cells, ang)
            claimed |= own
        # The CUAD cells the block's parts took. A caller that is laying a whole
        # cuadra out by hand uses this to clear the OSM footprints standing on
        # it: named buildings are kept at their real outline unconditionally, so
        # without this the parroquia's capilla ends up in the middle of a park.
        return {(c * GRID_CELL // CUAD, r * GRID_CELL // CUAD) for (c, r) in claimed}

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
            self.parcels.append({
                "id": f"{spec['id']}_{n}", "use": spec.get("use", ParcelUse.LOT),
                "name": b.get("name") or f"{spec['name']} {n + 1}",
                "poly": [round(v) for v in b["pts"]],
                "cx": int(cx), "cy": int(cy),
                "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "slot": [int(cx - sw / 2), int(cy - sh / 2), sw, sh],
                "built": True,          # the footprint IS a building; don't paint ground
            })
            n += 1
        log("parcel", f"{spec['id']}: {n} feature parcels from footprints inside "
              f"{spec['lm']} ({round(bx1-bx0)}x{round(by1-by0)}px)")

