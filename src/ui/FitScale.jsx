import React, { useRef, useLayoutEffect } from "react";

// Scale-to-fit wrapper for menu cards: measures the child at natural size and
// transform:scale()s it down so the WHOLE card always fits the viewport —
// game-menu feel, no scrolling. Below MIN_SCALE the shell's overflow scroll
// remains as a last resort (extreme aspect ratios).
const MIN_SCALE = 0.55;
const PAD = 24; // breathing room around the card (px, both axes)

export default function FitScale({ children }) {
  const outerRef = useRef(null), innerRef = useRef(null);

  useLayoutEffect(() => {
    const outer = outerRef.current, inner = innerRef.current;
    if (!outer || !inner) return;
    const apply = () => {
      // measure at natural size (scale 1) to avoid feedback loops
      inner.style.transform = "none";
      const w = inner.offsetWidth, h = inner.offsetHeight;
      const vw = window.innerWidth - PAD, vh = window.innerHeight - PAD;
      const s = Math.max(MIN_SCALE, Math.min(1, vw / (w || 1), vh / (h || 1)));
      inner.style.transform = s < 1 ? `scale(${s})` : "none";
      // shrink the layout box so flex centering uses the SCALED size
      outer.style.width = `${(w || 0) * s}px`;
      outer.style.height = `${(h || 0) * s}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(inner);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return (
    <div ref={outerRef} className="fit-outer">
      <div ref={innerRef} className="fit-inner">{children}</div>
    </div>
  );
}
