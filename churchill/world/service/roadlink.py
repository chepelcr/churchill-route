"""LOS EMPALMES AUTORADOS — dos puntas de calle que el mapeador dejó sin unir.

## Por qué existe

Medido sobre el mundo emitido, decodificando los tiles: **la red manejable tiene
69 componentes**. La península es una sola pieza de 4 228 466 celdas; **Pitahaya
y toda la tierra firme de esa orilla son otra de 162 945**, y en 600 px a la
redonda se acercan en UN SOLO PUNTO — un corte de 95,5 px al final de la Calle
del Arreo, entre dos vías `unclassified` sin nombre que mueren en (58000, 8351)
y (57951, 8433). Entre las dos hay ~45 px de tierra maciza y la acera de cada
una. Media isla que se ve y no se llega.

No es un fallo del builder: las dos vías existen en OSM y sencillamente no
comparten nodo. Es una laguna del mapeo aguas arriba, y arreglarla en OSM no
está en nuestras manos.

## Por qué NO una regla general

La tentación es soldar automáticamente todo par de extremos libres a menos de
N px. Está medido y no sirve: el mundo tiene **1 568 extremos libres** y **128
pares a menos de 100 px**. Soldarlos inventaría calles que no existen, por todo
el mapa, y sólo se vería conduciendo.

La señal que SÍ sería segura es el nombre compartido —una calle mapeada en dos
pedazos es una laguna; dos calles distintas que terminan cerca son dos calles
sin salida—, pero **sólo 9 de esos 128 pares comparten nombre, y el de la Calle
del Arreo no es uno de ellos**: sus dos puntas son anónimas. Así que una regla
general o se pierde justo la que importa, o suelda las 128.

Por eso se AUTORA, uno por uno, y por eso la lista es corta a propósito. Si
algún día crece más allá de una docena, ésa es la señal de que hay que volver a
mirar la regla — no antes.

## Cómo se autora

En `content/world/geography.json`, y **en geo**, que es la regla de la casa: el
`_note` de ese mismo archivo dice «Every anchor is GEO (lat, lon) so it survives
any change to the projection». Este mundo lleva cuatro reescalados y un campo de
deformación puesto y quitado; un ancla en píxeles habría muerto en cada uno.

Cada entrada da sus dos puntas y un alcance en metros. El empalme resuelve la
punta de vía REAL más cercana a cada ancla dentro de ese alcance y emite una
polilínea entre las dos, heredando clase y ancho de la vía que continúa. De ahí
en adelante es una calle como cualquier otra: se estampa, recibe acera, recibe
lámparas y entra en la red manejable.

**Un empalme que no resuelve FALLA el build.** Es la misma regla que ya cobró el
centro cívico entero: un elemento hecho a mano que resuelve a nada no puede
desaparecer en silencio con un WARN que nadie lee.
"""
import math

from ..config import PLANAR_CLIPPED, px
from ..logging import die, log, warn


def _ends(roads):
    """Cada punta de cada vía, con su índice — `(x, y, road, which)`.

    Se miran LAS DOS PUNTAS de cada polilínea y no los vértices interiores: un
    empalme une el final de una calle con el principio de otra, y engancharse a
    un vértice del medio produciría una T donde el mapeador no puso ninguna.
    """
    out = []
    for road in roads:
        pts = road.get("pts") or []
        if len(pts) < 4:
            continue
        out.append((pts[0], pts[1], road, "head"))
        out.append((pts[-2], pts[-1], road, "tail"))
    return out


def _nearest_end(ends, x, y, reach_px):
    """La punta de vía más cercana a (x, y) dentro del alcance, o None."""
    best, best_d = None, reach_px
    for (ex, ey, road, which) in ends:
        d = math.hypot(ex - x, ey - y)
        if d <= best_d:
            best, best_d = (ex, ey, road, which), d
    return best, best_d


def link_roads(roads, project, links):
    """Emitir una vía sintética por cada empalme autorado. Muta `roads`.

    `project` es `(lat, lon) -> (x, y)` en píxeles de mundo.
    """
    if not links:
        return []
    ends = _ends(roads)
    made = []
    for spec in links:
        lid = spec.get("id") or "?"
        # EL ALCANCE SE CONVIERTE AQUÍ, no en la carga, y es a propósito:
        # `reachM` ya lo autoran `piers.json` y `railway.json` y lo convierten a
        # mano otros tres servicios, así que meterlo en `METRE_KEYS` le quitaría
        # la llave de debajo a los tres. Ver la nota en `content.py`.
        reach_m = spec.get("reachM")
        if not reach_m:
            die("roadlink", f"empalme {lid}: sin `reachM`")
        reach = px(reach_m)
        ax, ay = project(*spec["from"])
        bx, by = project(*spec["to"])
        a, da = _nearest_end(ends, ax, ay, reach)
        b, db = _nearest_end(ends, bx, by, reach)
        # UN EMPALME QUE NO RESUELVE FALLA EL BUILD. Un ancla que ya no encuentra
        # su calle es lo mismo que el centro cívico que dejó de existir con dos
        # WARN por toda explicación.
        if a is None or b is None:
            # …SALVO EN UNA CORRIDA RECORTADA, donde no encontrarla es lo
            # ESPERADO: `PLANAR_BBOX` tira todo lo que queda fuera de la ventana
            # y este empalme vive en el noreste. Sin esta salida el smoke moría
            # en `extract_world` —la primera etapa de nueve— y dejaba de poder
            # probar nada de lo que viene después, que es justo para lo que
            # existe. En la corrida completa sigue siendo un fallo duro, por la
            # misma razón que el centro cívico: un elemento hecho a mano que
            # resuelve a nada no puede desaparecer en silencio.
            if PLANAR_CLIPPED:
                warn("roadlink", f"empalme {lid}: fuera de la ventana recortada, "
                                 f"se omite (en la corrida completa esto FALLA)")
                continue
            die("roadlink", f"empalme {lid}: no hay punta de calle a "
                            f"{reach:.0f} px de "
                            f"{'la primera ancla' if a is None else 'la segunda'}")
        if a[2] is b[2]:
            die("roadlink", f"empalme {lid}: las dos anclas resolvieron a la "
                            f"MISMA vía — sería un lazo, no un empalme")
        # La clase y el ancho salen de la vía que continúa, no de la autoría: un
        # empalme es el pedazo que faltaba de una calle que ya existe, y darle un
        # ancho propio lo dibujaría como otra cosa.
        src = a[2]
        gap = math.hypot(b[0] - a[0], b[1] - a[1])
        link = {"cls": src.get("cls", "unclassified"),
                "w": src.get("w"),
                "pts": [round(a[0]), round(a[1]), round(b[0]), round(b[1])],
                "link": lid}
        for key in ("barro", "gravel", "elev"):
            if src.get(key):
                link[key] = src[key]
        if spec.get("name"):
            link["name"] = spec["name"]
        roads.append(link)
        made.append({"id": lid, "gap": gap,
                     "a": (a[0], a[1]), "b": (b[0], b[1]),
                     "cls": link["cls"], "w": link["w"]})
        log("roadlink", f"{lid:<10} {gap:6.1f} px  "
                        f"({a[0]:.0f},{a[1]:.0f}) -> ({b[0]:.0f},{b[1]:.0f})  "
                        f"cls={link['cls']} w={link['w']}  "
                        f"anclas a {da:.0f}/{db:.0f} px de su punta")
    return made
