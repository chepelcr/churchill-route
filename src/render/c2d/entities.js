// Moving things + the player: peds, swimmers, traffic, trains, gulls, boats,
// vendors, animals, the delivery target, arcade coins and the vehicle sprite.
import { state } from "../../game/state.js";
import { PX_PER_M } from "../../domain/units.js";
import { evalOn, traceVehicleSilhouette } from "../vehicleShapes.js";
import { partColor, vehicleCargo, vehicleEffects, vehicleParts } from "../../game/vehicles.js";
import { sunShadow } from "./shadows.js";
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { npcArt } from "../../game/npcs.js";
import { paintParts } from "./shapes.js";
import {
  applyVehicleHeel, paintHeadlights as paintSystemHeadlights,
  paintTurnWind, paintVehicleShadow, paintWake,
} from "./systemShapes.js";
import { actorAnimationValues, paintActor, paintActorForm, resolveActorRecord } from "./actorShapes.js";
import { VEHICLE_MEDIUM } from "../../domain/vocabulary.generated.js";
import { ctx, lastT } from "./gfx.js";
import ACTORS from "../../assets/actors.json" with { type: "json" };

// actors.json is the visual source of truth. This file only maps simulation
// state into the interpreter's finite frame: pose, variant, time and the sun's
// shadow vector. No actor identity owns Canvas geometry here.
const A = ACTORS.actors;

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

function drawPed(pe) {
  const art = pe.editorNpc ? (pe.drawStyle || "person") : npcArt(pe.kind || "walker");
  const id = ACTORS.artMap[art] || ACTORS.artMap.walker;
  paintActor(ctx, ACTORS, id, actorFrame(id, pe));
}

// EL PLAYERO. A person on the sand is a person in a swimsuit, and from above
// that is two things: bare skin instead of a shirt, and a towel under whoever
// is not walking. The sunbather is drawn LYING DOWN — a standing figure that
// happens not to move reads as somebody waiting for a bus on the beach.
function drawPlayero(pe) {
  paintActor(ctx, ACTORS, "playero", actorFrame("playero", pe));
}

// EL JUGADOR. Leaning into the run, arms out for balance, facing the ball —
// `ang` is set by the advancer every frame, which is what makes a mejenga read
// as a game: eight people all looking at the same point.
function drawJugador(pe) {
  paintActor(ctx, ACTORS, "jugador", actorFrame("jugador", pe));
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
  paintActor(ctx, ACTORS, id, actorFrame(id, pe));
}
// Somebody at a parada. The whole point of the type is the WAITING: standing
// still with a bag, looking down the street the bus comes from, which is what
// tells you at a glance that the caseta is in use. Once they are moving — to
// the door, or off it and down the acera — they are drawn as the walker they
// are about to become, so the handover to `advancePed` has no visible seam.
// This branch is TEMPORARY per person: `joinTheSidewalk` drops the kind.
function drawPassenger(pe) {
  paintActor(ctx, ACTORS, "passenger", actorFrame("passenger", pe));
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
  paintActor(ctx, ACTORS, "fisher", actorFrame("fisher", pe));
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
  paintActor(ctx, ACTORS, "muellero", actorFrame("muellero", pe));
}

// A swimmer: a head just above the water with a ripple wake + stroking arms.
function drawSwimmer(pe) {
  paintActor(ctx, ACTORS, "swimmer", actorFrame("swimmer", pe));
}
function drawCar(c) {
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.ang || 0);
  const hw = c.w / 2, hh = c.h / 2;
  const vars = {
    hw, hh, negHw: -hw, negHh: -hh, width: c.w, height: c.h,
  };
  const color = (spec) => {
    if (spec === "$color") return c.color;
    if (typeof spec === "string" && spec.startsWith("$")) {
      return A.car[spec.slice(1)] ?? A.traffic[spec.slice(1)] ?? spec;
    }
    return spec;
  };
  paintParts(ctx, A.traffic.underParts, {
    X: (v) => v || 0, Y: (v) => v || 0, vars, color,
  });
  // EL TRÁFICO TAMBIÉN ALUMBRA. Un carro sin faros en una calle con pozos de
  // luz y oscuridad entre ellos es un carro invisible que se te viene encima —
  // y las calaveras son lo único que se ve de uno que se aleja.
  if (state.weather === "night") paintHeadlights(ctx, c.w / 2, c.h / 2);
  // …Y SU CUERPO ES UNA LISTA DE PARTES, como el del carro que uno maneja. Eran
  // tres ramas de código a punta de rectángulos, así que un taxi o una moto
  // pedían editar el renderer. El marco es de MEDIO-EXTENSIONES, que es lo que
  // deja la misma receta servir a un carro de 23 px y a un bus de 34.
  const kind = A.traffic.kinds[c.kind] || A.traffic.kinds.car;
  paintParts(ctx, kind.parts, {
    X: (v) => (v || 0) * hw,
    Y: (v) => (v || 0) * hh,
    color,
  });
  paintParts(ctx, A.traffic.overParts, {
    X: (v) => v || 0, Y: (v) => v || 0, vars, color,
  });
  ctx.restore();
}

