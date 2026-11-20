#!/usr/bin/env python3
"""LA UTN —la antigua Aduana— COMO CUERPO DE RECETA: escribe `world-props.json → bodies.utn`.

    python3 tools/gen_utn_body.py

La receta son ~60 bloques y muchos se repiten con una regla (las ventanas en parejas con su emblema
entre grupos, las pilastras escalonadas de cada pilono, las cinco naves y sus claraboyas): escritos a
mano, cambiar el paso de las ventanas era reescribir cuarenta vanos. La regla vive aquí y el JSON es
lo que sale; se reemplaza SÓLO la línea de `"utn"`, sin reformatear el archivo.
"""
import json
import re
W, D = 71.6, 66.0          # la huella, hasta el borde del lote: la fachada da directo a la acera; (u este, v sur): aristas 0 N, 1 E, 2 S, 3 O
HW, HD = W / 2, D / 2
Z1, ZM, Z2 = 4.4, 4.8, 9.0  # planta baja, alero, pretil de las alas

def pairs(edge_len, ranges_skip=(), every=6.6, margin=3.4, ink="utnGlass", relief=True, z=(5.5, 7.4)):
    """ventanas en PAREJAS cada `every` m y el emblema entre grupos: en fracción de la arista"""
    out, s = [], margin
    while s + 3.4 < edge_len - margin:
        c = s + 1.7
        if not any(a <= c <= b for a, b in ranges_skip):
            for o in (-0.95, 0.95):
                out.append({"f": [round((c + o - 0.75) / edge_len, 4), round((c + o + 0.75) / edge_len, 4)], "z": list(z), "ink": ink})
            if relief and s + every + 1.7 < edge_len - margin:
                e = c + every / 2
                if not any(a <= e <= b for a, b in ranges_skip):
                    out.append({"f": [round((e - 0.45) / edge_len, 4), round((e + 0.45) / edge_len, 4)], "z": [7.6, 8.6], "ink": "utnRelief"})
        s += every
    return out

def on(edge, ops): return [{**o, "edge": edge} for o in ops]

def fins(u, v, d, z, ink="utnConcrete", along="v"):
    box = [1.0, d] if along == "v" else [d, 1.0]
    return {"box": box, "at": [u, v], "z": [0, z], "wall": ink, "cap": "utnConcreteDark"}

tiers = []
# ── la planta baja ────────────────────────────────────────────────────────────────────────────────
# el frente del Paseo (arista 2) corre de ESTE a OESTE: f = 0 en la esquina de Calle 1
CU = 8.0                                   # el centro del cuerpo alzado, al este del medio (foto aérea)
gates_s = [{"f": [round((HW - u - 1.6) / W, 4), round((HW - u + 1.6) / W, 4)], "z": [0, 3.4], "ink": "utnGrille"} for u in (-24, -14, -4, 24)]
gates_n = [{"f": [round((u + HW - 1.4) / W, 4), round((u + HW + 1.4) / W, 4)], "z": [0, 3.2], "ink": "utnGrille"} for u in (-12, 2, 18)]
tiers.append({"_": "LA PLANTA BAJA: hacia el Paseo, zócalo AZUL hasta la cadera y blanco arriba, con portones de reja; los MURALES de colores a lo largo de Calle 3; concreto pelado hacia Avenida 2 y Calle 1",
  "box": [W, D], "z": [0, Z1], "wall": "utnWhite", "cap": "utnConcrete", "bands": [[0, 0.43, "utnBlue"]],
  "faces": {"0": {"wall": "utnConcrete", "bands": [[0, 0.43, "utnBlue"]]}, "1": {"wall": "utnConcrete", "bands": [[0, 0.08, "utnConcreteDark"]]},
            "3": {"wall": "mural", "bands": [[0, 0.1, "utnConcreteDark"]]}},
  "openings": on(2, gates_s) + on(0, gates_n) + [{"edge": 1, "f": [0.44, 0.56], "z": [0, 3.4], "ink": "utnGrille"}]})
tiers.append({"_": "el ALERO: la losa blanca que vuela sobre las aceras del Paseo, de Calle 3 y de Avenida 2", "box": [W + 3.6, D + 3.6], "at": [0, 0], "z": [Z1, ZM], "wall": "utnTrim", "cap": "utnTrim"})
# ── la planta alta de las alas: ventanas en parejas y el emblema entre grupos ─────────────────────
skip_s = [(HW - (CU + 13.5), HW - (CU - 13.5))]      # detrás del cuerpo alzado no hay ventanas
tiers.append({"_": "LA PLANTA ALTA de las alas: crema hacia el Paseo, concreto gris en los otros tres lados; ventanas en PAREJAS con su emblema de estrella y caduceo entre cada grupo, y la cornisa arriba",
  "box": [W, D], "z": [ZM, Z2], "wall": "utnCream", "cap": "utnRoofFlat", "bands": [[0.9, 0.95, "utnTrim"]], "stains": "oldStain",
  "faces": {"0": {"wall": "utnConcrete", "bands": [[0.9, 0.95, "utnConcreteDark"]]}, "1": {"wall": "utnConcrete", "bands": [[0.9, 0.95, "utnConcreteDark"]]},
            "3": {"wall": "utnConcrete", "bands": [[0.9, 0.95, "utnConcreteDark"]]}},
  "openings": on(2, pairs(W, skip_s)) + on(3, pairs(D, [(D - 15, D)])) + on(0, pairs(W, [(0, 15), (HW + 0.5, HW + 12.5)]))})
