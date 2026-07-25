#!/usr/bin/env python3
"""Generate the sponsored-lotes catalog (admin artifact, NOT shipped).

Enumerates candidate commercial parcels in the PLAYABLE (MVP) area from the
emitted world: every building footprint big enough to read as a store, plus its
world position, real lat/lon and district. A sponsor picks a lote from this
catalog; the claim goes into content.json with their branding and the app
renders it with no release needed.

Stable IDs: a hash of the rounded footprint centroid, so they survive a rebuild
as long as the geometry does not move.

Usage: python3 tools/gen_lotes.py   ->  docs/lotes_catalog.json
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from churchill.world.config import WORLD2D_DIR                    # noqa: E402
from churchill.world.dto import Lote, LoteCatalog                 # noqa: E402
from churchill.world.logging import die, log                      # noqa: E402
from churchill.world.repository import JsonWorldRepository        # noqa: E402
from churchill.world.service.projection import world_to_geo       # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_SIDE = 24          # px — smaller footprints don't read as a store

repo = JsonWorldRepository(WORLD2D_DIR)
manifest = repo.read_manifest()
if not manifest.meta.geo:
    die("lotes", "manifest has no meta.geo — rebuild the world first")
geo = manifest.meta.geo.model_dump()

# playable area = west of the MVP wall (start of cocal)
COCAL_X0 = next(d.x0 for d in manifest.districts if d.id == "cocal")
# Peninsula districts only. The inland barrios carry a real bbox, so an x-band
# lookup would happily place a lote in one from the other side of the estuary.
PEN = [d for d in manifest.districts if d.y1 - d.y0 >= manifest.meta.H - 1]


def district_at(x):
    return next((d.id for d in PEN if d.x0 <= x <= d.x1), None)


def lote_id(cx, cy):
    h = hashlib.sha1(f"{round(cx)}:{round(cy)}".encode()).hexdigest()[:8]
    return f"L-{h}"


lotes, seen = [], set()
for tc in range(manifest.meta.tileCols):
    for tr in range(manifest.meta.tileRows):
        for b in repo.read_tile(tc, tr).get("buildings", []):
            xs, ys = b["pts"][0::2], b["pts"][1::2]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            w, h = x1 - x0, y1 - y0
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if cx >= COCAL_X0 or w < MIN_SIDE or h < MIN_SIDE:
                continue
            lid = lote_id(cx, cy)
            if lid in seen:      # border buildings are duplicated across tiles
                continue
            seen.add(lid)
            lat, lon = world_to_geo(geo, cx, cy)
            lotes.append(Lote(id=lid, x=round(cx), y=round(cy), lat=lat, lon=lon,
                              w=round(w), h=round(h), district=district_at(cx)))

lotes.sort(key=lambda l: (l.district or "", l.x))
catalog = LoteCatalog(generated_from="src/world2d tiles", playable_max_x=COCAL_X0,
                      count=len(lotes), lotes=lotes)
out_path = os.path.join(ROOT, "docs", "lotes_catalog.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(catalog.model_dump(mode="json"), f, indent=1)

by_d = {}
for l in lotes:
    by_d[l.district] = by_d.get(l.district, 0) + 1
log("lotes", f"{len(lotes)} candidate parcels in the playable area "
             f"-> docs/lotes_catalog.json")
for d, n in sorted(by_d.items(), key=lambda kv: -kv[1]):
    log("lotes", f"  {d}: {n}")
