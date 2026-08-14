// Hand-drawn set pieces: buildings, the two muelles and the Mata de Limón
// suspension bridge. The painterly tile pass doesn't cover these.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, flatPath, label, roundRect } from "./gfx.js";
import { ferries } from "../../game/ferries.js";

// One building: drop shadow, body, roof band + windows (clipped), outline.
function paintBuilding(b) {
  const a = b.aabb, path = (b._path || (b._path = flatPath(b.pts, true)));
  const bw = a.x1 - a.x0, bh = a.y1 - a.y0;
  ctx.save(); ctx.translate(4, 4); ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill(path); ctx.restore();
  ctx.fillStyle = b.color || "#caa089"; ctx.fill(path);
  ctx.save(); ctx.clip(path);
  ctx.fillStyle = b.roof || MATERIALS.structure.roof; ctx.fillRect(a.x0, a.y0, bw, Math.max(3, bh * 0.3));
  if (b.wnd) {
    ctx.fillStyle = state.weather === "night" ? "rgba(255,220,140,0.7)" : "rgba(255,255,255,0.55)";
    const wn = Math.max(1, Math.floor(bw / 16));
    for (let i = 0; i < wn; i++) ctx.fillRect(a.x0 + 4 + i * (bw / wn), a.y0 + bh * 0.55, 4, 3);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; ctx.stroke(path);
}

// Per-tile Ferrocarril rail pieces: ballast bed + ties + two steel rails.
// Decorative (not drivable), drawn on the ground over the roads.

// MUELLES. A pier is a polyline with a width and a style — a road that is
// allowed to leave the land (churchill/world/service/pier.py) — so both the
// Muelle Nacional and the faro's wooden jetty are drawn by the same pass, each
// segment in its own frame. That is what lets the editor bend one, extend it,
// or draw a third without a new draw function.
//: The deck recipe per PierStyle, from the shared material registry. Not just
//: a colour — seams, rails, lamps, and whether the deck lies on the ground.
//: EVERY style the builder can emit must have a row: `malecon` shipped for a
//: week without one and four beach ramps were drawn as concrete quays, with
//: blue railings and lamps, lying on the sand. `tests/test_materials.py`.
const PIER_STYLES = MATERIALS.pier;

function pierInView(P, view) {
  const pts = P.pts, m = P.w / 2 + 40;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return !(x1 + m < view.x0 || x0 - m > view.x1 || y1 + m < view.y0 || y0 - m > view.y1);
}

function drawPier(P, view) {
  if (!pierInView(P, view)) return;
  const style = PIER_STYLES[P.style] || PIER_STYLES.concrete;
  const hw = P.w / 2, pts = P.pts;
  let run = 0;                       // arclength so far, so seams and lamps
  for (let i = 0; i < pts.length - 2; i += 2) {   // never restart at a bend
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const len = Math.hypot(bx - ax, by - ay);
    const last = i === pts.length - 4;
    ctx.save();
    ctx.translate(ax, ay); ctx.rotate(Math.atan2(by - ay, bx - ax));
    if (!style.round) {                          // decks cast a shadow on the sea;
      ctx.fillStyle = "rgba(0,0,0,0.22)";        // an apron lies on the ground
      ctx.fillRect(3, -hw + 4, len, P.w);
    }
    ctx.fillStyle = style.deck;
    if (style.round) {                           // round ends, like every other
      ctx.beginPath();                           // paved connector on the sand
      ctx.arc(0, 0, hw, 0, Math.PI * 2); ctx.arc(len, 0, hw, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(0, -hw, len, P.w);
    if (style.seam) {
      ctx.strokeStyle = style.seam; ctx.lineWidth = 1;                        // planks across
      for (let s = style.seamGap - (run % style.seamGap); s < len; s += style.seamGap) {
        ctx.beginPath(); ctx.moveTo(s, -hw + 1); ctx.lineTo(s, hw - 1); ctx.stroke();
      }
    }
    if (style.cap && last) { ctx.fillStyle = style.cap; ctx.fillRect(len - 3, -hw, 3, P.w); }
    if (style.rail) {                                                         // rails, both sides
      ctx.fillStyle = style.rail;
      ctx.fillRect(0, -hw, len, 2); ctx.fillRect(0, hw - 2, len, 2);
    }
    if (style.centre) {                                                       // lane dashes
      ctx.strokeStyle = style.centre; ctx.lineWidth = 2; ctx.setLineDash([12, 10]);
      ctx.beginPath(); ctx.moveTo(run ? 0 : 6, 0); ctx.lineTo(last ? len - 6 : len, 0); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (style.posts) {
      ctx.fillStyle = "#6a451f";
      for (let s = 10 - (run % style.posts); s < len; s += style.posts) {
        ctx.fillRect(s, -hw - 1, 3, 3); ctx.fillRect(s, hw - 2, 3, 3);
      }
    }
    if (style.lamps) {                        // warm dot on a pole, alternating
      for (let s = 24 - (run % style.lamps); s < len - 8; s += style.lamps) {
        const side = ((((run + s) / style.lamps) | 0) % 2) ? 1 : -1;
        const lv = side * (hw - 3);
        ctx.fillStyle = "#8a8f96"; ctx.fillRect(-0.75 + s, lv - 6, 1.5, 6);
        ctx.fillStyle = state.weather === "night" ? "#ffd98a" : "#f4e6c0";
        ctx.beginPath(); ctx.arc(s, lv - 7, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    run += len;
  }
  if (style.hut) drawPierHut(P, hw);
}

// The guard hut at the shore entrance, beside the deck — drawn in the pier's
// frame so it follows a muelle that was moved or turned.
// LA CASETA at the muelle's landward end.
//
// It used to be drawn INSIDE the pier's rotation, so on the Muelle Nacional —
// which runs due south — the whole building was laid on its side: a roof facing
// west and a box that read as a house knocked over. Everything else built in
// this world is drawn axis-aligned from above (see `paintBuilding`), because
// that is what "seen from the sky" looks like; only the POSITION should come
// from the pier.
//
// So: the pier gives us where to stand it — at the landward end, pushed off the
// deck by its own normal — and the caseta itself is drawn upright in world
// axes, with its door on the side that faces the deck.
function drawPierHut(P, hw) {
  const [ax, ay, bx, by] = P.pts;
  const a = Math.atan2(by - ay, bx - ax);
  const ux = Math.cos(a), uy = Math.sin(a);        // along the pier, seaward
  const nx = -Math.sin(a), ny = Math.cos(a);       // off the deck, to one side
  const cx = ax + nx * (hw + 13) + ux * 18;
  const cy = ay + ny * (hw + 13) + uy * 18;
  const W2 = 9, H2 = 7;                            // half extents, world px
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.24)";              // its shadow on the deck
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 4, W2 + 1, H2 * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f4f4ef";                       // the walls
  roundRect(ctx, cx - W2, cy - H2, W2 * 2, H2 * 2, 2, true, false);
  ctx.fillStyle = "#3f7fc4";                       // the roof, with a ridge
  roundRect(ctx, cx - W2 - 1.5, cy - H2 - 1.5, W2 * 2 + 3, H2 * 2 + 3, 2.5, true, false);
  ctx.strokeStyle = "rgba(255,255,255,0.30)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - W2 - 1, cy); ctx.lineTo(cx + W2 + 1, cy); ctx.stroke();
  // la puerta, on the side that looks at the deck
  ctx.fillStyle = "rgba(20,40,60,0.62)";
  ctx.fillRect(cx - nx * (H2 + 0.5) - 2.2, cy - ny * (H2 + 0.5) - 2.2, 4.4, 4.4);
  ctx.restore();
}

// Two passes, because a muelle and a ramp sit at different heights in the
// frame. A deck over the sea is drawn with the set pieces, above the water; an
// APRON is asphalt lying on the ground, so it goes down with the other paved
// connectors — before the buildings and the flora, or the terminal's palms
// would end up underneath it.
function drawPiers(view, ground = false) {
  for (const P of W.PIERS) {
    const style = PIER_STYLES[P.style] || PIER_STYLES.concrete;
    if (Boolean(style.ground) !== ground) continue;
    drawPier(P, view);
  }
}

// Suspension bridge — towers, cables, deck, rails
function drawBridge(view) {
  if (!W.BRIDGE) return;
  const B = W.BRIDGE;
  if (B.x1 < view.x0 || B.x0 > view.x1) return;
  // approach ramps
  ctx.fillStyle = "#7a6a55";
  ctx.fillRect(B.x0 - 32, B.cy - B.deckW/2 - 4, 32, B.deckW + 8);
  ctx.fillRect(B.x1, B.cy - B.deckW/2 - 4, 32, B.deckW + 8);
  // Deck base
  ctx.fillStyle = "#cfc3a3";
  ctx.fillRect(B.x0, B.cy - B.deckW/2 - 4, B.x1 - B.x0, B.deckW + 8);
  // Asphalt
  ctx.fillStyle = "#3a3540";
  ctx.fillRect(B.x0, B.cy - B.deckW/2 + 2, B.x1 - B.x0, B.deckW - 4);
  // Lane dashes
  ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([14, 14]);
  ctx.beginPath(); ctx.moveTo(B.x0 + 4, B.cy); ctx.lineTo(B.x1 - 4, B.cy); ctx.stroke();
  ctx.setLineDash([]);
  // Rails
  ctx.fillStyle = "#b4bcc4";
  ctx.fillRect(B.x0, B.cy - B.deckW/2 - 2, B.x1 - B.x0, 2);
  ctx.fillRect(B.x0, B.cy + B.deckW/2, B.x1 - B.x0, 2);
  // Cables (catenary)
  const [tx0, tx1] = B.towers;
  const towerTop = B.cy - B.towerH;
  const sagY = B.cy - 14;
  ctx.strokeStyle = "#e2e6ea"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx0, towerTop);
  ctx.quadraticCurveTo((tx0 + tx1) / 2, sagY, tx1, towerTop);
  ctx.stroke();
  // Side anchor cables
  ctx.beginPath();
  ctx.moveTo(B.x0 - 28, B.cy + 4); ctx.lineTo(tx0, towerTop);
  ctx.moveTo(B.x1 + 28, B.cy + 4); ctx.lineTo(tx1, towerTop);
  ctx.stroke();
  // Vertical hangers
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(228,233,238,0.9)";
  for (let xx = tx0 + 6; xx < tx1; xx += 6) {
    const t = (xx - tx0) / (tx1 - tx0);
    const ty = (1-t)*(1-t)*towerTop + 2*t*(1-t)*sagY + t*t*towerTop;
    ctx.beginPath(); ctx.moveTo(xx, ty); ctx.lineTo(xx, B.cy - 4); ctx.stroke();
  }
  // Towers — slender silver lattice legs with X cross-bracing
  for (const tx of B.towers) {
    ctx.fillStyle = "#aeb6c0";
    ctx.fillRect(tx - 4, towerTop, 3, B.towerH + 4);
    ctx.fillRect(tx + 1, towerTop, 3, B.towerH + 4);
    ctx.fillStyle = "#7d8791";
    ctx.fillRect(tx - 6, towerTop - 4, 12, 4);
    // lattice X braces between the legs, 4 panels up the height
    ctx.strokeStyle = "#7d8791"; ctx.lineWidth = 1;
    const seg = (B.towerH + 4) / 4;
    for (let i = 0; i < 4; i++) {
      const yA = towerTop + i * seg, yB = yA + seg;
      ctx.beginPath();
      ctx.moveTo(tx - 2.5, yA); ctx.lineTo(tx + 2.5, yB);
      ctx.moveTo(tx + 2.5, yA); ctx.lineTo(tx - 2.5, yB);
      ctx.stroke();
    }
  }
  // Sign
  ctx.font = "bold 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
  const lbl = "PUENTE MATA LIMÓN";
  const wlbl = ctx.measureText(lbl).width + 10;
  const mx = (B.x0 + B.x1) / 2;
  ctx.fillStyle = "rgba(20,16,40,0.78)"; ctx.fillRect(mx - wlbl/2, B.cy + B.deckW/2 + 14, wlbl, 12);
  ctx.fillStyle = "#fff"; ctx.fillText(lbl, mx, B.cy + B.deckW/2 + 23);
}

// The two ferries and their berths. Everything is drawn in the ferry's own
// frame, so a berth on a diagonal quay and a hull mid-crossing are the same
// code — and the DECK RECT drawn here is exactly the rect `deckAt` tests, which
// is what keeps "looks like I am on it" and "am I on it" the same thing.
function drawFerry(f, view) {
  const R = f.dl / 2 + 40;
  if (f.x + R < view.x0 || f.x - R > view.x1 || f.y + R < view.y0 || f.y - R > view.y1) return;
  const L = f.dl / 2, B = f.dw / 2;
  ctx.save();
  ctx.translate(f.x, f.y); ctx.rotate(f.a);
  // wake: it only exists while she is making way
  if (f.phase === "out" || f.phase === "back") {
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.moveTo(-L, -B * 0.7); ctx.lineTo(-L - 70, -B * 1.5);
    ctx.lineTo(-L - 70, B * 1.5); ctx.lineTo(-L, B * 0.7);
    ctx.closePath(); ctx.fill();
  }
  // THE HULL IS A CURVE, not a box with a notch. Everything else that moves in
  // this game is drawn round and warm — the scooter, the pangas, the churchill
  // itself — and the ferry was the one square thing on the water. A quadratic
  // bow and a flared quarter give her the same line, and the DECK still ends
  // exactly where `deckAt` says it does, so what you see is what you stand on.
  ctx.fillStyle = "rgba(0,0,0,0.26)";           // hull shadow on the water
  ctx.beginPath();
  ctx.moveTo(L + 4, 3); ctx.quadraticCurveTo(L - 8, -B + 8, L - 30, -B + 5);
  ctx.lineTo(-L + 8, -B + 5); ctx.quadraticCurveTo(-L - 2, 3, -L + 8, B + 5);
  ctx.lineTo(L - 30, B + 5); ctx.quadraticCurveTo(L - 8, B + 5, L + 4, 3);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#2f4f68";                    // hull
  ctx.beginPath();
  ctx.moveTo(L + 2, 0);
  ctx.quadraticCurveTo(L - 6, -B, L - 30, -B);  // flared bow
  ctx.lineTo(-L + 6, -B);
  ctx.quadraticCurveTo(-L - 3, 0, -L + 6, B);   // rounded quarter aft
  ctx.lineTo(L - 30, B);
  ctx.quadraticCurveTo(L - 6, B, L + 2, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#3f6d8c";                    // boot-top stripe along the sheer
  ctx.fillRect(-L + 6, -B + 2, L * 2 - 36, 2);
  ctx.fillRect(-L + 6, B - 4, L * 2 - 36, 2);
  ctx.fillStyle = "#d7d2c4";                    // the DECK — the drivable rect
  roundRect(ctx, -L + 4, -B + 5, L * 2 - 30, B * 2 - 10, 5, true, false);
  ctx.strokeStyle = "#f4d77a"; ctx.lineWidth = 1.5;   // lane guides down the deck
  ctx.setLineDash([9, 9]);
  ctx.beginPath(); ctx.moveTo(-L + 9, 0); ctx.lineTo(L - 30, 0); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#b7402f";                    // rails, both sides
  ctx.fillRect(-L + 4, -B + 2, L * 2 - 32, 3);
  ctx.fillRect(-L + 4, B - 5, L * 2 - 32, 3);
  ctx.fillStyle = "#8a7f6a";                    // stern ramp (how you get on)
  roundRect(ctx, -L - 9, -B + 9, 12, B * 2 - 18, 3, true, false);
  ctx.fillStyle = "#eee8d8";                    // wheelhouse forward, with a roof
  roundRect(ctx, L - 48, -B + 8, 22, B * 2 - 16, 5, true, false);
  ctx.fillStyle = "#3a6f8a";
  roundRect(ctx, L - 45, -B + 11, 16, B * 2 - 22, 4, true, false);
  ctx.fillStyle = "#f4d77a";                    // a warm light in the window
  ctx.fillRect(L - 42, -3, 10, 6);
  ctx.fillStyle = "#e85d75";                    // funnel, with a black cap
  ctx.beginPath(); ctx.arc(L - 58, 0, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2b2b33";
  ctx.beginPath(); ctx.arc(L - 58, 0, 5.5, Math.PI * 1.15, Math.PI * 1.85); ctx.fill();
  ctx.restore();
  label(f.x, f.y - f.dw / 2 - 14, f.name.toUpperCase().replace("FERRY A ", ""),
        "#fff", "#2f4f68");
}
// The berth she sails from: a concrete apron at the quay, so an empty berth
// still reads as a place a ferry belongs rather than a gap in the sea wall.
function drawBerth(f, view) {
  const bx = f.pts[0].x, by = f.pts[0].y;
  if (bx + 90 < view.x0 || bx - 90 > view.x1 || by + 90 < view.y0 || by - 90 > view.y1) return;
  ctx.save();
  ctx.translate(bx, by); ctx.rotate(f.pts.length > 1
    ? Math.atan2(f.pts[1].y - by, f.pts[1].x - bx) : 0);
  ctx.fillStyle = "#b6b1a2";
  ctx.fillRect(-14, -f.dw / 2 - 6, 46, f.dw + 12);
  ctx.fillStyle = "#8f8a7c";
  for (let v = -f.dw / 2; v < f.dw / 2; v += 12) ctx.fillRect(-14, v, 46, 2);
  ctx.restore();
}
function drawFerries(view) {
  for (const f of ferries()) { drawBerth(f, view); drawFerry(f, view); }
}

export { drawBridge, drawFerries, drawPiers, paintBuilding };
