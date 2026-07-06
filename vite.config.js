import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La Ruta del Churchill — served at the domain root (CNAME churchill.jcampos.dev),
// so base is "/". Output goes to dist/ for the GitHub Pages workflow.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2020",
    assetsInlineLimit: 0, // keep world-data etc. as real files, not inlined
  },
  server: {
    port: 8734,
    host: true,
  },
});
