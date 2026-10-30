// UN NIVEL DE CANTO — y el dedo tiene que seguir apuntando a donde el jugador cree.
//
//   node tools/smoke-rotated.mjs [devUrl]
//
// Girar la cámara es una línea; lo que se rompe si nadie lo mira es el CONTROL.
// `applyTouch` compara un ángulo de PANTALLA con el rumbo de MUNDO del carro, y
// sin restarle el giro el dedo manda 90° al lado. Eso no se ve en una captura:
// se ve conduciendo, y para entonces el nivel es injugable.
//
// Se prueba lo que importa: tocando ARRIBA en la pantalla, el carro tiene que
// acabar yendo hacia arriba EN LA PANTALLA — gire la cámara o no.
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8734/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });

const out = await page.evaluate(async () => {
  const G = window.Game;
  const rows = [];
  const cv = document.querySelector("canvas");
  const touch = (type, x, y) => {
    const t = { identifier: 1, clientX: x, clientY: y, target: cv };
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.touches = type === "touchend" ? [] : [t];
    ev.changedTouches = [t];
    cv.dispatchEvent(ev);
  };
  for (const rot of [0, Math.PI / 2]) {
    G.setAttract(false);
    G.startExplore();
    await new Promise((r) => setTimeout(r, 500));
    const st = G.state, p = st.p;
    st.cam.rot = rot;
    // El carro mira al ESTE del mundo; el dedo toca ARRIBA de la pantalla.
    p.a = 0; p.vx = 0; p.vy = 0; p.speed = 0;
    touch("touchstart", 450, 90);
    for (let i = 0; i < 150; i++) await new Promise((r) => requestAnimationFrame(r));
    touch("touchend", 450, 90);
    // mundo -> pantalla es una rotación por `rot`
    const sxv = Math.cos(p.a) * Math.cos(rot) - Math.sin(p.a) * Math.sin(rot);
    const syv = Math.cos(p.a) * Math.sin(rot) + Math.sin(p.a) * Math.cos(rot);
    rows.push({ rot: +(rot * 180 / Math.PI).toFixed(0), worldA: +p.a.toFixed(2),
                screenY: +syv.toFixed(2), screenX: +sxv.toFixed(2) });
  }
  return rows;
});
const browser2 = browser;
if (errors.length) { console.error(`[rot] page errors: ${errors.join(" | ")}`); process.exit(1); }
let bad = 0;
for (const r of out) {
  const up = r.screenY < -0.3;              // -y es ARRIBA en pantalla
  console.log(`[rot] cámara ${String(r.rot).padStart(3)}°  rumbo mundo ${r.worldA}  `
    + `-> en pantalla (${r.screenX}, ${r.screenY})  ${up ? "sube ✓" : "NO sube ✗"}`);
  if (!up) bad++;
}
if (bad) {
  console.error("[rot] FAIL — tocando arriba el carro no va hacia arriba en pantalla: "
    + "el control no está corrigiendo el giro de la cámara");
  process.exit(1);
}
console.log("[rot] ok — el dedo apunta a donde el jugador cree, gire o no la cámara");

// …Y LO OTRO QUE SE ROMPE DE CANTO ES EL TEXTO. Un nivel girado gira el mundo, y
// con él cada glifo dibujado en coordenadas de mundo: el `+ CHURCHILL` de una
// entrega, el nombre real de un negocio, el rótulo de CERRADO de un barrio. Eso
// tampoco se ve en una captura de la etapa que no está girada, que es la única
// que casi siempre se mira.
//
// Se prueba el MECANISMO, no los píxeles: `upright` tiene que dejar la matriz
// del contexto SIN rotación, venga de donde venga el giro. Por eso lee la CTM y
// no un `__worldRot` que el compositor le pasaba por un lado — ese sólo sabía
// del giro de la cámara, así que una placa dentro del ángulo de su manzana
// salía torcida igual, y de eso no se enteraba ninguna prueba.
const upOut = await page2Check();

async function page2Check() {
  const page2 = await browser2.newPage({ viewport: { width: 400, height: 300 } });
  await page2.goto(url, { waitUntil: "domcontentloaded" });
  await page2.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });
  const rows = await page2.evaluate(async () => {
    const mod = await import(new URL("/src/render/c2d/primitives.js", location.href).href);
    const cv = document.createElement("canvas");
    cv.width = 200; cv.height = 200;
    const g = cv.getContext("2d");
    const out = [];
    // tres formas de acabar girado: la cámara, el ángulo de una manzana, y las
    // dos a la vez — que es el caso que el canal viejo no podía ver.
    for (const [name, angles] of [["camera", [Math.PI / 2]],
                                  ["parcel", [0.61]],
                                  ["both", [Math.PI / 2, 0.61]]]) {
      g.setTransform(2, 0, 0, 2, 0, 0);       // dpr
      g.scale(3.2, 3.2);                      // zoom
      for (const a of angles) g.rotate(a);
      const before = mod.ctxRotation(g);
      const stood = mod.upright(g, 40, 25);
      const after = mod.ctxRotation(g);
      if (stood) g.restore();
      out.push({ name, before: +before.toFixed(4), after: +after.toFixed(4), stood });
    }
    // …y que sin giro NO toque nada, que es lo que hace la migración honesta.
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.scale(3.2, 3.2);
    out.push({ name: "flat", before: 0, after: 0, stood: mod.upright(g, 40, 25) });
    return out;
  });
  await page2.close();
  return rows;
}

let ubad = 0;
for (const r of upOut) {
  if (r.name === "flat") {
    if (r.stood) { console.error("[rot] FAIL — upright() se activó sin giro alguno"); ubad++; }
    else console.log("[rot] sin giro         -> upright() no hace nada ✓");
    continue;
  }
  const ok = r.stood && Math.abs(r.after) < 1e-9;
  console.log(`[rot] ${r.name.padEnd(16)} -> CTM ${r.before} rad, tras upright() ${r.after} `
    + (ok ? "✓" : "✗"));
  if (!ok) ubad++;
}
if (ubad) {
  console.error("[rot] FAIL — upright() no deja el texto derecho: un rótulo de lado no es un rótulo");
  process.exit(1);
}
console.log("[rot] ok — el texto se para contra el mundo, venga el giro de la cámara o de la manzana");
await browser2.close();
