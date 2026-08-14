"""World CONTENT — the hand-authored tables the pipeline places on the map.

Districts, landmarks, customers and stages: what the game is ABOUT, as opposed
to config.py, which is how the map is drawn. Anchors are geo (`ll`) so they
survive any change to the projection, and the build FAILS listing any POI it
cannot resolve rather than quietly dropping it.

This is also the data a future management API would edit — which is why it is
its own module and not buried in the builder.
"""
import json
import os

from .config import ROOT


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
    (9.97620, -84.84930),  # faro | carmen (west of the ferry terminal, which is Carmen)
    (9.97550, -84.84050),  # carmen | paseo
    (9.97700, -84.83182),  # paseo | centro  (east so the Paseo boardwalk kiosks fall in paseo)
    (9.97820, -84.82900),  # centro | playitas (west of the Playitas place node -84.8274 + Estadio)
    # EL COCAL EMPIEZA DONDE SE ACABA EL ASFALTO. Its west edge used to sit at
    # -84.82200 (x 21625), a block or so east of where the town actually stops:
    # the westernmost barro street is x 20936, and Calle 14 — the last paved
    # calle, and the one that joins the Paseo to Avenida Centenario — stands at
    # x 20957. Moving the seam onto that line is what makes the barrio read as
    # the unpaved one, and it is where the closure sign now stands.
    (9.97900, -84.82512),  # playitas | cocal (the barro seam at Calle 14, x≈20940)
    # …Y SE ACABA EN LA ANGOSTURA. It used to run to -84.72550 (x 42785), a
    # 21,000 px band that swallowed Chacarita and El Roble whole — El Cocal is a
    # BARRIO, not a third of the map. See COCAL_END_X for the measurement.
    (9.96000, -84.79293),  # cocal | mata (the Angostura, x≈28000)
    (9.91950, -84.71250),  # mata | caldera (between village and port)
]

# Inland barrios (planar map only — the corridor-unroll can't place them). Each
# is a real OSM place node; `bbox` is a lat/lon rectangle used only to draw the
# region + minimap label — classification (districtAt) is by nearest kiosk/POI
# centroid, so exact rings aren't needed. West→east along Ruta 1 / the coast.
INLAND_DISTRICT_DEFS = [
    {"id": "chacarita", "name": "CHACARITA",      "short": "Chacarita", "tone": "#b0b483",
     "geo": (9.98061, -84.77368), "bbox": (9.9690, -84.7900, 9.9930, -84.7580)},
    {"id": "elroble",   "name": "EL ROBLE",       "short": "El Roble",  "tone": "#9ec4a0",
     "geo": (9.98067, -84.73602), "bbox": (9.9700, -84.7560, 9.9930, -84.7250)},
    {"id": "barranca",  "name": "BARRANCA",       "short": "Barranca",  "tone": "#c7b98a",
     "geo": (9.98840, -84.71094), "bbox": (9.9640, -84.7250, 9.9990, -84.6960)},
    {"id": "esparza",   "name": "ESPARZA",        "short": "Esparza",   "tone": "#d6a97e",
     "geo": (9.99183, -84.66587), "bbox": (9.9760, -84.6860, 10.0120, -84.6440)},
]

