import React from "react";

// Minimal inline-SVG icon set — replaces color emoji, which render
// inconsistently (or not at all) across browsers/OS/WebViews. Everything is
// stroke/fill currentColor so it inherits the button's text color, except a
// few glyphs with a fixed brand color (medals, flame, bolt).
const P = {
  cart:    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h3l2.5 11h9.5l2.5-8H7" /><circle cx="10" cy="19" r="1.6" fill="currentColor" /><circle cx="17" cy="19" r="1.6" fill="currentColor" /></g>,
  heart:   <path d="M12 20s-7-4.6-9.2-9C1.2 7.7 3 4.5 6.2 4.5c2 0 3.3 1.1 4 2.3.4.7 1.2.7 1.6 0 .7-1.2 2-2.3 4-2.3 3.2 0 5 3.2 3.4 6.5C17 15.4 12 20 12 20z" fill="currentColor" />,
  gear:    <g fill="none" stroke="currentColor"><circle cx="12" cy="12" r="5.6" strokeWidth="2.2" /><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" /><path d="M12 3.2v3M12 17.8v3M3.2 12h3M17.8 12h3M5.8 5.8l2.1 2.1M16.1 16.1l2.1 2.1M18.2 5.8l-2.1 2.1M7.9 16.1l-2.1 2.1" strokeWidth="2.6" strokeLinecap="round" /></g>,
  sound:   <g fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></g>,
  mute:    <g fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></g>,
  pin:     <g fill="currentColor"><path d="M12 2a6.5 6.5 0 0 0-6.5 6.5C5.5 13 12 21 12 21s6.5-8 6.5-12.5A6.5 6.5 0 0 0 12 2z" /><circle cx="12" cy="8.5" r="2.6" fill="#fff" /></g>,
  pause:   <g fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></g>,
  hand:    <path d="M8.6 21c-1.8 0-2.7-.9-3.7-2.7l-2-3.7c-.5-.9-.2-1.8.6-2.2.7-.4 1.5-.1 2.1.6l1.2 1.5V5.6c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v4.6-6.4c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v6.4-5.4c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v5.6-3.9c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4V16c0 3.2-2.2 5-5.4 5H8.6z" fill="currentColor" />,
  lock:    <g fill="currentColor"><rect x="5.5" y="10" width="13" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="currentColor" strokeWidth="2" /></g>,
  cap:     <g fill="currentColor"><path d="M12 4L1.5 9 12 14 22.5 9 12 4z" /><path d="M5.5 11.8v3.7c0 1.4 2.9 2.9 6.5 2.9s6.5-1.5 6.5-2.9v-3.7L12 15 5.5 11.8z" /><path d="M21.5 10v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></g>,
  ad:      <g><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M10 9l5 3-5 3V9z" fill="currentColor" /></g>,
  coffee:  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9zM16 10h2.2a2.3 2.3 0 0 1 0 4.6H16M7.5 5.5c0-1 .8-1 .8-2M11 5.5c0-1 .8-1 .8-2" /></g>,
  medal3:  <g><circle cx="12" cy="14" r="6" fill="#c07a44" /><path d="M8 3h3l1.5 5L14 3h3l-3.5 8h-3L8 3z" fill="#8f5a30" /></g>,
  medal2:  <g><circle cx="12" cy="14" r="6" fill="#b9bec9" /><path d="M8 3h3l1.5 5L14 3h3l-3.5 8h-3L8 3z" fill="#8b909b" /></g>,
  medal1:  <g><circle cx="12" cy="14" r="6" fill="#e8b53a" /><path d="M8 3h3l1.5 5L14 3h3l-3.5 8h-3L8 3z" fill="#b3841e" /></g>,
  crown:   <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.6 10H4.6L3 8z" fill="#e8b53a" stroke="#b3841e" strokeWidth="1.2" />,
  sun:     <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></g>,
  sunset:  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 15a7 7 0 0 1 14 0" /><path d="M2.5 18.5h19M12 3.5V7M6 6l2 2M18 6l-2 2" /></g>,
  storm:   <g><path d="M7 15a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17 5.6 4 4 0 0 1 17.5 14H7z" fill="currentColor" /><path d="M12 14l-2.5 4.5H12L10.5 22l4.5-5.5h-2.5L14 14h-2z" fill="#ffe06b" /></g>,
  moon:    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" fill="currentColor" />,
  target:  <g fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" /></g>,
  clock:   <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></g>,
  snow:    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M12 3l-2 2.5M12 3l2 2.5M12 21l-2-2.5M12 21l2-2.5" fill="none" /></g>,
  flame:   <path d="M12 22c-4 0-6.5-2.6-6.5-6.2 0-2.6 1.6-4.4 2.9-6C9.6 8.4 10.5 7 10.5 5c0-1 .8-1.6 1.6-1 2.6 1.8 6.4 5.9 6.4 11.8 0 3.6-2.5 6.2-6.5 6.2z" fill="#ff7a3d" />,
  cube:    <g><rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M4.8 9.5L12 13l7.2-3.5M12 13v6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.7" /></g>,
  rocket:  <g><path d="M13 3c4 .8 7 4.4 7.5 8.5L16 16l-4.5-4.5L13 3z" fill="currentColor" /><path d="M11 12.5L5 15l1.5-4L11 12.5zM12.5 14l-2.5 6 4-1.5L12.5 14z" fill="currentColor" opacity="0.7" /><circle cx="14.6" cy="8.6" r="1.5" fill="#fff" /></g>,
  phone:   <g fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 18.5h3" strokeLinecap="round" /></g>,
  bolt:    <path d="M13.5 2L5 13.5h5L9.5 22 19 10h-5.5L13.5 2z" fill="#ffe06b" stroke="#b3841e" strokeWidth="1" />,
  car:     <g fill="currentColor"><path d="M4 13l1.6-4.2A2.5 2.5 0 0 1 8 7h8a2.5 2.5 0 0 1 2.4 1.8L20 13v5h-2.5v-1.5h-11V18H4v-5z" /><circle cx="8" cy="17.8" r="1.7" /><circle cx="16" cy="17.8" r="1.7" /></g>,
};

export default function Icon({ name, size = 18, style }) {
  const glyph = P[name];
  if (!glyph) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-3px", ...style }}>
      {glyph}
    </svg>
  );
}
