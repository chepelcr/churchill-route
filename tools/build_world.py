#!/usr/bin/env python3
# build_world.py — La Ruta del Churchill world builder.
#
# Parses docs/map.osm (real OpenStreetMap export of Puntarenas, Costa Rica)
# and emits world-data.js: a faithful 2D game map of the peninsula from
# El Faro to Caldera on a fixed 8800x1400 world-space canvas.
#
# Projection: "corridor unroll". The real route is L-shaped (~8 km E-W sand
# spit + ~7.5 km SSE coast to Caldera), so we define a smoothed spine along
# the route and map every feature to (x = arclength along spine,
# y = 700 + signed perpendicular offset * CROSS_EXAG).
#
# Stdlib only (no PIL/shapely). Usage:  python3 tools/build_world.py [--debug]

import xml.etree.ElementTree as ET
import base64
import json
import math
import os
import struct
import sys
import time
import zlib
from collections import defaultdict, deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM_PATH = os.path.join(ROOT, "docs", "map.osm")
OUT_PATH = os.path.join(ROOT, "world-data.js")
DEBUG_PNG = os.path.join(ROOT, "tools", "debug_map.png")
DEBUG_SVG = os.path.join(ROOT, "tools", "debug_features.svg")

# ---------------------------------------------------------------- config ---

CANVAS_W, CANVAS_H, CENTER_Y = 8800, 1400, 700
MARGIN_X = 120                  # water margin west of the Faro tip
SPINE_TARGET_PX = 8560          # spine arclength maps onto this many px
CROSS_EXAG = 1.55               # perpendicular exaggeration for gameplay room
CORRIDOR_HALF_M = 900           # keep features within this distance of spine
GRID_CELL = 4
GRID_COLS, GRID_ROWS = CANVAS_W // GRID_CELL, CANVAS_H // GRID_CELL

# local equirectangular projection anchor (Faro de La Punta)
LAT0, LON0 = 9.9770, -84.8512
M_PER_DEG_LAT = 110540.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

# Spine waypoints west->east->south: Faro tip, along the spit (Av. Central /
# Ruta 17 axis), La Angostura, coast SSE along Ruta 23, Puente colgante,
# Mata de Limon village, Puerto Caldera. snap=True waypoints get pulled onto
# the nearest big-road node so the spine follows real asphalt.
SPINE_WAYPOINTS = [
    {"ll": (9.97667, -84.85116), "snap": False},  # Faro de La Punta
    {"ll": (9.97600, -84.84300), "snap": True},
    {"ll": (9.97650, -84.83300), "snap": True},   # centro
    {"ll": (9.97750, -84.82200), "snap": True},
    {"ll": (9.97900, -84.81000), "snap": True},
    {"ll": (9.98000, -84.79800), "snap": True},   # El Cocal
    {"ll": (9.98100, -84.78600), "snap": True},   # La Angostura area
    {"ll": (9.97700, -84.76800), "snap": True},   # leaving the spit
    {"ll": (9.96800, -84.74800), "snap": True},
    {"ll": (9.95500, -84.73500), "snap": True},   # Ruta 23 coast
    {"ll": (9.94200, -84.72600), "snap": True},
    {"ll": (9.93300, -84.72200), "snap": True},   # Playa Caldera
    {"ll": (9.92796, -84.71093), "snap": False},  # Puente colgante Mata de Limon
    {"ll": (9.92200, -84.70950), "snap": True},   # Mata de Limon village
    {"ll": (9.91079, -84.71686), "snap": False},  # Puerto Caldera
]
SPINE_STEP_M = 25.0
SNAP_RADIUS_M = 120.0

# x-warp: the town spit gets more canvas than the rural coast leg so district
# proportions match the GDD while every real feature stays present. The y
# scale follows the LOCAL x scale (x CROSS_EXAG), so shapes stay locally
# uniform in each region.
TOWN_FRACTION = 0.68            # fraction of canvas for s in [0, s_split]
TOWN_SPLIT_WP = 7               # waypoint index where the route leaves the spit
WARP_BLEND_M = 900.0            # smoothstep half-window around the split

BUILDING_SCALE = 1.4            # match footprints to exaggerated road widths
POI_NUDGE_PX = 200

ROAD_WIDTH_PX = {
    "trunk": 46, "trunk_link": 34, "primary": 40, "primary_link": 32,
    "secondary": 34, "tertiary": 32, "tertiary_link": 28,
    "residential": 30, "unclassified": 30, "living_street": 26,
    "service": 18, "pedestrian": 20, "paseo": 42, "bridge": 36,
}
ROAD_CLASSES = set(ROAD_WIDTH_PX) - {"paseo", "bridge"}
SERVICE_MIN_PX = 40
DP_ROAD_PX = 1.0
DP_BUILDING_PX = 2.0
DP_COAST_PX = 2.5
MIN_BUILDING_AREA_PX2 = 24

CLS_WATER, CLS_LAND, CLS_BEACH, CLS_ROAD, CLS_PASEO, CLS_BRIDGE, CLS_ACERA = 0, 1, 2, 3, 4, 5, 6
CLASS_NAMES = ["water", "land", "beach", "road", "paseo", "bridge", "acera"]
ACERA_CELLS = 2                 # sidewalk depth: 2 cells = 8 px each side

# probes for orientation / sanity (geo)
PROBE_LAND = [(9.97769, -84.83487),   # Catedral
              (9.92272, -84.70911),   # Escuela Mata de Limon
              (9.97600, -84.84500)]   # Carmen
PROBE_SEA = [(9.95000, -84.87000),    # open gulf W
             (9.96000, -84.80000),    # gulf S of the spit
             (9.99500, -84.82000)]    # Estero de Puntarenas N of the spit

# district boundaries as geo anchors (7 boundaries -> 8 districts, GDD order)
DISTRICT_DEFS = [
    {"id": "faro",     "name": "EL FARO",               "short": "Faro",       "tone": "#f4d77a"},
    {"id": "carmen",   "name": "CARMEN",                "short": "Carmen",     "tone": "#e0b478"},
    {"id": "paseo",    "name": "PASEO DE LOS TURISTAS", "short": "Paseo",      "tone": "#f0a37a"},
    {"id": "centro",   "name": "CENTRO PUNTARENAS",     "short": "Centro",     "tone": "#e6c388"},
    {"id": "playitas", "name": "BARRIO LAS PLAYITAS",   "short": "Playitas",   "tone": "#caa089"},
    {"id": "cocal",    "name": "BARRIO EL COCAL",       "short": "Cocal",      "tone": "#a8b88a"},
    {"id": "mata",     "name": "MATA DE LIMÓN",         "short": "Mata Limón", "tone": "#a0c894"},
    {"id": "caldera",  "name": "CALDERA BULEVAR",       "short": "Caldera",    "tone": "#9bc4d4"},
]
DISTRICT_BOUNDS_GEO = [
    (9.97620, -84.84800),  # faro | carmen
    (9.97550, -84.84050),  # carmen | paseo
    (9.97700, -84.83300),  # paseo | centro
    (9.97820, -84.82400),  # centro | playitas
    (9.97950, -84.80800),  # playitas | cocal
    (9.93450, -84.72550),  # cocal | mata  (north of Playa Caldera)
    (9.91950, -84.71250),  # mata | caldera (between village and port)
]

