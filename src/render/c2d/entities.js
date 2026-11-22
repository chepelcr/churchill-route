// Moving things + the player: peds, swimmers, traffic, trains, gulls, boats,
// vendors, animals, the delivery target, arcade coins and the vehicle sprite.
import { state } from "../../game/state.js";
import { nightLevel } from "../../game/daynight.js";
import { PX_PER_M } from "../../domain/units.js";
import { evalOn, traceVehicleSilhouette } from "../vehicleShapes.js";
import { partColor, vehicleCargo, vehicleEffects, vehicleParts } from "../../game/vehicles.js";
import { sunShadow } from "./shadows.js";
import { parallaxOffset } from "./depth.js";
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { npcArt } from "../../game/npcs.js";
import { paintParts } from "./shapes.js";
import {
  applyVehicleHeel, paintHeadlights as paintSystemHeadlights,
  paintTurnWind, paintVehicleShadow, paintWake,
} from "./systemShapes.js";
import { actorAnimationValues, paintActor, paintActorForm, resolveActorRecord } from "./actorShapes.js";
import { VEHICLE_MEDIUM } from "../../domain/vocabulary.generated.js";
import { ctx, lastT, mixColor } from "./gfx.js";
import ACTORS from "../../assets/actors.json" with { type: "json" };
import { hslHex, paintPerson3d, paintRider } from "./people3d.js";
import { drawCart3d } from "./furniture3d.js";
import VEHICLE_REG from "../../assets/vehicles.json" with { type: "json" };
import { fillRigShadow, makeRig, withShadowLayer } from "./rig3d.js";
import { hullOutline, paintHullSides } from "./vesselRigs.js";
import PRODUCTS_JSON from "../../../content/world/products.json" with { type: "json" };

// actors.json is the visual source of truth. This file only maps simulation
// state into the interpreter's finite frame: pose, variant, time and the sun's
// shadow vector. No actor identity owns Canvas geometry here.
const A = ACTORS.actors;
const PRODUCTS = PRODUCTS_JSON.products;

function poseFromState(record, entity) {
  for (const rule of record.statePoses || []) {
    if (entity[rule.field] === rule.equals) return rule.pose;
  }
  return undefined;
}

function actorFrame(id, entity = {}, timeMs = lastT, extra = {}) {
  const record = resolveActorRecord(ACTORS, id);
  const pose = extra.pose ?? poseFromState(record, entity);
  const sh = sunShadow(record.heightM ?? 1.7);
  const rotationField = pose && record.poseRotation?.[pose];
  return {
    x: entity.x || 0,
    y: entity.y || 0,
    phase: entity.ph || 0,
    timeMs,
    hue: Number.isFinite(entity.hue) ? entity.hue : 200,
    color: entity.color,
    nx: entity.nx || 1,
    ny: entity.ny || 0,
    pose,
    rotation: rotationField ? Number(entity[rotationField] || 0) : 0,
    scale: Number(entity.scale || 1),
    shadowDx: sh.dx,
    shadowDy: sh.dy,
    shadowAlpha: sh.alpha,
    ...extra,
  };
}

/**
 * UNA FIGURA EN ALZADO SE PARA EN LA PANTALLA. La gente se dibuja de pie —la
 * cabeza en -y del MUNDO— y con la cámara girada (El Cocal, 90°) peatones,
 * vendedores y el cliente que espera salían ACOSTADOS. Se gira de vuelta
 * alrededor de sus pies, y el offset solar entra girado al revés para que la
 * sombra siga cayendo hacia donde cae la de un edificio. Lo visto desde arriba
 * (carros, lanchas, gaviotas, cardúmenes) NO pasa por aquí.
 */
function paintStanding(id, frame) {
  const rot = state.cam.rot || 0;
  if (!rot) return paintActor(ctx, ACTORS, id, frame);
  const c = Math.cos(rot), s = Math.sin(rot);
  const { shadowDx: dx, shadowDy: dy } = frame;
  ctx.save();
  ctx.translate(frame.x, frame.y); ctx.rotate(-rot); ctx.translate(-frame.x, -frame.y);
  const out = paintActor(ctx, ACTORS, id,
    { ...frame, shadowDx: c * dx - s * dy, shadowDy: s * dx + c * dy });
  ctx.restore();
  return out;
}

function paintHull(g, L, H, topsides = ACTORS.hull.topsides) {
  paintActorForm(g, ACTORS, ACTORS.hull.form, { L, H, topsides });
}

function drawArcadeCoin(c, t) {
  const fallback = c.silver ? ACTORS.coins.silver : ACTORS.coins.gold;
  const metal = c.palette || ACTORS.coins[c.coinType] || fallback;
  paintActorForm(ctx, ACTORS, metal.form || "coin", {
    x: c.x, y: c.y, phase: c.t || 0, timeMs: t * 1000,
    radius: metal.r, fontBase: c.silver ? 11 : 9,
    rim: metal.rim, face: metal.face, mark: metal.mark,
  });
}

