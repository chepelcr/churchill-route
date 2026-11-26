import React, { useState } from "react";
import { useT } from "../i18n/index.js";
import Icon from "./Icon.jsx";

function isFacebookOrInstagram(userAgent) {
  if (/\bInstagram\b/i.test(userAgent)) return true;
  const app = userAgent.match(/FB(?:AN|_IAB)\/([^;\s\]]+)/i)?.[1];
  return app ? /^(?:FB4A|FB4I|FBIOS|FBLITE|EMA)$/i.test(app) : /FBAV\//i.test(userAgent);
}

export default function RotatePrompt({ onContinue }) {
  const t = useT();
  const inAppBrowser = isFacebookOrInstagram(navigator.userAgent);
  const [copyState, setCopyState] = useState("");
  const url = window.location.href;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  return (
    <div className="rotate-overlay">
      <div className="rotate-icon" aria-hidden="true"><Icon name="phone" size={60} /></div>
      <p>{t("rotate.body")}</p>
      {inAppBrowser ? (
        <div className="rotate-browser-tip">
          <p>{t("rotate.external")}</p>
          {copyState === "manual" ? (
            <label className="rotate-copy-link">
              {t("rotate.copyManual")}
              <input type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            </label>
          ) : (
            <button type="button" className="btn gold" onClick={copyLink}>{t("rotate.copyLink")}</button>
          )}
          {copyState === "copied" && <p role="status">{t("rotate.copied")}</p>}
        </div>
      ) : (
        <button type="button" className="btn gold" onClick={onContinue}>{t("rotate.continue")}</button>
      )}
    </div>
  );
}
