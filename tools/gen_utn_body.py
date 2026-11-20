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
* EL TECHO (satélite y sus acercamientos de las esquinas): el techo alto es UNO, y se dibuja CARA POR
  CARA (`facet`) para que sus juntas sean diagonales de verdad. La franja del frente
  va a cuatro aguas y mide de fondo lo que los brazos de ancho (~15,7 m), así que la punta de su
  cumbrera cae sobre la de cada brazo y el techo dobla en L en cada esquina; brazos y nave llegan hasta
  la cumbrera del frente (la nave es la T). La mitad trasera de los lados va en V, con su canal abajo.
* LAS TORRES DE LAS ESQUINAS (fotos de la torre y Street View de Calle 1, nov. 2024): las cuatro
  iguales, ~6,5 m de cara, del alto del ala y BAJO EL TECHO. Cada cara de afuera: el PANEL del centro
  metido entre dos PILASTRAS que salen, con ALETAS escalonadas hacia la esquina; la celosía terracota
  con su remate ochavado y su retícula; el relieve del ancla arriba de cada pilastra y el escudo abajo.
  Las de Avenida 2 llevan hacia su calle el portón negro con el ancla blanca bajo una repisa que vuela.
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
CT = 6.5                    # las torres de las esquinas: ~6,5 m de cara (la foto de Calle 1: 730 px de ancho por 1 150 de alto, del alto del ala)
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
TZ = Z2                      # el cuerpo llega al pretil, AL RAS de las paredes del anillo: más bajo, el anillo (que se pinta
                             # después por ser más alto) le tapaba la cara y con ella la celosía
PW, PP = 1.4, 0.35           # las pilastras: su ancho a lo largo de la cara y lo que salen de ella

def face_edge(axis, sgn):
    """la arista de una caja que mira hacia afuera: eje v (norte/sur) o u (oeste/este)"""
    return (0 if sgn < 0 else 2) if axis == "v" else (3 if sgn < 0 else 1)

def tower(su, sv, note, door_axis=None):
    """UNA TORRE DE ESQUINA, cara por cara como en la foto de Calle 1: el cuerpo, y en cada cara de
    afuera el PANEL del centro, metido entre dos PILASTRAS que salen y suben más, con ALETAS que bajan
    escalonadas hacia la esquina; en el panel la CELOSÍA terracota con su remate ochavado y su retícula,
    y en la cara del portón la puerta negra con su ancla blanca bajo una REPISA que vuela; el relieve del
    ancla arriba de cada pilastra y el escudo abajo en la de la esquina"""
    cu, cv = corner(su, sv)
    face_ops = {}
    out = []
    for axis, sgn in (("v", sv), ("u", su)):
        e = face_edge(axis, sgn)
        ops = lattice(e, 0.31, 0.69, 4.5, 7.8) + [
            {"edge": e, "f": [0.36, 0.64], "z": [7.8, 8.15], "ink": "utnLattice"},        # el remate ochavado
            {"edge": e, "f": [0.31, 0.69], "z": [7.8, 7.85], "ink": "utnLatticeHole"}]
        if axis == door_axis:
            ops += [{"edge": e, "f": [0.32, 0.68], "z": [0, 4.2], "ink": "utnDoor"},
                    {"edge": e, "f": [0.455, 0.545], "z": [2.4, 3.6], "ink": "utnTrim"},       # el ancla blanca del portón
                    {"edge": e, "f": [0.4, 0.6], "z": [3.4, 3.55], "ink": "utnTrim"}]
        face_ops[e] = ops
        # las dos pilastras de esta cara y sus aletas
        for end in (1, -1):                                   # 1 = la de la esquina, -1 = la del lado del ala
            off = (CT / 2 - PW / 2) * end
            if axis == "v":
                pu, pv, box = cu + su * off, cv + sv * (CT / 2 + PP / 2), [PW, PP]
            else:
                pu, pv, box = cu + su * (CT / 2 + PP / 2), cv + sv * off, [PP, PW]
            rel = [{"edge": e, "f": [0.22, 0.78], "z": [7.5, 8.4], "ink": "utnRelief"}]
            if end == 1 and axis == "v":
                rel.append({"edge": e, "f": [0.28, 0.72], "z": [0.9, 1.7], "ink": "utnRelief"})   # el escudo de abajo
            out.append({"box": box, "at": [round(pu, 2), round(pv, 2)], "z": [0, Z2], "wall": "utnConcrete", "cap": "utnConcreteLite", "openings": rel})
            for k in range(2 if end == 1 else 1):            # las aletas: dos hacia la esquina, una hacia el ala
                d = PW / 2 + 0.22 + 0.32 * k
                z = round(Z2 - 0.25 * (k + 1), 2)
                if axis == "v":
                    fu_, fv_, fbox = pu + su * end * d, cv + sv * (CT / 2 + PP * 0.35), [0.28, PP * 0.7]
                else:
                    fu_, fv_, fbox = cu + su * (CT / 2 + PP * 0.35), pv + sv * end * d, [PP * 0.7, 0.28]
                out.append({"box": fbox, "at": [round(fu_, 2), round(fv_, 2)], "z": [0, z], "wall": "utnConcrete", "cap": "utnConcreteLite"})
        if axis == door_axis:                                 # la repisa que vuela sobre el portón
            if axis == "v":
                out.append({"box": [CT * 0.44, 0.5], "at": [cu, round(cv + sv * (CT / 2 + 0.25), 2)], "z": [4.2, 4.45], "wall": "utnConcreteDark", "cap": "utnConcreteLite"})
            else:
                out.append({"box": [0.5, CT * 0.44], "at": [round(cu + su * (CT / 2 + 0.25), 2), cv], "z": [4.2, 4.45], "wall": "utnConcreteDark", "cap": "utnConcreteLite"})
    body = {**({"_": note} if note else {}), "box": [CT, CT], "at": [cu, cv], "z": [0, TZ], "wall": "utnConcrete", "cap": "utnRoof",
            "bands": [[0, 0.04, "utnConcreteDark"]], "openings": [o for ops in face_ops.values() for o in ops]}
    return [body] + out

