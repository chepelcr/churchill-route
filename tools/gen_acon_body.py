#!/usr/bin/env python3
"""LA BOMBA Y LOS REPUESTOS ACON COMO CUERPO DE RECETA: escribe `world-props.json → bodies.acon`.

    python3 tools/gen_acon_body.py             # escribe la receta
    python3 tools/gen_acon_body.py --overlay   # además dibuja lo calcado sobre las imágenes (logs/acon/)

LAS MEDIDAS NO SE LEEN A OJO: están calcadas en PÍXELES en `tools/acon_trace.json`, imagen por imagen, y
aquí se pasan a metros, como el Mercado (`gen_mercado_body.py`). El `--overlay` vuelve a dibujar esas
mismas marcas encima de las imágenes —si una no cae sobre lo que dice, el número está mal, y se corrige en
el calco, no aquí—.

* LA PLANTA sale del SATÉLITE y entra al lote del mundo (`content/world/historic.json → acon.lotM`) con UNA
  escala: las calles del juego son más anchas que las de verdad y la cuadra es más chica. La entrada del
  patio es la única medida que no se escala (el carro del juego tiene que caber).
* LAS CARAS salen de las VISTAS DE CALLE EN PERSPECTIVA, no como planos. Leída como un plano, la cara norte
  juntaba la cortina de la BAHÍA con la celosía de la oficina, y la bahía salía como una franja a todo lo
  ancho; reconstruida (horizonte, puntos de fuga, alto de la cámara), la bahía es lo que es: un cuerpo de
  ~4,3 m en el medio del frente, que SALE ~6,5 m adelante del bloque a dos pisos, con el BALCÓN DE LAS
  PLANTAS encima. Por eso el balcón es más angosto que el bloque.
* SIN MARQUESINA: el autor la quitó para que el balcón —la losa que dice BOMBA ACON S.A. en su canto de
  Calle 4, como en la foto vieja, con su pretil y sus matas— se vea desde el cielo. La losa y el puente del
  patio son `overhead`: el carro pasa debajo de lo que vuela.
* TODO SIGUE A LAS DOS CALLES: Calle 4 no llega a escuadra con la avenida (`sideSlope`, 2,8°), y lo que va
  contra ella o es largo se corre con esa pendiente (`B`, `quad`, `rounded`).

Marco: el del lote `hist_acon` (`parcelFrame`), en metros desde su centro; `u` hacia el este a lo largo
de la avenida, `v` hacia adentro de la cuadra. Aristas de una `box`/`quad`: 0 norte, 1 este, 2 sur, 3 oeste.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, "tools", "acon_trace.json"), encoding="utf-8"))
HIST = json.load(open(os.path.join(ROOT, "content", "world", "historic.json"), encoding="utf-8"))
P = next(p for p in HIST["places"] if p["id"] == "acon")
S, AV, EF, C4, OP, YD = T["satellite"], T["avenueView"], T["eastFace"], T["calle4View"], T["oldPhoto"], T["yardCalle4"]
r2 = lambda v: round(v, 2)
avg = lambda *xs: sum(xs) / len(xs)

LU, LV = P["lotM"]
SLOPE = P.get("sideSlope", 0.0)
DRIVE = {d["id"]: d["rectM"] for d in P["drive"]}
GAP = P.get("calle4GapM", 0.0)               # el concreto entre la acera de Calle 4 y la pared de la bomba
OU, OV = LU / 2, LV / 2                      # el centro del lote: el origen del cuerpo


def B(u, v):
    """metros del lote → metros del cuerpo: el origen al centro del lote, y corrido con la pendiente de
    Calle 4 (la misma con que `tools/emit_historic.py` arma el lote), así lo que va contra Calle 4 la sigue"""
    return [r2(u - OU + SLOPE * (v - OV)), r2(v - OV)]


# ── LA PLANTA: px del satélite → metros de verdad → metros del lote ────────────────────────────────
UR = lambda x: (x - S["calle4LineX"]) / S["pxPerM"]
VR = lambda y: (y - S["avenueLineY"]) / S["pxPerM"]
U_DRIVE0, U_DRIVE1 = DRIVE["driveway"][0], DRIVE["driveway"][2]
SC = (U_DRIVE0 - GAP) / UR(S["leanTo"]["x"][1])  # LA escala: la bomba, de su pared de Calle 4 al porche, llena hasta la entrada
gm = lambda m: m * SC                            # un largo de verdad → metros del lote
gu = lambda m: GAP + m * SC                      # una u de verdad (desde la pared de Calle 4) → u del lote
ub = lambda x: gu(max(0.0, UR(x)))               # del lado de la bomba
uw = lambda x: U_DRIVE1 + (UR(x) - UR(S["white"]["x"][0])) * SC     # del lado del edificio blanco
vr = lambda y: max(0.0, VR(y)) * SC
# LA BOMBA SE CORRE HACIA LA AVENIDA hasta que su fondo (el del brazo de Calle 4) cae en la línea del portón
# del centro, donde termina el edificio blanco (el autor: «alinealos con la entrada del centro, un poco más
# adelante»). El blanco no se mueve: ya está contra la acera
DV = vr(S["arm"]["y"][1]) - vr(S["white"]["y"][1])
vb = lambda y: vr(y) - DV

MAIN_VR = VR(S["mainBand"]["y"][0])              # la cara norte del bloque, en metros de verdad
MAIN_V0, BAND_V1 = r2(vb(S["mainBand"]["y"][0])), r2(vb(S["mainBand"]["y"][1]))
MAIN_U1, ARM_U1 = r2(ub(S["mainBand"]["x"][1])), r2(ub(S["arm"]["x"][1]))
ARM_V1 = r2(min(vb(S["arm"]["y"][1]), DRIVE["yard"][1] - 0.05))
BACK_U0, BACK_U1 = ARM_U1, r2(min(ub(S["backWing"]["x"][1]), U_DRIVE0 - 0.1))
BACK_V1 = r2(min(vb(S["backWing"]["y"][1]), DRIVE["yard"][1] - 0.05))
LEAN_U0, LEAN_U1 = MAIN_U1, r2(U_DRIVE0 - 0.05)
LEAN_V0, LEAN_V1 = r2(vb(S["leanTo"]["y"][0])), BAND_V1
WHITE_U0, WHITE_U1 = U_DRIVE1, r2(min(LU - 0.15, uw(S["white"]["x"][1])))
WHITE_V0, WHITE_V1 = 0.0, r2(vr(S["white"]["y"][1]))
WHITE_R = r2(gm(S["white"]["cornerR"] / S["pxPerM"]))
WS_U0, WS_U1 = r2(uw(S["workshop"]["x"][0])), r2(min(LU - 0.15, uw(S["workshop"]["x"][1])))
WS_V0, WS_V1 = WHITE_V1, r2(min(vr(S["workshop"]["y"][1]), LV - 0.3))

# ── LA VISTA DESDE LA AVENIDA, EN PERSPECTIVA: la bahía y la cara del bloque ────────────────────────
# Cámara a nivel. La focal sale de que el punto de fuga del sur y el de la avenida son de direcciones
# perpendiculares; el giro de la vista, del de fuga del sur; el alto de la cámara, de la cortina.
CXA = AV["size"][0] / 2
FA = math.sqrt((AV["southVPX"] - CXA) * (CXA - AV["eastVPX"]))
YAW = math.atan((AV["southVPX"] - CXA) / FA)             # la vista, girada del sur hacia el este
HY = AV["horizonY"]
_ybNW = AV["ground"]["colNW"][1]
CAM_A = AV["shutterM"] * (_ybNW - HY) / (_ybNW - AV["shutterTopY"])


def ground_av(x, y):
    """un pie sobre el piso de la vista → (este, sur) en metros desde la cámara"""
    k = CAM_A / (y - HY)
    z, lat = FA * k, (x - CXA) * k
    return (z * math.sin(YAW) - lat * math.cos(YAW), z * math.cos(YAW) + lat * math.sin(YAW))


def height_av(y, ybase):
    """la altura de un punto de la imagen que está a la profundidad del pie `ybase`"""
    return CAM_A * (1 + (HY - y) / (ybase - HY))


_G = {k: ground_av(*p) for k, p in AV["ground"].items() if not k.startswith("_")}
_nw = _G["cornerNW"]
REL = {k: (e - _nw[0], s - _nw[1]) for k, (e, s) in _G.items()}      # desde la esquina noroeste del bloque
_main_s = avg(REL["bayJoin"][1], 0.0)
BAY_DEPTH_R = _main_s - avg(REL["colNE"][1], REL["colNW"][1])         # cuánto sale la bahía, de verdad
BAY_U0, BAY_U1 = r2(gu(avg(REL["colNW"][0], REL["bayJoin"][0]))), r2(gu(REL["colNE"][0]))
BAY_V0, BAY_V1 = r2(gm(MAIN_VR - BAY_DEPTH_R) - DV), MAIN_V0
_yb_bay = avg(AV["ground"]["colNE"][1], AV["ground"]["colNW"][1])
_yb_main = AV["mainFace"]["baseY"]
# lo que vuela la losa de la bahía más allá de sus columnas: el largo de su canto contra la cortina
SLAB_OUT_E, SLAB_OUT_W, SLAB_OUT_N = gm(0.96), gm(0.84), gm(0.6)

# ── LA VISTA DESDE CALLE 4, EN PERSPECTIVA: la cara oeste ──────────────────────────────────────────
(_bx0, _by0), (_bx1, _by1) = C4["base"]
_m = (_by1 - _by0) / (_bx1 - _bx0)
C4_VP = _bx0 + (C4["horizonY"] - _by0) / _m                       # donde el pie de la pared cruza el horizonte
_x0, _x1 = C4["cornerNWX"], C4["pillarSWX"]
_k = (_x1 - _x0) / (C4_VP - _x1)
yb_c4 = lambda x: _by0 + (x - _bx0) * _m                           # el pie de la pared en esa x
t_c4 = lambda x: (x - _x0) / (_k * (C4_VP - x))                    # fracción proyectiva, 0 en la esquina, 1 en el pilar
height_c4 = lambda x, y: C4["camM"] * (yb_c4(x) - y) / (yb_c4(x) - C4["horizonY"])
wfV = lambda x: r2(MAIN_V0 + t_c4(x) * (ARM_V1 - MAIN_V0))         # la cara oeste: de la esquina al pilar

# ── LAS ALTURAS: las dos vistas, promediadas donde las dos ven lo mismo ─────────────────────────────
_cx = C4["measureX"]
Z_SLAB = [r2(avg(height_av(AV["mainFace"]["slabY"][1], _yb_main), height_c4(_cx, C4["slabY"][1]))),
          r2(avg(height_av(AV["mainFace"]["slabY"][0], _yb_main), height_c4(_cx, C4["slabY"][0])))]
Z_SILL = [r2(avg(height_av(AV["mainFace"]["sillY"][1], _yb_main), height_c4(_cx, C4["sillY"][1]))),
          r2(avg(height_av(AV["mainFace"]["sillY"][0], _yb_main), height_c4(_cx, C4["sillY"][0])))]
_wtop = [height_c4(avg(*xs), ys[0]) for xs, ys in zip(C4["upperWindows"], C4["upperWindowsY"])]
Z_WIN = [Z_SILL[1], r2(avg(height_av(AV["mainFace"]["windowsY"][0], _yb_main), avg(*_wtop)))]
Z_ROOF0 = r2(avg(height_av(AV["mainFace"]["roofY"][1], _yb_main), height_c4(C4["roofX"], C4["roofY"][1])))
Z_ROOF1 = r2(avg(height_av(AV["mainFace"]["roofY"][0], _yb_main), height_c4(C4["roofX"], C4["roofY"][0])))
Z_TOP = r2(Z_ROOF1 + 0.2)                                          # el reborde blanco del techo plano
Z_BASE = 0.9                                                       # el zócalo azul fuerte
Z_CEL = [r2(height_av(AV["mainFace"]["celosia"]["y"][1], _yb_main)), r2(height_av(AV["mainFace"]["celosia"]["y"][0], _yb_main))]
Z_SHUTTER = AV["shutterM"]
Z_BAYSLAB = [r2(height_av(AV["bayFront"]["slabY"][1], _yb_bay)), r2(height_av(AV["bayFront"]["slabY"][0], _yb_bay))]
Z_GARAGE = r2(height_c4(avg(*C4["garage"][1]), C4["horizonY"]))
Z_GRILLE = r2(avg(*(height_c4(avg(*xs), y) for xs, y in zip(C4["garage"], C4["grilleTopY"]))))
_dx = avg(*C4["door"]["x"])
Z_DOOR = [r2(height_c4(_dx, C4["door"]["y"][1])), r2(height_c4(_dx, C4["door"]["y"][0]))]
Z_ALERO = [r2(height_c4(_dx, C4["alero"]["y"][1])), r2(height_c4(_dx, C4["alero"]["y"][0]))]
Z_LOWWIN = [1.0, r2(Z_CEL[1] - 0.15)]                              # las ventanas de la planta baja: a la altura de la celosía


def arc(cu, cv, rad, a0, a1, n=4):
    """un cuarto de vuelta en metros del lote, de a0 a a1 grados (0 = este, 90 = sur: v crece hacia adentro)"""
    return [(cu + rad * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cv + rad * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def rounded(u0, v0, u1, v1, r=None, n=4):
    """un rectángulo del lote con esquinas redondas → (poly del cuerpo, índices de sus aristas rectas).
    El orden es el de una `box` (NO, NE, SE, SO): la arista 0 es la norte, como en las cajas."""
    r = r or {}
    nw, ne, se, sw = (r.get(k, 0) for k in ("nw", "ne", "se", "sw"))
    pts, edges = [], {}

    def arc(cu, cv, rad, a0, a1):
        return [(cu + rad * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cv + rad * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]
    pts.append((u0 + nw, v0)); edges["n"] = 0
    pts += arc(u1 - ne, v0 + ne, ne, -90, 0) if ne else [(u1, v0)]
    edges["e"] = len(pts) - 1
    pts += arc(u1 - se, v1 - se, se, 0, 90) if se else [(u1, v1)]
    edges["s"] = len(pts) - 1
    pts += arc(u0 + sw, v1 - sw, sw, 90, 180) if sw else [(u0, v1)]
    edges["w"] = len(pts) - 1
    pts += arc(u0 + nw, v0 + nw, nw, 180, 270)[:-1] if nw else [(u0, v0)]
    out = []
    for p in pts:
        if not out or abs(out[-1][0] - p[0]) > 1e-6 or abs(out[-1][1] - p[1]) > 1e-6:
            out.append(p)
    return [B(u, v) for u, v in out], edges


def quad(u0, v0, u1, v1):
    """un rectángulo del lote como `poly` del cuerpo (corrido con la pendiente): aristas 0 N, 1 E, 2 S, 3 O"""
    return [B(u0, v0), B(u1, v0), B(u1, v1), B(u0, v1)]


def on_edge(lo, hi, a, b):
    """fracción [f0, f1] de una arista que va de `lo` a `hi` (metros) para el tramo [a, b]"""
    L = hi - lo
    f0, f1 = (a - lo) / L, (b - lo) / L
    return [r2(min(f0, f1)), r2(max(f0, f1))]


def note(t, text, first):
    return {"_": text, **t} if first else t


def cut(edge, lo, hi, a, b, z, ink, rim=None, pad=0.1):
    """un vano entre a y b (metros a lo largo de una arista recta que va de `lo` a `hi`), recortado a lo
    recto de esa arista: un vano que cae entre dos paredes se parte en las dos (están en el mismo plano)"""
    lo_, hi_ = min(lo, hi) + pad, max(lo, hi) - pad
    a, b = max(min(a, b), lo_), min(max(a, b), hi_)
    if b - a < 0.25:
        return []
    op = {"edge": edge, "f": on_edge(lo, hi, a, b), "z": z, "ink": ink}
    return [{**op, "rim": rim}] if rim else [op]


tiers, overhead, low = [], [], []

# ═════════════════ EL BLOQUE A DOS PISOS (el edificio celeste: también los Repuestos Acón) ═════════════════
RW = r2(gm(0.5))                                     # las esquinas del bloque, apenas redondas
band, be = rounded(GAP, MAIN_V0, MAIN_U1, BAND_V1, {"nw": RW, "ne": RW})
n_lo, n_hi = GAP + RW, MAIN_U1 - RW                  # la arista norte recta, de oeste a este
# la cara norte AL OESTE de la bahía: la celosía de la oficina, y arriba sus ventanas (la vista de la avenida)
cel = [gu(ground_av(x, _yb_main)[0] - _nw[0]) for x in AV["mainFace"]["celosia"]["x"]]
uwin = [gu(ground_av(x, _yb_main)[0] - _nw[0]) for x in AV["mainFace"]["upperWindowsX"]]
ops = cut(be["n"], n_lo, n_hi, *cel, Z_CEL, "acCelosiaHole", ["acCelosia", 0.12])
ops += cut(be["n"], n_lo, n_hi, *uwin, Z_WIN, "acGlass", ["acFrame", 0.08])
# …y AL ESTE de la bahía, de la esquina noreste hacia ella: dos ventanas, la puerta de reja azul y otra
# celosía; arriba, la fila de ventanas (las vistas de la entrada del patio)
ef = lambda f: MAIN_U1 - RW - f * (MAIN_U1 - RW - BAY_U1)
for (a, b) in EF["windows"]:
    ops += cut(be["n"], n_lo, n_hi, ef(a), ef(b), Z_LOWWIN, "acGlass", ["acFrame", 0.08])
ops += cut(be["n"], n_lo, n_hi, ef(EF["door"][0]), ef(EF["door"][1]), [0.05, Z_DOOR[1]], "acDoorBlue")
ops += cut(be["n"], n_lo, n_hi, ef(EF["celosia"][0]), ef(EF["celosia"][1]), Z_CEL, "acCelosiaHole", ["acCelosia", 0.12])
ops += cut(be["n"], n_lo, n_hi, ef(EF["upperWindows"][0]), ef(EF["upperWindows"][1]), Z_WIN, "acGlass", ["acFrame", 0.08])
# la esquina noreste: las ventanas de arriba doblan hacia la entrada del patio
ops += cut(be["e"], MAIN_V0 + RW, BAND_V1, MAIN_V0 + RW, BAND_V1 - 0.4, Z_WIN, "acGlass", ["acFrame", 0.08])


def west_face(edge, v_start, v_end):
    """los dos portones de lata con su reja arriba, la puerta de rombos y las ventanas de arriba, sobre la
    arista oeste que va de v_start a v_end (la vista de Calle 4, en perspectiva)"""
    out = []
    for (x0, x1) in C4["garage"]:
        out += cut(edge, v_start, v_end, wfV(x0), wfV(x1), [0.05, Z_GARAGE], "acGarage")
        out += cut(edge, v_start, v_end, wfV(x0), wfV(x1), [r2(Z_GARAGE + 0.05), Z_GRILLE], "acGrille")
    for (x0, x1) in C4["upperWindows"]:
        out += cut(edge, v_start, v_end, wfV(x0), wfV(x1), Z_WIN, "acGlass", ["acFrame", 0.08])
    out += cut(edge, v_start, v_end, wfV(C4["door"]["x"][0]), wfV(C4["door"]["x"][1]), [0.05, Z_DOOR[1]], "acDoorBlue")
    return out


ops += west_face(be["w"], BAND_V1, MAIN_V0 + RW)     # la arista oeste de la banda va de sur a norte
# DOS PISOS, DOS BLOQUES: la planta baja se pinta ANTES que lo bajo que se le arrima (el ala de atrás, el
# porche, la bahía y su balcón) y el piso de arriba DESPUÉS. En un solo bloque su pared entera, del piso
# al techo, se pintaba encima del zinc del ala y del balcón, y el balcón —pintado aparte, al final— le
# quedaba encima del techo.
H_UP = Z_ROOF0 - Z_SLAB[0]
LOW_BANDS = [[0, r2(Z_BASE / Z_SLAB[0]), "acBase"]]
UP_BANDS = [[0, r2((Z_SLAB[1] - Z_SLAB[0]) / H_UP), "acBand"], [r2((Z_SILL[0] - Z_SLAB[0]) / H_UP), r2((Z_SILL[1] - Z_SLAB[0]) / H_UP), "acBand"]]
SORT_LOW = 1.5                                       # la planta baja, antes que todo lo que sube más de 1,5 m


def storeys(poly, openings, text, first):
    lo = [op for op in openings if op["z"][1] <= Z_SLAB[0] + 0.01]
    hi = [op for op in openings if op["z"][1] > Z_SLAB[0] + 0.01]
    return [note({"poly": poly, "z": [0, Z_SLAB[0]], "wall": "acBlue", "cap": "acSlab", "bands": LOW_BANDS, "openings": lo, "sortM": SORT_LOW}, text, first),
            {"poly": poly, "z": [Z_SLAB[0], Z_ROOF0], "wall": "acBlue", "cap": "acRoof", "bands": UP_BANDS, "openings": hi}]


tiers += storeys(band, ops, "EL BLOQUE A DOS PISOS, su banda contra la avenida (el satélite, y sus caras desde las vistas de calle en perspectiva): celeste con su zócalo azul, la losa del segundo piso y la banda bajo las ventanas; al oeste de la bahía la celosía de la oficina, al este dos ventanas, la puerta de reja y otra celosía, y en Calle 4 los dos portones de lata con su reja. En dos bloques, la planta baja y el piso de arriba, para que lo bajo que se le arrima quede entre los dos", True)
arm, ae = rounded(GAP, BAND_V1, ARM_U1, ARM_V1)
arm_ops = west_face(ae["w"], ARM_V1, BAND_V1)
# la cara sur del brazo, contra el patio (la vista desde la esquina de Calle 4): una celosía, una puerta y
# sus ventanas de arriba
AW = ARM_U1 - GAP
arm_ops += cut(ae["s"], ARM_U1, GAP, GAP + 0.42 * AW, GAP + 0.6 * AW, Z_CEL, "acCelosiaHole", ["acCelosia", 0.12])
arm_ops += cut(ae["s"], ARM_U1, GAP, GAP + 0.8 * AW, GAP + 0.95 * AW, [0.05, Z_DOOR[1]], "acDoorBlue")
arm_ops += cut(ae["s"], ARM_U1, GAP, GAP + 0.08 * AW, GAP + 0.72 * AW, Z_WIN, "acGlass", ["acFrame", 0.08])
tiers += storeys(arm, arm_ops, "el brazo de Calle 4 (la L del techo celeste), con la puerta azul de rombos y, contra el patio, su celosía", True)
# EL TECHO ES UNO: la L entera de la banda y el brazo, que vuela sobre el frente, la entrada y el patio
# —sobre Calle 4 no—, y su reborde blanco va en el CANTO (el satélite). Como dos losas con un reborde por
# bloque se veía doble: el reborde quedaba adentro, sobre la pared, con techo celeste de los dos lados.
RR, OH, FO, RIM = r2(gm(1.4)), r2(gm(0.5)), r2(gm(0.4)), 0.3


def lroof(m, oh=OH):
    """la planta del bloque en L, crecida `oh` metros de vuelo a cada lado y metida `m` hacia adentro: la de
    la losa del segundo piso y la del techo, con las MISMAS esquinas, así ningún canto asoma de más"""
    w0, v0, u1 = GAP - oh + m, MAIN_V0 - oh + m, MAIN_U1 + oh - m
    b1, a1, a2, r = BAND_V1 + oh - m, ARM_U1 + oh - m, ARM_V1 + oh - m, max(0.1, RR * oh / OH - m)
    pts = arc(w0 + r, v0 + r, r, 180, 270) + arc(u1 - r, v0 + r, r, 270, 360) + [(u1, b1), (a1, b1)]
    pts += arc(a1 - r, a2 - r, r, 0, 90) + arc(w0 + r, a2 - r, r, 90, 180)
    out = []
    for p in pts:
        if not out or abs(out[-1][0] - p[0]) > 1e-6 or abs(out[-1][1] - p[1]) > 1e-6:
            out.append(p)
    return [B(u, v) for u, v in out]


# la losa del segundo piso, que vuela alrededor del bloque con su canto azul (el concreto de Calle 4 le da lugar)
tiers.append(note({"poly": lroof(0, FO), "z": Z_SLAB, "wall": "acBand", "cap": "acSlab"},
                  "la losa del segundo piso, que vuela alrededor del bloque con su canto azul: la misma L que el techo, con sus esquinas", True))
tiers.append(note({"poly": lroof(0), "z": [Z_ROOF0, Z_ROOF1], "wall": "acBand", "cap": "acRim"},
                  "LA LOSA DEL TECHO, una sola en L: vuela con sus esquinas redondas y su canto azul, y su tapa blanca es el reborde", True))
tiers.append(note({"poly": lroof(RIM), "z": [Z_ROOF1, r2(Z_ROOF1 + 0.06)], "wall": "acRim", "cap": "acRoof",
                   "capText": {"lines": ["BOMBA Y", "REPUESTOS", "ACON"], "atM": B((GAP + ARM_U1) / 2, (MAIN_V0 + ARM_V1) / 2),
                               "heightM": 1.1, "maxWM": r2(ARM_U1 - GAP - 0.6), "ink": "acRim"}},
                  "…y el techo plano celeste, adentro del reborde blanco (el satélite), con el NOMBRE PINTADO encima en vez de la píldora, como el del DJ sobre su dosel", True))
tiers.append(note({"box": [r2(BACK_U1 - BACK_U0), r2(BACK_V1 - BAND_V1)], "at": B((BACK_U0 + BACK_U1) / 2, (BAND_V1 + BACK_V1) / 2),
                   "z": [0, r2(Z_SLAB[0] - 0.5)], "wall": "acBlue", "cap": "acZinc", "bands": [[0, r2(Z_BASE / (Z_SLAB[0] - 0.5)), "acBase"]],
                   "roof": {"kind": "shed", "high": "w", "riseM": 0.5, "ink": "acZinc", "ink2": "acZincShade", "seamsM": 0.7}},
                  "el ala de atrás, a un piso, bajo su zinc rojo (el satélite: llena el hueco de la L)", True))
tiers.append(note({"box": [r2(LEAN_U1 - LEAN_U0), r2(LEAN_V1 - LEAN_V0)], "at": B((LEAN_U0 + LEAN_U1) / 2, (LEAN_V0 + LEAN_V1) / 2),
                   "z": [0, 2.9], "wall": "acBlue", "cap": "acFlatRoof", "bands": [[0, r2(Z_BASE / 2.9), "acBase"]],
                   "openings": [{"edge": 1, "f": [0.08, 0.55], "z": [0.9, 2.5], "ink": "acGrille"},
                                {"edge": 1, "f": [0.64, 0.88], "z": [0.05, Z_DOOR[1]], "ink": "acDoorBlue"}],
                   "roof": {"kind": "shed", "high": "w", "riseM": 0.35, "ink": "acFlatRoof", "ink2": "acRollGrey", "seamsM": 0.6}},
                  "el porche de reja del lado de la entrada, con su puerta azul bajo un alerito claro (la vista del portón; la franja blanca del satélite)", True))
a, b = wfV(C4["alero"]["x"][0]), wfV(C4["alero"]["x"][1])
tiers.append(note({"poly": quad(GAP, a, GAP + 0.5, b), "z": Z_ALERO, "wall": "acTileDark", "cap": "acTile"},
                  "el alerito de teja sobre la puerta de rombos, pegado a la pared", True))
pa, pb = wfV(C4["pillar"]["x"][0]), wfV(C4["pillar"]["x"][1])
tiers.append(note({"poly": quad(GAP, r2(min(pa, ARM_V1 - 0.55)), GAP + 0.5, ARM_V1), "z": [0, Z_SLAB[1]], "wall": "acColumn", "cap": "acColumn"},
                  "el pilar azul del suroeste, donde empieza la malla del patio", True))

# ═════════════════ LA BAHÍA: el cuerpo de adelante, más angosto que el bloque ═════════════════
# la vieja bahía de las bombas: hoy la cierra una cortina entre sus dos columnas y rejas a los lados
tiers.append(note({"poly": quad(BAY_U0, BAY_V0, BAY_U1, BAY_V1), "z": [0, Z_BAYSLAB[0]], "wall": "acBlue", "cap": "acSlab",
                   "bands": [[0, r2(Z_BASE / Z_BAYSLAB[0]), "acBase"]],
                   "openings": [{"edge": 0, "f": [0.07, 0.93], "z": [0.1, Z_SHUTTER], "ink": "acShutter", "roll": {"inside": "acBayInside", "slat": "acShutterSlat"}},
                                {"edge": 1, "f": [0.05, 0.95], "z": [0.1, Z_SHUTTER], "ink": "acGrille"},
                                {"edge": 3, "f": [0.05, 0.95], "z": [0.1, Z_SHUTTER], "ink": "acGrille"}]},
                  "LA BAHÍA, por donde pasaban los carros a la bomba (la vista de la avenida, en perspectiva): ~4,3 m de ancho en el medio del frente, sale ~6,5 m adelante del bloque. Su CORTINA entre las columnas se enrolla con el día (`roll`): abierta de día, baja al atardecer y sube al amanecer; una reja a cada lado", True))
for i, uu in enumerate((BAY_U0, BAY_U1)):
    tiers.append(note({"disc": 0.24, "n": 12, "at": B(uu, BAY_V0), "z": [0, Z_BAYSLAB[0]], "wall": "acColumn", "cap": "acColumn"},
                      "las dos columnas redondas azules en las esquinas de la bahía (la foto vieja y la de hoy)", i == 0))

# ═════════════════ EL BALCÓN DE LAS PLANTAS y el puente: van encima del carro ═════════════════
S0, S1 = r2(BAY_U0 - SLAB_OUT_W), r2(BAY_U1 + SLAB_OUT_E)
SV0 = r2(BAY_V0 - SLAB_OUT_N)
slab, se = rounded(S0, SV0, S1, BAY_V1, {"nw": 0.7, "ne": 0.7})
tiers.append(note({"poly": slab, "z": Z_BAYSLAB, "wall": "acFascia", "cap": "acSlab", "decal": {"edges": [se["w"]], "key": "bomba"}},
                   "EL BALCÓN: la losa de la bahía, que vuela más allá de sus columnas con las puntas redondas; su canto de CALLE 4 dice BOMBA ACON S.A. (la foto vieja, tomada desde Calle 4). Va con los demás bloques, ordenado por su altura: encima de todo, como antes, quedaba encima del techo del bloque", True))
PT = 0.16                                                    # el pretil, sobre el borde de la bahía
Z_PRETIL = [Z_BAYSLAB[1], Z_SILL[1]]
pretil_bands = [[r2((Z_SILL[0] - Z_PRETIL[0]) / (Z_PRETIL[1] - Z_PRETIL[0])), 1.0, "acBand"]]
for i, poly in enumerate((quad(BAY_U0, BAY_V0, BAY_U1, BAY_V0 + PT), quad(BAY_U0, BAY_V0, BAY_U0 + PT, BAY_V1), quad(BAY_U1 - PT, BAY_V0, BAY_U1, BAY_V1))):
    tiers.append(note({"poly": poly, "z": Z_PRETIL, "wall": "acBlue", "cap": "acBand", "bands": pretil_bands},
                       "el pretil del balcón, sobre el borde de la bahía: su banda azul de arriba sigue alrededor del bloque como la banda bajo las ventanas", i == 0))
# las matas, en la esquina noroeste del balcón, al cielo (la foto vieja y las de hoy)
POTS = [(0.55, 0.55, 0.62, 1.25), (1.45, 0.5, 0.5, 0.95), (0.5, 1.5, 0.55, 1.1), (0.55, 2.55, 0.48, 0.9), (2.4, 0.52, 0.45, 0.85), (0.52, 3.6, 0.4, 0.8)]
for i, (du, dv, rad, hz) in enumerate(POTS):
    uu, vv = BAY_U0 + PT + du, BAY_V0 + PT + dv
    tiers.append(note({"box": [0.8, 0.6], "at": B(uu, vv), "z": [Z_BAYSLAB[1], r2(Z_BAYSLAB[1] + 0.35)], "wall": "acPlanter", "cap": "acSoil"},
                       "LAS MACETAS DEL BALCÓN, de barro, en su esquina noroeste", i == 0))
    tiers.append(note({"disc": rad, "n": 9, "at": B(uu + (0.08 if i % 2 else -0.08), vv), "z": [r2(Z_BAYSLAB[1] + 0.35), r2(Z_BAYSLAB[1] + hz)],
                        "wall": "acPlant", "cap": "acPlantLight"}, "y sus matas, al cielo", i == 0))
# el puente del segundo piso sobre la entrada del patio, con su techo de teja, sobre el portón negro
BR_V0, BR_V1 = r2(WHITE_V1 - 1.6), WHITE_V1
overhead.append(note({"box": [r2(U_DRIVE1 - U_DRIVE0 + 0.4), r2(BR_V1 - BR_V0)], "at": B((U_DRIVE0 + U_DRIVE1) / 2, (BR_V0 + BR_V1) / 2),
                      "z": [Z_SLAB[0], r2(Z_ROOF0 - 0.5)], "wall": "acWhite", "cap": "acTile",
                      "bands": [[0, 0.12, "acBand"]], "windows": {"z": [r2(Z_SLAB[1] + 0.7), r2(Z_ROOF0 - 0.95)], "wM": 0.9, "everyM": 1.4, "ink": "acGlass"},
                      "roof": {"kind": "gable", "axis": "x", "riseM": 0.7, "ink": "acTile", "ink2": "acTileDark", "seamsM": 0.35}},
                     "EL PUENTE del segundo piso sobre la entrada del patio, justo encima del portón (las vistas del portón): blanco con su banda azul, ventanas, y techo de teja", True))
for i, uu in enumerate((U_DRIVE0 + 0.2, U_DRIVE1 - 0.2)):
    tiers.append(note({"box": [0.4, 0.4], "at": B(uu, BR_V1 - 0.2), "z": [0, Z_SLAB[0]], "wall": "acWhite", "cap": "acWhite", "bands": [[0, 0.25, "acBand"]]},
                      "los pilares del portón negro bajo el puente, abierto: por ahí sigue el carril al patio", i == 0))

# ═════════════════ EL EDIFICIO BLANCO DEL BALCÓN, contra la acera de la avenida ═════════════════
Z_W1, Z_W2 = 3.4, 6.4
gf, ge = rounded(WHITE_U0, WHITE_V0, WHITE_U1, WHITE_V1, {"nw": WHITE_R})
wn_lo, wn_hi = WHITE_U0 + WHITE_R, WHITE_U1
wops = []
for (a, b, door) in ((0.10, 0.22, False), (0.30, 0.40, True), (0.52, 0.80, True), (0.86, 0.96, False)):
    ua, ub_ = wn_lo + (wn_hi - wn_lo) * a, wn_lo + (wn_hi - wn_lo) * b
    wops.append({"edge": ge["n"], "f": on_edge(wn_lo, wn_hi, ua, ub_), "z": [0.05, 2.75] if door else [0.95, 2.4], "ink": "acDoorPale" if door else "acLattice"})
for k in range(6):
    c = 0.1 + 0.8 * (k + 0.5) / 6
    door = k % 2 == 1
    wops.append({"edge": ge["w"], "f": [r2(c - 0.04), r2(c + 0.04)], "z": [0.05, 2.6] if door else [0.95, 2.4], "ink": "acDoorPale" if door else "acLattice"})
tiers.append(note({"poly": gf, "z": [0, Z_W1], "wall": "acWhite", "cap": "acSlab",
                   "bands": [[0, 0.22, "acBase"], [0.93, 1.0, "acGreen"]], "openings": wops},
                  "EL EDIFICIO BLANCO, la planta baja contra la acera (las vistas de calle): zócalo azul, celosías y puertas celestes contra la entrada y la avenida, y el canto verde de la losa del balcón; su esquina de la entrada es REDONDA (el satélite)", True))
UP_U0, UP_V0 = r2(WHITE_U0 + 1.2), r2(WHITE_V0 + 1.2)
tiers.append(note({"box": [r2(WHITE_U1 - UP_U0), r2(WHITE_V1 - UP_V0)], "at": B((UP_U0 + WHITE_U1) / 2, (UP_V0 + WHITE_V1) / 2),
                   "z": [Z_W1, Z_W2], "wall": "acWhite", "cap": "acSlab",
                   "windows": {"z": [4.1, 5.75], "wM": 0.85, "everyM": 2.1, "ink": "acGlass"}, "bands": [[0.9, 0.95, "acVent"]]},
                  "el segundo piso, retirado detrás del balcón, con sus ventanas altas y la fila de respiraderos bajo el alero", True))
posts = []
for k in range(int((WHITE_U1 - WHITE_U0 - WHITE_R) // 1.8) + 1):
    posts.append((WHITE_U0 + WHITE_R + 0.2 + k * 1.8, WHITE_V0 + 0.15))
for k in range(int((WHITE_V1 - WHITE_V0 - WHITE_R) // 1.8) + 1):
    posts.append((WHITE_U0 + 0.15, WHITE_V0 + WHITE_R + 0.2 + k * 1.8))
for i, (uu, vv) in enumerate(posts):
    tiers.append(note({"box": [0.16, 0.16], "at": B(uu, vv), "z": [Z_W1, r2(Z_W1 + 1.0)], "wall": "acRailPost", "cap": "acRailPost"},
                      "la baranda del balcón: los postes azules", i == 0))
tiers.append(note({"poly": quad(WHITE_U0 + WHITE_R, WHITE_V0 + 0.1, WHITE_U1, WHITE_V0 + 0.2), "z": [r2(Z_W1 + 0.9), r2(Z_W1 + 1.02)], "wall": "acRail", "cap": "acRail"},
                  "…y el pasamanos blanco", True))
tiers.append({"poly": quad(WHITE_U0 + 0.1, WHITE_V0 + WHITE_R, WHITE_U0 + 0.2, WHITE_V1), "z": [r2(Z_W1 + 0.9), r2(Z_W1 + 1.02)], "wall": "acRail", "cap": "acRail"})
tiers.append(note({"box": [r2(WHITE_U1 - UP_U0 + 1.0), r2(WHITE_V1 - UP_V0 + 1.0)], "at": B((UP_U0 + WHITE_U1) / 2, (UP_V0 + WHITE_V1) / 2),
                   "z": [Z_W2, r2(Z_W2 + 0.12)], "wall": "acRim", "cap": "acZinc",
                   "roof": {"kind": "hip", "riseM": 1.7, "ink": "acZinc", "ink2": "acZincShade", "seamsM": 0.6}},
                  "el techo a cuatro aguas de zinc rojo, con su alero ancho", True))

# ═════════════════ EL TALLER DE ATRÁS ═════════════════
tiers.append(note({"box": [r2(WS_U1 - WS_U0), r2(WS_V1 - WS_V0)], "at": B((WS_U0 + WS_U1) / 2, (WS_V0 + WS_V1) / 2),
                   "z": [0, 3.8], "wall": "acShed", "cap": "acWorkshop",
                   "roof": {"kind": "shed", "high": "e", "riseM": 0.7, "ink": "acWorkshop", "ink2": "acWorkshopShade", "seamsM": 0.8}},
                  "el taller detrás del edificio blanco, bajo su techo gris verdoso (el satélite)", True))
for k in range(S["workshop"]["skylights"]):
    uu = WS_U0 + (k % 3 + 0.5) * (WS_U1 - WS_U0) / 3
    vv = WS_V0 + (k // 3 + 0.5) * (WS_V1 - WS_V0) / 2
    tiers.append(note({"box": [1.3, 0.8], "at": B(uu, vv), "z": [4.15, 4.3], "wall": "acSkylight", "cap": "acSkylight"},
                      "sus seis tragaluces", k == 0))

# ═════════════════ EL PATIO: carriles de entrada y salida a Calle 4, con la isla de la vieja bomba ═════════════════
yard = DRIVE["yard"]
MID_V = r2((yard[1] + yard[3]) / 2)                     # la raya entre los dos carriles
ISL0, ISL1 = 1.2, 5.6                                   # la isla, cerca de Calle 4, entre los dos portones
KY = 2.0 / (YD["fenceY"][1] - YD["fenceY"][0])          # la malla del patio: 2,0 m
PUMP_Z = r2((YD["pump"]["y"][1] - YD["pump"]["y"][0]) * KY)
tiers.append(note({"box": [0.62, 0.62], "at": B((ISL0 + ISL1) / 2, MID_V), "z": [0.18, PUMP_Z], "wall": "acColumn", "cap": "acBlue",
                   "bands": [[0.9, 1.0, "acRim"]]},
                  "LA VIEJA BOMBA del patio (la vista desde Calle 4): la columna azul con su capitel, en su isla entre los carriles", True))
tiers.append(note({"box": [1.0, 0.85], "at": B((ISL0 + ISL1) / 2, MID_V), "z": [r2(PUMP_Z), r2(PUMP_Z + 0.22)], "wall": "acBlue", "cap": "acRim"},
                  "…y su capitel", True))
low.append(note({"box": [r2(ISL1 - ISL0), 1.1], "at": B((ISL0 + ISL1) / 2, MID_V), "z": [0, 0.18], "wall": "acKerb", "cap": "acIsland"},
                "la isla, con su cordón amarillo", True))
for i, uu in enumerate((ISL0 + 0.25, ISL1 - 0.25)):
    for j, dv in enumerate((-0.35, 0.35)):
        low.append(note({"disc": 0.13, "n": 8, "at": B(uu, MID_V + dv), "z": [0, 0.9], "wall": "acKerb", "cap": "acKerb",
                         "bands": [[0.2, 0.4, "acStripe"], [0.6, 0.8, "acStripe"]]},
                        "los bolardos a rayas amarillas y negras", i == 0 and j == 0))
low.append(note({"poly": quad(yard[0], yard[1], yard[2], yard[3]), "z": [0, 0.02], "wall": "acYard", "cap": "acYard"},
                "el patio de atrás, de concreto más gastado", True))
# LOS CARRILES (no es un parqueo): la raya de en medio, discontinua, de Calle 4 hasta la entrada,
# las flechas de ENTRADA —por el carril sur, hacia adentro— y de salida —por el norte, hacia Calle 4—
for k in range(int((yard[2] - ISL1 - 1.0) // 2.0)):
    uu = ISL1 + 1.0 + k * 2.0
    low.append(note({"box": [1.1, 0.14], "at": B(uu, MID_V), "z": [0.02, 0.04], "wall": "acKerb", "cap": "acKerb"},
                    "la raya discontinua entre el carril de entrada y el de salida", k == 0))
DRV_MID = r2((U_DRIVE0 + U_DRIVE1) / 2)
for k in range(int((BR_V0 - 1.0) // 2.0)):
    low.append({"box": [0.14, 1.1], "at": B(DRV_MID, 1.0 + k * 2.0), "z": [0.02, 0.04], "wall": "acKerb", "cap": "acKerb"})


def arrow(u, v, du, dv, size=1.6):
    """una flecha pintada en el piso, en el lote: (u, v) su centro, (du, dv) hacia dónde apunta"""
    L = math.hypot(du, dv); du, dv = du / L, dv / L
    nu, nv = -dv, du
    h, w, hw = size, size * 0.22, size * 0.45
    pts = [(-h / 2, -w), (h * 0.1, -w), (h * 0.1, -hw), (h / 2, 0), (h * 0.1, hw), (h * 0.1, w), (-h / 2, w)]
    return [B(u + du * a + nu * b, v + dv * a + nv * b) for a, b in pts]


for i, (u, v, du, dv) in enumerate(((ISL0 + 0.6, MID_V + 2.0, 1, 0), (ISL1 + 3.0, MID_V + 2.0, 1, 0),
                                    (ISL1 + 3.0, MID_V - 2.0, -1, 0), (ISL0 + 0.6, MID_V - 2.0, -1, 0),
                                    (DRV_MID - 1.7, 2.0, 0, 1), (DRV_MID + 1.7, BR_V0 - 1.5, 0, -1))):
    low.append(note({"poly": arrow(u, v, du, dv), "z": [0.03, 0.05], "wall": "acKerb", "cap": "acKerb"},
                    "las flechas de los carriles: ENTRADA por el sur hacia adentro, salida por el norte hacia Calle 4 (que corre al norte), y en la entrada del patio", i == 0))
# la malla amarilla sobre Calle 4: sus tramos y postes a los lados de los dos portones, ABIERTOS
for i, (v0, v1) in enumerate(((yard[1] + 0.05, yard[1] + 0.35), (yard[3] - 0.35, yard[3] - 0.05))):
    tiers.append(note({"poly": quad(0.0, v0, 0.22, v1), "z": [0, 2.0], "wall": "acFence", "cap": "acFence"},
                      "la malla amarilla de Calle 4: los postes de sus dos portones, abiertos para los carriles", i == 0))

# ═════════════════ EL PISO DE ADELANTE: el cordón amarillo, los bolardos y las maceteras ═════════════════
low.append(note({"poly": quad(BAY_U0 - 0.6, r2(BAY_V0 - 0.45), BAY_U1 + 1.8, r2(BAY_V0 - 0.1)), "z": [0, 0.15], "wall": "acKerb", "cap": "acKerb"},
                "el cordón amarillo delante de la cortina, donde estaba la isla de las bombas (la foto vieja y la de hoy)", True))
for i, uu in enumerate((BAY_U0 - 0.45, BAY_U1 + 0.6, BAY_U1 + 1.1, BAY_U1 + 1.6)):
    low.append(note({"disc": 0.12, "n": 8, "at": B(uu, r2(BAY_V0 - 0.27)), "z": [0, 0.95], "wall": "acKerb", "cap": "acKerb"},
                    "los bolardos amarillos a los lados de la bahía", i == 0))
for i, (u0, u1) in enumerate(((GAP + 0.3, BAY_U0 - 0.3), (BAY_U1 + 0.3, MAIN_U1 - 0.4))):
    low.append(note({"poly": quad(u0, r2(MAIN_V0 - 0.4), u1, MAIN_V0), "z": [0, 0.15], "wall": "acKerb", "cap": "acKerb"},
                    "el cordón amarillo al pie de la cara del bloque, a los dos lados de la bahía", i == 0))
low.append(note({"poly": quad(WHITE_U0 + WHITE_R + 0.2, r2(WHITE_V1 - 0.45), WHITE_U1 - 0.2, r2(WHITE_V1 - 0.1)), "z": [0, 0.3], "wall": "acKerb", "cap": "acKerb"},
                "las maceteras de cordón amarillo al pie del edificio blanco, del lado del patio", True))

# lo que se para no se para encima de lo manejable (salvo lo que vuela, que es `overhead`)
for name, (a0, b0, a1, b1) in (("la bahía", (BAY_U0, BAY_V0, BAY_U1, BAY_V1)), ("el porche", (LEAN_U0, LEAN_V0, LEAN_U1, LEAN_V1)),
                               ("el bloque", (GAP, MAIN_V0, MAIN_U1, BAND_V1)), ("el edificio blanco", (WHITE_U0, WHITE_V0, WHITE_U1, WHITE_V1))):
    for did, (d0, e0, d1, e1) in DRIVE.items():
        if a0 < d1 - 0.05 and a1 > d0 + 0.05 and b0 < e1 - 0.05 and b1 > e0 + 0.05:
            raise SystemExit(f"[acon] {name} se para sobre lo manejable «{did}»: corregí `drive` en content/world/historic.json")

body = {
    "_note": "LA BOMBA Y LOS REPUESTOS ACON, en la esquina de Calle 4 y la avenida: el bloque streamline celeste a dos pisos —que es también los Repuestos Acón— con la BAHÍA de las bombas adelante, más angosta y hoy cerrada con una cortina, y encima el balcón de las macetas cuya losa dice BOMBA ACON S.A. en su canto de Calle 4; el patio con sus carriles de entrada y salida a Calle 4, la isla de la vieja bomba y el puente de teja sobre la entrada; y el edificio blanco del balcón de esquina redonda, contra la acera. CALCADO de sus imágenes (`tools/acon_trace.json`, las caras en perspectiva); lo escribe `tools/gen_acon_body.py`. Lo manejable: `content/world/historic.json → acon.drive`.",
    "perspective": True,
    "tiers": tiers, "overhead": overhead, "low": low, "placeM": [0, 0],
    "ground": {"polyM": [B(-0.3, -0.3), B(LU + 0.3, -0.3), B(LU + 0.3, LV + 0.3), B(-0.3, LV + 0.3)], "ink": "acConcrete",
               "_": "el concreto de todo el lote —el frente de la bomba, la entrada y el patio, y la franja contra la acera de Calle 4—, corrido con Calle 4 como el lote: un rectángulo dejaba asomar una cuña de tierra en la esquina. Se mete 0,3 m bajo las aceras (que se pintan después) para que en el borde no asome una raya de tierra"},
}


def overlay():
    """vuelve a dibujar lo calcado encima de las imágenes, para revisarlo a ojo"""
    from PIL import Image, ImageDraw
    base = os.path.join(ROOT, "logs", "acon")
    sat = Image.open(os.path.join(base, S["image"])).convert("RGB")
    d = ImageDraw.Draw(sat)
    box = lambda r, c, w=3: d.rectangle([r["x"][0], r["y"][0], r["x"][1], r["y"][1]], outline=c, width=w)
    d.line([S["calle4LineX"], 1000, S["calle4LineX"], 2000], fill=(255, 255, 0), width=2)
    d.line([0, S["avenueLineY"], 1228, S["avenueLineY"]], fill=(255, 255, 0), width=2)
    for key, c in (("canopy", (255, 60, 60)), ("mainBand", (0, 255, 255)), ("arm", (0, 200, 255)), ("backWing", (255, 140, 0)),
                   ("leanTo", (255, 0, 255)), ("white", (255, 255, 255)), ("yard", (180, 255, 120)), ("workshop", (120, 255, 200))):
        box(S[key], c)
    for x in S["driveway"]["x"]:
        d.line([x, 1100, x, 1500], fill=(255, 0, 255), width=2)
    # la bahía reconstruida desde la vista de calle, devuelta al satélite: tiene que caer bajo la marquesina
    k = S["pxPerM"]
    bx0, bx1 = S["calle4LineX"] + BAY_U0 / SC * k, S["calle4LineX"] + BAY_U1 / SC * k
    by0, by1 = S["avenueLineY"] + BAY_V0 / SC * k, S["avenueLineY"] + BAY_V1 / SC * k
    d.rectangle([bx0, by0, bx1, by1], outline=(0, 255, 0), width=3)
    sat.crop((0, 1000, sat.width, 1900)).save(os.path.join(base, "trace-satellite.png"))
    av = Image.open(os.path.join(base, AV["image"])).convert("RGB"); d = ImageDraw.Draw(av)
    d.line([0, HY, av.width, HY], fill=(255, 0, 255), width=2)
    for key, pt in AV["ground"].items():
        if key.startswith("_"):
            continue
        x, y = pt
        d.ellipse([x - 9, y - 9, x + 9, y + 9], outline=(255, 255, 0), width=3)
        d.line([x, y, AV["southVPX"], HY], fill=(0, 255, 255), width=1)
    for y in (*AV["bayFront"]["slabY"], *AV["bayFront"]["parapetY"]):
        d.line([AV["ground"]["colNE"][0] - 200, y, AV["ground"]["colNW"][0] + 150, y], fill=(255, 120, 0), width=2)
    for y in (*AV["mainFace"]["slabY"], *AV["mainFace"]["sillY"], *AV["mainFace"]["windowsY"], *AV["mainFace"]["roofY"]):
        d.line([AV["ground"]["bayJoin"][0], y, AV["ground"]["cornerNW"][0], y], fill=(0, 255, 0), width=2)
    r = AV["mainFace"]["celosia"]; d.rectangle([r["x"][0], r["y"][0], r["x"][1], r["y"][1]], outline=(255, 255, 0), width=3)
    av.save(os.path.join(base, "trace-avenue.png"))
    c4 = Image.open(os.path.join(base, C4["image"])).convert("RGB"); d = ImageDraw.Draw(c4)
    d.line([0, C4["horizonY"], c4.width, C4["horizonY"]], fill=(255, 0, 255), width=2)
    d.line([C4_VP, C4["horizonY"], _x1, yb_c4(_x1)], fill=(0, 255, 255), width=2)
    for x in (_x0, _x1):
        d.line([x, 0, x, c4.height], fill=(255, 255, 0), width=2)
    for x0, x1 in C4["garage"]:
        d.rectangle([x0, C4["horizonY"], x1, yb_c4(x1)], outline=(255, 255, 0), width=3)
    r = C4["door"]; d.rectangle([r["x"][0], r["y"][0], r["x"][1], r["y"][1]], outline=(0, 255, 255), width=3)
    for (x0, x1), (y0, y1) in zip(C4["upperWindows"], C4["upperWindowsY"]):
        d.rectangle([x0, y0, x1, y1], outline=(0, 255, 0), width=3)
    c4.save(os.path.join(base, "trace-calle4.png"))
    op = Image.open(os.path.join(base, OP["image"])).convert("RGB"); d = ImageDraw.Draw(op)
    for key, c in (("canto", (255, 120, 0)), ("fascia", (255, 255, 0)), ("column", (0, 255, 255)), ("island", (255, 0, 255)), ("plants", (0, 255, 0))):
        r = OP[key]; d.rectangle([r["x"][0], r["y"][0], r["x"][1], r["y"][1]], outline=c, width=4)
    op.save(os.path.join(base, "trace-old-photo.png"))
    yd = Image.open(os.path.join(base, YD["image"])).convert("RGB"); d = ImageDraw.Draw(yd)
    for x0, x1 in YD["gates"]:
        d.rectangle([x0, YD["fenceY"][0], x1, YD["fenceY"][1]], outline=(255, 255, 0), width=3)
    for key, c in (("pump", (0, 200, 255)), ("bollards", (255, 0, 255)), ("arrowOut", (255, 255, 255)), ("arrowIn", (255, 255, 255))):
        r = YD[key]; d.rectangle([r["x"][0], r["y"][0], r["x"][1], r["y"][1]], outline=c, width=3)
    yd.save(os.path.join(base, "trace-yard.png"))
    print("[acon] overlay -> logs/acon/trace-satellite.png, trace-avenue.png, trace-calle4.png, trace-old-photo.png, trace-yard.png")


if __name__ == "__main__":
    # como `gen_mercado_body.py`: un generador de un asset del juego, no un cruce del builder (`tests/test_game_root.py`)
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "assets", "world-props.json")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    line = '    "acon": ' + json.dumps(body, ensure_ascii=False) + ","
    if re.search(r'^    "acon": \{.*\},$', text, flags=re.M):
        new, n = re.subn(r'^    "acon": \{.*\},$', lambda m: line, text, count=1, flags=re.M)
    else:                                   # la primera vez: va justo antes de la UTN, junto al Mercado
        new, n = re.subn(r'^(    "utn": \{)', lambda m: line + "\n" + m.group(1), text, count=1, flags=re.M)
    assert n == 1, "no encontré dónde va bodies.acon"
    json.loads(new)
    if "--check" not in sys.argv:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new)
    print(f"[acon] {len(tiers)} bloques, {len(overhead)} encima del carro, {len(low)} en el piso; escala {r2(SC)}; "
          f"bloque {r2(MAIN_U1 - GAP)} m de frente desde {GAP} m de la acera de Calle 4, su cara a {MAIN_V0} m de la avenida (corrido {r2(DV)} m hasta el portón); bahía {r2(BAY_U1 - BAY_U0)} x {r2(BAY_V1 - BAY_V0)} m "
          f"(de verdad {r2((BAY_U1 - BAY_U0) / SC)} x {r2(BAY_DEPTH_R)}), su frente a {BAY_V0} m; blanco {r2(WHITE_U1 - WHITE_U0)} x {r2(WHITE_V1 - WHITE_V0)} m")
    print(f"[acon] alturas: losa {Z_SLAB}, banda {Z_SILL}, ventanas {Z_WIN}, techo {Z_ROOF0}/{Z_ROOF1}; bahía: cortina {Z_SHUTTER}, losa {Z_BAYSLAB}, "
          f"pretil hasta {Z_SILL[1]}; Calle 4: portones {Z_GARAGE}, reja hasta {Z_GRILLE}, puerta {Z_DOOR}; cámaras {r2(CAM_A)} / {C4['camM']} m, focal {round(FA)} px "
          f"-> {os.path.relpath(path)}")
    if "--overlay" in sys.argv:
        overlay()
