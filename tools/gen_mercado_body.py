#!/usr/bin/env python3
"""EL MERCADO MUNICIPAL COMO CUERPO DE RECETA: escribe `world-props.json → bodies.mercado`.

    python3 tools/gen_mercado_body.py             # escribe la receta
    python3 tools/gen_mercado_body.py --overlay   # además dibuja lo calcado sobre las imágenes (logs/mercado/)

LAS MEDIDAS NO SE LEEN A OJO: están calcadas en PÍXELES en `tools/mercado_trace.json`, imagen por imagen,
y aquí se pasan a metros. El `--overlay` vuelve a dibujar esas mismas líneas encima de las imágenes —si una
línea no cae sobre lo que dice, el número está mal, y se corrige en el calco, no aquí—.

* LA PLANTA Y EL TECHO salen del SATÉLITE. La escala es la del lote: el ancho del techo en la captura
  (1 049 px) es el ancho de la cuadra en el juego (`W`). El fondo sale de la proporción medida (878 / 1 049),
  y lo que sobra hacia Avenida 3 es el FRENTE —la acera ancha del árbol y de las paradas—.
  El techo, de afuera hacia adentro: el ANILLO blanco en inglete que baja hacia la calle, el ZINC ROJO que
  rodea el patio, la LINTERNILLA blanca, y las SEIS HILERAS de zinc rojo de este a oeste con sus linternillas
  blancas entre una y otra.
* LA FACHADA sale de la POSTAL SEPIA: la galería de columnas blancas alrededor (paso de 0,82 de su altura),
  el friso con guirnaldas, el zócalo beige, puertas y ventanas altas de madera, y al frente —hacia Avenida 3—
  el PABELLÓN DE LA ENTRADA con tres arcos y su remate escalonado con letreros y pináculos.
* EL FRENTE sale del satélite y de la foto de hoy: el árbol grande hacia Calle 2A y la PARADA de buses
  contra el cordón —dos casetas de techo blanco con su banca—, donde el mundo ya tiene la parada de
  «Puntarenas - El Roble - Barraca - San Miguel».

Marco: el del lote `osm_market_1077016901` (`parcelFrame`), en metros; `u` hacia Calle 2A (este), `v` hacia
Avenida 3 (sur). Aristas de una `box`: 0 norte, 1 este, 2 sur (de este a oeste), 3 oeste.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, "tools", "mercado_trace.json"), encoding="utf-8"))
S, P = T["satellite"], T["sepia"]
r2 = lambda v: round(v, 2)

# ── LA ESCALA: el ancho del techo en la captura es el ancho de la cuadra en el juego ─────────────────
# El lote mide ±22,2 m (hw 69,5 px / hh 69,3 px a 3,125 px/m); el edificio deja 0,2 m a cada lado.
HW = 22.0
W = 2 * HW
SX0, SX1 = S["building"]["x"]
SY0, SY1 = S["building"]["y"]
PXM = (SX1 - SX0) / W                       # píxeles de la captura por metro (~23,8)
D = r2((SY1 - SY0) / PXM)                   # el fondo, por la proporción medida (~36,8 m)
V0 = -22.0                                  # pegado a Avenida 5, como en la captura
V1 = r2(V0 + D)                             # la fachada del frente; de aquí a +22,2 es la acera de Avenida 3
U = lambda x: r2((x - SX0) / PXM - HW)      # px de la captura -> u
V = lambda y: r2((y - SY0) / PXM + V0)      # px de la captura -> v
CU, CV = 0.0, r2((V0 + V1) / 2)

# ── LAS MEDIDAS DE LA POSTAL, contra la columna de la esquina ─────────────────────────────────────
COL_PX = P["cornerColumn"]["base"] - P["cornerColumn"]["top"]
ZF = 0.3                                    # el piso de la galería, un escalón sobre la acera
ZC = 4.4                                    # la columna (la medida de la postal; un piso de mercado)
k = ZC / COL_PX                             # metros por píxel de la postal en la columna de la esquina
BAY = r2(ZC * (P["nextColumns"][0][0] - P["cornerColumn"]["x"]) / -COL_PX)   # el paso: 0,82 de la altura -> 3,6 m
ZE = r2(ZC + k * (P["entablature"]["bottom"] - P["entablature"]["top"]))    # el friso encima: hasta ~5,1 m
PL = r2(ZC * (P["plinth"]["bottom"] - P["plinth"]["top"]) / P["plinth"]["columnPx"])          # el zócalo, ~0,8 m
OPEN = r2(ZC * (P["plinth"]["bottom"] - P["openingTop"]) / P["plinth"]["columnPx"])          # el dintel, ~3,3 m
VER = 2.4                                   # el fondo de la galería: de la columna a la pared

# ── EL TECHO, de afuera hacia adentro (satélite) ──────────────────────────────────────────────────
RING = r2(S["ringBandPx"] / PXM)            # el anillo blanco en inglete: ~3,4 m
RIM = r2(S["rimPx"] / PXM)                  # el zinc rojo alrededor: ~1,7 m
LAN = r2(S["lanternRingPx"] / PXM)          # la linternilla de alrededor: ~1,2 m
Z_RING_HI = ZE + 0.9                        # el anillo sube 0,9 m de su alero al borde de adentro
Z_STEP = Z_RING_HI + 0.4                    # el escalón del claristorio entre el anillo y el zinc rojo
Z_RIM_HI = Z_STEP + 0.6
Z_LAN = Z_RIM_HI + 0.35                     # el piso blanco de las linternillas, entre hilera e hilera
ROW_RISE = 0.9                              # cada hilera de zinc, a dos aguas

tiers = []


def rect(inset):
    """las cuatro esquinas del edificio metidas `inset` m: NO, NE, SE, SO"""
    a, b, c, d = -HW + inset, HW - inset, V0 + inset, V1 - inset
    return [(a, c), (b, c), (b, d), (a, d)]


def ring(inset0, z0, inset1, z1, ink, ink2, note=None, wall=False):
    """un anillo de techo de cuatro caras con sus esquinas en inglete: de `inset0` a `z0` a `inset1` a `z1`"""
    o, i = rect(inset0), rect(inset1)
    out = []
    for s in range(4):
        a, b = s, (s + 1) % 4
        f = {"facet": [[r2(o[a][0]), r2(o[a][1]), z0], [r2(o[b][0]), r2(o[b][1]), z0],
                       [r2(i[b][0]), r2(i[b][1]), z1], [r2(i[a][0]), r2(i[a][1]), z1]], "ink": ink}
        f.update({"wallFacet": True} if wall else {"ink2": ink2})
        if note and s == 0:
            f = {"_": note, **f}
        out.append(f)
    return out


# el piso de la galería, sobre toda la huella
tiers.append({"_": "EL PISO DE LA GALERÍA: un escalón sobre la acera, de lado a lado de la cuadra", "box": [W, D], "at": [CU, CV],
              "z": [0, ZF], "wall": "mkPlinth", "cap": "mkFloor"})

# ── LA PARED DE ADENTRO DE LA GALERÍA: zócalo beige, puertas y ventanas altas de madera, friso ───────
def bays(length, door_every=2, skip=()):
    """una puerta o una ventana por intercolumnio, en fracciones de la arista"""
    n = max(1, round(length / BAY))
    out = []
    for j in range(n):
        f0, f1 = j / n, (j + 1) / n
        c = (f0 + f1) / 2 * length
        if any(a <= c <= b for a, b in skip):
            continue
        w = 0.28 if j % door_every == 0 else 0.34
        if j % door_every == 0:
            out.append({"f": [r2((c - BAY * w) / length * 1000) / 1000, r2((c + BAY * w) / length * 1000) / 1000], "z": [ZF, OPEN], "ink": "mkDoor"})
        else:
            out.append({"f": [r2((c - BAY * w) / length * 1000) / 1000, r2((c + BAY * w) / length * 1000) / 1000], "z": [r2(ZF + PL), OPEN], "ink": "mkGlass"})
            out.append({"f": [r2((c - BAY * w) / length * 1000) / 1000, r2((c + BAY * w) / length * 1000) / 1000], "z": [r2(OPEN - 0.12), OPEN], "ink": "mkDoor"})
    return out

CW, CD = W - 2 * VER, D - 2 * VER
PAV = 3 * BAY                               # el pabellón de la entrada: tres arcos
skip_s = [(CW / 2 - PAV / 2 - 0.3, CW / 2 + PAV / 2 + 0.3)]
tiers.append({"_": "LA PARED DE ADENTRO DE LA GALERÍA (la postal): zócalo beige, puertas y ventanas altas de madera, una por intercolumnio, y el friso arriba",
              "box": [r2(CW), r2(CD)], "at": [CU, CV], "z": [ZF, ZE], "wall": "mkWall", "cap": "mkRoofShade",
              "bands": [[0, r2(PL / (ZE - ZF)), "mkPlinth"], [0.86, 1, "mkFrieze"]],
              "openings": [{**o, "edge": e} for e, L, sk in ((0, CW, ()), (1, CD, ()), (2, CW, skip_s), (3, CD, ())) for o in bays(L, skip=sk)]})

# ── LAS COLUMNAS BLANCAS de la galería, al paso de la postal, con su base y su capitel ───────────────
def columns_on(a, b):
    import math
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, round(L / BAY))
    return [(a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n) for j in range(n)]

C_IN = 0.35
cr = rect(C_IN)
first = True
for s in range(4):
    for (u, v) in columns_on(cr[s], cr[(s + 1) % 4]):
        if s == 2 and abs(u) < PAV / 2 + 0.1:
            continue                        # el frente del pabellón lleva su arcada
        tiers.append({**({"_": "UNA COLUMNA de la galería: blanca, con su basa y su capitel"} if first else {}),
                      "box": [0.42, 0.42], "at": [r2(u), r2(v)], "z": [ZF, ZC], "wall": "mkColumn", "cap": "mkColumn",
                      "bands": [[0, 0.06, "mkTrim"], [0.93, 1, "mkTrim"]]})
        first = False

# ── EL FRISO DE LA GALERÍA, alrededor, sobre las columnas ──────────────────────────────────────────
for s, (box, at) in enumerate((([W, 0.6], [CU, V0 + 0.3]), ([W, 0.6], [CU, V1 - 0.3]), ([0.6, D - 1.2], [-HW + 0.3, CV]), ([0.6, D - 1.2], [HW - 0.3, CV]))):
    tiers.append({**({"_": "EL FRISO CON GUIRNALDAS (la postal): la viga sobre las columnas, con su cornisa"} if s == 0 else {}),
                  "box": [r2(box[0]), r2(box[1])], "at": [r2(at[0]), r2(at[1])], "z": [ZC, ZE], "wall": "mkFrieze", "cap": "mkTrim",
                  "bands": [[0, 0.18, "mkTrim"], [0.45, 0.55, "mkGarland"], [0.84, 1, "mkTrim"]]})

# ── EL TECHO (satélite) ───────────────────────────────────────────────────────────────────────────
tiers += ring(0, ZE, RING, Z_RING_HI, "mkRoof", "mkRoofShade",
              "EL ANILLO BLANCO: cuatro aguas en inglete que bajan hacia la calle, sobre la galería (el satélite: las diagonales de las esquinas)")
tiers += ring(RING, Z_RING_HI, RING, Z_STEP, "mkClerestory", None, "el escalón del claristorio entre el anillo y el zinc", wall=True)
tiers += ring(RING, Z_STEP, RING + RIM, Z_RIM_HI, "mkZinc", "mkZincShade", "EL ZINC ROJO que rodea el patio de techos")
IN = RING + RIM
tiers.append({"_": "LA LINTERNILLA: el piso blanco del patio de techos —lo que se ve entre hilera e hilera— y su costado de vidrio sobre el zinc rojo",
              "box": [r2(W - 2 * IN), r2(D - 2 * IN)], "at": [CU, CV], "z": [r2(Z_RIM_HI - 0.05), r2(Z_LAN)], "wall": "mkClerestory", "cap": "mkLantern"})
RU0, RU1 = U(S["rowsX"][0]), U(S["rowsX"][1])
RU0, RU1 = max(RU0, -HW + IN + LAN), min(RU1, HW - IN - LAN)
for j, (y0, y1) in enumerate(S["rowsRed"]):
    v0, v1 = max(V(y0), V0 + IN + LAN * 0.5), min(V(y1), V1 - IN - LAN * 0.5)
    tiers.append({**({"_": "LAS SEIS HILERAS DE ZINC, de este a oeste, a dos aguas, donde el satélite las pone"} if j == 0 else {}),
                  "box": [r2(RU1 - RU0), r2(v1 - v0)], "at": [r2((RU0 + RU1) / 2), r2((v0 + v1) / 2)], "z": [r2(Z_LAN), r2(Z_LAN)],
                  "wall": "mkLantern", "cap": "mkZinc",
                  "roof": {"kind": "gable", "riseM": ROW_RISE, "ink": "mkZinc", "ink2": "mkZincShade", "seamsM": 0.9}})

# ── EL PABELLÓN DE LA ENTRADA, al frente (la postal) ──────────────────────────────────────────────
PV = V1 - 0.3
arch = [{"edge": 2, "f": [r2((j + 0.16) / 3), r2((j + 0.84) / 3)], "z": [ZF, r2(OPEN + 0.5)], "ink": "mkArch"} for j in range(3)]
arch += [{"edge": 2, "f": [r2((j + 0.3) / 3), r2((j + 0.7) / 3)], "z": [r2(OPEN + 0.5), r2(OPEN + 0.85)], "ink": "mkArch"} for j in range(3)]   # el medio punto, escalonado
tiers.append({"_": "EL PABELLÓN DE LA ENTRADA: la arcada de tres arcos sobre Avenida 3, con sus pilares blancos",
              "box": [r2(PAV), 0.6], "at": [CU, r2(PV)], "z": [ZF, ZE], "wall": "mkColumn", "cap": "mkTrim",
              "bands": [[0, 0.05, "mkTrim"], [0.86, 1, "mkFrieze"]], "openings": arch})
PZ1 = r2(ZE + k * 1.0 * (P["pavilion"]["parapet"][1] - P["pavilion"]["parapet"][0]) * COL_PX / P["pavilion"]["columnPx"])
PZ2 = r2(PZ1 + k * (P["pavilion"]["upper"][1] - P["pavilion"]["upper"][0]) * COL_PX / P["pavilion"]["columnPx"])
FZ = r2(PZ2 + k * (P["pavilion"]["upper"][0] - P["pavilion"]["finialTop"]) * COL_PX / P["pavilion"]["columnPx"])
tiers.append({"_": "EL PRETIL del pabellón, con el letrero de MERCADO", "box": [r2(PAV), 0.6], "at": [CU, r2(PV)], "z": [ZE, PZ1],
              "wall": "mkTrim", "cap": "mkTrim", "bands": [[0, 0.12, "mkFrieze"], [0.88, 1, "mkFrieze"]],
              "openings": [{"edge": 2, "f": [0.22, 0.78], "z": [r2(ZE + 0.25), r2(PZ1 - 0.3)], "ink": "mkSign"}]})
tiers.append({"_": "el cuerpo de arriba, con su letrero", "box": [r2(PAV * 0.42), 0.6], "at": [CU, r2(PV)], "z": [PZ1, PZ2],
              "wall": "mkTrim", "cap": "mkTrim", "bands": [[0.85, 1, "mkFrieze"]],
              "openings": [{"edge": 2, "f": [0.14, 0.86], "z": [r2(PZ1 + 0.2), r2(PZ2 - 0.25)], "ink": "mkSignDark"}]})
for j, u in enumerate((-PAV / 2 + 0.25, PAV / 2 - 0.25, -PAV * 0.21 + 0.2, PAV * 0.21 - 0.2)):
    z0 = ZE if j < 2 else PZ1
    tiers.append({**({"_": "los PINÁCULOS: los postes con su remate en los extremos del pretil y del cuerpo de arriba"} if j == 0 else {}),
                  "box": [0.45, 0.45], "at": [r2(u), r2(PV)], "z": [r2(z0), r2(FZ if j >= 2 else PZ2)], "wall": "mkColumn", "cap": "mkTrim"})
    tiers.append({"box": [0.3, 0.3], "at": [r2(u), r2(PV)], "z": [r2(FZ if j >= 2 else PZ2), r2((FZ if j >= 2 else PZ2) + 0.45)], "wall": "mkTrim", "cap": "mkTrim"})

# ── EL FRENTE: el árbol grande y la parada de buses (satélite y foto de hoy) ──────────────────────────
TU0, TU1 = U(S["treeCanopy"]["x"][0]), U(S["treeCanopy"]["x"][1])
TV = V((S["treeCanopy"]["y"][0] + S["treeCanopy"]["y"][1]) / 2)
trees = [{"atM": [r2(TU0 + (TU1 - TU0) * f), r2(max(TV, V1 + 3.4))], "k": "almendro", "s": s} for f, s in ((0.45, 0.9), (0.72, 1.05), (0.96, 0.85))]   # hacia Calle 2A, como la copa del satélite: así no tapan el pabellón
SU0, SU1 = U(S["shelterRoof"]["x"][0]), U(S["shelterRoof"]["x"][1])
SV = 21.0                                   # contra el cordón: el lote termina en +22,2 y la acera sigue afuera
# la parada va en `tiers` y no en `low`: `low` es para lo de menos de un metro (`centro.lowM`), que se pinta
# antes que todo; una caseta de 2,6 m entra en el orden por su altura, como el resto del edificio
low = tiers
mods = 2
for m in range(mods):
    a = SU0 + (SU1 - SU0) * m / mods + 0.1
    b = SU0 + (SU1 - SU0) * (m + 1) / mods - 0.1
    cu, L = (a + b) / 2, b - a
    note = (lambda t: {"_": t} if m == 0 else {})
    low.append({**note("LA PARADA (foto de hoy y el techo blanco del satélite): dos casetas de techo blanco contra el cordón; sus postes"),
                "box": [0.12, 0.12], "at": [r2(a + 0.15), r2(SV - 0.7)], "z": [0, 2.45], "wall": "mkShelterPost", "cap": "mkShelterPost"})
    low.append({"box": [0.12, 0.12], "at": [r2(b - 0.15), r2(SV - 0.7)], "z": [0, 2.45], "wall": "mkShelterPost", "cap": "mkShelterPost"})
    low.append({**note("el vidrio de atrás, hacia el mercado"), "box": [r2(L - 0.3), 0.08], "at": [r2(cu), r2(SV - 0.72)], "z": [0.25, 2.2],
                "wall": "mkShelterGlass", "cap": "mkShelterPost"})
    low.append({**note("la banca"), "box": [r2(L - 0.6), 0.42], "at": [r2(cu), r2(SV - 0.45)], "z": [0.42, 0.5], "wall": "mkBench", "cap": "mkBench"})
    low.append({**note("el techo, que vuela hacia la calle"), "box": [r2(L), 1.7], "at": [r2(cu), r2(SV - 0.1)], "z": [2.45, 2.6],
                "wall": "mkShelterPost", "cap": "mkShelterRoof"})

body = {
    "_note": "EL MERCADO MUNICIPAL DE PUNTARENAS: la manzana de Avenida 5 a Avenida 3, entre Calle 0B y Calle 2A. La planta y el techo están CALCADOS del satélite (`tools/mercado_trace.json`): el anillo blanco en inglete sobre la galería, el zinc rojo que rodea el patio de techos, la linternilla y las seis hileras de zinc de este a oeste. La fachada es la de la postal sepia: galería de columnas blancas, friso con guirnaldas, zócalo beige, puertas y ventanas altas, y el pabellón de la entrada con tres arcos, letrero y pináculos hacia Avenida 3. Al frente, la acera ancha con el árbol grande y la parada de buses. La escribe `tools/gen_mercado_body.py`.",
    "perspective": True,
    "tiers": tiers, "trees": trees, "placeM": [0, 0],
    "ground": {"rectM": [-26.0, -26.0, 26.0, 26.5], "ink": "mkPavement",
               "_": "el piso de concreto de la cuadra entera: la acera ancha del frente y la galería; la acera de afuera, que se pinta después, tapa lo que sobre"},
}


def overlay():
    """vuelve a dibujar lo calcado encima de las imágenes, para revisarlo a ojo"""
    from PIL import Image, ImageDraw
    base = os.path.join(ROOT, "logs", "mercado")
    sat = Image.open(os.path.join(base, S["image"])).convert("RGB")
    d = ImageDraw.Draw(sat)
    box = lambda x0, y0, x1, y1, c, w=3: d.rectangle([x0, y0, x1, y1], outline=c, width=w)
    box(SX0, SY0, SX1, SY1, (255, 255, 0))
    for inset, c in ((S["ringBandPx"], (0, 255, 255)), (S["ringBandPx"] + S["rimPx"], (255, 60, 60)),
                     (S["ringBandPx"] + S["rimPx"] + S["lanternRingPx"], (255, 255, 255))):
        box(SX0 + inset, SY0 + inset, SX1 - inset, SY1 - inset, c, 2)
    for x, y in ((SX0, SY0), (SX1, SY0), (SX1, SY1), (SX0, SY1)):
        ix = x + (S["ringBandPx"] if x == SX0 else -S["ringBandPx"]); iy = y + (S["ringBandPx"] if y == SY0 else -S["ringBandPx"])
        d.line([x, y, ix, iy], fill=(0, 255, 255), width=2)       # los ingletes del anillo
    for y0, y1 in S["rowsRed"]:
        box(S["rowsX"][0], y0, S["rowsX"][1], y1, (255, 120, 0), 2)
        d.line([S["rowsX"][0], (y0 + y1) / 2, S["rowsX"][1], (y0 + y1) / 2], fill=(255, 120, 0), width=1)   # la cumbrera
    box(SX0, S["front"]["y"][0], SX1, S["front"]["y"][1], (180, 180, 255), 2)
    t = S["treeCanopy"]; d.ellipse([t["x"][0], t["y"][0], t["x"][1], t["y"][1]], outline=(60, 255, 60), width=3)
    s = S["shelterRoof"]; box(s["x"][0], s["y"][0], s["x"][1], s["y"][1], (255, 0, 255), 3)
    sat.crop((0, 780, sat.width, 1960)).save(os.path.join(base, "trace-satellite.png"))
    sep = Image.open(os.path.join(base, P["image"])).convert("RGB")
    d = ImageDraw.Draw(sep)
    cc = P["cornerColumn"]
    for x, top, bot in [(cc["x"], cc["top"], cc["base"])] + P["nextColumns"]:
        d.line([x, top, x, bot], fill=(255, 255, 0), width=3)
    d.line([cc["x"] - 40, P["entablature"]["top"], cc["x"] + 40, P["entablature"]["top"]], fill=(0, 255, 255), width=2)
    d.line([cc["x"] - 40, P["entablature"]["bottom"], cc["x"] + 40, P["entablature"]["bottom"]], fill=(0, 255, 255), width=2)
    d.line([500, P["plinth"]["top"], 620, P["plinth"]["top"]], fill=(255, 120, 0), width=2)
    d.line([500, P["plinth"]["bottom"], 620, P["plinth"]["bottom"]], fill=(255, 120, 0), width=2)
    d.line([500, P["openingTop"], 620, P["openingTop"]], fill=(255, 255, 255), width=2)
    pv = P["pavilion"]
    d.rectangle([pv["x"][0], pv["parapet"][0], pv["x"][1], pv["parapet"][1]], outline=(255, 0, 255), width=2)
    d.rectangle([pv["x"][0] + 40, pv["upper"][0], pv["x"][1] - 50, pv["upper"][1]], outline=(255, 0, 255), width=2)
    d.line([pv["x"][0], pv["finialTop"], pv["x"][1], pv["finialTop"]], fill=(255, 0, 255), width=1)
    sep.resize((sep.width * 2, sep.height * 2)).save(os.path.join(base, "trace-sepia.png"))
    print("[mercado] overlay -> logs/mercado/trace-satellite.png, trace-sepia.png")


if __name__ == "__main__":
    # como `gen_utn_body.py`: un generador de un asset del juego, no un cruce del builder (`tests/test_game_root.py`)
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "assets", "world-props.json")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    line = '    "mercado": ' + json.dumps(body, ensure_ascii=False) + ","
    if re.search(r'^    "mercado": \{.*\},$', text, flags=re.M):
        new, n = re.subn(r'^    "mercado": \{.*\},$', lambda m: line, text, count=1, flags=re.M)
    else:                                   # la primera vez: va justo antes de la UTN
        new, n = re.subn(r'^(    "utn": \{)', lambda m: line + "\n" + m.group(1), text, count=1, flags=re.M)
    assert n == 1, "no encontré dónde va bodies.mercado"
    json.loads(new)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(new)
    print(f"[mercado] {len(tiers)} bloques, {len(trees)} árboles; {W} x {D} m, frente {r2(22.2 - V1)} m; "
          f"paso {BAY} m, friso a {ZE} m, pretil {PZ1}/{PZ2} m -> {os.path.relpath(path)}")
    if "--overlay" in sys.argv:
        overlay()
