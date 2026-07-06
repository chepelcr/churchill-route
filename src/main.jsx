import React from "react";
import ReactDOM from "react-dom/client";
import "./game/index.js";   // side-effect: builds the engine, sets window.Game
import App from "./ui/App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// Register the offline service worker (served from the site root).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW registration failed:", e));
  });
}
