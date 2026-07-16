import React, { useState, useEffect } from "react";
import { useT } from "../../i18n/index.js";
import { content } from "../../content/remote.js";

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
    <div className="title-bg">
      <div className="title-shell">
        <div className="title-card settings-card">
          <button className="btn secondary back-btn" onClick={onBack}>{t("settings.back")}</button>
          <h1 className="title-main" style={{ fontSize: 32 }}>{t("sup.title")}</h1>
          <p style={{ opacity: 0.8, fontSize: 13 }}>{t("sup.body")}</p>

          {byTier.length === 0 && <p className="sup-empty">{t("sup.empty")}</p>}

          <div className="sup-groups">
            {byTier.map(({ tier, list }) => (
              <div key={tier} className={`sup-group tier-${tier}`}>
                <div className="sup-tier">{["", "🥉", "🥈", "🥇", "👑"][tier]} {t(`sup.tier${tier}`)}</div>
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
              style={{ display: "inline-block", marginTop: 14 }}>
              {t("sup.kofi")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
