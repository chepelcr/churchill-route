// LOS VEHÍCULOS CON CUERPO — el del jugador, el tráfico y los estacionados.
//
// El arte no se rehace: el techo de cada vehículo ES su sprite de Canvas
// (`paintVehicle` para el jugador, `drawCar` para el tráfico), pintado una vez
// en una textura con `withSurface` y apoyado sobre una caja a la altura del
// vehículo. La caja lleva el color de la carrocería, un poco hundida bajo el
// borde del sprite, así que desde arriba se ve el mismo carro de siempre y de
// costado se ve que tiene cuerpo — y proyecta su sombra con el sol.
//
// Pocos cuerpos en vista (decenas), así que es un pool de mallas y no un
// InstancedMesh: cada uno necesita su textura. Las texturas se cachean por lo
// que las distingue (clase, color, tamaño, faros prendidos).
import { WORLD2D as W } from "../../world2d/index.js";
import { state, traffic, parked } from "../../game/state.js";
import { withSurface } from "../c2d/gfx.js";
import { drawCar, drawPlayerCarrying, paintVehicle } from "../c2d/entities.js";
import { groundBase } from "./ground.js";
import { tintMaterial } from "./tint.js";

// Alto de la carrocería por clase, en metros. El sprite es arte (un carro mide
// ~9 m de largo pintado), así que el alto va un poco por encima del real para
// que el cuerpo se lea a la escala del dibujo.
const HEIGHT_M = { bike: 1.5, car: 1.8, taxi: 1.8, pickup: 2.0, truck: 2.8, bus: 3.4, boat: 1.1 };
const TEX_SCALE = 4;          // texels por px de mundo
const BODY_INSET = 0.84;      // la caja, hundida bajo el borde del sprite
// …salvo en una moto o una bici, que desde arriba es una raya: su cuerpo es
// angosto o la caja se asoma como un rectángulo alrededor del dibujo
const SLIM = { bike: [0.62, 0.32] };

let T = null;
let boxGeo = null, topGeo = null;
const sprites = new Map();     // key → { tex, mat }
const sideMats = new Map();    // color → material
const pool = [];
let used = 0;
let root = null;
let playerSprite = null, playerKey = "", playerFrame = 0;

export function setupVehicles(THREE, sceneRoot) {
  T = THREE;
  root = sceneRoot;
  boxGeo = new T.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0, 0.5);
  topGeo = new T.PlaneGeometry(1, 1);
}

function spriteCanvas(w, h, paint) {
  const cw = Math.ceil(w * 1.7 * TEX_SCALE), ch = Math.ceil(h * 2.2 * TEX_SCALE);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d");
  g.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, cw / 2, ch / 2);
  withSurface(g, () => paint(g));
  return { canvas: c, w: cw / TEX_SCALE, h: ch / TEX_SCALE };
}

// El color del costado sale del PROPIO sprite: el promedio de su franja
// central, que es carrocería en todo vehículo del registro. Así no hay una
// segunda paleta que pueda contradecir al dibujo.
function bodyColorOf(canvas) {
  const g = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const d = g.getImageData(Math.floor(w * 0.3), Math.floor(h * 0.42), Math.max(1, Math.floor(w * 0.4)), Math.max(1, Math.floor(h * 0.16))).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return null;        // un sprite sin carrocería al centro: sin caja
  return `rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})`;
}

function spriteMaterial(canvas) {
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new T.MeshLambertMaterial({ map: tex, alphaTest: 0.35, transparent: false });
  tintMaterial(mat);
  return { tex, mat };
}

function sideMaterial(color) {
  let m = sideMats.get(color);
  if (!m) {
    m = new T.MeshLambertMaterial({ color: new T.Color().setStyle(color).multiplyScalar(0.8) });
    tintMaterial(m);
    sideMats.set(color, m);
  }
  return m;
}

