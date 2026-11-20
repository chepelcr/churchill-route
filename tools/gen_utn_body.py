#!/usr/bin/env python3
"""LA UTN —la antigua Aduana— COMO CUERPO DE RECETA: escribe `world-props.json → bodies.utn`.

    python3 tools/gen_utn_body.py

Muchos de sus bloques se repiten con una regla (las ventanas en parejas con su emblema entre grupos,
los tragaluces de cada agua del techo): escritos a mano, cambiar el paso de las ventanas era reescribir
cuarenta vanos. La regla vive aquí y el JSON es lo que sale; se reemplaza SÓLO la línea de `"utn"`,
sin reformatear el archivo.

LAS MEDIDAS SALEN DE LAS FOTOS, y cada una dice de cuál:

* EL FRENTE (foto desde el Paseo, 2026-11-20): la composición es SIMÉTRICA y va en el CENTRO —torre,
  frontón, torre—, unos 21 m de los 72, y BAJO EL TECHO: remata por debajo del alero de la franja del
  frente (frontón 9,9 m, torres 9,6). Los tres ventanales del frontón son de la planta alta (4,7 a
  7,8 m), y encima el friso con su medallón.
* EL TECHO (satélite de Google y la foto aérea), franja por franja — ver el bloque «EL TECHO» abajo:
  el techo alto es UNO: la franja del frente a dos aguas de lado a lado, cuya cumbrera cruza la de la
  nave central (una T) y las de los brazos que la doblan hasta la mitad de cada costado (una U); la
  mitad trasera de los lados va en V —la franja de adentro baja desde la nave y la de afuera desde la
  calle, hasta una canal a la altura del pretil—, con sus filas de tragaluces.
* LAS TORRES DE LAS ESQUINAS (foto de la torre de las anclas, 2026-11-20): las cuatro iguales, 9 x 9 m,
  BAJO EL TECHO: su cuerpo llega al pretil y el techo pasa por encima. En cada cara exterior la
  pilastra de la esquina y las ALETAS escalonadas, la CELOSÍA terracota con su retícula de huecos y el
  relieve del ancla con su caduceo. El alero se corta contra ellas. La de Calle 3 y Avenida 2 lleva el
  portón negro con el ancla blanca. Hacia Avenida 2, la salida de bloque de vidrio CENTRADA con la nave.
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
TZ = Z2                      # LAS TORRES VAN BAJO EL TECHO: su cuerpo llega al pretil y el techo pasa por encima

def tower(su, sv, note, openings, wall="utnConcrete", bands=None):
    """una torre de esquina como la de la foto, bajo el techo: el cuerpo, la pilastra de la esquina y
    las ALETAS escalonadas —tres que bajan hacia el centro de cada cara exterior y dos hacia el ala—,
    que salen de la pared y por eso se leen aunque el techo las cubra"""
    cu, cv = corner(su, sv)
    out = [{**({"_": note} if note else {}), "box": [CT, CT], "at": [cu, cv], "z": [0, TZ], "wall": wall, "cap": "utnRoof",
            "bands": (bands or []) + [[0, 0.04, "utnConcreteDark"], [0.96, 1, "utnConcreteDark"]], "openings": openings}]
    ex, ey = cu + su * CT / 2, cv + sv * CT / 2            # la esquina de afuera
    out.append({"box": [1.5, 1.5], "at": [round(ex - su * 0.45, 2), round(ey - sv * 0.45, 2)], "z": [0, TZ], "wall": wall, "cap": "utnConcreteLite"})
    for k, d in enumerate((1.6, 2.3, 3.0)):               # las aletas que bajan hacia el centro de cada cara
        z = round(TZ - 0.35 * (k + 1), 2)
        out.append({"box": [0.55, 0.6], "at": [round(ex - su * d, 2), round(ey + sv * 0.2, 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
        out.append({"box": [0.6, 0.55], "at": [round(ex + su * 0.2, 2), round(ey - sv * d, 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
    for k, d in enumerate((0.45, 1.1)):                   # y las que bajan hacia el ala
        z = round(TZ - 0.5 - 0.35 * k, 2)
        out.append({"box": [0.55, 0.6], "at": [round(ex - su * (CT - d), 2), round(ey + sv * 0.2, 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
        out.append({"box": [0.6, 0.55], "at": [round(ex + su * 0.2, 2), round(ey - sv * (CT - d), 2)], "z": [0, z], "wall": wall, "cap": "utnConcreteLite"})
    return out

def faces_of(su, sv):
    """las dos caras exteriores de la esquina (su, sv), como aristas de su caja"""
    return (0 if sv < 0 else 2), (3 if su < 0 else 1)

def lattice(edge, f0, f1, z0, z1, cols=5, rows=6):
    """LA CELOSÍA de ladrillo terracota: el paño y su retícula de huecos oscuros, que es lo que la
    hace celosía y no un cuadro de color (la foto de la torre)"""
    out = [{"edge": edge, "f": [f0, f1], "z": [z0, z1], "ink": "utnLattice"}]
    cw, rh = (f1 - f0) / cols, (z1 - z0) / rows
    for i in range(cols):
        for j in range(rows):
            out.append({"edge": edge, "f": [round(f0 + cw * (i + 0.28), 4), round(f0 + cw * (i + 0.72), 4)],
                        "z": [round(z0 + rh * (j + 0.25), 3), round(z0 + rh * (j + 0.75), 3)], "ink": "utnLatticeHole"})
    return out

def lattice_tower(su, sv, note, door=False, wall="utnConcrete", bands=None):
    fv, fu = faces_of(su, sv)
    ops = []
    for e in (fv, fu):
        ops += lattice(e, 0.27, 0.73, 4.9, 8.3) + [
                {"edge": e, "f": [0.27, 0.73], "z": [8.3, 8.45], "ink": "utnConcreteDark"},           # el ochavo de arriba de la celosía
                {"edge": e, "f": [0.1, 0.22], "z": [7.4, 8.4], "ink": "utnRelief"},                   # el ancla con su caduceo, en las pilastras
                {"edge": e, "f": [0.78, 0.9], "z": [7.4, 8.4], "ink": "utnRelief"}]
    if door:
        ops += [{"edge": fu, "f": [0.28, 0.72], "z": [0, 4.4], "ink": "utnDoor"},                     # el portón negro
                {"edge": fu, "f": [0.45, 0.55], "z": [2.5, 3.8], "ink": "utnTrim"},                    # su ancla blanca
                {"edge": fu, "f": [0.27, 0.73], "z": [4.4, 4.6], "ink": "utnConcreteDark"}]           # su dintel
    return tower(su, sv, note, ops, wall=wall, bands=bands)

tiers += lattice_tower(-1, -1, "LA TORRE DE LAS ANCLAS, esquina de Calle 3 y Avenida 2 (la foto de la torre): concreto hasta el pretil y BAJO EL TECHO, la pilastra de la esquina y las aletas escalonadas, la CELOSÍA de ladrillo terracota con su retícula en el panel de cada cara, el portón negro con el ancla blanca hacia Calle 3 y los relieves del ancla arriba", door=True)
tiers += lattice_tower(1, -1, None)
tiers += lattice_tower(-1, 1, "las dos torres del Paseo, también con su celosía terracota en cada cara")
tiers += lattice_tower(1, 1, None)
tiers.append({"_": "hacia Avenida 2, el VENTANAL ALTO de bloque de vidrio en su bahía, CENTRADO con la nave del techo", "box": [12.0, 2.0], "at": [0, round(-HD + 0.8, 2)], "z": [0, Z2],
  "wall": "utnConcrete", "cap": "utnRoof", "bands": [[0, 0.2, "utnBlue"]],
  "openings": [{"edge": 0, "f": [0.08, 0.36], "z": [4.9, 8.6], "ink": "utnGlassBlock"}, {"edge": 0, "f": [0.42, 0.58], "z": [0, 8.7], "ink": "utnGlass"},
               {"edge": 0, "f": [0.64, 0.92], "z": [4.9, 8.6], "ink": "utnGlassBlock"}]})

# ── EL TECHO, leído franja por franja en el satélite (en fracciones del edificio: 625 x 595 px) ─────
#  · la FRANJA DEL FRENTE: el último 19 % del fondo, de lado a lado, a cuatro aguas con la cumbrera
#    a lo largo del Paseo — sus puntas son el techo DOBLANDO la esquina;
#  · la NAVE CENTRAL: el 34 % del ancho, centrada, de Avenida 2 a la franja del frente, a dos aguas;
#    MISMO alero y MISMA cumbrera que la franja del frente: son UN techo, en T;
#  · los BRAZOS: las franjas de afuera (17,6 % por lado) en la MITAD DELANTERA, a dos aguas a la misma
#    altura — el techo del frente que dobla y llega hasta la mitad;
#  · la MITAD TRASERA de los lados y la franja de adentro (15,2 %) de punta a punta: con los ALEROS
#    PARA ABAJO, a un agua, bajando hacia la calle, con sus filas de tragaluces.
FW = round(D * 0.19, 2)                 # la franja del frente
NAVE = round(W * 0.344, 2)
IS = round(W * 0.152, 2)                # la franja de adentro
OS = round(HW - NAVE / 2 - IS, 2)       # la de afuera
EAVE, RIDGE = 10.2, 14.0                # el techo alto: alero y cumbrera de la franja, la nave y los brazos
VF = HD - FW                            # el borde de atrás de la franja del frente
ROOF = {"ink": "utnRoof", "ink2": "utnRoofShade", "seamsM": 1.2}

def block(box, at, z0, z1, roof=None, note=None):
    out = []
    if z1 > z0:                         # el muro que sube del pretil al alero de esa pieza
        out.append({"box": box, "at": at, "z": [z0, z1], "wall": "utnConcrete", "cap": "utnRoof"})
    out.append({**({"_": note} if note else {}), "box": box, "at": at, "z": [z1, z1], "wall": "utnConcrete", "cap": "utnRoof", "roof": {**roof, **ROOF}})
    if note and z1 > z0: out[0]["_"] = out[-1].pop("_")
    return out

r2 = lambda v: round(v, 2)
# primero lo BAJO (la mitad trasera y las franjas de adentro), después los brazos y la nave, al final la
# franja del frente: a la misma altura de alero, el orden decide quién tapa la junta
for s, hi, lo in ((-1, "e", "w"), (1, "w", "e")):
    # LA MITAD TRASERA DE LOS LADOS VA EN V: la franja de adentro baja desde la nave y la de afuera
    # desde el pretil de la calle, y se encuentran ABAJO, en una canal a la altura del pretil de las alas
    tiers += block([OS, HD], [r2(s * (HW - OS / 2)), r2(-HD / 2)], Z2, Z2, {"kind": "shed", "high": lo, "riseM": r2(EAVE - Z2)},
                   "LA MITAD TRASERA de afuera: baja desde la calle hasta la canal — la V de los lados de atrás" if s < 0 else None)
    tiers += block([IS, r2(VF + HD)], [r2(s * (NAVE / 2 + IS / 2)), r2((VF - HD) / 2)], Z2, Z2, {"kind": "shed", "high": hi, "riseM": r2(EAVE - Z2)},
                   "LA FRANJA DE ADENTRO, de Avenida 2 a la franja del frente: baja desde la nave hasta la canal" if s < 0 else None)
for s in (-1, 1):
    tiers += block([OS, r2(VF)], [r2(s * (HW - OS / 2)), r2(VF / 2)], Z2, EAVE, {"kind": "gable", "axis": "y", "riseM": r2(RIDGE - EAVE)},
                   "LOS BRAZOS: el techo del frente que dobla la esquina y llega hasta la mitad del costado" if s < 0 else None)
tiers += block([NAVE, r2(VF + HD)], [0, r2((VF - HD) / 2)], Z2, EAVE, {"kind": "gable", "axis": "y", "riseM": r2(RIDGE - EAVE)},
               "LA NAVE CENTRAL, a dos aguas: misma cumbrera que la franja del frente, un solo techo en T")
tiers[-2]["windows"] = {"everyM": 3.4, "wM": 1.6, "z": [9.3, 10.0], "ink": "utnGlass"}
tiers += block([W, FW], [0, r2(HD - FW / 2)], Z2, EAVE, {"kind": "gable", "axis": "x", "riseM": r2(RIDGE - EAVE)},
               "LA FRANJA DEL FRENTE, a dos aguas DE LADO A LADO: su cumbrera cruza las de los brazos y la de la nave, y así el techo alto es UNO — una U con la T de la nave")

# los tragaluces, donde el satélite los pone: dos columnas en la nave junto a la cumbrera, una en cada
# franja de adentro y una en cada mitad trasera de afuera; cada uno a la altura del techo bajo él
def skylight(u, v, z):
    return {"box": [1.3, 1.6], "at": [r2(u), r2(v)], "z": [r2(z - 0.05), r2(z + 0.08)], "wall": "utnSkylightDark", "cap": "utnSkylight"}
rows = [-HD + 3.5 + 4.6 * k for k in range(int((VF + HD - 5) / 4.6) + 1)]
for v in rows:
    for u in (-W * 0.07, W * 0.07):                                   # la nave: a 0,07 W de la cumbrera
        tiers.append(skylight(u, v, EAVE + (RIDGE - EAVE) * (1 - abs(u) / (NAVE / 2))))
    for s in (-1, 1):
        tiers.append(skylight(s * (NAVE / 2 + IS / 2), v, (EAVE + Z2) / 2))         # la franja de adentro
        if v < -2:
            tiers.append(skylight(s * (HW - OS / 2), v, (EAVE + Z2) / 2))           # la mitad trasera de afuera

# ── EL FRENTE DEL PASEO: torre, frontón, torre — simétrico y en el centro ────────────────────────
FV = HD + 1.0          # el frente de la composición sale 1 m sobre el de las alas
FD = 7.0               # y se mete 7 m: llega bajo la franja del techo, no queda como un cartón suelto
tiers.append({"_": "EL FRONTÓN, en el centro: la planta baja oscura de la entrada, los tres ventanales de la planta alta, el FRISO de relieves con su MEDALLÓN de granito — y BAJO EL TECHO: remata por debajo del alero de la franja del frente, que lo cubre",
  "box": [11.0, FD], "at": [0, FV - FD / 2], "z": [0, 9.9], "wall": "utnCream", "cap": "utnCream",
  "bands": [[0, 0.08, "utnBlue"], [0.38, 0.41, "utnTrim"], [0.77, 0.885, "utnFrieze"], [0.97, 1, "utnTrim"]],
  "openings": [{"edge": 2, "f": [0.06, 0.94], "z": [0.5, 4.0], "ink": "utnGlass"},
               {"edge": 2, "f": [0.07, 0.3], "z": [4.7, 7.8], "ink": "utnGlass"}, {"edge": 2, "f": [0.385, 0.615], "z": [4.7, 7.8], "ink": "utnGlass"},
               {"edge": 2, "f": [0.7, 0.93], "z": [4.7, 7.8], "ink": "utnGlass"}, {"edge": 2, "f": [0.44, 0.56], "z": [8.3, 9.6], "ink": "utnMedallion"}]})
for s in (-1, 1):
    tiers.append({**({"_": "LAS DOS TORRES del frontón, MACIZAS: zócalo azul, blanco, la ventana alta y el emblema arriba, con su pilastra escalonada hacia afuera"} if s < 0 else {}),
      "box": [5.2, FD], "at": [s * 8.1, FV - FD / 2], "z": [0, 9.6], "wall": "utnCream", "cap": "utnCream",
      "bands": [[0, 0.18, "utnBlue"], [0.18, 0.41, "utnWhite"], [0.41, 0.44, "utnTrim"], [0.96, 1, "utnTrim"]],
      "openings": [{"edge": 2, "f": [0.34, 0.66], "z": [4.9, 8.4], "ink": "utnGlass"}, {"edge": 2, "f": [0.41, 0.59], "z": [8.6, 9.4], "ink": "utnRelief"}]})
    tiers.append({"box": [1.2, FD + 0.4], "at": [s * 10.3, FV - FD / 2 + 0.2], "z": [0, 10.0], "wall": "utnCream", "cap": "utnCream",
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

body = {"_note": "LA UNIVERSIDAD TÉCNICA NACIONAL — Sede Tobías Vargas, la ANTIGUA ADUANA del puerto: la bodega art déco de Avenida 2 a Avenida 4 (el Paseo), entre Calle 3 Francisco de Paula Amador y Calle 1. El frente es SIMÉTRICO y va en el CENTRO —torre, frontón, torre—; el techo es la nave central y la franja del frente en UN techo en T, la franja que dobla la esquina hasta la mitad de cada costado, y la mitad trasera de los lados con los aleros hacia la calle; las cuatro torres de las esquinas, iguales y bajo el techo, con la pilastra de la esquina, aletas escalonadas, celosía con su retícula y relieves. Medida contra las fotos del autor, Street View, el satélite y una aérea, y ajustada a la CUADRA medida en el ráster (80 x 73 m, corrida `placeM` del centro del lote del campus `osm_campus_112244756`), PEGADA ATRÁS, con piso gris y las maceteras redondeadas al frente; la huella real es de ~84 x 87 m. `u` va a lo largo de las avenidas (este), `v` hacia el Paseo (sur); aristas de una `box`: 0 norte, 1 este, 2 sur (de este a oeste), 3 oeste. La escribe `tools/gen_utn_body.py`, que dice de qué foto sale cada medida.",
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
