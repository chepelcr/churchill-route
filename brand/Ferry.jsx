import React from "react";

export default function Ferry({ className }) {
  return <svg className={className} width="54" height="26" viewBox="0 0 54 26" aria-hidden="true">
    <rect x="0" y="15" width="24" height="2" fill="var(--lrc-ferry-white)" opacity="0.4" />
    <rect x="20" y="8" width="32" height="8" rx="1.5" fill="var(--lrc-ferry-white)" />
    <rect x="20" y="13" width="32" height="3" fill="var(--lrc-hull)" />
    <rect x="33" y="2" width="6" height="8" rx="1" fill="var(--lrc-funnel)" />
  </svg>;
}