# landmarks: same ids as the GDD / previous world.js. Resolution: "osm" is a
# case-insensitive substring matched against named OSM features (nearest to
# "near" wins when multiple match); "ll" is a hand-placed fallback/override.
LANDMARK_DEFS = [
    {"id": "faro",        "name": "El Faro",                    "type": "lighthouse",   "district": "faro",     "osm": "faro de la punta"},
    {"id": "muellecruc",  "name": "Muelle de Cruceros",         "type": "cruise",       "district": "carmen",   "osm": "muelle de cruceros", "ll": (9.97450, -84.83450)},
    {"id": "ferrycr",     "name": "Terminal de Ferry",          "type": "ferry",        "district": "carmen",   "osm": "terminal de ferry puntarenas"},
    {"id": "playa",       "name": "Playa Puntarenas",           "type": "beachsign",    "district": "carmen",   "ll": (9.97500, -84.84300)},
    {"id": "carmenig",    "name": "Iglesia del Carmen",         "type": "church",       "district": "carmen",   "osm": "iglesia del carmen", "ll": (9.97650, -84.84400)},
    {"id": "tioga",       "name": "Hotel Tioga",                "type": "hotel",        "district": "paseo",    "osm": "tioga", "ll": (9.97500, -84.83600)},
    {"id": "kios_paseo1", "name": "Kiosco Doña Lela",           "type": "kiosk",        "district": "paseo",    "osm": "kioscos paseo de los turistas", "dx": -60},
    {"id": "kios_paseo2", "name": "Churchill El Mariachi",      "type": "kiosk",        "district": "paseo",    "osm": "kioscos paseo de los turistas", "dx": 60},
    {"id": "casafait",    "name": "Casa Fait",                  "type": "house",        "district": "paseo",    "osm": "casa fait", "ll": (9.97700, -84.82900)},
    {"id": "parquemar",   "name": "Parque Marino del Pacífico", "type": "park",         "district": "paseo",    "osm": "parque marino", "ll": (9.97600, -84.82300)},
    {"id": "mercado",     "name": "Mercado Central",            "type": "market",       "district": "centro",   "osm": "mercado municipal de puntarenas"},
    {"id": "pali",        "name": "Supermercado Palí",          "type": "super",        "district": "centro",   "osm": "palí", "ll": (9.97650, -84.82900)},
    {"id": "catedral",    "name": "Catedral de Puntarenas",     "type": "cathedral",    "district": "centro",   "osm": "catedral", "near": (9.97769, -84.83487)},
    {"id": "cultura",     "name": "Casa de la Cultura",         "type": "civic",        "district": "centro",   "osm": "casa de la cultura", "ll": (9.97600, -84.83550)},
    {"id": "museo",       "name": "Museo Histórico Marino",     "type": "museum",       "district": "centro",   "osm": "museo", "near": (9.97600, -84.83550), "ll": (9.97580, -84.83520)},
    {"id": "kios_centro", "name": "Kiosco La Porteña",          "type": "kiosk",        "district": "centro",   "ll": (9.97480, -84.83000)},
    {"id": "estadio",     "name": "Estadio Lito Pérez",         "type": "stadium",      "district": "playitas", "osm": "lito pérez", "ll": (9.97880, -84.82660)},
    {"id": "kios_play",   "name": "Kiosco Playitas",            "type": "kiosk",        "district": "playitas", "ll": (9.97950, -84.81600)},
    {"id": "yatch",       "name": "Yacht Club",                 "type": "marina",       "district": "playitas", "osm": "yacht", "ll": (9.97900, -84.81200)},
    {"id": "cocal_park",  "name": "Parque El Cocal",            "type": "park",         "district": "cocal",    "ll": (9.97950, -84.79500)},
    {"id": "kios_cocal",  "name": "Kiosco El Cocal",            "type": "kiosk",        "district": "cocal",    "ll": (9.98100, -84.79400)},
    {"id": "puente",      "name": "Puente de Mata de Limón",    "type": "bridge",       "district": "mata",     "osm": "puente colgante mata de limón"},
    {"id": "kios_mata",   "name": "Kiosco Mata de Limón",       "type": "kiosk",        "district": "mata",     "ll": (9.92250, -84.70850)},
    {"id": "leda",        "name": "Marisquería Leda",           "type": "restaurant",   "district": "mata",     "osm": "leda", "ll": (9.92350, -84.70780)},
    {"id": "matalimon",   "name": "Estero Mata de Limón",       "type": "estuary",      "district": "mata",     "osm": "estero mata de limón"},
    {"id": "caldera_blvd","name": "Caldera Bulevar",            "type": "sign",         "district": "caldera",  "ll": (9.91800, -84.71300)},
    {"id": "tren",        "name": "Estación Tren Caldera",      "type": "trainstation", "district": "caldera",  "osm": "estación tren", "ll": (9.91500, -84.71500)},
    {"id": "puerto",      "name": "Puerto de Caldera",          "type": "port",         "district": "caldera",  "osm": "puerto internacional caldera"},
    {"id": "villach",     "name": "Villa Champán",              "type": "village",      "district": "caldera",  "ll": (9.91600, -84.71250)},
    {"id": "ruta27",      "name": "Ruta 27 · Autopista",        "type": "highway",      "district": "caldera",  "ll": (9.91000, -84.71000)},
]

CUSTOMER_DEFS = [
    {"id": "c1",  "name": "Don Beto, pescador",     "district": "carmen",   "line": "¡Antes que se derrita, mae!",  "ll": (9.97700, -84.84700)},
    {"id": "c2",  "name": "Crucerista alemana",     "district": "carmen",   "line": "Eine Churchill, bitte!",       "ll": (9.97600, -84.84550)},
    {"id": "c3",  "name": "Carnaval troupe",        "district": "paseo",    "line": "Para los muchachos del baile.", "ll": (9.97450, -84.83300)},
    {"id": "c4",  "name": "Familia tica",           "district": "paseo",    "line": "Cuatro, con extra leche.",     "ll": (9.97470, -84.83100)},
    {"id": "c5",  "name": "Surfista canadiense",    "district": "paseo",    "line": "Make it extra red, dude.",     "ll": (9.97420, -84.83550)},
    {"id": "c6",  "name": "Padre Ramírez",          "district": "centro",   "line": "Bendito churchill.",           "ll": (9.97760, -84.83470)},
    {"id": "c7",  "name": "Vendedor de ceviche",    "district": "centro",   "line": "Cambio: ceviche x churchill.", "ll": (9.97700, -84.83100)},
    {"id": "c8",  "name": "Doña del mercado",       "district": "centro",   "line": "Rojito bien fuerte.",          "ll": (9.98000, -84.83100)},
    {"id": "c9",  "name": "Niño con bici",          "district": "centro",   "line": "¡El mío con piña!",            "ll": (9.97720, -84.82800)},
    {"id": "c10", "name": "Equipo de fútbol",       "district": "playitas", "line": "Once. Es broma. Tres.",        "ll": (9.97880, -84.82620)},
    {"id": "c11", "name": "Doña del rocking chair", "district": "playitas", "line": "Como en los años 80.",         "ll": (9.97700, -84.81800)},
    {"id": "c12", "name": "Yatista gringo",         "district": "playitas", "line": "Best churchill ever, man.",    "ll": (9.97920, -84.81200)},
    {"id": "c13", "name": "Pareja en mirador",      "district": "cocal",    "line": "Para ver el atardecer.",       "ll": (9.96000, -84.73900)},
    {"id": "c14", "name": "Camionero de Ruta 17",   "district": "cocal",    "line": "Rápido, voy pa' Caldera.",     "ll": (9.96800, -84.74400)},
    {"id": "c15", "name": "Pescadores del estero",  "district": "mata",     "line": "Justo antes de la lluvia.",    "ll": (9.92600, -84.71000)},
    {"id": "c16", "name": "Cocineros de Leda",      "district": "mata",     "line": "Postre para los clientes.",    "ll": (9.92350, -84.70780)},
    {"id": "c17", "name": "Maquinista del tren",    "district": "caldera",  "line": "Salgo al amanecer, mae.",      "ll": (9.91450, -84.71550)},
    {"id": "c18", "name": "Estibador del Puerto",   "district": "caldera",  "line": "Cargando contenedor.",         "ll": (9.91080, -84.71680)},
]

# story stages — verbatim from the previous world.js (ids referenced by engine/ui)
STAGES = [
    {"id": "s1", "num": 1, "name": "El Faro", "district": "carmen",
     "brief": "Repartí el primer pedido del día. Llegan cruceros — los gringos quieren probar el dichoso Churchill.",
     "kiosks": ["kios_paseo1"], "targetDeliveries": 3, "timeLimit": 90, "weather": "sunny",
     "customers": ["c1", "c2"], "unlock": "paseo"},
    {"id": "s2", "num": 2, "name": "Paseo de los Turistas", "district": "paseo",
     "brief": "El boulevard está lleno. Atravesá la peatonal, esquivá turistas y carnaval.",
     "kiosks": ["kios_paseo1", "kios_paseo2"], "targetDeliveries": 4, "timeLimit": 120, "weather": "sunny",
     "customers": ["c3", "c4", "c5"], "unlock": "centro"},
    {"id": "s3", "num": 3, "name": "Mercado y Catedral", "district": "centro",
     "brief": "Calles del centro angostas (C.1, C.3, C.5…). Tráfico, gatos, padre con hambre.",
     "kiosks": ["kios_paseo2", "kios_centro"], "targetDeliveries": 4, "timeLimit": 130, "weather": "sunny",
     "customers": ["c6", "c7", "c8", "c9"], "unlock": "playitas"},
    {"id": "s4", "num": 4, "name": "Atardecer en Las Playitas", "district": "playitas",
     "brief": "Sunset sobre el Yacht Club. Velocidad sobre Ruta 17. Cuidado con el equipo de fútbol.",
     "kiosks": ["kios_centro", "kios_play"], "targetDeliveries": 5, "timeLimit": 140, "weather": "sunset",
     "customers": ["c10", "c11", "c12"], "unlock": "cocal"},
    {"id": "s5", "num": 5, "name": "Tormenta en El Cocal", "district": "cocal",
     "brief": "Lluvia tropical, poca tracción. Llegá a la Ruta 17 antes que el aguacero te aguante.",
     "kiosks": ["kios_play", "kios_cocal"], "targetDeliveries": 5, "timeLimit": 160, "weather": "storm",
     "customers": ["c13", "c14"], "unlock": "mata"},
    {"id": "s6", "num": 6, "name": "Puente · Mata de Limón", "district": "mata",
     "brief": "Cruzá el puente colgante sobre el estero. Llegá al kiosco de Mata de Limón y a la Marisquería Leda.",
     "kiosks": ["kios_cocal", "kios_mata"], "targetDeliveries": 4, "timeLimit": 150, "weather": "night",
     "customers": ["c15", "c16"], "unlock": "mata"},
    {"id": "s7", "num": 7, "name": "Caldera · Final", "district": "caldera",
     "brief": "Ruta 27 hasta el Puerto de Caldera. El amanecer pega fuerte — última entrega antes que termine el día.",
     "kiosks": ["kios_mata"], "targetDeliveries": 4, "timeLimit": 170, "weather": "sunny",
     "customers": ["c17", "c18"], "unlock": "caldera"},
]

BLDG_PALETTE = ["#f3c969", "#e85d75", "#6fbf99", "#5fb0d6", "#f08a5d",
                "#c084d6", "#f4d77a", "#7ed6b5", "#e7a3b7", "#9bc4d4",
                "#fff2cc", "#ffd8b1"]
