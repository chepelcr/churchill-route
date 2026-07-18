import React, { useState } from "react";
import { useT } from "../../i18n/index.js";
import { sfx } from "../../game/audio.js";

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

  return (
    <div className="page-card intro-page" onClick={next}>
      <div className="page-head" style={{ justifyContent: "center" }}>
        <span className="title-pill"><span className="dot"></span>{t("title.pill")}</span>
      </div>
      <div className="page-body">
        <div className={"intro-slide" + (leaving ? " leave" : "")} key={slide}>
          <p className="intro-text">{t(`intro.${slide + 1}`)}</p>
          {last && <p className="intro-support">{t("intro.support")}</p>}
        </div>
        <div className="intro-dots">
          {Array.from({ length: SLIDES }, (_, i) => (
            <span key={i} className={"dot" + (i === slide ? " on" : "")}></span>
          ))}
        </div>
        <div className="btn-row" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
          {!last && <button className="btn secondary" onClick={finish}>{t("intro.skip")}</button>}
          <button className="btn gold" onClick={next}>{last ? t("intro.go") : t("intro.next")}</button>
        </div>
      </div>
    </div>
  );
}