# ── la bodega, METIDA del pretil: su claristorio, las cinco naves de zinc y la claraboya azul ─────
tiers.append({"_": "LA BODEGA, metida del pretil como el techo de la Catedral: el claristorio de concreto con su fila de vanos", "box": [W - 6.4, D - 16.0], "at": [0, -5.0], "z": [Z2, 10.2],
  "wall": "utnConcrete", "cap": "utnRoof", "windows": {"everyM": 3.2, "wM": 1.4, "z": [9.3, 9.9], "ink": "utnGlass"}})
for k, u in enumerate([(W - 6.4) / 5 * i for i in (-2, -1, 0, 1, 2)]):
    tiers.append({**({"_": "las cinco naves de zinc blanco, de norte a sur, cada una con la claraboya azul en la cumbrera (la foto aérea)"} if k == 0 else {}),
      "box": [(W - 6.4) / 5, D - 16.0], "at": [u, -5.0], "z": [10.2, 10.2], "wall": "utnRoofShade", "cap": "utnRoof",
      "roof": {"kind": "gable", "axis": "y", "riseM": 2.6, "ink": "utnRoof", "ink2": "utnRoofShade", "seamsM": 1.2}})
    tiers.append({"box": [1.6, D - 20.0], "at": [u, -5.0], "z": [12.75, 12.95], "wall": "utnSkylightDark", "cap": "utnSkylight"})
# ── EL CUERPO ALZADO DEL PASEO ────────────────────────────────────────────────────────────────────
VF = HD + 1.4                                 # sale 1,4 m sobre el frente de las alas
tiers.append({"_": "EL FRONTÓN: más alto que las alas y saliendo hacia el Paseo, con tres ventanales que suben las dos plantas, la planta baja oscura entre columnas, el FRISO de relieves y su MEDALLÓN de granito",
  "box": [15.0, 6.0], "at": [CU - 2.4, VF - 3.0], "z": [0, 12.6], "wall": "utnCream", "cap": "utnTrim",
  "bands": [[0, 0.1, "utnBlue"], [0.36, 0.38, "utnTrim"], [0.82, 0.95, "utnFrieze"], [0.97, 1, "utnTrim"]],
  "openings": [{"edge": 2, "f": [0.06, 0.94], "z": [0.6, 4.2], "ink": "utnGlass"},
               {"edge": 2, "f": [0.08, 0.3], "z": [5.0, 9.9], "ink": "utnGlass"}, {"edge": 2, "f": [0.39, 0.61], "z": [5.0, 9.9], "ink": "utnGlass"},
               {"edge": 2, "f": [0.7, 0.92], "z": [5.0, 9.9], "ink": "utnGlass"}, {"edge": 2, "f": [0.43, 0.57], "z": [10.1, 12.4], "ink": "utnMedallion"}]})
tiers.append({"_": "la bahía angosta del VENTANAL OCHAVADO, al este del frontón, con su emblema arriba", "box": [5.0, 5.0], "at": [CU + 7.6, VF - 2.6], "z": [0, 11.4],
  "wall": "utnCream", "cap": "utnTrim", "bands": [[0, 0.17, "utnBlue"], [0.17, 0.38, "utnWhite"], [0.38, 0.41, "utnTrim"]],
  "openings": [{"edge": 2, "f": [0.2, 0.8], "z": [5.0, 10.0], "ink": "utnGlass"}, {"edge": 2, "f": [0.4, 0.6], "z": [10.3, 11.1], "ink": "utnRelief"}]})
for u, z in ((CU - 11.4, 13.6), (CU + 5.1, 13.4), (CU + 10.6, 12.6)):
    tiers.append({"box": [2.6, 6.4], "at": [u, VF - 3.2], "z": [0, z], "wall": "utnCream", "cap": "utnTrim", "bands": [[0, 0.1, "utnBlue"]]})
    tiers.append({"box": [1.0, 6.8], "at": [u, VF - 3.2], "z": [0, z + 0.5], "wall": "utnCream", "cap": "utnTrim"})
