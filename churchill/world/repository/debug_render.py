"""Debug renders — the two files a human looks at to review a world build.

`debug_map.png` is the surface grid as flat colour (downsampled: the planar grid
is 12705x7965 cells, and a per-pixel pass would take minutes for a picture you
only squint at). `debug_features.svg` is the vector side — land contours, water,
buildings, streets by class, district boundaries, landmark pins.

Neither ships. They are the review surface: when a placement moves, you open the
PNG before you open the game. The PNG writer is stdlib zlib+struct — this
project takes no image dependency for a debug artefact.
"""
import struct
import zlib

from ..config import (
    CLS_ACERA, CLS_BEACH, CLS_BOULEVARD, CLS_BRIDGE, CLS_LAND, CLS_PASEO,
    CLS_BARRO, CLS_GRAVEL, CLS_ROAD, CLS_WATER,
    GRID_CELL,
)
from ..logging import log
from ..util.geometry import pairs
from ..util.raster import Raster


def write_png(path, w, h, get_rgb, stride=1):
    """Rasterise get_rgb(x,y) to a PNG. `stride` downsamples (samples every
    `stride`-th cell on both axes) so a huge planar grid still yields a small,
    fast eyeball render instead of a multi-minute per-pixel pass."""
    xs = range(0, w, stride)
    ys = range(0, h, stride)
    ow, oh = len(xs), len(ys)
    rows = []
    for y in ys:
        row = bytearray()
        for x in xs:
            row.extend(get_rgb(x, y))
        rows.append(bytes(row))
    w, h = ow, oh
    raw = b"".join(b"\x00" + r for r in rows)
    comp = zlib.compress(raw, 6)

    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))


def render_debug(*, raster, buildings, landmarks, customers, roads,
                 land_contours, waters, bounds_x, png_path, svg_path):
    """Write both debug artefacts for a finished world."""
    GRID_COLS, GRID_ROWS = raster.cols, raster.rows
    grid = raster.buf
    CANVAS_W, CANVAS_H = raster.cols * raster.cell, raster.rows * raster.cell
    DEBUG_PNG, DEBUG_SVG = png_path, svg_path
    pal = {CLS_WATER: (42, 127, 168), CLS_LAND: (232, 213, 160), CLS_BEACH: (244, 215, 122),
           CLS_ROAD: (58, 53, 64), CLS_PASEO: (240, 138, 93), CLS_BRIDGE: (140, 140, 140),
           CLS_ACERA: (206, 199, 178), CLS_BOULEVARD: (216, 212, 200),
           CLS_BARRO: (156, 122, 79), CLS_GRAVEL: (169, 157, 139)}
    overlay = Raster(GRID_COLS, GRID_ROWS, GRID_CELL)
    bldg_overlay = overlay.buf
    for b in buildings:
        overlay.fill_poly(pairs(b["pts"]), 1)
    marks = {}
    for lm in landmarks:
        marks[(int(lm["x"] / GRID_CELL), int(lm["y"] / GRID_CELL))] = (255, 0, 0)
    for cu in customers:
        marks[(int(cu["x"] / GRID_CELL), int(cu["y"] / GRID_CELL))] = (255, 0, 255)
    ticks = set()
    for bx in bounds_x:
        ticks.add(int(bx / GRID_CELL))

    def rgb(x, y):
        if (x, y) in marks:
            return marks[(x, y)]
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if (x + dx, y + dy) in marks:
                    return marks[(x + dx, y + dy)]
        if x in ticks and y % 4 < 2:
            return (0, 0, 0)
        if bldg_overlay[y * GRID_COLS + x]:
            return (156, 102, 68)
        return pal[grid[y * GRID_COLS + x]]

    # downsample the eyeball PNG so a huge planar grid renders in seconds
    dbg_stride = max(1, max(GRID_COLS, GRID_ROWS) // 2500)
    write_png(DEBUG_PNG, GRID_COLS, GRID_ROWS, rgb, stride=dbg_stride)
    log("debug", f"{DEBUG_PNG} (stride {dbg_stride})")

    # svg: vector features
    cls_color = {"trunk": "#d33", "trunk_link": "#d66", "primary": "#e80",
                 "primary_link": "#e80", "secondary": "#ca0", "tertiary": "#aa0",
                 "tertiary_link": "#aa0", "residential": "#666", "unclassified": "#666",
                 "living_street": "#888", "service": "#bbb", "pedestrian": "#3a3",
                 "paseo": "#f08a5d", "bridge": "#a0f"}
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS_W} {CANVAS_H}" '
             f'style="background:#2a7fa8">']
    for lp in land_contours:
        d = "M" + " L".join(f"{lp[i]},{lp[i+1]}" for i in range(0, len(lp), 2)) + " Z"
        parts.append(f'<path d="{d}" fill="#e8d5a0" stroke="#8a6" stroke-width="3"/>')
    for wp in waters:
        d = "M" + " L".join(f"{wp[i]},{wp[i+1]}" for i in range(0, len(wp), 2)) + " Z"
        parts.append(f'<path d="{d}" fill="#2a7fa8" opacity="0.9"/>')
    for b in buildings:
        p = b["pts"]
        d = "M" + " L".join(f"{p[i]},{p[i+1]}" for i in range(0, len(p), 2)) + " Z"
        parts.append(f'<path d="{d}" fill="#997" opacity="0.7"/>')
    for r in roads:
        p = r["pts"]
        d = "M" + " L".join(f"{p[i]},{p[i+1]}" for i in range(0, len(p), 2))
        parts.append(f'<path d="{d}" fill="none" stroke="{cls_color[r["cls"]]}" '
                     f'stroke-width="{r["w"]}" stroke-linecap="round" opacity="0.85"/>')
    for bx in bounds_x:
        parts.append(f'<line x1="{bx}" y1="0" x2="{bx}" y2="{CANVAS_H}" stroke="#000" stroke-width="3" stroke-dasharray="8 10"/>')
    for lm in landmarks:
        parts.append(f'<circle cx="{lm["x"]}" cy="{lm["y"]}" r="12" fill="red"/>'
                     f'<text x="{lm["x"]+14}" y="{lm["y"]}" font-size="26">{lm["id"]}</text>')
    parts.append("</svg>")
    with open(DEBUG_SVG, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    log("debug", f"{DEBUG_SVG}")
