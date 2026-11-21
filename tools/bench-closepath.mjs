// CUÁNTO CUESTA UN `closePath` EN UN CAMINO LARGO — la medición detrás de `bodies.js → paintShadow`.
//
//   node tools/bench-closepath.mjs
//
// En Chromium cada `closePath` cuesta proporcional al largo del camino ENTERO, así que un camino que
// junta cientos de subcaminos y cierra cada uno se vuelve cuadrático. Para un camino que sólo se
// RELLENA el cierre sobra: `fill()` cierra cada subcamino por su cuenta y los píxeles son los mismos.
// Medido el 2026-11-21: 1 600 cuadriláteros, 16,6 ms con cierre y 0,29 ms sin él.
//
// Si algún día esta tabla sale plana, el navegador lo arregló y la regla se puede olvidar.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
const rows = await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 800; c.height = 600;
  const g = c.getContext("2d");
  const run = (N, close, usePath2D) => {
    const t0 = performance.now();
    for (let rep = 0; rep < 20; rep++) {
      const P = usePath2D ? new Path2D() : g;
      if (!usePath2D) g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i * 7) % 700, y = (i * 13) % 500;
        P.moveTo(x, y); P.lineTo(x + 10, y); P.lineTo(x + 10, y + 10); P.lineTo(x, y + 10);
        if (close) P.closePath();
      }
      if (usePath2D) g.fill(P); else g.fill();
    }
    return (performance.now() - t0) / 20;
  };
  return [100, 400, 1600].map((N) => ({
    N, close: run(N, true, false), open: run(N, false, false),
    path2dClose: run(N, true, true), path2dOpen: run(N, false, true),
  }));
});
await browser.close();
console.log("subcaminos   ctx+close  ctx sin   Path2D+close  Path2D sin   (ms por relleno)");
for (const r of rows) {
  console.log(String(r.N).padStart(10), ...[r.close, r.open, r.path2dClose, r.path2dOpen]
    .map((v) => v.toFixed(3).padStart(11)));
}
