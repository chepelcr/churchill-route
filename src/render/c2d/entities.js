// Moving things + the player: peds, swimmers, traffic, trains, gulls, boats,
// vendors, animals, the delivery target, arcade coins and the vehicle sprite.
import { state } from "../../game/state.js";
import { evalOn, traceVehicleSilhouette } from "../vehicleShapes.js";
import { partColor, vehicleCargo, vehicleEffects, vehicleParts } from "../../game/vehicles.js";
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { npcArt } from "../../game/npcs.js";
import { paintParts } from "./shapes.js";
import { COIN_TYPE, VEHICLE_MEDIUM } from "../../domain/vocabulary.generated.js";
import { ctx, hash01, lastT, roundRect } from "./gfx.js";
import ACTORS from "../../assets/actors.json" with { type: "json" };

// LA PALETA DE LA GENTE. `actors.json` holds the colours; the trigonometry
// stays here, and that split is the point: a ped bobs on `pe.ph`, a phase the
// SIMULATION advances per person, so its motion is a function of that entity's
// state rather than a part list. What is authorable is what colour each piece
// is, and how a per-instance `hue` is dressed.
const A = ACTORS.actors, HULL = ACTORS.hull, CARGO = ACTORS.cargo;
//: `hsl(hue S% L%)` mixes two things: the HUE is the instance's (this person
//: wears blue) and the S/L pair is the ROLE's (this is how a street walker
//: dresses). The pair was written six times with five different values and no
//: way to tell whether the difference was meant.
const dye = (hue, sl) => `hsl(${hue} ${sl[0]}% ${sl[1]}%)`;