ROOF_PALETTE = ["#9e6f4a", "#3a3540", "#e85d75", "#6fbf99", "#f08a5d", "#3a6f8a"]

# ------------------------------------------------------------ geo helpers ---

def to_m(lat, lon):
    return ((lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT)

def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])

def poly_centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

def poly_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        s += x0 * y1 - x1 * y0
    return s / 2.0

def point_in_poly(pt, pts):
    x, y = pt
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def dp_simplify(pts, tol):
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if seg2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > worst:
                worst, wi = d, i
        if worst > tol:
            keep[wi] = True
            stack.append((a, wi))
            stack.append((wi, b))
    return [p for p, k in zip(pts, keep) if k]

def clip_polyline_to_rect(pts, w, h):
    """Liang-Barsky per segment; returns list of polyline pieces inside rect."""
    pieces, cur = [], []

    def clip_seg(p0, p1):
        x0, y0 = p0
        x1, y1 = p1
        t0, t1 = 0.0, 1.0
        dx, dy = x1 - x0, y1 - y0
        for p, q in ((-dx, x0), (dx, w - x0), (-dy, y0), (dy, h - y0)):
            if p == 0:
                if q < 0:
                    return None
            else:
                r = q / p
                if p < 0:
                    if r > t1:
                        return None
                    if r > t0:
                        t0 = r
                else:
                    if r < t0:
                        return None
                    if r < t1:
                        t1 = r
        return ((x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy), t0, t1)

    for i in range(len(pts) - 1):
        res = clip_seg(pts[i], pts[i + 1])
        if res is None:
            if cur:
                pieces.append(cur)
                cur = []
            continue
        a, b, t0, t1 = res
        if not cur:
            cur = [a]
        elif dist(cur[-1], a) > 1e-6:
            pieces.append(cur)
            cur = [a]
        cur.append(b)
        if t1 < 1.0:
            pieces.append(cur)
            cur = []
    if cur:
        pieces.append(cur)
    return [p for p in pieces if len(p) >= 2]

def clip_poly_to_rect(pts, w, h):
    """Sutherland-Hodgman against canvas rect."""
    def clip_edge(poly, inside, intersect):
        out = []
        for i in range(len(poly)):
            cur, prev = poly[i], poly[i - 1]
            ci, pi = inside(cur), inside(prev)
            if ci:
                if not pi:
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif pi:
                out.append(intersect(prev, cur))
        return out

    def ix(p0, p1, x):
        t = (x - p0[0]) / (p1[0] - p0[0])
        return (x, p0[1] + t * (p1[1] - p0[1]))

    def iy(p0, p1, y):
        t = (y - p0[1]) / (p1[1] - p0[1])
        return (p0[0] + t * (p1[0] - p0[0]), y)

    poly = list(pts)
    for inside, inter in (
        (lambda p: p[0] >= 0, lambda a, b: ix(a, b, 0)),
        (lambda p: p[0] <= w, lambda a, b: ix(a, b, w)),
        (lambda p: p[1] >= 0, lambda a, b: iy(a, b, 0)),
        (lambda p: p[1] <= h, lambda a, b: iy(a, b, h)),
    ):
        poly = clip_edge(poly, inside, inter)
        if len(poly) < 3:
            return []
    return poly

# ----------------------------------------------------------------- parse ---

def parse_osm(path):
    nodes = {}
    ways = []
    named = []            # (lower_name, (mx,my), tags) for POI resolution
    rels = []
    keep_keys = {"highway", "building", "natural", "name", "amenity",
                 "man_made", "bridge", "ref", "wetland", "leisure"}
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag == "node":
            nid = el.get("id")
            ll = (float(el.get("lat")), float(el.get("lon")))
            nodes[nid] = ll
            tags = None
            for t in el.findall("tag"):
                if t.get("k") == "name" or t.get("k") in ("man_made", "amenity"):
                    if tags is None:
                        tags = {tt.get("k"): tt.get("v") for tt in el.findall("tag")}
            if tags and tags.get("name"):
                named.append((tags["name"].lower(), to_m(*ll), tags))
            el.clear()
        elif el.tag == "way":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if tags.keys() & keep_keys:
                nds = [n.get("ref") for n in el.findall("nd")]
                ways.append({"id": el.get("id"), "nds": nds, "tags": tags})
            el.clear()
        elif el.tag == "relation":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if tags.get("type") == "multipolygon" and tags.get("natural") in ("water", "wetland", "beach"):
                members = [(m.get("ref"), m.get("role")) for m in el.findall("member") if m.get("type") == "way"]
                rels.append({"tags": tags, "members": members})
            el.clear()
    # resolve way coords in meters; register named ways too
    for w in ways:
        pts = [to_m(*nodes[r]) for r in w["nds"] if r in nodes]
        w["pts"] = pts
        nm = w["tags"].get("name")
        if nm and pts:
            named.append((nm.lower(), poly_centroid(pts), w["tags"]))
    return nodes, ways, named, rels

# ----------------------------------------------------------------- spine ---

class Spine:
    def __init__(self, pts_m, s_split=None):
        self.pts = pts_m
        self.seg = []
        self.cum = [0.0]
        for i in range(len(pts_m) - 1):
            d = dist(pts_m[i], pts_m[i + 1])
            self.seg.append(d)
            self.cum.append(self.cum[-1] + d)
        self.total = self.cum[-1]
        self.side_sign = 1.0
        self.px_per_m = SPINE_TARGET_PX / self.total
        # x-warp tables: x(s) integrates a weight that gives the town spit
        # TOWN_FRACTION of the canvas; xscale(s) = dx/ds drives the y scale too.
        if s_split is None:
            s_split = self.total * 0.5
        w_town = TOWN_FRACTION * SPINE_TARGET_PX / max(s_split, 1)
        w_coast = (1 - TOWN_FRACTION) * SPINE_TARGET_PX / max(self.total - s_split, 1)

        def weight(s):
            t = (s - s_split) / WARP_BLEND_M * 0.5 + 0.5
            t = max(0.0, min(1.0, t))
            t = t * t * (3 - 2 * t)
            return w_town + (w_coast - w_town) * t

        self.xs = [0.0]
        for i in range(len(self.cum) - 1):
            smid = (self.cum[i] + self.cum[i + 1]) / 2
            self.xs.append(self.xs[-1] + weight(smid) * self.seg[i])
        norm = SPINE_TARGET_PX / self.xs[-1]
        self.xs = [v * norm for v in self.xs]
        self.wscale = [weight(s) * norm for s in self.cum]

    def x_of_s(self, s):
        s = max(0.0, min(self.total, s))
        # uniform SPINE_STEP_M sampling makes index lookup nearly direct
        i = min(len(self.cum) - 2, max(0, int(s / SPINE_STEP_M)))
        while i > 0 and self.cum[i] > s:
            i -= 1
        while i < len(self.cum) - 2 and self.cum[i + 1] < s:
            i += 1
        t = (s - self.cum[i]) / max(self.cum[i + 1] - self.cum[i], 1e-9)
        return self.xs[i] + (self.xs[i + 1] - self.xs[i]) * t, \
               self.wscale[i] + (self.wscale[i + 1] - self.wscale[i]) * t

    def project_m(self, p, hint=None, window=80):
        n = len(self.pts) - 1
        if hint is None:
            rng = range(n)
        else:
            rng = range(max(0, hint - window), min(n, hint + window))
        best = (1e18, 0, 0.0)
        for i in rng:
            ax, ay = self.pts[i]
            bx, by = self.pts[i + 1]
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            if L2 == 0:
                continue
            t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2
            t = max(0.0, min(1.0, t))
            fx, fy = ax + t * dx, ay + t * dy
            d2 = (p[0] - fx) ** 2 + (p[1] - fy) ** 2
            if d2 < best[0]:
                best = (d2, i, t)
        d2, i, t = best
        ax, ay = self.pts[i]
        bx, by = self.pts[i + 1]
        dx, dy = bx - ax, by - ay
        L = math.sqrt(dx * dx + dy * dy)
        tx, ty = dx / L, dy / L
        fx, fy = ax + t * dx, ay + t * dy
        vx, vy = p[0] - fx, p[1] - fy
        cross = tx * vy - ty * vx
        d = math.sqrt(d2) * (1.0 if cross >= 0 else -1.0) * self.side_sign
        s = self.cum[i] + t * L
        return s, d, i

    def to_px(self, s, d):
        x, sc = self.x_of_s(s)
        return (MARGIN_X + x, CENTER_Y + d * sc * CROSS_EXAG)

    def project(self, p_m, hint=None):
        s, d, i = self.project_m(p_m, hint)
        x, y = self.to_px(s, d)
        return x, y, i, d