# landmarks: same ids as the GDD / previous world.js. Resolution: "osm" is a
# case-insensitive substring matched against named OSM features (nearest to
# "near" wins when multiple match); "ll" is a hand-placed fallback/override.
LANDMARK_DEFS = [
    # La Punta (see how-look-puntarenas/faro.jpg): the lighthouse stands on the
    # rocky tip OUTSIDE the road loop (left of Calle 39), with the Balneario
    # Municipal pool inside the loop on the other side of the street.
    {"id": "faro",        "name": "El Faro",                    "type": "lighthouse",   "district": "faro",     "osm": "faro de la punta", "dx": -12, "dy": 138},
    # the big lagoon pool sits IN FRONT of (just north of / town-side of) the
    # faro, inside the road loop — roughly aligned on x with the lighthouse
    {"id": "balneario",   "name": "Balneario Municipal",        "type": "pool",         "district": "faro",     "osm": "faro de la punta", "dx": 138, "dy": 12},
    # a churchill kiosk beside the lighthouse plaza (east of the faro, clear of it)
    {"id": "kios_faro",   "name": "Churchill La Punta",         "type": "kiosk",        "district": "faro",     "osm": "faro de la punta", "dx": 106, "dy": 131},
    # The cruise pier juts out from the END of Calle Central, right beside the
    # churchill kiosks on the Paseo (dx nudges the geo anchor onto that street)
    # dx 680 is a CORRIDOR-space nudge; the planar pier re-anchors to the real
    # Calle Central south end (planar_muelle_axis), so it never sees this dx.
    {"id": "muellecruc",  "name": "Muelle de Cruceros",         "type": "cruise",       "district": "paseo",    "osm": "muelle de cruceros", "ll": (9.97450, -84.83450), "dx": 850},
    {"id": "ferrycr",     "name": "Terminal de Ferry",          "type": "ferry",        "district": "carmen",   "osm": "terminal de ferry puntarenas"},
    {"id": "playa",       "name": "Playa Puntarenas",           "type": "beachsign",    "district": "carmen",   "ll": (9.97500, -84.84300)},
    {"id": "carmenig",    "name": "Iglesia del Carmen",         "type": "church",       "district": "carmen",   "osm": "iglesia del carmen", "ll": (9.97650, -84.84400)},
    {"id": "tioga",       "name": "Hotel Tioga",                "type": "hotel",        "district": "paseo",    "osm": "tioga", "ll": (9.97500, -84.83600)},
    # pushed SOUTH off the street to the MIDPOINT between the Paseo and the
    # sand front (PINNED_KIOSKS keeps them there — no frontage re-seat)
    {"id": "kios_paseo1", "name": "Kiosco Doña Lela",           "type": "kiosk",        "district": "paseo",    "osm": "kioscos paseo de los turistas", "dx": -75, "dy": 100},
    {"id": "kios_paseo2", "name": "Churchill El Mariachi",      "type": "kiosk",        "district": "paseo",    "osm": "kioscos paseo de los turistas", "dx": 75, "dy": 100},
    {"id": "casafait",    "name": "Casa Fait",                  "type": "house",        "district": "paseo",    "osm": "casa fait", "ll": (9.97700, -84.82900)},
    {"id": "parquemar",   "name": "Parque Marino del Pacífico", "type": "park",         "district": "playitas", "osm": "parque marino", "ll": (9.97600, -84.82300)},
    # THE MERCADO'S MANZANA, BY NAME. The OSM node sits on Calle 2's kerb, and
    # the generic "step a building landmark into the nearest cuadra interior"
    # then carried it 170 px SOUTH-WEST, across the calle into the next block:
    # the market's own manzana is esplanade, acera and fish muelle rather than
    # cuadra interior, so the snapper looked straight past it. `block` names the
    # four streets that bound it instead (the "place a structure on a named
    # street-grid cuadra" recipe) and seats the POI on that ground; a landmark
    # that carries one is exempt from the snap, its cuadra being already known.
    {"id": "mercado",     "name": "Mercado Central",            "type": "market",       "district": "centro",   "osm": "mercado municipal de puntarenas",
     "block": {"calles": (["Calle 2 Presbíterio Florencio del Castillo", "Calle 2"], ["Calle 4"]),
               "ave_north": ["Avenida 5"],
               "ave_south": ["Avenida 3 Filiberto Sinfontes", "Avenida 3"]}},
    {"id": "pali",        "name": "Supermercado Palí",          "type": "super",        "district": "centro",   "osm": "palí", "ll": (9.97650, -84.82900)},
    # The civic block row between Av Central and Av 1 (calles 3-7): catedral on
    # the west cuadra, Casa de la Cultura on the east. Anchors = the real OSM
    # building nodes so the name search can't drift to the Bulevar. (The Museo
    # Histórico Marino IS the Casa de la Cultura building — one landmark, no
    # separate "museo" icon.)
    {"id": "catedral",    "name": "Catedral de Puntarenas",     "type": "cathedral",    "district": "centro",   "osm": "catedral", "near": (9.97762, -84.83486)},
    {"id": "cultura",     "name": "Casa de la Cultura",         "type": "civic",        "district": "centro",   "osm": "casa de la cultura elsie", "near": (9.97765, -84.83404), "ll": (9.97765, -84.83404)},
    {"id": "kios_centro", "name": "Kiosco La Porteña",          "type": "kiosk",        "district": "centro",   "ll": (9.97480, -84.83000)},
    # Estadios: position comes from the named street grid at build (place_stadium):
    # Lito Pérez at Calle 15-17 x Avenida 0-2; Las Playitas at Calle 6-8 x Avenida 1.
    # The ll anchors are only fallbacks if a street name fails to resolve.
    {"id": "estadio",         "name": "Estadio Lito Pérez",    "type": "stadium",      "district": "carmen",   "ll": (9.97680, -84.83880)},
    # Open green field, no graderías — it reads as a plaza, not a stadium
    {"id": "estadio_playitas","name": "Plaza Las Playitas",    "type": "stadium",      "district": "playitas", "ll": (9.97960, -84.82520)},
    {"id": "kios_play",   "name": "Kiosco Playitas",            "type": "kiosk",        "district": "playitas", "ll": (9.97840, -84.82640)},
    {"id": "yatch",       "name": "Yacht Club",                 "type": "marina",       "district": "cocal",    "osm": "yacht", "ll": (9.97900, -84.81200)},
    # anchor monument on the island where the road splits into the Cocal (west
    # side, not the estero end) — placed by world xy read off the 📍 overlay
    {"id": "cocal_park",  "name": "Parque El Cocal",            "type": "park",         "district": "cocal",    "ll": (9.97950, -84.79500)},
    {"id": "kios_cocal",  "name": "Kiosco El Cocal",            "type": "kiosk",        "district": "cocal",    "ll": (9.98100, -84.79400)},
    # far-east Cocal soda so Stage 5 has a pickup beside its Ruta 17 customers
    # EN EL COCAL, NO EN EL ROBLE. This sat at -84.74150 (x 39850) — 12,000 px
    # past the Angostura, on the mainland — and it was only ever tagged `cocal`
    # because the barrio's band used to reach that far. Two things went wrong
    # from it: `districtAt` averages a district's POIs, so El Cocal's centroid
    # was dragged to x≈33500, and stage 6 spawns at this kiosk, which is why
    # "Tormenta en El Cocal" dropped you next to El Roble. It stands on Ruta 17
    # inside the barrio now, where the name always said it was.
    {"id": "kios_cocal2", "name": "Soda Ruta 17",               "type": "kiosk",        "district": "cocal",    "ll": (9.98109, -84.81390)},
    {"id": "puente",      "name": "Puente de Mata de Limón",    "type": "bridge",       "district": "mata",     "osm": "puente colgante mata de limón"},
    {"id": "kios_mata",   "name": "Kiosco Mata de Limón",       "type": "kiosk",        "district": "mata",     "ll": (9.92250, -84.70850)},
    {"id": "leda",        "name": "Marisquería Leda",           "type": "restaurant",   "district": "mata",     "osm": "leda", "ll": (9.92350, -84.70780)},
    {"id": "matalimon",   "name": "Estero Mata de Limón",       "type": "estuary",      "district": "mata",     "osm": "estero mata de limón"},
    {"id": "caldera_blvd","name": "Caldera Bulevar",            "type": "sign",         "district": "caldera",  "ll": (9.91800, -84.71300)},
    # a soda by the port so Stage 7 picks up beside its Caldera customers
    {"id": "kios_caldera","name": "Soda del Puerto",            "type": "kiosk",        "district": "caldera",  "ll": (9.91300, -84.71600)},
    {"id": "tren",        "name": "Estación Tren Caldera",      "type": "trainstation", "district": "caldera",  "osm": "estación tren", "ll": (9.91500, -84.71500)},
    {"id": "puerto",      "name": "Puerto de Caldera",          "type": "port",         "district": "caldera",  "osm": "puerto internacional caldera"},
    {"id": "villach",     "name": "Villa Champán",              "type": "village",      "district": "caldera",  "ll": (9.91600, -84.71250)},
    {"id": "ruta27",      "name": "Ruta 27 · Autopista",        "type": "highway",      "district": "caldera",  "ll": (9.91000, -84.71000)},
    # inland barrio kiosks (planar full map) — pickups across the mainland towns.
    # ll at each OSM place node; snapped to the nearest drivable road at build.
    {"id": "kios_chac",   "name": "Soda Chacarita",             "type": "kiosk",        "district": "chacarita","ll": (9.98061, -84.77368), "snap_road": 1},
    {"id": "kios_roble",  "name": "Churchill El Roble",         "type": "kiosk",        "district": "elroble",  "ll": (9.98067, -84.73602), "snap_road": 1},
    {"id": "kios_barr",   "name": "Kiosco Barranca",            "type": "kiosk",        "district": "barranca", "ll": (9.98840, -84.71094), "snap_road": 1},
    {"id": "kios_esp",    "name": "Churchill Esparza",          "type": "kiosk",        "district": "esparza",  "ll": (9.99183, -84.66587), "snap_road": 1},
]