// THE HULL EVERY BOAT IN THIS PORT IS DRAWN FROM. It used to live inside
// `drawBoat`, which meant the estero's pangas were a second, hand-drawn boat —
// a flat trapezoid — and a panga you met on the gulf and a panga you met in the
// channel were visibly different objects for no reason a player could name.
// One helper, one boat: a soft shadow on the water, a white sheer curving to
// the bow, and the red boot-top at the waterline. Drawn at the origin, bow to
// +x, in whatever transform the caller has already set up — so she leans and
// bobs with her owner. The caller adds what makes her HERS: a wake if she is
// travelling, a fisher if she is working, a funnel if she is a ferry.
function traceHull(g, L, H) {
  g.beginPath();
  g.moveTo(L, 0);
  g.quadraticCurveTo(L * 0.55, -H, -L * 0.7, -H * 0.9);
  g.quadraticCurveTo(-L, -H * 0.5, -L, 0);
  g.quadraticCurveTo(-L, H * 0.6, -L * 0.7, H * 0.9);
  g.quadraticCurveTo(L * 0.55, H, L, 0);
  g.closePath();
}
function paintHull(g, L, H, topsides = HULL.topsides) {
  g.fillStyle = HULL.shadow;        // hull shadow on the water
  g.beginPath();
  g.ellipse(1, H * 0.7, L * 0.95, H * 0.8, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = topsides;                  // white hull, sheer curving to the bow
  traceHull(g, L, H); g.fill();
  g.fillStyle = HULL.boottop;              // the red boot-top at the waterline
  g.beginPath();
  g.moveTo(L * 0.92, 0);
  g.quadraticCurveTo(L * 0.5, H, -L * 0.7, H * 0.88);
  g.quadraticCurveTo(-L, H * 0.55, -L, 0);
  g.closePath(); g.fill();
}

// A collectable churchill coin lying on the street (arcade): a disc that spins
// (squash on X) and bobs, with a shadow + ₡ mark so it reads as loot.
// GOLD is the ordinary street coin. SILVER is the estadio coin rain — bigger,
// worth many times a street coin, and a different metal so the player can tell
// at a glance that the burst on the pitch is not just more of the same.
const COIN_GOLD   = ACTORS.coins.gold;
const COIN_SILVER = ACTORS.coins.silver;
const COIN_TYPES = {
  [COIN_TYPE.GOLD]: COIN_GOLD,
  [COIN_TYPE.SILVER]: COIN_SILVER,
  [COIN_TYPE.BONUS]: ACTORS.coins.bonus,
  [COIN_TYPE.FROZEN]: ACTORS.coins.frozen,
};
function drawArcadeCoin(c, t) {
  const ph = (c.t || 0) + t * 0.004;
  const sx = Math.abs(Math.cos(ph * 2.2));           // spin → horizontal squash
  const bob = Math.sin(ph * 3) * 1.6;                // gentle hover
  const M = c.palette || COIN_TYPES[c.coinType] || (c.silver ? COIN_SILVER : COIN_GOLD);
  const R = M.r;
  ctx.fillStyle = ACTORS.coins.shadow;
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 5, R - 1, R * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  const cy = c.y - bob;
  ctx.fillStyle = M.rim;
  ctx.beginPath(); ctx.ellipse(c.x, cy, R * sx + 0.6, R + 0.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = M.face;
  ctx.beginPath(); ctx.ellipse(c.x, cy, R * sx, R, 0, 0, Math.PI * 2); ctx.fill();
  if (sx > 0.35) {                                    // ₡ mark only when facing us
    ctx.fillStyle = M.mark;
    ctx.font = `bold ${Math.round((c.silver ? 11 : 9) * sx + 3)}px 'Space Grotesk', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("₡", c.x, cy + 0.5);
    ctx.textBaseline = "alphabetic";
  }
}

function drawPed(pe) {
  // The ART, not the kind. `npcTypes.json` lets an authored type choose an
  // existing look (`art`), which is what makes the registry worth having —
  // picking a built-in art means accepting the built-in drawing, colour and
  // all, and the four person styles keep the authored colour/scale.
  // THE ART, VIA THE REGISTRY. `pe.kind` is the TYPE; `npcArt` is what it looks
  // like, and they are deliberately not the same — `supporter` draws as a
  // `fan`, `mascot` as the authored mascot figure. Reading `kind` as the art
  // meant every type whose name was not already a drawer fell through to the
  // default walker, silently.
  const art = pe.editorNpc ? (pe.drawStyle || "person") : npcArt(pe.kind || "walker");
  if (art === "swimmer") { drawSwimmer(pe); return; }
  if (art === "passenger") { drawPassenger(pe); return; }
  if (art === "fisher") { drawFisher(pe); return; }
  if (art === "muellero") { drawMuellero(pe); return; }
  if (art === "playero") { drawPlayero(pe); return; }
  if (art === "jugador") { drawJugador(pe); return; }
  if (["person", "vendor", "worker", "mascot"].includes(art)) {
    // …and a WORLD npc whose art is one of these draws the same figure. The
    // branch used to require `editorNpc`, so a `mascot` seated on a plaza by
    // the world had no drawer at all and came out a commuter.
    drawEditorNpc(pe, art); return;
  }
  // FANS celebrate: a bigger, faster bounce plus a side-to-side shake and two
  // raised arms, so the crowd around the estadio and la plaza reads as a crowd
  // rather than commuters who happen to be walking in a circle.
  // A PASEANTE IS A WALKER WHO IS NOT GOING TO WORK. Same silhouette — the
  // malecón's crowd is the town's crowd, on a Sunday — but the one seated on a
  // banca barely moves, so its bob is a breath rather than a stride.
  const fan = art === "fan";
  const bob = fan ? Math.abs(Math.sin(pe.ph * 1.7)) * -3.2
    : pe.stationary ? Math.sin(pe.ph) * 0.5 : Math.sin(pe.ph) * 1.4;
  const sway = fan ? Math.sin(pe.ph * 2.3) * 1.1 : 0;
  const x = pe.x + sway;
  ctx.fillStyle = A.walker.shadow; ctx.beginPath(); ctx.ellipse(pe.x + 1, pe.y + 5, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dye(pe.hue, A.walker.shirt); ctx.fillRect(x - 2, pe.y - 3 + bob, 4, 6);
  if (fan) {                                       // arms up
    ctx.strokeStyle = A.walker.skin; ctx.lineWidth = 1.2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - 2, pe.y - 2 + bob); ctx.lineTo(x - 4, pe.y - 6 + bob);
    ctx.moveTo(x + 2, pe.y - 2 + bob); ctx.lineTo(x + 4, pe.y - 6 + bob);
    ctx.stroke();
  }
  ctx.fillStyle = A.walker.skin; ctx.beginPath(); ctx.arc(x, pe.y - 5 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
}

// EL PLAYERO. A person on the sand is a person in a swimsuit, and from above
// that is two things: bare skin instead of a shirt, and a towel under whoever
// is not walking. The sunbather is drawn LYING DOWN — a standing figure that
// happens not to move reads as somebody waiting for a bus on the beach.
function drawPlayero(pe) {
  const P = A.playero, skin = P.skin;
  if (pe.stationary) {
    ctx.save(); ctx.translate(pe.x, pe.y); ctx.rotate(pe.ang || 0);
    ctx.fillStyle = P.towelShadow;
    ctx.fillRect(-7, -3.5, 15, 8);
    ctx.fillStyle = dye(pe.hue, P.towel);                  // la toalla
    ctx.fillRect(-7, -4, 14, 7);
    ctx.fillStyle = skin;                                   // tendido encima
    ctx.fillRect(-4, -1.6, 8, 3.2);
    ctx.beginPath(); ctx.arc(5.2, 0, 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const bob = Math.sin(pe.ph) * 1.2;
  ctx.fillStyle = P.shadow;
  ctx.beginPath(); ctx.ellipse(pe.x + 1, pe.y + 5, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skin;                                     // torso, sin camisa
  ctx.fillRect(pe.x - 1.9, pe.y - 3 + bob, 3.8, 4);
  ctx.fillStyle = dye(pe.hue, P.swimsuit);                  // el traje de baño
  ctx.fillRect(pe.x - 1.9, pe.y + 0.6 + bob, 3.8, 2.2);
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(pe.x, pe.y - 5 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
}

// EL JUGADOR. Leaning into the run, arms out for balance, facing the ball —
// `ang` is set by the advancer every frame, which is what makes a mejenga read
// as a game: eight people all looking at the same point.
function drawJugador(pe) {
  const stride = Math.sin(pe.ph * 1.6);
  const lean = stride * 0.22;
  ctx.save(); ctx.translate(pe.x, pe.y); ctx.rotate(lean);
  ctx.fillStyle = A.jugador.shadow;
  ctx.beginPath(); ctx.ellipse(1, 5, 4.2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dye(pe.hue, A.jugador.shirt);             // la camiseta
  ctx.fillRect(-2, -3, 4, 5.4);
  ctx.strokeStyle = A.jugador.limbs; ctx.lineWidth = 1.2; ctx.lineCap = "round";
  ctx.beginPath();                                          // brazos abiertos
  ctx.moveTo(-2, -1.6); ctx.lineTo(-4.4, 0.4 + stride);
  ctx.moveTo(2, -1.6); ctx.lineTo(4.4, 0.4 - stride);
  ctx.moveTo(-1, 2.4); ctx.lineTo(-1.6, 5 + stride * 1.4);  // …y las piernas
  ctx.moveTo(1, 2.4); ctx.lineTo(1.6, 5 - stride * 1.4);
  ctx.stroke();
  ctx.fillStyle = A.jugador.skin;
  ctx.beginPath(); ctx.arc(0, -5, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// LA BOLA. One per mejenga, drawn in the ped pass so it sits among the players
// rather than under the whole world. The panels turn with `ph`, which the game
// advances by how far the ball has actually rolled.
function drawBeachBall(G) {
  const b = G.ball;
  ctx.fillStyle = A.ball.shadow;
  ctx.beginPath(); ctx.ellipse(b.x + 1, b.y + 3, 3.2, 1.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.ball.body;
  ctx.beginPath(); ctx.arc(b.x, b.y, 3.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.ball.panels;
  for (let i = 0; i < 3; i++) {
    const a = b.ph + (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(b.x + Math.cos(a) * 1.5, b.y + Math.sin(a) * 1.5, 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEditorNpc(pe, style = pe.drawStyle) {
  // COLOUR COMES FROM THE INSTANCE, and a world-spawned one has no `color` —
  // only a `hue`, like every other person in the crowd. Without the fallback
  // `fillStyle = undefined` leaves whatever the previous drawer set, which is
  // not a bug that looks like a bug: the figure simply comes out the colour of
  // the last thing painted.
  const color = pe.color || `hsl(${pe.hue ?? 200} 70% 60%)`;
  const scale = pe.scale || 1;
  const bob = pe.stationary ? Math.sin(pe.ph) * 0.35 : Math.sin(pe.ph) * 1.2;
  ctx.save();
  ctx.translate(pe.x, pe.y + bob);
  ctx.scale(scale, scale);
  ctx.fillStyle = A.editorNpc.shadow;
  ctx.beginPath(); ctx.ellipse(1, 5, 4.5, 1.7, 0, 0, Math.PI * 2); ctx.fill();
  if (style === "mascot") {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, -1, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = A.editorNpc.eyes;
    ctx.beginPath(); ctx.arc(-1.7, -2, 1, 0, Math.PI * 2); ctx.arc(1.7, -2, 1, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = color;
    if (style === "vendor") {
      roundRect(ctx, -4, -3, 8, 7, 1.5, true, false);
      ctx.fillStyle = A.editorNpc.tray; ctx.fillRect(-5, -5, 10, 2);
    } else {
      ctx.fillRect(-2.5, -3, 5, 7);
      if (style === "worker") {
        ctx.fillStyle = A.editorNpc.helmet; ctx.fillRect(-3.2, -6.5, 6.4, 1.6);
      }
    }
    ctx.fillStyle = A.editorNpc.skin;
    ctx.beginPath(); ctx.arc(0, -5.2, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
// Somebody at a parada. The whole point of the type is the WAITING: standing
// still with a bag, looking down the street the bus comes from, which is what
// tells you at a glance that the caseta is in use. Once they are moving — to
// the door, or off it and down the acera — they are drawn as the walker they
// are about to become, so the handover to `advancePed` has no visible seam.
// This branch is TEMPORARY per person: `joinTheSidewalk` drops the kind.
function drawPassenger(pe) {
  const waiting = pe.phase === "wait";
  const bob = waiting ? Math.sin(pe.ph) * 0.5 : Math.sin(pe.ph) * 1.4;
  const y = pe.y + bob;
  ctx.fillStyle = A.passenger.shadow;
  ctx.beginPath(); ctx.ellipse(pe.x + 1, pe.y + 5, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dye(pe.hue, A.passenger.shirt);
  ctx.fillRect(pe.x - 2, y - 3, 4, 6);
  if (waiting) {                                   // the bolso, held at the hip
    ctx.fillStyle = A.passenger.bag;
    ctx.fillRect(pe.x + 2, y + 0.6, 2.2, 2.6);
  }
  ctx.fillStyle = A.passenger.skin;
  ctx.beginPath(); ctx.arc(pe.x, y - 5, 2.2, 0, Math.PI * 2); ctx.fill();
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
  const hue = Number.isFinite(pe.hue) ? pe.hue : 28;
  const x = pe.x, y = pe.y;
  const ph = pe.ph || 0;
  const bob = Math.sin(ph) * 0.5;                     // seated: he barely moves
  const dip = Math.sin(ph * 0.8) * 1.6;               // where the line breaks the surface
  ctx.save();
  ctx.lineCap = "round";
  ctx.fillStyle = A.fisher.shadow;
  ctx.beginPath(); ctx.ellipse(x + 1, y + 4, 3.6, 1.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = A.fisher.ripple;                  // the ring the line makes
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(x + 15, y + 5 + dip, 3 + Math.sin(ph) * 0.8, 1.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = A.fisher.line;                    // the line, into the water
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + 10, y - 5.5);
  ctx.quadraticCurveTo(x + 13.6, y - 1, x + 15, y + 5 + dip);
  ctx.stroke();
  ctx.fillStyle = dye(hue, A.fisher.shirt);           // the body, seated
  ctx.fillRect(x - 2, y - 2 + bob, 4, 5);
  ctx.strokeStyle = A.fisher.arm;                     // the arm on the caña
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x + 1.4, y - 1 + bob); ctx.lineTo(x + 3.4, y - 2.6 + bob); ctx.stroke();
  ctx.strokeStyle = A.fisher.rod;                     // la caña
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 2.4, y - 1.4 + bob); ctx.lineTo(x + 10, y - 5.5); ctx.stroke();
  ctx.fillStyle = A.fisher.skin;                      // the head
  ctx.beginPath(); ctx.arc(x, y - 4.2 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.fisher.hatBrim;                   // el sombrero: brim, tipped forward
  ctx.beginPath(); ctx.ellipse(x + 0.7, y - 4.4 + bob, 3.5, 2.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.fisher.hatCrown;                  // …and its crown
  ctx.beginPath(); ctx.arc(x + 0.5, y - 4.7 + bob, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
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
  const hue = Number.isFinite(pe.hue) ? pe.hue : 28;
  const nx = pe.nx || 1, ny = pe.ny || 0;
  const ph = pe.ph || 0;
  const sway = Math.sin(ph * 0.7) * 0.5;              // waiting, not fidgeting
  const dip = Math.sin(ph * 0.8) * 1.8;               // the float, working
  const x = pe.x + nx * sway, y = pe.y + ny * sway;
  // rod tip and where the line meets the water, both OUTBOARD
  const tipX = x + nx * 11, tipY = y + ny * 11 - 6;
  const hitX = x + nx * 19, hitY = y + ny * 19 + 4 + dip;
  ctx.save();
  ctx.lineCap = "round";
  ctx.fillStyle = A.muellero.shadow;                  // his shadow on the deck
  ctx.beginPath(); ctx.ellipse(x + 1, y + 5, 3.8, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = A.muellero.ripple;                // the ring where it lands
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(hitX, hitY, 3 + Math.sin(ph) * 0.8, 1.3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = A.muellero.line;                  // the line
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.quadraticCurveTo((tipX + hitX) / 2, (tipY + hitY) / 2 - 1, hitX, hitY);
  ctx.stroke();
  // el balde, on the deck behind him — the reason he is out here
  ctx.fillStyle = A.muellero.cooler;
  ctx.fillRect(x - nx * 6 - 2, y - ny * 6 + 1, 4, 3.4);
  ctx.fillStyle = A.muellero.coolerLid;
  ctx.fillRect(x - nx * 6 - 2, y - ny * 6 + 1, 4, 1);
  ctx.fillStyle = dye(hue, A.muellero.shirt);         // standing body
  ctx.fillRect(x - 2, y - 4, 4, 7);
  ctx.strokeStyle = A.muellero.arm;                   // arms out over the rail
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + nx * 1.2, y + ny * 1.2 - 2.4);
  ctx.lineTo(x + nx * 4, y + ny * 4 - 3.6);
  ctx.stroke();
  ctx.strokeStyle = A.muellero.rod;                   // la caña
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + nx * 2.6, y + ny * 2.6 - 3.2);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = A.muellero.skin;                    // head
  ctx.beginPath(); ctx.arc(x, y - 6.2, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.muellero.hatBrim;                 // la gorra, peak to seaward
  ctx.beginPath(); ctx.arc(x, y - 6.6, 2.5, Math.PI, 0); ctx.fill();
  ctx.fillRect(x + Math.min(0, nx * 3.4), y - 7.0, Math.abs(nx * 3.4) + 0.6, 1.1);
  ctx.restore();
}

// A swimmer: a head just above the water with a ripple wake + stroking arms.
function drawSwimmer(pe) {
  const t = pe.ph;
  ctx.strokeStyle = A.swimmer.splash; ctx.lineWidth = 1;                     // wake ring
  ctx.beginPath(); ctx.ellipse(pe.x, pe.y + 1, 6 + Math.sin(t) * 1.5, 3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = dye(pe.hue, A.swimmer.shirt); ctx.lineWidth = 1.6;       // stroking arms
  ctx.beginPath();
  ctx.moveTo(pe.x - 3, pe.y + Math.sin(t) * 1.2);
  ctx.lineTo(pe.x + 3, pe.y - Math.sin(t) * 1.2);
  ctx.stroke();
  ctx.fillStyle = A.swimmer.skin; ctx.beginPath(); ctx.arc(pe.x, pe.y, 2.3, 0, Math.PI * 2); ctx.fill(); // head
}
function drawCar(c) {
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.ang || 0);
  ctx.fillStyle = A.car.shadow; ctx.fillRect(-c.w/2 + 3, -c.h/2 + 3, c.w, c.h);
  // EL TRÁFICO TAMBIÉN ALUMBRA. Un carro sin faros en una calle con pozos de
  // luz y oscuridad entre ellos es un carro invisible que se te viene encima —
  // y las calaveras son lo único que se ve de uno que se aleja.
  if (state.weather === "night") paintHeadlights(ctx, c.w / 2, c.h / 2);
  // …Y SU CUERPO ES UNA LISTA DE PARTES, como el del carro que uno maneja. Eran
  // tres ramas de código a punta de rectángulos, así que un taxi o una moto
  // pedían editar el renderer. El marco es de MEDIO-EXTENSIONES, que es lo que
  // deja la misma receta servir a un carro de 23 px y a un bus de 34.
  const kind = TRAFFIC.kinds[c.kind] || TRAFFIC.kinds.car;
  const hw = c.w / 2, hh = c.h / 2;
  paintParts(ctx, kind.parts, {
    X: (v) => (v || 0) * hw,
    Y: (v) => (v || 0) * hh,
    color: (spec) => (spec === "$color" ? c.color : PAINT[spec] ?? spec),
  });
  ctx.fillStyle = A.car.tyres;
  ctx.fillRect(-hw, -hh - 1, 3, c.h + 2); ctx.fillRect(hw - 3, -hh - 1, 3, c.h + 2);
  ctx.restore();
}

// The Ferrocarril heritage train: red loco + two cream wagons, each posed
// on the rail by spawns.js (tr.cars[0] = loco).
function drawTrain(tr, t) {
  for (let k = tr.cars.length - 1; k >= 0; k--) {
    const c = tr.cars[k];
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.ang);
    ctx.fillStyle = A.train.shadow; ctx.fillRect(-17, -6, 34, 13);
    if (k === 0) {
      ctx.fillStyle = A.train.loco; ctx.fillRect(-18, -7, 36, 14);     // loco body
      ctx.fillStyle = A.train.cab; ctx.fillRect(-18, -7, 10, 14);      // cab
      ctx.fillStyle = A.train.smokebox; ctx.fillRect(12, -4, 5, 8);    // smokebox
      ctx.fillStyle = A.train.lamp; ctx.fillRect(16, -2, 2, 4);        // lamp
    } else {
      ctx.fillStyle = A.train.wagon; ctx.fillRect(-16, -6, 32, 12);    // wagon
      ctx.fillStyle = A.train.loco; ctx.fillRect(-16, -6, 32, 3);      // stripe
      ctx.fillStyle = A.train.windows;
      for (let wx = -11; wx <= 9; wx += 7) ctx.fillRect(wx, -2, 4, 4); // windows
    }
    ctx.strokeStyle = A.train.outline; ctx.lineWidth = 1;
    ctx.strokeRect(k === 0 ? -18 : -16, k === 0 ? -7 : -6, k === 0 ? 36 : 32, k === 0 ? 14 : 12);
    ctx.restore();
  }
  // chimney smoke puffs drifting off the loco
  const l = tr.cars[0];
  ctx.fillStyle = A.train.smoke;
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.0012 + i * 0.33) % 1;
    ctx.beginPath();
    ctx.arc(l.x + Math.cos(l.ang) * 14 - ph * 16, l.y + Math.sin(l.ang) * 14 - 8 - ph * 14, 2 + ph * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGull(g) {
  ctx.fillStyle = A.gull.shadow; ctx.beginPath(); ctx.ellipse(g.x, g.y + 14, 6, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = A.gull.wings; ctx.lineWidth = 2;
  const f = Math.sin(g.ph) * 4;
  ctx.beginPath();
  ctx.moveTo(g.x - 7, g.y + f); ctx.quadraticCurveTo(g.x - 3, g.y - 3 + f, g.x, g.y + f);
  ctx.quadraticCurveTo(g.x + 3, g.y - 3 + f, g.x + 7, g.y + f); ctx.stroke();
}
// The boats on the water. Both were flat rectangles seen from directly above,
// which is not how anything else in this game is drawn: the loading screen's
// little lancha has a white hull, a red boot-top and a cabin, and that is the
// boat people expect to find when they get out on the gulf. This is that boat,
// at world scale — a curved hull, a stripe at the waterline, a wake that knows
// which way she is going.
function drawBoat(b) {
  const dir = Math.sign(b.vx) || 1;
  const t = lastT * 0.001;
  const bob = Math.sin(t * 1.5 + (b.x + b.y) * 0.01) * 1.2;
  ctx.save();
  ctx.translate(b.x, b.y + bob);
  ctx.scale(dir, 1);                       // she faces the way she is travelling
  const big = b.kind === "ferry";
  const L = big ? 30 : 15, H = big ? 8 : 5;
  // wake: a widening V behind her, brighter the faster she runs
  ctx.fillStyle = A.boat.wake;
  ctx.beginPath();
  ctx.moveTo(-L, -H * 0.5); ctx.lineTo(-L - 26, -H * 1.6);
  ctx.lineTo(-L - 26, H * 1.6); ctx.lineTo(-L, H * 0.5);
  ctx.closePath(); ctx.fill();
  // …y sus luces de navegación, por delante del casco y bajo la cabina.
  if (state.weather === "night") paintHeadlights(ctx, L, H);
  paintHull(ctx, L, H);                    // shadow + white sheer + red boot-top
  ctx.fillStyle = A.boat.cabin;            // cabin
  roundRect(ctx, -L * 0.35, -H * 0.85, L * (big ? 0.5 : 0.42), H * 1.2, 2, true, false);
  ctx.fillStyle = A.boat.window;
  ctx.fillRect(-L * 0.28, -H * 0.35, L * (big ? 0.34 : 0.26), 2);
  if (big) {
    ctx.fillStyle = A.boat.funnel;           // funnel on the bigger one
    ctx.beginPath(); ctx.arc(-L * 0.6, -H * 0.2, 3.2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = A.boat.outboard;       // an outboard on the panga
    ctx.lineWidth = 1.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-L + 1, -1); ctx.lineTo(-L - 3, 3); ctx.stroke();
  }
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
  const boil = sc.r;
  ctx.save();
  // the boil: a soft pale disc with a broken, breathing rim
  ctx.fillStyle = A.school.boil;
  ctx.beginPath(); ctx.arc(sc.x, sc.y, boil, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = A.school.rim;
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const h = hash01(i * 7.13 + sc.ph);
    const a0 = sc.ph * 0.5 + i * 0.9 + Math.sin(t * 0.0009 + i) * 0.2;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, boil * (0.82 + h * 0.16), a0, a0 + 0.5 + h * 0.4);
    ctx.stroke();
  }
  // the fish, as flashes: short bright slivers turning inside the boil
  for (let i = 0; i < 22; i++) {
    const h1 = hash01(i * 12.9898 + sc.ph), h2 = hash01(i * 78.233 + sc.ph);
    const a = h1 * Math.PI * 2 + t * 0.0011 * (h2 > 0.5 ? 1 : -1);
    const rr = boil * (0.15 + h2 * 0.72);
    const x = sc.x + Math.cos(a) * rr, y = sc.y + Math.sin(a) * rr;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = `rgba(${A.school.flash},${(0.3 + h1 * 0.5).toFixed(2)})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 1.2 + h2, 3.4 + h1 * 2.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // …and the fleet on the edge of it, each with somebody working
  for (const b of sc.fleet) {
    if (b.x === undefined) continue;             // not advanced yet this frame
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a || 0);
    paintHull(ctx, 15, 5);
    ctx.fillStyle = A.school.console;            // the console
    roundRect(ctx, -5, -3, 8, 6, 2, true, false);
    ctx.strokeStyle = A.school.outboard;         // the outboard on her transom
    ctx.lineWidth = 1.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-18, 0); ctx.stroke();
    ctx.restore();
    // the fisher rides in WORLD space, not the hull's frame: `drawFisher` draws
    // himself upright with his line going into the water, and rotating him with
    // a boat that is circling would spin him upside down at the far side.
    drawFisher({ x: b.x, y: b.y - 1, ph: b.ph || 0, hue: b.hue });
  }
}

// Street vendor cart: box cart with a striped parasol
function drawVendor(vn, t) {
  ctx.fillStyle = A.vendor.shadow;
  ctx.beginPath(); ctx.ellipse(vn.x + 2, vn.y + 5, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.vendor.box; ctx.fillRect(vn.x - 7, vn.y - 4, 14, 9);
  ctx.fillStyle = dye(vn.hue, A.vendor.band); ctx.fillRect(vn.x - 7, vn.y - 4, 14, 3);
  ctx.fillStyle = A.vendor.wheels;
  ctx.beginPath(); ctx.arc(vn.x - 5, vn.y + 6, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(vn.x + 5, vn.y + 6, 1.6, 0, Math.PI * 2); ctx.fill();
  // parasol with a gentle sway
  const sway = Math.sin(t * 0.001 + vn.ph) * 1.2;
  ctx.strokeStyle = A.vendor.pole; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(vn.x + 4, vn.y - 2); ctx.lineTo(vn.x + 4 + sway, vn.y - 14); ctx.stroke();
  ctx.fillStyle = dye(vn.hue, A.vendor.parasol);
  ctx.beginPath(); ctx.arc(vn.x + 4 + sway, vn.y - 14, 9, Math.PI, 0); ctx.fill();
  ctx.fillStyle = A.vendor.parasolHilite;
  ctx.beginPath(); ctx.arc(vn.x + 4 + sway, vn.y - 14, 9, Math.PI + 0.5, Math.PI + 1.1); ctx.lineTo(vn.x + 4 + sway, vn.y - 14); ctx.fill();
}

// Stray dog / cat ambling around the streets
function drawAnimal(an) {
  const bob = Math.sin(an.ph) * 0.8;
  ctx.fillStyle = A.animal.shadow;
  ctx.beginPath(); ctx.ellipse(an.x + 1, an.y + 3, 4, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = an.cat ? A.animal.cat : A.animal.dog;
  ctx.fillRect(an.x - 4, an.y - 2 + bob, 8, 4);                     // body
  ctx.fillRect(an.x + 3, an.y - 4 + bob, 3.4, 3.4);                 // head
  ctx.fillRect(an.x - 6, an.y - 3 + bob, 2, 2);                     // tail
  if (an.cat) { ctx.fillRect(an.x + 3.4, an.y - 5.4 + bob, 1.2, 1.6); ctx.fillRect(an.x + 5.2, an.y - 5.4 + bob, 1.2, 1.6); } // ears
}

// The active delivery target: a waiting customer on a concrete pad, waving.
function drawTargetCustomer(t) {
  if (!state.carrying) return;
  const c = state.carrying.customer;
  ctx.fillStyle = A.targetCustomer.pad;                     // pad
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
  const pulse = 10 + Math.sin(t * 0.005) * 3;                // pulse ring
  ctx.strokeStyle = A.targetCustomer.ring; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c.x, c.y, pulse + 8, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = A.targetCustomer.shadow;                  // shadow
  ctx.beginPath(); ctx.ellipse(c.x + 2, c.y + 6, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.targetCustomer.body;                    // body
  roundRect(ctx, c.x - 3, c.y - 6, 6, 11, 2, true, false);
  ctx.fillStyle = A.targetCustomer.skin;                    // head
  ctx.beginPath(); ctx.arc(c.x, c.y - 9, 3.4, 0, Math.PI * 2); ctx.fill();
  const wave = Math.sin(t * 0.012) * 3;                      // waving arm
  ctx.strokeStyle = A.targetCustomer.skin; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c.x + 3, c.y - 4); ctx.lineTo(c.x + 7, c.y - 10 - wave); ctx.stroke();
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
function drawDeliveryBag(g, mount, carrying) {
  const m = Math.max(0, Math.min(1, carrying.melt / carrying.total));
  g.save();
  g.translate(mount.x, mount.y);
  g.scale(mount.scale, mount.scale);
  if (mount.straps) {
    g.strokeStyle = CARGO.bag.straps;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(2.5, -2.4); g.lineTo(6, -2);
    g.moveTo(2.5,  2.4); g.lineTo(6,  2);
    g.stroke();
  }
  g.fillStyle = CARGO.bag.body;
  roundRect(g, -4, -4, 8, 8, 1.5, true, false);
  g.strokeStyle = CARGO.bag.seam;
  g.lineWidth = 1;
  g.strokeRect(-3.5, -3.5, 7, 7);
  g.fillStyle = CARGO.bag.seam;                         // insulated lid seam
  g.fillRect(-3.5, -3.5, 1.2, 7);
  g.fillStyle = `oklch(0.66 0.20 ${30 + m * 18})`;       // Churchill badge
  g.fillRect(-1.4, -2.2, 2.8, 3.4);
  g.fillStyle = CARGO.bag.label;
  g.fillRect(-1.4, -2.8, 2.8, 1);
  g.restore();
}

function drawPickupCooler(g, carrying) {
  const m = Math.max(0, Math.min(1, carrying.melt / carrying.total));
  const hRed = 6 * (1 - m * 0.5);
  g.save();
  g.translate(-8, 0);
  g.fillStyle = CARGO.cooler.body;
  g.fillRect(-3, -4, 6, 8);
  g.fillStyle = `oklch(0.62 0.22 ${25 + m * 20})`;
  g.fillRect(-3, -4 + (6 - hRed), 6, hRed);
  g.fillStyle = CARGO.cooler.lid;
  g.fillRect(-3, -5, 6, 2);
  g.restore();
}

function drawCartFreezerLoad(g, veh, carrying) {
  const m = Math.max(0, Math.min(1, carrying.melt / carrying.total));
  const x = -veh.w / 2 + 4;
  const y = veh.h / 2 - 6;
  const w = veh.w - 8;
  g.fillStyle = CARGO.freezer.lid;                      // open, icy freezer lid
  roundRect(g, x, y, w, 3, 1, true, false);
  g.fillStyle = `oklch(0.68 0.18 ${210 - m * 170})`;     // cold-to-melting gauge
  g.fillRect(x + 1, y + 1, Math.max(2, (w - 2) * (1 - m * 0.55)), 1);
  g.fillStyle = CARGO.freezer.handle;                   // recessed lid handle
  g.fillRect(-2, y - 0.8, 4, 1);
}

// THE THREE RECIPES ARE CODE, WHICH ONE A VEHICLE USES IS DATA. Each has its
// own melt gauge — a dropping red band, a cold-to-melting colour ramp — so they
// are drawings, not parts lists. What was wrong was the dispatch: this branched
// on the vehicle KEY, the last place in the renderer that knew a vehicle by
// name, so an authored pickup could never carry a cooler.
const CARGO_STYLES = {
  bag: (g, mount, veh, carrying) => drawDeliveryBag(g, mount, carrying),
  cooler: (g, mount, veh, carrying) => drawPickupCooler(g, carrying),
  freezer: (g, mount, veh, carrying) => drawCartFreezerLoad(g, veh, carrying),
};

function drawCarriedCargo(g, key, veh, carrying) {
  const { style, mount } = vehicleCargo(key);
  const draw = CARGO_STYLES[style] || CARGO_STYLES.bag;
  draw(g, mount, veh, carrying);
}

// Wind swirl: arc streaks whipping around the car, in the direction it's
// turning, opacity/length scaled by angular speed — sells a fast pivot.
//
// `c` is the effect's config: the repository's defaults with this vehicle's
// overrides merged over them (`vehicleEffects`). Every number that used to be
// a literal in this function is one of its keys.
function drawTurnWind(p, veh, t, c) {
  const w = Math.abs(p.av || 0);
  if (w < c.minRate) return;                 // only when whipping around
  const dir = Math.sign(p.av);
  const strength = Math.min(1, (w - c.minRate) / c.rampRate);
  const r = Math.max(veh.w, veh.h) * c.radiusK + c.radiusPad;
  ctx.save();
  ctx.translate(p.x, p.y - (state.elev || 0) * 7);
  ctx.lineCap = "round";
  for (let i = 0; i < c.arcs; i++) {
    const base = p.a + dir * (0.5 + i * 0.7) + t * c.drift * dir;
    const span = (c.span + strength * c.spanK);
    ctx.beginPath();
    ctx.arc(0, 0, r + i * c.arcGap, base, base + dir * span, dir < 0);
    ctx.strokeStyle = `rgba(${c.color},${(c.alpha + strength * c.alphaK).toFixed(3)})`;
    ctx.lineWidth = c.width;
    ctx.stroke();
  }
  ctx.restore();
}

// The player's wake: a widening V astern, longer and brighter the faster she
// runs. It replaces the wind swirls on the water — swirls read as air whipping
// past a kart, and the thing a boat actually leaves behind is her wash. Drawn
// in WORLD space (before the body's rotate) so it trails her heading.
function drawWake(p, veh, c) {
  const sp = Math.min(1, (p.speed || 0) / c.refSpeed);
  if (sp < c.minSpeed) return;
  const L = veh.w / 2, spread = veh.h * (c.spread + sp * c.spreadK);
  const len = c.length + sp * c.lengthK;
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.a);
  ctx.fillStyle = `rgba(${c.color},${(c.alpha + sp * c.alphaK).toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(-L, -veh.h * c.mouth);
  ctx.lineTo(-L - len, -spread);
  ctx.lineTo(-L - len, spread);
  ctx.lineTo(-L, veh.h * c.mouth);
  ctx.closePath(); ctx.fill();
  // the churn right at the transom, where the outboard is actually working
  ctx.fillStyle = `rgba(${c.color},${(c.churnAlpha + sp * c.churnAlphaK).toFixed(3)})`;
  const ph = lastT * c.churnRate;
  for (let i = 0; i < c.churn; i++) {
    const d = c.churnLead + i * c.churnGap + (ph % c.churnGap);
    ctx.beginPath();
    ctx.arc(-L - d, Math.sin(ph + i * c.churnPhase) * veh.h * c.churnSpread,
            c.churnR - i * c.churnTaper, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  // EL CONO primero, después los focos: la luz sale de la lámpara, así que la
  // lámpara va encima de su propio haz.
  const reach = hw + c.beam, halfW = Math.tan(c.spread) * c.beam;
  const grad = g.createLinearGradient(hw, 0, reach, 0);
  grad.addColorStop(0, `rgba(${c.color},${c.alpha})`);
  grad.addColorStop(1, `rgba(${c.color},0)`);
  g.fillStyle = grad;
  for (const side of [-1, 1]) {
    const y0 = side * hh * 0.55;
    g.beginPath();
    g.moveTo(hw - 1, y0);
    g.lineTo(reach, y0 - halfW * 0.5);
    g.lineTo(reach, y0 + halfW * 0.5);
    g.closePath();
    g.fill();
  }
  g.fillStyle = `rgba(${c.color},${c.lampAlpha})`;
  for (const side of [-1, 1]) {
    g.beginPath(); g.arc(hw - 1, side * hh * 0.55, c.lampR, 0, Math.PI * 2); g.fill();
  }
  // …y las calaveras, que son lo ÚNICO que se ve de un carro que se aleja: sin
  // ellas el tráfico de noche desaparece por detrás.
  g.fillStyle = `rgba(${c.tailColor},${c.tailAlpha})`;
  for (const side of [-1, 1]) {
    g.beginPath(); g.arc(-hw + 1, side * hh * 0.55, c.lampR * 0.85, 0, Math.PI * 2); g.fill();
  }
}

//: Los colores del tráfico que NO son del vehículo. `$color` es suyo (lo trae
//: la instancia); el resto sale del registro, resuelto acá para que la receta
//: nombre roles y no hexes.
const TRAFFIC = A.traffic;
const PAINT = {
  $roof: A.car.roof, $window: A.car.window,
  $headlight: A.car.headlight, $taillight: A.car.taillight,
};

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
      ctx.save();
      ctx.translate(p.x + c.offX + lift * c.liftX, p.y + c.offY + lift * c.liftY);
      ctx.rotate(p.a);
      // ONE COLOUR CONVENTION for every effect: `r,g,b` in the registry and the
      // alpha composed here, which is what lets an alpha be a FUNCTION — the
      // wake's ramps with speed, the swirls' with rate of turn, and the
      // shadow's fades as she climbs the ramp.
      const a = Math.max(0, c.alpha - lift * c.liftFade);
      ctx.fillStyle = `rgba(${c.color},${a.toFixed(3)})`;
      traceVehicleSilhouette(ctx, state.vehicleKey, veh);
      ctx.fill();
      ctx.restore();
    },
  },

  heel: {
    transform: (p, veh, c) => {
      const heel = Math.max(-1, Math.min(1, (p.av || 0) / c.maxRate));
      const swell = Math.sin(lastT * c.swellRate + (p.x + p.y) * c.swellSpace);
      ctx.translate(0, heel * veh.h * c.shift + swell * c.swellShift);
      ctx.scale(1, 1 - Math.abs(heel) * c.squash + swell * c.swellSquash);
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

export { drawAnimal, drawArcadeCoin, drawBeachBall, drawBoat, drawCar, drawFisher, drawGull, drawPed, drawSchool, drawPlayer, drawPlayerCarrying, drawSwimmer, drawTargetCustomer, drawTrain, drawTurnWind, drawVendor, paintHull, paintVehicle };
