#!/usr/bin/env python3
"""LA PUNTA, ANTES DE PAGAR LA RECONSTRUCCIÓN.

    python3 tools/preview_punta.py [salida.png]

Lee `docs/punta-satellite-mockup.json` —el trazo de El Faro y el Balneario
sobre la imagen satelital, ya en lat/lon— y lo pinta encima del mundo YA
EMITIDO, a la par de cómo se ve hoy. Izquierda: el ráster de hoy (la cuadra
entera es agua). Derecha: la propuesta, con el Muelle del Faro y su kiosco
donde están. No escribe nada en `src/world2d/` y no decide física: es la
lámina para aprobar el trazo antes de autorarlo en `content/world/blocks.json`.
"""
import base64
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLD = os.path.join(ROOT, "src", "world2d")
X0, Y0, X1, Y1 = 23350, 18850, 24500, 19800      # ventana de La Punta, px de mundo
Z = 1                                           # px de lámina por px de mundo


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def main(out):
    man = json.load(open(os.path.join(WORLD, "manifest.json")))
    geo, meta = man["meta"]["geo"], man["meta"]
    doc = json.load(open(os.path.join(ROOT, "docs", "punta-satellite-mockup.json")))
    surf = json.load(open(os.path.join(ROOT, "src", "assets", "surfaces.json")))["surfaces"]
    voc = json.load(open(os.path.join(ROOT, "src", "assets", "vocabulary.generated.json")))
    names = voc["surface"]["classes"]

    def W(ll):                                   # [lat, lon] -> px de lámina
        return ((geo["ax"] * ll[1] + geo["bx"] - X0) * Z,
                (geo["ay"] * ll[0] + geo["by"] - Y0) * Z)

    def P(x, y):
        return ((x - X0) * Z, (y - Y0) * Z)

    tp, cell = meta["tilePx"], meta["cell"]
    base = Image.new("RGB", ((X1 - X0) * Z, (Y1 - Y0) * Z), rgb(surf["water"]["day"]))
    bd = ImageDraw.Draw(base)
    tiles = []
    for tc in range(X0 // tp, X1 // tp + 1):
        for tr in range(Y0 // tp, Y1 // tp + 1):
            path = os.path.join(WORLD, "tiles", f"{tc}_{tr}.json")
            if not os.path.exists(path):
                continue
            raw = json.load(open(path))
            tiles.append(raw)
            rle, grid = base64.b64decode(raw["rle"]), bytearray()
            for i in range(0, len(rle) - 1, 2):
                grid += bytes([rle[i + 1]]) * rle[i]
            n = raw["cols"]
            for r in range(raw["rows"]):
                y = raw["y"] + r * cell
                if not Y0 - cell < y < Y1:
                    continue
                for c in range(n):
                    x = raw["x"] + c * cell
                    if X0 - cell < x < X1:
                        col = rgb(surf[names[grid[r * n + c]]]["day"])
                        bd.rectangle([*P(x, y), *P(x + cell, y + cell)], fill=col)

    def furniture(im, buildings=True):
        d = ImageDraw.Draw(im)
        if buildings:
            for t in tiles:
                for b in t["buildings"]:
                    pts = [P(b["pts"][i], b["pts"][i + 1]) for i in range(0, len(b["pts"]), 2)]
                    d.polygon(pts, fill=rgb(b.get("roof") or b["color"]), outline=(40, 40, 40))
        for pier in man["piers"]:
            pts = [P(pier["pts"][i], pier["pts"][i + 1]) for i in range(0, len(pier["pts"]), 2)]
            if pier["id"] == "muelle_faro":
                d.line(pts, fill=(150, 108, 66), width=int(pier["w"] * Z))
        for lm in man["landmarks"]:
            if lm["id"] == "kios_faro":
                x, y = P(lm["x"], lm["y"])
                d.rectangle([x - 14, y - 14, x + 14, y + 14], fill=(232, 78, 96), outline=(255, 255, 255), width=3)
                d.text((x + 18, y - 6), "kiosco Churchill La Punta (se queda)", fill=(255, 255, 255))
            if lm["id"] == "faro":
                x, y = P(lm["x"], lm["y"])
                d.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(255, 0, 255), width=2)

    today = base.copy()
    furniture(today)
    ImageDraw.Draw(today).text((12, 10), "HOY — la cuadra del Balneario es agua", fill=(255, 255, 255))

    prop = base.copy()
    d = ImageDraw.Draw(prop)
    grounds = next(s for s in doc["shapes"] if s["id"] == "balneario_grounds")
    order = {"ground": 0, "water": 1, "prop": 2, "building": 3, "tree": 4}
    centre = W(next(s for s in doc["shapes"] if s["id"] == "pool_main")["polygonLL"][20])
    ppm = meta["pxPerMeter"] * Z
    # el terreno primero: tapa el agua y los lotes sintéticos de hoy
    for sh in sorted((s for s in doc["shapes"] if "polygonLL" in s), key=lambda s: order[s["kind"]]):
        pts = [W(p) for p in sh["polygonLL"]]
        if sh["kind"] == "building":
            d.polygon([(x + 4, y + 5) for x, y in pts], fill=(60, 55, 50))
        d.polygon(pts, fill=rgb(sh.get("roof") or sh["color"]),
                  outline=(250, 250, 245) if sh["kind"] == "water" else (70, 62, 52))
        pt = sh.get("pattern") or {}
        ink = rgb(pt.get("color", "#000000"))
        for cll in pt.get("centersLL", []):      # abanicos: media luna con el arco al mar
            x, y = W(cll)
            r = pt["rM"] * ppm
            a = math.degrees(math.atan2(y - centre[1], x - centre[0]))
            d.pieslice([x - r, y - r, x + r, y + r], a - 90, a + 90, fill=ink)
        for cm in pt.get("commas", []):          # comas: cabeza redonda y cola al sur
            x, y = W(cm["ll"])
            r = cm["rM"] * ppm
            d.ellipse([x - r, y - r, x + r, y + r], fill=ink)
            t = cm["turn"]
            d.polygon([(x - r * t, y), (x + r * t * .2, y + r * .9), (x + r * t * 1.5, y + r * 2.1),
                       (x + r * t * .9, y + r * .6), (x + r * t, y)], fill=ink)
        if "rotonda" in pt:
            x, y = W(pt["rotonda"]["centerLL"])
            r = pt["rotonda"]["rM"] * ppm
            d.ellipse([x - r, y - r, x + r, y + r], fill=rgb(sh["color"]), outline=ink, width=6)
    for sh in doc["shapes"]:
        if "polylineLL" in sh:
            d.line([W(p) for p in sh["polylineLL"]], fill=rgb(sh["color"]), width=int(sh["widthM"] * ppm), joint="curve")
    for ln in doc["lines"]:
        d.line([W(p) for p in ln["polylineLL"]], fill=(235, 232, 222), width=4)
    for p in doc["points"]:
        x, y = W(p["ll"])
        r = p.get("rM", 1.6) * ppm
        col = {"palm": (46, 140, 70), "tree": (40, 120, 56), "cabana": (250, 248, 240), "stand": (224, 150, 70)}[p["kind"]]
        d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=(30, 70, 36) if p["kind"] in ("tree", "palm") else (90, 80, 70))
    # los edificios de hoy sólo FUERA del terreno nuevo; el muelle y el kiosco, encima
    furniture(prop, buildings=False)
    d.text((12, 10), "PROPUESTA — docs/punta-satellite-mockup.json sobre el mundo de hoy", fill=(255, 255, 255))

    sheet = Image.new("RGB", (today.width * 2 + 12, today.height), (20, 20, 24))
    sheet.paste(today, (0, 0))
    sheet.paste(prop, (today.width + 12, 0))
    sheet.save(out)
    print(f"[punta] {out}: {len(doc['shapes'])} figuras, {len(doc['points'])} puntos")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "docs", "punta-space-mockup.png"))
