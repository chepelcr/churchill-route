// Fullscreen + landscape lock for touch devices, called from user-gesture
// handlers (mode buttons). Every failure is swallowed: iPhone Safari has no
// element-fullscreen API (the installed PWA covers that via the manifest's
// display:standalone — iOS rejects "fullscreen"; Android gets fullscreen via
// display_override — and the game's rotate prompt handles portrait).
// iPhone Safari (browser tab, not installed PWA / native shell) can never go
// fullscreen — the only path is Add to Home Screen. The Title screen shows a
// one-time hint for it.
const IOS_HINT_KEY = "churchill_ios_hint_v1";
export function needsIosFullscreenHint() {
  if (typeof window === "undefined" || window.Capacitor) return false;
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  const standalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: fullscreen)").matches
    || window.matchMedia("(display-mode: standalone)").matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem(IOS_HINT_KEY) === "1"; } catch { /* private */ }
  return isIos && !standalone && !dismissed;
}
export function dismissIosFullscreenHint() {
  try { localStorage.setItem(IOS_HINT_KEY, "1"); } catch { /* private */ }
}

export function needsRotation() {
  if (window.Capacitor || !window.matchMedia("(pointer: coarse)").matches) return false;
  const { innerWidth, innerHeight, visualViewport } = window;
  // In-app browsers may update the visible area while the orientation media
  // query still reports portrait. Ignore the dimensions of a zoomed-in view.
  return innerWidth <= innerHeight
    && !(visualViewport?.scale === 1 && visualViewport.width > visualViewport.height);
}

export function enterImmersive() {
  if (typeof window === "undefined") return;
  if (window.Capacitor) return; // native shell is already fullscreen+landscape
  if (!window.matchMedia("(pointer: coarse)").matches) return; // not on desktop
  if (needsRotation()) return; // keep portrait play available when chosen
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  Promise.resolve()
    .then(() => (req ? req.call(el) : null))
    .catch(() => {})
    .then(() => (screen.orientation && screen.orientation.lock
      ? screen.orientation.lock("landscape") : null))
    .catch(() => {});
}