def catmull_rom(points, step):
    """Centripetal Catmull-Rom through points, sampled roughly every `step`."""
    P = [points[0]] + list(points) + [points[-1]]
    out = [points[0]]
    for i in range(len(P) - 3):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        def tj(ti, pa, pb):
            return ti + max(dist(pa, pb), 1e-6) ** 0.5
        t0 = 0.0
        t1 = tj(t0, p0, p1)
        t2 = tj(t1, p1, p2)
        t3 = tj(t2, p2, p3)
        n = max(2, int(dist(p1, p2) / step) + 1)
        for k in range(1, n + 1):
            t = t1 + (t2 - t1) * k / n
            def lerp(pa, pb, ta, tb):
                if tb - ta < 1e-9:
                    return pa
                u = (t - ta) / (tb - ta)
                return (pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u)
            a1 = lerp(p0, p1, t0, t1)
            a2 = lerp(p1, p2, t1, t2)
            a3 = lerp(p2, p3, t2, t3)
            b1 = lerp(a1, a2, t0, t2)
            b2 = lerp(a2, a3, t1, t3)
            c = lerp(b1, b2, t1, t2)
            out.append(c)
    # uniform arclength resample
    res = [out[0]]
    acc = 0.0
    for i in range(1, len(out)):
        d = dist(out[i - 1], out[i])
        while acc + d >= step:
            t = (step - acc) / d
            p = (out[i - 1][0] + (out[i][0] - out[i - 1][0]) * t,
                 out[i - 1][1] + (out[i][1] - out[i - 1][1]) * t)
            res.append(p)
            out[i - 1] = p
            d = dist(out[i - 1], out[i])
            acc = 0.0
        acc += d
    if dist(res[-1], out[-1]) > 1e-6:
        res.append(out[-1])
    return res


def build_spine(ways, nodes):
    # candidate snap nodes: nodes of big roads (the real asphalt axis)
    snap_nodes = []
    for w in ways:
        hw = w["tags"].get("highway")
        ref = w["tags"].get("ref", "")
        if hw in ("trunk", "primary", "secondary") or ref in ("17", "23"):
            snap_nodes.extend(w["pts"])
    wp = []
    moved = []
    for spec in SPINE_WAYPOINTS:
        p = to_m(*spec["ll"])
        if spec["snap"] and snap_nodes:
            best = min(snap_nodes, key=lambda q: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2)
            if dist(best, p) <= SNAP_RADIUS_M:
                moved.append(round(dist(best, p)))
                p = best
            else:
                moved.append(None)
        else:
            moved.append(0)
        wp.append(p)
    smooth = catmull_rom(wp, SPINE_STEP_M)
    # arclength of the town/coast split (La Angostura waypoint)
    split_pt = wp[TOWN_SPLIT_WP]
    acc, s_split, best = 0.0, 0.0, 1e18
    for i in range(len(smooth) - 1):
        d2 = (smooth[i][0] - split_pt[0]) ** 2 + (smooth[i][1] - split_pt[1]) ** 2
        if d2 < best:
            best, s_split = d2, acc
        acc += dist(smooth[i], smooth[i + 1])
    sp = Spine(smooth, s_split)
    # side calibration: Mercado (north shore of the spit) must land at y < CENTER_Y
    s, d, _ = sp.project_m(to_m(9.98009, -84.83093))
    if d > 0:
        sp.side_sign = -1.0
    print(f"[spine] {len(wp)} waypoints (snapped moves m: {moved}), "
          f"length {sp.total:.0f} m, {1/sp.px_per_m:.2f} m/px")
    return sp

# ------------------------------------------------------------- extraction ---

def project_way_pts(sp, pts):
    out, hint, dmax = [], None, 0.0
    for p in pts:
        x, y, hint, d = sp.project(p, hint)
        out.append((x, y))
        dmax = max(dmax, abs(d))
    return out, dmax


def way_in_corridor(sp, pts, limit=CORRIDOR_HALF_M):
    c = poly_centroid(pts)
    s, d, _ = sp.project_m(c)
    return abs(d) <= limit


def extract_roads(sp, ways):
    roads = []
    bridge_way = None
    for w in ways:
        hw = w["tags"].get("highway")
        name = (w["tags"].get("name") or "")
        lname = name.lower()
        is_bridge = "puente colgante mata" in lname
        if not is_bridge and hw not in ROAD_CLASSES:
            continue
        if len(w["pts"]) < 2 or not way_in_corridor(sp, w["pts"]):
            continue
        cls = "bridge" if is_bridge else hw
        if "paseo de los turistas" in lname:
            cls = "paseo"
        pts, _ = project_way_pts(sp, w["pts"])
        for piece in clip_polyline_to_rect(pts, CANVAS_W, CANVAS_H):
            piece = dp_simplify(piece, DP_ROAD_PX)
            length = sum(dist(piece[i], piece[i + 1]) for i in range(len(piece) - 1))
            if cls == "service" and length < SERVICE_MIN_PX:
                continue
            if length < 8:
                continue
            r = {"cls": cls, "w": ROAD_WIDTH_PX[cls],
                 "pts": [round(v) for p in piece for v in p]}
            if name:
                r["name"] = name
            if w["tags"].get("ref"):
                r["ref"] = w["tags"]["ref"]
            if w["tags"].get("bridge") == "yes" and cls != "bridge":
                r["bridge"] = 1  # e.g. Río Barranca bridge at El Roble
            roads.append(r)
            if cls == "bridge":
                bridge_way = r
    return roads, bridge_way