# Parque Marino source identity + facility labels. The exact park polygon and
# its eight building footprints come from OSM, but none of those buildings has
# a `name`; only 911250911 is typed `building=train_station`. Never number them
# by enumeration again: that order changes whenever a footprint is added.
#
# The public labels below are real on-site facilities documented by the
# Fundación PMP / UNA (La Gaceta 2007LA-000001-FPMP; current UNA Acuario, CRRAM
# and LABM pages). OSM has no footprint-level names, so their assignment is an
# explicit, stable map interpretation keyed to OSM IDs—not a claim that OSM
# supplied those names, and never an enumeration-dependent "Parque Marino N".
MARINE_SITE_OSM_ID = 316422305
MARINE_BUILDING_NAMES = {
    911250909: "Módulo Productivo · LABM",
    911250910: "Recepción de Visitantes",
    911250911: "Antigua Estación del Ferrocarril",
    911250912: "Acuario · Sala de Exhibiciones Temporales",
    911250913: "Centro de Rescate · CRRAM",
    911250914: "Boletería",
    911250915: "Servicios Sanitarios",
    911250916: "Oficinas Administrativas",
}


CUSTOMER_DEFS = [
    {"id": "c1",  "name": "Don Beto, pescador",     "district": "carmen",   "line": "¡Antes que se derrita!",       "ll": (9.97700, -84.84700)},
    {"id": "c2",  "name": "Crucerista alemana",     "district": "carmen",   "line": "Eine Churchill, bitte!",       "ll": (9.97600, -84.84550)},
    {"id": "c3",  "name": "Carnaval troupe",        "district": "paseo",    "line": "Para toda la comparsa.",       "ll": (9.97450, -84.83300)},
    {"id": "c4",  "name": "Familia tica",           "district": "paseo",    "line": "Cuatro, con leche extra.",     "ll": (9.97470, -84.83100)},
    {"id": "c5",  "name": "Surfista canadiense",    "district": "paseo",    "line": "Make it extra red, dude.",     "ll": (9.97420, -84.83550)},
    {"id": "c6",  "name": "Padre Ramírez",          "district": "centro",   "line": "Bendito churchill.",           "ll": (9.97760, -84.83128)},
    {"id": "c7",  "name": "Vendedor de ceviche",    "district": "centro",   "line": "Te cambio uno por ceviche.",   "ll": (9.97700, -84.83100)},
    {"id": "c8",  "name": "Doña del mercado",       "district": "centro",   "line": "Rojito bien fuerte.",          "ll": (9.97965, -84.82932)},
    {"id": "c9",  "name": "Niño con bici",          "district": "playitas", "line": "¡El mío con piña!",            "ll": (9.97720, -84.82800)},
    {"id": "c10", "name": "Equipo de fútbol",       "district": "playitas", "line": "Once. Es broma. Tres.",        "ll": (9.97880, -84.82620)},
    {"id": "c11", "name": "Doña del rocking chair", "district": "playitas", "line": "Como en los años 80.",         "ll": (9.97740, -84.82450)},
    # el yatista espera cerca del ferry (Playitas quedó llena: banda angosta,
    # kiosk+c9+c10 cubren todo el spread — no cabe un 4º cliente)
    {"id": "c12", "name": "Yatista gringo",         "district": "carmen",   "line": "Best churchill ever, man.",    "ll": (9.97680, -84.84200)},
    # --- extra porteño clientes so free-roam orders don't repeat (open area;
    # placed in the roomier carmen/paseo bands — centro/playitas are tight) ---
    {"id": "c19", "name": "Marinero del muelle",    "district": "carmen",   "line": "Con hielo bien menudito.",     "ll": (9.97700, -84.84780)},
    {"id": "c20", "name": "Capitán del ferry",      "district": "carmen",   "line": "Uno para el capitán.",         "ll": (9.97560, -84.84520)},
    {"id": "c21", "name": "Casera del barrio",      "district": "carmen",   "line": "El clásico de siempre.",       "ll": (9.97760, -84.84350)},
    {"id": "c22", "name": "Bailarina de comparsa",  "district": "paseo",    "line": "¡La mía sin tanto rojo!",      "ll": (9.97400, -84.83680)},
    {"id": "c23", "name": "Mesero del Kalúa",       "district": "paseo",    "line": "Para la mesa del rincón.",     "ll": (9.97430, -84.83380)},
    {"id": "c24", "name": "Surfista italiano",      "district": "paseo",    "line": "Doble rojo, per favore.",      "ll": (9.97460, -84.83120)},
    # stage 6's two customers, moved into El Cocal with its kiosk — same reason
    {"id": "c13", "name": "Pareja en mirador",      "district": "cocal",    "line": "Para ver el atardecer.",       "ll": (9.98028, -84.81846)},
    {"id": "c14", "name": "Camionero de Ruta 17",   "district": "cocal",    "line": "Rápido, voy pa' Caldera.",     "ll": (9.98154, -84.80387)},
    {"id": "c15", "name": "Pescadores del estero",  "district": "mata",     "line": "Justo antes de la lluvia.",    "ll": (9.92600, -84.71000)},
    {"id": "c16", "name": "Cocineros de Leda",      "district": "mata",     "line": "Postre para los clientes.",    "ll": (9.92350, -84.70780)},
    {"id": "c17", "name": "Maquinista del tren",    "district": "caldera",  "line": "El tren no espera a nadie.",   "ll": (9.91450, -84.71550)},
    {"id": "c18", "name": "Estibador del Puerto",   "district": "caldera",  "line": "Rapidito, ando en turno.",     "ll": (9.91080, -84.71680)},
]

