// LA GENTE EN 3D — el mismo lenguaje que el DJ de la feria: piernas, torso con la camisa de SU
// color, cabeza y pelo, levantados con la perspectiva de la casa y con su sombra al sol.
//
// Antes cada persona era una figura en ALZADO (de pie en la pantalla, la cabeza hacia -y), que en
// un mundo visto desde arriba y con perspectiva se lee como un recorte pegado al piso. Acá la
// persona es un cuerpo: lo que se ve desde arriba son los hombros y la cabeza, y al alejarse de
// la cámara asoma el costado. Es BARATO a propósito —hay cientos de peatones— y por eso no usa el
// aparejo de la feria: un corrimiento por persona (lineal en la altura, con el tope repartido
// sobre su estatura) y `paintSweep` para las paredes, que es lo mismo que usan los carros.
//
// Las medidas y las tintas son del registro (`actors.json → person3d`); el color de la camisa es
// el de siempre —el tono de la INSTANCIA y la saturación/brillo del PAPEL—, así que la multitud
// sigue siendo la misma gente, ahora con cuerpo.
import ACTORS from "../../assets/actors.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { state } from "../../game/state.js";
import { PX_PER_M } from "../../domain/units.js";
import { ctx, hash01 } from "./gfx.js";
import { facingEdges, paintSweep, parallaxOffset } from "./depth.js";
import { sunShadow } from "./shadows.js";

const P3 = ACTORS.person3d;
const WALKER = ACTORS.actors.walker;
const PAR = EFFECTS.parallax || {};
const UNCAPPED = { ...PAR, maxOffsetPx: 0 };
const TAU = Math.PI * 2;