// LA GENTE ES UN CUERPO (`people3d.js`): el papel de cada uno sólo dice qué viste y qué hace.
function lookOf(id) {
  const r = resolveActorRecord(ACTORS, id);
  return { shirt: r.shirt, skin: r.skin, shadow: r.shadow, raised: Boolean(r.values?.raised),
    jump: r.values?.raised ? ACTORS.person3d.raiseM * 0.4 : 0 };
}
function drawPed(pe) {
  const art = pe.editorNpc ? (pe.drawStyle || "person") : npcArt(pe.kind || "walker");
  const id = ACTORS.artMap[art] || ACTORS.artMap.walker;
  paintPerson3d(pe, lookOf(id));
}

// EL PLAYERO. A person on the sand is a person in a swimsuit, and from above
// that is two things: bare skin instead of a shirt, and a towel under whoever
// is not walking. The sunbather is drawn LYING DOWN — a standing figure that
// happens not to move reads as somebody waiting for a bus on the beach.
function drawPlayero(pe) {
  // acostado en su toalla es plano de verdad: se queda en su dibujo; caminando, es un cuerpo
  if (pe.stationary) { paintStanding("playero", actorFrame("playero", pe)); return; }
  const r = resolveActorRecord(ACTORS, "playero");
  paintPerson3d(pe, { shirt: r.swimsuit, skin: r.skin, shadow: r.shadow });
}

// EL JUGADOR. Leaning into the run, arms out for balance, facing the ball —
// `ang` is set by the advancer every frame, which is what makes a mejenga read
// as a game: eight people all looking at the same point.
function drawJugador(pe) {
  paintPerson3d(pe, lookOf("jugador"));
}

// LA BOLA. One per mejenga, drawn in the ped pass so it sits among the players
// rather than under the whole world. The panels turn with `ph`, which the game
// advances by how far the ball has actually rolled.
function drawBeachBall(G) {
  const b = G.ball;
  paintActor(ctx, ACTORS, "ball", actorFrame("ball", b));
}

function drawEditorNpc(pe, style = pe.drawStyle) {
  const id = ACTORS.artMap[style] || ACTORS.artMap.person;
  paintPerson3d(pe, lookOf(id));
}
// Somebody at a parada. The whole point of the type is the WAITING: standing
// still with a bag, looking down the street the bus comes from, which is what
// tells you at a glance that the caseta is in use. Once they are moving — to
// the door, or off it and down the acera — they are drawn as the walker they
// are about to become, so the handover to `advancePed` has no visible seam.
// This branch is TEMPORARY per person: `joinTheSidewalk` drops the kind.
function drawPassenger(pe) {
  const r = resolveActorRecord(ACTORS, "passenger");
  paintPerson3d(pe, { ...lookOf("passenger"), bag: r.bag });
}
// EL PESCADOR. He is the same person as everyone else in the puerto — the same
// narrow body in his own `hue`, the same 2.2 px head, the same soft shadow —
// SITTING DOWN: the body is shorter and the head rides lower, because he is on
// a thwart and not on his feet. What makes him a fisher is only what he carries:
// the sombrero against the sun (from above you see the hat first and the back of
// his head behind it), the caña out over the bow, and a line whose ripple ring
// moves with the swell.
//
// He is drawn in HIS BOAT'S FRAME, not on a surface — the panga leans and bobs
// and he goes with her — which is why his registry host is `water` and his
// movement `stationary`. `pe.x`/`pe.y` are therefore boat-local when the estero
// draws him, and world coordinates when he is an authored NPC; the drawing is
// the same either way, and the caller owns the transform.
function drawFisher(pe) {
  paintStanding("fisher", actorFrame("fisher", pe));
}
// EL MUELLERO. People used to fish off the Muelle de Cruceros and do not any
// more, and this is that, kept — drive to the end of the muelle and they are
// leaning on the rail with a caña over the side.
//
// He is the SAME PERSON as everyone else in the port: the walker's body, head
// and hue, standing rather than seated (which is the whole difference from
// `fisher`, who rides a panga). What he adds is the lean and the tackle — and
// the direction of both comes from `nx,ny`, the outboard normal of the deck
// edge he picked, so a muelle that runs north-south and one that runs at 45°
// both get people facing the water instead of facing screen-right.
function drawMuellero(pe) {
  const r = resolveActorRecord(ACTORS, "muellero");
  paintPerson3d(pe, { ...lookOf("muellero"), hat: { brim: r.hatBrim, crown: r.hatCrown }, rod: r.rod });
}

