import React, { useState } from "react";
import { useT } from "../../i18n/index.js";
import { UI_SCREEN } from "../../domain/vocabulary.generated.js";
import { sfx } from "../../game/audio.js";
import Slots from "../Slots.jsx";

// First-run lore intro: three short story beats over the live attract world,
// then straight into the tutorial. Shown once (localStorage); the last slide
// carries the one non-intrusive "you can support this" line.
const SEEN_KEY = "churchill_intro_seen_v1";
export function introSeen() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }
}

const SLIDES = 3;

export default function IntroScreen({ onDone }) {
  const t = useT();
  const [slide, setSlide] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const last = slide === SLIDES - 1;
  const finish = () => { markSeen(); onDone(); };
  const next = () => {
    if (leaving) return;
    sfx.play("menu_select");
    if (last) { finish(); return; }
    // let the current slide glide out before the next one glides in
    setLeaving(true);
    setTimeout(() => { setSlide((s) => s + 1); setLeaving(false); }, 260);
  };

  // EL PASO DE DIAPOSITIVA NO ES UN SLOT. La animación de entrada y salida vive
  // en el `key={slide}` del envoltorio, que es lo que hace que React remonte el
  // bloque; sacarlo al registro sería describir la transición como si fuera
  // contenido. Lo que sí es contenido es el TEXTO, la línea de apoyo del final
  // y los puntos.
  const SLOTS = {
    text: () => <p className="intro-text">{t(`intro.${slide + 1}`)}</p>,
    support: () => <p className="intro-support">{t("intro.support")}</p>,
    dots: () => (
      <div className="intro-dots">
        {Array.from({ length: SLIDES }, (_, i) => (
          <span key={i} className={"dot" + (i === slide ? " on" : "")}></span>
        ))}
      </div>
    ),
    // No skip: the lore is three short beats and it's the only place the game
    // explains itself — blowing through it left players lost.
    next: () => (
      <button className="btn gold" onClick={next}>{last ? t("intro.go") : t("intro.next")}</button>
    ),
  };
  const ctx = { isLastSlide: last };
  const slot = (region) => <Slots screen={UI_SCREEN.INTRO} region={region} ctx={ctx} slots={SLOTS} />;

  // Slides advance ONLY via the buttons — no tap-anywhere (accidental taps were
  // blowing through the story).
  return (
    <div className="page-card intro-page">
      <div className="page-head" style={{ justifyContent: "center" }}>
        <span className="title-pill"><span className="dot"></span>{t("title.pill")}</span>
      </div>
      <div className="page-body">
        <div className={"intro-slide" + (leaving ? " leave" : "")} key={slide}>
          {slot("slide")}
        </div>
        {slot("main")}
        <div className="btn-row" style={{ marginTop: 6 }}>{slot("actions")}</div>
      </div>
    </div>
  );
}