def lattice(edge, f0, f1, z0, z1, cols=5, rows=7):
    """LA CELOSÍA de ladrillo terracota: el paño y su retícula de huecos oscuros, que es lo que la
    hace celosía y no un cuadro de color (la foto de la torre)"""
    out = [{"edge": edge, "f": [f0, f1], "z": [z0, z1], "ink": "utnLattice"}]
    cw, rh = (f1 - f0) / cols, (z1 - z0) / rows
    for i in range(cols):
        for j in range(rows):
            out.append({"edge": edge, "f": [round(f0 + cw * (i + 0.28), 4), round(f0 + cw * (i + 0.72), 4)],
                        "z": [round(z0 + rh * (j + 0.25), 3), round(z0 + rh * (j + 0.75), 3)], "ink": "utnLatticeHole"})
    return out

tiers += tower(-1, -1, "LA TORRE DE LAS ANCLAS, esquina de Calle 3 y Avenida 2, con su portón hacia Calle 3", door_axis="u")
tiers += tower(1, -1, "las otras tres torres, iguales y con su portón hacia la calle de su costado (Street View de Calle 1)", door_axis="u")
tiers += tower(-1, 1, None)
tiers += tower(1, 1, None)
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
NAVE = round(W * 0.344, 2)
IS = round(W * 0.152, 2)                # la franja de adentro
OS = round(HW - NAVE / 2 - IS, 2)       # la de afuera: el ancho de los brazos
FW = OS                                 # LA FRANJA DEL FRENTE MIDE DE FONDO LO QUE LOS BRAZOS DE ANCHO (las fotos de
                                        # las esquinas: ~15,7 m las dos), y por eso a cuatro aguas la punta de su
                                        # cumbrera cae justo sobre la de cada brazo: el techo alto dobla en L
EAVE, RIDGE = 10.2, 14.0                # el techo alto: alero y cumbrera de la franja, la nave y los brazos
GUTTER = 9.7                            # la canal llana entre la nave y cada brazo, en la mitad delantera
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
    tiers += block([IS, HD], [r2(s * (NAVE / 2 + IS / 2)), r2(-HD / 2)], Z2, Z2, {"kind": "shed", "high": hi, "riseM": r2(EAVE - Z2)},
                   "LA FRANJA DE ADENTRO, mitad trasera: baja desde la nave hasta la canal de la V" if s < 0 else None)
    # …Y EN LA MITAD DELANTERA UNE LA NAVE CON EL BRAZO: dos aguas cortas que bajan de los dos aleros
    # (10,2 m) a una canal llana a `GUTTER`; bajando hasta el pretil quedaba una zanja con una pared de
    # cada lado, y la nave y los brazos se veían sueltos
    for half, h in ((-1, hi), (1, lo)):
        uc = s * (NAVE / 2 + IS / 4 + (IS / 2 if half > 0 else 0))
        tiers += block([r2(IS / 2), r2(VF)], [r2(uc), r2(VF / 2)], Z2, GUTTER, {"kind": "shed", "high": h, "riseM": r2(EAVE - GUTTER)},
                       "la franja de adentro, mitad delantera: la canal llana entre la nave y el brazo" if s < 0 and half < 0 else None)
RL = HD - FW / 2                        # la línea de la cumbrera del frente
VN = 0.0                                # donde empiezan los brazos: la mitad del costado
UA = HW - OS / 2                        # la cumbrera de cada brazo
UI = HW - OS                            # el alero de adentro de cada brazo
NH = NAVE / 2
E_, R_ = EAVE, RIDGE

def wall(box, at, note=None):
    """el muro que sube del pretil al alero bajo el techo alto"""
    return {**({"_": note} if note else {}), "box": box, "at": at, "z": [Z2, EAVE], "wall": "utnConcrete", "cap": "utnRoof"}

