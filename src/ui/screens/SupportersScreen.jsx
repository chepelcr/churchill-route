import React, { useState, useEffect } from "react";
import { useT } from "../../i18n/index.js";
import { content } from "../../content/remote.js";
import Icon from "../Icon.jsx";

const TIER_ICON = ["", "medal3", "medal2", "medal1", "crown"];

// Greetings page — thanks the ko-fi supporters and sponsor businesses, fed by
// the remote content (updates without an app release). Tiers 4→1.
export default function SupportersScreen({ onBack }) {
  const t = useT();
  const [, bump] = useState(0);
  useEffect(() => content.onChange(() => bump((n) => n + 1)), []);

  const byTier = [4, 3, 2, 1]
    .map((tier) => ({ tier, list: content.supporters.filter((s) => s.tier === tier) }))
    .filter((g) => g.list.length);
  const kofi = content.meta.kofi;

  return (
    <div className="page-card">
      <div className="page-head">
        <button className="btn secondary" onClick={onBack}>{t("settings.back")}</button>
        <h1 className="title-main page-title">{t("sup.title")}</h1>
        <span style={{ minWidth: 40 }}></span>
      </div>

      <div className="page-body scrolly">
        <div className="center-stack">
          <p style={{ opacity: 0.8, fontSize: 13, margin: "4px 0" }}>{t("sup.body")}</p>

          {byTier.length === 0 && <p className="sup-empty">{t("sup.empty")}</p>}

          <div className="sup-groups">
            {byTier.map(({ tier, list }) => (
              <div key={tier} className={`sup-group tier-${tier}`}>
                <div className="sup-tier"><Icon name={TIER_ICON[tier]} size={15} /> {t(`sup.tier${tier}`)}</div>
                <div className="sup-names">
                  {list.map((s, i) => (
                    <span key={i} className="sup-name" title={s.msg || ""}>{s.name}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {kofi && (
            <a className="btn gold" href={kofi} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-block", marginTop: 8, width: "auto" }}>
              <Icon name="coffee" size={15} /> {t("sup.kofi")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