# story stages — verbatim from the previous world.js (ids referenced by engine/ui)
STAGES = [
    {"id": "s1", "num": 1, "name": "El Faro", "district": "carmen",
     "brief": "Repartí el primer pedido del día. Llegan cruceros — los gringos quieren probar el dichoso Churchill.",
     "kiosks": ["kios_faro"], "targetDeliveries": 3, "timeLimit": 115, "weather": "sunny",
     "customers": ["c1", "c2"], "unlock": "paseo"},
    {"id": "s2", "num": 2, "name": "Paseo de los Turistas", "district": "paseo",
     "brief": "El boulevard está lleno. Atravesá la peatonal esquivando turistas y comparsas de carnaval.",
     "kiosks": ["kios_paseo1", "kios_paseo2"], "targetDeliveries": 4, "timeLimit": 150, "weather": "sunny",
     "customers": ["c3", "c4", "c5"], "unlock": "centro"},
    {"id": "s3", "num": 3, "name": "Mercado y Catedral", "district": "centro",
     "brief": "Las calles del centro son angostas y el tráfico no perdona. Ojo con los gatos — y el Padre Ramírez no es de esperar.",
     "kiosks": ["kios_centro", "kios_paseo2"], "targetDeliveries": 4, "timeLimit": 165, "weather": "sunny",
     "customers": ["c6", "c7", "c8", "c9"], "unlock": "playitas"},
    {"id": "s4", "num": 4, "name": "Atardecer en Las Playitas", "district": "playitas",
     "brief": "Atardece sobre el Yacht Club. Abrí gas por la Ruta 17, pero cuidado: el equipo de fútbol anda entrenando.",
     "kiosks": ["kios_play", "kios_centro"], "targetDeliveries": 5, "timeLimit": 175, "weather": "sunset",
     "customers": ["c10", "c11", "c12"], "unlock": "cocal"},
    {"id": "s5", "num": 5, "name": "Tormenta en El Cocal", "district": "cocal",
     "brief": "Cayó el aguacero y el asfalto resbala. Llegá a la Ruta 17 antes de que la tormenta empeore.",
     "kiosks": ["kios_cocal2"], "targetDeliveries": 5, "timeLimit": 200, "weather": "storm",
     "customers": ["c13", "c14"], "unlock": "mata"},
    {"id": "s6", "num": 6, "name": "Puente · Mata de Limón", "district": "mata",
     "brief": "Cruzá el puente colgante sobre el estero. Llegá al kiosco de Mata de Limón y a la Marisquería Leda.",
     "kiosks": ["kios_mata"], "targetDeliveries": 4, "timeLimit": 150, "weather": "night",
     "customers": ["c15", "c16"], "unlock": "mata"},
    {"id": "s7", "num": 7, "name": "Caldera · Final", "district": "caldera",
     "brief": "Por la Ruta 27 hasta el Puerto de Caldera. Ya sale el sol — una última entrega y se acaba la jornada.",
     "kiosks": ["kios_caldera", "kios_mata"], "targetDeliveries": 4, "timeLimit": 215, "weather": "sunny",
     "customers": ["c17", "c18"], "unlock": "caldera"},
]