const hsl = (h, sl, k = 1) => `hsl(${Math.round(h)} ${sl[0]}% ${Math.round(sl[1] * k)}%)`;
// la misma camisa en hex: las caras del aparejo se sombrean con `mixColor`, que no lee `hsl()`
function hslHex(h, [sp, lp]) {
  const s = sp / 100, l = lp / 100, f = (n) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

/** Hacia dónde mira: su rumbo si lo tiene, si no hacia donde se movió, si no su normal. */
function facingOf(pe) {
  if (Number.isFinite(pe.ang)) return pe.ang;
  const lx = pe._fx, ly = pe._fy;
  pe._fx = pe.x; pe._fy = pe.y;
  if (lx != null) {
    const dx = pe.x - lx, dy = pe.y - ly;
    if (dx * dx + dy * dy > 1e-4) pe._fa = Math.atan2(dy, dx);
  }
  if (pe._fa != null) return pe._fa;
  if (pe.nx || pe.ny) return Math.atan2(pe.ny || 0, pe.nx || 0);
  return hash01((pe.hue || 0) * 0.37 + (pe.ph || 0)) * TAU;
}

/**
 * Una persona de pie en (pe.x, pe.y). `look`: lo que la hace SUYA —
 *   shirt [s, l] o body (color fijo), skin, raised (brazos arriba), wave (un brazo saluda),
 *   bag (bolso al costado), hat {brim, crown} (en vez del pelo), rod {ink} (caña hacia nx, ny),
 *   jump (cuánto brinca, en metros).
 */
export function paintPerson3d(pe, look = {}) {
  const ppm = PX_PER_M, S = P3, k = Number(pe.scale || 1);
  const x = pe.x, y = pe.y, a = facingOf(pe), ca = Math.cos(a), sa = Math.sin(a);
  const hue = Number.isFinite(pe.hue) ? pe.hue : 200;
  const skin = look.skin || WALKER.skin;
  const shirt = look.body || hsl(hue, look.shirt || WALKER.shirt);
  const shirtSide = look.body ? S.bodySide : hsl(hue, look.shirt || WALKER.shirt, S.sideK);
  const ph = pe.ph || 0;
  const jump = look.jump ? Math.abs(Math.sin(ph * S.jumpRate)) * look.jump : Math.abs(Math.sin(ph)) * S.bobM;
  // el tope de la perspectiva se reparte sobre la estatura: la persona entera se encoge igual
  const top = S.topM * k;
  const raw = parallaxOffset(state.cam, x, y, top, ppm, UNCAPPED);
  const len = Math.hypot(raw.dx, raw.dy), cap = PAR.maxOffsetPx || 0;
  const q = (cap > 0 && len > cap ? cap / len : 1) / top;
  const L = (z) => [raw.dx * q * z, raw.dy * q * z];
  // un rectángulo en planta: `d` a lo largo de la mirada, `w` de hombro a hombro, corrido (fu, fv)
  const rect = (w, d, fu = 0, fv = 0) => {
    const cx = x + (fu * ca - fv * sa) * ppm, cy = y + (fu * sa + fv * ca) * ppm;
    const hw = w / 2 * ppm, hd = d / 2 * ppm, out = [];
    for (const [u, v] of [[-hd, -hw], [hd, -hw], [hd, hw], [-hd, hw]]) out.push(cx + u * ca - v * sa, cy + u * sa + v * ca);
    return out;
  };
  const box = (pts, z0, z1, topInk, sideInk) => {
    const o0 = L(z0), o1 = L(z1), base = pts.map((p, i) => p + o0[i % 2]);
    const dx = o1[0] - o0[0], dy = o1[1] - o0[1];
    if (dx || dy) { ctx.fillStyle = sideInk; paintSweep(ctx, base, dx, dy, facingEdges(base, dx, dy)); }
    ctx.fillStyle = topInk; ctx.beginPath();
    for (let i = 0; i < base.length; i += 2) ctx.lineTo(base[i] + dx, base[i + 1] + dy);
    ctx.closePath(); ctx.fill();
  };
  const at = (fu, fv, z) => { const o = L(z); return [x + (fu * ca - fv * sa) * ppm + o[0], y + (fu * sa + fv * ca) * ppm + o[1]]; };
  const disc = (fu, fv, z, r, ink) => { const p = at(fu, fv, z); ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.6, r * ppm), 0, TAU); ctx.fill(); };
  const line = (p0, p1, wM, ink) => { ctx.strokeStyle = ink; ctx.lineWidth = Math.max(0.6, wM * ppm); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); };

  const [lw, ld, lh] = S.legsM.map((v) => v * k), [tw, td, th] = S.torsoM.map((v) => v * k);
  const hr = S.headM * k, z1 = jump + lh, z2 = z1 + th, zh = z2 + hr * 0.9;

  // la sombra: de los pies hacia donde la tira el sol, del largo de su estatura
  const sh = sunShadow(top);
  if (sh.alpha > 0) {
    ctx.save(); ctx.globalAlpha = sh.alpha;
    line([x, y], [x + sh.dx, y + sh.dy], S.shadowWM * k, look.shadow || WALKER.shadow);
    ctx.restore();
  }
  box(rect(lw, ld), jump, z1, S.pants, S.pantsSide);
  if (look.bag) box(rect(S.bagM[0] * k, S.bagM[1] * k, 0, (tw / 2 + S.bagM[0] / 2) * k), jump + lh * 0.45, z1 + th * 0.2, look.bag, look.bag);
  box(rect(tw, td), z1, z2, shirt, shirtSide);
  const arm = (side, up) => {
    const sp = at(0, side * tw / 2, z2 - 0.05), hp = at(up ? 0.1 : 0.15, side * (tw / 2 + (up ? 0.25 : 0.05)), up ? z2 + S.raiseM : z1 + 0.1);
    line(sp, hp, S.armM * k, skin);
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hp[0], hp[1], Math.max(0.6, S.armM * k * 0.8 * ppm), 0, TAU); ctx.fill();
  };
  if (look.raised) { arm(-1, true); arm(1, true); }
  else if (look.wave) arm(1, Math.sin(ph * 3) > -0.2);
  if (look.rod) {
    const base = at(0.2, 0.25, z1 + 0.2), out = Math.atan2(pe.ny || 0, pe.nx || 1);
    const tip = [base[0] + Math.cos(out) * S.rodM * ppm, base[1] + Math.sin(out) * S.rodM * ppm];
    const lt = L(z2 + 1.2);
    line(base, [tip[0] + lt[0], tip[1] + lt[1]], 0.06, look.rod);
  }
  disc(0, 0, zh, hr, skin);
  if (look.hat) { disc(0, 0, zh + 0.08, hr * 1.6, look.hat.brim); disc(0, 0, zh + 0.16, hr * 0.85, look.hat.crown); }
  else disc(-hr * 0.35, 0, zh + 0.06, hr * 0.78, S.hair[Math.floor(hash01(hue * 0.13 + 3.1) * S.hair.length)]);
}