def extract_buildings(sp, ways, roads):
    # road segments for overlap testing (subdivided, with per-class half width)
    segs = []
    for r in roads:
        p = r["pts"]
        hw = max(4.0, r["w"] / 2 - 3)  # allow facades to touch the curb
        for i in range(0, len(p) - 2, 2):
            segs.append((p[i], p[i + 1], p[i + 2], p[i + 3], hw))
    cellmap = defaultdict(list)
    CS = 64
    for idx, s in enumerate(segs):
        x0, y0, x1, y1 = s[0], s[1], s[2], s[3]
        for cx in range(int(min(x0, x1)) // CS, int(max(x0, x1)) // CS + 1):
            for cy in range(int(min(y0, y1)) // CS, int(max(y0, y1)) // CS + 1):
                cellmap[(cx, cy)].append(idx)

    def nearest_road(px, py):
        """(gap, hw, qx, qy) for the road segment whose buffer the point is
        deepest inside / closest to; checks the 3x3 cell neighborhood."""
        best = None
        c0, r0 = int(px) // CS, int(py) // CS
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for idx in cellmap.get((c0 + dc, r0 + dr), ()):
                    x0, y0, x1, y1, hw = segs[idx]
                    dx, dy = x1 - x0, y1 - y0
                    L2 = dx * dx + dy * dy
                    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
                    qx, qy = x0 + t * dx, y0 + t * dy
                    d = math.hypot(px - qx, py - qy)
                    if best is None or d - hw < best[0]:
                        best = (d - hw, hw, qx, qy, d)
        return best

    def near_road(px, py):
        b = nearest_road(px, py)
        return b is not None and b[0] <= 0

    out = []
    dropped_road, dropped_small = 0, 0
    for w in ways:
        if "building" not in w["tags"] or len(w["pts"]) < 4:
            continue
        if not way_in_corridor(sp, w["pts"]):
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        if dist(pts[0], pts[-1]) < 1e-6:
            pts = pts[:-1]
        pts = clip_poly_to_rect(pts, CANVAS_W, CANVAS_H)
        if len(pts) < 3:
            continue
        pts = dp_simplify(pts + [pts[0]], DP_BUILDING_PX)[:-1]
        if len(pts) < 3 or abs(poly_area(pts)) < MIN_BUILDING_AREA_PX2:
            dropped_small += 1
            continue
        # Buildings line the streets: push the footprint out of any widened
        # road corridor (like a house set back from the curb), then shrink
        # step-by-step until it fits its block.
        cx, cy = poly_centroid(pts)
        ok = True
        for _ in range(4):
            b = nearest_road(cx, cy)
            if b is None or b[0] > 2:
                break
            gap, hw, qx, qy, d = b
            if d < 1e-6:
                ok = False
                break
            ux, uy = (cx - qx) / d, (cy - qy) / d
            shift = (hw + 4 - d)
            cx, cy = cx + ux * shift, cy + uy * shift
            pts = [(px + ux * shift, py + uy * shift) for px, py in pts]
        if not ok or near_road(cx, cy):
            dropped_road += 1
            continue
        fitted = None
        for scale in (BUILDING_SCALE, 1.2, 1.0, 0.85, 0.7, 0.55):
            cand = [(cx + (px - cx) * scale, cy + (py - cy) * scale) for px, py in pts]
            if not any(near_road(p[0], p[1]) for p in cand):
                fitted = cand
                break
        if fitted is None:
            dropped_road += 1
            continue
        pts = fitted
        if abs(poly_area(pts)) < MIN_BUILDING_AREA_PX2:
            dropped_small += 1
            continue
        seed = int(w["id"]) % 233280
        def rng():
            nonlocal seed
            seed = (seed * 9301 + 49297) % 233280
            return seed / 233280
        out.append({
            "pts": [round(v) for p in pts for v in p],
            "color": BLDG_PALETTE[int(rng() * len(BLDG_PALETTE))],
            "roof": ROOF_PALETTE[int(rng() * len(ROOF_PALETTE))],
            "wnd": 1 if rng() < 0.7 else 0,
        })
    print(f"[buildings] kept {len(out)}, dropped {dropped_road} on-road, {dropped_small} tiny")
    return out


def extract_coastlines(sp, ways):
    """Stitch natural=coastline ways by endpoint node id, project chains."""
    coast = [w for w in ways if w["tags"].get("natural") == "coastline" and len(w["nds"]) >= 2]
    by_first = defaultdict(list)
    for w in coast:
        by_first[w["nds"][0]].append(w)
    used, chains = set(), []
    for w in coast:
        if w["id"] in used:
            continue
        used.add(w["id"])
        nds = list(w["nds"])
        while True:
            nxt = next((c for c in by_first.get(nds[-1], []) if c["id"] not in used), None)
            if nxt is None:
                break
            used.add(nxt["id"])
            nds.extend(nxt["nds"][1:])
        chains.append(nds)
    return chains  # node-id chains; resolved by caller


def extract_areas(sp, ways, rels):
    beaches, waters = [], []
    ways_by_id = {w["id"]: w for w in ways}
    def add_poly(target, pts_m):
        if len(pts_m) < 3 or not way_in_corridor(sp, pts_m, CORRIDOR_HALF_M + 300):
            return
        pts, _ = project_way_pts(sp, pts_m)
        pts = clip_poly_to_rect(pts, CANVAS_W, CANVAS_H)
        if len(pts) < 3:
            return
        pts = dp_simplify(pts + [pts[0]], DP_COAST_PX)[:-1]
        if len(pts) >= 3:
            target.append([round(v) for p in pts for v in p])

    for w in ways:
        nat = w["tags"].get("natural")
        if nat == "beach":
            add_poly(beaches, w["pts"])
        elif nat == "water" or (nat == "wetland" and w["tags"].get("wetland") == "mangrove"):
            add_poly(waters, w["pts"])
        elif nat == "wetland" and "estero mata" in (w["tags"].get("name") or "").lower():
            add_poly(waters, w["pts"])
    for rel in rels:
        for ref, role in rel["members"]:
            if role != "outer" or ref not in ways_by_id:
                continue
            w = ways_by_id[ref]
            if len(w["pts"]) >= 3:
                if rel["tags"].get("natural") == "beach":
                    add_poly(beaches, w["pts"])
                else:
                    add_poly(waters, w["pts"])
    return beaches, waters

# ------------------------------------------------------------ raster grid ---

def raster_fill_poly(grid, pts, cls):
    """Even-odd scanline fill of a polygon given px coords onto the cell grid."""
    ys = [p[1] for p in pts]
    r0 = max(0, int(min(ys)) // GRID_CELL)
    r1 = min(GRID_ROWS - 1, int(max(ys)) // GRID_CELL)
    n = len(pts)
    for row in range(r0, r1 + 1):
        y = (row + 0.5) * GRID_CELL
        xs = []
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            if (y0 > y) != (y1 > y):
                xs.append(x0 + (y - y0) / (y1 - y0) * (x1 - x0))
        xs.sort()
        base = row * GRID_COLS
        for k in range(0, len(xs) - 1, 2):
            c0 = max(0, int(xs[k] / GRID_CELL + 0.5))
            c1 = min(GRID_COLS - 1, int(xs[k + 1] / GRID_CELL - 0.5))
            for c in range(c0, c1 + 1):
                grid[base + c] = cls


def raster_stamp_polyline(grid, flat_pts, width, cls):
    """Stamp a stroked polyline (round caps) onto the grid."""
    hw = width / 2.0
    pts = [(flat_pts[i], flat_pts[i + 1]) for i in range(0, len(flat_pts), 2)]
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        # subdivide long segments to keep bboxes tight
        L = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(L / 28))
        for k in range(steps):
            ax = x0 + (x1 - x0) * k / steps
            ay = y0 + (y1 - y0) * k / steps
            bx = x0 + (x1 - x0) * (k + 1) / steps
            by = y0 + (y1 - y0) * (k + 1) / steps
            c0 = max(0, int((min(ax, bx) - hw) / GRID_CELL))
            c1 = min(GRID_COLS - 1, int((max(ax, bx) + hw) / GRID_CELL))
            r0 = max(0, int((min(ay, by) - hw) / GRID_CELL))
            r1 = min(GRID_ROWS - 1, int((max(ay, by) + hw) / GRID_CELL))
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            for row in range(r0, r1 + 1):
                py = (row + 0.5) * GRID_CELL
                base = row * GRID_COLS
                for col in range(c0, c1 + 1):
                    px = (col + 0.5) * GRID_CELL
                    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                    if (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2 <= hw * hw:
                        grid[base + col] = cls


def raster_coast_barrier(grid_barrier, sp, chains, nodes):
    """Rasterize coastline chains as 1-cell barriers (supercover lines)."""
    drawn = 0
    for nds in chains:
        pts_m = [to_m(*nodes[r]) for r in nds if r in nodes]
        if len(pts_m) < 2:
            continue
        # keep chains that come anywhere near the corridor
        if not any(abs(sp.project_m(p)[1]) <= CORRIDOR_HALF_M + 600 for p in pts_m[:: max(1, len(pts_m) // 40)]):
            continue
        pts, _ = project_way_pts(sp, pts_m)
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            L = math.hypot(x1 - x0, y1 - y0)
            steps = max(1, int(L / (GRID_CELL * 0.5)))
            for k in range(steps + 1):
                x = x0 + (x1 - x0) * k / steps
                y = y0 + (y1 - y0) * k / steps
                c, r = int(x / GRID_CELL), int(y / GRID_CELL)
                if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS:
                    grid_barrier[r * GRID_COLS + c] = 1
                    drawn += 1
    print(f"[coast] rasterized barrier cells: {drawn}")


def flood_water(grid, barrier, seeds_px):
    """BFS flood from sea seeds; barrier cells stop the flood (they stay land)."""
    water = bytearray(GRID_COLS * GRID_ROWS)
    dq = deque()
    for (x, y) in seeds_px:
        c, r = int(x / GRID_CELL), int(y / GRID_CELL)
        if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS and not barrier[r * GRID_COLS + c]:
            idx = r * GRID_COLS + c
            if not water[idx]:
                water[idx] = 1
                dq.append(idx)
    while dq:
        idx = dq.popleft()
        r, c = divmod(idx, GRID_COLS)
        for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if 0 <= nr < GRID_ROWS and 0 <= nc < GRID_COLS:
                nidx = nr * GRID_COLS + nc
                if not water[nidx] and not barrier[nidx]:
                    water[nidx] = 1
                    dq.append(nidx)
    for i in range(len(grid)):
        grid[i] = CLS_WATER if water[i] else CLS_LAND
    return water


def trace_land_contours(grid):
    """Marching-squares style: emit oriented boundary edges (land on left),
    chain them into loops, return px-space polygons."""
    edges = {}  # start -> end

    def is_land(c, r):
        if c < 0 or c >= GRID_COLS or r < 0 or r >= GRID_ROWS:
            return False
        return grid[r * GRID_COLS + c] != CLS_WATER

    G = GRID_CELL
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            if not is_land(c, r):
                continue
            x0, y0, x1, y1 = c * G, r * G, (c + 1) * G, (r + 1) * G
            if not is_land(c + 1, r):
                edges[(x1, y1)] = (x1, y0)
            if not is_land(c - 1, r):
                edges[(x0, y0)] = (x0, y1)
            if not is_land(c, r - 1):
                edges[(x1, y0)] = (x0, y0)
            if not is_land(c, r + 1):
                edges[(x0, y1)] = (x1, y1)
    loops = []
    while edges:
        start, cur = next(iter(edges.items()))
        loop = [start]
        del edges[start]
        while cur != start and cur in edges:
            loop.append(cur)
            nxt = edges[cur]
            del edges[cur]
            cur = nxt
        if cur == start and len(loop) >= 8:
            loops.append(loop)
    out = []
    for lp in loops:
        if abs(poly_area(lp)) < 400:  # skip specks
            continue
        simp = dp_simplify(lp + [lp[0]], DP_COAST_PX)[:-1]
        if len(simp) >= 3:
            out.append([round(v) for p in simp for v in p])
    out.sort(key=lambda fl: -abs(poly_area([(fl[i], fl[i + 1]) for i in range(0, len(fl), 2)])))
    print(f"[coast] traced {len(out)} land contour loops")
    return out


def acera_fringe(grid, depth_cells=ACERA_CELLS):
    """Sidewalks: convert land cells bordering roads/paseo into acera."""
    cur = [i for i in range(len(grid)) if grid[i] in (CLS_ROAD, CLS_PASEO)]
    for _ in range(depth_cells):
        nxt = []
        for idx in cur:
            r, c = divmod(idx, GRID_COLS)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < GRID_ROWS and 0 <= nc < GRID_COLS:
                    nidx = nr * GRID_COLS + nc
                    if grid[nidx] == CLS_LAND:
                        grid[nidx] = CLS_ACERA
                        nxt.append(nidx)
        cur = nxt


def stamp_pad(grid, x, y, r_px):
    """Convert land to acera in a disc — plaza pads under POIs."""
    rc = max(1, int(r_px // GRID_CELL))
    c0, r0 = int(x // GRID_CELL), int(y // GRID_CELL)
    for dr in range(-rc, rc + 1):
        for dc in range(-rc, rc + 1):
            if dc * dc + dr * dr > rc * rc:
                continue
            c, r = c0 + dc, r0 + dr
            if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS and grid[r * GRID_COLS + c] == CLS_LAND:
                grid[r * GRID_COLS + c] = CLS_ACERA


def beach_fringe(grid, depth_cells=3):
    """Mark land cells within depth of water as beach (natural sand fringe)."""
    cur = [i for i in range(len(grid)) if grid[i] == CLS_WATER]
    for _ in range(depth_cells):
        nxt = []
        for idx in cur:
            r, c = divmod(idx, GRID_COLS)
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < GRID_ROWS and 0 <= nc < GRID_COLS:
                    nidx = nr * GRID_COLS + nc
                    if grid[nidx] == CLS_LAND:
                        grid[nidx] = CLS_BEACH
                        nxt.append(nidx)
        cur = nxt

# ------------------------------------------------------- synthetic infill ---

SYNTH_MAX_TOTAL = 1400          # cap on real + synthesized buildings
SYNTH_SEED = 77

def synth_buildings(grid, roads, real_bldgs, keepouts):
    """Fill the cuadras: place small buildings along road frontages wherever
    the block interior is empty land, so the town reads as a real city.
    Deterministic, collision-free vs roads (grid check), real footprints,
    each other, and POI keep-out zones."""
    def cell(px, py):
        c, r = int(px // GRID_CELL), int(py // GRID_CELL)
        if c < 0 or c >= GRID_COLS or r < 0 or r >= GRID_ROWS:
            return -1
        return grid[r * GRID_COLS + c]

    CS = 48
    bhash = defaultdict(list)
    aabbs = []

    def flat_aabb(flat):
        xs, ys = flat[0::2], flat[1::2]
        return (min(xs), min(ys), max(xs), max(ys))

    def add_box(a):
        idx = len(aabbs)
        aabbs.append(a)
        for cx in range(int(a[0]) // CS, int(a[2]) // CS + 1):
            for cy in range(int(a[1]) // CS, int(a[3]) // CS + 1):
                bhash[(cx, cy)].append(idx)

    def collides(a, gap=3):
        for cx in range(int(a[0]) // CS, int(a[2]) // CS + 1):
            for cy in range(int(a[1]) // CS, int(a[3]) // CS + 1):
                for idx in bhash.get((cx, cy), ()):
                    b = aabbs[idx]
                    if not (a[2] + gap < b[0] or a[0] - gap > b[2] or
                            a[3] + gap < b[1] or a[1] - gap > b[3]):
                        return True
        return False

    for b in real_bldgs:
        add_box(flat_aabb(b["pts"]))

    seed = SYNTH_SEED
    def rng():
        nonlocal seed
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280

    out = []
    for road in roads:
        if road["cls"] == "bridge":
            continue
        p = road["pts"]
        stations = []
        acc, nxt = 0.0, 20.0 + rng() * 16
        for i in range(0, len(p) - 2, 2):
            x0, y0, x1, y1 = p[i], p[i + 1], p[i + 2], p[i + 3]
            seg = math.hypot(x1 - x0, y1 - y0)
            if seg < 1e-6:
                continue
            tx, ty = (x1 - x0) / seg, (y1 - y0) / seg
            while nxt <= acc + seg:
                t = (nxt - acc) / seg
                stations.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, tx, ty))
                nxt += 22.0 + rng() * 16
            acc += seg
        for (sx, sy, tx, ty) in stations:
            nx, ny = -ty, tx
            for side in (1, -1):
                if rng() < 0.2:            # organic gaps
                    continue
                wa0 = 14 + rng() * 16      # width along the street
                dp0 = 11 + rng() * 13      # depth into the block
                # houses front the acera (leave ~6px of visible sidewalk)
                setback = road["w"] / 2 + 6 + rng() * 2
                placed = None
                # tight cuadras: retry with shallower row-house footprints
                for (wa, dp) in ((wa0, dp0), (wa0 * 0.8, dp0 * 0.6), (wa0 * 0.7, 7)):
                    cxx = sx + nx * side * (setback + dp / 2)
                    cyy = sy + ny * side * (setback + dp / 2)
                    corners = []
                    for (u, v) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                        corners.append((cxx + tx * u * wa / 2 + nx * v * dp / 2,
                                        cyy + ty * u * wa / 2 + ny * v * dp / 2))
                    samples = corners + [(cxx, cyy)]
                    if any(cell(px, py) not in (CLS_LAND, CLS_ACERA) for (px, py) in samples):
                        continue
                    if any((cxx - kx) ** 2 + (cyy - ky) ** 2 < (kr + 14) ** 2
                           for (kx, ky, kr) in keepouts):
                        break
                    flat = [round(v) for c in corners for v in c]
                    a = flat_aabb(flat)
                    if collides(a):
                        break
                    placed = (flat, a)
                    break
                if placed is None:
                    continue
                add_box(placed[1])
                out.append({
                    "pts": placed[0],
                    "color": BLDG_PALETTE[int(rng() * len(BLDG_PALETTE))],
                    "roof": ROOF_PALETTE[int(rng() * len(ROOF_PALETTE))],
                    "wnd": 1 if rng() < 0.7 else 0,
                })
                if len(out) + len(real_bldgs) >= SYNTH_MAX_TOTAL:
                    return out
    return out

# ---------------------------------------------------------------- outputs ---

def rle_encode(grid):
    out = bytearray()
    i, n = 0, len(grid)
    while i < n:
        v = grid[i]
        j = i
        while j < n and grid[j] == v and j - i < 255:
            j += 1
        out.append(j - i)
        out.append(v)
        i = j
    return base64.b64encode(bytes(out)).decode("ascii")


def write_png(path, w, h, get_rgb):
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            row.extend(get_rgb(x, y))
        rows.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in rows)
    comp = zlib.compress(raw, 6)

    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))

# ------------------------------------------------------------------- main ---

def main():
    t0 = time.time()
    print(f"[parse] {OSM_PATH}")
    nodes, ways, named, rels = parse_osm(OSM_PATH)
    print(f"[parse] {len(nodes)} nodes, {len(ways)} kept ways, {len(named)} named features ({time.time()-t0:.1f}s)")

    sp = build_spine(ways, nodes)

    roads, bridge_road = extract_roads(sp, ways)
    n_by_cls = defaultdict(int)
    for r in roads:
        n_by_cls[r["cls"]] += 1
    print(f"[roads] {len(roads)} pieces: {dict(n_by_cls)}")
    if bridge_road is None:
        print("[roads] WARNING: Puente colgante way not found — synthesizing later")

    buildings = extract_buildings(sp, ways, roads)
    beaches, waters = extract_areas(sp, ways, rels)
    print(f"[areas] {len(beaches)} beach, {len(waters)} water polys")

    # --- raster surface grid
    grid = bytearray(GRID_COLS * GRID_ROWS)
    barrier = bytearray(GRID_COLS * GRID_ROWS)
    chains = extract_coastlines(sp, ways)
    print(f"[coast] {len(chains)} stitched chains from natural=coastline")
    raster_coast_barrier(barrier, sp, chains, nodes)
    sea_seeds = [sp.to_px(*sp.project_m(to_m(*p))[:2]) for p in PROBE_SEA]
    sea_seeds += [(2, 2), (2, CANVAS_H - 2), (CANVAS_W - 2, 2)]
    flood_water(grid, barrier, sea_seeds)

    # sanity probes before painting details
    def cls_at_geo(ll):
        x, y, _, _ = sp.project(to_m(*ll))
        c, r = int(x / GRID_CELL), int(y / GRID_CELL)
        if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS:
            return grid[r * GRID_COLS + c]
        return -1
    for p in PROBE_LAND:
        if cls_at_geo(p) == CLS_WATER:
            print(f"[WARN] land probe {p} is WATER — coastline leak or spine offset")
    for p in PROBE_SEA:
        if cls_at_geo(p) == CLS_LAND:
            print(f"[WARN] sea probe {p} is LAND")

    land_contours = trace_land_contours(grid)
    for b in beaches:
        raster_fill_poly(grid, [(b[i], b[i + 1]) for i in range(0, len(b), 2)], CLS_BEACH)
    beach_fringe(grid, 3)
    for wpoly in waters:
        raster_fill_poly(grid, [(wpoly[i], wpoly[i + 1]) for i in range(0, len(wpoly), 2)], CLS_WATER)
    for r in roads:
        cls = CLS_PASEO if r["cls"] == "paseo" else \
              CLS_BRIDGE if r.get("bridge") else CLS_ROAD
        raster_stamp_polyline(grid, r["pts"], r["w"], cls)
    if bridge_road:
        raster_stamp_polyline(grid, bridge_road["pts"], bridge_road["w"] + 6, CLS_BRIDGE)

    hist = defaultdict(int)
    for v in grid:
        hist[CLASS_NAMES[v]] += 1
    print(f"[grid] class histogram: {dict(hist)}")

    # --- shore arrays (px) per grid column
    topY, botY = [], []
    for c in range(GRID_COLS):
        t, b = CENTER_Y, CENTER_Y
        for r in range(GRID_ROWS):
            if grid[r * GRID_COLS + c] != CLS_WATER:
                t = r * GRID_CELL
                break
        for r in range(GRID_ROWS - 1, -1, -1):
            if grid[r * GRID_COLS + c] != CLS_WATER:
                b = (r + 1) * GRID_CELL
                break
        topY.append(t)
        botY.append(b)
    def medfilt(a):
        out = list(a)
        for i in range(2, len(a) - 2):
            out[i] = sorted(a[i - 2:i + 3])[2]
        return out
    topY, botY = medfilt(topY), medfilt(botY)

    # --- districts
    bounds_x = []
    for ll in DISTRICT_BOUNDS_GEO:
        x, y, _, _ = sp.project(to_m(*ll))
        bounds_x.append(round(x))
    if bounds_x != sorted(bounds_x):
        raise SystemExit(f"[districts] boundaries not monotonic: {bounds_x}")
    edges = [0] + bounds_x + [CANVAS_W]
    districts = []
    for i, d in enumerate(DISTRICT_DEFS):
        districts.append({**d, "x0": edges[i], "x1": edges[i + 1]})
    print("[districts] " + ", ".join(f"{d['id']}:{d['x0']}-{d['x1']}" for d in districts))

    # --- POI resolution
    def resolve(spec):
        if "osm" in spec:
            cands = [(nm, pm) for nm, pm, tg in named if spec["osm"] in nm]
            if cands:
                if "near" in spec:
                    ref = to_m(*spec["near"])
                elif "ll" in spec:
                    ref = to_m(*spec["ll"])
                else:
                    ref = None
                # prefer candidates inside the corridor, nearest to ref
                def score(cand):
                    s, d, _ = sp.project_m(cand[1])
                    pen = 0 if abs(d) < CORRIDOR_HALF_M else 1e6
                    return pen + (dist(cand[1], ref) if ref else abs(d))
                pm = min(cands, key=score)[1]
                s, d, _ = sp.project_m(pm)
                if abs(d) < CORRIDOR_HALF_M:
                    return pm, "osm"
        if "ll" in spec:
            return to_m(*spec["ll"]), "hand"
        return None, "missing"

    def near_drivable(c, r, reach=3):
        """True if a street/beach cell is within `reach` cells (so a POI pad
        stamped here will merge with the drivable network)."""
        for dr in range(-reach, reach + 1):
            for dc in range(-reach, reach + 1):
                cc, rr = c + dc, r + dr
                if 0 <= cc < GRID_COLS and 0 <= rr < GRID_ROWS and \
                        grid[rr * GRID_COLS + cc] in (CLS_BEACH, CLS_ROAD, CLS_PASEO, CLS_BRIDGE):
                    return True
        return False

    def nudge_to_land(x, y, radius_px=POI_NUDGE_PX, need_drivable=False):
        c0, r0 = int(x / GRID_CELL), int(y / GRID_CELL)
        best = None
        R = radius_px // GRID_CELL
        for dr in range(-R, R + 1):
            for dc in range(-R, R + 1):
                c, r = c0 + dc, r0 + dr
                if 0 <= c < GRID_COLS and 0 <= r < GRID_ROWS and grid[r * GRID_COLS + c] != CLS_WATER:
                    d2 = dc * dc + dr * dr
                    if (best is None or d2 < best[0]) and (not need_drivable or near_drivable(c, r)):
                        best = (d2, c, r)
        if best is None:
            return None
        return ((best[1] + 0.5) * GRID_CELL, (best[2] + 0.5) * GRID_CELL)

    landmarks, failures = [], []
    for spec in LANDMARK_DEFS:
        pm, how = resolve(spec)
        if pm is None:
            failures.append(spec["id"])
            continue
        x, y, _, _ = sp.project(pm)
        x += spec.get("dx", 0)
        y += spec.get("dy", 0)
        pos = nudge_to_land(x, y, need_drivable=(spec["type"] == "kiosk"))
        if pos is None:
            failures.append(spec["id"] + "(water)")
            continue
        landmarks.append({"id": spec["id"], "name": spec["name"], "x": round(pos[0]),
                          "y": round(pos[1]), "type": spec["type"], "district": spec["district"],
                          "_how": how})
    # Customers: nudge to land, then ENFORCE spread so every delivery is a
    # real trip — ≥150px from any kiosk, ≥120px from every other customer.
    MIN_FROM_KIOSK, MIN_BETWEEN = 150, 120
    kiosk_pts = [(l["x"], l["y"]) for l in landmarks if l["type"] == "kiosk"]
    dist_edges = {d["id"]: (d["x0"], d["x1"]) for d in districts}

    def spread_ok(x, y, placed):
        if any((x - kx) ** 2 + (y - ky) ** 2 < MIN_FROM_KIOSK ** 2 for kx, ky in kiosk_pts):
            return False
        return all((x - c["x"]) ** 2 + (y - c["y"]) ** 2 >= MIN_BETWEEN ** 2 for c in placed)

    customers = []
    for spec in CUSTOMER_DEFS:
        x, y, _, _ = sp.project(to_m(*spec["ll"]))
        pos = nudge_to_land(x, y, need_drivable=True)
        if pos is None:
            failures.append(spec["id"] + "(water)")
            continue
        px, py = pos
        if not spread_ok(px, py, customers):
            x0, x1 = dist_edges[spec["district"]]
            found = None
            for rad in range(24, 640, 16):        # expanding ring, nearest wins
                cands = []
                for a in range(0, 360, 20):
                    tx = px + rad * math.cos(math.radians(a))
                    ty = py + rad * math.sin(math.radians(a))
                    if not (x0 + 20 <= tx <= x1 - 20):
                        continue
                    c, r = int(tx / GRID_CELL), int(ty / GRID_CELL)
                    if not (0 <= c < GRID_COLS and 0 <= r < GRID_ROWS):
                        continue
                    if grid[r * GRID_COLS + c] == CLS_WATER or not near_drivable(c, r):
                        continue
                    if spread_ok(tx, ty, customers):
                        cands.append((abs(tx - px) + abs(ty - py), tx, ty))
                if cands:
                    found = min(cands)
                    break
            if found is None:
                failures.append(spec["id"] + "(crowded)")
                continue
            px, py = found[1], found[2]
        customers.append({"id": spec["id"], "name": spec["name"], "x": round(px),
                          "y": round(py), "district": spec["district"], "line": spec["line"]})
    if failures:
        print(f"[poi] WARNING — unplaced (fix geo anchors): {failures}")
    # assert stage refs exist
    lm_ids = {l["id"] for l in landmarks}
    cu_ids = {c["id"] for c in customers}
    for st in STAGES:
        for k in st["kiosks"]:
            if k not in lm_ids:
                failures.append(f"stage {st['id']} kiosk {k}")
        for c in st["customers"]:
            if c not in cu_ids:
                failures.append(f"stage {st['id']} customer {c}")
    for lm in landmarks:
        how = lm.pop("_how")
        print(f"[poi] {lm['id']:<12} ({how:4}) -> {lm['x']},{lm['y']} [{lm['district']}]")

    # --- Muelle (the long pier into the gulf, faithful to muelle-nacional)
    mlm = next(l for l in landmarks if l["id"] == "muellecruc")
    pier_col = min(GRID_COLS - 1, max(0, int(mlm["x"] / GRID_CELL)))
    pier_y0 = botY[pier_col] - 6
    pier = {"x": mlm["x"], "y0": round(pier_y0),
            "y1": round(min(CANVAS_H - 30, pier_y0 + 210)), "w": 16}
    raster_stamp_polyline(grid, [pier["x"], pier["y0"], pier["x"], pier["y1"]],
                          pier["w"], CLS_BRIDGE)
    # connect the pier base to the street grid (walk north to the first road)
    pc = int(pier["x"] // GRID_CELL)
    pr = int(pier_y0 // GRID_CELL)
    for r in range(pr, max(0, pr - 40), -1):
        if grid[r * GRID_COLS + pc] in (CLS_ROAD, CLS_PASEO):
            raster_stamp_polyline(grid, [pier["x"], r * GRID_CELL,
                                         pier["x"], pier["y0"]], 14, CLS_ROAD)
            print(f"[pier] connector road to y={r * GRID_CELL}")
            break
    mlm["x"], mlm["y"] = pier["x"], round(pier_y0 - 16)
    print(f"[pier] muelle at x={pier['x']}, y {pier['y0']}..{pier['y1']}")

    # --- aceras (sidewalks) + plaza pads: these define where you can drive
    # off-street; everything left as CLS_LAND becomes solid cuadra interior
    acera_fringe(grid)
    for lm in landmarks:
        stamp_pad(grid, lm["x"], lm["y"], 40 if lm["type"] == "kiosk" else 24)
    for cu in customers:
        stamp_pad(grid, cu["x"], cu["y"], 28)
    faro_lm = next(l for l in landmarks if l["id"] == "faro")
    stamp_pad(grid, faro_lm["x"], faro_lm["y"], 70)   # La Punta plaza
    acera_cells = sum(1 for v in grid if v == CLS_ACERA)
    print(f"[acera] {acera_cells} sidewalk cells")

    # --- synthetic frontage buildings (fill the cuadras)
    keepouts = []
    for lm in landmarks:
        keepouts.append((lm["x"], lm["y"], 50 if lm["type"] == "kiosk" else 34))
    for cu in customers:
        keepouts.append((cu["x"], cu["y"], 50))
    keepouts.append((pier["x"], pier["y0"], 60))
    synth = synth_buildings(grid, roads, buildings, keepouts)
    print(f"[buildings] +{len(synth)} synthesized along frontages "
          f"(total {len(buildings) + len(synth)})")
    buildings = buildings + synth

    # --- bridge / estuary / decorations
    if bridge_road:
        bp = bridge_road["pts"]
        xs = bp[0::2]
        ys = bp[1::2]
        bx0, bx1 = min(xs), max(xs)
        bcy = sum(ys) / len(ys)
    else:
        pm, _ = resolve({"osm": "puente colgante mata de limón"})
        x, y, _, _ = sp.project(pm)
        bx0, bx1, bcy = x - 80, x + 80, y
        roads.append({"cls": "bridge", "w": ROAD_WIDTH_PX["bridge"],
                      "pts": [round(bx0), round(bcy), round(bx1), round(bcy)]})
        raster_stamp_polyline(grid, roads[-1]["pts"], ROAD_WIDTH_PX["bridge"] + 6, CLS_BRIDGE)
    span = bx1 - bx0
    bridge = {"x0": round(bx0), "x1": round(bx1), "cy": round(bcy), "deckW": 26,
              "towers": [round(bx0 + span * 0.15), round(bx1 - span * 0.15)], "towerH": 70,
              "pts": bridge_road["pts"] if bridge_road else roads[-1]["pts"]}

    # estuary ellipse from the largest water poly near the bridge
    est = None
    for wp in waters:
        pts = [(wp[i], wp[i + 1]) for i in range(0, len(wp), 2)]
        cx, cy = poly_centroid(pts)
        if abs(cx - (bx0 + bx1) / 2) < 900:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            cand = {"cx": round(cx), "cy": round(cy),
                    "rx": round((max(xs) - min(xs)) / 2), "ry": round((max(ys) - min(ys)) / 2)}
            if est is None or cand["rx"] * cand["ry"] > est["rx"] * est["ry"]:
                est = cand
    if est is None:
        est = {"cx": round((bx0 + bx1) / 2 + 300), "cy": CENTER_Y - 120, "rx": 280, "ry": 70}
        print("[estuary] WARNING: no water poly near bridge; synthetic ellipse")

    # mangroves around the estuary
    seed = 57
    def rng():
        nonlocal seed
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280
    mangroves = []
    for a in [i * 0.12 for i in range(int(2 * math.pi / 0.12) + 1)]:
        rx = est["rx"] + 20 + rng() * 26
        ry = est["ry"] + 20 + rng() * 20
        mangroves.append({"x": round(est["cx"] + math.cos(a) * rx),
                          "y": round(est["cy"] + math.sin(a) * ry),
                          "r": round(8 + rng() * 8)})
    for _ in range(10):
        ang = rng() * math.pi * 2
        rr = rng() * est["rx"] * 0.6
        mangroves.append({"x": round(est["cx"] + math.cos(ang) * rr),
                          "y": round(est["cy"] + math.sin(ang) * rr * est["ry"] / max(est["rx"], 1)),
                          "r": round(4 + rng() * 4)})

    # palms: along shores where land is present, plus along the paseo road
    palms = []
    seed = 33
    x = 140.0
    while x < CANVAS_W - 60:
        c = int(x / GRID_CELL)
        if 0 <= c < GRID_COLS and botY[c] - topY[c] > 60:
            palms.append({"x": round(x), "y": round(botY[c] - 12 - rng() * 6),
                          "s": round(0.9 + rng() * 0.4, 2), "sway": round(rng() * 6.28, 2)})
        x += 45 + rng() * 30
    x = 220.0
    while x < CANVAS_W - 60:
        c = int(x / GRID_CELL)
        if 0 <= c < GRID_COLS and botY[c] - topY[c] > 60:
            palms.append({"x": round(x), "y": round(topY[c] + 10 + rng() * 6),
                          "s": round(0.8 + rng() * 0.4, 2), "sway": round(rng() * 6.28, 2)})
        x += 70 + rng() * 60
    for r in roads:
        if r["cls"] != "paseo":
            continue
        p = r["pts"]
        acc = 0.0
        for i in range(0, len(p) - 2, 2):
            seg = math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1])
            n = int((acc + seg) / 60) - int(acc / 60)
            for k in range(n):
                t = ((60 * (int(acc / 60) + k + 1)) - acc) / seg if seg else 0
                t = max(0.0, min(1.0, t))
                palms.append({"x": round(p[i] + (p[i + 2] - p[i]) * t),
                              "y": round(p[i + 1] + (p[i + 3] - p[i + 1]) * t - 20),
                              "s": 1.05, "sway": round(rng() * 6.28, 2)})
            acc += seg

    mata_x0 = next(d["x0"] for d in districts if d["id"] == "mata")
    hills = [{"x0": mata_x0 - 400, "x1": CANVAS_W, "baseY": 250, "color": "#5e8a55"},
             {"x0": mata_x0, "x1": CANVAS_W - 200, "baseY": 200, "color": "#4c7848"}]

    # --- emit
    data = {
        "meta": {"W": CANVAS_W, "H": CANVAS_H, "centerY": CENTER_Y, "cell": GRID_CELL,
                 "pxPerMeter": round(sp.px_per_m, 5), "crossExag": CROSS_EXAG,
                 "spineLenM": round(sp.total), "builtAt": time.strftime("%Y-%m-%d %H:%M")},
        "grid": {"cols": GRID_COLS, "rows": GRID_ROWS, "classes": CLASS_NAMES, "rle": rle_encode(grid)},
        "topY": topY, "botY": botY,
        "roads": roads,
        "buildings": buildings,
        "landPolys": land_contours,
        "beaches": beaches,
        "waters": waters,
        "mangroves": mangroves,
        "palms": palms,
        "hills": hills,
        "districts": [{k: v for k, v in d.items()} for d in districts],
        "landmarks": landmarks,
        "customers": customers,
        "stages": STAGES,
        "bridge": bridge,
        "estuary": est,
        "pier": pier,
    }
    js = "// GENERATED by tools/build_world.py — do not edit by hand.\n" \
         "window.WORLD_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(js)
    size = os.path.getsize(OUT_PATH)
    print(f"[emit] {OUT_PATH} — {size/1024:.0f} KB")
    if size > 2 * 1024 * 1024:
        print("[emit] WARNING: over 2 MB budget")

    # --- debug renders
    if "--debug" in sys.argv or True:
        pal = {CLS_WATER: (42, 127, 168), CLS_LAND: (232, 213, 160), CLS_BEACH: (244, 215, 122),
               CLS_ROAD: (58, 53, 64), CLS_PASEO: (240, 138, 93), CLS_BRIDGE: (140, 140, 140),
               CLS_ACERA: (206, 199, 178)}
        bldg_overlay = bytearray(GRID_COLS * GRID_ROWS)
        for b in buildings:
            raster_fill_poly(bldg_overlay, [(b["pts"][i], b["pts"][i + 1])
                                            for i in range(0, len(b["pts"]), 2)], 1)
        marks = {}
        for lm in landmarks:
            marks[(int(lm["x"] / GRID_CELL), int(lm["y"] / GRID_CELL))] = (255, 0, 0)
        for cu in customers:
            marks[(int(cu["x"] / GRID_CELL), int(cu["y"] / GRID_CELL))] = (255, 0, 255)
        ticks = set()
        for bx in bounds_x:
            ticks.add(int(bx / GRID_CELL))

        def rgb(x, y):
            if (x, y) in marks:
                return marks[(x, y)]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if (x + dx, y + dy) in marks:
                        return marks[(x + dx, y + dy)]
            if x in ticks and y % 4 < 2:
                return (0, 0, 0)
            if bldg_overlay[y * GRID_COLS + x]:
                return (156, 102, 68)
            return pal[grid[y * GRID_COLS + x]]

        write_png(DEBUG_PNG, GRID_COLS, GRID_ROWS, rgb)
        print(f"[debug] {DEBUG_PNG}")

        # svg: vector features
        cls_color = {"trunk": "#d33", "trunk_link": "#d66", "primary": "#e80",
                     "primary_link": "#e80", "secondary": "#ca0", "tertiary": "#aa0",
                     "tertiary_link": "#aa0", "residential": "#666", "unclassified": "#666",
                     "living_street": "#888", "service": "#bbb", "pedestrian": "#3a3",
                     "paseo": "#f08a5d", "bridge": "#a0f"}
        parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS_W} {CANVAS_H}" '
                 f'style="background:#2a7fa8">']
        for lp in land_contours:
            d = "M" + " L".join(f"{lp[i]},{lp[i+1]}" for i in range(0, len(lp), 2)) + " Z"
            parts.append(f'<path d="{d}" fill="#e8d5a0" stroke="#8a6" stroke-width="3"/>')
        for wp in waters:
            d = "M" + " L".join(f"{wp[i]},{wp[i+1]}" for i in range(0, len(wp), 2)) + " Z"
            parts.append(f'<path d="{d}" fill="#2a7fa8" opacity="0.9"/>')
        for b in buildings:
            p = b["pts"]
            d = "M" + " L".join(f"{p[i]},{p[i+1]}" for i in range(0, len(p), 2)) + " Z"
            parts.append(f'<path d="{d}" fill="#997" opacity="0.7"/>')
        for r in roads:
            p = r["pts"]
            d = "M" + " L".join(f"{p[i]},{p[i+1]}" for i in range(0, len(p), 2))
            parts.append(f'<path d="{d}" fill="none" stroke="{cls_color[r["cls"]]}" '
                         f'stroke-width="{r["w"]}" stroke-linecap="round" opacity="0.85"/>')
        spine_px = [sp.to_px(s, 0) for s in [i * 100 for i in range(int(sp.total / 100))]]
        d = "M" + " L".join(f"{round(x)},{round(y)}" for x, y in spine_px)
        parts.append(f'<path d="{d}" fill="none" stroke="red" stroke-width="4" stroke-dasharray="20 14"/>')
        for bx in bounds_x:
            parts.append(f'<line x1="{bx}" y1="0" x2="{bx}" y2="{CANVAS_H}" stroke="#000" stroke-width="3" stroke-dasharray="8 10"/>')
        for lm in landmarks:
            parts.append(f'<circle cx="{lm["x"]}" cy="{lm["y"]}" r="12" fill="red"/>'
                         f'<text x="{lm["x"]+14}" y="{lm["y"]}" font-size="26">{lm["id"]}</text>')
        parts.append("</svg>")
        with open(DEBUG_SVG, "w", encoding="utf-8") as f:
            f.write("\n".join(parts))
        print(f"[debug] {DEBUG_SVG}")

    print(f"[done] total {time.time()-t0:.1f}s")
    if failures:
        raise SystemExit(f"[poi] BUILD INCOMPLETE — unresolved: {failures}")


if __name__ == "__main__":
    main()