# Civic furniture on the parcels the MAP produces. `place_osm_sites` derives one
# parcel per OSM ground site, and OSM records the site but not what stands in it:
# there is no node for the old round kiosco in the middle of Parque Victoria, the
# way every parque central in the country has one. So it is declared here by
# parcel id — the same thing the civic block does inline with `river`, `statue`
# and `bus`, for a block whose parts are not hand-written.
#
# The id is `osm_<kind>_<osm way id>`, which is stable across rebuilds because
# the OSM id is.
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

# ---------------------------------------------------------------------------
# LANCHAS. The gulf ferries sail OUT AND BACK because the real crossing ends on
# the Nicoya side, where this world has no shore to arrive at. The estero has
# one: Pitahaya, on the north coast, whose streets the build already emits and
# which no road on the spit can reach — it is a 160k-cell island in the
# reachability gate. A lancha is how you get there, which is how you get there
# in life too.
#
# The far landing is geo-authored. The Puntarenas berth names its generated
# pier instead: the lancha service resolves the pier's sea end after placement,
# so the berth MOVES WITH THE MUELLE — when the pier went from Calle Central's
# (wrong) axis to the north end of Calle 2, the crossing re-derived itself and
# nothing here had to change. The sailing line is likewise derived
# by a flood over the water raster, so the boat can never cross land and the
# route follows the coastline it is actually given.
# ---------------------------------------------------------------------------
# The crossing is a STAGE, not a side mode: it lives in the level list so the
# game has something other than a delivery in it, and so it is unlocked, briefed
# and scored like everything else. `kind` is what makes it one — no kiosks, no
# customers, no deliveries; the level is the passage itself.
#
# `after` IS WHERE IT SITS IN THE LADDER, and it is authored because appending
# it put the one level that is not a delivery behind all seven that are — nobody
# saw it without finishing the game. It follows `s3` (Mercado y Catedral)
# because that is the CENTRO stage, and the lancha leaves from the Muelle de
# Pitahaya at the foot of Calle Central, in centro: you learn the district, then
# you sail out of it.
#
# `num` is NOT authored. It is the position in the final order, computed at
# emit — a hand-written number is one insertion away from disagreeing with the
# list it labels.
CROSSING_STAGES = [
    {
        "id": "s8", "after": "s3", "kind": "crossing", "ferry": "pitahaya",
        "name": "Travesía del Estero", "district": "centro",
        # THE BRIEF HAS TO MATCH THE LEVEL, and this one stopped doing so twice
        # over: it promised "tres golpes y se hunde" when the hull now recovers
        # a knock every two boyas and only the clock can end the run, and it
        # never mentioned the yates or the impulso, which are the two things a
        # player most needs to be told about before the first bend.
        "brief": ("Llevá la lancha hasta Pitahaya siguiendo las boyas. Esquivá "
                  "las pangas, los yates y las redes de los pescadores — rozalos "
                  "de cerca y ganás impulso. Cruzá los cardúmenes: el que llega "
                  "con peces, llega mejor."),
        "kiosks": [], "customers": [], "targetDeliveries": 0,
        # 225 s was reasoned off a route the build logged as "8.88 km", which
        # was 14 214 px divided by 1.6 px/m — the scale from before the rescale
        # to 2.5. It is 5,7 km. At the lancha taxi's ~305 px/s that is ~47 s of
        # running, so 150 s plus ~15 boyas x 6 s is generous without being idle.
        "timeLimit": 150, "weather": "sunny", "unlock": None,
    },
]

