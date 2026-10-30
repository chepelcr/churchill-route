import React, { useRef, useLayoutEffect } from "react";

// Scale-to-fit wrapper for menu cards: measures the child at natural size and
// transform:scale()s it down so the WHOLE card always fits the viewport —
// game-menu feel, no scrolling. Below MIN_SCALE the shell's overflow scroll
// remains as a last resort (extreme aspect ratios).
const MIN_SCALE = 0.55;
const PAD = 24; // breathing room around the card (px, both axes)

// `pad` reserves extra vertical room (e.g. a fixed nav bar above the card).
export default function FitScale({ children, pad = PAD }) {
  const outerRef = useRef(null), innerRef = useRef(null);

  useLayoutEffect(() => {
    const outer = outerRef.current, inner = innerRef.current;
    if (!outer || !inner) return;
    const apply = () => {
      // measure at natural size (scale 1) to avoid feedback loops
      inner.style.transform = "none";
      const w = inner.offsetWidth, h = inner.offsetHeight;
      const vw = window.innerWidth - PAD, vh = window.innerHeight - pad;
      const s = Math.max(MIN_SCALE, Math.min(1, vw / (w || 1), vh / (h || 1)));
      inner.style.transform = s < 1 ? `scale(${s})` : "none";
      // shrink the layout box so flex centering uses the SCALED size
      outer.style.width = `${(w || 0) * s}px`;
      outer.style.height = `${(h || 0) * s}px`;
    };
    apply();
    // Re-measure after the things that change layout AFTER first paint —
    // web-font swap, the iOS standalone chrome settling, a restored bfcache
    // page — otherwise a stale first measure leaves the card mis-scaled
    // (distorted / arrows off-screen) when installed to the home screen.
    const raf = requestAnimationFrame(apply);
    const timers = [setTimeout(apply, 120), setTimeout(apply, 400)];
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply).catch(() => {});
    const ro = new ResizeObserver(apply);
    ro.observe(inner);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("pageshow", apply);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      ro.disconnect();
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("pageshow", apply);
    };
  }, []);

  return (
    <div ref={outerRef} className="fit-outer">
      <div ref={innerRef} className="fit-inner">{children}</div>
    </div>
  );
}
