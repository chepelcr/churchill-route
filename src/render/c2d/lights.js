// LAS LUCES — the engine's half of `src/assets/lights.json`.
//
// A light was the clearest case in the game of a family split down the middle:
// its POSITION has been authored in the editor since editor features shipped
// (`W.LIGHTS`), while what it LOOKS like was `lightPalette()`, a four-branch
// if/else with the colours inline, plus its geometry as ternaries on
// `type === "stadium"` spread over six lines. A light could be put anywhere and
// a fifth kind could not be designed at all.
//
// So the identity is a generated enum (`LightType`), the properties are the
// registry, and this file is what is genuinely engine: the clamps, the night
// test, and the radial gradient — which is not a shape the vocabulary has.
import LIGHTS from "../../assets/lights.json" with { type: "json" };
import { state } from "../../game/state.js";
import { lightLevel } from "../../game/daynight.js";
import { WORLD2D as W } from "../../world2d/index.js";
import { PX_PER_M } from "../../domain/units.js";
import { ctx } from "./gfx.js";
import { paintAt } from "./shapes.js";
import { paintLuminaire } from "./systemShapes.js";
import { parallaxOffset } from "./depth.js";
import { sunShadow } from "./shadows.js";
import { hasSurfaceRole } from "../../domain/vocabulary.generated.js";

const TYPES = LIGHTS.types;
//: A light with no type, or with one the registry does not know, is a street
//: lamp. Falling back is right here and wrong for a surface class: an unknown
//: lamp is a lamp, an unknown surface is a guess about what you can drive on.
const FALLBACK = "warm";

export const lightSpec = (type) => TYPES[type] || TYPES[FALLBACK];

/**
 * ¿Está prendida la luz?
 *
 * De noche, claro — y **TAMBIÉN EN TORMENTA**, que es lo que hace un pueblo de
 * verdad: el cielo se cierra a mediodía y se prende el alumbrado. Se pide a la
 * RAMPA y no al nombre del clima, así que las luces entran cuando el cielo ya
 * está plomizo y no en el cuadro en que empieza a llover.
 */
const isNight = lightLevel;

/**
 * Paint one luminaire at (x, y) in world pixels.
 *
 * `radius` and `intensity` may come from the instance — the editor writes
 * `lightRadius` / `lightIntensity` per feature — and fall back to the type's.
 * The clamps are the ENGINE's, not a type's: a light authored with radius 4000
 * is not a design, it is a white screen.
 */
export function paintLight(type, x, y, opts = {}) {
  const spec = lightSpec(type);
  if (spec.stand25 && !opts.elevation) return paintStanding(type, spec, x, y, opts);
  // Un poste está en ALZADO: con la cámara girada (El Cocal) se para en la
  // pantalla girando alrededor de su pie, igual que un árbol (`standing`).
  const rot = state.cam.rot || 0;
  if (rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(-rot); ctx.translate(-x, -y); }
  paintLuminaire(ctx, LIGHTS, type, x, y, {
    ...opts, night: opts.night ?? isNight(),
  }, (parts, px, py, spec) => paintAt(parts, px, py, {
    g: ctx, pxPerM: PX_PER_M,
    color: (color) => (color === "$core" ? spec.core : color),
  }));
  if (rot) ctx.restore();
}

/**
 * LA LUMINARIA EN 2.5D. El poste ya no es un trazo vertical en la pantalla —eso
 * es ALZADO, y en un mundo visto desde arriba con perspectiva se lee plano—:
 * sube de su pie con el mismo pinhole que los edificios, así que bajo la cámara
 * es casi un punto y en el borde de la vista se inclina hacia afuera, como una
 * pared. La cabeza cuelga de un brazo sobre la CALZADA y se ve desde arriba, y
 * el sol le tira la sombra al suelo. Todo lo que tiene tamaño o color está en
 * `lights.json` → `stand25` / `stand`.
 */
