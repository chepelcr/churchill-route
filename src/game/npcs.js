// The NPC registry — who exists, how many, how fast, and WHERE THEY MAY STAND.
//
// Four advancers exist and each used to hardcode its habitat: rail walkers on
// road centrelines, fans inside a pitch footprint, swimmers inside the
// balneario, passengers at a parada. The advancers stay code — they are physics
// — but the rest is `npcTypes.json`, so adding a type, thinning a crowd or
// letting hinchas onto the plaza is a data edit the world editor can make.
//
// THE `hosts` LIST IS THE PLACEMENT RULE, and it is checked in the two places
// that can actually answer it, exactly like `properties.host`:
//
//   * the SHAPE (does this type exist? is the host kind spelled right?) in the
//     editor's validateProject, which has no raster;
//   * WHERE IT STANDS, against the surface grid, in the build — and again here
//     at runtime, since an authored NPC also has to survive a world rebuild
//     that moved the ground out from under it.
//
// A hosts entry is either a SURFACE class name (`water`, `acera`, …) or a host
// reference `kind` / `kind:use` (`parcel`, `parcel:pool`). Nothing else parses,
// and an unknown entry is ignored rather than silently allowing everything.
import registry from "./npcTypes.json";
import { SURFACE_CLASSES } from "./surfaces.js";

export const NPC_TYPES = registry.types;

const byId = new Map(NPC_TYPES.map((type) => [type.id, type]));

/** The registry entry for `id`, or the default walker. A type that vanished
 *  from the registry must still draw and move as SOMETHING — a silently
 *  missing person is harder to notice than a wrong one. */
export function npcType(id) {
  return byId.get(id) || byId.get("walker") || NPC_TYPES[0];
}

/** WHICH DRAWING A TYPE USES — the registry's `art` field, and the join the
 *  whole actor catalog hangs off. A type's ID is not its ART: `supporter` and
 *  `fan` are two crowds that look the same, `mascot` and an authored NPC share
 *  one figure. Reading `kind` as the art directly is why a `supporter` spawned
 *  on a plaza came out drawn as an ordinary commuter. */
export function npcArt(id) {
  return npcType(id).art || id;
}

/** [min, max] speed of a type, as one sample. */
export function npcSpeed(id) {
  const [lo, hi] = npcType(id).speed || [14, 26];
  return lo + Math.random() * Math.max(0, hi - lo);
}

/** How many of this type an area of `area` px² holds, per its density block.
 *  A cancha de barrio is 60 px across and Lito Pérez 210: a constant is a
 *  scrum on the first and nothing on the second. */
export function npcCrowdSize(id, area) {
  const density = npcType(id).density || {};
  if (density.count) return density.count;
  const box = (density.perBox || 17) ** 2 * (density.boxes || 6);
  const room = Math.floor(Math.max(1, area) / box);
  return Math.max(density.min ?? 1, Math.min(density.max ?? 12, room));
}

/** The SURFACE classes in a type's hosts list, as raster ints. This is the same
 *  list twice over on purpose: where a type may be PLACED is where it may
 *  WANDER, so a vecino who may stand on the acera cannot drift into the road. */
export function npcSurfaceClasses(id) {
  const classes = (npcType(id).hosts || [])
    .map((entry) => SURFACE_CLASSES.indexOf(String(entry).split(":")[0]))
    .filter((index) => index >= 0);
  return classes.length ? classes : [3, 4, 6, 7];
}

/** Split a hosts entry into what it names. */
function parseHost(entry) {
  const [kind, use] = String(entry).split(":");
  if (SURFACE_CLASSES.includes(kind)) return { surface: SURFACE_CLASSES.indexOf(kind) };
  return { hostKind: kind, use: use || null };
}

/**
 * May this type stand here? `surfaceClass` is the raster class under the point;
 * `host` the feature's declared `{kind, id, use}`, when it has one.
 * @returns {{ok: boolean, allowed: string[]}}
 */
export function npcMayStand(id, surfaceClass, host = null) {
  const type = npcType(id);
  const hosts = type.hosts || [];
  if (!hosts.length) return { ok: true, allowed: [] };
  for (const entry of hosts) {
    const rule = parseHost(entry);
    if (rule.surface !== undefined && rule.surface === surfaceClass) return { ok: true, allowed: hosts };
    if (rule.hostKind && host?.kind === rule.hostKind && (!rule.use || host.use === rule.use)) {
      return { ok: true, allowed: hosts };
    }
  }
  return { ok: false, allowed: hosts };
}
