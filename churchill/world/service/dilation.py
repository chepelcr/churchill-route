"""LA MANZANA RECUPERA SU SUELO — un campo de desplazamiento local.

**El problema.** `ARCADE_STREET_MUL` estampa cada calle a 2.32x su ancho real
porque los vehículos están dibujados ~2.4x sobre el suyo (un tuktuk mide 26x17
px = 10.4 x 6.8 m, y dos no se cruzan por debajo de ~34 px). Lo que la calle se
lleva de más sale de las manzanas: **4.7 m por lado** en una calle residencial,
**10.6 m** en el Paseo. Medido sobre el mundo publicado, eso cuesta 347 edificios
empujados fuera de donde el mapeador los puso, 120 reasentados, 82 descartados
por el snapper y 62 `ghost` que se dibujan pisando la calzada.

**Lo que esto hace.** En vez de quitarle el suelo a la manzana, SEPARA las
manzanas lo que la calle necesita. La cuadra conserva su forma y su tamaño
verdaderos, la calle conserva su ancho arcade, y el pueblo se estira ~10-15 %.

**Por qué no es un mapa 1-D.** Un warp separable sobre-inserta: el mundo abarca
60 km y varios pueblos, así que una calle de Puntarenas y otra de Barranca en la
misma `x` insertarían las dos en el mismo sitio y a Puntarenas le tocaría el
doble de hueco. El campo tiene que ser **2-D**.

**Por qué es LOCAL y por clúster.** A 20 px de celda el mundo entero son 10
millones de celdas y esto es Python: una relajación global no termina nunca.
Pero el desplazamiento sólo hace falta donde hay calles, y los pueblos están
separados por campo. Así que se agrupan las calles en clústers, se resuelve una
rejilla chica por clúster y el campo **decae a cero** en su borde — con lo cual
el mundo NO crece y los clústers no se pisan entre sí.

**La condición, y por qué es sobre pares MANZANA-CALLE.** A 20 px de celda una
calle residencial de ancho real (17.5 px) ocupa UNA celda, así que no hay pares
«calle-calle» que separar. Lo que sí hay siempre son los pares que cruzan el
borde de la banda: se le pide a cada adyacencia manzana-calle que separe
`δ/2`, y la suma a través de una banda de cualquier grosor da exactamente `δ`.
Es la formulación que no depende de la resolución.

Se resuelve por relajación Gauss-Seidel, el mismo patrón que `elevation.py` ya
usa, sin dependencias nuevas.
"""
import math
from collections import deque

from ..config import (
    CUAD, GRID_CELL, PLANAR_PX_PER_M, ROAD_WIDTH_M, road_width_px,
)
from ..logging import log, warn

#: Lado de la celda del campo, en px del mundo. Una cuadrícula: más fino no lo
#: aguanta Python sobre un mundo de 60 km, y más grueso reparte el salto de la
#: calle sobre una franja tan ancha que deforma el borde de la manzana.
DCELL = CUAD

#: Cuántas relajaciones. El campo es suave y arranca en cero, así que lo que
#: manda es cuántas celdas tiene que viajar la información desde una calle
#: hasta el interior de su manzana — unas pocas decenas.
PASSES = 400

#: Cuántas veces se suaviza lo que NO es manzana — la calzada y el campo
#: abierto. Tiene que dar para que el cero del borde del parche llegue hasta el
#: pueblo, y son `CLUSTER_PAD_CELLS` celdas de camino.
SMOOTH_PASSES = 320

#: El tirón hacia cero que hace que el campo se APAGUE fuera del pueblo. Sin él
#: el desplazamiento se acumularía a lo largo de los 60 km del mundo y Caldera
#: acabaría a un kilómetro de donde está. Chico: la separación se paga de todos
#: modos dentro del pueblo, y esto sólo la devuelve a cero en el campo abierto.
LAMBDA = 0.0016

#: Con cuánta separación entre calles se corta un clúster, en px. Dos pueblos a
#: más de esto son dos problemas independientes.
CLUSTER_GAP_PX = 1400

#: Margen alrededor de un clúster, en celdas — el sitio donde el campo baja a
#: cero. Tiene que dar para que el decaimiento (~1/sqrt(LAMBDA) celdas) quepa.
CLUSTER_PAD_CELLS = 60


def steal_px(cls):
    """Lo que esta clase de calle le quita a las manzanas, en px de ANCHO TOTAL."""
    real = ROAD_WIDTH_M.get(cls, 7) * PLANAR_PX_PER_M
    return max(0.0, road_width_px(cls) - real)


