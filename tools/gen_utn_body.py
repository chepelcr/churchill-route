#!/usr/bin/env python3
"""LA UTN —la antigua Aduana— COMO CUERPO DE RECETA: escribe `world-props.json → bodies.utn`.

    python3 tools/gen_utn_body.py

Muchos de sus bloques se repiten con una regla (las ventanas en parejas con su emblema entre grupos,
los tragaluces de cada agua del techo): escritos a mano, cambiar el paso de las ventanas era reescribir
cuarenta vanos. La regla vive aquí y el JSON es lo que sale; se reemplaza SÓLO la línea de `"utn"`,
sin reformatear el archivo.

LAS MEDIDAS SALEN DE LAS FOTOS, y cada una dice de cuál:

* EL FRENTE (foto desde el Paseo, 2026-11-20): la composición es SIMÉTRICA y va en el CENTRO —torre,
  frontón, torre—, unos 21 m de los 72. Medido contra la altura del pretil de las alas (9 m): el
  frontón remata a ~11,3 m, las torres a ~10,2, el alero a ~4,2; los tres ventanales del frontón son
  de la planta alta (4,6 a 7,8 m) y el friso con su medallón va de ~8,7 a 10 m.
* EL TECHO (satélite de Google y la foto aérea): una NAVE CENTRAL de ~24,6 m, centrada, de Avenida 2
  hasta la franja del frente, a dos aguas con la cumbrera de norte a sur y tragaluces en las dos
  aguas; a cada lado una nave que BAJA hacia la calle (a un agua), y la FRANJA DEL FRENTE, que SUBE
  desde la fachada del Paseo hasta la nave central. El frontón y las torres quedan DEBAJO de la
  cumbrera central — en la aérea el techo grande asoma por encima de todo el frente.
* LAS TORRES DE LAS ESQUINAS (foto de la torre de las anclas, 2026-11-20): las cuatro iguales, 9 x 9 m,
  más altas que el pretil de las alas (10,2 m el cuerpo y 11,2 la pilastra de la esquina); en cada
  cara exterior la pilastra de la esquina y tres ALETAS que bajan escalonadas hacia el panel central,
  y dos más que bajan hacia el ala; la celosía terracota en el panel y el relieve del ancla con su
  caduceo arriba de las pilastras. El alero se corta contra ellas. La de Calle 3 y Avenida 2 lleva el
  portón negro con el ancla blanca; las del Paseo son lisas (foto de las alas).
* LOS DETALLES DE ARRIBA: el emblema de estrella con caduceo y olas sobre las ventanas, y las dos
  ESTRÍAS de la cornisa (foto del emblema).
* EL LUGAR: la cuadra medida en el ráster, no el lote del campus (ver `LAND_U`), pegado atrás.
* LAS MACETERAS del frente: ver `BEDS` — un cuerpo bajo aparte (`low`) y sus árboles (`trees`).
"""
import json
import re

# LA CUADRA, MEDIDA EN EL RÁSTER (`surfaceAt` == LAND en el marco de la parcela, a cinco alturas):
# u de -37,8 a +42,6 m y v de -37,1 a +35,8 m — 80 x 73 m, y CORRIDA respecto del lote del campus, que
# es un rectángulo inscrito más chico (72 x 67) porque Avenida 2 y Calle 3 corren en diagonal. El
# edificio llena la cuadra PEGADO ATRÁS (a la acera de Avenida 2) y deja al frente 6,5 m para las
# MACETERAS del Paseo; su centro va corrido `PLACE_M` desde el del lote.
LAND_U, LAND_V = (-37.8, 42.6), (-37.1, 35.8)
GREEN = {"n": 0.0, "s": 6.5, "w": 0.5, "e": 1.5}   # PEGADO ATRÁS, a Avenida 2; al frente, el ancho de las maceteras
U0, U1 = LAND_U[0] + GREEN["w"], LAND_U[1] - GREEN["e"]
V0, V1 = LAND_V[0] + GREEN["n"], LAND_V[1] - GREEN["s"]
W, D = round(U1 - U0, 1), round(V1 - V0, 1)   # la huella (u este, v sur): aristas 0 N, 1 E, 2 S (de este a oeste), 3 O
PLACE_M = [round((U0 + U1) / 2, 2), round((V0 + V1) / 2, 2)]
HW, HD = W / 2, D / 2
Z1, ZM, Z2 = 4.4, 4.8, 9.0  # planta baja, alero, pretil de las alas
NAVE = round(W * 205 / 625, 1)        # el ancho de la nave central: 205 de 625 px de fachada en el satélite
NAVE_S = round(-HD + D * 485 / 600, 1)  # donde las naves se encuentran con la franja del frente: 485 de 600 px de fondo
NAVE_N = -HD + 0.6
EAVE_C, RISE_C = 11.0, 3.0  # la nave central: su alero y lo que sube su cumbrera
SIDE_RISE = EAVE_C - Z2     # las de los lados bajan del alero central al pretil