# ── la torre de las anclas (Calle 3 y Avenida 2) y los pilonos de las otras esquinas ─────────────
tiers.append({"_": "LA TORRE DE LAS ANCLAS, esquina de Calle 3 y Avenida 2: concreto con la CELOSÍA de ladrillo terracota en sus dos caras, el portón negro con el ancla blanca hacia Calle 3 y los relieves de ancla y caduceo en lo alto",
  "box": [15.4, 13.4], "at": [-HW + 7.5, -HD + 6.5], "z": [0, 12.8], "wall": "utnConcrete", "cap": "utnConcreteDark",
  "bands": [[0, 0.04, "utnConcreteDark"], [0.96, 1, "utnTrim"]],
  "openings": [{"edge": 3, "f": [0.2, 0.62], "z": [6.4, 11.4], "ink": "utnLattice"}, {"edge": 3, "f": [0.26, 0.56], "z": [0, 5.6], "ink": "utnDoor"},
               {"edge": 3, "f": [0.38, 0.44], "z": [3.0, 4.6], "ink": "utnTrim"}, {"edge": 0, "f": [0.5, 0.82], "z": [5.8, 11.4], "ink": "utnLattice"},
               {"edge": 3, "f": [0.8, 0.88], "z": [10.6, 11.8], "ink": "utnRelief"}, {"edge": 0, "f": [0.14, 0.24], "z": [10.6, 11.8], "ink": "utnRelief"}]})
tiers += [fins(-HW - 0.3, -HD + 6.5, 13.8, 14.0), fins(-HW + 15.4, -HD + 6.5, 13.8, 13.4)]
tiers.append({"_": "el pilono liso de la esquina de Calle 3 y el Paseo (foto 2: concreto, su bajante y nada más)", "box": [6.0, 6.0], "at": [-HW + 2.9, HD - 2.9], "z": [0, 11.6],
  "wall": "utnConcrete", "cap": "utnConcreteDark", "stains": "oldStain"})
tiers += [fins(-HW - 0.3, HD - 2.9, 6.4, 12.2), fins(-HW + 6.0, HD - 2.9, 6.4, 11.8)]
for v in (-HD + 3.4, HD - 3.4):
    tiers.append({"box": [6.0, 6.8], "at": [HW - 2.9, v], "z": [0, 11.2], "wall": "utnConcrete" if v < 0 else "utnCream", "cap": "utnConcreteDark",
                  **({"bands": [[0, 0.17, "utnBlue"], [0.17, 0.39, "utnWhite"]]} if v > 0 else {})})
    tiers += [fins(HW + 0.3, v, 7.2, 11.8), fins(HW - 6.0, v, 7.2, 11.4)]
tiers.append({"_": "hacia Avenida 2, el VENTANAL ALTO de bloque de vidrio entre dos pilonos (Street View, nov. 2024)", "box": [12.0, 3.0], "at": [7.0, -HD + 1.2], "z": [0, 11.0],
  "wall": "utnConcrete", "cap": "utnConcreteDark", "bands": [[0, 0.17, "utnBlue"]],
  "openings": [{"edge": 0, "f": [0.08, 0.36], "z": [5.0, 10.0], "ink": "utnGlassBlock"}, {"edge": 0, "f": [0.42, 0.6], "z": [5.0, 10.2], "ink": "utnGlass"},
               {"edge": 0, "f": [0.66, 0.94], "z": [5.0, 10.0], "ink": "utnGlassBlock"}]})
tiers += [fins(0.6, -HD + 1.2, 3.4, 11.8, along="v"), fins(13.4, -HD + 1.2, 3.4, 11.8, along="v")]

body = {"_note": "LA UNIVERSIDAD TÉCNICA NACIONAL — Sede Tobías Vargas, la ANTIGUA ADUANA del puerto: la bodega art déco de Avenida 2 a Avenida 4 (el Paseo), entre Calle 3 Francisco de Paula Amador y Calle 1. Fotos del autor (2026-11-17 y 2026-11-20), Street View (nov. 2024) y una foto aérea. LO QUE SE LEE DESDE ARRIBA, que es lo que ve el juego: un ANILLO de dos plantas con su pretil, y la bodega METIDA adentro —su claristorio y cinco naves de zinc blanco con la claraboya azul en la cumbrera—, como el techo de la Catedral metido de su pretil de piedra. Hacia el Paseo, el cuerpo alzado al este del medio: tres ventanales de dos plantas bajo el friso y el medallón, entre pilonos escalonados, y la bahía del ventanal ochavado. Las alas: zócalo azul y blanco, el alero corrido, ventanas en PAREJAS con el emblema entre cada grupo. La torre de las anclas en Calle 3 y Avenida 2 con su celosía; los murales a lo largo de Calle 3; el pilono liso de la esquina del Paseo. Medida sobre la parcela del campus (`osm_campus_112244756`, ~72 x 67 m): la receta llena el lote; la huella real es de ~84 x 87 m y la cuadra del juego no la alcanza. `u` va a lo largo de las avenidas (este), `v` hacia el Paseo (sur); aristas de una `box`: 0 norte, 1 este, 2 sur (corre de este a oeste), 3 oeste. Pilastras y claraboyas EXAGERADAS a propósito: a 60 m de cámara una aleta de 30 cm no se ve. La genera `tools/gen_utn_body.py`.",
        "tiers": tiers}

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
