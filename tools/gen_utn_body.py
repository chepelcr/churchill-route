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
* LAS ESQUINAS: las cuatro del mismo tamaño y BAJO el techo —suben hasta el pretil, y desde arriba
  se ve el techo y no una tapa gris encima—. La del Paseo con Calle 3 es un pilono liso (foto de las
  alas); la torre de las anclas, con su celosía, es la de Calle 3 y Avenida 2; hacia Avenida 2 va el
  ventanal de bloque de vidrio (Street View, nov. 2024).
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
                out.append({"f": [round((e - 0.45) / edge_len, 4), round((e + 0.45) / edge_len, 4)], "z": [7.8, 8.6], "ink": "utnRelief"})
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
tiers.append({"_": "el ALERO: la losa blanca que vuela 1,8 m sobre las cuatro aceras", "box": [W + 3.6, D + 3.6], "z": [Z1, ZM], "wall": "utnTrim", "cap": "utnTrim"})
skip_s = [(HW - 11.4, HW + 11.4)]          # detrás de las torres y el frontón no hay ventanas de ala
tiers.append({"_": "LA PLANTA ALTA de las alas: crema hacia el Paseo y concreto gris en los otros lados; ventanas en PAREJAS con el emblema de estrella y caduceo entre cada grupo, y la cornisa arriba",
  "box": [W, D], "z": [ZM, Z2], "wall": "utnCream", "cap": "utnRoofFlat", "bands": [[0.9, 0.95, "utnTrim"]],
  "faces": {"0": {"wall": "utnConcrete", "bands": [[0.9, 0.95, "utnConcreteDark"]]}, "1": {"wall": "utnConcrete", "bands": [[0.9, 0.95, "utnConcreteDark"]]},
            "3": {"wall": "utnConcrete", "bands": [[0.9, 0.95, "utnConcreteDark"]]}},
  "openings": on(2, pairs(W, skip_s)) + on(3, pairs(D, [(0, 8), (D - 8, D)])) + on(0, pairs(W, [(0, 8), (W - 8, W), (HW + 0.5, HW + 13.5)]))})

# ── LAS CUATRO ESQUINAS, del mismo tamaño y BAJO EL TECHO: suben hasta el pretil y el techo las tapa ──
# (se escriben ANTES que el techo: a la misma altura, el orden de la receta decide quién tapa a quién)
CT = 7.0
def corner(su, sv):
    return [round(su * (HW - CT / 2), 2), round(sv * (HD - CT / 2), 2)]
tiers.append({"_": "LA TORRE DE LAS ANCLAS, esquina de Calle 3 y Avenida 2: la CELOSÍA de ladrillo terracota en sus dos caras, el portón negro con el ancla blanca hacia Calle 3 y los relieves de ancla y caduceo arriba",
  "box": [CT, CT], "at": corner(-1, -1), "z": [0, Z2], "wall": "utnConcrete", "cap": "utnRoof",
  "bands": [[0, 0.05, "utnConcreteDark"]],
  "openings": [{"edge": 3, "f": [0.2, 0.8], "z": [5.2, 8.4], "ink": "utnLattice"}, {"edge": 3, "f": [0.25, 0.75], "z": [0, 4.2], "ink": "utnDoor"},
               {"edge": 3, "f": [0.44, 0.56], "z": [2.4, 3.6], "ink": "utnTrim"}, {"edge": 0, "f": [0.2, 0.8], "z": [5.2, 8.4], "ink": "utnLattice"}]})
tiers.append({"_": "el pilono liso de Calle 3 y el Paseo", "box": [CT, CT], "at": corner(-1, 1), "z": [0, Z2], "wall": "utnConcrete", "cap": "utnRoof"})
tiers.append({"box": [CT, CT], "at": corner(1, -1), "z": [0, Z2], "wall": "utnConcrete", "cap": "utnRoof"})
tiers.append({"box": [CT, CT], "at": corner(1, 1), "z": [0, Z2], "wall": "utnCream", "cap": "utnRoof", "bands": [[0, 0.21, "utnBlue"], [0.21, 0.49, "utnWhite"]]})
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
      "box": [SIDE_W, NAVE_S - NAVE_N], "at": [s * (NAVE / 2 + SIDE_W / 2), mid_v], "z": [Z2, Z2], "wall": "utnConcrete", "cap": "utnRoof",
      "roof": {"kind": "shed", "high": high, "riseM": SIDE_RISE, "ink": "utnRoof", "ink2": "utnRoofShade", "seamsM": 1.2}})