def pairs(edge_len, ranges_skip=(), every=6.6, margin=3.4, ink="utnGlass", relief=True, z=(5.4, 7.6)):
    """ventanas en PAREJAS cada `every` m y el emblema entre grupos: en fracción de la arista"""
    out, s = [], margin
    while s + 3.4 < edge_len - margin:
        c = s + 1.7
        if not any(a <= c <= b for a, b in ranges_skip):
            for o in (-0.95, 0.95):
                out.append({"f": [round((c + o - 0.75) / edge_len, 4), round((c + o + 0.75) / edge_len, 4)], "z": list(z), "ink": ink})
            e = c + every / 2
            if relief and s + every + 1.7 < edge_len - margin and not any(a <= e <= b for a, b in ranges_skip):
                out.append({"f": [round((e - 0.7) / edge_len, 4), round((e + 0.7) / edge_len, 4)], "z": [7.65, 8.75], "ink": "utnRelief"})
        s += every
    return out


def on(edge, ops):
    return [{**o, "edge": edge} for o in ops]


def south_f(u0, u1):
    """un tramo [u0, u1] del frente del Paseo en fracciones de su arista, que corre de ESTE a OESTE"""
    return [round((HW - u1) / W, 4), round((HW - u0) / W, 4)]


tiers = []
# ── el anillo de dos plantas ──────────────────────────────────────────────────────────────────────
gates_s = [{"f": south_f(u - 1.6, u + 1.6), "z": [0, 3.4], "ink": "utnGrille"} for u in (-27, -18, 18, 27)]
gates_n = [{"f": [round((u + HW - 1.4) / W, 4), round((u + HW + 1.4) / W, 4)], "z": [0, 3.2], "ink": "utnGrille"} for u in (-12, 2, 18)]
tiers.append({"_": "LA PLANTA BAJA: hacia el Paseo, zócalo AZUL hasta la cadera y blanco arriba, con portones de reja; los MURALES de colores a lo largo de Calle 3; concreto hacia Calle 1, y hacia Avenida 2 el zócalo azul otra vez",
  "box": [W, D], "z": [0, Z1], "wall": "utnWhite", "cap": "utnConcrete", "bands": [[0, 0.43, "utnBlue"]],
  "faces": {"0": {"wall": "utnConcrete", "bands": [[0, 0.43, "utnBlue"]]}, "1": {"wall": "utnConcrete", "bands": [[0, 0.08, "utnConcreteDark"]]},
            "3": {"wall": "mural", "bands": [[0, 0.1, "utnConcreteDark"]]}},
  "openings": on(2, gates_s) + on(0, gates_n) + [{"edge": 1, "f": [0.44, 0.56], "z": [0, 3.4], "ink": "utnGrille"}]})
CT = 9.0                    # las torres de las esquinas: 9 x 9 m (la foto de la torre de las anclas)
# el ALERO vuela 1,8 m sobre las aceras ENTRE las torres: en la foto se corta contra cada una
for k, (box, at) in enumerate((([W - 2 * CT, 1.8], [0, -HD - 0.9]), ([W - 2 * CT, 1.8], [0, HD + 0.9]),
                               ([1.8, D - 2 * CT], [-HW - 0.9, 0]), ([1.8, D - 2 * CT], [HW + 0.9, 0]))):
    tiers.append({**({"_": "el ALERO: la losa blanca que vuela 1,8 m sobre las aceras, cortada contra cada torre"} if k == 0 else {}),
                  "box": [round(box[0], 2), round(box[1], 2)], "at": [round(at[0], 2), round(at[1], 2)], "z": [Z1, ZM], "wall": "utnTrim", "cap": "utnTrim"})