// The Ferrocarril heritage train: red loco + two cream wagons, each posed
// on the rail by spawns.js (tr.cars[0] = loco).
function drawTrain(tr, t) {
  const C = resolveActorRecord(ACTORS, "train").composition;
  for (let k = tr.cars.length - 1; k >= 0; k--) {
    const c = tr.cars[k];
    paintActorForm(ctx, ACTORS, k === 0 ? C.first : C.rest, {
      x: c.x, y: c.y, rotation: c.ang, timeMs: t * 1000,
    });
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
function drawGullFlock(f) {
  for (const b of f.birds) {
    const lift = b.lift * 9;
    drawGull({ x: f.x + b.dx, y: f.y + b.dy - lift,
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
  if (state.weather === "night") {
    ctx.save();
    ctx.translate(b.x, b.y + bob); ctx.scale(dir, 1);
    paintHeadlights(ctx, size.L, size.H);
    ctx.restore();
  }
  paintActor(ctx, ACTORS, "boat", actorFrame("boat", b, lastT, {
    variant, scaleX: dir, worldX: b.x, worldY: b.y,
  }));
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
function drawVendor(vn, t) {
  paintActor(ctx, ACTORS, "vendor", actorFrame("vendor", vn, t));
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
  const c = state.carrying.customer;
  paintActor(ctx, ACTORS, "targetCustomer", actorFrame("targetCustomer", c, t));
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
// while the complete bag/cooler/freezer shape and melt animation stay in JSON.
const CARGO_PLACERS = Object.freeze({
  "vehicle-mount": (mount) => ({
    x: mount?.x || 0, y: mount?.y || 0, scale: mount?.scale || 1,
    straps: Boolean(mount?.straps),
  }),
  "pickup-bed": () => ({ x: -8, y: 0 }),
  "cart-lid": (_mount, veh) => {
    const x = -veh.w / 2 + 4;
    return {
      x, y: veh.h / 2 - 6, width: veh.w - 8, handleX: -2 - x,
    };
  },
});

function drawCarriedCargo(g, key, veh, carrying) {
  const { style, mount } = vehicleCargo(key);
  const cargo = ACTORS.cargo[style] || ACTORS.cargo.bag;
  const place = CARGO_PLACERS[cargo.placement] || CARGO_PLACERS["vehicle-mount"];
  const melt = Math.max(0, Math.min(1, carrying.melt / (carrying.total || 1)));
  paintActorForm(g, ACTORS, cargo.form, { ...place(mount, veh), melt });
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
  paintSystemHeadlights(g, hw, hh, c);
}

const EFFECT_PAINTERS = {
  // El cono va DEBAJO del casco (`under: true`), o la luz sale encima de la
  // trompa en vez de salir de ella.
  headlights: {
    under: true,
    paint: (p, veh, c) => {
      if (state.weather !== "night") return;
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
  ctx.translate(p.x, p.y - lift); ctx.rotate(p.a);
  for (const { id, effect, cfg } of effects) {
    if (effect.layer === "transform") EFFECT_PAINTERS[id]?.transform?.(p, veh, cfg);
  }
  paintVehicle(ctx, state.vehicleKey, veh);
  if (state.carrying) drawCarriedCargo(ctx, state.vehicleKey, veh, state.carrying);
  ctx.restore();
}

// Hybrid overlay: Pixi owns the player body/shadow; this draws only the
// carried delivery bag / cooler / freezer state (game-critical UI, not bodywork).
function drawPlayerCarrying(p, veh) {
  if (!state.carrying) return;
  const lift = (state.elev || 0) * 7;
  ctx.save();
  ctx.translate(p.x, p.y - lift); ctx.rotate(p.a);
  drawCarriedCargo(ctx, state.vehicleKey, veh, state.carrying);
  ctx.restore();
}

export {
  drawGullFlock, drawAnimal, drawArcadeCoin, drawBeachBall, drawBoat, drawCar, drawFisher, drawGull, drawPed, drawSchool, drawPlayer, drawPlayerCarrying, drawSwimmer, drawTargetCustomer, drawTrain, drawTurnWind, drawVendor, paintHull, paintVehicle };
