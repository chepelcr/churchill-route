"""World CONTENT — the hand-authored tables the pipeline places on the map.

Districts, landmarks, customers and stages: what the game is ABOUT, as opposed
to config.py, which is how the map is drawn. Anchors are geo (`ll`) so they
survive any change to the projection, and the build FAILS listing any POI it
cannot resolve rather than quietly dropping it.

This is also the data a future management API would edit — which is why it is
its own module and not buried in the builder.
"""

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
    (9.97900, -84.82200),  # playitas | cocal (between OSM nodes: Playitas -84.8274, El Cocal -84.8171)
    (9.93450, -84.72550),  # cocal | mata  (north of Playa Caldera)
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
    {"id": "mercado",     "name": "Mercado Central",            "type": "market",       "district": "centro",   "osm": "mercado municipal de puntarenas"},
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
    {"id": "kios_cocal2", "name": "Soda Ruta 17",               "type": "kiosk",        "district": "cocal",    "ll": (9.96400, -84.74150)},
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
    {"id": "c13", "name": "Pareja en mirador",      "district": "cocal",    "line": "Para ver el atardecer.",       "ll": (9.96000, -84.73900)},
    {"id": "c14", "name": "Camionero de Ruta 17",   "district": "cocal",    "line": "Rápido, voy pa' Caldera.",     "ll": (9.96800, -84.74400)},
    {"id": "c15", "name": "Pescadores del estero",  "district": "mata",     "line": "Justo antes de la lluvia.",    "ll": (9.92600, -84.71000)},
    {"id": "c16", "name": "Cocineros de Leda",      "district": "mata",     "line": "Postre para los clientes.",    "ll": (9.92350, -84.70780)},
    {"id": "c17", "name": "Maquinista del tren",    "district": "caldera",  "line": "El tren no espera a nadie.",   "ll": (9.91450, -84.71550)},
    {"id": "c18", "name": "Estibador del Puerto",   "district": "caldera",  "line": "Rapidito, ando en turno.",     "ll": (9.91080, -84.71680)},
]

# story stages — verbatim from the previous world.js (ids referenced by engine/ui)
STAGES = [
    {"id": "s1", "num": 1, "name": "El Faro", "district": "carmen",
     "brief": "Repartí el primer pedido del día. Llegan cruceros — los gringos quieren probar el dichoso Churchill.",
     "kiosks": ["kios_faro"], "targetDeliveries": 3, "timeLimit": 90, "weather": "sunny",
     "customers": ["c1", "c2"], "unlock": "paseo"},
    {"id": "s2", "num": 2, "name": "Paseo de los Turistas", "district": "paseo",
     "brief": "El boulevard está lleno. Atravesá la peatonal esquivando turistas y comparsas de carnaval.",
     "kiosks": ["kios_paseo1", "kios_paseo2"], "targetDeliveries": 4, "timeLimit": 120, "weather": "sunny",
     "customers": ["c3", "c4", "c5"], "unlock": "centro"},
    {"id": "s3", "num": 3, "name": "Mercado y Catedral", "district": "centro",
     "brief": "Las calles del centro son angostas y el tráfico no perdona. Ojo con los gatos — y el Padre Ramírez no es de esperar.",
     "kiosks": ["kios_centro", "kios_paseo2"], "targetDeliveries": 4, "timeLimit": 130, "weather": "sunny",
     "customers": ["c6", "c7", "c8", "c9"], "unlock": "playitas"},
    {"id": "s4", "num": 4, "name": "Atardecer en Las Playitas", "district": "playitas",
     "brief": "Atardece sobre el Yacht Club. Abrí gas por la Ruta 17, pero cuidado: el equipo de fútbol anda entrenando.",
     "kiosks": ["kios_play", "kios_centro"], "targetDeliveries": 5, "timeLimit": 140, "weather": "sunset",
     "customers": ["c10", "c11", "c12"], "unlock": "cocal"},
    {"id": "s5", "num": 5, "name": "Tormenta en El Cocal", "district": "cocal",
     "brief": "Cayó el aguacero y el asfalto resbala. Llegá a la Ruta 17 antes de que la tormenta empeore.",
     "kiosks": ["kios_cocal2"], "targetDeliveries": 5, "timeLimit": 160, "weather": "storm",
     "customers": ["c13", "c14"], "unlock": "mata"},
    {"id": "s6", "num": 6, "name": "Puente · Mata de Limón", "district": "mata",
     "brief": "Cruzá el puente colgante sobre el estero. Llegá al kiosco de Mata de Limón y a la Marisquería Leda.",
     "kiosks": ["kios_mata"], "targetDeliveries": 4, "timeLimit": 150, "weather": "night",
     "customers": ["c15", "c16"], "unlock": "mata"},
    {"id": "s7", "num": 7, "name": "Caldera · Final", "district": "caldera",
     "brief": "Por la Ruta 27 hasta el Puerto de Caldera. Ya sale el sol — una última entrega y se acaba la jornada.",
     "kiosks": ["kios_caldera", "kios_mata"], "targetDeliveries": 4, "timeLimit": 170, "weather": "sunny",
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
SITE_DECOR = {
    "osm_park_232389752": {"kiosco": True},      # Parque Victoria
    # Mora y Cañas spans an angled cuadra. The generic safety fallback kept it
    # off the roadway by inscribing a rectangle, but that cut away the west
    # corner and flattened the diagonal north edge. Keep its source-supported
    # cuadra cells and emit their straightened contour instead.
    "osm_park_232390078": {"trace": True},
    # The Escuela Delia Urbina de Guevara is mapped in OSM as the whole tall
    # manzana it stands on; the school itself is a WIDE building on the block's
    # south-west corner. `rect` is in fractions of the fitted rect (u east,
    # v south), so this is "the west 84%, the south 38%".
    "osm_school_263127078": {"rect": (0.0, 0.84, 0.62, 1.0)},
    # The Escuela de Biología Marina (UNA) sits on the WEST side of its calle;
    # the OSM area spans the block and put it along the north edge instead.
    "osm_campus_232386868": {"rect": (0.0, 0.52, 0.0, 1.0)},
}

BLDG_PALETTE = ["#f3c969", "#e85d75", "#6fbf99", "#5fb0d6", "#f08a5d",
                "#c084d6", "#f4d77a", "#7ed6b5", "#e7a3b7", "#9bc4d4",
                "#fff2cc", "#ffd8b1"]
ROOF_PALETTE = ["#9e6f4a", "#3a3540", "#e85d75", "#6fbf99", "#f08a5d", "#3a6f8a"]