LANCHA_DEFS = [
    {
        "id": "pitahaya",
        "name": "Lancha a Pitahaya",
        "berth_pier": "muelle_pitahaya",
        "landing": (10.02539, -84.82923),   # Calle Pitahaya, on the far shore
        "deck": (86, 34),                   # smaller than a ferry: one car deep
        "dockS": 20,
        # 5,7 km of estero at 150 px/s is a 95 s passage for the AI lancha (the
        # player sails her own hull and is faster). The ferry's 82 px/s would
        # make it nearly three minutes of open water with nothing to do.
        # It said "~7.1 km" here for a long time: the build's own log divided
        # the route by 1.6 px/m, the scale before the rescale to 2.5, and every
        # number reasoned off that line inherited the error.
        "speed": 150,
    },
]

# ---------------------------------------------------------------------------
# BEACH ACCESSES. The sand is drivable (`Surface.DRIVABLE` has always said so),
# but a cuadra's acera ring is a wall, so a beach with a sidewalk between it and
# the street can be seen and never entered. Each of these paves a short apron
# THROUGH that ring — the same recipe as a kiosk connector — so there is a way
# down onto the sand you can find without hunting for a gap.
# ---------------------------------------------------------------------------
# LAS ATRACCIONES DEL MALECÓN — the turno that lives on the Paseo.
#
# Geo-anchored like every other POI (a px anchor on this coast survives exactly
# until the next rescale), and snapped onto whatever promenade the build
# actually produced. `r` is the drawn radius; nothing here is stamped as a wall,
# because the band is 60 px deep and it is the only way to the Paseo kiosks.
#
# `dj` is the odd one out: it is not seated on the malecón but on the FRONTAGE
# of the restaurant it plays outside, and `host` names that real OSM building.
# ---------------------------------------------------------------------------
# WHERE THE SEA FRONT ENDS. The malecón follows both paseos east, and the
# Parque Marino's cuadra is where the waterfront stops being one: past it León
# Cortés turns inland and becomes an ordinary avenida. Geo-anchored like every
# other limit on this coast, so a rescale cannot walk it up the beach — only
# the LONGITUDE is read.
MALECON_EAST_LL = (9.97747, -84.82532)

