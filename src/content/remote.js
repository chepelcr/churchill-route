// Remote content layer — supporters (greetings page), server NPCs and
// sponsored lotes come from ONE JSON endpoint so they can change without an
// app release. Today that "server" is a static file deployed with the site
// (public/content.json → https://churchill.jcampos.dev/content.json, editable
// on its own); later a real API can serve the SAME schema at the same URL.
//
// Schema (version 1):
// {
//   "version": 1,
//   "meta":       { "kofi": "https://ko-fi.com/..." },
//   "supporters": [ { "name", "tier": 1|2|3|4, "msg"? } ],
//   "npcs":       [ { "id", "name", "line", "lat", "lon" } ]   // OR x/y
//   "lotes":      [ { "id", "kind": "billboard"|"store", "name", "label",
//                     "lat", "lon" (or x/y), "tone"? } ]
// }
// Rules: if `npcs` is non-empty it REPLACES the bundled customer pool (the
// long-term plan: ALL NPCs come from the server). `line` ≤ 26 chars (delivery
// float truncates). Offline behavior: last good copy from localStorage, else
// the checked-in default — the game must always work with no network.
import { WORLD2D as W } from "../world2d/index.js";
import DEFAULT_CONTENT from "./default.json";

const CONTENT_URL = "https://churchill.jcampos.dev/content.json";
const CACHE_KEY = "churchill_content_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // re-fetch after 6h (and on every boot)
const FETCH_TIMEOUT_MS = 6000;

const listeners = new Set();
let data = { ...DEFAULT_CONTENT };

function emit() { for (const fn of listeners) fn(); }

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, body } = JSON.parse(raw);
    return { fresh: Date.now() - at < CACHE_TTL_MS, body };
  } catch { return null; }
}
function saveCache(body) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), body })); } catch { /* private */ }
}

// Project a content item to world coords: accepts explicit x/y, or lat/lon
// via the manifest's geo affine. Returns null if it can't be placed.
function toWorld(item) {
  if (Number.isFinite(item.x) && Number.isFinite(item.y)) return { x: item.x, y: item.y };
  const g = W.META && W.META.geo;
  if (!g || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return null;
  const x = g.ax * item.lon + g.bx, y = g.ay * item.lat + g.by;
  if (x < 0 || y < 0 || x > W.W || y > W.H) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function sanitize(body) {
  if (!body || typeof body !== "object" || (body.version | 0) < 1) return null;
  const out = { version: body.version | 0, meta: body.meta || {}, supporters: [], npcs: [], lotes: [] };
  for (const s of body.supporters || []) {
    if (s && s.name) out.supporters.push({ name: String(s.name).slice(0, 40), tier: Math.min(4, Math.max(1, s.tier | 0 || 1)), msg: s.msg ? String(s.msg).slice(0, 80) : null });
  }
  for (const n of body.npcs || []) {
    const pt = n && toWorld(n);
    if (!pt || !n.id || !n.name) continue;
    const d = W.districtAt(pt.x, pt.y);
    out.npcs.push({ id: `srv_${n.id}`, name: String(n.name).slice(0, 26), line: String(n.line || "¡Pura vida!").slice(0, 26), x: pt.x, y: pt.y, district: d ? d.id : null });
  }
  for (const l of body.lotes || []) {
    const pt = l && toWorld(l);
    if (!pt || !l.id || !l.name) continue;
    out.lotes.push({ id: String(l.id), kind: l.kind === "store" ? "store" : "billboard", name: String(l.name).slice(0, 30), label: String(l.label || l.name).slice(0, 14).toUpperCase(), x: pt.x, y: pt.y, tone: l.tone || "#f3c969" });
  }
  return out;
}

export const content = {
  get supporters() { return data.supporters; },
  get npcs() { return data.npcs; },
  get lotes() { return data.lotes; },
  get meta() { return data.meta || {}; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Call once at app start. Serves cache immediately, then refreshes from the
  // network in the background (stale-while-revalidate).
  async load() {
    const cached = loadCache();
    if (cached) {
      const ok = sanitize(cached.body);
      if (ok) { data = ok; emit(); }
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(CONTENT_URL, { signal: ctrl.signal, cache: "no-cache" });
      clearTimeout(timer);
      if (!res.ok) return;
      const body = await res.json();
      const ok = sanitize(body);
      if (ok) { data = ok; saveCache(body); emit(); }
    } catch { /* offline / timeout — cache or default already active */ }
  },
};