class Dilation:
    """El campo, y cómo se le aplica a un punto.

    Son varias rejillas locales (una por clúster) que no se solapan; fuera de
    todas, el desplazamiento es cero, que es exactamente lo que se quiere en el
    golfo y en el campo abierto.
    """

    def __init__(self, patches):
        self.patches = patches            # [(c0, r0, cols, rows, ux, uy), …]
        # UN CORTOCIRCUITO, porque esto lo llama CADA punto del mundo. La
        # inmensa mayoría —el golfo, el estero, el campo— cae fuera de todo
        # parche, y sin esta caja habría que descartarla parche por parche.
        if patches:
            self._x0 = min(c0 for (c0, _r, _c, _R, _u, _v) in patches) * DCELL
            self._y0 = min(r0 for (_c0, r0, _c, _R, _u, _v) in patches) * DCELL
            self._x1 = max((c0 + cols) for (c0, _r, cols, _R, _u, _v) in patches) * DCELL
            self._y1 = max((r0 + rows) for (_c0, r0, _c, rows, _u, _v) in patches) * DCELL
        else:
            self._x0 = self._y0 = self._x1 = self._y1 = 0.0

    def at(self, x, y):
        """(dx, dy) en px — interpolado bilinealmente."""
        if x < self._x0 or x > self._x1 or y < self._y0 or y > self._y1:
            return 0.0, 0.0
        for (c0, r0, cols, rows, ux, uy) in self.patches:
            fc = x / DCELL - c0
            fr = y / DCELL - r0
            if fc < 0 or fr < 0 or fc > cols - 1 or fr > rows - 1:
                continue
            ic, ir = int(fc), int(fr)
            tc, tr = fc - ic, fr - ir
            ic2 = min(ic + 1, cols - 1)
            ir2 = min(ir + 1, rows - 1)
            i00 = ir * cols + ic
            i10 = ir * cols + ic2
            i01 = ir2 * cols + ic
            i11 = ir2 * cols + ic2
            w00 = (1 - tc) * (1 - tr)
            w10 = tc * (1 - tr)
            w01 = (1 - tc) * tr
            w11 = tc * tr
            dx = ux[i00] * w00 + ux[i10] * w10 + ux[i01] * w01 + ux[i11] * w11
            dy = uy[i00] * w00 + uy[i10] * w10 + uy[i01] * w01 + uy[i11] * w11
            return dx, dy
        return 0.0, 0.0

    def point(self, x, y):
        dx, dy = self.at(x, y)
        return x + dx, y + dy

    def flat(self, pts):
        """Una lista plana [x, y, x, y, …] desplazada."""
        out = []
        for i in range(0, len(pts) - 1, 2):
            x, y = self.point(pts[i], pts[i + 1])
            out.append(x); out.append(y)
        return out

    def pairs(self, pts):
        """Una lista de tuplas [(x, y), …] desplazada."""
        return [self.point(px, py) for (px, py) in pts]


#: A qué paso se le manda el campo al cliente. El campo es SUAVE —dentro de una
#: manzana es constante y el salto ocurre en la calle— así que muestrearlo cada
#: 8 celdas cuesta 64 veces menos y el error queda muy por debajo de lo que
#: importa para plantar un rótulo por lat/lon.
EXPORT_STEP = 8


def export_patches(field):
    """El campo, en la forma en que viaja en el manifest.

    `meta.geo` describe una proyección AFÍN, y con dilatación la proyección deja
    de serlo: `x = ax·lon + bx` se queda corto por hasta unos cientos de px
    dentro de un pueblo. El cliente coloca contenido remoto por lat/lon con esa
    afín, así que necesita además esta corrección o el patrocinio aterriza en la
    manzana de al lado.
    """
    import base64
    import struct
    out = []
    for (c0, r0, cols, rows, ux, uy) in field.patches:
        nc = (cols + EXPORT_STEP - 1) // EXPORT_STEP
        nr = (rows + EXPORT_STEP - 1) // EXPORT_STEP
        buf = bytearray()
        for r in range(nr):
            for c in range(nc):
                i = min(r * EXPORT_STEP, rows - 1) * cols + min(c * EXPORT_STEP, cols - 1)
                buf += struct.pack("<hh", int(round(ux[i])), int(round(uy[i])))
        out.append({
            "x": c0 * DCELL, "y": r0 * DCELL,
            "cols": nc, "rows": nr, "step": DCELL * EXPORT_STEP,
            "d": base64.b64encode(bytes(buf)).decode("ascii"),
        })
    return out


