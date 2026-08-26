// EL SUELO NO SE MUEVE. La prueba de que inclinar la cámara no toca el volante.
//
//   node tools/smoke-lean.mjs
//
// Todo este hito descansa en una sola afirmación: bajo cámara ORTOGRÁFICA se
// puede inclinar la vista y devolver el plano del suelo a su sitio exacto, de
// modo que lo único que cambia es que lo alto se levanta. Si eso es falso, el
// mapa del suelo se achata, `applyTouch` compara un ángulo de pantalla contra
// un rumbo de mundo que ya no coincide, y manejar se vuelve otra cosa.
//
// No necesita navegador ni juego: es geometría, y se mide contra el three de
// verdad —la misma versión que el juego carga— porque una matriz que yo
// escriba a mano prueba mi álgebra, no la de la librería.
import * as THREE from "three";

const D = 10000;
const FAIL = [];
const ok = (cond, msg) => { if (!cond) FAIL.push(msg); return cond; };

// El mismo encuadre que `applyCamera`, con `phi` como única variable.
function makeCamera(phi, rotation, worldWidth, worldHeight, camX, camY) {
  const k = Math.cos(phi), sinPhi = Math.sin(phi);
  const cam = new THREE.OrthographicCamera(
    -worldWidth / 2, worldWidth / 2,
    worldHeight / 2 * k, -worldHeight / 2 * k, 0.1, 20000,
  );
  const upX = -Math.sin(rotation), upY = Math.cos(rotation);
  cam.position.set(camX - upX * D * sinPhi, -camY - upY * D * sinPhi, D * k);
  cam.up.set(upX * k, upY * k, sinPhi);
  cam.lookAt(camX, -camY, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

// Un punto del MUNDO (x, y hacia abajo, altura en px) a NDC.
function project(cam, worldX, worldY, heightPx) {
  return new THREE.Vector3(worldX, -worldY, heightPx)
    .applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
}

const W = 400, H = 225, CX = 24000, CY = 15400;
const GROUND = [
  [CX, CY], [CX + 180, CY - 90], [CX - 170, CY + 100],
  [CX + 60, CY + 110], [CX - 55, CY - 105],
];

for (const rotation of [0, Math.PI / 2, 0.61]) {
  const flat = makeCamera(0, rotation, W, H, CX, CY);
  for (const phi of [10, 20, 30, 40, 51.68].map((d) => d * Math.PI / 180)) {
    const leaned = makeCamera(phi, rotation, W, H, CX, CY);

    // 1. EL SUELO. Todo punto a z = 0 tiene que caer en el MISMO sitio.
    let worst = 0;
    for (const [x, y] of GROUND) {
      const a = project(flat, x, y, 0), b = project(leaned, x, y, 0);
      worst = Math.max(worst, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
    // NDC va de -1 a 1 sobre 225 px de alto: 1e-9 son 1e-7 px.
    const groundStill = worst < 1e-9;
    ok(groundStill, `suelo se movió ${worst.toExponential(2)} NDC `
      + `(giro ${(rotation * 180 / Math.PI).toFixed(0)}°, lean ${(phi * 180 / Math.PI).toFixed(0)}°)`);

    // 2. LA ALTURA. Un punto a `h` sube exactamente h·tan(phi) hacia arriba
    //    de la pantalla — ni más ni menos, y en la dirección del giro.
    const h = 40;                                   // 16 m a 2.5 px/m
    const base = project(leaned, CX, CY, 0);
    const top = project(leaned, CX, CY, h);
    const riseNdc = top.y - base.y;
    const risePx = riseNdc * (H / 2);               // NDC -> px de pantalla
    const want = h * Math.tan(phi);
    ok(Math.abs(risePx - want) < 1e-6,
      `subida ${risePx.toFixed(6)} px, esperada ${want.toFixed(6)}`);
    // …y NADA se corre de lado al subir: si esto falla, un edificio se inclina
    // en diagonal y deja de estar sobre su propia huella.
    ok(Math.abs(top.x - base.x) < 1e-9,
      `la altura se corrió de lado ${(top.x - base.x).toExponential(2)} NDC`);

    if (rotation === 0 && Math.abs(phi - Math.PI / 6) < 1e-9) {
      console.log(`[lean] 30°: un bloque de 16 m sube ${risePx.toFixed(1)} px `
        + `y el suelo se mueve ${worst.toExponential(1)} NDC`);
    }
  }
}

// 3. A CERO ES LA CÁMARA DE ANTES, término por término.
{
  const flat = makeCamera(0, 0.61, W, H, CX, CY);
  ok(flat.position.z === D && flat.position.x === CX,
    "a lean 0 la cámara ya no está cenital");
  ok(Math.abs(flat.up.z) < 1e-15, "a lean 0 el 'arriba' ganó componente Z");
}

if (FAIL.length) {
  for (const f of FAIL) console.error(`[lean] FAIL — ${f}`);
  process.exit(1);
}
console.log("[lean] ok — el suelo se queda en planta a todo ángulo y a todo giro; "
  + "sólo la altura se levanta, y exactamente h·tan(lean)");