/**
 * EL CHOFER, sobre el aparejo de `rig3d.js` (`R`, en el marco del vehículo, metros): la misma gente
 * que camina por el puerto, sentada en `d.at` con el asiento a `d.seatM` y las manos en `d.hands`.
 * `D` es el registro del chofer (`vehicles.json → driver3d`); `ink` resuelve `$color`/`$roof`.
 */
export function paintRider(R, d, D, ink, hwM, hhM) {
  const k = d.scale || 1, u = d.at[0] * hwM, v = d.at[1] * hhM, z0 = d.seatM;
  const [td, tw, th] = D.torsoM.map((x) => x * k), hr = D.headM * k;
  const zl = d.standing ? D.legsM[2] * k : 0;
  if (d.standing) R.at(z0 + zl, () => R.box(u, v, z0, z0 + zl, D.legsM[0] * k, D.legsM[1] * k, D.pants));
  const zt = z0 + zl, zs = zt + th, zh = zs + hr * 0.9;
  R.at(zs, () => R.box(u, v, zt, zs, td, tw, D.shirt));
  if (d.hands) {
    const [hu, hv, hz] = d.hands;
    R.at(zs + 0.01, () => {
      for (const s of [-1, 1]) {
        const hand = [hu * hwM, s * hv * hhM, hz];
        R.line([[u + td * 0.2, v + s * tw * 0.45, zs - 0.12], hand], D.armM * k, D.skin);
        R.dot(hand, D.armM * k * 0.8, D.skin);
      }
    });
  }
  R.at(zh + hr, () => {
    R.poly(R.circle([u, v, zh], [1, 0, 0], [0, 1, 0], hr, 14), d.helmet ? ink(d.helmet) : D.skin);
    if (!d.helmet) R.poly(R.circle([u - hr * 0.3, v, zh + 0.06], [1, 0, 0], [0, 1, 0], hr * 0.78, 12), D.hair);
    else R.poly(R.circle([u + hr * 0.45, v, zh - 0.05], [1, 0, 0], [0, 1, 0], hr * 0.45, 10), D.skin);
  });
}

/**
 * UNA PERSONA BAILANDO sobre el aparejo (`R`, metros), parada en (u, v) a `z0` de alto — la gente de
 * la cubierta de pasajeros del ferry. Las mismas medidas y tintas que el peatón (`person3d`), con
 * los brazos arriba que se mecen y un brinco al compás: `o` = { t (s), ph, hue, scale, jumpM, rate,
 * shirt [s, l], ang }.
 */
export function paintDancer(R, u, v, z0, o) {
  const S = P3, k = o.scale || 1, a = o.ang || 0, ca = Math.cos(a), sa = Math.sin(a);
  const beat = o.t * o.rate + o.ph, z = z0 + Math.abs(Math.sin(beat)) * o.jumpM;
  const [lw, ld, lh] = S.legsM.map((x) => x * k), [tw, td, th] = S.torsoM.map((x) => x * k), hr = S.headM * k;
  const z1 = z + lh, z2 = z1 + th, zh = z2 + hr * 0.9;
  const shirt = hslHex(o.hue, o.shirt || WALKER.shirt), skin = WALKER.skin;
  const off = (fu, fv) => [u + fu * ca - fv * sa, v + fu * sa + fv * ca];
  R.at(z1, () => R.box(u, v, z, z1, ld, lw, { top: S.pants, side: S.pantsSide }, a));
  R.at(z2, () => R.box(u, v, z1, z2, td, tw, shirt, a));
  R.at(z2 + S.raiseM * k, () => {
    for (const s of [-1, 1]) {
      const sw = Math.sin(beat * 1.3 + s) * 0.35 * k;
      const sh = off(0, s * tw / 2), hd = off(sw, s * (tw / 2 + 0.3 * k));
      const hand = [hd[0], hd[1], z2 + S.raiseM * k * (0.75 + 0.25 * Math.sin(beat + s))];
      R.line([[sh[0], sh[1], z2 - 0.05], hand], S.armM * k, skin);
      R.dot(hand, S.armM * k * 0.8, skin);
    }
  });
  R.at(zh + hr, () => {
    R.poly(R.circle([u, v, zh], [1, 0, 0], [0, 1, 0], hr, 12), skin);
    const hp = off(-hr * 0.35, 0);
    R.poly(R.circle([hp[0], hp[1], zh + 0.06], [1, 0, 0], [0, 1, 0], hr * 0.78, 10), S.hair[Math.floor(hash01(o.hue * 0.13 + 3.1) * S.hair.length)]);
  });
}
