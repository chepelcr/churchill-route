"""LA COTA DEL TERRENO, desde las curvas de nivel del IGN.

`content/world/contours.json` trae 14 654 curvas recortadas a la caja del mundo,
cada una con su `elevacion` EN METROS. Esto las convierte en un campo `zM` que
el cliente puede muestrear.

**POR QUÉ ESTA FUENTE Y NO UN DEM.** Medido el 2026-08-19 sobre el mundo
publicado: sobre el arenal —que es el juego entero de hoy— SRTM30m y Mapzen leen
0 m en todas partes MENOS entre x 20 000 y 26 000, donde saltan a 6–8 m. Esa
banda es exactamente Carmen, el Paseo, el Centro y Playitas, y **no es suelo: son
techos**, porque SRTM y Copernicus son modelos de SUPERFICIE. El nodo de OSM ahí
dice 2,49 m. Estas curvas son restitución fotogramétrica, bare-earth, y sobre el
arenal sólo traen 2, 4, 6, 8 y 10 m — 371 curvas contra 14 283 al este de La
Angostura, que es la lectura correcta del mundo dicha por la fuente misma.
FABDEM es justo el arreglo que uno buscaría —Copernicus con bosques y edificios
removidos— y su licencia es CC BY-NC-SA: **no comercial**, contra un juego que se
publica con anuncios.

**LA RESOLUCIÓN ES PROPIA, no la del raster de superficie.** El raster de
colisión mide 4 px por celda porque cada respuesta de choque se redondea a él; la
cota no necesita eso ni de lejos y a 4 px el mundo serían 247 millones de
muestras. `ELEV_CELL` es de 80 px (32 m): un cerro de 262 m no cambia de forma
por muestrearlo cada 32, y el arenal es plano. Son 993x623 muestras para el mundo
entero.

**HACEN FALTA LOS DOS JUEGOS.** `curvas_1000` es cartografía a escala URBANA:
su intervalo de 2 m es lo que hace honesto el arenal, pero no hay una sola curva
suya a 3 km de Alto Cascabel ni de Juanilama. `curvas_5000` es el juego nacional
a 50 m y sí los cubre — el Cerro San Miguel tiene su curva de 400 m a 86 px,
contra los 414 que dice OSM. Se estampa el grueso primero y el fino encima, así
que donde hay medida buena manda ella.

**Y NO SE MEZCLA CON EL RLE DE SUPERFICIE.** Aquél son pares `(cuenta, clase)` de
un byte; la cota en decímetros llega a 2 620 y no cabe en uno. Éste es
`(cuenta:uint8, valor:uint16 LE)` — y **sólo se emite donde el tile no es todo
cero**, así que la mitad oeste del mundo, que es plana, no paga nada.
"""
import json
from collections import deque

from ..config import ROOT
from ..logging import log

#: Lado de la celda del campo de elevación, en píxeles del mundo. NO es
#: `GRID_CELL`: ver el docstring del módulo.
ELEV_CELL = 80

#: Cuántas relajaciones se corren entre curvas. La BFS deja terrazas —cada celda
#: toma la cota de la curva más cercana— y eso se ve como escalones; promediar
#: con los vecinos las convierte en la pendiente que había entre dos curvas.
#: Veinticuatro es donde deja de cambiar de forma apreciable.
RELAX_PASSES = 24

#: Más allá de esto no hay curva que responda por una celda, así que la celda es
#: nivel del mar. Sin este tope el relleno EXTRAPOLA sobre el golfo y el estero
#: la cota del cerro más cercano.
MAX_REACH_CELLS = 40


def load_contours(path=None):
    """Las curvas como `[(elevacion_m, [(lon, lat), …]), …]`."""
    path = path or f"{ROOT}/content/world/contours.json"
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    out = []
    for row in doc["contours"]:
        elev, flat = row[0], row[1]
        tag = row[2] if len(row) > 2 else "fine"
        pts = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
        if pts:
            out.append((float(elev), pts, tag))
    return out


