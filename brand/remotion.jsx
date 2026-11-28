import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import identity from "./identity.json";
import tokens from "./tokens.json";
import "./brand.css";

export { default as Ferry } from "./Ferry.jsx";
export { Wash as BrandWash, waveLine } from "./ocean.jsx";

export function BrandTitle({ layout = "stack", plain = false, style }) {
  return <div className={`brand-title${plain ? " brand-title--plain" : ""}`} style={style}>
    {layout === "inline" ? identity.titleLines.join(" ") : identity.titleLines.map((line) =>
      <span key={line} className="brand-title__line">{line}</span>
    )}
  </div>;
}

export function BrandMark({ studio = false, size = 120, className, style, decorative = false }) {
  const mark = studio ? identity.marks.studio : identity.marks.churchill;
  return <Img className={className} src={staticFile(`brand/${mark.file}`)} alt={decorative ? "" : studio ? identity.studio : identity.name}
    style={{ display: "block", height: size, width: "auto", aspectRatio: `${mark.width} / ${mark.height}`,
      borderRadius: studio ? 0 : "18%", ...style }} />;
}

export function BrandSignature({ layout = "inline", style }) {
  const stacked = layout === "stack";
  return <div className={`brand-signature${stacked ? " brand-signature--stack" : ""}`} style={style}>
    <BrandMark size={stacked ? 132 : "1.8em"} decorative />
    {identity.titleLines.join(" ")}
  </div>;
}

export function BrandSubtitle({ children, className, style }) {
  return <div className={className} style={{
    color: "var(--lrc-text-muted)", fontFamily: "var(--lrc-font-body)", ...style,
  }}>{children}</div>;
}

export function BrandReveal({ children, delay = 0, className, distance = 36, duration = parseFloat(tokens.motion["video-enter"]), style }) {
  const frame = useCurrentFrame() - delay;
  const { fps } = useVideoConfig();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
  return <div className={className} style={{
    ...style,
    opacity: interpolate(frame, [-1, Math.max(1, Math.round(fps * duration * 0.7))], [0, 1], clamp),
    translate: `0 ${interpolate(frame, [0, Math.max(1, Math.round(fps * duration))], [distance, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px`,
  }}>{children}</div>;
}

export function BrandWaves({ opacity = 0.5 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phase = frame / fps * 2;
  return <svg aria-hidden="true" width="100%" height="23%" viewBox="0 0 1080 400"
    preserveAspectRatio="none" style={{ position: "absolute", bottom: 0, left: 0, opacity }}>
    {["harbor", "ocean", "sky"].map((paint, index) => {
      const height = 94 + index * 66;
      const rise = Math.sin(phase + index * 0.8) * 34;
      return <path key={paint} fill={`var(--lrc-${paint})`} fillOpacity={[0.98, 0.88, 0.22][index]}
        d={`M0 ${height + rise} C180 ${height - 80}, 360 ${height - 80}, 540 ${height - rise}
           S900 ${height + 80}, 1080 ${height + rise} V400 H0 Z`} />;
    })}
  </svg>;
}

export function BrandEndLink({ children, style }) {
  return <div style={{
    display: "inline-flex", alignItems: "center", gap: 28, padding: "18px 32px",
    color: "var(--lrc-on-action)", background: "var(--lrc-action)", borderRadius: 16,
    font: "700 55px/1.1 var(--lrc-font-body)", letterSpacing: -2, ...style,
  }}>{identity.website}{children}</div>;
}