def _road_cells(roads):
    """{(c, r): (delta, nx, ny)} — la calle al ancho REAL sobre la rejilla.

    Se rasteriza al ancho real y no al arcade a propósito: lo que se está
    describiendo es DÓNDE está la calle de verdad, y el ancho arcade es
    justamente lo que hay que hacerle sitio.
    """
    cells = {}
    for road in roads:
        cls = road.get("cls")
        delta = steal_px(cls)
        if delta <= 0:
            continue
        pts = road["pts"]
        half = max(GRID_CELL, ROAD_WIDTH_M.get(cls, 7) * PLANAR_PX_PER_M) / 2
        for i in range(0, len(pts) - 3, 2):
            ax, ay, bx, by = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
            seg = math.hypot(bx - ax, by - ay)
            if seg <= 0:
                continue
            ux, uy = (bx - ax) / seg, (by - ay) / seg
            nx, ny = -uy, ux                       # la normal de la calle
            steps = int(seg / (DCELL * 0.5)) + 1
            for s in range(steps + 1):
                t = s / steps
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                # …y a lo ancho, para que una avenida ocupe las celdas que ocupa
                w = int(half / DCELL) + 1
                for k in range(-w, w + 1):
                    qx, qy = px + nx * k * DCELL, py + ny * k * DCELL
                    if abs(k * DCELL) > half:
                        continue
                    key = (int(qx // DCELL), int(qy // DCELL))
                    prev = cells.get(key)
                    if prev is None or prev[0] < delta:
                        cells[key] = (delta, nx, ny)
    return cells


def _clusters(cells):
    """Agrupa las celdas de calle en pueblos. Devuelve [set[(c, r)], …]."""
    gap = max(1, int(CLUSTER_GAP_PX // DCELL))
    seen, out = set(), []
    keys = list(cells)
    # Índice grueso para no comparar todas contra todas.
    buckets = {}
    for (c, r) in keys:
        buckets.setdefault((c // gap, r // gap), []).append((c, r))
    for key in keys:
        if key in seen:
            continue
        comp, q = set(), deque([key])
        seen.add(key)
        while q:
            (c, r) = q.popleft()
            comp.add((c, r))
            bc, br = c // gap, r // gap
            for dbc in (-1, 0, 1):
                for dbr in (-1, 0, 1):
                    for cand in buckets.get((bc + dbc, br + dbr), ()):
                        if cand in seen:
                            continue
                        if abs(cand[0] - c) <= gap and abs(cand[1] - r) <= gap:
                            seen.add(cand)
                            q.append(cand)
        out.append(comp)
    return out


def _solve(cells, comp, water=frozenset()):
    """Resuelve una rejilla local. Devuelve (c0, r0, cols, rows, ux, uy).

    NO es un suavizado: una manzana tiene que quedar RÍGIDA y el salto ocurre
    EN la calle. Un relajador laplaciano no sabe hacer un escalón — se lo come y
    reparte el desplazamiento, que fue el primer intento: pedía 23.5 px de
    separación, entregaba 5.9, y de paso estiraba la manzana 3.5 px cada 150.

    Así que las incógnitas no son las celdas: son las MANZANAS. Cada componente
    de suelo que no es calle recibe UNA traslación, y cada par de manzanas que
    se miran a través de una calle pide `(u_b − u_a)·n̂ = δ`. Son unos cientos de
    incógnitas en vez de cientos de miles, la separación sale exacta y la cuadra
    no se deforma porque se mueve entera.
    """
    cs = [c for c, _ in comp]; rs = [r for _, r in comp]
    c0, r0 = min(cs) - CLUSTER_PAD_CELLS, min(rs) - CLUSTER_PAD_CELLS
    cols = max(cs) - min(cs) + 1 + CLUSTER_PAD_CELLS * 2
    rows = max(rs) - min(rs) + 1 + CLUSTER_PAD_CELLS * 2
    n = cols * rows
    street = [None] * n
    for (c, r) in comp:
        street[(r - r0) * cols + (c - c0)] = cells[(c, r)]

    # --- las manzanas: componentes de lo que NO es calle
    label = [-1] * n
    sizes, border = [], []
    NB = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for start in range(n):
        if street[start] is not None or label[start] >= 0:
            continue
        lid = len(sizes)
        q = deque([start]); label[start] = lid
        cnt, touches_edge = 0, False
        while q:
            i = q.popleft(); cnt += 1
            ci, ri = i % cols, i // cols
            if ci == 0 or ri == 0 or ci == cols - 1 or ri == rows - 1:
                touches_edge = True
            for (dc, dr) in NB:
                nc, nr = ci + dc, ri + dr
                if not (0 <= nc < cols and 0 <= nr < rows):
                    continue
                j = nr * cols + nc
                if street[j] is None and label[j] < 0:
                    label[j] = lid
                    q.append(j)
        sizes.append(cnt); border.append(touches_edge)
    if not sizes:
        return (c0, r0, cols, rows, [0.0] * n, [0.0] * n)

    # EL CAMPO ABIERTO NO ES UN CUERPO RÍGIDO, y tratarlo como uno fue el error
    # que hizo oscilar la primera versión. La componente grande que rodea al
    # pueblo tocaría a CADA manzana del borde pidiéndole δ en una dirección
    # distinta — al norte de una y al sur de otra a la vez—, que es un sistema
    # inconsistente: la relajación se quedaba dando tumbos y salía un campo
    # uniforme, o sea ninguna separación. El campo abierto está VACÍO: se deja
    # fuera del sistema y después se rellena suavizando, que es lo que de verdad
    # es — suelo que puede estirarse sin que nadie lo note.
    out = max((k for k in range(len(sizes)) if border[k]),
              key=lambda k: sizes[k], default=None)

    # --- las condiciones: dos manzanas que se miran a través de una calle
    cons = []
    seen = set()
    for i in range(n):
        spec = street[i]
        if spec is None:
            continue
        delta, nx, ny = spec
        ci, ri = i % cols, i // cols
        side = []
        for sgn in (-1, 1):
            lab = None
            for step in range(1, 7):
                qc = ci + int(round(nx * sgn * step))
                qr = ri + int(round(ny * sgn * step))
                if not (0 <= qc < cols and 0 <= qr < rows):
                    break
                j = qr * cols + qc
                if street[j] is None:
                    lab = label[j]
                    break
            side.append(lab)
        a, b = side                      # a = lado -n̂, b = lado +n̂
        if a is None or b is None or a == b or a == out or b == out:
            continue
        key = (a, b, round(nx, 2), round(ny, 2))
        if key in seen:
            continue
        seen.add(key)
        cons.append((a, b, nx, ny, delta))
    if not cons:
        return (c0, r0, cols, rows, [0.0] * n, [0.0] * n)

    # --- Gauss-Seidel sobre las traslaciones
    ublk = [[0.0, 0.0] for _ in sizes]
    for _ in range(PASSES):
        for (a, b, nx, ny, delta) in cons:
            res = ((ublk[b][0] - ublk[a][0]) * nx
                   + (ublk[b][1] - ublk[a][1]) * ny) - delta
            ublk[a][0] += 0.5 * res * nx
            ublk[a][1] += 0.5 * res * ny
            ublk[b][0] -= 0.5 * res * nx
            ublk[b][1] -= 0.5 * res * ny

    # EL PUEBLO SE ABRE SOBRE SÍ MISMO. Sin fijar el gauge la solución flota —
    # trasladar el pueblo entero satisface las mismas condiciones— y ese paseo
    # libre sí movería el mundo. Restar la media dispersa el crecimiento hacia
    # los dos lados en vez de empujarlo todo hacia uno.
    moved = [k for k in range(len(sizes)) if k != out]
    if moved:
        mx = sum(ublk[k][0] for k in moved) / len(moved)
        my = sum(ublk[k][1] for k in moved) / len(moved)
        for k in moved:
            ublk[k][0] -= mx
            ublk[k][1] -= my
    if out is not None:
        ublk[out][0] = ublk[out][1] = 0.0

    # --- al campo: la manzana lleva su traslación; calle y afuera se interpolan
    ux = [0.0] * n
    uy = [0.0] * n
    fixed = bytearray(n)
    for i in range(n):
        lab = label[i]
        if lab >= 0 and lab != out:
            ux[i] = ublk[lab][0]
            uy[i] = ublk[lab][1]
            fixed[i] = 1                 # una manzana se mueve ENTERA
        ci, ri = i % cols, i // cols
        if ci == 0 or ri == 0 or ci == cols - 1 or ri == rows - 1:
            fixed[i] = 1                 # …y en el borde del parche no hay campo
        elif ((ci + c0, ri + r0) in water
              and not (lab >= 0 and lab != out)):   # no pisar una manzana
            ux[i] = uy[i] = 0.0
            fixed[i] = 1                 # EL AGUA Y SU ORILLA NO SE MUEVEN
    # …y lo que queda —la calzada y el campo abierto— se suaviza entre esas dos
    # condiciones. Así el salto ocurre EN la calle (que es donde tiene que
    # ocurrir), el campo baja a cero antes del borde del parche, y nada se rasga.
    for _ in range(SMOOTH_PASSES):
        for i in range(n):
            if fixed[i]:
                continue
            ci, ri = i % cols, i // cols
            ax = ay = 0.0; deg = 0
            for (dc, dr) in NB:
                nc, nr = ci + dc, ri + dr
                if not (0 <= nc < cols and 0 <= nr < rows):
                    continue
                j = nr * cols + nc
                ax += ux[j]; ay += uy[j]; deg += 1
            if deg:
                ux[i] = ax / deg
                uy[i] = ay / deg
    return (c0, r0, cols, rows, ux, uy)


def _water_cells(waters):
    """{(c, r)} — las celdas que son AGUA, para clavarlas.

    EL ESTERO NO SE MUEVE. La primera versión de esto no sabía dónde estaba el
    agua —el campo se calcula antes de que exista el raster— así que al separar
    las manzanas el pueblo se metía en el corredor navegable: el canal dragado
    de la Travesía se cerró a 12 px de media caña contra un casco de 34, y el
    propio build lo avisó («21 muestras bajo 64px»). Una etapa entera dejaba de
    poderse jugar para ganar suelo de manzana, que no es un cambio: es un
    intercambio malo.

    Clavarlas a cero cuesta una segunda pasada de `extract_areas` sobre las
    mismas vías —barata, porque lo caro fue el parseo— y deja el golfo, el
    estero y los ríos exactamente donde el mapeador los puso.
    """
    #: CUÁNTO SE ENSANCHA EL CLAVO ALREDEDOR DEL AGUA, en celdas. Clavar sólo
    #: el agua no basta y está medido: el canal de la Travesía siguió cerrándose
    #: igual (12 px de media caña) porque lo que se le mete dentro no es agua que
    #: se mueva, son las ORILLAS — manglar y tierra, que no están clavadas. El
    #: dragado convierte tierra en agua, pero se para en cuanto encuentra algo
    #: que no es ni tierra ni agua, así que una calle que entra al corredor lo
    #: tapona. Ocho celdas son 160 px, del orden de la media caña que el canal
    #: necesita.
    BANK_CELLS = 8

    out = set()
    for flat in waters or ():
        pts = [(flat[i], flat[i + 1]) for i in range(0, len(flat) - 1, 2)]
        if len(pts) < 3:
            continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        c0, c1 = int(min(xs) // DCELL), int(max(xs) // DCELL)
        r0, r1 = int(min(ys) // DCELL), int(max(ys) // DCELL)
        if (c1 - c0) * (r1 - r0) > 4_000_000:      # un polígono absurdo, no un agua
            continue
        for r in range(r0, r1 + 1):
            y = r * DCELL + DCELL / 2
            xs_hit = []
            for i in range(len(pts)):
                ax, ay = pts[i]; bx, by = pts[(i + 1) % len(pts)]
                if (ay > y) != (by > y):
                    xs_hit.append(ax + (y - ay) * (bx - ax) / ((by - ay) or 1e-9))
            xs_hit.sort()
            for k in range(0, len(xs_hit) - 1, 2):
                for c in range(int(xs_hit[k] // DCELL), int(xs_hit[k + 1] // DCELL) + 1):
                    out.add((c, r))
    # …y la ORILLA con ella. Es la banda por la que el canal tiene que pasar.
    if out:
        banks = set(out)
        ring = out
        for _ in range(BANK_CELLS):
            nxt = set()
            for (c, r) in ring:
                for (nc, nr) in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
                    if (nc, nr) not in banks:
                        banks.add((nc, nr)); nxt.add((nc, nr))
            ring = nxt
            if not ring:
                break
        out = banks
    return out


def build(roads, waters=None):
    """El campo de dilatación para esta red de calles."""
    cells = _road_cells(roads)
    if not cells:
        warn("dilate", "no hay calles con ancho exagerado — campo vacío")
        return Dilation([])
    water = _water_cells(waters)
    comps = _clusters(cells)
    comps.sort(key=len, reverse=True)
    patches, total = [], 0
    for comp in comps:
        if len(comp) < 12:            # un camino suelto en el campo, no un pueblo
            continue
        patch = _solve(cells, comp, water)
        patches.append(patch)
        total += patch[2] * patch[3]
    field = Dilation(patches)
    # Cuánto se movió de verdad, que es lo que hay que poder leer en el log.
    mx = 0.0
    for (c0, r0, cols, rows, ux, uy) in patches:
        for i in range(cols * rows):
            d = math.hypot(ux[i], uy[i])
            if d > mx:
                mx = d
    log("dilate", f"{len(cells)} celdas de calle en {len(comps)} clústers -> "
        f"{len(patches)} rejillas ({total/1000:.0f}k celdas), "
        f"{len(water)} celdas de agua clavadas, "
        f"desplazamiento máximo {mx:.0f}px")
    return field
