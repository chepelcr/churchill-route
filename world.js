// La Ruta del Churchill — Puntarenas peninsula (high fidelity to real map)
//
// Coordinates: world-space pixels. The peninsula is a long, narrow sand spit
// tapering to a near-point at La Punta / El Faro on the west and widening at
// El Cocal in the east where it meets the mainland.
//
//                          ╮ Gulf of Nicoya / Estero (north)
//   FARO • CARMEN  ====  PASEO ==== MERCADO ==== PLAYITAS ==== EL COCAL  • Ruta 17
//                          ╯ Playa Puntarenas (south)

window.WORLD = (function () {
  const W = 8800;
  const H = 1400;

  // ----- Peninsula silhouette ------------------------------------------------
  // The peninsula is described by smooth top/bottom y(x) functions.
  // Wider in centro (Puntarenas), pinched at Carmen tip and Playitas,
  // slightly wider at El Cocal where the sand spit meets the mainland.

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // anchor profile (x, halfWidth). We interpolate between these.
  // x runs 0 (west tip) → 7200 (mainland), centerline y=700.
  const PROFILE = [
    { x:    0, hw:   8, cy: 700 }, // El Faro point
    { x:  120, hw:  22, cy: 700 },
    { x:  280, hw:  58, cy: 700 },
    { x:  520, hw: 110, cy: 700 }, // Carmen widening
    { x:  900, hw: 165, cy: 700 },
    { x: 1400, hw: 205, cy: 700 }, // Paseo wide
    { x: 2000, hw: 230, cy: 700 },
    { x: 2600, hw: 240, cy: 700 }, // Centro widest
    { x: 3200, hw: 235, cy: 700 },
    { x: 3800, hw: 200, cy: 700 },
    { x: 4400, hw: 160, cy: 700 }, // Playitas pinch
    { x: 5000, hw: 135, cy: 700 },
    { x: 5500, hw: 150, cy: 700 },
    { x: 6000, hw: 195, cy: 700 }, // El Cocal widens
    { x: 6500, hw: 240, cy: 700 }, // El Cocal wide
    { x: 6700, hw: 200, cy: 700 },
    { x: 6820, hw:  90, cy: 700 }, // peninsula tip ending
    { x: 6880, hw:  40, cy: 700 }, // approach to bridge
    { x: 6960, hw:  18, cy: 700 }, // BRIDGE — thin land strip under deck
    { x: 7040, hw:  18, cy: 700 }, // BRIDGE
    { x: 7120, hw:  40, cy: 700 }, // landfall at Mata de Limón
    { x: 7260, hw: 140, cy: 700 }, // Mata de Limón village
    { x: 7500, hw: 200, cy: 700 }, // Caldera Bulevar area
    { x: 7900, hw: 280, cy: 700 }, // Caldera widening
    { x: 8300, hw: 360, cy: 700 }, // mainland
    { x: 8800, hw: 420, cy: 700 },
  ];

  // ----- Mata de Limón ------------------------------------------------------
  // The famous suspension bridge crossing the estuary, plus the mangrove
  // lagoon (Estero de Mata de Limón) which sits inland on the north side.
  const BRIDGE = {
    x0: 6880, x1: 7040,     // span (world x)
    cy: 700,                 // road centerline
    deckW: 26,               // road width
    towers: [6895, 7025],    // tower x positions
    towerH: 70,              // tower visual height above deck
  };
  // Estuary water body, lobed ellipse on the north side
  const ESTUARY = {
    cx: 7350, cy: 580, rx: 280, ry: 70, // big lobe
    inlet: { x0: 7050, x1: 7150, y0: 640, y1: 700 }, // narrow inlet connecting to gulf via the bridge gap
  };
  // Mangrove clusters (dark green vegetation around estuary)
  const MANGROVES = (function () {
    const out = [];
    const rng = ((s) => () => (s = (s * 9301 + 49297) % 233280) / 233280)(57);
    // around estuary perimeter
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      const rx = ESTUARY.rx + 30 + rng() * 30;
      const ry = ESTUARY.ry + 30 + rng() * 22;
      const x = ESTUARY.cx + Math.cos(a) * rx;
      const y = ESTUARY.cy + Math.sin(a) * ry;
      if (a > Math.PI * 0.3 && a < Math.PI * 0.7) continue; // gap toward gulf
      out.push({ x, y, r: 10 + rng() * 8 });
    }
    // patches inside the estuary (mangrove islands)
    for (let i = 0; i < 10; i++) {
      const ang = rng() * Math.PI * 2;
      const rr = rng() * ESTUARY.rx * 0.65;
      out.push({ x: ESTUARY.cx + Math.cos(ang) * rr, y: ESTUARY.cy + Math.sin(ang) * (ESTUARY.ry * 0.7), r: 4 + rng() * 4 });
    }
    return out;
  })();
  // Hills behind Mata de Limón (northern visual band)
  const HILLS = [
    { x0: 7150, x1: 8800, baseY: 250, color: "#5e8a55" },
    { x0: 7450, x1: 8600, baseY: 200, color: "#4c7848" },
  ];

  function halfWidthAt(x) {
    for (let i = 1; i < PROFILE.length; i++) {
      if (x <= PROFILE[i].x) {
        const a = PROFILE[i - 1], b = PROFILE[i];
        const t = (x - a.x) / (b.x - a.x);
        // smoothstep
        const tt = t * t * (3 - 2 * t);
        return a.hw + (b.hw - a.hw) * tt;
      }
    }
    return PROFILE[PROFILE.length - 1].hw;
  }
  function centerYAt(x) { return 700; }

  // top/bottom shore lines with tiny noise to feel hand-drawn
  function noise(x, k) {
    return Math.sin(x * 0.011 + k * 17) * 3 + Math.sin(x * 0.005 + k * 5) * 4;
  }
  function topY(x) { return centerYAt(x) - halfWidthAt(x) + noise(x, 1); }
  function botY(x) { return centerYAt(x) + halfWidthAt(x) + noise(x, 2); }

  // Polygon for stroke/fill of the land
  function landPolygon(step = 12) {
    const top = [];
    const bot = [];
    for (let x = 0; x <= W; x += step) { top.push([x, topY(x)]); bot.push([x, botY(x)]); }
    return top.concat(bot.reverse());
  }
  // South shore line (Playa Puntarenas) — used for sand strip rendering
  function southShoreLine(step = 12) {
    const arr = [];
    for (let x = 0; x <= W; x += step) arr.push([x, botY(x)]);
    return arr;
  }
  function northShoreLine(step = 12) {
    const arr = [];
    for (let x = 0; x <= W; x += step) arr.push([x, topY(x)]);
    return arr;
  }

  // ----- Districts ----------------------------------------------------------
  // Matches the map labels: Carmen (west), Paseo/Centro, Mercado, Las Playitas, El Cocal
  const DISTRICTS = [
    { id: "faro",     name: "EL FARO",           x0:    0, x1:  280, tone: "#f4d77a", short: "Faro" },
    { id: "carmen",   name: "CARMEN",            x0:  280, x1: 1100, tone: "#e0b478", short: "Carmen" },
    { id: "paseo",    name: "PASEO DE LOS TURISTAS", x0: 1100, x1: 2400, tone: "#f0a37a", short: "Paseo" },
    { id: "centro",   name: "CENTRO PUNTARENAS", x0: 2400, x1: 3600, tone: "#e6c388", short: "Centro" },
    { id: "playitas", name: "BARRIO LAS PLAYITAS", x0: 3600, x1: 5400, tone: "#caa089", short: "Playitas" },
    { id: "cocal",    name: "BARRIO EL COCAL",   x0: 5400, x1: 6800, tone: "#a8b88a", short: "Cocal" },
    { id: "mata",     name: "MATA DE LIMÓN",       x0: 6800, x1: 7600, tone: "#a0c894", short: "Mata Limón" },
    { id: "caldera",  name: "CALDERA BULEVAR",      x0: 7600, x1: 8800, tone: "#9bc4d4", short: "Caldera" },
  ];

  // ----- Streets ------------------------------------------------------------
  // Costa Rican grid: Avenidas (E–W) and Calles (N–S, odd-numbered convention).
  // We generate them inside the peninsula polygon.
  //
  //   Av 3 (north residential)
  //   Av 1 / Av Central (Ruta 17 — the spine)
  //   Av 2 (south residential)
  //   Av 4 (Paseo de los Turistas service road)
  //
  // Calles spaced ~70px in centro, sparser in narrower districts.

  const AVENIDAS = [
    { id: "av3", name: "Av. 3",      offset: -90, w: 28, dashed: true },
    { id: "ruta17", name: "Ruta 17 · Av. Central", offset: -8, w: 56, dashed: false, primary: true },
    { id: "av2", name: "Av. 2",      offset:  60, w: 26, dashed: true },
    { id: "av4", name: "Av. 4 · Paseo",  offset: 105, w: 32, dashed: true, paseo: true },
  ];

  // Streets that exist (clipped to peninsula)
  function avenidaYAt(av, x) { return centerYAt(x) + av.offset; }
  function avenidaInside(av, x) {
    const y = avenidaYAt(av, x);
    return y > topY(x) + 18 && y < botY(x) - 14;
  }

  // Generate calles (vertical streets) with varying density per district
  function genCalles() {
    const calles = [];
    // density by district
    const ranges = [
      { x0: 0,    x1: 280,  step: 0 },     // El Faro point — no cross streets
      { x0: 280,  x1: 1100, step: 120, prefix: "C. ", indices: [21,19,17,15,13,11,9,7,5,3,1], offset: 1 }, // Carmen
      { x0: 1100, x1: 2400, step: 90,  prefix: "C. " }, // Paseo
      { x0: 2400, x1: 3600, step: 70,  prefix: "C. ", indices: [1,3,5,7,9] }, // Centro (real map shows C.1,3,5,7,9)
      { x0: 3600, x1: 5400, step: 130, prefix: "C. " }, // Playitas (sparse)
      { x0: 5400, x1: 6800, step: 110, prefix: "C. " }, // Cocal
      { x0: 7150, x1: 7600, step: 130, prefix: "C. " }, // Mata de Limón village
      { x0: 7600, x1: 8400, step: 110, prefix: "C. " }, // Caldera Bulevar
      { x0: 8400, x1: 8700, step: 140, prefix: "C. " }, // Puerto area
    ];
    let idx = 1;
    for (const r of ranges) {
      if (!r.step) continue;
      let n = 0;
      for (let x = r.x0 + r.step / 2; x < r.x1; x += r.step) {
        // ensure inside peninsula
        if (botY(x) - topY(x) < 70) continue;
        const name = r.prefix + (r.indices ? r.indices[n % r.indices.length] : (idx * 2 - 1));
        calles.push({ x: Math.round(x), w: 18, name });
        n++; idx++;
      }
    }
    return calles;
  }
  const CALLES = genCalles();

  // ----- Buildings ----------------------------------------------------------
  // Generated in two rows: north of Ruta 17 and south of it.
  // Each row is bounded by the peninsula edges.
  const BLDG_PALETTE = [
    "#f3c969", "#e85d75", "#6fbf99", "#5fb0d6", "#f08a5d",
    "#c084d6", "#f4d77a", "#7ed6b5", "#e7a3b7", "#9bc4d4",
    "#fff2cc", "#ffd8b1",
  ];
  const ROOF_PALETTE = ["#9e6f4a", "#3a3540", "#e85d75", "#6fbf99", "#f08a5d", "#3a6f8a"];

  function seeded(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  function genBuildings() {
    const rng = seeded(11);
    const out = [];
    function addRow(yA, yB, xMin = 60, xMax = W - 60) {
      let x = xMin;
      while (x < xMax) {
        const w = 32 + Math.floor(rng() * 64);
        // skip calles
        const onCalle = CALLES.some(c => Math.abs((x + w/2) - c.x) < c.w/2 + 6);
        const yTop = yA(x + w / 2) + 6;
        const yBot = yB(x + w / 2) - 6;
        const h = Math.max(14, Math.min(40, yBot - yTop));
        if (!onCalle && yBot - yTop > 18) {
          out.push({
            x, y: yTop + (yBot - yTop - h) * rng(), w, h,
            color: BLDG_PALETTE[Math.floor(rng() * BLDG_PALETTE.length)],
            roof: ROOF_PALETTE[Math.floor(rng() * ROOF_PALETTE.length)],
            wnd: rng() < 0.7,
          });
        }
        x += w + 4 + Math.floor(rng() * 10);
      }
    }
    // North row: between top shore and Av 3
    addRow((x) => topY(x), (x) => avenidaYAt(AVENIDAS[0], x) - 4);
    // Between Av 3 and Ruta 17
    addRow((x) => avenidaYAt(AVENIDAS[0], x) + 18, (x) => avenidaYAt(AVENIDAS[1], x) - 32);
    // Between Ruta 17 and Av 2
    addRow((x) => avenidaYAt(AVENIDAS[1], x) + 32, (x) => avenidaYAt(AVENIDAS[2], x) - 4);
    // Between Av 2 and Av 4 (Paseo)
    addRow((x) => avenidaYAt(AVENIDAS[2], x) + 16, (x) => avenidaYAt(AVENIDAS[3], x) - 8);
    // Filter out anything that fell outside peninsula
    return out.filter(b => b.y > 0 && b.y + b.h < H);
  }
  const BUILDINGS = genBuildings();

  // ----- Landmarks (anchored to real Puntarenas references) ----------------
  const LANDMARKS = [
    { id: "faro",      name: "El Faro",                  x:  80,   y: 700,  type: "lighthouse",  district: "faro" },
    { id: "muellecruc", name: "Muelle de Cruceros",      x:  380,  y: 580,  type: "cruise",      district: "carmen" },
    { id: "ferrycr",   name: "Terminal de Ferry",        x:  520,  y: 560,  type: "ferry",       district: "carmen" },
    { id: "playa",     name: "Playa Puntarenas",         x:  900,  y: 875,  type: "beachsign",   district: "carmen" },
    { id: "carmenig",  name: "Iglesia del Carmen",       x: 1020,  y: 660,  type: "church",      district: "carmen" },
    { id: "tioga",     name: "Hotel Tioga",              x: 1380,  y: 760,  type: "hotel",       district: "paseo" },
    { id: "kios_paseo1", name: "Kiosco Doña Lela",       x: 1560,  y: 810,  type: "kiosk",       district: "paseo" },
    { id: "kios_paseo2", name: "Churchill El Mariachi",  x: 1860,  y: 815,  type: "kiosk",       district: "paseo" },
    { id: "casafait",  name: "Casa Fait",                x: 2100,  y: 660,  type: "house",       district: "paseo" },
    { id: "parquemar", name: "Parque Marino del Pacífico", x: 2380, y: 600, type: "park",        district: "paseo" },
    { id: "mercado",   name: "Mercado Central",          x: 2700,  y: 660,  type: "market",      district: "centro" },
    { id: "pali",      name: "Supermercado Palí",        x: 2880,  y: 600,  type: "super",       district: "centro" },
    { id: "catedral",  name: "Catedral de Puntarenas",   x: 3120,  y: 670,  type: "cathedral",   district: "centro" },
    { id: "cultura",   name: "Casa de la Cultura",       x: 3260,  y: 610,  type: "civic",       district: "centro" },
    { id: "museo",     name: "Museo Histórico Marino",   x: 3380,  y: 660,  type: "museum",      district: "centro" },
    { id: "kios_centro", name: "Kiosco La Porteña",      x: 3000,  y: 805,  type: "kiosk",       district: "centro" },
    { id: "estadio",   name: "Estadio Lito Pérez",       x: 3700,  y: 600,  type: "stadium",     district: "playitas" },
    { id: "kios_play", name: "Kiosco Playitas",          x: 4100,  y: 800,  type: "kiosk",       district: "playitas" },
    { id: "yatch",     name: "Yacht Club",               x: 4800,  y: 580,  type: "marina",      district: "playitas" },
    { id: "cocal_park", name: "Parque El Cocal",         x: 5800,  y: 620,  type: "park",        district: "cocal" },
    { id: "kios_cocal", name: "Kiosco El Cocal",         x: 6000,  y: 805,  type: "kiosk",       district: "cocal" },
    { id: "puente",    name: "Puente de Mata de Limón", x: 6960,  y: 700,  type: "bridge",      district: "mata" },
    { id: "kios_mata", name: "Kiosco Mata de Limón",     x: 7300,  y: 745,  type: "kiosk",       district: "mata" },
    { id: "leda",      name: "Marisquería Leda",        x: 7380,  y: 660,  type: "restaurant",  district: "mata" },
    { id: "matalimon", name: "Estero Mata de Limón",     x: 7350,  y: 580,  type: "estuary",     district: "mata" },
    { id: "caldera_blvd", name: "Caldera Bulevar",       x: 7700,  y: 720,  type: "sign",        district: "caldera" },
    { id: "tren",      name: "Estación Tren Caldera",    x: 7900,  y: 540,  type: "trainstation", district: "caldera" },
    { id: "puerto",    name: "Puerto de Caldera",        x: 8400,  y: 760,  type: "port",        district: "caldera" },
    { id: "villach",   name: "Villa Champán",            x: 8200,  y: 780,  type: "village",     district: "caldera" },
    { id: "ruta27",    name: "Ruta 27 · Autopista",      x: 8600,  y: 660,  type: "highway",     district: "caldera" },
  ];

  // ----- Customers (delivery destinations) ---------------------------------
  // Each ties to a district for stage-scoped missions
  const CUSTOMERS = [
    { id:"c1",  name: "Don Beto, pescador",     x: 380,  y: 540, district: "carmen",   line: "¡Antes que se derrita, mae!" },
    { id:"c2",  name: "Crucerista alemana",     x: 380,  y: 620, district: "carmen",   line: "Eine Churchill, bitte!" },
    { id:"c3",  name: "Carnaval troupe",        x: 1400, y: 855, district: "paseo",    line: "Para los muchachos del baile." },
    { id:"c4",  name: "Familia tica",           x: 1700, y: 860, district: "paseo",    line: "Cuatro, con extra leche." },
    { id:"c5",  name: "Surfista canadiense",    x: 2050, y: 850, district: "paseo",    line: "Make it extra red, dude." },
    { id:"c6",  name: "Padre Ramírez",          x: 3120, y: 715, district: "centro",   line: "Bendito churchill." },
    { id:"c7",  name: "Vendedor de ceviche",    x: 2750, y: 700, district: "centro",   line: "Cambio: ceviche x churchill." },
    { id:"c8",  name: "Doña del mercado",       x: 2700, y: 590, district: "centro",   line: "Rojito bien fuerte." },
    { id:"c9",  name: "Niño con bici",          x: 3550, y: 850, district: "centro",   line: "¡El mío con piña!" },
    { id:"c10", name: "Equipo de fútbol",       x: 3700, y: 545, district: "playitas", line: "Once. Es broma. Tres." },
    { id:"c11", name: "Doña del rocking chair", x: 4400, y: 720, district: "playitas", line: "Como en los años 80." },
    { id:"c12", name: "Yatista gringo",         x: 4800, y: 540, district: "playitas", line: "Best churchill ever, man." },
    { id:"c13", name: "Pareja en mirador",      x: 5600, y: 855, district: "cocal",    line: "Para ver el atardecer." },
    { id:"c14", name: "Camionero de Ruta 17",   x: 6300, y: 690, district: "cocal",    line: "Rápido, voy pa' Caldera." },
    { id:"c15", name: "Pescadores del estero",  x: 7300, y: 600, district: "mata",    line: "Justo antes de la lluvia." },
    { id:"c16", name: "Cocineros de Leda",      x: 7380, y: 685, district: "mata",    line: "Postre para los clientes." },
    { id:"c17", name: "Maquinista del tren",    x: 7900, y: 570, district: "caldera", line: "Salgo al amanecer, mae." },
    { id:"c18", name: "Estibador del Puerto",   x: 8400, y: 730, district: "caldera", line: "Cargando contenedor." }
  ];

  // ----- Palms / vegetation ------------------------------------------------
  function genPalms() {
    const rng = seeded(33);
    const arr = [];
    // South beach (Playa Puntarenas) — line of palms
    for (let x = 100; x < W - 60; x += 35 + rng() * 25) {
      const ys = botY(x) - 14 - rng() * 6;
      arr.push({ x, y: ys, s: 0.9 + rng() * 0.4, sway: rng() * Math.PI * 2 });
    }
    // North shore
    for (let x = 200; x < W - 60; x += 60 + rng() * 60) {
      const ys = topY(x) + 8 + rng() * 6;
      arr.push({ x, y: ys, s: 0.8 + rng() * 0.4, sway: rng() * Math.PI * 2 });
    }
    // Paseo boulevard palms (regular spacing)
    for (let x = 1100; x < 3400; x += 60) {
      arr.push({ x, y: avenidaYAt(AVENIDAS[3], x) - 4, s: 1.05, sway: x * 0.01 });
    }
    return arr;
  }
  const PALMS = genPalms();

  // ----- Stages (story progression) ----------------------------------------
  const STAGES = [
    { id: "s1", num: 1, name: "El Faro", district: "carmen",
      brief: "Repartí el primer pedido del día. Llegan cruceros — los gringos quieren probar el dichoso Churchill.",
      kiosks: ["kios_paseo1"], targetDeliveries: 3, timeLimit: 90, weather: "sunny",
      customers: ["c1", "c2"], unlock: "paseo" },
    { id: "s2", num: 2, name: "Paseo de los Turistas", district: "paseo",
      brief: "El boulevard está lleno. Atravesá la peatonal, esquivá turistas y carnaval.",
      kiosks: ["kios_paseo1", "kios_paseo2"], targetDeliveries: 4, timeLimit: 120, weather: "sunny",
      customers: ["c3","c4","c5"], unlock: "centro" },
    { id: "s3", num: 3, name: "Mercado y Catedral", district: "centro",
      brief: "Calles del centro angostas (C.1, C.3, C.5…). Tráfico, gatos, padre con hambre.",
      kiosks: ["kios_paseo2", "kios_centro"], targetDeliveries: 4, timeLimit: 130, weather: "sunny",
      customers: ["c6","c7","c8","c9"], unlock: "playitas" },
    { id: "s4", num: 4, name: "Atardecer en Las Playitas", district: "playitas",
      brief: "Sunset sobre el Yacht Club. Velocidad sobre Ruta 17. Cuidado con el equipo de fútbol.",
      kiosks: ["kios_centro", "kios_play"], targetDeliveries: 5, timeLimit: 140, weather: "sunset",
      customers: ["c10","c11","c12"], unlock: "cocal" },
    { id: "s5", num: 5, name: "Tormenta en El Cocal", district: "cocal",
      brief: "Lluvia tropical, poca tracción. Llegá a la Ruta 17 antes que el aguacero te aguante.",
      kiosks: ["kios_play", "kios_cocal"], targetDeliveries: 5, timeLimit: 160, weather: "storm",
      customers: ["c13","c14"], unlock: "mata" },
    { id: "s6", num: 6, name: "Puente · Mata de Limón", district: "mata",
      brief: "Cruzá el puente colgante sobre el estero. Llegá al kiosco de Mata de Limón y a la Marisquería Leda.",
      kiosks: ["kios_cocal", "kios_mata"], targetDeliveries: 4, timeLimit: 150, weather: "night",
      customers: ["c15","c16"], unlock: "mata" },
    { id: "s7", num: 7, name: "Caldera · Final", district: "caldera",
      brief: "Ruta 27 hasta el Puerto de Caldera. El amanecer pega fuerte — última entrega antes que termine el día.",
      kiosks: ["kios_mata"], targetDeliveries: 4, timeLimit: 170, weather: "sunny",
      customers: ["c17","c18"], unlock: "caldera" },
  ];

  // ----- Helpers used by engine --------------------------------------------
  function onRoad(x, y) {
    // any avenida?
    for (const av of AVENIDAS) {
      const ay = avenidaYAt(av, x);
      if (Math.abs(y - ay) < av.w / 2 + 1 && x > 0 && x < W) return true;
    }
    // any calle?
    for (const c of CALLES) {
      if (Math.abs(x - c.x) < c.w / 2 + 1 && y > topY(x) + 6 && y < botY(x) - 6) return true;
    }
    return false;
  }
  function onPaseo(x, y) {
    const ay = avenidaYAt(AVENIDAS[3], x);
    return Math.abs(y - ay) < 20 && x > 900 && x < 4400;
  }
  function inWater(x, y) {
    if (x < 4 || x > W - 4) return true;
    // bridge deck is solid even though land is narrow underneath
    if (x >= BRIDGE.x0 && x <= BRIDGE.x1 && Math.abs(y - BRIDGE.cy) < BRIDGE.deckW / 2 + 6) return false;
    if (y < topY(x) - 6 || y > botY(x) + 6) return true;
    // Mata de Limón estuary (inside the mainland) — water hole
    const dx = (x - ESTUARY.cx) / ESTUARY.rx;
    const dy = (y - ESTUARY.cy) / ESTUARY.ry;
    if (dx * dx + dy * dy < 1) return true;
    return false;
  }
  function onBridge(x, y) {
    return x >= BRIDGE.x0 && x <= BRIDGE.x1 && Math.abs(y - BRIDGE.cy) < BRIDGE.deckW / 2 + 4;
  }
  function onBeach(x, y) {
    // narrow band just outside the asphalt
    return (y > botY(x) - 14 && y < botY(x) + 6) || (y < topY(x) + 14 && y > topY(x) - 6);
  }
  function districtAt(x) {
    for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1) return d;
    return DISTRICTS[0];
  }
  function landmarkById(id) { return LANDMARKS.find(l => l.id === id); }
  function customerById(id) { return CUSTOMERS.find(c => c.id === id); }

  return {
    W, H, DISTRICTS, AVENIDAS, CALLES, BUILDINGS, LANDMARKS, CUSTOMERS, PALMS, STAGES,
    BRIDGE, ESTUARY, MANGROVES, HILLS,
    topY, botY, halfWidthAt, centerYAt, landPolygon, southShoreLine, northShoreLine,
    avenidaYAt, onRoad, onPaseo, inWater, onBridge, onBeach, districtAt, landmarkById, customerById,
  };
})();