skip_s = [(0, CT + 0.6), (HW - 11.4, HW + 11.4), (W - CT - 0.6, W)]   # ni detrás del frontón ni en las torres de las esquinas
# las dos ESTRÍAS de la cornisa (la foto del emblema): dos rayas hundidas arriba de la planta alta
GROOVES = [[0.8, 0.815, "utnConcreteDark"], [0.86, 0.875, "utnConcreteDark"]]
tiers.append({"_": "LA PLANTA ALTA de las alas: crema hacia el Paseo y concreto gris en los otros lados; ventanas en PAREJAS con el emblema de estrella y caduceo entre cada grupo, y la cornisa arriba",
  "box": [W, D], "z": [ZM, Z2], "wall": "utnCream", "cap": "utnRoofFlat", "bands": GROOVES + [[0.9, 0.95, "utnTrim"]],
  "faces": {"0": {"wall": "utnConcrete", "bands": GROOVES + [[0.9, 0.95, "utnConcreteDark"]]}, "1": {"wall": "utnConcrete", "bands": GROOVES + [[0.9, 0.95, "utnConcreteDark"]]},
            "3": {"wall": "utnConcrete", "bands": GROOVES + [[0.9, 0.95, "utnConcreteDark"]]}},
  "openings": on(2, pairs(W, skip_s)) + on(3, pairs(D, [(0, CT + 0.6), (D - CT - 0.6, D)])) + on(0, pairs(W, [(0, CT + 0.6), (W - CT - 0.6, W), (HW + 0.5, HW + 13.5)]))})

# ── LAS CUATRO TORRES DE LAS ESQUINAS, iguales, como la de la foto ───────────────────────────────
def corner(su, sv):
    return [round(su * (HW - CT / 2), 2), round(sv * (HD - CT / 2), 2)]
TZ = 10.2                    # el cuerpo de la torre; la pilastra de la esquina remata a 11,2 (la foto: sobre el pretil de 9)

