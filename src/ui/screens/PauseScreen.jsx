import React from "react";

export default function PauseScreen({ onResume, onQuit }) {
  return (
    <div className="overlay">
      <div className="panel">
        <h2>PAUSA</h2>
        <p style={{ opacity: 0.7, marginTop: 0 }}>Tomate un respiro. El puerto no se va a ningún lado.</p>
        <div className="btn-row">
          <button className="btn gold" onClick={onResume}>▸ Continuar</button>
          <button className="btn secondary" onClick={onQuit}>Salir al menú</button>
        </div>
      </div>
    </div>
  );
}
