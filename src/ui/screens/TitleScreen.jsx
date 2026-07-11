import React from "react";

export const MODE_CARDS = [
  { id: "story",   name: "Historia",  swatch: "#ffe06b", tag: "7 etapas, de El Faro hasta el puerto de Caldera." },
  { id: "explore", name: "Recorrer",  swatch: "#6fbf99", tag: "Mundo abierto. Limpiá etapas para abrir nuevos distritos." },
  { id: "arcade",  name: "Arcade",    swatch: "#ff3d80", tag: "3 minutos, península libre, combo a tope." },
];

export default function TitleScreen({ onPickMode }) {
  return (
    <div className="title-bg">
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "-40px", bottom: "-20px", fontSize: "240px", lineHeight: 1, opacity: 0.35 }}>🌴</div>
        <div style={{ position: "absolute", right: "-30px", bottom: "-30px", fontSize: "300px", lineHeight: 1, opacity: 0.28 }}>🌴</div>
      </div>
      <div className="title-shell">
        <div className="title-card">
          <span className="title-pill"><span className="dot"></span>PUNTARENAS · COSTA RICA · ARCADE 2026</span>
          <h1 className="title-main">LA RUTA DEL CHURCHILL</h1>
          <div className="title-sub">¡PURA VIDA!</div>
          <p className="title-tag">
            Sos repartidor de Churchills en El Puerto. Recogé en el kiosco rojo y blanco del{" "}
            <em>Paseo de los Turistas</em> y llegá al cliente antes que el hielo se derrita. Hacé drift,
            esquivá gaviotas y atravesá Carmen, el Mercado y Las Playitas hasta Mata de Limón.
          </p>

          <div className="modes" style={{ gridTemplateColumns: "repeat(3, 1fr)", maxWidth: 760, margin: "18px auto" }}>
            {MODE_CARDS.map((m) => (
              <button key={m.id} className="mode" onClick={() => onPickMode(m.id)}>
                <div className="mt"><span className="sw" style={{ background: m.swatch }}></span>{m.name}</div>
                <div className="ms">{m.tag}</div>
              </button>
            ))}
          </div>

          <div className="controls-hint">
            {typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? (
              <span>Mantené el dedo donde querés ir · ✋ drift · ⚡ turbo</span>
            ) : (
              <>
                <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> manejar</span>
                <span><kbd>Space</kbd> drift</span>
                <span><kbd>X</kbd> turbo</span>
                <span><kbd>P</kbd> pausa</span>
                <span>controller / touch OK</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
