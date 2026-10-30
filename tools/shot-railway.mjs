// EL TREN AL PUERTO, EN UNA HOJA.
//
//   node tools/shot-railway.mjs <out.png> [devUrl]
//
// Nueve escenas, seis piezas de material rodante, tres rizos, cinco puentes y
// las dos estaciones: todo lo que `railway-art.json` autora, dibujado con el
// pintor DE VERDAD y en un solo cuadro que se difiere con `tools/png-diff.mjs`.
// Es la compuerta de arte del modo, la misma que las otras diez hojas, y vale
// por la razón que esta casa ya tiene escrita: cambiar arte no lo cubre ningún
// smoke, y el tamaño del PNG no es una medición.
//
// VA CONTRA UN SERVIDOR FRESCO, como las ocho smokes que importan módulos
// fuente: hace `import("/src/…")` por ruta lisa, y un `:8734` con un ciclo de
// edición encima le acuña una SEGUNDA instancia del grafo — el registro que la
// hoja lee no es el que el pintor usa, y la diferencia se lee como una
// regresión del arte.
//
//   ./reboot-server.sh 8736 && node tools/shot-railway.mjs a.png http://localhost:8736/
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "railway.png";
const url = process.argv[3] || "http://localhost:8736/";
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";

const W = 1560, H = 2860;
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] })
  .catch(() => chromium.launch({ args: ["--no-sandbox"] }));
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => { await document.fonts.ready; });

const report = await page.evaluate(async ([w, h]) => {
  const [rail, backdrop, paintMod, view, trackMod] = await Promise.all([
    import("/src/game/railway/index.js"),
    import("/src/render/railway/backdrop.js"),
    import("/src/render/railway/paint.js"),
    import("/src/render/railway/view.js"),
    import("/src/game/railway/track.js"),
  ]);
  const art = rail.RAILWAY_ART;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  document.body.replaceChildren(cv);
  const g = cv.getContext("2d");
  g.fillStyle = "#101820";
  g.fillRect(0, 0, w, h);
  const cap = (text, x, y) => {
    g.font = "bold 11px 'JetBrains Mono', monospace";
    g.fillStyle = "#cfe0d8";
    g.textAlign = "left";
    g.fillText(text, x, y);
  };

  // ---- las nueve escenas, 3 por fila -------------------------------------
  const scenes = Object.keys(art.scenes);
  const CW = Math.floor(w / 3), CH = 220;
  scenes.forEach((id, i) => {
    const x = (i % 3) * CW, y = Math.floor(i / 3) * CH;
    g.save();
    g.beginPath(); g.rect(x + 4, y + 18, CW - 8, CH - 24); g.clip();
    g.translate(x + 4, y + 18);
    backdrop.paintBackdrop(g, art, CW - 8, CH - 24, { a: id, b: null, blend: 0, camX: 900, camY: 0, t: 3 });
    g.restore();
    cap(id, x + 6, y + 13);
  });

  // ---- el material rodante ------------------------------------------------
  let y0 = Math.ceil(scenes.length / 3) * CH + 10;
  const stock = Object.keys(art.stock);
  stock.forEach((id, i) => {
    const rec = art.stock[id];
    const col = i % 2, row = Math.floor(i / 2);
    const cw = Math.floor(w / 2), ch = 150;
    const x = col * cw, y = y0 + row * ch;
    const ppm = Math.min((cw - 40) / (rec.lengthM + 2), (ch - 40) / (rec.heightM + 1.4));
    g.save();
    g.translate(x + cw / 2, y + ch - 26);
    paintMod.paintCar(g, rec, { x: 0, y: 0, angle: 0 }, ppm, { rollRad: 0.7 });
    g.restore();
    cap(`${id}  ${rec.lengthM} m`, x + 8, y + 14);
  });

  // ---- los tres estilos de puente y las dos épocas, sobre el mismo vano ----
  // Las recetas se prueban CAMBIANDO EL ESTILO de un tramo real y no sobre un
  // vano inventado: un puente se cuenta sobre su largo, así que medirlo fuera
  // de un nivel mediría otra cosa.
  // ---- vía, rizos, puentes y estaciones, con el pintor del mundo ----------
  y0 += Math.ceil(stock.length / 2) * 150 + 8;
  const game = rail.createRailwayRun("pacifico-belen", "siemens-130", {});
  const deep = game.map.structures[3];          // el vano más hondo del tramo
  const deepS = nearestS(game.track, (deep.playX0 + deep.playX1) / 2);
  const spots = [];
  for (const loop of game.track.loops) spots.push([`rizo ${loop.size}`, loop.sIn + 2]);
  for (const st of game.map.stations) spots.push([`estación ${st.style}`, nearestS(game.track, st.playX)]);
  for (const style of ["truss", "girder", "arch"]) {
    spots.push([`puente ${style}`, deepS, { style }]);
  }
  for (const era of ["sepia", "nocturno"]) spots.push([`época ${era}`, deepS, { era }]);
  function nearestS(track, x) {
    const pts = track.points;
    for (let i = 1; i < pts.length; i++) if (pts[i].x >= x) return pts[i].s;
    return pts.at(-1).s;
  }
  const PW = Math.floor(w / 2), PH = 230;
  spots.forEach(([label, s, opts = {}], i) => {
    const x = (i % 2) * PW, y = y0 + Math.floor(i / 2) * PH;
    if (opts.style) deep.style = opts.style;
    game.level.era = opts.era || "moderno";
    game.map.level.era = game.level.era;
    game.run.distance = s;
    game.run.speed = 18;
    const cam = view.createCamera({ ...game, art }, PW - 8, PH - 24);
    g.save();
    g.beginPath(); g.rect(x + 4, y + 18, PW - 8, PH - 24); g.clip();
    g.translate(x + 4, y + 18);
    view.drawRailway(g, { ...game, art }, cam, PW - 8, PH - 24, 4, {
      stationName: (st) => st.id.toUpperCase(),
    });
    g.restore();
    cap(label, x + 8, y + 13);
  });

  return {
    data: cv.toDataURL("image/png"),
    height: y0 + Math.ceil(spots.length / 2) * PH,
    scenes: scenes.length, stock: stock.length, spots: spots.length,
  };
}, [W, H]);

writeFileSync(out, Buffer.from(report.data.split(",")[1], "base64"));
console.log(`[shot-railway] ${report.scenes} escenas · ${report.stock} coches · ${report.spots} tramos`
  + ` -> ${out} (usado ${report.height}/${H} px de alto)`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
await browser.close();
