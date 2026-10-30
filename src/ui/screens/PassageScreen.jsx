import React, { useEffect, useRef, useState } from "react";
import { Game } from "../../game/index.js";
import { useT } from "../../i18n/index.js";
import { sfx } from "../../game/audio.js";
import Icon from "../Icon.jsx";
import Slots from "../Slots.jsx";
import { UI_SCREEN } from "../../domain/vocabulary.generated.js";

// EL PASAJE — la pregunta del muelle y el agua que la contesta.
//
// No hay barco. El norte del mapa (Pitahaya y su tierra firme) está
// DESCONECTADO de la red manejable — medido sobre el mundo emitido: en 600 px a
// la redonda se acercan en un solo punto, y ahí hay un corte de 95 px — así que
// esto es una PUERTA entre dos muelles, con una transición encima.
//
// La transición está aquí y no en el renderer a propósito. El lazo de dibujo es
// una sola cadena de llamadas sin `try`, así que un solo throw dentro se lleva
// el cuadro entero y se lee como un congelamiento; una cortina de agua es
// exactamente la clase de adorno que no vale ese riesgo. En CSS es gratis, y
// el mundo está pausado detrás mientras dura.
const IN_MS = 620;    // el agua sube
const OUT_MS = 620;   // …y baja del otro lado

export default function PassageScreen({ onDone, onCancel }) {
  const t = useT();
  const [phase, setPhase] = useState("ask");   // ask | in | out
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const go = () => {
    sfx.play("menu_select");
    setPhase("in");
    // EL SALTO VA EN EL PUNTO CIEGO, con el agua arriba del todo. Hacerlo al
    // empezar la animación deja ver el teletransporte por debajo de una cortina
    // todavía translúcida, que es justo lo que la cortina existe para tapar.
    timers.current.push(setTimeout(async () => {
      // SE ESPERA AL OTRO LADO, con el agua arriba. `crossTheEstero` transmite
      // los tiles del destino antes de buscar dónde desembarcar, porque un tile
      // que no ha llegado contesta AGUA a todo; si eso tarda, la cortina se
      // queda llena, que es exactamente su trabajo.
      const to = await Game.crossTheEstero();
      // NULL ES UNA RESPUESTA: no había suelo al que salir. Se baja el agua sin
      // haber movido a nadie, en vez de dejarlo flotando en tierra firme.
      if (!to) sfx.play("menu_denied");
      setPhase("out");
      timers.current.push(setTimeout(onDone, OUT_MS));
    }, IN_MS));
  };
  const no = () => { sfx.play("menu_move"); onCancel(); };

  const SLOTS = {
    prompt: () => <>
      <h2 style={{ marginBottom: 10, font: "20px 'Bungee', sans-serif" }}>
        <Icon name="boat" size={18} /> {t("passage.title")}
      </h2>
      <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{t("passage.body")}</p>
    </>,
    note: () => (
      <p style={{ opacity: 0.7, fontSize: 12 }}>{t("passage.note")}</p>
    ),
    actions: () => (
      <div className="btn-row">
        <button className="btn gold" onClick={go}>{t("passage.go")}</button>
        <button className="btn secondary" onClick={no}>{t("passage.stay")}</button>
      </div>
    ),
  };
  const ctx = { asking: phase === "ask" };
  const slot = (region) => <Slots screen={UI_SCREEN.PASSAGE} region={region} ctx={ctx} slots={SLOTS} />;

  if (phase !== "ask") {
    return (
      <div className={"passage-veil " + (phase === "in" ? "rising" : "falling")}
           aria-hidden="true">
        <div className="passage-water"></div>
      </div>
    );
  }
  return (
    <div className="overlay">
      <div className="panel">
        {slot("main")}
        {slot("footer")}
        {slot("actions")}
      </div>
    </div>
  );
}