def tower(su, sv, note, openings, wall="utnConcrete", bands=None):
    """una torre de esquina como la de la foto: el cuerpo, la pilastra de la esquina y las ALETAS
    escalonadas —tres que bajan hacia el centro de cada cara exterior y dos que bajan hacia el ala—"""
    cu, cv = corner(su, sv)
    out = [{**({"_": note} if note else {}), "box": [CT, CT], "at": [cu, cv], "z": [0, TZ], "wall": wall, "cap": "utnConcreteLite",
            "bands": (bands or []) + [[0, 0.04, "utnConcreteDark"], [0.97, 1, "utnConcreteDark"]], "openings": openings}]
    ex, ey = cu + su * CT / 2, cv + sv * CT / 2            # la esquina de afuera
    out.append({"box": [1.5, 1.5], "at": [round(ex - su * 0.55, 2), round(ey - sv * 0.55, 2)], "z": [0, 11.2], "wall": wall, "cap": "utnConcreteLite"})
    for k, d in enumerate((1.6, 2.3, 3.0)):               # las aletas que bajan hacia el centro de cada cara
        z = round(10.95 - 0.25 * k, 2)
        out.append({"box": [0.55, 0.5], "at": [round(ex - su * d, 2), round(ey + sv * 0.15, 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
        out.append({"box": [0.5, 0.55], "at": [round(ex + su * 0.15, 2), round(ey - sv * d, 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
    for k, d in enumerate((0.45, 1.1)):                   # y las que bajan hacia el ala, al otro lado de cada cara
        z = round(10.6 - 0.3 * k, 2)
        out.append({"box": [0.55, 0.5], "at": [round(ex - su * (CT - d), 2), round(ey + sv * 0.15, 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
        out.append({"box": [0.5, 0.55], "at": [round(ex + su * 0.15, 2), round(ey - sv * (CT - d), 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
    return out

def faces_of(su, sv):
    """las dos caras exteriores de la esquina (su, sv), como aristas de su caja"""
    return (0 if sv < 0 else 2), (3 if su < 0 else 1)

def lattice_tower(su, sv, note, door=False):
    fv, fu = faces_of(su, sv)
    ops = []
    for e in (fv, fu):
        ops += [{"edge": e, "f": [0.27, 0.73], "z": [5.0, 9.2], "ink": "utnLattice"},                   # la celosía del panel central
                {"edge": e, "f": [0.12, 0.22], "z": [9.0, 9.9], "ink": "utnRelief"},                   # el ancla con su caduceo, en las pilastras
                {"edge": e, "f": [0.78, 0.88], "z": [9.0, 9.9], "ink": "utnRelief"}]
    if door:
        ops += [{"edge": fu, "f": [0.28, 0.72], "z": [0, 4.6], "ink": "utnDoor"},                     # el portón negro
                {"edge": fu, "f": [0.45, 0.55], "z": [2.7, 4.0], "ink": "utnTrim"},                    # su ancla blanca
                {"edge": fu, "f": [0.3, 0.7], "z": [4.6, 4.8], "ink": "utnConcreteDark"}]             # su dintel
    return tower(su, sv, note, ops)

tiers += lattice_tower(-1, -1, "LA TORRE DE LAS ANCLAS, esquina de Calle 3 y Avenida 2 (la foto de la torre): el cuerpo de concreto más alto que el pretil, la pilastra de la esquina y las aletas escalonadas, la CELOSÍA de ladrillo terracota en el panel de cada cara, el portón negro con el ancla blanca hacia Calle 3 y los relieves del ancla en lo alto de las pilastras", door=True)
tiers += lattice_tower(1, -1, None)
fv, fu = faces_of(-1, 1)
tiers += tower(-1, 1, "las dos torres del Paseo, lisas como el pilono de la foto de las alas: concreto, sus aletas escalonadas y los relieves arriba",
               [{"edge": e, "f": f, "z": [9.0, 9.9], "ink": "utnRelief"} for e in (fv, fu) for f in ([0.12, 0.22], [0.78, 0.88])])
fv, fu = faces_of(1, 1)
tiers += tower(1, 1, None, [{"edge": e, "f": f, "z": [9.0, 9.9], "ink": "utnRelief"} for e in (fv, fu) for f in ([0.12, 0.22], [0.78, 0.88])],
               wall="utnCream", bands=[[0, 0.18, "utnBlue"], [0.18, 0.43, "utnWhite"]])
tiers.append({"_": "hacia Avenida 2, el VENTANAL ALTO de bloque de vidrio en su bahía, también bajo el techo", "box": [12.0, 2.0], "at": [7.0, round(-HD + 0.8, 2)], "z": [0, Z2],
  "wall": "utnConcrete", "cap": "utnRoof", "bands": [[0, 0.2, "utnBlue"]],
  "openings": [{"edge": 0, "f": [0.08, 0.36], "z": [4.9, 8.6], "ink": "utnGlassBlock"}, {"edge": 0, "f": [0.42, 0.6], "z": [4.9, 8.7], "ink": "utnGlass"},
               {"edge": 0, "f": [0.66, 0.94], "z": [4.9, 8.6], "ink": "utnGlassBlock"}]})

# ── EL TECHO: la nave central que sube, las de los lados que bajan y la franja del frente ─────────
mid_v = (NAVE_N + NAVE_S) / 2
tiers.append({"_": "LA NAVE CENTRAL: su muro sube del pretil al alero, y encima el techo a DOS AGUAS de zinc blanco, con la cumbrera de norte a sur — lo más alto del edificio",
  "box": [NAVE, NAVE_S - NAVE_N], "at": [0, mid_v], "z": [Z2, EAVE_C], "wall": "utnConcrete", "cap": "utnRoof",
  "windows": {"everyM": 3.4, "wM": 1.6, "z": [9.4, 10.6], "ink": "utnGlass"}})
tiers.append({"box": [NAVE, NAVE_S - NAVE_N], "at": [0, mid_v], "z": [EAVE_C, EAVE_C], "wall": "utnConcrete", "cap": "utnRoof",
  "roof": {"kind": "gable", "axis": "y", "riseM": RISE_C, "ink": "utnRoof", "ink2": "utnRoofShade", "seamsM": 1.2}})
SIDE_W = HW - 0.6 - NAVE / 2
for s, high in ((-1, "e"), (1, "w")):
    tiers.append({**({"_": "LAS NAVES DE LOS LADOS, a UN AGUA: bajan del alero de la central hasta el pretil de Calle 3 y de Calle 1"} if s < 0 else {}),
      "box": [SIDE_W, NAVE_S - (-HD + CT)], "at": [s * (NAVE / 2 + SIDE_W / 2), (NAVE_S + (-HD + CT)) / 2], "z": [Z2, Z2], "wall": "utnConcrete", "cap": "utnRoof",
      "roof": {"kind": "shed", "high": high, "riseM": SIDE_RISE, "ink": "utnRoof", "ink2": "utnRoofShade", "seamsM": 1.2}})
FRONT_D = HD - 0.6 - NAVE_S
tiers.append({"_": "LA FRANJA DEL FRENTE, a UN AGUA: sube desde el pretil del Paseo hasta encontrarse con las naves; de torre a torre, sin montarse en ellas",
  "box": [W - 2 * CT, FRONT_D], "at": [0, NAVE_S + FRONT_D / 2], "z": [Z2, Z2], "wall": "utnConcrete", "cap": "utnRoof",
  "roof": {"kind": "shed", "high": "n", "riseM": SIDE_RISE, "ink": "utnRoof", "ink2": "utnRoofShade", "seamsM": 1.2}})
# los tragaluces: dos filas por agua, como en el satélite; cada uno a la altura del techo bajo él
def skylight(u, v, z):
    return {"box": [1.3, 1.6], "at": [round(u, 2), round(v, 2)], "z": [round(z - 0.05, 2), round(z + 0.08, 2)], "wall": "utnSkylightDark", "cap": "utnSkylight"}
rows = [NAVE_N + 4 + 5.4 * k for k in range(int((NAVE_S - NAVE_N - 6) / 5.4) + 1)]
for v in rows:
    for u in (-NAVE / 4, NAVE / 4):                                    # en las dos aguas de la central
        tiers.append(skylight(u, v, EAVE_C + RISE_C / 2))
    for s in (-1, 1):                                                  # y en cada nave de un lado, a media agua
        if v > -HD + CT + 1: tiers.append(skylight(s * (NAVE / 2 + SIDE_W / 2), v, Z2 + SIDE_RISE / 2))

# ── EL FRENTE DEL PASEO: torre, frontón, torre — simétrico y en el centro ────────────────────────
FV = HD + 1.0          # el frente de la composición sale 1 m sobre el de las alas
FD = 7.0               # y se mete 7 m: llega bajo la franja del techo, no queda como un cartón suelto
tiers.append({"_": "EL FRONTÓN, en el centro: la planta baja oscura de la entrada, los tres ventanales de la planta alta, el FRISO de relieves con su MEDALLÓN de granito, y el remate más alto del frente — pero por debajo de la cumbrera de la nave",
  "box": [11.0, FD], "at": [0, FV - FD / 2], "z": [0, 11.3], "wall": "utnCream", "cap": "utnCream",
  "bands": [[0, 0.08, "utnBlue"], [0.38, 0.41, "utnTrim"], [0.77, 0.885, "utnFrieze"], [0.97, 1, "utnTrim"]],
  "openings": [{"edge": 2, "f": [0.06, 0.94], "z": [0.5, 4.0], "ink": "utnGlass"},
               {"edge": 2, "f": [0.07, 0.3], "z": [4.7, 7.8], "ink": "utnGlass"}, {"edge": 2, "f": [0.385, 0.615], "z": [4.7, 7.8], "ink": "utnGlass"},
               {"edge": 2, "f": [0.7, 0.93], "z": [4.7, 7.8], "ink": "utnGlass"}, {"edge": 2, "f": [0.44, 0.56], "z": [8.5, 10.3], "ink": "utnMedallion"}]})
for s in (-1, 1):
    tiers.append({**({"_": "LAS DOS TORRES del frontón, MACIZAS: zócalo azul, blanco, la ventana alta y el emblema arriba, con su pilastra escalonada hacia afuera"} if s < 0 else {}),
      "box": [5.2, FD], "at": [s * 8.1, FV - FD / 2], "z": [0, 10.2], "wall": "utnCream", "cap": "utnCream",
      "bands": [[0, 0.18, "utnBlue"], [0.18, 0.41, "utnWhite"], [0.41, 0.44, "utnTrim"], [0.96, 1, "utnTrim"]],
      "openings": [{"edge": 2, "f": [0.34, 0.66], "z": [4.9, 8.4], "ink": "utnGlass"}, {"edge": 2, "f": [0.41, 0.59], "z": [8.8, 9.7], "ink": "utnRelief"}]})
    tiers.append({"box": [1.2, FD + 0.4], "at": [s * 10.3, FV - FD / 2 + 0.2], "z": [0, 10.7], "wall": "utnCream", "cap": "utnCream",
                  "bands": [[0, 0.17, "utnBlue"]]})

# ── LAS MACETERAS DEL FRENTE (fotos del autor, 2026-11-17): camas largas contra la fachada, con su
# cordón de ladrillo rojo, el zacate, la baranda negra del lado de la acera, sus árboles de copa redonda
# y las caña de indio rojas; se abren en la entrada del frontón y en la rampa de la izquierda.
# Van en `low` —un cuerpo BAJO aparte, que se pinta antes que todo— y los árboles en `trees`: si las
# maceteras fueran parte del edificio, se pintarían ENCIMA de las copas.
PV0, PV1 = HD + 2.2, HD + 5.7     # un PASO entre la macetera y el edificio, más allá del alero (1,8 m), para que se vea

def rounded(w, d, r, n=4):
    """una huella de rectángulo con las esquinas REDONDEADAS, en metros alrededor de su centro"""
    import math
    pts = []
    for cx, cy, a0 in ((w / 2 - r, -d / 2 + r, -90), (w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append([round(cx + r * math.cos(a), 3), round(cy + r * math.sin(a), 3)])
    return pts
BEDS = [(-HW + 1.0, -27.0), (-23.0, -12.6), (12.6, 23.0), (27.0, HW - 1.0)]
low, trees = [], []
for k, (a, b) in enumerate(BEDS):
    L, cu, cv = b - a, (a + b) / 2, (PV0 + PV1) / 2
    low.append({**({"_": "una macetera: el cordón de ladrillo y el zacate"} if k == 0 else {}),
                "poly": rounded(L, PV1 - PV0, 1.1), "at": [round(cu, 2), round(cv, 2)], "z": [0, 0.45], "wall": "utnBrick", "cap": "utnLawn"})
    low.append({**({"_": "la baranda negra, del lado de la acera"} if k == 0 else {}),
                "box": [round(L - 2.4, 2), 0.14], "at": [round(cu, 2), round(PV1 - 0.15, 2)], "z": [0.45, 1.0], "wall": "utnRail", "cap": "utnRail"})
    n = max(1, round(L / 5.6))
    for i in range(n):
        u = a + L * (i + 0.5) / n
        trees.append({"atM": [round(u, 2), round(cv - 0.2, 2)], "k": "almendro", "s": 0.78})
        if i < n - 1:                                   # entre árbol y árbol, una caña de indio
            uu = a + L * (i + 1) / n
            low.append({"box": [0.7, 0.7], "at": [round(uu, 2), round(cv + 0.5, 2)], "z": [0.45, 0.95], "wall": "utnTiDark", "cap": "utnTi"})

body = {"_note": "LA UNIVERSIDAD TÉCNICA NACIONAL — Sede Tobías Vargas, la ANTIGUA ADUANA del puerto: la bodega art déco de Avenida 2 a Avenida 4 (el Paseo), entre Calle 3 Francisco de Paula Amador y Calle 1. El frente es SIMÉTRICO y va en el CENTRO —torre, frontón, torre—; el techo es una nave central a dos aguas que sube por encima de todo, dos naves de los lados que bajan hacia la calle y la franja del frente que sube desde el Paseo; el frontón y sus torres quedan bajo la cumbrera; las cuatro torres de las esquinas, iguales, como la de la foto: más altas que el pretil, con la pilastra de la esquina, aletas escalonadas, celosía y relieves. Medida contra las fotos del autor, Street View, el satélite y una aérea, y ajustada a la CUADRA medida en el ráster (80 x 73 m, corrida `placeM` del centro del lote del campus `osm_campus_112244756`), PEGADA ATRÁS, con piso gris y las maceteras redondeadas al frente; la huella real es de ~84 x 87 m. `u` va a lo largo de las avenidas (este), `v` hacia el Paseo (sur); aristas de una `box`: 0 norte, 1 este, 2 sur (de este a oeste), 3 oeste. La escribe `tools/gen_utn_body.py`, que dice de qué foto sale cada medida.",
        "tiers": tiers, "low": low, "trees": trees, "placeM": PLACE_M,
        "ground": {"rectM": [LAND_U[0] - 4, LAND_V[0] - 4, LAND_U[1] + 4, LAND_V[1] + 4], "ink": "utnPavement",
                   "_": "el piso GRIS de concreto de toda la cuadra —así se distinguen las maceteras—, 4 m más allá de lo medido: la cuadra se curva hacia el Paseo, y la acera, que se pinta después, tapa lo que sobre"}}

if __name__ == "__main__":
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "assets", "world-props.json")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    line = '    "utn": ' + json.dumps(body, ensure_ascii=False) + ","
    new, n = re.subn(r'^    "utn": \{.*\},$', lambda m: line, text, count=1, flags=re.M)
    assert n == 1, "no encontré la línea de bodies.utn"
    json.loads(new)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(new)
    print(f"[utn] {len(tiers)} bloques -> {os.path.relpath(path)}")
