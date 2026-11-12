#!/usr/bin/env python3
"""LA FERIA, ANTES DE PAGAR LA RECONSTRUCCIÓN.

    python3 tools/preview_feria.py [salida.json]

Corre `place_attractions` —el servicio DE VERDAD, no una copia— encima del
mundo YA EMITIDO, y escribe el lote y los juegos que saldrían. Los tiles
publicados son el ráster que el build midió, así que para una función que sólo
lee superficies y calles esto contesta en dos segundos lo que una corrida
completa contesta en cuarenta y seis minutos. No escribe nada en el mundo emitido.

`tools/shot-feria-preview.mjs` toma ese JSON, lo inyecta en el juego corriendo
y saca la captura: el tablado y los juegos pintados por el renderer real sobre
el mundo de hoy. Lo que NO muestra es la física — la superficie manejable sólo
cambia al reconstruir.
"""
import base64
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from churchill.world.config import GRID_CELL, WORLD2D_DIR  # noqa: E402
from churchill.world.service import attraction  # noqa: E402
from churchill.world.service.street import StreetIndex  # noqa: E402

#: el mundo emitido, por la MISMA variable que el builder (`CHURCHILL_GAME_ROOT`
#: lo redirige): esta herramienta no abre un noveno cruce hacia el juego.
WORLD = WORLD2D_DIR


class EmittedRaster:
    """Los cuatro métodos que el servicio le pide al ráster, sobre los tiles."""

    def __init__(self):
        self.manifest = json.load(open(os.path.join(WORLD, "manifest.json")))
        meta = self.manifest["meta"]
        self.tile_px, self.cell = meta["tilePx"], meta["cell"]
        assert self.cell == GRID_CELL, "el mundo emitido y el builder no comparten celda"
        self.tc = self.tile_px // self.cell
        self.cols, self.rows = meta["W"] // self.cell, meta["H"] // self.cell
        self._tiles, self._over = {}, {}
        self.buf = _Buf(self)

    def tile(self, tc, tr):
        key = (tc, tr)
        if key not in self._tiles:
            path = os.path.join(WORLD, "tiles", f"{tc}_{tr}.json")
            if not os.path.exists(path):
                self._tiles[key] = None
            else:
                raw = json.load(open(path))
                rle, grid = base64.b64decode(raw["rle"]), bytearray()
                for i in range(0, len(rle) - 1, 2):
                    grid += bytes([rle[i + 1]]) * rle[i]
                self._tiles[key] = (grid, raw)
        return self._tiles[key]

    def in_bounds(self, c, r):
        return 0 <= c < self.cols and 0 <= r < self.rows

    def cell_of(self, x, y):
        return int(x // self.cell), int(y // self.cell)

    def at(self, c, r):
        if not self.in_bounds(c, r):
            return None
        if (c, r) in self._over:
            return self._over[(c, r)]
        t = self.tile(c // self.tc, r // self.tc)
        return 0 if t is None else t[0][(r % self.tc) * self.tc + (c % self.tc)]

    def features(self, key, x0, y0, x1, y1):
        seen, out = set(), []
        for tc in range(int(x0 // self.tile_px), int(x1 // self.tile_px) + 1):
            for tr in range(int(y0 // self.tile_px), int(y1 // self.tile_px) + 1):
                t = self.tile(tc, tr)
                for f in (t[1].get(key, []) if t else []):
                    k = json.dumps(f.get("pts"))
                    if k not in seen:
                        seen.add(k)
                        out.append(f)
        return out


class _Buf:
    """`raster.buf[r * cols + c] = cls` — el estampado, guardado aparte."""

    def __init__(self, raster):
        self.raster = raster

    def __setitem__(self, i, cls):
        self.raster._over[(i % self.raster.cols, i // self.raster.cols)] = cls


class _Ctx:
    def __init__(self, raster):
        self.raster, self.feria, self.failures = raster, [], []


def main():
    raster = EmittedRaster()
    geo = raster.manifest["meta"]["geo"]
    project = lambda lat, lon: (geo["ax"] * lon + geo["bx"], geo["ay"] * lat + geo["by"])
    unproject = lambda x, y: ((y - geo["by"]) / geo["ay"], (x - geo["bx"]) / geo["ax"])
    old = (raster.manifest.get("feria") or [{}])[0]
    cx, cy = old.get("cx", 26265), old.get("cy", 19930)
    box = (cx - 2500, cy - 2500, cx + 2500, cy + 2500)
    roads = raster.features("roads", *box)
    buildings = raster.features("buildings", *box)
    ctx = _Ctx(raster)
    rides = attraction.place_attractions(ctx, project, buildings, StreetIndex(roads))
    out = {"feria": ctx.feria, "attractions": rides, "failures": ctx.failures,
           "ll": {r["id"]: [round(v, 8) for v in unproject(r["x"], r["y"])] for r in rides}}
    if ctx.feria:
        lot = ctx.feria[0]
        out["ll"]["_centre"] = [round(v, 8) for v in unproject(lot["cx"], lot["cy"])]
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "logs", "feria-preview.json")
    json.dump(out, open(path, "w"), ensure_ascii=False)
    print(f"[preview] {len(ctx.feria)} lote(s), {len(rides)} juegos, "
          f"{len(ctx.failures)} fallo(s) -> {os.path.relpath(path, ROOT)}")
    return 1 if ctx.failures else 0


if __name__ == "__main__":
    sys.exit(main())
