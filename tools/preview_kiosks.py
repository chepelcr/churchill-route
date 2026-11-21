#!/usr/bin/env python3
"""LOS QUIOSCOS, ANTES DE PAGAR LA RECONSTRUCCIÓN.

    python3 tools/preview_kiosks.py [id …] [--out salida.json]

Coloca los quioscos de `content/world/kiosks.json` con el código DE VERDAD del builder —la proyección
del ancla, y el arranque del jugador con `placement.nearest_cell` sobre la calzada— encima del mundo YA
EMITIDO, y escribe lo que saldría. Sin ids, toma los `exact`. `tools/shot-kiosk-preview.mjs` lo inyecta en el
juego corriendo y saca la captura. No escribe nada en el mundo emitido.

Sólo responde por los quioscos que el build NO empuja: los `exact` (el ancla es la posición final, ver
`poi_stage.py`). Un quiosco sin `exact` pasa por `nudge_to_land` y por el asiento de frontera ANTES de que la
plaza o la cuadra existan en el ráster, y el mundo emitido ya no es ese ráster: ahí el preview mentiría, y
por eso se niega en vez de adivinar.

La comprobación de que el mundo emitido sirve para esto la hace él mismo: recalcula el arranque del
quiosco PUBLICADO desde su posición publicada, y si no da el mismo que el build emitió, avisa y sale.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

from churchill.world.content import KIOSK_DEFS  # noqa: E402
from churchill.world.enums.surface import CARRIAGEWAY  # noqa: E402
from churchill.world.service.placement import nearest_cell  # noqa: E402
from preview_feria import EmittedRaster  # noqa: E402

SPAWN_REACH = 260                           # las celdas que busca el build (`build_stage.py`, el arranque del quiosco)


def _inside(x, y, pts):
    hit = False
    for i in range(0, len(pts), 2):
        xi, yi, xj, yj = pts[i], pts[i + 1], pts[i - 2], pts[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
    return hit


class _ReadBuf:
    """`raster.buf[r * cols + c]` para leer, sobre los tiles emitidos — con los ESTADIOS sin pavimentar.

    El arranque de un quiosco se calcula ANTES de que el estadio estampe su cuadra entera como calzada
    (`W.STADIUMS[*].outline`): en ese momento esa cuadra es tierra. En el mundo emitido ya es calle, y sin esta
    máscara el arranque del quiosco de Playitas sale sobre la plaza en vez de en la calle."""

    def __init__(self, raster):
        self.raster = raster
        self.outlines = [s["footprint"] for s in raster.manifest.get("stadiums", []) if s.get("footprint")]
        self.cache = {}

    def __getitem__(self, i):
        c, r = i % self.raster.cols, i // self.raster.cols
        v = self.raster.at(c, r)
        v = 0 if v is None else v
        if v in self.raster.paved:
            if i not in self.cache:
                x, y = (c + 0.5) * self.raster.cell, (r + 0.5) * self.raster.cell
                self.cache[i] = any(_inside(x, y, o) for o in self.outlines)
            if self.cache[i]:
                return 1                    # CLS_LAND: la cuadra del estadio, antes de estamparse
        return v


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(ROOT, "logs", "kiosk-preview.json")
    args = [a for a in args if a != out]
    raster = EmittedRaster()
    raster.paved = {int(c) for c in CARRIAGEWAY}
    raster.buf = _ReadBuf(raster)
    geo = raster.manifest["meta"]["geo"]
    project = lambda lat, lon: (geo["ax"] * lon + geo["bx"], geo["ay"] * lat + geo["by"])
    classes = {int(c) for c in CARRIAGEWAY}
    published = {l["id"]: l for l in raster.manifest["landmarks"]}
    specs = [k for k in KIOSK_DEFS if (k["id"] in args if args else k.get("exact"))]
    if not specs:
        print("[kiosk-preview] ningún quiosco que previsualizar"); return 1
    recs = []
    for spec in specs:
        if not spec.get("exact"):
            print(f"[kiosk-preview] {spec['id']}: sin `exact` el build lo empuja sobre un ráster que el mundo "
                  f"emitido ya no es — no se previsualiza"); return 1
        old = published.get(spec["id"])
        if old and old.get("spawn"):         # ¿el mundo emitido contesta como el ráster del build?
            # Hasta DOS celdas de tolerancia: el ráster del momento del arranque no es idéntico al final (la
            # cuadra del estadio se estampa después, y con ella su anillo), y medido sobre Playitas la diferencia
            # que queda con la máscara es de una celda. Más que eso, el preview no responde por el arranque.
            again = nearest_cell(raster, old["x"], old["y"], classes, SPAWN_REACH)
            off = None if not again else max(abs(again[0] - old["spawn"][0]), abs(again[1] - old["spawn"][1]))
            if off is None or off > 2 * raster.cell + 1:
                print(f"[kiosk-preview] {spec['id']}: el arranque publicado {old['spawn']} no sale de nuevo ({again}) — "
                      f"el mundo emitido no sirve para este preview"); return 1
            print(f"[kiosk-preview] {spec['id']}: el arranque publicado sale de nuevo a {off:.0f} px — el preview vale")
        x, y = project(*spec["ll"])
        x, y = round(x + spec.get("dx", 0)), round(y + spec.get("dy", 0))
        tgt = nearest_cell(raster, x, y, classes, SPAWN_REACH)
        rec = {**(old or {}), "x": x, "y": y, "ang": spec.get("ang", (old or {}).get("ang", 0))}
        if tgt:
            rec["spawn"] = [round(tgt[0]), round(tgt[1])]
        recs.append(rec)
        moved = f" (antes {old['x']},{old['y']})" if old else ""
        print(f"[kiosk-preview] {spec['id']} -> {x},{y}{moved} ang {rec['ang']} arranque {rec.get('spawn')}")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"landmarks": recs}, open(out, "w"), ensure_ascii=False)
    print(f"[kiosk-preview] -> {os.path.relpath(out, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
