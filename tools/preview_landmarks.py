#!/usr/bin/env python3
"""LOS HITOS QUE SE AUTORAN EN GEO, ANTES DE PAGAR LA RECONSTRUCCIÓN.

    python3 tools/preview_landmarks.py [id …] [--out salida.json]

Coloca con el código DE VERDAD del builder, encima del mundo YA EMITIDO, lo que se autora como lat/lon y el
build sólo proyecta, y escribe lo que saldría. `tools/shot-landmark-preview.mjs` lo inyecta en el juego
corriendo y saca las capturas. No escribe nada en el mundo emitido. Sin ids, toma todo lo que sabe hacer:

* LOS QUIOSCOS `exact` (`content/world/kiosks.json`): la proyección del ancla, y el arranque del jugador con
  `placement.nearest_cell` sobre la calzada. Sólo los que el build NO empuja: un quiosco sin `exact` pasa por
  `nudge_to_land` y por el asiento de frontera ANTES de que la plaza o la cuadra existan en el ráster, y el
  mundo emitido ya no es ese ráster — ahí el preview mentiría, y por eso se niega en vez de adivinar. Que el
  mundo emitido sirve lo comprueba él mismo: recalcula el arranque PUBLICADO desde la posición publicada.
* LAS GRADERÍAS AUTORADAS de un estadio (`content/world/blocks.json → stands.quadsLL`): cada esquina con
  `_project_geo_poly`, la misma función del build. Esas franjas son también la COLISIÓN de la gradería; el
  preview muestra el arte, la pared llega con la reconstrucción.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

from churchill.world.content import BLOCKS, KIOSK_DEFS  # noqa: E402
from churchill.world.service.field import _project_geo_poly  # noqa: E402
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
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(ROOT, "logs", "landmark-preview.json")
    args = [a for a in sys.argv[1:] if not a.startswith("--") and a != out]
    raster = EmittedRaster()
    raster.paved = {int(c) for c in CARRIAGEWAY}
    raster.buf = _ReadBuf(raster)
    geo = raster.manifest["meta"]["geo"]
    project = lambda lat, lon: (geo["ax"] * lon + geo["bx"], geo["ay"] * lat + geo["by"])
    classes = {int(c) for c in CARRIAGEWAY}
    published = {l["id"]: l for l in raster.manifest["landmarks"]}
    recs = []
    # ── los quioscos `exact` ──────────────────────────────────────────────────────────────────────
    for spec in [k for k in KIOSK_DEFS if (k["id"] in args if args else k.get("exact"))]:
        if not spec.get("exact"):
            print(f"[preview] {spec['id']}: sin `exact` el build lo empuja sobre un ráster que el mundo "
                  f"emitido ya no es — no se previsualiza"); return 1
        old = published.get(spec["id"])
        if old and old.get("spawn"):         # ¿el mundo emitido contesta como el ráster del build?
            # Hasta DOS celdas de tolerancia: el ráster del momento del arranque no es idéntico al final (la
            # cuadra del estadio se estampa después, y con ella su anillo), y medido sobre Playitas la diferencia
            # que queda con la máscara es de una celda. Más que eso, el preview no responde por el arranque.
            again = nearest_cell(raster, old["x"], old["y"], classes, SPAWN_REACH)
            off = None if not again else max(abs(again[0] - old["spawn"][0]), abs(again[1] - old["spawn"][1]))
            if off is None or off > 2 * raster.cell + 1:
                print(f"[preview] {spec['id']}: el arranque publicado {old['spawn']} no sale de nuevo ({again}) — "
                      f"el mundo emitido no sirve para este preview"); return 1
        x, y = project(*spec["ll"])
        x, y = round(x + spec.get("dx", 0)), round(y + spec.get("dy", 0))
        tgt = nearest_cell(raster, x, y, classes, SPAWN_REACH)
        rec = {"id": spec["id"], "x": x, "y": y, "ang": spec.get("ang", (old or {}).get("ang", 0))}
        if tgt:
            rec["spawn"] = [round(tgt[0]), round(tgt[1])]
        recs.append(rec)
        moved = f" (antes {old['x']},{old['y']})" if old else ""
        print(f"[preview] quiosco {spec['id']} -> {x},{y}{moved} ang {rec['ang']} arranque {rec.get('spawn')}")
    # ── las graderías autoradas ───────────────────────────────────────────────────────────────────
    for spec in BLOCKS:
        lid = spec.get("lm") or spec.get("id")
        quads = (spec.get("stands") or {}).get("quadsLL")
        if not quads or lid not in published or (args and lid not in args):
            continue
        new = [_project_geo_poly(project, q) for q in quads]
        old = (published[lid].get("stands") or {}).get("quads") or []
        changed = sum(1 for a, b in zip(new, old) if a != b) + abs(len(new) - len(old))
        recs.append({"id": lid, "stands": {"quads": new}})
        print(f"[preview] graderías {lid}: {len(new)} franja(s), {changed} distinta(s) de las publicadas")
    if not recs:
        print("[preview] nada que previsualizar"); return 1
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"landmarks": recs}, open(out, "w"), ensure_ascii=False)
    print(f"[preview] -> {os.path.relpath(out, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
