// EL INTÉRPRETE DE PANTALLAS — the engine's half of `src/ui/screens.json`.
//
// It walks a screen's slot list in the registry's order, drops the ones whose
// `when` is false, and renders each id from the screen's own `SLOTS` map. That
// is the whole thing, and it is deliberately the whole thing:
//
//   * **no expressions.** `when` is a KEY of the context the screen built, not
//     a predicate this file parses. The moment it can express `!a && b` this
//     has become a layout language, which is a worse trade than the JSX it
//     replaced — and it is the trade that was explicitly rejected.
//   * **no layout.** A screen keeps its own skeleton and mounts `<Slots>` where
//     a list of blocks belongs, so the cards and the scroll bodies stay in CSS's
//     language. `region` is which mount point, not a position.
//   * **no invented ids.** A slot id with no component is skipped with one
//     warning; `tests/test_screens.py` is what actually stops it shipping,
//     because an editor writing an unknown id would otherwise render nothing
//     and say nothing.
import React from "react";
import REGISTRY from "./screens.json";

/** The registry's record for a screen, or null. */
export function screenRecord(screen) {
  return REGISTRY.screens[screen] || null;
}

/** Every screen the registry describes — for the editor and the tests. */
export function screenIds() {
  return Object.keys(REGISTRY.screens);
}

/**
 * The slots of one region, in registry order, after `when` and `hidden`.
 *
 * Exported on its own so a screen can ask "is this region empty?" — an empty
 * button row still draws its border, and a wrapper around nothing is a visible
 * gap rather than nothing at all.
 */
export function slotsFor(screen, region = "main", ctx = {}) {
  const rec = screenRecord(screen);
  if (!rec) return [];
  return rec.slots.filter((s) => (s.region || "main") === region
    && !s.hidden
    && (!s.when || !!ctx[s.when]));
}

/**
 * Render a screen's slots for one region.
 *
 * @param {string} screen   a UIScreen id — the registry's key
 * @param {string} region   which mount point, default "main"
 * @param {object} ctx      the screen's own state; `when` keys are read from it
 * @param {object} slots    { [id]: () => JSX } — the screen's components
 */
export default function Slots({ screen, region = "main", ctx = {}, slots = {} }) {
  return slotsFor(screen, region, ctx).map((s) => {
    const render = slots[s.id];
    if (!render) {
      warnOnce(`${screen}.${s.id} has no component; the block is skipped`);
      return null;
    }
    return <React.Fragment key={s.id}>{render(ctx)}</React.Fragment>;
  });
}

const _warned = new Set();
function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn(`[screens] ${msg}`);
}