// A swimmer: a head just above the water with a ripple wake + stroking arms.
function drawSwimmer(pe) {
  paintActor(ctx, ACTORS, "swimmer", actorFrame("swimmer", pe));
}
// EL TRÁFICO EN 3D. La sombra es el contorno corrido por el sol (como siempre) y el cuerpo es su
// receta de cajas (`actors.json → traffic.kinds.<tipo>.body3d`), armada con el aparejo de la feria
// con la MISMA perspectiva que los edificios: llantas, carrocería, cabina con sus vidrios, techo y
// focos. `at`/`size` son fracciones del vehículo, así que un carro de 23 px y un bus de 41 salen de
// recetas sin números por tamaño.
const V3D = ACTORS.vehicle3d;
// UN CARRO SON DOS PASADAS: `drawCar(c, "shadow")` y después `drawCar(c, "body")`. El compositor
// pinta primero las sombras de TODOS los carros y después las carrocerías, así la sombra de un carro
// ya no le cae encima al de al lado. La sombra es UN relleno de su silueta (`rigShadow`), sin el lienzo
// aparte que costaba una sincronización por carro. Sin pasada, las dos, como antes.
function drawCar(c, pass = null) {
  const kind = A.traffic.kinds[c.kind] || A.traffic.kinds.car;
  const heightM = kind.heightM ?? A.traffic.heightM;
  const angle = c.ang || 0, ca = Math.cos(angle), sa = Math.sin(angle);
  const local = (v) => ({ dx: v.dx * ca + v.dy * sa, dy: -v.dx * sa + v.dy * ca });
  const sh = local(sunShadow(heightM));
  const color = (spec) => {
    if (spec === "$color") return c.color;
    if (typeof spec === "string" && spec.startsWith("$")) {
      return A.car[spec.slice(1)] ?? A.traffic[spec.slice(1)] ?? spec;
    }
    return spec;
  };
  const hw = c.w / 2, hh = c.h / 2, ppm = PX_PER_M, hwM = hw / ppm, hhM = hh / ppm;
  // la sombra es la de sus piezas: la misma receta con el mapeo del sol
  if (pass !== "body") rigShadow((m) => {
    const S = makeRig(ctx, c.x, c.y, angle, ppm, state.cam, m, V3D.shade, heightM);
    rigBoxes(S, kind.body3d || [], hwM, hhM, color); S.flush(); return S;
  });
  if (pass === "shadow") return;
  // EL TRÁFICO TAMBIÉN ALUMBRA. Un carro sin faros en una calle con pozos de
  // luz y oscuridad entre ellos es un carro invisible que se te viene encima —
  // y las calaveras son lo único que se ve de uno que se aleja.
  if (nightLevel() > 0.001) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(angle); paintHeadlights(ctx, hw, hh); ctx.restore();
  }
  const R = makeRig(ctx, c.x, c.y, angle, ppm, state.cam, "cam", V3D.shade, heightM);
  rigBoxes(R, kind.body3d || [], hwM, hhM, color);
  R.flush();
}

/** La sombra de un cuerpo armado con el aparejo: su silueta en UN relleno, con su alfa, sin lienzo
 *  aparte (`rig3d.js → fillRigShadow`). `build(mode)` arma el aparejo en ese modo, lo vacía y lo devuelve. */
function rigShadow(build) {
  fillRigShadow(ctx, sunShadow(1).alpha * V3D.shadowAlpha, V3D.shade.shadow, build);
}

/** Una receta de cajas (`body3d`) sobre el aparejo: `at`/`size` en fracciones del vehículo, `z` en
 *  metros, y lo pegado a una cara sólo si esa cara mira a la cámara. La comparten el tráfico y el
 *  vehículo del jugador. */
function rigBoxes(R, recipe, hwM, hhM, color) {
  for (const b of recipe) {
    if (b.face && !R.faces([b.at[0] * hwM, b.at[1] * hhM, (b.z[0] + b.z[1]) / 2], [b.face[0], b.face[1], 0])) continue;
    const ink = { top: color(b.top || b.ink), side: color(b.side || b.ink) };
    R.at(b.key ?? b.z[1], () => R.box(b.at[0] * hwM, b.at[1] * hhM, b.z[0], b.z[1], b.size[0] * 2 * hwM, b.size[1] * 2 * hhM, ink));
  }
}

/** El vehículo del jugador EN 3D: su receta de cajas y su chofer, donde está el carro (x, y). */
function paintPlayer3d(x, y, a, veh, { body = true, rider = true, shadow = true } = {}) {
  const ppm = PX_PER_M, hwM = veh.w / 2 / ppm, hhM = veh.h / 2 / ppm, topM = (veh.heightM || 1.5) + 1.5;
  const ink = (spec) => partColor(spec, veh);
  const build = (R) => {
    if (body && veh.body3d) rigBoxes(R, veh.body3d, hwM, hhM, ink);
    if (rider && veh.driver) paintRider(R, veh.driver, VEHICLE_REG.driver3d, ink, hwM, hhM);
    R.flush();
  };
  // la sombra es la de sus piezas y la de su chofer
  if (shadow) rigShadow((m) => { const R = makeRig(ctx, x, y, a, ppm, state.cam, m, V3D.shade, topM); build(R); return R; });
  build(makeRig(ctx, x, y, a, ppm, state.cam, "cam", V3D.shade, topM));
}

/** La sombra de una lancha del jugador: su SILUETA, corrida por el sol a la altura de su borda, y la
 *  de su chofer — en el mismo lienzo, de una vez. */
