import React from "react";
import { useMenuNav } from "../useMenuNav.js";
import { sfx } from "../../game/audio.js";
import { useT } from "../../i18n/index.js";
import Icon from "../Icon.jsx";
import Slots from "../Slots.jsx";
import { EXPLORE_REALM, UI_SCREEN } from "../../domain/vocabulary.generated.js";

// ¿POR DÓNDE ARRANCA RECORRER? — la ciudad en carro, o el estero en lancha.
//
// Esta pantalla existe por una razón concreta y no por simetría: el realm
// decide el MEDIO, y el selector de vehículos tiene que abrir ya sabiendo si
// ofrece carros o cascos. Preguntarlo después sería el mismo error que el
// juego arrastraba, donde una etapa de travesía vieja dejaba a Arcade
// ofreciendo lanchas.
//
// Antes se llegaba al estero parqueando en el muelle a mitad de partida, lo que
// arrancaba la Travesía entera —boyas, portones y director de carrera— dentro
// de un modo sin reloj. Escogerlo aquí es lo que permitió borrar aquel
// trasbordo.
const REALMS = [
  { id: EXPLORE_REALM.CIUDAD, icon: "pin",  swatch: "var(--mint)" },
  { id: EXPLORE_REALM.ESTERO, icon: "boat", swatch: "var(--sky)" },
];

export default function RealmPick({ onPick, onBack }) {
  const t = useT();
  const pick = (id) => { sfx.play("menu_select"); onPick(id); };
  const [idx, setIdx] = useMenuNav({
    count: REALMS.length,
    cols: REALMS.length,
    onSelect: (i) => pick(REALMS[i].id),
    onBack,
  });

  // Los bloques que esta pantalla PUEDE mostrar; `src/ui/screens.json` decide
  // cuáles salen y en qué orden.
  const SLOTS = {
    heading: () => <>
      <h2 className="title-main">{t("realm.title")}</h2>
      <div className="title-sub">{t("realm.sub")}</div>
    </>,
    realms: () => (
      <div className="modes" style={{ gridTemplateColumns: `repeat(${REALMS.length}, 1fr)`, maxWidth: 640, margin: "16px auto" }}>
        {REALMS.map((r, i) => (
          <button key={r.id}
            className={"mode" + (idx === i ? " focused" : "")}
            onMouseEnter={() => setIdx(i)} onClick={() => pick(r.id)}>
            <div className="mt">
              <span className="sw" style={{ background: r.swatch }}></span>
              <Icon name={r.icon} size={14} /> {t(`realm.${r.id}`)}
            </div>
            <div className="ms">{t(`realm.${r.id}.tag`)}</div>
          </button>
        ))}
      </div>
    ),
    esteroNote: () => (
      <p style={{ opacity: 0.7, fontSize: 12, textAlign: "center" }}>{t("realm.estero.note")}</p>
    ),
  };
  const ctx = { always: true };
  const slot = (region) => <Slots screen={UI_SCREEN.REALMPICK} region={region} ctx={ctx} slots={SLOTS} />;

  return (
    <div className="page-card">
      <div className="page-head">
        <button className="btn secondary" onClick={onBack}>{t("select.back")}</button>
      </div>
      <div className="page-body">
        {slot("main")}
        {slot("footer")}
      </div>
    </div>
  );
}
