#!/usr/bin/env python3
"""EL ANTIGUO MATADERO MUNICIPAL COMO CUERPOS DE RECETA: escribe `world-props.json → bodies.matadero` (el
salón de 1901) y `bodies.matadero_muro` (el recinto sobre Calle 10).

    python3 tools/gen_matadero_body.py             # escribe las dos recetas
    python3 tools/gen_matadero_body.py --overlay   # además dibuja lo calcado sobre las imágenes (logs/matadero/)

LAS MEDIDAS NO SE LEEN A OJO: están calcadas en PÍXELES en `tools/matadero_trace.json`, imagen por imagen, y
aquí se pasan a metros, como la ACON (`gen_acon_body.py`) y el Mercado. Si una marca del `--overlay` no cae
sobre lo que dice, el número está mal, y se corrige en el calco, no aquí.

* EL SALÓN CIERRA LA PUNTA DE CALLE 10: su fachada mira al SUR, por Calle 10 abajo, y la avenida que dobla
  al oeste le pasa por delante. Es un lote sobre UNA calle (`content/world/historic.json → matadero`, con
  `side: null`): `u` corre al OESTE por la avenida desde su punta del este, y `v` entra al norte. La
  fachada sale de la vista de calle, casi de frente (100 px por metro): su ancho se aprieta un 8 % para
  caber con el portón del costado, las alturas no. El techo sale del satélite: sube de los cuatro aleros a
  una cumbrera en anillo y baja a un patio de luz, en ocho faldones (`facet`); el fondo se aprieta para
  llegar antes que el estero.
* EL RECINTO (`matadero_muro`) va a lo largo de Calle 10, de la avenida a la curva: el muro de círculos y
  arcos ciegos con su esquina redonda, el cuerpo de la ventana grande, la nave larga detrás del muro, los
  bloques bajos y el patio con su almendro. Su muro de Calle 10 SIGUE fuera del lote, al norte de la curva,
  hasta el portón del costado del salón: el suelo de en medio es de la Antigua Fábrica de Hielo. Dónde
  queda esa esquina lo dicen los dos marcos medidos contra el mundo (`tools/emit_historic.py`).

Marcos: los de los lotes `hist_matadero` y `hist_matadero_muro` (`parcelFrame`), en metros desde su
centro. Aristas de una `box`/`quad`: 0 la de `v` chica (el frente a la calle), 1 la de `u` grande, 2 la de
`v` grande, 3 la de `u` chica.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import emit_historic as EH  # noqa: E402  — los dos marcos, medidos contra el mundo emitido como en el emit

T = json.load(open(os.path.join(ROOT, "tools", "matadero_trace.json"), encoding="utf-8"))
HIST = json.load(open(os.path.join(ROOT, "content", "world", "historic.json"), encoding="utf-8"))
PH = next(p for p in HIST["places"] if p["id"] == "matadero")
PM = next(p for p in HIST["places"] if p["id"] == "matadero_muro")
FA, HA, WA, CA = T["facade"], T["hall"], T["wall"], T["compound"]
r2 = lambda v: round(v, 2)
avg = lambda *xs: sum(xs) / len(xs)


def note(t, text, first):
    return {"_": text, **t} if first else t


def on_edge(lo, hi, a, b):
    """fracción [f0, f1] de una arista que va de `lo` a `hi` (metros) para el tramo [a, b]"""
    L = hi - lo
    f0, f1 = (a - lo) / L, (b - lo) / L
    return [round(min(f0, f1), 3), round(max(f0, f1), 3)]


# ── DÓNDE SE JUNTAN LOS DOS LOTES: el muro de Calle 10 del recinto llega a la línea de la fachada ─────────
_W = EH.World()
FB, FM = EH.frame_of(_W, PH), EH.frame_of(_W, PM)
FM["useSlope"] = PM.get("sideSlope", 0.0)
WALL_T, WALL_V = WA["thickM"], 0.45                  # el grueso del muro; su eje, a 0,45 m de la acera de Calle 10
CORNER_R, LAWN = WA["cornerRM"], WA["lawnM"]
HALL_SETBACK = HA["setbackM"]
GATE_FRONT = 0.3                                     # retiro del portón respecto a la fachada


def _uv(F, x, y, slope=0.0):
    """px de mundo → (u, v) metros de un marco (el `at` de `emit_historic` al revés)"""
    (cx, cy), (ux, uy), (vx, vy), k = F["corner"], F["u"], F["v"], _W.ppm
    dx, dy = (x - cx) / k, (y - cy) / k
    v = dx * vx + dy * vy
    return dx * ux + dy * uy - slope * v, v


def _cross_u(F_line, F_on, v_on, slope_on=0.0, v_line=0.0):
    """la `u` de `F_on` (a `v_on` fija) donde su recta corta la línea `v_line` de `F_line`"""
    a = EH.at(_W, {**F_on, "useSlope": slope_on}, 0.0, v_on)
    b = EH.at(_W, {**F_on, "useSlope": slope_on}, 100.0, v_on)
    da = _uv(F_line, *a)[1]
    db = _uv(F_line, *b)[1]
    return 100.0 * (da - v_line) / (da - db)


U_KERB = _cross_u(FB, FM, WALL_V, FM["useSlope"])
U_FACADE = r2(_cross_u(FB, FM, WALL_V, FM["useSlope"], HALL_SETBACK))
U_GATE = _cross_u(FB, FM, WALL_V, FM["useSlope"], HALL_SETBACK + GATE_FRONT)
_px = EH.at(_W, FM, U_GATE, WALL_V)
U_GATE_E = r2(_uv(FB, *_px)[0])                           # en el salón: la u (negativa) del muro del recinto

# ═════════════════════════════════════ EL SALÓN DE 1901 ═════════════════════════════════════
LU, LV = PH["lotM"]
OU, OV = LU / 2, LV / 2
BH = lambda u, v: [r2(u - OU), r2(v - OV)]
HB = lambda u, v: BH(u, v + HALL_SETBACK)


def qh(u0, v0, u1, v1):
    return [HB(u0, v0), HB(u1, v0), HB(u1, v1), HB(u0, v1)]


GATE_W = 2.6                                          # la punta del este: el portón del costado (sigue al este, fuera del lote)
HU0, HU1 = GATE_W, LU                                 # la fachada, de su punta del este a la del oeste
PXF = (FA["endsX"][1] - FA["endsX"][0]) / FA["widthM"]  # px por metro de la vista, de frente
SF = (HU1 - HU0) / FA["widthM"]                       # la fachada se aprieta a lo ancho, nunca a lo alto
fz = lambda y: r2((FA["groundY"] - y) / PXF)           # una altura de la vista
fu = lambda x: HU0 + (FA["endsX"][1] - x) / PXF * SF   # una x de la vista → u (u crece al OESTE: x baja)
Z_PLINTH = fz(FA["plinthTopY"])
Z_COR = [fz(FA["corniceY"][1]), fz(FA["corniceY"][0])]
Z_FASCIA = HA["fasciaM"]
Z_WALL, Z_RIDGE = HA["wallM"], HA["ridgeM"]
Z_EAVE = Z_FASCIA[1]
FW = 0.7                                              # el grueso de la fachada: la nave arranca detrás
HV1 = r2(LV - 0.4 - HALL_SETBACK)                     # conserva el muro del fondo antes del estero
hall_tiers, hall_low = [], []


def fspan(x0, x1, lo=HU0, hi=HU1):
    """un tramo [x0, x1] de la vista → fracción de una arista que va de `lo` a `hi` por la fachada"""
    return on_edge(lo, hi, fu(x1), fu(x0))


# la fachada: el muro, con su zócalo durazno y lo que tiene pintado y abierto
fops = []
for (x0, x1) in FA["panels"]:
    fops.append({"edge": 0, "f": fspan(x0, x1), "z": [fz(FA["panelY"][1]), fz(FA["panelY"][0])], "ink": "mtPanel"})
for (x0, x1) in FA["strips"]:
    fops.append({"edge": 0, "f": fspan(x0, x1), "z": [fz(FA["stripY"][1]), fz(FA["stripY"][0])], "ink": "mtPanel"})
for G in FA["gates"]:
    x0, x1 = G["x"]
    f = fspan(x0, x1)
    crown = fz(G["crownY"])
    rad = (x1 - x0) / PXF * SF / 2
    if G["kind"] == "madera":
        # el del oeste: el abanico de hierro en el medio punto y las dos hojas de madera gris debajo
        fops.append({"edge": 0, "f": f, "z": [0.05, crown], "ink": "mtFanlight", "shape": "arch", "rim": ["mtTrim", 0.16]})
        fops.append({"edge": 0, "f": f, "z": [0.05, r2(crown - rad)], "ink": "mtGateWood"})
        fc = avg(*f)
        fops.append({"edge": 0, "f": [round(fc - 0.002, 3), round(fc + 0.002, 3)], "z": [0.05, r2(crown - rad)], "ink": "mtIron"})
    else:
        # el del este: reja negra de arriba abajo, con sus barrotes
        fops.append({"edge": 0, "f": f, "z": [0.05, crown], "ink": "mtIron", "shape": "arch", "rim": ["mtTrim", 0.16]})
        for k in range(1, 7):
            fc = f[0] + (f[1] - f[0]) * k / 7
            fops.append({"edge": 0, "f": [round(fc - 0.002, 3), round(fc + 0.002, 3)], "z": [0.1, r2(crown - rad)], "ink": "mtSideGate"})
N = FA["niche"]
fops.append({"edge": 0, "f": fspan(*N["x"]), "z": [fz(N["sillY"]), fz(N["topY"])], "ink": "mtMural", "shape": "arch", "rim": ["mtTrim", 0.14]})
fops.append({"edge": 0, "f": fspan(N["x"][0] - 25, N["x"][1] + 25), "z": [r2(fz(N["sillY"]) - 0.12), fz(N["sillY"])], "ink": "mtTrim"})
hall_tiers.append(note({"poly": qh(HU0, 0.0, HU1, FW), "z": [0, Z_COR[0]], "wall": "mtWall", "cap": "mtTrim",
                        "bands": [[0, r2(Z_PLINTH / Z_COR[0]), "mtPlinth"]], "openings": fops},
                       "LA FACHADA DE 1901 (la vista de calle, casi de frente, a 100 px por metro): mira al sur por Calle 10 abajo. Simétrica: el portón del oeste con su abanico de hierro sobre hojas de madera gris, el del este de reja negra, la hornacina con su relieve al centro, los paños y los listones color durazno, el zócalo durazno. Se aprieta un 8 % a lo ancho para caber con el portón del costado; las alturas son las de la foto", True))
hall_tiers.append(note({"poly": qh(HU0 - 0.12, -0.15, HU1 + 0.12, FW + 0.1), "z": Z_COR, "wall": "mtTrim", "cap": "mtTrim"},
                       "la cornisa, que vuela un poco sobre la fachada", True))
# el ático, con el círculo blanco y su aguja, y sus dos paños
A = FA["attic"]
AU0, AU1 = r2(fu(A["x"][1])), r2(fu(A["x"][0]))
aspan = lambda x0, x1: on_edge(AU0, AU1, fu(x1), fu(x0))
C = FA["circle"]
cf = avg(*aspan(C["cx"], C["cx"]))
crad = C["r"] / PXF                                  # el círculo es redondo: su radio no se aprieta
cz = fz(C["cy"])
aops = [{"edge": 0, "f": aspan(*p), "z": [fz(A["panelY"][1]), fz(A["panelY"][0])], "ink": "mtPanel"} for p in A["panels"]]
aops.append({"edge": 0, "f": [round(cf - crad / (AU1 - AU0), 3), round(cf + crad / (AU1 - AU0), 3)], "z": [r2(cz - crad), r2(cz + crad)],
             "ink": "mtPanel", "shape": "disc", "rim": ["mtTrim", 0.14]})
aops.append({"edge": 0, "f": [round(cf - 0.035 / (AU1 - AU0), 3), round(cf + 0.035 / (AU1 - AU0), 3)], "z": [cz, r2(cz + crad * 0.8)], "ink": "mtClockHand"})
hall_tiers.append(note({"poly": qh(AU0, 0.05, AU1, 0.95), "z": [Z_COR[1], fz(A["corniceY"][1])], "wall": "mtWall", "cap": "mtTrim", "openings": aops},
                       "EL ÁTICO, sobre el medio de la fachada: el círculo blanco con su aguja entre dos paños color durazno", True))
hall_tiers.append(note({"poly": qh(AU0 - 0.12, -0.07, AU1 + 0.12, 1.07), "z": [fz(A["corniceY"][1]), fz(A["corniceY"][0])], "wall": "mtTrim", "cap": "mtTrim"},
                       "…y su cornisa", True))
PD = FA["pediment"]
PU0, PU1 = fu(PD["x"][1]), fu(PD["x"][0])
Z_PED = [fz(A["corniceY"][0]), fz(PD["baseY"])]
hall_tiers.append(note({"box": [r2(PU1 - PU0), 0.8], "at": HB(avg(PU0, PU1), 0.5), "z": Z_PED, "wall": "mtTrim", "cap": "mtTrim",
                        "roof": {"kind": "gable", "axis": "y", "riseM": r2(fz(PD["apexY"]) - Z_PED[1]), "ink": "mtTrim", "ink2": "mtWall"}},
                       "el frontón, con su punta hacia la calle", True))
D = FA["date"]
hall_tiers.append(note({"box": [r2((D["x"][1] - D["x"][0]) / PXF * SF), 0.3], "at": HB(fu(avg(*D["x"])), 0.45),
                        "z": [r2(fz(PD["apexY"]) - 0.02), fz(D["y"][0])], "wall": "mtTrim", "cap": "mtTrim", "decal": {"edges": [0], "key": "anio"}},
                       "la placa con el año sobre la punta del frontón: dice 1901 (`parcels.byId.hist_matadero.inks._decal_anio`)", True))

# EL SALÓN: los muros detrás de la fachada (se pintan ANTES que ella: su frente queda dentro de la fachada),
# la cenefa anaranjada del alero, y el techo en anillo alrededor del patio de luz
hall_tiers.append(note({"poly": qh(HU0 + 0.05, FW, HU1 - 0.05, HV1), "z": [0, Z_WALL], "wall": "mtWall", "cap": "mtRoof",
                        "bands": [[0, r2(Z_PLINTH / Z_WALL), "mtPlinth"]], "sortM": 1.0},
                       "EL SALÓN detrás de la fachada (el satélite): sus muros blancos con el zócalo durazno. Se pinta antes que la fachada, que va delante", True))
RO = [r2(HU0 - 0.3), 0.35, r2(HU1 + 0.25), r2(HV1 + 0.3)]          # el alero: u0 (este), v0, u1 (oeste), v1
hall_tiers.append(note({"poly": qh(*RO), "z": Z_FASCIA, "wall": "mtFascia", "cap": "mtRoof"},
                       "la cenefa anaranjada del alero, que asoma sobre la cornisa (la vista de calle)", True))
HX0, HX1 = HA["x"]
HY0, HY1 = HA["y"]
wfrac = lambda x: (x - HX0) / (HX1 - HX0)          # del oeste al este
sfrac = lambda y: (HY1 - y) / (HY1 - HY0)          # del sur (la fachada) al norte
ru = lambda x: r2(RO[2] - wfrac(x) * (RO[2] - RO[0]))
rv = lambda y: r2(RO[1] + sfrac(y) * (RO[3] - RO[1]))
E_, W_, S_, N_ = RO[0], RO[2], RO[1], RO[3]
rE, rW, rS, rN = ru(HA["ridge"]["x"][1]), ru(HA["ridge"]["x"][0]), rv(HA["ridge"]["y"][1]), rv(HA["ridge"]["y"][0])
cE, cW, cS, cN = ru(HA["court"]["x"][1]), ru(HA["court"]["x"][0]), rv(HA["court"]["y"][1]), rv(HA["court"]["y"][0])
e, R = Z_EAVE, Z_RIDGE
F3 = lambda u, v, z: [*HB(u, v), z]
outer = {"sur": [F3(E_, S_, e), F3(W_, S_, e), F3(rW, rS, R), F3(rE, rS, R)],
         "oeste": [F3(W_, S_, e), F3(W_, N_, e), F3(rW, rN, R), F3(rW, rS, R)],
         "norte": [F3(W_, N_, e), F3(E_, N_, e), F3(rE, rN, R), F3(rW, rN, R)],
         "este": [F3(E_, N_, e), F3(E_, S_, e), F3(rE, rS, R), F3(rE, rN, R)]}
inner = {"sur": [F3(rE, rS, R), F3(rW, rS, R), F3(cW, cS, e), F3(cE, cS, e)],
         "oeste": [F3(rW, rS, R), F3(rW, rN, R), F3(cW, cN, e), F3(cW, cS, e)],
         "norte": [F3(rW, rN, R), F3(rE, rN, R), F3(cE, cN, e), F3(cW, cN, e)],
         "este": [F3(rE, rN, R), F3(rE, rS, R), F3(cE, cS, e), F3(cE, cN, e)]}
NAME_V = r2(avg(rN, N_))
for i, (side, pts) in enumerate(outer.items()):
    t = {"facet": pts, "ink": "mtRoof", "ink2": "mtRoofShade"}
    if side == "norte":
        # EL NOMBRE sobre el faldón del fondo, en vez de una píldora (como la ACON y el DJ): el de adelante lo
        # tapa el ático. `u` corre al oeste, así que las letras se giran media vuelta para leerse desde la calle
        t["capText"] = {"lines": ["ANTIGUO MATADERO", "MUNICIPAL"], "atM": HB(avg(rE, rW), NAME_V), "zM": r2(avg(e, R)),
                        "heightM": 0.95, "maxWM": r2(avg(rW - rE, W_ - E_) - 1.0), "ink": "mtFascia", "rotDeg": 180}
    hall_tiers.append(note(t, "EL TECHO (el satélite): de los cuatro aleros sube a una cumbrera en ANILLO y baja otra vez a un patio de luz — ocho faldones de zinc gris. Éste es uno de los cuatro de afuera", i == 0))
for i, pts in enumerate(inner.values()):
    hall_tiers.append(note({"facet": pts, "ink": "mtRoof", "ink2": "mtRoofShade"}, "…y uno de los cuatro que bajan al patio", i == 0))
hall_tiers.append(note({"poly": qh(cE, cS, cW, cN), "z": [e, r2(e + 0.03)], "wall": "mtCourt", "cap": "mtCourt", "noShadow": True},
                       "EL PATIO DE LUZ al medio del salón (el satélite): visto desde arriba, su fondo en la sombra de los aleros", True))
# EL PORTÓN DEL COSTADO, al este de la fachada y un poco atrás: un muro más bajo con su reja encima, que llega
# al muro del recinto (fuera del lote: el muro del recinto está en el otro lote)
SG = FA["sideGate"]
gl = r2(U_GATE_E - WALL_T / 2)
g_mid = avg(gl + 0.6, HU0)
gops = [{"edge": 0, "f": on_edge(gl, HU0, g_mid - SG["wM"] / 2, g_mid + SG["wM"] / 2), "z": [0.05, SG["zM"]], "ink": "mtSideGate"},
        {"edge": 0, "f": on_edge(gl, HU0, g_mid - SG["wM"] / 2, g_mid + SG["wM"] / 2), "z": SG["grilleZM"], "ink": "mtIron"}]
hall_tiers.append(note({"poly": qh(gl, GATE_FRONT, HU0, GATE_FRONT + WALL_T), "z": [0, WA["heightM"]], "wall": "mtWall", "cap": "mtTrim",
                        "bands": [[r2((WA["heightM"] - 0.18) / WA["heightM"]), 1.0, "mtTrim"]], "openings": gops},
                       "EL PORTÓN DEL COSTADO, al este de la fachada y un poco atrás (la vista de calle y la del muro, donde sale en escorzo al fondo): portón negro con su reja encima, en un muro más bajo que llega hasta el muro del recinto", True))
hall_tiers.append(note({"box": [0.6, 0.6], "at": HB(gl + 0.3, GATE_FRONT + WALL_T / 2), "z": [0, r2(WA["heightM"] + 0.3)], "wall": "mtWall", "cap": "mtTrim"},
                       "el pilar de la esquina, donde el muro del recinto dobla hacia el sur por Calle 10", True))

hall = {
    "_note": "EL ANTIGUO MATADERO MUNICIPAL (1901), el salón que cierra la punta de Calle 10: la fachada mira al sur, por Calle 10 abajo —sus dos portones en arco, el de madera gris bajo su abanico y el de reja negra, la hornacina, los paños color durazno, y arriba el ático con el círculo blanco, el frontón y la placa de 1901—; detrás, el salón bajo un techo de zinc gris en anillo alrededor de su patio de luz, con la cenefa anaranjada; al este, el portón negro del costado, donde el muro del recinto dobla por Calle 10. CALCADO de sus imágenes (`tools/matadero_trace.json`); lo escribe `tools/gen_matadero_body.py`. El recinto es `bodies.matadero_muro`.",
    "perspective": True,
    "tiers": hall_tiers, "low": hall_low, "placeM": [0, 0],
    "ground": {"polyM": [BH(-0.3, -0.3), BH(LU + 1.0, -0.3), BH(LU + 1.0, LV + 0.3), BH(-0.3, LV + 0.3)], "ink": "mtYard",
               "_": "el piso de todo el lote —la acera delante de la fachada, el pasillo detrás del portón del costado—, metido 0,3 m bajo la acera de la avenida para que en el borde no asome una raya de tierra"},
}
if not hall["low"]:
    del hall["low"]

# ═════════════════════════════════════ EL RECINTO SOBRE CALLE 10 ═════════════════════════════════════
MU, MV = PM["lotM"]
SLOPE = PM.get("sideSlope", 0.0)
OMU, OMV = MU / 2, MV / 2
BM = lambda u, v: [r2(u - OMU + SLOPE * (v - OMV)), r2(v - OMV)]


def qm(u0, v0, u1, v1):
    """un rectángulo del lote (corrido con la pendiente de la avenida): aristas 0 Calle 10, 1 norte, 2 este, 3 avenida"""
    return [BM(u0, v0), BM(u1, v0), BM(u1, v1), BM(u0, v1)]


tiers, low = [], []
WH = WA["heightM"]
COPING = [[r2((WH - 0.18) / WH), 1.0, "mtTrim"]]
U_AV = r2(LAWN + WALL_T / 2)                          # el eje del muro de la avenida
V_IN = r2(WALL_V + WALL_T / 2)                        # la cara de adentro del muro de Calle 10
CIRC, ARCH = WA["circle"], WA["arch"]


def bay_ops(edge, lo, hi, a, b, kind):
    """el círculo o el arco ciego de un paño [a, b] (metros a lo largo de la arista que va de `lo` a `hi`)"""
    c = avg(a, b)
    if kind == "circle":
        r = CIRC["dM"] / 2
        return [{"edge": edge, "f": on_edge(lo, hi, c - r, c + r), "z": [r2(CIRC["zM"] - r), r2(CIRC["zM"] + r)], "ink": "mtPanel", "shape": "disc", "rim": ["mtTrim", 0.12]}]
    if kind == "arch":
        w = ARCH["wM"] / 2
        return [{"edge": edge, "f": on_edge(lo, hi, c - w, c + w), "z": ARCH["zM"], "ink": "mtPanel", "shape": "arch", "rim": ["mtTrim", 0.12]}]
    return []


# la esquina REDONDA, con su grama
CU, CV = r2(U_AV + CORNER_R), r2(WALL_V + CORNER_R)
tiers.append(note({"ring": {"rM": r2(CORNER_R + WALL_T / 2), "wM": WALL_T, "a0": 180, "a1": 270, "n": 10}, "at": BM(CU, CV),
                   "z": [0, WH], "wall": "mtWall", "cap": "mtTrim", "bands": COPING},
                  "LA ESQUINA REDONDA del muro (las vistas de la esquina), con su albardilla", True))
# el muro de la avenida: círculo, arco, círculo, y el muro alto del vecino
av_lo, av_hi = CV, r2(CV + sum(w for _, w in WA["avenue"]) * 0.985)
ops, at_ = [], av_lo
for kind, w in WA["avenue"]:
    w *= (av_hi - av_lo) / sum(x for _, x in WA["avenue"])
    ops += bay_ops(3, av_hi, av_lo, at_, at_ + w, kind)
    at_ += w
NB0 = r2(av_hi + 0.15)                                # donde empieza el vecino de la avenida
tiers.append(note({"poly": qm(LAWN, av_lo, LAWN + WALL_T, av_hi), "z": [0, WH], "wall": "mtWall", "cap": "mtTrim", "bands": COPING, "openings": ops},
                  "EL MURO DE LA AVENIDA (la vista de la avenida): círculo, arco y círculo ciegos, color durazno con su borde blanco, detrás de la grama", True))
# Calibración del recorte aéreo entre el extremo norte del zinc y el muro de la avenida.
SURVEY = CA["roofSurvey"]
HALL_K = (LV - 0.4 - FW) / ((HA["y"][1] - HA["y"][0]) / ((HA["x"][1] - HA["x"][0]) / FA["widthM"]))
NAVE_U1 = r2(U_KERB + CA["naveNorthM"] * HALL_K)


def aerial_u(y):
    return r2(U_AV + (NAVE_U1 - U_AV) * (SURVEY["avenueY"] - y) / (SURVEY["avenueY"] - SURVEY["northY"]))


def aerial_span(y):
    return aerial_u(y[1]), aerial_u(y[0])


WIN = next(wing for wing in SURVEY["wings"] if wing.get("window"))
win = aerial_span(WIN["y"])
# Cada serie de arcos se mide hasta su borde del saliente.
# El tramo hacia el salón es más bajo y llega al portón lateral.
c10_lo = CU
for u0, u1, end, height, bays in (
    (CU, win[0], win[0], WH, WA["calle10South"]),
    (win[1], r2(U_GATE + 0.15), U_GATE, WH - 0.35, WA["calle10North"]),
):
    scale = (end - u0) / sum(width for _, width in bays)
    ops, start = [], u0
    for kind, width in bays:
        stop = start + width * scale
        ops += bay_ops(0, u0, u1, start, stop, kind)
        start = stop
    tiers.append(note({"poly": qm(u0, r2(WALL_V - WALL_T / 2), u1, V_IN), "z": [0, height], "wall": "mtWall",
                       "cap": "mtTrim", "bands": [[r2(1 - 0.18 / height), 1.0, "mtTrim"]], "openings": ops},
                      "EL MURO DE CALLE 10: arcos y círculos ciegos, con la sección más baja camino al portón del salón", True))

NAVE_U0 = aerial_u(SURVEY["spineSouthY"])
EAVE_Z, RIDGE_Z = SURVEY["eaveZM"], SURVEY["ridgeZM"]
STREET_EAVE, RIDGE_V = SURVEY["spineStreetM"], SURVEY["ridgeM"]
REAR_EAVE = SURVEY["rearEaveM"]
tiers.append({"poly": qm(NAVE_U0, STREET_EAVE, NAVE_U1, REAR_EAVE), "z": [0, EAVE_Z],
              "wall": "mtWall", "cap": "mtRoof", "sortM": 3.5})


def roof_face(points, roof="mtRoof", shade="mtRoofShade"):
    tiers.append({"facet": [[*BM(u, v), z] for u, v, z in points], "ink": roof, "ink2": shade})


# Caderas de los extremos y el faldón oriental, con el alero paralelo a la cumbrera.
ridge_s, ridge_n = r2(NAVE_U0 + 2.3), r2(NAVE_U1 - 2.0)
roof_face([(NAVE_U0, STREET_EAVE, EAVE_Z), (NAVE_U0, REAR_EAVE, EAVE_Z), (ridge_s, RIDGE_V, RIDGE_Z)])
roof_face([(NAVE_U1, STREET_EAVE, EAVE_Z), (ridge_n, RIDGE_V, RIDGE_Z), (NAVE_U1, REAR_EAVE, EAVE_Z)])
roof_face([(NAVE_U0, REAR_EAVE, EAVE_Z), (NAVE_U1, REAR_EAVE, EAVE_Z), (ridge_n, RIDGE_V, RIDGE_Z), (ridge_s, RIDGE_V, RIDGE_Z)])

# Los salientes cruzan la cubierta hacia la calle. Sus limahoyas comparten los
# mismos vértices con los faldones de la nave, dejando abiertos los retiros.
prev_eave, prev_ridge = NAVE_U0, ridge_s
for wing in reversed(SURVEY["wings"]):
    u0, u1 = aerial_span(wing["y"])
    mid = avg(u0, u1)
    front = wing["streetM"]
    hip = r2(front + min((u1 - u0) / 2, (STREET_EAVE - front) * 0.7))
    roof_face([(prev_eave, STREET_EAVE, EAVE_Z), (u0, STREET_EAVE, EAVE_Z), (mid, RIDGE_V, RIDGE_Z), (prev_ridge, RIDGE_V, RIDGE_Z)])
    roof_face([(u0, front, EAVE_Z), (u1, front, EAVE_Z), (mid, hip, RIDGE_Z)])
    roof_face([(u0, front, EAVE_Z), (mid, hip, RIDGE_Z), (mid, RIDGE_V, RIDGE_Z), (u0, STREET_EAVE, EAVE_Z)])
    roof_face([(u1, front, EAVE_Z), (u1, STREET_EAVE, EAVE_Z), (mid, RIDGE_V, RIDGE_Z), (mid, hip, RIDGE_Z)])
    prev_eave, prev_ridge = u1, mid

    block = {"poly": qm(u0, front, u1, STREET_EAVE + 0.02), "z": [0, EAVE_Z], "wall": "mtWall", "cap": "mtRoof",
             "bands": [[r2(1 - 0.16 / EAVE_Z), 1.0, "mtTrim"]]}
    if wing.get("window"):
        window = WA["window"]
        half = window["glassWM"] / 2
        sill, head = window["glassZM"]
        spring = r2(head - half)
        glass_span = on_edge(u0, u1, mid - half, mid + half)
        ops = [{"edge": 0, "f": glass_span, "z": [sill, head], "ink": "mtGlass", "shape": "arch", "rim": ["mtTrim", 0.14]}]
        for off in (-0.35, 0.35):
            ops.append({"edge": 0, "f": on_edge(u0, u1, mid + off - 0.03, mid + off + 0.03), "z": [sill, spring], "ink": "mtFrame"})
        ops.append({"edge": 0, "f": glass_span, "z": [r2(spring - 0.035), r2(spring + 0.035)], "ink": "mtFrame"})
        ops.append({"edge": 3, "f": [0.63, 0.87], "z": window["returnGlassZM"], "ink": "mtGlass", "rim": ["mtFrame", 0.05]})
        block["openings"] = ops
        block["_"] = "La ventana de tres paños en el saliente central, con el vidrio pequeño en el retorno sur"
    tiers.append(block)
roof_face([(prev_eave, STREET_EAVE, EAVE_Z), (NAVE_U1, STREET_EAVE, EAVE_Z), (ridge_n, RIDGE_V, RIDGE_Z), (prev_ridge, RIDGE_V, RIDGE_Z)])

# El volumen bajo junto al patio tiene su propia cubierta a cuatro aguas.
south = SURVEY["southHip"]
u0, u1 = aerial_span(south["y"])
v0, v1 = south["vM"]
tiers.append(note({"box": [r2(u1 - u0), r2(v1 - v0)], "at": BM(avg(u0, u1), avg(v0, v1)), "z": [0, 3.45],
                   "wall": "mtWall", "cap": "mtRoof", "roof": {"kind": "hip", "riseM": 1.0, "ink": "mtRoof", "ink2": "mtRoofShade"}},
                  "El volumen blanco junto al patio sur, con los aleros escalonados respecto a los de la nave", True))

RED_U0 = aerial_u(south["y"][0])
SHED_EDGE = SURVEY["leanToRearM"]
# Una sola agua entre la nave y la fábrica, con los dos bordes paralelos.
tiers.append({"poly": qm(RED_U0, REAR_EAVE, NAVE_U1, SHED_EDGE), "z": [0, 2.65],
              "wall": "mtWall", "cap": "mtLeanTo", "sortM": 2.7})
roof_face([(RED_U0, REAR_EAVE, 3.1), (NAVE_U1, REAR_EAVE, 3.1),
           (NAVE_U1, SHED_EDGE, 2.65), (RED_U0, SHED_EDGE, 2.65)], "mtLeanTo", "mtLeanToShade")


def compound_u(y):
    return r2(U_AV + (CA["avenueWallY"] - y) / CA["pxPerM"])


def compound_v(x):
    return r2(WALL_V + (x - CA["wallLineX"]) / CA["pxPerM"])


for block in CA["lowBlocks"]:
    y0, y1 = block["y"]
    v0, v1 = map(compound_v, block["x"])
    tiers.append({"poly": qm(compound_u(y1), v0, compound_u(y0), v1), "z": [0, 2.55], "wall": "mtWall", "cap": "mtFlat"})
REAR_EDGE = MV - 0.3
RED_V0 = SHED_EDGE - 0.12                               # el zinc solapa el alero del cobertizo
red_box = [r2(NAVE_U1 - RED_U0), r2(REAR_EDGE - RED_V0)]
red_center = BM(avg(RED_U0, NAVE_U1), avg(RED_V0, REAR_EDGE))
tiers.append(note({"box": red_box, "at": red_center, "z": [0, 3.4], "wall": "mtNeighborWall", "cap": "mtNeighborRoof",
                   "roof": {"kind": "gable", "axis": "x", "riseM": 0.8, "ink": "mtNeighborRoof", "ink2": "mtNeighborRoofShade", "seamsM": 0.6}},
                  "El zinc rojo de la Fábrica de Hielo corre bajo una sola cumbrera", True))

# El lado norte del edificio blanco sigue el borde real del zinc rectangular.
# La franja de patio entre ambos deja sitio al corrimiento de los techos en perspectiva.
NEIGH_V0 = SURVEY["avenueNeighborStreetM"]
white_limit = r2(red_center[0] - red_box[0] / 2 - SURVEY["avenueNeighborRoofClearanceM"])
white_front = LAWN + WALL_T + 0.35
white = [BM(LAWN, NB0), BM(white_front, NB0), BM(white_front, NEIGH_V0),
         [white_limit, BM(0, NEIGH_V0)[1]], [white_limit, BM(0, REAR_EDGE)[1]], BM(LAWN, REAR_EDGE)]
tiers.append(note({"poly": white, "z": [0, 5.2], "wall": "mtNeighborWall", "cap": "mtFlat",
                   "openings": [{"edge": 5, "f": [0, 1], "z": [4.47, 5.2], "ink": "mtNeighborBand"}]},
                  "EL EDIFICIO BLANCO de la avenida, entre el patio verde y los techos rojos, con la banda azul hacia la avenida", True))
# el piso: la grama de la avenida y de la esquina redonda
lawn = [(0, NB0), (0, 0), (CU, 0), (CU, WALL_V - WALL_T / 2)]
for k in range(1, 10):
    a = math.radians(270 - 90 * k / 10)
    lawn.append((CU + (CORNER_R + WALL_T / 2) * math.cos(a), CV + (CORNER_R + WALL_T / 2) * math.sin(a)))
lawn += [(LAWN, CV), (LAWN, NB0)]
low.append(note({"poly": [BM(u, v) for u, v in lawn], "z": [0, 0.04], "wall": "mtGrass", "cap": "mtGrass"},
                "la grama entre la acera y el muro, por la avenida y alrededor de la esquina redonda (las vistas de la esquina)", True))

CENTER_COURT = aerial_span(SURVEY["centerCourtY"])
STREET_COURT = aerial_span(SURVEY["streetCourtY"])
SOUTH_COURT = aerial_span(SURVEY["southCourtY"])
SOUTH_PLANTING_EDGE = V_IN + 0.45
for (u0, u1), (v0, v1) in ((STREET_COURT, (V_IN, STREET_EAVE)), (SOUTH_COURT, (SOUTH_PLANTING_EDGE, NEIGH_V0))):
    low.append({"poly": qm(u0, v0, u1, v1), "z": [0, 0.02], "wall": "mtCourt", "cap": "mtCourt", "noShadow": True})

# Une el suelo del recinto con el del salón en ambos extremos de su linde.
# Delante del portón, entra bajo la curva para que la acera dibuje su propio borde.
def hall_ground_uv(u, v):
    return _uv(FM, *EH.at(_W, FB, u, v), SLOPE)


ground = [(-0.3, -0.5), (U_KERB - 19, -0.5), (U_KERB - 4, -9.5), hall_ground_uv(10, -1.1),
          hall_ground_uv(9.5, 0.1), hall_ground_uv(0, 0.1), hall_ground_uv(0, LV + 0.3),
          (MU + 0.3, -0.3), (MU + 0.3, MV + 0.3), (-0.3, MV + 0.3)]
ALM = CA["almendro"]
muro = {
    "_note": "EL RECINTO DEL ANTIGUO MATADERO: muro blanco de arcos y círculos ciegos, cubierta continua con salientes y limahoyas, ventana grande y su retorno, aleros escalonados, patios abiertos y cobertizo hacia la Fábrica de Hielo. El muro llega al portón lateral del salón. Receta de `tools/gen_matadero_body.py` con el calco de `tools/matadero_trace.json`.",
    "perspective": True,
    "tiers": tiers, "low": low, "placeM": [0, 0],
    "trees": [{"atM": BM(avg(*SOUTH_COURT), avg(SOUTH_PLANTING_EDGE, NEIGH_V0)), "k": "almendro", "s": 1.0,
               "_": "el almendro en el centro del patio verde sur"},
              {"atM": BM(avg(*CENTER_COURT), avg(V_IN, STREET_EAVE)), "k": "almendro", "s": 0.45,
               "_": "el árbol del patio central entre los dos salientes"},
              {"atM": BM(avg(*STREET_COURT), 2.15), "k": "almendro", "s": 0.45,
               "_": "el árbol del retiro frente a Calle 10"}]
             + [{"atM": BM(u, v), "k": "almendro", "s": scale, "_": "árbol de la acera de Calle 10"}
                for u, v, scale in SURVEY["sidewalkTreesM"]]
             + [{"atM": BM(r2(avg(NAVE_U1, MU) + du), dv), "k": k, "s": sc, **({"_": "EL PATIO DE ÁRBOLES DEL FONDO, detrás de la nave y al lado del salón (el satélite: copas oscuras al noreste del salón), en el suelo que tenía el cuadro de la Fábrica de Hielo"} if i == 0 else {})}
                for i, (du, dv, k, sc) in enumerate(((-1.0, 4.6, "almendro", 0.95), (1.2, 11.2, "almendro", 0.9)))],
    "ground": {"polyM": [BM(u, v) for u, v in ground], "ink": "mtYard",
               "_": "el piso del recinto llega al salón y pasa por debajo de la acera en la curva"},
}

# lo que se para no se para en la calle: el muro de Calle 10 tiene que llegar a la línea de la fachada
if not (MU / 2 < U_FACADE < NAVE_U1 < MU - 6):
    raise SystemExit(f"[matadero] la línea de la fachada cae en u {U_FACADE} del recinto y la nave llega a {NAVE_U1} de {MU}: los dos lotes ya no se tocan")
if not (-6 < U_GATE_E < 0.5):
    raise SystemExit(f"[matadero] el muro del recinto cae en u {U_GATE_E} del salón: el portón del costado no llega")


def overlay():
    """vuelve a dibujar lo calcado encima de las imágenes, para revisarlo a ojo"""
    from PIL import Image, ImageDraw
    base = os.path.join(ROOT, "logs", "matadero")
    im = Image.open(os.path.join(base, FA["image"])).convert("RGB")
    d = ImageDraw.Draw(im)
    gy = FA["groundY"]
    for x in FA["endsX"]:
        d.line([x, 80, x, gy], fill=(255, 255, 0), width=3)
    for y in (gy, FA["plinthTopY"], *FA["corniceY"], *FA["eaveY"]):
        d.line([FA["endsX"][0], y, FA["endsX"][1], y], fill=(0, 255, 255), width=2)
    for G in FA["gates"]:
        d.rectangle([G["x"][0], G["crownY"], G["x"][1], gy], outline=(255, 0, 255), width=3)
    for (x0, x1) in FA["panels"]:
        d.rectangle([x0, FA["panelY"][0], x1, FA["panelY"][1]], outline=(255, 120, 0), width=3)
    for (x0, x1) in FA["strips"]:
        d.rectangle([x0, FA["stripY"][0], x1, FA["stripY"][1]], outline=(255, 200, 0), width=2)
    N_ = FA["niche"]; d.rectangle([N_["x"][0], N_["topY"], N_["x"][1], N_["sillY"]], outline=(0, 255, 0), width=3)
    A_ = FA["attic"]; d.rectangle([A_["x"][0], A_["corniceY"][0], A_["x"][1], FA["corniceY"][0]], outline=(0, 200, 255), width=3)
    for (x0, x1) in A_["panels"]:
        d.rectangle([x0, A_["panelY"][0], x1, A_["panelY"][1]], outline=(255, 120, 0), width=2)
    C_ = FA["circle"]; d.ellipse([C_["cx"] - C_["r"], C_["cy"] - C_["r"], C_["cx"] + C_["r"], C_["cy"] + C_["r"]], outline=(255, 0, 0), width=3)
    P_ = FA["pediment"]; d.polygon([(P_["x"][0], P_["baseY"]), (avg(*P_["x"]), P_["apexY"]), (P_["x"][1], P_["baseY"])], outline=(255, 255, 255))
    D_ = FA["date"]; d.rectangle([D_["x"][0], D_["y"][0], D_["x"][1], D_["y"][1]], outline=(255, 0, 0), width=2)
    im.save(os.path.join(base, "trace-facade.png"))
    sat = Image.open(os.path.join(base, HA["image"])).convert("RGB"); d = ImageDraw.Draw(sat)
    for key, c in ((None, (255, 255, 0)), ("ridge", (0, 255, 255)), ("court", (255, 0, 255))):
        r = HA if key is None else HA[key]
        d.rectangle([r["x"][0], r["y"][0], r["x"][1], r["y"][1]], outline=c, width=4)
    sat.save(os.path.join(base, "trace-hall.png"))
    so = Image.open(os.path.join(base, "sat-south.jpg")).convert("RGB"); d = ImageDraw.Draw(so)
    d.line([CA["wallLineX"], 0, CA["wallLineX"], so.height], fill=(255, 255, 0), width=3)
    d.line([0, CA["avenueWallY"], so.width, CA["avenueWallY"]], fill=(255, 255, 0), width=3)
    for B_ in CA["lowBlocks"]:
        d.rectangle([B_["x"][0], B_["y"][0], B_["x"][1], B_["y"][1]], outline=(255, 0, 255), width=3)
    d.ellipse([ALM["x"][0], ALM["y"][0], ALM["x"][1], ALM["y"][1]], outline=(0, 255, 0), width=3)
    so.save(os.path.join(base, "trace-compound.png"))
    print("[matadero] overlay -> logs/matadero/trace-facade.png, trace-hall.png, trace-compound.png")


def write(text, key, body):
    line = f'    "{key}": ' + json.dumps(body, ensure_ascii=False) + ","
    pat = r'^    "' + re.escape(key) + r'": \{.*\},$'
    if re.search(pat, text, flags=re.M):
        new, n = re.subn(pat, lambda m: line, text, count=1, flags=re.M)
    else:                                   # la primera vez: va justo antes de la UTN, junto al Mercado y la ACON
        new, n = re.subn(r'^(    "utn": \{)', lambda m: line + "\n" + m.group(1), text, count=1, flags=re.M)
    assert n == 1, f"no encontré dónde va bodies.{key}"
    return new


if __name__ == "__main__":
    # como `gen_mercado_body.py`: un generador de un asset del juego, no un cruce del builder (`tests/test_game_root.py`)
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "assets", "world-props.json")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    text = write(text, "matadero", hall)
    text = write(text, "matadero_muro", muro)
    json.loads(text)
    if "--check" not in sys.argv:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(f"[matadero] salón: {len(hall_tiers)} bloques; fachada {r2(HU1 - HU0)} m (de verdad {FA['widthM']}, x{r2(SF)}), cornisa {Z_COR}, ático hasta "
          f"{fz(A['corniceY'][0])}, frontón {fz(PD['apexY'])}, placa {fz(D['y'][0])}; techo: alero {e}, cumbrera {R}, salón hasta v {r2(HV1 + HALL_SETBACK)}; "
          f"patio u {cE}–{cW}, v {r2(cS + HALL_SETBACK)}–{r2(cN + HALL_SETBACK)}")
    print(f"[matadero] recinto: {len(tiers)} bloques, {len(low)} en el piso; muro de Calle 10 de u {c10_lo} a la fachada en u {U_FACADE} "
          f"(retiro {HALL_SETBACK} m), ventana {win}, nave de u {NAVE_U0} a {NAVE_U1}; el portón del costado llega a u {U_GATE_E} del salón "
          f"-> {os.path.relpath(path)}")
    if "--overlay" in sys.argv:
        overlay()