function carSprite(c) {
  const night = state.weather === "night" ? 1 : 0;
  const key = `${c.kind || "car"}|${c.color}|${c.w}|${c.h}|${night}`;
  let s = sprites.get(key);
  if (!s) {
    const sc = spriteCanvas(c.w, c.h, () => drawCar({ ...c, x: 0, y: 0, ang: 0 }));
    s = { ...spriteMaterial(sc.canvas), w: sc.w, h: sc.h, body: bodyColorOf(sc.canvas) };
    sprites.set(key, s);
  }
  return s;
}

function bodyAt(i) {
  let b = pool[i];
  if (!b) {
    const group = new T.Group();
    const body = new T.Mesh(boxGeo, null);
    body.castShadow = true;
    const top = new T.Mesh(topGeo, null);
    top.castShadow = true;
    group.add(body, top);
    root.add(group);
    b = pool[i] = { group, body, top };
  }
  b.group.visible = true;
  return b;
}

function place(b, x, y, ang, w, h, hM, sprite, lift = 0, kind = "car") {
  const pxm = W.PX_PER_M;
  const hz = hM * pxm;
  b.group.position.set(x, y, groundBase(x, y) + lift);
  b.group.rotation.set(0, 0, ang);
  b.body.visible = !!sprite.body;
  if (sprite.body) b.body.material = sideMaterial(sprite.body);
  const [kx, ky] = SLIM[kind] || [BODY_INSET, BODY_INSET];
  b.body.scale.set(w * kx, h * ky, hz);
  b.top.material = sprite.mat;
  b.top.scale.set(sprite.w, sprite.h, 1);
  b.top.position.set(0, 0, hz + 0.05);
}

// El jugador: su sprite cambia con la carga (el churchill se derrite), así que
// la textura es una sola y se repinta cada tanto, no una por estado.
function playerSpriteFor(p, veh) {
  const key = `${state.vehicleKey}|${veh.w}|${veh.h}`;
  if (!playerSprite || key !== playerKey) {
    if (playerSprite) { playerSprite.tex.dispose(); playerSprite.mat.dispose(); }
    const sc = spriteCanvas(veh.w, veh.h, () => {});
    playerSprite = { ...spriteMaterial(sc.canvas), w: sc.w, h: sc.h, canvas: sc.canvas };
    playerKey = key;
    playerFrame = 0;
  }
  if (playerFrame++ % 12 === 0) {
    const c = playerSprite.canvas, g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, c.width / 2, c.height / 2);
    withSurface(g, () => {
      paintVehicle(g, state.vehicleKey, veh);
      // el cubo de la carga, en el marco del vehículo (el alzado lo pone three)
      if (state.carrying) drawPlayerCarrying({ x: 0, y: (state.elev || 0) * 7, a: 0 }, veh);
    });
    playerSprite.tex.needsUpdate = true;
    if (playerSprite.body === undefined) playerSprite.body = bodyColorOf(c);
  }
  return playerSprite;
}

/** Un cuadro: acomoda un cuerpo por vehículo en vista y esconde los que sobran. */
export function syncVehicles(view) {
  used = 0;
  const pad = 30;
  const inView = (o) => o.x > view.x0 - pad && o.x < view.x1 + pad && o.y > view.y0 - pad && o.y < view.y1 + pad;
  for (const list of [parked, traffic]) {
    for (const c of list) {
      if (!inView(c)) continue;
      const s = carSprite(c);
      place(bodyAt(used++), c.x, c.y, c.ang || 0, c.w, c.h, HEIGHT_M[c.kind] || HEIGHT_M.car, s, 0, c.kind);
    }
  }
  if (!state.attract && state.running) {
    const p = state.p, veh = state.veh;
    const s = playerSpriteFor(p, veh);
    const hM = HEIGHT_M[veh.kind] || HEIGHT_M.car;
    const lift = (state.elev || 0) * W.PX_PER_M;   // el barro va ~1 m arriba
    place(bodyAt(used++), p.x, p.y, p.a, veh.w, veh.h, hM, s, lift, veh.kind);
  }
  for (let i = used; i < pool.length; i++) pool[i].group.visible = false;
  return used;
}
