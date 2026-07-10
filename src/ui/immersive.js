// Fullscreen + landscape lock for touch devices, called from user-gesture
// handlers (mode buttons). Every failure is swallowed: iPhone Safari has no
// element-fullscreen API (the installed PWA covers that via the manifest's
// display:fullscreen + orientation:landscape, and the CSS rotate overlay
// handles portrait in the browser tab).
export function enterImmersive() {
  if (typeof window === "undefined") return;
  if (!window.matchMedia("(pointer: coarse)").matches) return; // not on desktop
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  Promise.resolve()
    .then(() => (req ? req.call(el) : null))
    .catch(() => {})
    .then(() => (screen.orientation && screen.orientation.lock
      ? screen.orientation.lock("landscape") : null))
    .catch(() => {});
}
