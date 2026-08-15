"""EL ALUMBRADO PÚBLICO — postes a lo largo de las calles, sembrados.

De noche esta ciudad se ve apagada, y la razón es concreta: la noche es un
lavado plano de 45 % azul sobre el cuadro entero (`C.tint`) más un viñeteado.
No hay ni una fuente de luz, así que no hay nada que ese lavado no cubra.

Este servicio pone los postes. El compositor del cliente los convierte en pozos
de luz de verdad — la oscuridad pasa a ser una CAPA que las lámparas perforan,
en vez de una manta encima de todo.

**LAS LÁMPARAS VAN POR TILE, NUNCA GLOBALES.** Los `signs` son globales porque
son ~470 y la lógica de buses los indexa una vez; las lámparas son MILES. Una
lista global las cargaría todas para dibujar las doce que se ven, que es
exactamente lo que el streaming por tile existe para no hacer. Van con los
árboles y las huellas.

**Y UN REGISTRO ES DIMINUTO A PROPÓSITO**: `{x, y, ang, type}`. Qué es una
lámpara —el núcleo, el halo, el radio, el mástil, la cabeza— ya lo dice
`src/assets/lights.json`; repetirlo por poste multiplicaría el peso del mundo
por nada. El mundo pesa 16,7 MB y esto es lo que decide si la cobertura completa
es viable.
"""
import math

from ..config import ACERA_CELLS, GRID_CELL, LAMP_ROAD_CLASSES, LAMP_SPACING_M, px
from ..logging import log


def _lamp_offset(width):
    """Cuán afuera de la línea central se para el poste: media calzada más la
    acera. El mismo cálculo que sienta una parada, y por la misma razón — un
    poste dibujado donde pasa el carro es un poste en media calle."""
    return width / 2 + ACERA_CELLS * GRID_CELL * 0.5


def place_streetlights(roads, kind="warm"):
    """Un poste cada `LAMP_SPACING_M` metros de calzada, alternando de acera.

    Alternar los lados es lo que hace que una calle se lea alumbrada en vez de
    tener una fila de postes de un solo lado: en un pueblo real el vano entre
    dos postes de la misma acera es el doble del que uno ve.
    """
    spacing = px(LAMP_SPACING_M)
    lamps = []
    for road in roads:
        if road.get("cls") not in LAMP_ROAD_CLASSES:
            continue
        pts = road.get("pts") or []
        if len(pts) < 4:
            continue
        off = _lamp_offset(road.get("w") or 0)
        # `carry` lleva la distancia sobrante de un segmento al siguiente, para
        # que el espaciado sea a lo largo de la CALLE y no por segmento: sin él
        # cada vértice reinicia la cuenta y las curvas quedan con racimos.
        carry = 0.0
        side = 1.0
        for i in range(0, len(pts) - 2, 2):
            x0, y0, x1, y1 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
            dx, dy = x1 - x0, y1 - y0
            length = math.hypot(dx, dy)
            if length < 1e-6:
                continue
            ux, uy = dx / length, dy / length
            t = spacing - carry
            while t < length:
                lamps.append({
                    "x": round(x0 + ux * t - uy * off * side),
                    "y": round(y0 + uy * t + ux * off * side),
                    "ang": round(math.atan2(uy, ux), 3),
                    "type": kind,
                })
                side = -side
                t += spacing
            carry = (carry + length) % spacing
    log("luz", f"{len(lamps)} postes de alumbrado cada {LAMP_SPACING_M:.0f} m "
        f"sobre {len(LAMP_ROAD_CLASSES)} clases de vía")
    return lamps