function paintBoatShadow(p, veh) {
  const h = veh.heightM ?? V3D.defaultHeightM, sh = sunShadow(h), ppm = PX_PER_M;
  const c = Math.cos(-p.a), s = Math.sin(-p.a), lx = sh.dx * c - sh.dy * s, ly = sh.dx * s + sh.dy * c;
  // el casco es una SILUETA trazada, no cajas: ésta sí va en su lienzo aparte
  const a = sunShadow(1).alpha * V3D.shadowAlpha;
  if (a > 0.001) withShadowLayer(ctx, p.x, p.y, Math.max(veh.w, veh.h) / 2 + Math.hypot(sh.dx, sh.dy) + 8, a, (g) => {
    g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.translate(lx, ly);
    g.fillStyle = V3D.shade.shadow; traceVehicleSilhouette(g, state.vehicleKey, veh); g.fill();
    g.restore();
    if (veh.driver) {
      const R = makeRig(g, p.x, p.y, p.a, ppm, state.cam, "sun", V3D.shade, h + 1.5);
      paintRider(R, veh.driver, VEHICLE_REG.driver3d, (spec) => partColor(spec, veh), veh.w / 2 / ppm, veh.h / 2 / ppm);
      R.flush();
    }
  });
}

// The Ferrocarril heritage train: red loco + two cream wagons, each posed
// on the rail by spawns.js (tr.cars[0] = loco).
function drawTrain(tr, t) {
  const rec = resolveActorRecord(ACTORS, "train");
  const C = rec.composition, B = rec.body3d;
  if (B) {
    // EN 3D, como el tráfico: cajas del registro sobre el aparejo, primero todas
    // las sombras y después los coches, del último al primero
    const ppm = PX_PER_M, sh = sunShadow(rec.heightM);
    const color = (spec) => (typeof spec === "string" && spec.startsWith("$") ? rec[spec.slice(1)] ?? spec : spec);
    const each = (fn) => {
      for (let k = tr.cars.length - 1; k >= 0; k--) {
        const c = tr.cars[k], f = k === 0 ? B.first : B.rest;
        fn(c, f, f.halfPx[0] / ppm, f.halfPx[1] / ppm);
      }
    };
    each((c, f, hwM, hhM) => rigShadow((m) => {
      const S = makeRig(ctx, c.x, c.y, c.ang, ppm, state.cam, m, V3D.shade, rec.heightM);
      rigBoxes(S, f.boxes, hwM, hhM, color); S.flush(); return S;
    }));
    each((c, f, hwM, hhM) => {
      const R = makeRig(ctx, c.x, c.y, c.ang, ppm, state.cam, "cam", V3D.shade, rec.heightM);
      rigBoxes(R, f.boxes, hwM, hhM, color); R.flush();
    });
  } else {
    for (let k = tr.cars.length - 1; k >= 0; k--) {
      const c = tr.cars[k];
      paintActorForm(ctx, ACTORS, k === 0 ? C.first : C.rest, {
        x: c.x, y: c.y, rotation: c.ang, timeMs: t * 1000,
      });
    }
  }
  const l = tr.cars[0];
  if (l) paintActorForm(ctx, ACTORS, C.smoke, {
    x: l.x, y: l.y, angle: l.ang, timeMs: t * 1000,
  });
}

function drawGull(g) {
  paintActor(ctx, ACTORS, "gull", actorFrame("gull", g));
}

/** UNA ORDA POSADA — la misma gaviota del catálogo, muchas veces.
 *
 *  No hay un segundo pájaro y no debe haberlo: una bandada dibujada con su
 *  propio arte se despega del ave que ya existe en cuanto alguien retoque una.
 *  Lo único propio de la orda es la DISPOSICIÓN — dónde está cada una y cuánto
 *  ha levantado el vuelo — y eso vive en la entidad, no en el arte.
 *
 *  `lift` es lo que hace legible el estorbo ANTES de llegar: la bandada se alza
 *  cuando el carro se acerca, así que se ve venir y se puede rodear. Una nube
 *  que sólo reacciona al chocarla sería un castigo, no un obstáculo. */
/** «ARRIBA DE LA PANTALLA», en el mundo: lo que se levanta del suelo sube en
 *  la pantalla, no hacia el norte. Con la cámara derecha es (0, -k), lo de
 *  siempre; en El Cocal (90°) el norte del mundo es la derecha de la pantalla
 *  y el carro «subía» de costado al pisar la avenida de barro. */
function screenUp(k) {
  const r = state.cam.rot || 0;
  return r ? [-Math.sin(r) * k, -Math.cos(r) * k] : [0, -k];
}

function drawGullFlock(f) {
  for (const b of f.birds) {
    const [ux, uy] = screenUp(b.lift * 9);
    drawGull({ x: f.x + b.dx + ux, y: f.y + b.dy + uy,
               vx: f.vx || 1, vy: f.vy, ph: b.ph });
  }
}
// The boats on the water. Both were flat rectangles seen from directly above,
// which is not how anything else in this game is drawn: the loading screen's
// little lancha has a white hull, a red boot-top and a cabin, and that is the
// boat people expect to find when they get out on the gulf. This is that boat,
// at world scale — a curved hull, a stripe at the waterline, a wake that knows
// which way she is going.
function drawBoat(b) {
  const dir = Math.sign(b.vx) || 1;
  const record = resolveActorRecord(ACTORS, "boat");
  const variant = record.variants?.[b.kind] ? b.kind : "panga";
  const size = record.variants[variant].values;
  const source = { timeMs: lastT, worldX: b.x, worldY: b.y };
  const { bob = 0 } = actorAnimationValues(record.animations, source);
  if (nightLevel() > 0.001) {
    ctx.save();
    ctx.translate(b.x, b.y + bob); ctx.scale(dir, 1);
    paintHeadlights(ctx, size.L, size.H);
    ctx.restore();
  }
  // EL CASCO TIENE COSTADO: del agua a la borda, y el arte de siempre arriba, levantado
  const HS = V3D.hullSide;
  const ro = paintHullSides(ctx, b.x, b.y + bob, 0, dir, hullOutline(size.L, size.H), ACTORS.hull.heightM,
    ACTORS.hull.boottop, ACTORS.hull.topsides, HS.bandK, HS, PX_PER_M);
  ctx.save(); ctx.translate(ro.dx, ro.dy);
  paintActor(ctx, ACTORS, "boat", actorFrame("boat", b, lastT, {
    variant, scaleX: dir, worldX: b.x, worldY: b.y,
  }));
  ctx.restore();
}