function armSide(lamp, ang, reach) {
  if (lamp && lamp._arm !== undefined) return lamp._arm;
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const at = (k) => W.surfaceAt ? W.surfaceAt(lamp.x + nx * reach * k, lamp.y + ny * reach * k) : null;
  const side = hasSurfaceRole("CARRIAGEWAY", at(1)) ? 1 : hasSurfaceRole("CARRIAGEWAY", at(-1)) ? -1 : 0;
  if (lamp && W.tileResident && W.tileResident(lamp.x, lamp.y)) lamp._arm = side;
  return side;
}

function paintStanding(type, spec, x, y, opts) {
  const S = spec.stand25, G = LIGHTS.stand, ppm = PX_PER_M, H = S.heightM;
  const ang = opts.ang ?? 0, side = S.armM ? armSide(opts.lamp || { x, y }, ang, G.armProbeM * ppm) : 0;
  const nx = -Math.sin(ang) * side, ny = Math.cos(ang) * side, arm = S.armM * ppm;
  const hx0 = x + nx * arm, hy0 = y + ny * arm;            // la cabeza, en planta
  const top = parallaxOffset(state.cam, x, y, H, ppm), hd = parallaxOffset(state.cam, hx0, hy0, H, ppm);
  const tx = x + top.dx, ty = y + top.dy, hx = hx0 + hd.dx, hy = hy0 + hd.dy;
  const [hl, hw] = S.headM.map((m) => m * ppm);
  // la cabeza mira a lo largo de la calle; sin brazo (la torre) atraviesa el poste
  const ha = S.armM ? ang : ang + Math.PI / 2;
  const head = (cx, cy) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ha);
    ctx.beginPath(); ctx.roundRect(-hl / 2, -hw / 2, hl, hw, hw * 0.45); ctx.fill();
    ctx.restore();
  };
  // la sombra: poste, brazo y cabeza, corridos por el sol sobre el suelo
  const sh = sunShadow(H);
  if (sh.alpha > 0 && (sh.dx || sh.dy)) {
    ctx.save(); ctx.globalAlpha = sh.alpha; ctx.strokeStyle = G.shadow; ctx.fillStyle = G.shadow;
    ctx.lineWidth = S.postPx; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sh.dx, y + sh.dy); ctx.lineTo(hx0 + sh.dx, hy0 + sh.dy); ctx.stroke();
    head(hx0 + sh.dx, hy0 + sh.dy);
    ctx.restore();
  }
  // el pie, el poste y el brazo
  ctx.lineCap = "round"; ctx.strokeStyle = S.post; ctx.fillStyle = S.post;
  ctx.beginPath(); ctx.arc(x, y, S.postPx * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = S.postPx;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  // la cabeza vista desde arriba: la LENTE MIRA AL SUELO. Va un poco más abajo que la carcasa
  // (`lensDropM`) y se pinta primero, así lo que se ve es la carcasa oscura y apenas el borde de luz
  // que asoma del lado de la cámara — no un punto amarillo encima del poste.
  const k = Math.max(0, (H - (S.lensDropM || 0)) / H);
  const lx = hx0 + hd.dx * k, ly = hy0 + hd.dy * k;
  ctx.save(); ctx.translate(lx, ly); ctx.rotate(ha); ctx.fillStyle = spec.core;
  const n = S.lamps || 1, cell = hl / n;
  for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.roundRect(-hl / 2 + cell * (i + 0.06), -hw * 0.42, cell * 0.88, hw * 0.84, hw * 0.3); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = S.housing; head(hx, hy);
  // de noche el halo sale de la cabeza: el mismo de siempre, centrado donde está la lente
  const [ox, oy] = spec.haloAt;
  paintLuminaire(ctx, LIGHTS, type, lx - ox, ly - oy, { ...opts, night: opts.night ?? isNight() }, () => {});
}

