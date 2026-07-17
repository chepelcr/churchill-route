import React from "react";

// Churchill moneda — a gold coin with the churchill glass stamped on it.
// Inline SVG so it scales crisp anywhere (HUD pill, shop, results).
export default function CoinIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-3px" }}>
      <circle cx="12" cy="12" r="11" fill="#e8b53a" stroke="#a87b18" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="#a87b18" strokeWidth="0.9" opacity="0.7" />
      {/* churchill glass: cup + syrup + straw */}
      <path d="M8.2 8.5 L15.8 8.5 L14.6 17.5 L9.4 17.5 Z" fill="#fff8ea" stroke="#a87b18" strokeWidth="0.8" />
      <path d="M8.45 10.2 L15.55 10.2 L15.1 13 L8.9 13 Z" fill="#d63a30" opacity="0.9" />
      <rect x="13.4" y="4.6" width="1.5" height="5" rx="0.7" transform="rotate(14 14.2 7)" fill="#a87b18" />
    </svg>
  );
}