// UN BANCO DE ATÚN. Out in the gulf a school working the surface is visible
// from a long way off: the water boils, the birds pile in over it, and every
// panga within sight converges on the edge of it. All three are one entity in
// `state.schools`, so they are drawn together here — the shoal, then the boats
// turning around it with their fishers aboard.
//
// The shoal itself is NOT drawn as fish. From above, a school on the surface is
// disturbed water — a pale, seething patch — and painting individual bodies at
// this zoom reads as confetti. Silver flashes inside it are what sells it, and
// they are keyed off `hash01` + the entity's own phase, never `Math.random`.
function drawSchool(sc, t) {
  const C = resolveActorRecord(ACTORS, "school").composition;
  paintActor(ctx, ACTORS, "school", actorFrame("school", sc, t, { radius: sc.r }));
  for (const b of sc.fleet) {
    if (b.x === undefined) continue;
    paintActorForm(ctx, ACTORS, C.boat, {
      x: b.x, y: b.y, rotation: b.a || 0, timeMs: t * 1000,
    });
    paintActor(ctx, ACTORS, C.fisher, actorFrame(C.fisher, {
      ...b, y: b.y - 1, ph: b.ph || 0,
    }, t));
  }
}

// Street vendor cart: box cart with a striped parasol
// LA CARRETA EN 3D (`actors.vendor.view3d`, pintada por `furniture3d.js → drawCart3d`): la caja, las
// ruedas, el palo y la sombrilla a su altura, encolada con los cuerpos, y el vendedor de pie en el
// manubrio. Sin `view3d` queda el dibujo en alzado de siempre. El rumbo es de la carreta y fijo: sale
// de su fase, que el mundo le da al nacer y no cambia.
function drawVendor(vn, t) {
  const rec = resolveActorRecord(ACTORS, "vendor"), V = rec.view3d;
  if (!V) { paintStanding("vendor", actorFrame("vendor", vn, t)); return; }
  const hue = Number.isFinite(vn.hue) ? vn.hue : 200, ang = vn.ph || 0;
  const look = vn._look || (vn._look = { band: hslHex(hue, rec.band), parasol: hslHex(hue, rec.parasol) });
  const sway = Math.sin((t || 0) * V.swayRate + (vn.ph || 0)) * V.swayRad;
  if (V.person) {
    const d = (V.boxM[0] / 2 + V.handleM + V.person.backM) * PX_PER_M, c = Math.cos(ang), s = Math.sin(ang);
    paintPerson3d({ x: vn.x - c * d, y: vn.y - s * d, ang, ph: 0, hue: (hue + 180) % 360 }, {});
  }
  drawCart3d(vn.x, vn.y, ang, V, look, sway);
}

// Stray dog / cat ambling around the streets
function drawAnimal(an) {
  paintActor(ctx, ACTORS, "animal", actorFrame("animal", an, lastT, {
    variant: an.cat ? "cat" : "dog",
  }));
}

// The active delivery target: a waiting customer on a concrete pad, waving.
function drawTargetCustomer(t) {
  if (!state.carrying) return;
  const c = state.carrying.customer, r = resolveActorRecord(ACTORS, "targetCustomer");
  // su plataforma y el aro que late quedan en el suelo; ella se para encima, saludando
  const P = ACTORS.person3d.customer, pulse = P.ringPx + Math.sin(t * 1000 * P.pulseRate) * P.pulsePx;
  ctx.fillStyle = r.pad; ctx.beginPath(); ctx.arc(c.x, c.y, P.padPx, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = r.ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, pulse, 0, Math.PI * 2); ctx.stroke();
  // MIRA AL CARRO QUE LE TRAE EL PEDIDO. Se pinta una copia por cuadro, y una copia no recuerda hacia
  // dónde se movió: sin rumbo propio caía al respaldo de `facingOf` y giraba a un ángulo nuevo cada
  // cuadro — la clienta temblaba en su plataforma.
  const p = state.p, ang = p ? Math.atan2(p.y - c.y, p.x - c.x) : 0;
  paintPerson3d({ ...c, ang, ph: t * 4 }, { body: r.body, skin: r.skin, shadow: r.shadow, wave: true });
}