def face(pts, note=None, wall_ink=None):
    """UNA CARA DEL TECHO ALTO, con la altura de cada vértice: así se cruzan las aguas con su canal en diagonal"""
    out = {**({"_": note} if note else {}), "facet": [[r2(u), r2(v), r2(z)] for u, v, z in pts]}
    if wall_ink:
        out.update({"ink": wall_ink, "wallFacet": True})
    else:
        out.update({"ink": "utnRoof", "ink2": "utnRoofShade"})
    return out

# los muros bajo el techo alto: los brazos, la nave y la franja del frente
for s in (-1, 1):
    tiers.append(wall([OS, r2(HD - VN)], [r2(s * UA), r2((VN + HD) / 2)], "los muros bajo el techo alto, del pretil al alero" if s < 0 else None))
tiers.append(wall([NAVE, r2(VF + HD)], [0, r2((VF - HD) / 2)]))
tiers[-1]["windows"] = {"everyM": 3.4, "wM": 1.6, "z": [9.3, 10.0], "ink": "utnGlass"}
tiers.append(wall([W, FW], [0, r2(HD - FW / 2)]))

# EL TECHO ALTO, CARA POR CARA (los acercamientos del satélite y el dibujo del autor). La franja del frente
# mide de fondo lo que un brazo de ancho, así que su cumbrera y la de cada brazo se encuentran en un punto
# (±UA, RL): desde ahí baja la LIMATESA de la esquina hacia afuera (la L) y la CANAL en diagonal hacia
# adentro. La nave llega con su cumbrera al CENTRO de la del frente (0, RL), y sus dos aguas se cortan
# contra la cara norte del frente en dos canales en diagonal (la T).
tiers.append(face([(-HW, HD, E_), (HW, HD, E_), (UA, RL, R_), (-UA, RL, R_)],
                  "la cara sur del frente: del alero del Paseo a la cumbrera"))
tiers.append(face([(-UI, VF, E_), (-UA, RL, R_), (UA, RL, R_), (UI, VF, E_), (NH, VF, E_), (0, RL, R_), (-NH, VF, E_)],
                  "la cara norte del frente: entre las canales de los brazos y las de la nave"))
for s in (-1, 1):
    tiers.append(face([(s * HW, VN, E_), (s * UA, VN, R_), (s * UA, RL, R_), (s * HW, HD, E_)],
                      "la cara de afuera de cada brazo: cierra en diagonal en la esquina — la L" if s < 0 else None))
    tiers.append(face([(s * UA, VN, R_), (s * UI, VN, E_), (s * UI, VF, E_), (s * UA, RL, R_)],
                      "la cara de adentro de cada brazo: cierra en diagonal contra la cara norte del frente" if s < 0 else None))
    tiers.append(face([(s * HW, VN, E_), (s * UI, VN, E_), (s * UA, VN, R_)],
                      "el hastial de cada brazo, a la mitad del costado" if s < 0 else None, wall_ink="utnConcrete"))
    tiers.append(face([(s * NH, -HD, E_), (0, -HD, R_), (0, RL, R_), (s * NH, VF, E_)],
                      "las dos aguas de la nave: llegan con su cumbrera al centro de la del frente — la T" if s < 0 else None))
tiers.append(face([(-NH, -HD, E_), (NH, -HD, E_), (0, -HD, R_)], "el hastial de la nave sobre Avenida 2", wall_ink="utnConcrete"))

# los tragaluces, donde el satélite los pone: dos columnas en la nave junto a la cumbrera, una en cada
# franja de adentro y una en cada mitad trasera de afuera; cada uno a la altura del techo bajo él
def skylight(u, v, z):
    return {"box": [1.3, 1.6], "at": [r2(u), r2(v)], "z": [r2(z - 0.05), r2(z + 0.08)], "wall": "utnSkylightDark", "cap": "utnSkylight"}
rows = [-HD + 3.5 + 4.6 * k for k in range(int((VF + HD - 5) / 4.6) + 1)]
for v in rows:
    for u in (-W * 0.07, W * 0.07):                                   # la nave: a 0,07 W de la cumbrera
        tiers.append(skylight(u, v, EAVE + (RIDGE - EAVE) * (1 - abs(u) / (NAVE / 2))))
    for s in (-1, 1):
        tiers.append(skylight(s * (NAVE / 2 + IS / 4), v, (EAVE + GUTTER) / 2 if v > 0 else (EAVE + Z2) / 2 + (EAVE - Z2) / 4))   # la franja de adentro
        if v < -2:
            tiers.append(skylight(s * (HW - OS / 2), v, (EAVE + Z2) / 2))           # la mitad trasera de afuera

# ── EL FRENTE DEL PASEO: torre, frontón, torre — simétrico y en el centro ────────────────────────
FV = HD                # el frente de la composición va AL RAS de las alas: una sola línea de fachada, no un cuadro pegado
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
    tiers.append({"box": [1.2, FD], "at": [s * 10.3, FV - FD / 2], "z": [0, 9.9], "wall": "utnCream", "cap": "utnCream",
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
