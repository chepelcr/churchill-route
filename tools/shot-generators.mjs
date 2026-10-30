// LOS VERBOS GENERADORES, dibujados.
//
//   node tools/shot-generators.mjs <out.png> [devUrl]
//
// `scatter`, `orbit` and `arcs` exist so an algorithmic drawing can be a parts
// list without arithmetic in JSON. This draws each one from a synthetic record,
// which is the only way to know a generator does what its name says before a
// catalog depends on it.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "generators.png";
const url = process.argv[3] || "http://localhost:8734/";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1010, height: 280 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
const drew = await page.evaluate(async () => {
  const [sh, gfx] = await Promise.all([
    import("/src/render/c2d/shapes.js"), import("/src/render/c2d/gfx.js")]);
  const cv = document.createElement("canvas");
  cv.width = 1010; cv.height = 280;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#20496b"; g.fillRect(0, 0, cv.width, cv.height);

  const CASES = [
    ["scatter (a shoal)", [
      { shape: "scatter", n: 40, rx: 80, ry: 58, rotate: true, scaleVar: 0.4, seed: 3,
        parts: [{ shape: "roundRect", fill: "#eefaff", x: -4, y: -1, w: 8, h: 2, r: 1 }] },
    ]],
    ["orbit + face (turning)", [
      { shape: "orbit", n: 16, r: 62, face: true, seed: 1,
        parts: [{ shape: "roundRect", fill: "#9be6ff", x: -5, y: -1.5, w: 10, h: 3, r: 1.5 }] },
    ]],
    ["arcs (a broken rim)", [
      { shape: "arcs", stroke: "rgba(255,255,255,0.85)", n: 7, r: 66, width: 3,
        span: 0.09, spanVar: 0.06, rVar: 0.16, seed: 2 },
    ]],
    // `fit`: LA CUENTA SALE DEL TAMAÑO. Es lo que ninguno de los otros hace —
    // `repeat` toma una cuenta autorada y `stripes` divide un ancho ENTRE una
    // cuenta autorada, o sea justo lo contrario. Doce de los dieciocho pintores
    // que siguen en código tienen esta forma: ventanas, columnas, pabellones,
    // tensores, juntas de muelle.
    ["fit (140 ÷ 20 = 7)", [
      // el sub-parte se corre media longitud a la izquierda para que la fila
      // quede centrada en su celda, como las otras tres
      { shape: "fit", along: "x", length: 140, pitch: 20,
        parts: [{ shape: "rect", fill: "#ffd479", x: -74, y: -13, w: 8, h: 26 }] },
    ]],
  ];
  const labels = [];
  CASES.forEach(([name, parts], i) => {
    const cx = 130 + i * 250, cy = 120;
    g.save(); g.translate(cx, cy);
    sh.paintParts(g, parts, { X: (v) => v || 0, Y: (v) => v || 0, t: 0 });
    g.restore();
    labels.push([name, cx]);
  });

  // ---- LO QUE UNA IMAGEN NO PUEDE PROBAR --------------------------------------
  // Un verbo que se dibuja no es un verbo que CUENTA BIEN, y la cuenta es la
  // razón de existir de `fit`. Se mide contando llamadas sobre un contexto de
  // mentira, que además prueba lo otro que la hoja no ve: que `S` escale un radio.
  const calls = [];
  const spy = new Proxy({}, {
    get: (_, k) => (k === "save" || k === "restore" ? () => {}
      : (...a) => calls.push([k, ...a])),
    set: () => true,
  });
  const fitCount = (part, frame = {}) => {
    calls.length = 0;
    sh.paintParts(spy, [part], { X: (v) => v || 0, Y: (v) => v || 0, t: 0, ...frame });
    return calls.filter((c) => c[0] === "fillRect").length;
  };
  const box = { shape: "rect", fill: "#fff", x: 0, y: 0, w: 1, h: 1 };
  const counts = {
    exact: fitCount({ shape: "fit", along: "x", length: 140, pitch: 20, parts: [box] }),
    rounds: fitCount({ shape: "fit", along: "x", length: 100, pitch: 16, parts: [box] }),
    floors: fitCount({ shape: "fit", along: "x", length: 100, pitch: 16, mode: "floor", parts: [box] }),
    clampMin: fitCount({ shape: "fit", along: "x", length: 5, pitch: 16, min: 3, parts: [box] }),
    clampMax: fitCount({ shape: "fit", along: "x", length: 900, pitch: 16, max: 4, parts: [box] }),
    vertical: fitCount({ shape: "fit", along: "y", length: 60, pitch: 20, parts: [box] }),
    // el paso es un TAMAÑO: en un marco al doble, el paso se estira y la cuenta
    // se mantiene. Sin `S` el paso quedaría en px y saldrían el doble de copias.
    scaled: fitCount({ shape: "fit", along: "x", length: 140, pitch: 10, parts: [box] },
      { X: (v) => (v || 0) * 2, S: (v) => (v || 0) * 2 }),
  };
  // …y que un radio pase por el marco, que es lo que no hacía.
  calls.length = 0;
  sh.paintParts(spy, [{ shape: "disc", fill: "#fff", cx: 0, cy: 0, r: 10 }],
    { X: (v) => v || 0, Y: (v) => v || 0, S: (v) => (v || 0) * 3 });
  const arc = calls.find((c) => c[0] === "arc");
  const scaledRadius = arc ? arc[3] : null;
  g.fillStyle = "#dff2ff"; g.font = "12px monospace"; g.textAlign = "center";
  labels.forEach(([n, cx]) => g.fillText(n, cx, 250));
  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4)
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  return { ink, counts, scaledRadius, png: cv.toDataURL("image/png").split(",")[1] };
});
writeFileSync(out, Buffer.from(drew.png, "base64"));
if (!(drew.ink > 2000)) { console.error(`[FAIL] blank (${drew.ink} px)`); process.exit(1); }
await b.close();
if (errors.length) { console.error(`[generators] page errors: ${errors.join(" | ")}`); process.exit(1); }
// LA CUENTA ES LA RAZÓN DE SER DE `fit`, así que se afirma, no se mira.
const want = { exact: 7, rounds: 6, floors: 6, clampMin: 3, clampMax: 4, vertical: 3, scaled: 14 };
for (const [k, v] of Object.entries(want)) {
  if (drew.counts[k] !== v) {
    console.error(`[FAIL] fit ${k}: drew ${drew.counts[k]}, expected ${v}`);
    process.exit(1);
  }
}
if (drew.scaledRadius !== 30) {
  console.error(`[FAIL] a radius does not pass through the frame: got ${drew.scaledRadius}, expected 30`);
  process.exit(1);
}
console.log(`[generators] 4 verbs, ${drew.ink} px of ink -> ${out}`);
console.log(`             fit counts ${JSON.stringify(drew.counts)}; a frame at x3 scales r 10 -> ${drew.scaledRadius}`);
