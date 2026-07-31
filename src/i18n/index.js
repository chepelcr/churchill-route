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

export function getLang() { return lang; }
export function setLang(l) {
  if (!isKnown(l)) return;
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  for (const fn of listeners) fn();
}

export function t(key, vars) {
  let s = CATALOG[lang]?.[key] ?? CATALOG[BASE_LANG][key] ?? key;
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
  useSyncExternalStore(subscribe, getLang, () => BASE_LANG);
  return t;
}