FRONT_D = HD - 0.6 - NAVE_S
tiers.append({"_": "LA FRANJA DEL FRENTE, a UN AGUA: sube desde el pretil del Paseo hasta encontrarse con las naves",
  "box": [W - 1.2, FRONT_D], "at": [0, NAVE_S + FRONT_D / 2], "z": [Z2, Z2], "wall": "utnConcrete", "cap": "utnRoof",
  "roof": {"kind": "shed", "high": "n", "riseM": SIDE_RISE, "ink": "utnRoof", "ink2": "utnRoofShade", "seamsM": 1.2}})
# los tragaluces: dos filas por agua, como en el satélite; cada uno a la altura del techo bajo él
def skylight(u, v, z):
    return {"box": [1.3, 1.6], "at": [round(u, 2), round(v, 2)], "z": [round(z - 0.05, 2), round(z + 0.08, 2)], "wall": "utnSkylightDark", "cap": "utnSkylight"}
rows = [NAVE_N + 4 + 5.4 * k for k in range(int((NAVE_S - NAVE_N - 6) / 5.4) + 1)]
for v in rows:
    for u in (-NAVE / 4, NAVE / 4):                                    # en las dos aguas de la central
        tiers.append(skylight(u, v, EAVE_C + RISE_C / 2))
    for s in (-1, 1):                                                  # y en cada nave de un lado, a media agua
        tiers.append(skylight(s * (NAVE / 2 + SIDE_W / 2), v, Z2 + SIDE_RISE / 2))

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
PV0, PV1 = HD + 0.6, HD + 5.6
BEDS = [(-HW + 1.0, -27.0), (-23.0, -12.6), (12.6, 23.0), (27.0, HW - 1.0)]
low, trees = [], []
for k, (a, b) in enumerate(BEDS):
    L, cu, cv = b - a, (a + b) / 2, (PV0 + PV1) / 2
    low.append({**({"_": "una macetera: el cordón de ladrillo y el zacate"} if k == 0 else {}),
                "box": [round(L, 2), PV1 - PV0], "at": [round(cu, 2), round(cv, 2)], "z": [0, 0.45], "wall": "utnBrick", "cap": "utnLawn"})
    low.append({**({"_": "la baranda negra, del lado de la acera"} if k == 0 else {}),
                "box": [round(L, 2), 0.14], "at": [round(cu, 2), round(PV1 - 0.1, 2)], "z": [0.45, 1.0], "wall": "utnRail", "cap": "utnRail"})
    n = max(1, round(L / 5.6))
    for i in range(n):
        u = a + L * (i + 0.5) / n
        trees.append({"atM": [round(u, 2), round(cv - 0.3, 2)], "k": "almendro", "s": 0.78})
        if i < n - 1:                                   # entre árbol y árbol, una caña de indio
            uu = a + L * (i + 1) / n
            low.append({"box": [0.7, 0.7], "at": [round(uu, 2), round(cv + 0.6, 2)], "z": [0.45, 0.95], "wall": "utnTiDark", "cap": "utnTi"})

body = {"_note": "LA UNIVERSIDAD TÉCNICA NACIONAL — Sede Tobías Vargas, la ANTIGUA ADUANA del puerto: la bodega art déco de Avenida 2 a Avenida 4 (el Paseo), entre Calle 3 Francisco de Paula Amador y Calle 1. El frente es SIMÉTRICO y va en el CENTRO —torre, frontón, torre—; el techo es una nave central a dos aguas que sube por encima de todo, dos naves de los lados que bajan hacia la calle y la franja del frente que sube desde el Paseo; las torres y el frontón quedan bajo la cumbrera. Medida contra las fotos del autor, Street View, el satélite y una aérea, y ajustada a la CUADRA medida en el ráster (80 x 73 m, corrida `placeM` del centro del lote del campus `osm_campus_112244756`), con una franja verde al frente y atrás; la huella real es de ~84 x 87 m. `u` va a lo largo de las avenidas (este), `v` hacia el Paseo (sur); aristas de una `box`: 0 norte, 1 este, 2 sur (de este a oeste), 3 oeste. La escribe `tools/gen_utn_body.py`, que dice de qué foto sale cada medida.",
        "tiers": tiers, "low": low, "trees": trees, "placeM": PLACE_M,
        "ground": {"rectM": [LAND_U[0] - 4, LAND_V[0] - 4, LAND_U[1] + 4, LAND_V[1] + 4], "ink": "utnLawn",
                   "_": "el piso VERDE de toda la cuadra, 4 m más allá de lo medido: la cuadra se curva hacia el Paseo, y la acera, que se pinta después, tapa lo que sobre"}}

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