# EL CAMPO FERIAL — one lot, not four rides strung out over 900 metres.
#
# The rides used to be geo-anchored one by one, 750 px apart along the sea
# front: a carrusel, then a quarter of a kilometre of empty promenade, then the
# chocones. Each was in a plausible place and together they were not a feria at
# all — a turno is a FIELD you walk into, packed, loud, with the chinamos down
# one side and the rueda over the top of everything.
#
# So the lot is the authored thing and the rides are laid out INSIDE it, in its
# own frame. It is seated on the frontage of La Takería exactly as DJ Urtech
# is — he plays at the edge of the fairground, which is why he was put there —
# and stamped as `Surface.BARRO`: a Costa Rican campo ferial is packed earth,
# and the game already has that surface with its own look and its own grip.
FERIA_DEF = {
    "id": "feria_paseo",
    "name": "Campo Ferial del Paseo",
    "host": "La Takería",     # seated on its frontage, like the DJ
    "w": 560, "h": 200,       # the lot, in px, in the Paseo's own frame
}

# The roster is the one that actually comes to a Costa Rican turno — Zapote,
# Palmares, the Carnaval de Puntarenas. `at` is now (u, v) IN THE LOT'S FRAME:
# u runs along the coast, v runs seaward, both from the lot's centre.
ATTRACTION_DEFS = [
    # --- la fila de atrás: the big ones, seen from down the Paseo
    {"id": "rueda", "name": "La Rueda de Chicago", "kind": "rueda",
     "at": (-232, -22), "r": 34},
    {"id": "pulpo", "name": "El Pulpo", "kind": "pulpo",
     "at": (-142, -26), "r": 30},
    {"id": "martillo", "name": "El Martillo", "kind": "martillo",
     "at": (-46, -28), "r": 27},
    {"id": "sillas", "name": "Las Sillas Voladoras", "kind": "sillas",
     "at": (44, -26), "r": 26},
    {"id": "terror", "name": "La Casa del Terror", "kind": "terror",
     "at": (140, -26), "r": 27},
    {"id": "carrusel", "name": "El Carrusel", "kind": "carrusel",
     "at": (232, -24), "r": 26},
    # --- la fila de adelante
    {"id": "tagada", "name": "La Tagada", "kind": "tagada",
     "at": (-206, 52), "r": 30},
    {"id": "chocones", "name": "Los Chocones", "kind": "chocones",
     "at": (-110, 54), "r": 32},
    {"id": "barco", "name": "El Barco Pirata", "kind": "barco",
     "at": (-10, 52), "r": 29},
    {"id": "gusano", "name": "El Gusanito", "kind": "gusano",
     "at": (80, 54), "r": 23},
    {"id": "argollas", "name": "Tiro al Blanco", "kind": "argollas",
     "at": (158, 54), "r": 21},
    {"id": "tombola", "name": "La Tómbola", "kind": "tombola",
     "at": (228, 54), "r": 19},
    # --- LOS CHINAMOS. The food, along the landward edge, which is where it
    # always is — you pass it going in and again coming out.
    #
    # THEY ARE CONTIGUOUS ON PURPOSE. Photographs of the real row on the Paseo
    # show one continuous building: a shared frame, one long roof, and the
    # printed banners running unbroken from one stall to the next. Spaced out,
    # three booths read as three booths. Butted together at `r = 44` — the
    # module draws 1.9·r wide, so 84 px of pitch closes the seam — they read as
    # the row they are.
    {"id": "chin_canton", "name": "Arroz Cantonés", "kind": "chinamo",
     "at": (-84, -74), "r": 44, "food": "canton"},
    {"id": "chin_manzanas", "name": "Manzanas Escarchadas", "kind": "chinamo",
     "at": (0, -74), "r": 44, "food": "manzana"},
    {"id": "chin_churros", "name": "Churros Rellenos", "kind": "chinamo",
     "at": (84, -74), "r": 44, "food": "churro"},
    # DJ Urtech, en vivo frente a La Takería. The sound is procedural and
    # proximity-driven (sfx.dj), so this is the point the music comes from.
    # He is NOT in the lot's frame: he is on the restaurant's own sidewalk,
    # which is the far side of the promenade from the rides.
    {"id": "dj_urtech", "name": "DJ Urtech", "kind": "dj",
     "at": (9.97495, -84.84405), "r": 20, "host": "La Takería"},
]