/** An authored point light from the editor (`W.LIGHTS`). */
export function drawLight(feature) {
  const [x, y] = feature.geometry.point;
  const properties = feature.properties || {};
  // `street-light` features predate the type field, and a bare `light` was the
  // stadium one. Both defaults are kept so no authored light moves.
  const type = properties.lightType || (feature.type === "light" ? "stadium" : "warm");
  paintLight(type, x, y, {
    radius: properties.lightRadius,
    intensity: properties.lightIntensity,
  });
}

/**
 * LOS POSTES DEL ALUMBRADO, dibujados.
 *
 * `nightlights.js` abre el pozo de luz; esto pone la lámpara que lo hace. Sin
 * él el mundo tiene 18 978 charcos de luz flotando sobre la calle sin nada que
 * los explique — y de día, ninguna señal de que la ciudad esté alumbrada.
 *
 * EL DISEÑO ES DATA: el poste sale de `lights.json` como cualquier otra
 * luminaria, así que rediseñar la farola de la ciudad entera es editar una
 * lista de partes. Acá sólo va DÓNDE, que es lo que el mundo emite por tile.
 *
 * El HALO no se dibuja acá: sería el mismo error que tenía la noche antes —
 * un gradiente por lámpara pintado bajo el velo que lo tapa. La luz la abre el
 * compositor, contra el tinte y no debajo.
 */
export function drawStreetLamps(view) {
  const lamps = W.lampsIn ? W.lampsIn(view, 24) : [];
  for (const lamp of lamps) paintLight(lamp.type || "warm", lamp.x, lamp.y, { night: false, ang: lamp.ang, lamp });
}

/**
 * The vertex of a flat [x,y,…] ring furthest in a diagonal direction, pulled
 * back toward the centre.
 *
 * The polygon's OWN corner, not the bounding box's: a cuadra here is not square
 * to the screen and not even square to itself, so a bbox corner on a skewed
 * block sits off the pitch entirely. Same rule `standEdge` follows for an edge,
 * and the same rule `P.ang` follows for everything drawn on a parcel.
 */
function polyCorner(pts, dx, dy, inset) {
  const n = pts.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
  cx /= n; cy /= n;
  let bx = pts[0], by = pts[1], best = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = pts[i * 2], py = pts[i * 2 + 1];
    const s = px * dx + py * dy;
    if (s > best) { best = s; bx = px; by = py; }
  }
  const vx = cx - bx, vy = cy - by;
  const len = Math.hypot(vx, vy) || 1;
  return [bx + (vx / len) * inset, by + (vy / len) * inset];
}

//: The four corners of a pitch, which is where floodlight masts actually
//: stand — never along a touchline, because a mast there is in the way of the
//: game and of the stand.
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * The towers of a field, from its own emitted `footprint`.
 *
 * Same trick as the gradería and for the same reason: the traced cuadra already
 * follows the real street grid, so naming a corner is enough and the asset
 * needs no geometry of its own. That is what lets one record light two stadiums
 * whose blocks are different shapes and neither square to the screen.
 */
export function drawFieldTowers(lm, spec, spots = null) {
  const pts = lm.footprint;
  if (!pts || pts.length < 6 || !spec) return;
  // …y las torres igual: el mundo dice cuál cancha las lleva, `lights.json`
  // dice qué es una torre.
  const own = lm.towers;
  if (!own) return;                        // only the fields that have them
  const type = own.type || spec.type;
  const inset = own.inset ?? spec.inset;
  const night = isNight();
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
  cx /= pts.length / 2; cy /= pts.length / 2;
  // `spots`: dónde las pone el registro del estadio (`stadiums3d.<id>.towers`), si las pone; si no, las esquinas
  for (const [x, y] of spots || CORNERS.map(([dx, dy]) => polyCorner(pts, dx, dy, inset))) {
    // la fila de focos mira a la cancha: atraviesa la línea que va del poste al centro
    paintLight(type, x, y, { radius: own.radius ?? spec.radius, intensity: own.intensity ?? spec.intensity, night, ang: Math.atan2(cy - y, cx - x) });
  }
}
