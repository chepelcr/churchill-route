// LAS MEDIDAS DEL MUNDO — the client's end of `src/assets/world-units.json`.
//
// The registry holds real lengths in METRES; this module turns them into this
// build's pixels, once, so no module derives its own. The builder does exactly
// the same thing on its side (`px()` in `churchill/world/config.py`), reading
// the same file — which is the point: a length that two runtimes must agree
// about is authored in one place, in the unit that survives a rescale.
//
// WHY, in one sentence: every constant here used to be a px literal, and a px
// literal is only true at the scale it was tuned at. This world has been
// rescaled three times; at 1.6 -> 2.0 the street-search spans stopped reaching
// Calle 6 and took Kiosco Playitas off the drivable network, and at 2.0 -> 2.5
// the hand-laid px anchors missed the real manzanas by 4 000 px and the whole
// civic centre stopped existing. Neither failed anything.
//
// What is NOT here: a margin inside one drawing recipe, a UI size in CSS px, a
// simplification tolerance measured on a drawn vector. Those are not lengths in
// the world. See `_scope` in the registry.
import { WORLD2D as W } from "../world2d/index.js";
import UNITS from "../assets/world-units.json" with { type: "json" };

/** World px per metre, from the manifest (`W` owns the one legacy default). */
export const PX_PER_M = W.PX_PER_M;

/** A real length in this build's world pixels. The one conversion. */
export function px(m) { return Math.round(m * PX_PER_M); }

// ----- the camera ------------------------------------------------------------
// The framing used to be `CUADS_PER_VIEW * CUAD` — a SCREEN decision expressed
// in the block-detection grid, so resizing that grid resized the player's view
// with it, for no reason anybody had chosen. It is metres of ground now.
/** How much ground the camera frames across the viewport, in world px. */
export const VIEW_WIDTH_PX = px(UNITS.camera.viewWidthM);
/**
 * The legibility FLOOR: the least screen px a world px may shrink to.
 *
 * It was a bare `2.2` in `computeZoom`, and it is the constant everybody
 * forgets — it binds on every screen narrower than 880 CSS px, i.e. every phone
 * in landscape, where it silently converts the framing trade from "how big is
 * the car" into "how much road can you see". Being a MAGNIFICATION it scales
 * INVERSELY with the world's scale, so the intuitive guess (raise it with
 * px/m) crops a phone to a third of its view. Authored as screen px per METRE,
 * which is scale-free, and divided back here.
 */
export const MIN_ZOOM = UNITS.camera.minScreenPxPerM / PX_PER_M;

// ----- la Travesía -----------------------------------------------------------
/** Arclength between the channel's sounding stations. Emitted as `channel.pitch`. */
export const CHANNEL_PITCH = px(UNITS.channel.pitchM);
/**
 * Arclength either side of a station the lane's heading is averaged over.
 *
 * NOT emitted with the channel, so this and the builder's `TANGENT_SPAN` were
 * two copies of one number with a comment at each end asking the other to keep
 * up. The route averages ~23 px a segment, so disagreeing is a few degrees —
 * at 150 px out, the difference between mid-channel and the mangrove.
 */
export const TANGENT_SPAN = px(UNITS.channel.tangentSpanM);

// ----- los ferris del golfo --------------------------------------------------
// PER VESSEL in the world (`deck`, `dockS`), because the editor can give one
// boat her own deck — and the lancha del estero already has one, being a much
// smaller boat. These are the fallbacks for a manifest built before those
// fields existed: one place, derived, rather than the four literals this
// contract used to be spread over.
export const FERRY_DECK_L = px(UNITS.vessels.ferry.deckLengthM);
export const FERRY_DECK_W = px(UNITS.vessels.ferry.deckWidthM);
export const FERRY_DOCK_S = px(UNITS.vessels.ferry.dockOffsetM);

//: EL POZO DE UNA LÁMPARA, en px del mundo. Es lo que decide si una calle se lee
//: continua o como una fila de islas: por debajo de la mitad del espaciado
//: quedan pozos separados, por encima se funden y la noche vuelve a ser plana.
export const LAMP_POOL_R = px(UNITS.world.lighting.poolRadiusM);