BEACH_ACCESS_DEFS = [
    {"id": "muelle_oeste", "name": "Bajada Muelle Oeste",
     "at": (9.97481, -84.83187), "w": 34},   # west of the Muelle de Cruceros
    {"id": "muelle_este", "name": "Bajada Muelle Este",
     "at": (9.97481, -84.83105), "w": 34},   # east of it
    # Playa Caldera. Calle 0A Este runs 180 px of solar and acera short of the
    # sand — the longest wall between a street and a beach anywhere east of the
    # spit, which is exactly what an access is for.
    {"id": "caldera_playa", "name": "Bajada Playa Caldera",
     "at": (9.92983, -84.71084), "w": 30},
    # Playa Tivives, at the south end of the bulevar.
    {"id": "tivives", "name": "Bajada Tivives",
     "at": (9.85763, -84.69860), "w": 30},
]

BLDG_PALETTE = ["#f3c969", "#e85d75", "#6fbf99", "#5fb0d6", "#f08a5d",
                "#c084d6", "#f4d77a", "#7ed6b5", "#e7a3b7", "#9bc4d4",
                "#fff2cc", "#ffd8b1"]
ROOF_PALETTE = ["#9e6f4a", "#3a3540", "#e85d75", "#6fbf99", "#f08a5d", "#3a6f8a"]
