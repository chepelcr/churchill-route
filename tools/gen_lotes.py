#!/usr/bin/env python3
"""Generate the sponsored-lotes catalog (admin artifact, NOT shipped).

Enumerates candidate commercial parcels in the PLAYABLE (MVP) area from the
emitted world tiles: every building footprint big enough to read as a store,
plus its world position, real lat/lon (via the manifest geo affine) and
district. Sponsors pick a lote from this catalog; the chosen entry goes into
content.json (`lotes: [...]`) with their branding — the app renders it with
no release needed.

Stable IDs: hash of the rounded footprint centroid — they survive rebuilds
as long as the geometry doesn't move.

Usage: python3 tools/gen_lotes.py   ->  docs/lotes_catalog.json
"""
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAN = json.loads((ROOT / "src/world2d/manifest.json").read_text())

META = MAN["meta"]
GEO = META.get("geo")
if not GEO:
    raise SystemExit("manifest has no meta.geo — rebuild the planar world first")

# playable area = west of the MVP wall (start of cocal)
COCAL_X0 = next(d["x0"] for d in MAN["districts"] if d["id"] == "cocal")
MIN_SIDE = 24          # px — smaller footprints don't read as a store
PEN_DISTRICTS = [d for d in MAN["districts"] if "y0" not in d or d["y1"] - d["y0"] >= META["H"] - 1]

def district_at(x):
    for d in PEN_DISTRICTS:
        if d["x0"] <= x <= d["x1"]:
            return d["id"]
    return None

def to_geo(x, y):
    lon = (x - GEO["bx"]) / GEO["ax"]
    lat = (y - GEO["by"]) / GEO["ay"]
    return round(lat, 6), round(lon, 6)

def lote_id(cx, cy):
    h = hashlib.sha1(f"{round(cx)}:{round(cy)}".encode()).hexdigest()[:8]
    return f"L-{h}"

lotes = []
seen = set()
for tile_path in sorted((ROOT / "src/world2d/tiles").glob("*.json")):
    t = json.loads(tile_path.read_text())
    for b in t.get("buildings", []):
        xs = b["pts"][0::2]; ys = b["pts"][1::2]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        w, h = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if cx >= COCAL_X0 or w < MIN_SIDE or h < MIN_SIDE:
            continue
        lid = lote_id(cx, cy)
        if lid in seen:  # border buildings are duplicated across tiles
            continue
        seen.add(lid)
        lat, lon = to_geo(cx, cy)
        lotes.append({"id": lid, "x": round(cx), "y": round(cy),
                      "lat": lat, "lon": lon, "w": round(w), "h": round(h),
                      "district": district_at(cx)})

lotes.sort(key=lambda l: (l["district"] or "", l["x"]))
out = {"generated_from": "src/world2d tiles", "playable_max_x": COCAL_X0,
       "count": len(lotes), "lotes": lotes}
(ROOT / "docs/lotes_catalog.json").write_text(json.dumps(out, indent=1))

by_d = {}
for l in lotes:
    by_d[l["district"]] = by_d.get(l["district"], 0) + 1
print(f"[lotes] {len(lotes)} candidate parcels in the playable area -> docs/lotes_catalog.json")
for d, n in sorted(by_d.items(), key=lambda kv: -kv[1]):
    print(f"  {d}: {n}")
