import React from "react";
import ReactDOM from "react-dom/client";
// Self-hosted fonts (bundled woff2 — the game works fully offline / in the APK)
import "@fontsource/bungee/400.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./game/index.js";   // side-effect: builds the engine, sets window.Game
import App from "./ui/App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// Register the offline service worker (served from the site root). Inside the
// Capacitor shell the app is already local — a SW would only cache stale bundles.
if ("serviceWorker" in navigator && !window.Capacitor) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW registration failed:", e));
  });
}
