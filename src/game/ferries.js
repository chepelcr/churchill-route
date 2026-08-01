// The two Puntarenas ferries — the Easter egg at the west end of the spit.
//
// Park on either deck (Paquera or Playa Naranjo), wait, and it casts off and
// takes you out over the gulf and back. It is the only MOVING GROUND in the
// game: everything else the car drives on is a static cell in the surface
// raster, so the deck needs three things the raster cannot give it —
//
//   * deckAt()   a point test the collider consults BEFORE the raster, so the
//                deck is drivable while the water it floats on stays a wall.
//                That also gives the rails for free: drive off the edge and
//                the next cell is sea, which is already solid.
//   * carry()    the player moves with the ferry, position AND heading, or it
//                would simply slide out from under them on the first turn.
//   * one shot   `used` — once a ferry has come home it stays home. A ride you
//                cannot get off of is not a treat.
//
// The berths, the headings and the routes are all real: OSM has the two
// ferry_terminal nodes and both `route=ferry` ways, and the build truncates
// them to a short loop (churchill/world/service/ferry.py).
import { WORLD2D as W } from "../world2d/index.js";

const BOARD_WAIT = 7;           // s parked aboard at the berth before it leaves
const SPEED = 82;               // px/s — 1800 px out and back is ~44 s
// The DECK and the docked offset come FROM THE WORLD (`deck`, `dockS`), not
// from constants here. The build needs the same three numbers: the boarding
// ramp it paves has to reach the stern at rest, and where the stern is at rest
// is a function of all of them. Two copies of that would drift, and the failure
// is silent — a ferry you can see and cannot board. The fallbacks below are
// only for a manifest built before the fields existed.
//
// They are PER FERRY. Reading them off FERRIES[0] worked only while both boats
// were the same size, and the editor can now give one of them her own deck —
// at which point a global would collide the player against the other's.
const DEF_DECK_L = 124, DEF_DECK_W = 46, DEF_DOCK_S = 28;

let _ferries = null;

function build() {
  return (W.FERRIES || []).map((f) => {
    const pts = [];
    for (let i = 0; i < f.route.length; i += 2) pts.push({ x: f.route[i], y: f.route[i + 1] });
    const cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const dock = f.dockS ?? DEF_DOCK_S;
    return {
      id: f.id, name: f.name, pts, cum, total: cum[cum.length - 1] || 1,
      x: f.berth[0], y: f.berth[1], a: f.ang,
      dl: f.deck?.[0] || DEF_DECK_L, dw: f.deck?.[1] || DEF_DECK_W, dock,
      // A CROSSING, not a scenic loop: the lancha over the estero LANDS you on
      // the far shore and waits there. The two ferries sail out and come home
      // because the real crossing ends on the Nicoya side, where this world has
      // no shore to arrive at; the estero has one, so `oneWay` says so.
      oneWay: !!f.oneWay, v: f.speed || SPEED,
      s: dock, phase: "docked", wait: 0, used: false, far: false,
      dx: 0, dy: 0, da: 0,
    };
  });
}
export function ferries() {
  if (!_ferries) _ferries = build();
  return _ferries;
}
// Every run starts with both ferries home and available again.
export function resetFerries() {
  for (const f of ferries()) {
    f.s = f.dock; f.phase = "docked"; f.wait = 0; f.used = false; f.far = false;
    f.dx = f.dy = f.da = 0;
    const q = routePoint(f, f.dock);
    f.x = q.x; f.y = q.y; f.a = q.a;
  }
}

// Pose at arclength `s` along the route.
function routePoint(f, s) {
  const { pts, cum, total } = f;
  const u = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < u) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (u - cum[i - 1]) / seg;
  const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, a: Math.atan2(by - ay, bx - ax) };
}

// The ferry whose DECK contains (x, y), or null. The test is in the ferry's own
// frame, which is why a diagonal berth needs no special case.
export function deckAt(x, y) {
  for (const f of ferries()) {
    const ca = Math.cos(-f.a), sa = Math.sin(-f.a);
    const rx = x - f.x, ry = y - f.y;
    const u = rx * ca - ry * sa, v = rx * sa + ry * ca;
    if (Math.abs(u) <= f.dl / 2 && Math.abs(v) <= f.dw / 2) return f;
  }
  return null;
}

// Advance both ferries. `aboard` is the ferry the player is standing on this
// frame (or null) — a ferry only counts down while someone is actually on it.
export function advanceFerries(dt, aboard) {
  for (const f of ferries()) {
    const px = f.x, py = f.y, pa = f.a;
    if (f.phase === "docked") {
      // the countdown RESETS if you leave: a ferry that sailed because you
      // drove past it eight seconds ago is a trap, not an Easter egg
      f.wait = (aboard === f && !f.used) ? f.wait + dt : 0;
      if (f.wait >= BOARD_WAIT) {
        // A one-way boat sitting at the far shore sails BACK when you board her
        // there. She is transport, so she is never `used` up — the two gulf
        // ferries are the ride you get once.
        f.phase = f.far ? "back" : "out";
        f.wait = 0; f.justSailed = true;
      }
    } else if (f.phase === "out") {
      f.s += f.v * dt;
      if (f.s >= f.total) {
        f.s = f.total;
        if (f.oneWay) { f.phase = "docked"; f.far = true; f.justLanded = true; }
        else f.phase = "back";
      }
    } else if (f.phase === "back") {
      f.s -= f.v * dt;
      if (f.s <= f.dock) {
        f.s = f.dock; f.phase = "docked"; f.far = false;
        f.used = !f.oneWay; f.justHome = true;
      }
    }
    const q = routePoint(f, f.s);
    f.x = q.x; f.y = q.y;
    // sailing home it runs the route backwards, so it points the other way —
    // and a one-way boat berthed at the far shore keeps that heading while she
    // waits, or she would sit facing the water she just crossed
    f.a = (f.phase === "back" || (f.far && f.phase === "docked")) ? q.a + Math.PI : q.a;
    f.dx = f.x - px; f.dy = f.y - py;
    let da = f.a - pa;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    f.da = da;
  }
}

// Move the player with the deck under them: translation AND rotation about the
// ferry's centre. Translation alone leaves the car sliding across the deck on
// every bend of the route, and the route is a real sailing line, so it bends.
export function carry(f, p) {
  if (!f.dx && !f.dy && !f.da) return;
  const rx = p.x - (f.x - f.dx), ry = p.y - (f.y - f.dy);
  const ca = Math.cos(f.da), sa = Math.sin(f.da);
  p.x = f.x + (rx * ca - ry * sa);
  p.y = f.y + (rx * sa + ry * ca);
  p.a += f.da;
}
