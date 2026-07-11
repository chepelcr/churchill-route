import React, { useState, useEffect, useRef } from "react";
import { useMenuNav } from "../useMenuNav.js";
import { sfx } from "../../game/audio.js";

// Hide the APK download in the native app (only offer it on the web).
const IS_NATIVE = typeof window !== "undefined" && !!window.Capacitor;

export const MODE_CARDS = [
  { id: "story",   name: "Historia",  swatch: "#ffe06b", tag: "7 niveles, de El Faro hasta el puerto de Caldera." },
  { id: "explore", name: "Recorrer",  swatch: "#6fbf99", tag: "Mundo abierto. Completá niveles para abrir nuevos distritos." },
  { id: "arcade",  name: "Arcade",    swatch: "#ff3d80", tag: "3 minutos, península libre, combo a tope." },
];

export default function TitleScreen({ onPickMode }) {
  const [muted, setMuted] = useState(sfx.muted);
  const [info, setInfo] = useState(false);
  const infoRef = useRef(null);
  const pick = (id) => { sfx.play("menu_select"); onPickMode(id); };
  const [idx, setIdx] = useMenuNav({
    count: MODE_CARDS.length,
    cols: MODE_CARDS.length,
    onSelect: (i) => pick(MODE_CARDS[i].id),
  });

  // close the info bubble on any click/tap outside it
  useEffect(() => {
    if (!info) return;
    const onDown = (e) => { if (infoRef.current && !infoRef.current.contains(e.target)) setInfo(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [info]);

  return (
    <div className="title-bg">
      <div className="title-shell">
        <div className="title-card">
          <span className="title-pill"><span className="dot"></span>PUNTARENAS · COSTA RICA · ARCADE 2026</span>
          <div className="title-tools">
            <div className="info-wrap" ref={infoRef}>
              <button className="tool-pill" onClick={() => { sfx.play("menu_move"); setInfo((v) => !v); }}
                aria-label="Cómo se juega" aria-expanded={info}>{info ? "✕" : "ⓘ"}</button>
              {info && (
                <div className="info-bubble" role="dialog" aria-label="Cómo se juega">
                  <div className="info-bubble-title">CÓMO SE JUEGA</div>
                  <p>
                    Sos repartidor de Churchills en El Puerto. Recogé en el kiosco rojo y blanco del{" "}
                    <em>Paseo de los Turistas</em> y llegá al cliente antes que el hielo se derrita. Hacé drift,
                    esquivá gaviotas y atravesá Carmen, el Mercado y Las Playitas hasta Mata de Limón.
                  </p>
                </div>
              )}
            </div>
            <button className="tool-pill" onClick={() => setMuted(sfx.toggleMuted())}
              aria-label={muted ? "Activar sonido" : "Silenciar"}>{muted ? "🔇" : "🔊"}</button>
          </div>
          <h1 className="title-main">LA RUTA DEL CHURCHILL</h1>
          <div className="title-sub">¡PURA VIDA!</div>

          <div className="modes" style={{ gridTemplateColumns: "repeat(3, 1fr)", maxWidth: 760, margin: "16px auto" }}>
            {MODE_CARDS.map((m, i) => (
              <button key={m.id} className={"mode" + (idx === i ? " focused" : "")}
                onMouseEnter={() => setIdx(i)} onClick={() => pick(m.id)}>
                <div className="mt"><span className="sw" style={{ background: m.swatch }}></span>{m.name}</div>
                <div className="ms">{m.tag}</div>
              </button>
            ))}
          </div>

          {!IS_NATIVE && (
            <a className="apk-btn" href="/churchill.apk" download>
              <span aria-hidden="true">⬇</span> Descargar para Android
            </a>
          )}

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