// THE VEHICLE SPRITE IS AN INTERPRETER NOW.
//
// What used to be here: `paintBoat`, plus a 90-line `if (kind === bike) … else
// if (key === "tuktuk") … else if (key === "cart") …` chain of raw Canvas calls
// — one branch per vehicle, art and engine welded together. Adding a vehicle
// meant editing this function, which is precisely the thing `docs/inventory.md`
// §12 says a designer should never have to do.
//
// What is here instead: a walk over the vehicle's `parts` from
// `src/assets/vehicles.json`, in order, outward from the centre. The finite
// shape vocabulary below IS the engine's half of the contract — data may
// compose these, never invent one — exactly as the feria catalog's `SHAPES`
// works for the rides.
//
// Drawn centred at (0,0) facing +x; reused by the in-game player draw and by
// the UI vehicle preview.
function paintVehicle(g, key, veh) {
  paintParts(g, vehicleParts(key), {
    pxPerM: PX_PER_M,
    // A vehicle measures in HALF-EXTENTS of its own body (`[-1, 3]` is three
    // pixels in from the transom); a landmark measures in plain pixels from its
    // anchor. That difference is the whole reason the interpreter takes the
    // frame from the caller instead of owning one.
    X: (v) => evalOn(v, veh.w / 2),
    Y: (v) => evalOn(v, veh.h / 2),
    color: (spec) => partColor(spec, veh),
    skip: (part) => part.silhouette === "only",   // shadow-only, never painted
  });
}

// Insulated delivery backpacks for the courier-style vehicles. Coordinates are
// in vehicle-local space (+x is the nose) and come from the vehicle's own
// record now — `DELIVERY_BAG_MOUNTS` used to sit here, four per-vehicle mount
// points in the renderer while every other per-vehicle fact had moved to
// `vehicles.json`. On the two-wheelers and kart the straps reach forward over
// the rider, so the bag reads as worn rather than as a box bolted onto the
// chassis; the tuk-tuk carries the same bag in its rear passenger compartment
// and therefore wears none.
// Placement is a finite engine concern: the registry chooses one frame family,
// while the complete bag/cooler/freezer shape, spoil gauge and the three product
// contents forms stay in JSON.
const CARGO_PLACERS = Object.freeze({
  "vehicle-mount": (mount) => {
    const frame = {
      x: mount?.x || 0, y: mount?.y || 0, scale: mount?.scale || 1,
      straps: Boolean(mount?.straps),
    };
    return { ...frame, contents: { x: frame.x, y: frame.y, scale: frame.scale } };
  },
  "pickup-bed": () => ({
    x: -8, y: 0,
    contents: { x: -8, y: 0, scale: 0.8 },
  }),
  "cart-lid": (_mount, veh) => {
    const x = -veh.w / 2 + 4;
    const y = veh.h / 2 - 6;
    const width = veh.w - 8;
    return {
      x, y, width, handleX: -2 - x,
      contents: { x: x + width / 2, y: y + 1.5, scale: 0.55 },
    };
  },
});

