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
await browser.close();
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
