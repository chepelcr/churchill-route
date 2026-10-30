// i18n — the string catalogs are DATA (`src/i18n/<lang>.json`); this module is
// only the registry, the language store and the lookup. `t("key", {vars})`
// everywhere a player-facing string is produced (React UI, game storyTips/
// floats, canvas barrier signs). React components re-render on language change
// via useT() (useSyncExternalStore). Customer flavor "line" quotes intentionally
// stay in Spanish — they're the port's voice — but every instructional string is
// translated.
//
// ADDING A LANGUAGE IS A DATA OPERATION: drop `xx.json` beside this file, import
// it into CATALOG, and add one LANGUAGES entry. Nothing else in the game
// changes. Stage names and briefs live in the generated world data (Spanish);
// `stages.json` holds the per-language overlay keyed by stage id.
import { useSyncExternalStore } from "react";
import es from "./es.json";
import en from "./en.json";
import stageOverlay from "./stages.json";

const LANG_KEY = "churchill_lang_v1";

// The order here is the order a language picker shows.
export const LANGUAGES = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

const CATALOG = { es, en };

// Runtime overrides from the authored content block (see src/ui/theme.js).
// They sit ON TOP of the catalogs so a wording fix ships without an app
// release, and they are keyed the same way, so authored copy and translations
// never become two different things.
let overrides = {};

// Spanish is the source of truth: a key missing from another catalog falls back
// to it before falling back to the raw key. FALLBACK_LANG is what a browser in
// some third language gets.
const BASE_LANG = "es";
const FALLBACK_LANG = "en";

const isKnown = (id) => Object.prototype.hasOwnProperty.call(CATALOG, id);

export function languageIds() {
  return LANGUAGES.map((entry) => entry.id);
}

// ---- store -----------------------------------------------------------------
function defaultLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && isKnown(saved)) return saved;
  } catch { /* private mode */ }
  const nav = ((typeof navigator !== "undefined" && (navigator.language || "")) || BASE_LANG).toLowerCase();
  return languageIds().find((id) => nav.startsWith(id)) || FALLBACK_LANG;
}

let lang = typeof window !== "undefined" ? defaultLang() : BASE_LANG;
const listeners = new Set();
// useSyncExternalStore re-renders only when the SNAPSHOT changes. Using the
// language alone meant an authored copy override applied silently: the strings
// changed underneath React and nothing re-rendered. The revision covers both.
let revision = 0;
const storeSnapshot = () => `${lang}#${revision}`;

export function getLang() { return lang; }
export function setLang(l) {
  if (!isKnown(l)) return;
  lang = l;
  revision += 1;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  for (const fn of listeners) fn();
}

/** Replace the runtime override layer and re-render every subscriber. */
export function setOverrides(next) {
  overrides = next && typeof next === "object" ? next : {};
  revision += 1;
  for (const fn of listeners) fn();
}

export function t(key, vars) {
  let s = overrides[lang]?.[key]
    ?? CATALOG[lang]?.[key]
    ?? overrides[BASE_LANG]?.[key]
    ?? CATALOG[BASE_LANG][key]
    ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

export function stageName(stage) {
  return stageOverlay[lang]?.[stage.id]?.name || stage.name;
}
export function stageBrief(stage) {
  return stageOverlay[lang]?.[stage.id]?.brief || stage.brief;
}

// React: re-render on language change. Returns t (stable semantics — reads
// the current language at call time).
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function useT() {
  useSyncExternalStore(subscribe, storeSnapshot, () => `${BASE_LANG}#0`);
  return t;
}
