import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// La Ruta del Churchill — served at the domain root (CNAME churchill.jcampos.dev),
// so base is "/". Output goes to dist/ for the GitHub Pages workflow.
export default defineConfig({
  base: "/",
  define: { __APP_VERSION__: JSON.stringify("v" + pkg.version) },
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2020",
    assetsInlineLimit: 0, // keep world-data etc. as real files, not inlined
    rollupOptions: {
      output: {
        // Three is an opt-in renderer milestone. A named dynamic chunk keeps it
        // out of the normal 2-D entry graph and makes that 0-KB promise visible
        // in every build report.
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) return "three";
        },
      },
    },
  },
  server: {
    port: 8734,
    host: true,
  },
});
