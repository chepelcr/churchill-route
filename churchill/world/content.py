"""World CONTENT — the hand-authored tables the pipeline places on the map.

Districts, landmarks, customers and stages: what the game is ABOUT, as opposed
to config.py, which is how the map is drawn. Anchors are geo (`ll`) so they
survive any change to the projection, and the build FAILS listing any POI it
cannot resolve rather than quietly dropping it.

**THE TABLES ARE DATA, IN `content/world/*.json`.** This module is the LOADER
now, not the content: until 2026-08-14 the whole map — 38 landmarks, 24
customers, 8 stages, 12 districts, 16 attractions — was Python literals, which
meant the only person who could add a customer was somebody willing to edit the
builder. That is the exact thing `docs/inventory.md` §12 exists to end, and it
was the highest-risk row in the register because every one of these values ends
up in the emitted world.

What the loader still owns, and why it is not "just json.load":

  * **TUPLES.** A coordinate is a tuple in this builder (`ll`, `geo`, `bbox`,
    `at`, `landing`, `deck`) and JSON has none. The services unpack them as
    fixed-arity pairs, so restoring the type here keeps every consumer from
    having to care which file the value arrived from. `SITE_DECOR` set that
    precedent on 2026-08-13 with `rect`.
  * **the SHAPE stays identical.** `tests/test_content.py` deep-compares every
    table against the literals this module used to hold — value AND type — so
    the migration is provable without reading 470 lines of diff.

The gate is a full rebuild returning all 1001 emitted files byte-identical.
"""
import json
import os

from .config import ROOT

CONTENT_DIR = os.path.join(ROOT, "content", "world")

#: Keys whose value is a fixed-arity coordinate or size, restored to a TUPLE.
#: Not a guess and not a heuristic on "looks like two numbers": these are the
#: six the tables actually use, and a seventh would be a deliberate edit here.
#: `calles` is the odd one and worth the note: it is a PAIR OF LISTS (the
#: candidate names for each of a block's two bounding calles), so a rule of
#: "a list whose first item is a list stays a list" gets it wrong. The arity is
#: what makes something a tuple here, not what it holds.
TUPLE_KEYS = ("ll", "geo", "bbox", "at", "landing", "deck", "near", "calles")


def _tuples(node, key=None):
    """Rebuild the Python shapes from JSON.

    A list under one of TUPLE_KEYS becomes a tuple; everything else stays a
    list, because a list of RECORDS must stay a list — the build appends to
    several of them.
    """
    if isinstance(node, dict):
        return {k: _tuples(v, k) for k, v in node.items() if not k.startswith("_")}
    if isinstance(node, list):
        # The key applies at THIS level only: `calles` is a pair of lists, so
        # the pair is a tuple and the two lists inside it stay lists. Passing
        # the key down would turn those into tuples as well.
        items = [_tuples(v) for v in node]
        return tuple(items) if key in TUPLE_KEYS else items
    return node


def _load(name):
    with open(os.path.join(CONTENT_DIR, name), encoding="utf-8") as fh:
        return {k: _tuples(v, k) for k, v in json.load(fh).items()
                if not k.startswith("_")}


_geo = _load("geography.json")
_lm = _load("landmarks.json")
_cu = _load("customers.json")
_st = _load("stages.json")
_at = _load("attractions.json")
_pal = _load("palettes.json")
_pi = _load("piers.json")
_bl = _load("blocks.json")
_fe = _load("ferries.json")
_ra = _load("railway.json")

# probes for orientation / sanity (geo)
PROBE_LAND = [tuple(p) for p in _geo["probeLand"]]
PROBE_SEA = [tuple(p) for p in _geo["probeSea"]]

# district boundaries as geo anchors (7 boundaries -> 8 districts, GDD order)
DISTRICT_DEFS = _geo["districts"]
DISTRICT_BOUNDS_GEO = [tuple(p) for p in _geo["districtBoundsGeo"]]
INLAND_DISTRICT_DEFS = _geo["inlandDistricts"]

_ki = _load("kiosks.json")
_pr = _load("products.json")

#: LOS PUNTOS DE RECOGIDA, aparte de los hitos. Un kiosco no es «un hito de tipo
#: kiosk»: es el ARRANQUE de una entrega y tiene producto. Se concatenan a los
#: hitos aquí porque el resto del build los coloca igual que a cualquier POI —
#: lo que cambia es dónde se AUTORAN y qué llevan encima.
KIOSK_DEFS = [{**k, "type": "kiosk"} for k in _ki["kiosks"]]

#: QUÉ SE ENTREGA Y CÓMO SE ECHA A PERDER. Un churchill se derrite, un vigorón se
#: aguada, un ceviche aguanta la distancia pero no el sol.
PRODUCT_DEFS = _pr["products"]

LANDMARK_DEFS = _lm["landmarks"] + KIOSK_DEFS
#: The OSM theme-park way that decides which footprints belong to the aquarium.
MARINE_SITE_OSM_ID = _lm["marineSiteOsmId"]
#: Externally verified facility labels; the local OSM ways do not carry them, so
#: NEVER infer a new footprint/name assignment from list order.
MARINE_BUILDING_NAMES = {int(k): v for k, v in _lm["marineBuildingNames"].items()}

