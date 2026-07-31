"""The emit stage: the built world -> the files the game streams.

Tiling is the whole point. The planar grid is ~101M cells and cannot be held
whole on a phone, so the world ships as a manifest (small, eager: size, tiling,
districts, POIs, backdrop polygons) plus one file per 2000x2000 px tile holding
an RLE surface slab and the vector features overlapping it.

A feature whose bbox straddles a border is written into EVERY tile it overlaps
— the accessor culls by tile, and duplicating a long road into three tiles is
cheaper than a client-side join. Anything COUNTING features across tiles has to
de-duplicate by geometry.

Backdrop polygons (coast, water, beach) stay global in the manifest: there are
few of them, and the per-cell RLE is the surface source of truth for physics and
the rasterised render anyway.
"""
from collections import defaultdict

from ..config import CLASS_NAMES, TILE_CELLS, TILE_PX
from ..logging import log
from ..util.raster import rle_encode


def emit_world2d(raster, repo, *, meta, districts, roads, rails, buildings, trees, palms,
                 mangroves, medians, plazas, islands, beaches, waters, land_polys,
                 landmarks, customers, stages, bridge, estuary, pier, hills,
                 stadiums=None, kiosk_paths=None, faro_pier=None, greens=None,
                 balneario=None, pois=None, parcels=None, ferries=None, signs=None,
                 editor_features=None, editor_patch=None, cuadras=None,
                 surface_styles=None, editor_ui=None, editor_content=None):
    """Chunked planar emit (Milestone D): tile the world into
    src/world2d/tiles/<tc>_<tr>.json (each = an RLE surface slab + the vector
    features overlapping that tile) plus a small src/world2d/manifest.json (world
    size, tiling, districts, POIs, backdrop polys). Replaces the single
    src/world/data.js so the full-OSM world stays streamable instead of one huge
    payload. A feature spanning a tile border is written into every tile its
    bbox overlaps (the accessor culls/dedups by tile) — long roads are the only
    notable duplication, still cheap. Backdrop polygons (coast/water/beach) stay
    global in the manifest (few, and the per-cell RLE is the surface source of
    truth for physics/rasterised render)."""
    repo.clear_tiles()

    cols, rows = raster.cols, raster.rows
    tcols = (cols + TILE_CELLS - 1) // TILE_CELLS
    trows = (rows + TILE_CELLS - 1) // TILE_CELLS
    buckets = defaultdict(lambda: defaultdict(list))    # (tc,tr) -> key -> [feat]

    def tiles_for_bbox(x0, y0, x1, y1):
        c0 = max(0, int(x0 // TILE_PX)); c1 = min(tcols - 1, int(x1 // TILE_PX))
        r0 = max(0, int(y0 // TILE_PX)); r1 = min(trows - 1, int(y1 // TILE_PX))
        return [(tc, tr) for tr in range(r0, r1 + 1) for tc in range(c0, c1 + 1)]

    def add_flat(key, feats):                # features with pts=[x,y,x,y,...]
        for f in feats:
            p = f.get("pts") or []
            if len(p) < 2:
                continue
            xs, ys = p[0::2], p[1::2]
            for t in tiles_for_bbox(min(xs), min(ys), max(xs), max(ys)):
                buckets[t][key].append(f)

    def add_point(key, feats):               # features with {x,y,(r)}
        for f in feats:
            rr = f.get("r", 0)
            for t in tiles_for_bbox(f["x"] - rr, f["y"] - rr, f["x"] + rr, f["y"] + rr):
                buckets[t][key].append(f)

    add_flat("roads", roads)
    add_flat("rails", rails)
    add_flat("medians", medians)
    add_flat("buildings", buildings)
    add_point("trees", trees)
    add_point("palms", palms)
    add_point("mangroves", mangroves)
    # plazas ([x,y,w,h,type] rects) stay global in the manifest: they are ground
    # colour, painted with the land base so parks are green before their tile
    # streams in. islands are {kind, pts:[[x,y],...]} pairs
    for isl in islands:
        pts = isl["pts"]
        flat = [v for xy in pts for v in xy] if pts and isinstance(pts[0], (list, tuple)) else pts
        xs, ys = flat[0::2], flat[1::2]
        if not xs:
            continue
        for t in tiles_for_bbox(min(xs), min(ys), max(xs), max(ys)):
            buckets[t]["islands"].append({"kind": isl["kind"], "pts": flat})

    def tile_slab(tc, tr):
        c0, r0 = tc * TILE_CELLS, tr * TILE_CELLS
        cw = min(TILE_CELLS, cols - c0)
        ch = min(TILE_CELLS, rows - r0)
        sub = bytearray(cw * ch)
        buf = raster.buf
        for rr in range(ch):
            s = (r0 + rr) * cols + c0
            sub[rr * cw:(rr + 1) * cw] = buf[s:s + cw]
        return cw, ch, rle_encode(sub)

    n_tiles = 0
    for tr in range(trows):
        for tc in range(tcols):
            cw, ch, rle = tile_slab(tc, tr)
            b = buckets.get((tc, tr), {})
            tile = {"tc": tc, "tr": tr, "x": tc * TILE_PX, "y": tr * TILE_PX,
                    "cols": cw, "rows": ch, "rle": rle}
            for key, feats in b.items():
                tile[key] = feats
            repo.write_tile(tc, tr, tile)
            n_tiles += 1

    # districts as 2-D polys — planar arranges the barrios west→east along the
    # spit, so the x-band edges become full-height rectangles (a working
    # point-in-poly approximation; true 2-D rings are a later refinement).
    dist_out = []
    for d in districts:
        x0, x1 = d["x0"], d["x1"]
        # peninsula districts are full-height x-bands; inland barrios carry an
        # explicit y0/y1 so they emit as a real 2-D bbox region (not full height).
        y0 = d.get("y0", 0)
        y1 = d.get("y1", rows * raster.cell)
        dist_out.append({"id": d["id"], "name": d["name"], "short": d.get("short"),
                         "tone": d["tone"], "x0": x0, "x1": x1, "y0": y0, "y1": y1,
                         "poly": [x0, y0, x1, y0, x1, y1, x0, y1]})

    manifest = {
        "meta": {**meta, "tilePx": TILE_PX, "tileCells": TILE_CELLS,
                 "tileCols": tcols, "tileRows": trows},
        "grid": {"cols": cols, "rows": rows, "classes": CLASS_NAMES},
        "districts": dist_out,
        "landmarks": landmarks, "customers": customers, "stages": stages,
        "bridge": bridge, "estuary": estuary, "pier": pier, "hills": hills,
        "beaches": beaches, "waters": waters, "landPolys": land_polys,
        "plazas": plazas,
        "greens": greens or [],
        "stadiums": stadiums or [],
        "balneario": balneario,
        "kioskPaths": kiosk_paths or [],
        "faroPier": faro_pier,
        # every named real-world POI (name + category + world px), for the
        # debug overlay that validates the map against real Puntarenas
        "pois": pois or [],
        # named cuadra parts: {id,name,use,poly,cx,cy,slot} — `slot` is the rect
        # a remote sponsor `lote` can claim, so its art has a real footprint
        "parcels": parcels or [],
        "signs": signs or [],
        # the two ferry berths and the truncated real routes they sail — the
        # Easter egg: park on one, wait, and it takes you out over the gulf
        "ferries": ferries or [],
        "cuadras": cuadras or [],
        "surfaceStyles": surface_styles or [],
    }
    if editor_patch:
        manifest["editorPatch"] = editor_patch
        manifest["editorFeatures"] = editor_features or []
        manifest["editorUI"] = editor_ui or {}
        manifest["editorContent"] = editor_content or {}
    repo.write_manifest(manifest)

    total = repo.total_bytes()
    log("emit", f"src/world2d/ — {tcols}x{trows}={n_tiles} tiles + manifest, "
          f"{total/1024:.0f} KB total")
