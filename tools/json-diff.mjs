// Compare two style snapshots key by key.
//
//   node tools/json-diff.mjs before.json after.json
//
// Reports every element whose computed value changed, and — separately — every
// element that appeared or vanished, because a screen that stopped mounting is
// not a pass. Exits non-zero on any difference.
import { readFileSync } from "node:fs";

const a = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = JSON.parse(readFileSync(process.argv[3], "utf8"));

const ka = new Set(Object.keys(a.all)), kb = new Set(Object.keys(b.all));
const gone = [...ka].filter((k) => !kb.has(k));
const added = [...kb].filter((k) => !ka.has(k));

let changed = 0;
const samples = [];
for (const k of ka) {
  if (!kb.has(k)) continue;
  for (const p of Object.keys(a.all[k])) {
    if (a.all[k][p] !== b.all[k][p]) {
      changed++;
      if (samples.length < 12) samples.push(`${k}\n    ${p}: ${a.all[k][p]}  ->  ${b.all[k][p]}`);
    }
  }
}

console.log(`[styles] before: ${a.elements} elements on ${a.screens.length} screens`);
console.log(`[styles] after:  ${b.elements} elements on ${b.screens.length} screens`);
if (gone.length) console.log(`[styles] ${gone.length} elements VANISHED, e.g. ${gone.slice(0, 3).join(" | ")}`);
if (added.length) console.log(`[styles] ${added.length} elements APPEARED, e.g. ${added.slice(0, 3).join(" | ")}`);
if (changed) {
  console.log(`[styles] ${changed} computed values CHANGED:`);
  for (const s of samples) console.log(`  ${s}`);
} else {
  console.log(`[styles] every computed value IDENTICAL`);
}
process.exit(changed || gone.length ? 1 : 0);