def _stamp(cols, rows, fixed, project, contours):
    """Las curvas sobre la retícula: cada celda que una curva cruza queda FIJA.

    Se recorre cada segmento paso a paso en vez de usar Bresenham porque las
    curvas ya vienen simplificadas a ~2 m y un segmento puede medir cientos de
    píxeles: saltarse celdas dejaría la curva con agujeros por los que la
    relajación se filtra y aplana el cerro.
    """
    n = 0
    # EL FINO MANDA DONDE LO HAY. Se estampa primero el nacional (50 m) y encima
    # el urbano (2 m), de modo que una celda cubierta por los dos se queda con la
    # medida buena — y el arenal, que sólo el fino describe con honradez, no
    # hereda un 0 o un 50 del juego grueso.
    for elev, pts, _tag in sorted(contours, key=lambda c: c[2] != "coarse"):
        prev = None
        for lon, lat in pts:
            x, y = project(lat, lon)
            cur = (int(x // ELEV_CELL), int(y // ELEV_CELL))
            if prev is not None and prev != cur:
                steps = max(abs(cur[0] - prev[0]), abs(cur[1] - prev[1]))
                for s in range(1, steps + 1):
                    cx = prev[0] + (cur[0] - prev[0]) * s // steps
                    cy = prev[1] + (cur[1] - prev[1]) * s // steps
                    if 0 <= cx < cols and 0 <= cy < rows:
                        fixed[cy * cols + cx] = elev
                        n += 1
            if 0 <= cur[0] < cols and 0 <= cur[1] < rows:
                fixed[cur[1] * cols + cur[0]] = elev
                n += 1
            prev = cur
    return n


def elevation_field(project, world_w, world_h, contours=None):
    """`(cols, rows, [zM, …])` — la cota en METROS por celda de `ELEV_CELL`.

    Tres pasos, y el orden importa:

    1. las curvas se estampan y quedan FIJAS;
    2. una BFS multiorigen le da a cada celda la cota de la curva más cercana,
       lo que produce terrazas y un alcance máximo;
    3. se relaja: cada celda libre pasa a ser el promedio de sus vecinas, con
       las curvas quietas. Eso convierte las terrazas en la pendiente que de
       verdad hay entre dos curvas de nivel.
    """
    contours = contours if contours is not None else load_contours()
    cols = int(world_w // ELEV_CELL) + 1
    rows = int(world_h // ELEV_CELL) + 1
    n = cols * rows
    fixed = [None] * n
    stamped = _stamp(cols, rows, fixed, project, contours)

    z = [0.0] * n
    dist = [-1] * n
    q = deque()
    for i, v in enumerate(fixed):
        if v is not None:
            z[i] = v
            dist[i] = 0
            q.append(i)
    while q:
        i = q.popleft()
        d = dist[i]
        if d >= MAX_REACH_CELLS:
            continue
        cy, cx = divmod(i, cols)
        cy, cx = i // cols, i % cols
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if not (0 <= nx < cols and 0 <= ny < rows):
                continue
            j = ny * cols + nx
            if dist[j] >= 0:
                continue
            dist[j] = d + 1
            z[j] = z[i]
            q.append(j)

    for _ in range(RELAX_PASSES):
        nz = z[:]
        for i in range(n):
            if fixed[i] is not None or dist[i] < 0:
                continue
            cy, cx = i // cols, i % cols
            acc, cnt = 0.0, 0
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if 0 <= nx < cols and 0 <= ny < rows:
                    acc += z[ny * cols + nx]
                    cnt += 1
            if cnt:
                nz[i] = acc / cnt
        z = nz

    hi = max(z) if z else 0
    log("elev", f"campo de cota {cols}x{rows} @ {ELEV_CELL}px "
        f"({stamped} celdas de curva, {sum(1 for d in dist if d >= 0)} alcanzadas, "
        f"máx {hi:.0f} m)")
    return cols, rows, z