CUSTOMER_DEFS = _cu["customers"]

STAGES = _st["stages"]
CROSSING_STAGES = _st["crossingStages"]
LANCHA_DEFS = _st["lanchas"]

#: The east end of the sea front — where Paseo León Cortés runs out.
MALECON_EAST_LL = tuple(_geo["maleconEastLl"])

FERIA_DEF = _at["feria"]
ATTRACTION_DEFS = _at["attractions"]
BEACH_ACCESS_DEFS = _at["beachAccesses"]

BLDG_PALETTE = _pal["building"]
ROOF_PALETTE = _pal["roof"]

#: LOS MUELLES — el tamaño y la receta de cada cubierta. NOT their ends: a pier
#: grows from the RESOLVED shoreline or from a boat's stern at rest, and that
#: derivation is what survives a rescale. See the file's own `_whyNotGeo`.
PIER_DECKS = _pi["decks"]
APRON_DEFS = _pi["aprons"]

#: LOS FERRIS DEL GOLFO — joins to the real OSM terminal/route plus the public
#: destination, vessel lettering and double-ended behaviour. Geometry remains
#: resolved from OSM; presentation and route semantics no longer live in Python.
FERRY_DEFS = _fe["ferries"]

#: EL DERECHO DE VÍA DEL FERROCARRIL. Sólo nombres de calles y medidas reales:
#: la geometría decide dónde termina una avenida, dónde empieza su continuación
#: y dónde dos calzadas forman una vía dividida. Ver service/railway.py.
RAILWAY_DEF = _ra["railway"]

#: LAS CUADRAS HECHAS A MANO — el superbloque cívico, la manzana del Carmen,
#: los dos estadios/plazas, la cuadra del Parque Marino y el Balneario. Cada una
#: NOMBRA su estrategia (`layout`) y el motor la implementa; el JSON escoge y
#: parametriza. Eran literales de Python dentro de `pipeline/build_stage.py`.
BLOCKS = _bl["blocks"]

#: El estilo de suelo de una manzana DERIVADA, direccionado por punto geo, y el
#: de una parcela, por id. Ver `_manzanas` en el archivo para el porqué del geo.
MANZANA_STYLES = _bl["manzanas"]

#: DÓNDE HAY CASONAS, y de qué colores. La fachada continua es el puerto viejo:
#: del faro a El Cocal y se acaba en La Angostura.
CASONA_DEF = _bl.get("casonas", {})

#: LAS FUENTES DE PATIO — por punto geo, y sólo donde se autoran. Cada manzana
#: tiene patio; una fuente es lo que hace que UNA manzana sea el centro.
FOUNTAIN_DEFS = _bl.get("fountains", [])
PARCEL_STYLES = _bl["parcels"]


def blocks_by_layout(layout):
    """Los bloques de una estrategia, EN EL ORDEN DEL ARCHIVO.

    El orden importa y por eso se conserva: dos cuadras hechas a mano pueden
    tocar el mismo suelo, y la primera en colocarse es la que se lo queda."""
    return [b for b in BLOCKS if b.get("layout") == layout]


#: Los hitos cuya manzana ENTERA les pertenece, por estrategia. El build
#: preguntaba `lm["type"] == "pool"` y `lm["id"] == "parquemar"`; ahora lo
#: pregunta al registro, que es lo que permite un segundo balneario.
WATER_INLET_LMS = {b["lm"] for b in blocks_by_layout("water-inlet")}
FOOTPRINT_LOT_BLOCKS = {b["lm"]: b for b in blocks_by_layout("footprint-lots")}


def _load_site_decor():
    """CÓMO SE PERSONALIZA UNA CUADRA — read from `content/world/site-decor.json`.

    One record per OSM site whose ground the generic fit gets wrong: Mora y
    Cañas and the Parque del Muellero keep their own angled contour (`trace`),
    the Mercado owns its whole manzana (`cuadra`), two schools occupy one corner
    of the block OSM maps them across (`rect`), Parque Victoria carries a
    bandstand (`kiosco`).

    It was a dict in this file until 2026-08-13, which meant a personalised
    cuadra could only be added by somebody editing the builder. It is data now,
    so the world editor can author one — which is the whole point of the row.

    `rect` comes back as a TUPLE: `FieldService` unpacks it as four fractions
    and JSON has no tuple, so the conversion happens here rather than leaving
    the service to care what file the value came from.
    """
    with open(os.path.join(ROOT, "content", "world", "site-decor.json"),
              encoding="utf-8") as fh:
        doc = json.load(fh)
    out = {}
    for pid, rec in doc["sites"].items():
        decor = {k: v for k, v in rec.items() if k != "note"}
        if "rect" in decor:
            decor["rect"] = tuple(decor["rect"])
        out[pid] = decor
    return out


SITE_DECOR = _load_site_decor()
