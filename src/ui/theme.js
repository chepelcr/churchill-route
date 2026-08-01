// Theme + authored copy, applied from RUNTIME content so a restyle or a wording
// fix ships without a rebuild and without an app release.
//
// Two things arrive in `content.ui`:
//   theme:   { <token id>: value }        -> CSS custom properties on :root
//   strings: { <lang>: { key: text } }    -> overrides layered over the i18n
//                                            catalogs, so authored copy and
//                                            translations are the SAME keys
//
// Anything absent falls back to the built-in value, which is why an empty `ui`
// block renders exactly like today. `src/ui/themeTokens.json` is the registry
// both the game and the world editor read, so neither hardcodes the token list.
import TOKEN_FILE from "./themeTokens.json";
import { setOverrides } from "../i18n/index.js";

export const THEME_TOKENS = TOKEN_FILE.tokens;

const byId = new Map(THEME_TOKENS.map((token) => [token.id, token]));

/** The values the stylesheet ships with — the baseline an editor should show. */
export function defaultTheme() {
  return Object.fromEntries(THEME_TOKENS.map((token) => [token.id, token.default]));
}

/**
 * Apply authored tokens to :root. Unknown ids are ignored rather than written
 * as stray properties — the registry is the contract.
 */
export function applyTheme(theme = {}) {
  if (typeof document === "undefined") return [];
  const root = document.documentElement;
  const applied = [];
  for (const token of THEME_TOKENS) {
    const value = theme?.[token.id];
    if (typeof value === "string" && value.trim()) {
      root.style.setProperty(token.css, value.trim());
      applied.push(token.id);
    } else {
      // Removing restores the stylesheet's own value instead of freezing the
      // last authored one — clearing a field in the editor has to be undoable.
      root.style.removeProperty(token.css);
    }
  }
  return applied;
}

/** Layer authored copy over the translation catalogs. */
export function applyStrings(strings = {}) {
  setOverrides(strings && typeof strings === "object" ? strings : {});
}

/** Everything the runtime UI block controls, applied together. */
export function applyUiContent(ui = {}) {
  applyTheme(ui?.theme || {});
  applyStrings(ui?.strings || {});
  return { theme: Object.keys(ui?.theme || {}), languages: Object.keys(ui?.strings || {}) };
}

export function tokenById(id) {
  return byId.get(id) || null;
}

/**
 * Per-screen accent/backdrop. There are two authoring homes for this and they
 * must not fight: the world manifest's editorUI (authored at build time, needs
 * a rebuild) and the runtime content block (live). Precedence, weakest first:
 *
 *   stylesheet default -> theme token -> manifest screen -> runtime screen
 *
 * The screen effect used to fall back to a hardcoded literal, which silently
 * un-applied the authored theme every time the screen changed.
 */
export function applyScreen(screen, { manifestUi = {}, contentUi = {} } = {}) {
  if (typeof document === "undefined") return {};
  const root = document.documentElement;
  const theme = contentUi?.theme || {};
  const fromManifest = manifestUi?.screens?.[screen] || {};
  const fromContent = contentUi?.screens?.[screen] || {};

  const pick = (key, tokenId) => fromContent[key] || fromManifest[key]
    || theme[tokenId] || byId.get(tokenId)?.default;

  const accent = pick("accent", "gold");
  const background = pick("background", "editorScreenBg");
  root.style.setProperty("--gold", accent);
  root.style.setProperty("--editor-screen-bg", background);
  return { accent, background };
}
