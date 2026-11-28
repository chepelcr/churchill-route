import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(base, "..");
const readJSON = async (path) => JSON.parse(await readFile(join(base, path), "utf8"));
const themePath = join(root, "src/ui/themeTokens.json");
const stylesPath = join(root, "src/styles.css");
const [tokens, identity, components, themeSource, gameStyles, variantsTemplate] = await Promise.all([
  readJSON("tokens.json"), readJSON("identity.json"), readFile(join(base, "components.css"), "utf8"),
  readFile(themePath, "utf8"), readFile(stylesPath, "utf8"), readFile(join(base, "variants.template.html"), "utf8"),
]);
const args = process.argv.slice(2);
if (args.length > 0 && !(args.length === 1 && args[0] === "--check") &&
    !(args.length === 2 && args[0] === "--out")) {
  throw new Error("Uso: node brand/export.mjs [--check | --out directorio]");
}

for (const mark of Object.values(identity.marks)) {
  for (const [path, expected] of [[mark.source, mark.sha256], [mark.boot, mark.bootSha256]]) {
    if (!path) continue;
    const source = await readFile(join(root, path));
    if (createHash("sha256").update(source).digest("hex") !== expected) {
      throw new Error(`Revisá la procedencia y el SHA-256 de ${path}`);
    }
  }
}
for (const language of ["es", "en"]) {
  const strings = JSON.parse(await readFile(join(root, "src/i18n", `${language}.json`), "utf8"));
  if (identity.titleLines.join(" ") !== strings["title.main"]) throw new Error(`Título desactualizado en ${language}`);
}

const declarations = [
  ...Object.entries(tokens.colors),
  ...Object.entries(tokens.roles).map(([key, color]) => [key, `var(--lrc-${color})`]),
  ...Object.entries(tokens.fonts).map(([key, font]) => [`font-${key}`, `"${font.family}", ${font.fallback}`]),
  ...Object.entries(tokens.shape),
  ...Object.entries(tokens.motion),
];
const css = `/* Generado por node brand/export.mjs */\n:root {\n${declarations.map(([key, value]) => `  --lrc-${key}: ${value};`).join("\n")}\n}\n\n${components}`;
const fontFile = (font, weight) => `${font.package}-latin-${weight}-normal.woff2`;
const fontFace = (font, weight, url) =>
  `@font-face { font-family: "${font.family}"; font-weight: ${weight}; src: url("${url}") format("woff2"); }`;
const htmlEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (value) => value.replace(/[&<>"]/g, (character) => htmlEntities[character]);
const variants = (markUrl, fontFaces = "") => {
  const fields = {
    fontFaces,
    fullTitle: escapeHtml(identity.titleLines.join(" ")),
    firstLine: escapeHtml(identity.titleLines[0]),
    secondLine: escapeHtml(identity.titleLines[1]),
    churchill: escapeHtml(markUrl(identity.marks.churchill)),
    studio: escapeHtml(markUrl(identity.marks.studio)),
  };
  return variantsTemplate.replace(/\{\{(\w+)\}\}/g, (_match, field) => fields[field]);
};
const localVariants = variants((mark) => `../${mark.source}`, Object.values(tokens.fonts).map((font) =>
  `    ${fontFace(font, 400, `../node_modules/@fontsource/${font.package}/files/${fontFile(font, 400)}`)}`
).join("\n"));
const rgb = (hex) => hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
const colorTable = [
  "# Colores de marca", "", "Valores sRGB del [catálogo de tokens](tokens.json).", "",
  "| Token | HEX | RGB |", "| --- | --- | --- |",
  ...Object.entries(tokens.colors).map(([key, hex]) => `| \`--lrc-${key}\` | \`${hex}\` | \`${rgb(hex).join(", ")}\` |`),
  "",
].join("\n");
const theme = JSON.parse(themeSource);
const values = new Map(declarations);
let updatedStyles = gameStyles;
for (const [id, key] of Object.entries(tokens.gameTheme)) {
  const token = theme.tokens.find((entry) => entry.id === id);
  const value = values.get(key);
  if (!token || !value) throw new Error(`Revisá la referencia de tema ${id} → ${key}`);
  token.default = token.type === "channelRgb" ? rgb(value).join(",") : value;
  const declaration = new RegExp(`^(  ${token.css}: )[^;]+;`, "m");
  if (!declaration.test(updatedStyles)) throw new Error(`Falta ${token.css} en styles.css`);
  updatedStyles = updatedStyles.replace(declaration, (_match, prefix) => `${prefix}${token.default};`);
}
const updatedTheme = JSON.stringify(theme, null, 2) + "\n";
const contrast = (first, second) => {
  const luminance = (color) => {
    const channels = rgb(tokens.colors[color]).map((channel) => channel / 255);
    const [r, g, b] = channels.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
for (const pair of [["text", "surface-raised"], ["text-muted", "surface-raised"], ["on-action", "action"], ["light-ink", "light-surface"]]) {
  if (contrast(...pair.map((role) => tokens.roles[role])) < 4.5) throw new Error(`Contraste insuficiente: ${pair.join(" / ")}`);
}

if (args[0] === "--check") {
  if (await readFile(join(base, "brand.css"), "utf8") !== css ||
      await readFile(join(base, "COLORES.md"), "utf8") !== colorTable ||
      await readFile(join(base, "variants.html"), "utf8") !== localVariants ||
      updatedStyles !== gameStyles || updatedTheme !== themeSource) {
    throw new Error("Actualizá las proyecciones con node brand/export.mjs");
  }
} else if (args[0] === "--out") {
  const out = resolve(args[1]);
  const fonts = join(out, "fonts");
  await mkdir(fonts, { recursive: true });
  await mkdir(join(out, "licenses"), { recursive: true });
  const faces = [];
  for (const font of Object.values(tokens.fonts)) {
    const license = `${font.family.replaceAll(" ", "-")}-OFL.txt`;
    await copyFile(join(base, "licenses", license), join(out, "licenses", license));
    for (const weight of font.weights) {
      const file = fontFile(font, weight);
      await copyFile(join(root, "node_modules/@fontsource", font.package, "files", file), join(fonts, file));
      faces.push(fontFace(font, weight, `./fonts/${file}`));
    }
  }
  await Promise.all([
    ...Object.values(identity.marks).map((mark) => copyFile(join(root, mark.source), join(out, mark.file))),
    copyFile(join(base, "identity.json"), join(out, "identity.json")),
    copyFile(join(base, "tokens.json"), join(out, "tokens.json")),
    copyFile(join(base, "remotion.jsx"), join(out, "remotion.jsx")),
    copyFile(join(base, "Ferry.jsx"), join(out, "Ferry.jsx")),
    copyFile(join(base, "ocean.jsx"), join(out, "ocean.jsx")),
    writeFile(join(out, "variants.html"), variants((mark) => `./${mark.file}`)),
    writeFile(join(out, "COLORES.md"), colorTable),
    writeFile(join(out, "brand.css"), `${faces.join("\n")}\n\n${css}`),
    writeFile(join(out, "identity.js"), `(() => {\n  const title = ${JSON.stringify(identity.titleLines)};\n  document.querySelectorAll("[data-brand-title]").forEach((node) => {\n    const text = node.dataset.brandTitle === "full" ? title.join(" ") : title[Number(node.dataset.brandTitle)];\n    node.dataset.t = text;\n    node.firstElementChild.textContent = text;\n  });\n})();\n`),
  ]);
} else {
  await Promise.all([
    writeFile(join(base, "brand.css"), css),
    writeFile(join(base, "COLORES.md"), colorTable),
    writeFile(join(base, "variants.html"), localVariants),
    writeFile(stylesPath, updatedStyles),
    writeFile(themePath, updatedTheme),
  ]);
}