// PRODUCT CONTENT IS A FORM, NOT A SECOND CONTAINER. `products.json` owns the
// closed cargo vocabulary (`cup` / `box` / `leaf`); actor forms follow the
// `cargo${PascalCase}` convention so there is no second map to drift away from
// it. The content validator in `tests/test_actors.py` proves every authored
// token resolves. An old save with no product remains a churchill cup.
function cargoContentsForm(productId) {
  const kind = PRODUCTS[productId]?.cargo || PRODUCTS.churchill?.cargo || "cup";
  const form = `cargo${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  return ACTORS.forms[form] ? form : "cargoCup";
}

function drawCarriedCargo(g, key, veh, carrying) {
  const { style, mount } = vehicleCargo(key);
  // The vehicle still decides HOW the order travels. A bici keeps its bag, a
  // pickup its cooler and the cart its freezer; changing food cannot move it.
  const container = ACTORS.cargo[style] || ACTORS.cargo.bag;
  const place = CARGO_PLACERS[container.placement] || CARGO_PLACERS["vehicle-mount"];
  const placed = place(mount, veh);
  const { contents, ...containerFrame } = placed;
  const melt = Math.max(0, Math.min(1, carrying.melt / (carrying.total || 1)));
  paintActorForm(g, ACTORS, container.form, { ...containerFrame, melt });
  // …and the product decides WHAT is inside that unchanged container. Paint it
  // last so the cup/box/leaf reads through the container's top/label window.
  paintActorForm(g, ACTORS, cargoContentsForm(carrying.product), { ...contents, melt });
}

// Wind swirl: arc streaks whipping around the car, in the direction it's
// turning, opacity/length scaled by angular speed — sells a fast pivot.
//
// `c` is the effect's config: the repository's defaults with this vehicle's
// overrides merged over them (`vehicleEffects`). Every number that used to be
// a literal in this function is one of its keys.
function drawTurnWind(p, veh, t, c) {
  paintTurnWind(ctx, p, veh, t, c, (state.elev || 0) * 7);
}

// The player's wake: a widening V astern, longer and brighter the faster she
// runs. It replaces the wind swirls on the water — swirls read as air whipping
// past a kart, and the thing a boat actually leaves behind is her wash. Drawn
// in WORLD space (before the body's rotate) so it trails her heading.
function drawWake(p, veh, c) {
  paintWake(ctx, p, veh, lastT, c);
}

// THE PAINTERS — the engine's half of `src/assets/effects.json`.
//
// A `paint` effect draws around the body; a `transform` one bends the frame the
// sprite is then drawn in and paints nothing. Both take the merged config, so
// every number a boat and a car once disagreed about through an `if (afloat)`
// is now that vehicle's own row.
// LOS FAROS. Se dibujan en el marco del vehículo (trompa a +x), así que el
// cono sale de la trompa cualquiera sea el rumbo. `night` lo decide el LLAMADOR
// y no este pintor, porque el mismo dibujo sirve al jugador, al tráfico y a las
// lanchas — y cada uno sabe su propia mitad del marco.
const HEADLIGHTS = EFFECTS.vehicle.headlights.params;

/** Faros en el marco del vehículo (trompa a +x). Lo llaman el jugador por la
 *  vía de efectos, y el tráfico y las lanchas directo — un carro del tráfico no
 *  tiene registro del que escoger un efecto y aun así tiene que alumbrar. */
export function paintHeadlights(g, hw, hh, c = HEADLIGHTS) {
  g.save(); g.globalAlpha *= nightLevel();
  paintSystemHeadlights(g, hw, hh, c);
  g.restore();
}

const EFFECT_PAINTERS = {
  // El cono va DEBAJO del casco (`under: true`), o la luz sale encima de la
  // trompa en vez de salir de ella.
  headlights: {
    under: true,
    paint: (p, veh, c) => {
      if (nightLevel() <= 0.001) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      paintHeadlights(ctx, veh.w / 2, veh.h / 2, c);
      ctx.restore();
    },
  },

  turnWind: { paint: (p, veh, c) => drawTurnWind(p, veh, lastT, c) },
  wake: { paint: (p, veh, c) => drawWake(p, veh, c) },

  // The body's OWN silhouette, dropped behind and faded as she climbs the ramp.
  // Never a generic ellipse — that is what `traceVehicleSilhouette` is for.
  shadow: {
    paint: (p, veh, c) => {
      // EN 3D la sombra es la de sus piezas (`paintPlayer3d`); una lancha tira su silueta según el sol
      if (veh.body3d) return;
      if (veh.driver || veh.heightM) { paintBoatShadow(p, veh); return; }
      const lift = (state.elev || 0) * 7;
      paintVehicleShadow(ctx, p, veh, c, lift,
        (g, vehicle) => traceVehicleSilhouette(g, state.vehicleKey, vehicle));
    },
  },

  heel: {
    transform: (p, veh, c) => {
      applyVehicleHeel(ctx, p, veh, lastT, c);
    },
  },
};


function drawPlayer(p, veh) {
  const lift = (state.elev || 0) * 7;   // the barro avenue rides ~1 m up
  const effects = vehicleEffects(state.vehicleKey);
  ctx.save();
  // Under the body: the wash, the swirls, then the shadow over them. PAINT
  // ORDER IS THE REPOSITORY'S, not each vehicle's — a boat that happened to
  // list her wake last should not end up painting it over her own shadow, and
  // that is a property of the effects, not of the boat.
  for (const { id, effect, cfg } of effects) {
    if (effect.layer === "under") EFFECT_PAINTERS[id]?.paint?.(p, veh, cfg);
  }
  const [ux, uy] = screenUp(lift);
  // UN VEHÍCULO CON RECETA 3D es su receta de cajas y su chofer; la carga va donde va (`cargoM`)
  if (veh.body3d) {
    ctx.restore();
    paintPlayer3d(p.x + ux, p.y + uy, p.a, veh);
    if (state.carrying) {
      ctx.save(); ctx.translate(p.x + ux, p.y + uy); ctx.rotate(p.a);
      const ro = bodyLift(p, veh, veh.cargoM); ctx.translate(ro[0], ro[1]);
      drawCarriedCargo(ctx, state.vehicleKey, veh, state.carrying);
      ctx.restore();
    }
    return;
  }
  ctx.translate(p.x + ux, p.y + uy); ctx.rotate(p.a);
  for (const { id, effect, cfg } of effects) {
    if (effect.layer === "transform") EFFECT_PAINTERS[id]?.transform?.(p, veh, cfg);
  }
  // EL VEHÍCULO TOMA PERSPECTIVA: su silueta, repetida del suelo a su alto (`heightM`) en la tinta
  // de costado, es su carrocería vista de lado; encima va su arte de siempre, corrido por la cámara
  // como el techo de un edificio. Mismo tope y misma cámara que todo lo demás.
  const ro = bodyLift(p, veh);
  paintVehicleSides(ctx, state.vehicleKey, veh, ro);
  ctx.translate(ro[0], ro[1]);
  paintVehicle(ctx, state.vehicleKey, veh);
  if (state.carrying) drawCarriedCargo(ctx, state.vehicleKey, veh, state.carrying);
  ctx.restore();
  // y su chofer, sobre la cubierta levantada (las lanchas no tienen receta de cajas: su casco es su arte)
  if (veh.driver) paintPlayer3d(p.x + ux, p.y + uy, p.a, veh, { body: false, shadow: false });
}

/** El corrimiento de la tapa de un vehículo de `heightM`, ya en SU marco (girado `p.a`). */
function bodyLift(p, veh, heightM = null) {
  const h = heightM ?? veh.heightM ?? V3D.defaultHeightM;
  const o = parallaxOffset(state.cam, p.x, p.y, h, PX_PER_M);
  const c = Math.cos(-p.a), s = Math.sin(-p.a);
  return [o.dx * c - o.dy * s, o.dx * s + o.dy * c];
}

/** Los costados: la silueta del cuerpo repetida del suelo a la tapa, oscurecida hacia `shade.side`. */
function paintVehicleSides(g, key, veh, ro) {
  const len = Math.hypot(ro[0], ro[1]);
  if (len < 0.3) return;
  const n = Math.min(V3D.maxSteps, Math.ceil(len / V3D.stepPx));
  g.fillStyle = mixColor(veh.color, V3D.shade.side, V3D.shade.darkK);
  for (let k = 0; k < n; k++) {
    g.save(); g.translate(ro[0] * k / n, ro[1] * k / n);
    traceVehicleSilhouette(g, key, veh); g.fill();
    g.restore();
  }
}

/**
 * EL VEHÍCULO DE LA PANTALLA DE SELECCIÓN, EN 3D — el mismo que se maneja. La tarjeta pintaba
 * `paintVehicle`, el arte PLANO de antes de las cajas, así que el selector y la tienda mostraban un
 * carro que ya no existe en el juego. Esto arma el MISMO aparejo que `paintPlayer3d` (cajas de
 * `body3d` y chofer de `driver`), o el costado levantado de una lancha, en el lienzo `g` y con una
 * cámara de mentira al suroeste, para que se vean un costado y la trompa como en una vitrina.
 * Centrado en (0, 0), trompa a +x, en píxeles de mundo: quien llama pone la escala.
 */
function paintVehicleModel(g, key, veh, { lean = MODEL_LEAN } = {}) {
  const ppm = PX_PER_M, d = lean * PARALLAX_CAM_H * ppm;
  const cam = { x: -0.45 * d, y: d };
  if (veh.body3d || (veh.driver && !veh.heightM)) {
    const hwM = veh.w / 2 / ppm, hhM = veh.h / 2 / ppm, topM = (veh.heightM || 1.5) + 1.5;
    const R = makeRig(g, 0, 0, 0, ppm, cam, "cam", V3D.shade, topM);
    if (veh.body3d) rigBoxes(R, veh.body3d, hwM, hhM, (spec) => partColor(spec, veh));
    if (veh.driver) paintRider(R, veh.driver, VEHICLE_REG.driver3d, (spec) => partColor(spec, veh), hwM, hhM);
    R.flush();
    return;
  }
  // una lancha: su silueta levantada a la borda y su arte encima, como en el agua
  const h = veh.heightM ?? V3D.defaultHeightM, o = parallaxOffset(cam, 0, 0, h, ppm), ro = [o.dx, o.dy];
  paintVehicleSides(g, key, veh, ro);
  g.save(); g.translate(ro[0], ro[1]); paintVehicle(g, key, veh); g.restore();
  if (veh.driver) {
    const R = makeRig(g, 0, 0, 0, ppm, cam, "cam", V3D.shade, h + 1.5);
    paintRider(R, veh.driver, VEHICLE_REG.driver3d, (spec) => partColor(spec, veh), veh.w / 2 / ppm, veh.h / 2 / ppm);
    R.flush();
  }
}
const PARALLAX_CAM_H = EFFECTS.parallax?.cameraHeightM || 60;
const MODEL_LEAN = 1.1;
/** La caja que ocupa `paintVehicleModel` en pantalla (px de mundo, centro en 0,0): la huella más lo
 *  que la tapa —y la cabeza del chofer— se corren hacia el noreste. La tarjeta escala y centra con
 *  esto, o un tuktuk alto se sale por arriba de su tarjeta. */
function vehicleModelBounds(veh, lean = MODEL_LEAN) {
  const H = Math.max(veh.heightM ?? 1.5, veh.driver ? (veh.heightM ?? 0.8) + 1.2 : 0) * PX_PER_M * lean;
  const x0 = -veh.w / 2, x1 = veh.w / 2 + 0.45 * H, y0 = -veh.h / 2 - H, y1 = veh.h / 2;
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Hybrid overlay: Pixi owns the player body/shadow; this draws only the
// carried delivery bag / cooler / freezer state (game-critical UI, not bodywork).
function drawPlayerCarrying(p, veh) {
  if (!state.carrying) return;
  const lift = (state.elev || 0) * 7;
  ctx.save();
  { const [ux, uy] = screenUp(lift); ctx.translate(p.x + ux, p.y + uy); } ctx.rotate(p.a);
  { const ro = bodyLift(p, veh, veh.cargoM); ctx.translate(ro[0], ro[1]); }
  drawCarriedCargo(ctx, state.vehicleKey, veh, state.carrying);
  ctx.restore();
}

export {
  drawGullFlock, drawAnimal, drawArcadeCoin, drawBeachBall, drawBoat, drawCar, drawFisher, drawGull, drawPed, drawSchool, drawPlayer, drawPlayerCarrying, drawSwimmer, drawTargetCustomer, drawTrain, drawTurnWind, drawVendor, paintHull, paintVehicle, paintVehicleModel, vehicleModelBounds };
