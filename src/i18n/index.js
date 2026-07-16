// i18n — es/en string table + a tiny subscribable language store.
// `t("key", {vars})` everywhere a player-facing string is produced (React UI,
// game storyTips/floats, canvas barrier signs). React components re-render on
// language change via useT() (useSyncExternalStore). Customer flavor "line"
// quotes intentionally stay in Spanish — they're the port's voice — but every
// instructional string is translated.
import { useSyncExternalStore } from "react";

const LANG_KEY = "churchill_lang_v1";

const STR = {
  es: {
    // --- title ---
    "title.pill": "PUNTARENAS · COSTA RICA · ARCADE 2026",
    "title.sub": "¡PURA VIDA!",
    "title.how.title": "CÓMO SE JUEGA",
    "title.how.body": "Sos repartidor de Churchills en El Puerto. Recogé en el kiosco rojo y blanco del Paseo de los Turistas y llegá al cliente antes que el hielo se derrita. Hacé drift, esquivá gaviotas y recorré del Faro a Las Playitas.",
    "title.apk": "Descargar para Android",
    "mode.story": "Historia",
    "mode.story.tag": "7 niveles, de El Faro hasta el puerto de Caldera.",
    "mode.explore": "Recorrer",
    "mode.explore.tag": "Mundo abierto. Completá niveles para abrir nuevos distritos.",
    "mode.arcade": "Arcade",
    "mode.arcade.tag": "3 minutos, península libre, combo a tope.",
    "mode.tutorial": "Tutorial",
    "mode.tutorial.tag": "Aprendé a manejar y a entregar en 2 minutos.",
    "title.hint.touch": "Joystick con un dedo: empujá más = más rápido, hasta el borde = turbo · ✋ drift",
    "title.hint.drive": "manejar",
    "title.hint.drift": "drift",
    "title.hint.turbo": "turbo",
    "title.hint.pause": "pausa",
    "title.hint.pad": "controller / touch OK",
    // --- HUD ---
    "hud.score": "Puntos",
    "hud.combo": "Combo",
    "hud.mode": "Modo",
    "hud.explore": "RECORRER",
    "hud.tutorial": "TUTORIAL",
    "hud.time": "Tiempo",
    "hud.level": "Nivel {n}",
    "hud.deliveries": "Entregas",
    "hud.enter": "ENTRÁS A",
    "hud.ice": "% hielo",
    "quip.cold": "Helado todavía — pura vida.",
    "quip.warm": "Empieza a sudar la copa…",
    "quip.hot": "¡La leche se está aguando!",
    "quip.melt": "¡Acelerá! ¡Se derrite!",
    // --- pause ---
    "pause.title": "PAUSA",
    "pause.body": "Tomate un respiro. El puerto no se va a ningún lado.",
    "pause.resume": "▸ Continuar",
    "pause.settings": "Ajustes",
    "pause.quit": "Salir al menú",
    // --- results ---
    "results.title": "RESULTADOS",
    "results.win": "¡NIVEL {n} COMPLETADO!",
    "results.lose": "SE ACABÓ EL TIEMPO",
    "results.tutorial": "¡TUTORIAL COMPLETADO!",
    "results.score": "Puntaje",
    "results.deliveries": "Entregas",
    "results.perfect": "Perfectas",
    "results.maxCombo": "Combo máximo",
    "results.rank": "Ranking",
    "results.next": "▸ Siguiente nivel",
    "results.again": "↻ Repetir",
    "results.menu": "Menú",
    "results.continueAd": "▶ Seguir +60s (ver anuncio)",
    "rank.s": "S — LEYENDA PORTEÑA",
    "rank.a": "A — Maestro Churchillero",
    "rank.b": "B — Repartidor del Paseo",
    "rank.c": "C — Aprendiz del kiosco",
    "rank.d": "D — Se te derritió todo",
    // --- stage select / brief ---
    "select.pill": "MODO HISTORIA · ELEGÍ NIVEL",
    "select.level": "Nivel {n}",
    "select.of": "Nivel {n} / {total}",
    "select.done": "✓ COMPLETADO",
    "select.locked": "⛔ BLOQUEADO",
    "select.soon": "🔜 PRÓXIMAMENTE",
    "select.lockedBrief": "Completá el nivel {n} para desbloquear este.",
    "select.soonBrief": "Este nivel llega en una próxima actualización.",
    "select.deliveries": "entregas",
    "select.time": "tiempo",
    "select.play": "▸ Jugar",
    "select.playLocked": "Bloqueado",
    "select.playSoon": "Próximamente",
    "select.vehicle": "TU VEHÍCULO",
    "select.resetQ": "¿Borrar progreso?",
    "select.yes": "Sí",
    "select.no": "No",
    "select.reset": "↺ Resetear progreso",
    "select.back": "← Menú",
    "brief.level": "NIVEL {n}",
    "brief.go": "▸ ¡Vamos!",
    "weather.sunny": "Soleado",
    "weather.sunset": "Atardecer",
    "weather.storm": "Tormenta",
    "weather.night": "Noche",
    // --- settings ---
    "settings.title": "AJUSTES",
    "settings.language": "Idioma",
    "settings.volume": "Volumen",
    "settings.muted": "Silenciado",
    "settings.removeAds": "Quitar anuncios",
    "settings.removeAds.desc": "Pago único. Sin anuncios para siempre.",
    "settings.removeAds.owned": "✓ Anuncios eliminados — ¡gracias!",
    "settings.removeAds.web": "Disponible en la app de Android.",
    "settings.removeAds.play": "Se activa cuando la app esté instalada desde Google Play.",
    "settings.buy": "Comprar",
    "settings.restore": "Restaurar compras",
    "settings.tutorial": "Volver a jugar el tutorial",
    "settings.reset": "Borrar progreso",
    "settings.resetQ": "¿Seguro? Se pierden niveles y récords.",
    "settings.back": "← Volver",
    "settings.credits": "Hecho en Costa Rica · {version}",
    // --- game tips (storyTips / floats) ---
    "tip.arcade": "Tres minutos y todo el puerto. Si no dejás de entregar, el combo no se cae.",
    "tip.explore": "Tenés {n} zonas abiertas para recorrer. Completá niveles de Historia para abrir el resto.",
    "tip.deliverTo": "Llevale a {name}.",
    "tip.delivered": "¡Pura vida! Volvé al kiosco.",
    "tip.melted": "Volvé al kiosco por otro Churchill.",
    "tip.lockedDistrict": "{district} sigue cerrado — completá el Nivel {n} para pasar.",
    "tip.mvpWall": "Hasta aquí llega el MVP — El Cocal y el resto del puerto llegan en una próxima actualización.",
    "float.pickup": "+ CHURCHILL",
    "float.melted": "¡SE DERRITIÓ!",
    "float.perfect": "¡PERFECTO!",
    "float.unlocked": "¡{district} DESBLOQUEADO!",
    // --- canvas signs ---
    "sign.blocked": "⛔ BLOQUEADO",
    "sign.level": "NIVEL {n}",
    "sign.soon": "PRÓXIMAMENTE",
    // --- tutorial ---
    "tut.title": "TUTORIAL",
    "tut.step": "Paso {n}/{total}",
    "tut.steer.touch": "Poné un dedo en la mitad izquierda y movelo: el carro gira hacia donde apunta el joystick. Da una vuelta.",
    "tut.steer.keys": "Manejá con WASD o las flechas. Da una vuelta.",
    "tut.speed.touch": "El dedo es el acelerador: empujá el joystick poquito para ir despacio y hasta el borde para ir a fondo.",
    "tut.speed.keys": "Mantené W para acelerar a fondo.",
    "tut.turbo.touch": "¡TURBO! Empujá el dedo MÁS ALLÁ del borde del joystick (se pone naranja) y mantenelo.",
    "tut.turbo.keys": "¡TURBO! Mantené X mientras acelerás.",
    "tut.brake.touch": "Con velocidad, tocá ✋ con el otro dedo para frenar y derrapar en las curvas.",
    "tut.brake.keys": "Con velocidad, mantené ESPACIO para frenar y derrapar en las curvas.",
    "tut.pickup": "Andá al kiosco rojo y blanco (seguí la flecha 🧭) y frená al lado para recoger un Churchill.",
    "tut.deliver": "¡Rápido! Llevalo al cliente que saluda antes de que se derrita. La barra de abajo es el hielo.",
    "tut.done": "¡Eso es todo! Puntos por entregar rápido, combo por no fallar. ¡A recorrer el puerto!",
    // --- supporters / greetings ---
    "sup.title": "AGRADECIMIENTOS",
    "sup.body": "Estas personas y negocios hacen posible La Ruta del Churchill.",
    "sup.empty": "Sé la primera persona en apoyar el proyecto.",
    "sup.kofi": "☕ Apoyá el proyecto",
    "sup.tier1": "Aprendiz Churchillero",
    "sup.tier2": "Habitante del Puerto",
    "sup.tier3": "Inversor de la Península",
    "sup.tier4": "Leyenda Porteña",
    "settings.supporters": "Agradecimientos",
    // --- misc ---
    "rotate.body": "Girá el teléfono — se juega en horizontal",
    "meters": "{n} m",
  },
  en: {
    "title.pill": "PUNTARENAS · COSTA RICA · ARCADE 2026",
    "title.sub": "PURA VIDA!",
    "title.how.title": "HOW TO PLAY",
    "title.how.body": "You deliver Churchills around the port. Pick up at the red-and-white kiosk on the Paseo de los Turistas and reach the customer before the ice melts. Drift, dodge seagulls and ride from the lighthouse to Las Playitas.",
    "title.apk": "Download for Android",
    "mode.story": "Story",
    "mode.story.tag": "7 levels, from El Faro to the port of Caldera.",
    "mode.explore": "Free Roam",
    "mode.explore.tag": "Open world. Clear story levels to unlock new districts.",
    "mode.arcade": "Arcade",
    "mode.arcade.tag": "3 minutes, the whole peninsula, max combo.",
    "mode.tutorial": "Tutorial",
    "mode.tutorial.tag": "Learn to drive and deliver in 2 minutes.",
    "title.hint.touch": "One-finger joystick: push further = faster, past the rim = turbo · ✋ drift",
    "title.hint.drive": "drive",
    "title.hint.drift": "drift",
    "title.hint.turbo": "turbo",
    "title.hint.pause": "pause",
    "title.hint.pad": "controller / touch OK",
    "hud.score": "Score",
    "hud.combo": "Combo",
    "hud.mode": "Mode",
    "hud.explore": "FREE ROAM",
    "hud.tutorial": "TUTORIAL",
    "hud.time": "Time",
    "hud.level": "Level {n}",
    "hud.deliveries": "Deliveries",
    "hud.enter": "ENTERING",
    "hud.ice": "% ice",
    "quip.cold": "Still frozen — pura vida.",
    "quip.warm": "The cup is starting to sweat…",
    "quip.hot": "The milk is going watery!",
    "quip.melt": "Floor it! It's melting!",
    "pause.title": "PAUSED",
    "pause.body": "Take a breath. The port isn't going anywhere.",
    "pause.resume": "▸ Resume",
    "pause.settings": "Settings",
    "pause.quit": "Quit to menu",
    "results.title": "RESULTS",
    "results.win": "LEVEL {n} COMPLETE!",
    "results.lose": "TIME'S UP",
    "results.tutorial": "TUTORIAL COMPLETE!",
    "results.score": "Score",
    "results.deliveries": "Deliveries",
    "results.perfect": "Perfect",
    "results.maxCombo": "Max combo",
    "results.rank": "Rank",
    "results.next": "▸ Next level",
    "results.again": "↻ Retry",
    "results.menu": "Menu",
    "results.continueAd": "▶ Continue +60s (watch ad)",
    "rank.s": "S — PORT LEGEND",
    "rank.a": "A — Churchill Master",
    "rank.b": "B — Paseo Courier",
    "rank.c": "C — Kiosk Apprentice",
    "rank.d": "D — It all melted",
    "select.pill": "STORY MODE · PICK A LEVEL",
    "select.level": "Level {n}",
    "select.of": "Level {n} / {total}",
    "select.done": "✓ COMPLETE",
    "select.locked": "⛔ LOCKED",
    "select.soon": "🔜 COMING SOON",
    "select.lockedBrief": "Clear level {n} to unlock this one.",
    "select.soonBrief": "This level arrives in a future update.",
    "select.deliveries": "deliveries",
    "select.time": "time",
    "select.play": "▸ Play",
    "select.playLocked": "Locked",
    "select.playSoon": "Coming soon",
    "select.vehicle": "YOUR RIDE",
    "select.resetQ": "Erase progress?",
    "select.yes": "Yes",
    "select.no": "No",
    "select.reset": "↺ Reset progress",
    "select.back": "← Menu",
    "brief.level": "LEVEL {n}",
    "brief.go": "▸ Let's go!",
    "weather.sunny": "Sunny",
    "weather.sunset": "Sunset",
    "weather.storm": "Storm",
    "weather.night": "Night",
    "settings.title": "SETTINGS",
    "settings.language": "Language",
    "settings.volume": "Volume",
    "settings.muted": "Muted",
    "settings.removeAds": "Remove ads",
    "settings.removeAds.desc": "One-time purchase. No ads, forever.",
    "settings.removeAds.owned": "✓ Ads removed — thank you!",
    "settings.removeAds.web": "Available in the Android app.",
    "settings.removeAds.play": "Activates once the app is installed from Google Play.",
    "settings.buy": "Buy",
    "settings.restore": "Restore purchases",
    "settings.tutorial": "Replay the tutorial",
    "settings.reset": "Erase progress",
    "settings.resetQ": "Sure? Levels and records will be lost.",
    "settings.back": "← Back",
    "settings.credits": "Made in Costa Rica · {version}",
    "tip.arcade": "Three minutes and the whole port. Keep delivering and the combo never drops.",
    "tip.explore": "You have {n} zones open to roam. Clear story levels to open the rest.",
    "tip.deliverTo": "Take it to {name}.",
    "tip.delivered": "Pura vida! Back to the kiosk.",
    "tip.melted": "Back to the kiosk for another Churchill.",
    "tip.lockedDistrict": "{district} is still closed — clear Level {n} to pass.",
    "tip.mvpWall": "The MVP ends here — El Cocal and the rest of the port arrive in a future update.",
    "float.pickup": "+ CHURCHILL",
    "float.melted": "IT MELTED!",
    "float.perfect": "PERFECT!",
    "float.unlocked": "{district} UNLOCKED!",
    "sign.blocked": "⛔ CLOSED",
    "sign.level": "LEVEL {n}",
    "sign.soon": "COMING SOON",
    "tut.title": "TUTORIAL",
    "tut.step": "Step {n}/{total}",
    "tut.steer.touch": "Put a finger on the left half and move it: the car turns toward the joystick. Take a lap.",
    "tut.steer.keys": "Drive with WASD or the arrow keys. Take a lap.",
    "tut.speed.touch": "Your finger is the throttle: a small push cruises, pushing to the rim goes full speed.",
    "tut.speed.keys": "Hold W to go full speed.",
    "tut.turbo.touch": "TURBO! Push your finger PAST the joystick rim (it glows orange) and hold it.",
    "tut.turbo.keys": "TURBO! Hold X while accelerating.",
    "tut.brake.touch": "At speed, press ✋ with your other finger to brake and drift through corners.",
    "tut.brake.keys": "At speed, hold SPACE to brake and drift through corners.",
    "tut.pickup": "Head to the red-and-white kiosk (follow the 🧭 arrow) and stop next to it to pick up a Churchill.",
    "tut.deliver": "Hurry! Take it to the waving customer before it melts. The bar below is your ice.",
    "tut.done": "That's it! Points for fast deliveries, combo for not failing. Go explore the port!",
    "sup.title": "SUPPORTERS",
    "sup.body": "These people and businesses make La Ruta del Churchill possible.",
    "sup.empty": "Be the first to support the project.",
    "sup.kofi": "☕ Support the project",
    "sup.tier1": "Aprendiz Churchillero",
    "sup.tier2": "Habitante del Puerto",
    "sup.tier3": "Inversor de la Península",
    "sup.tier4": "Leyenda Porteña",
    "settings.supporters": "Supporters",
    "rotate.body": "Rotate your phone — the game is landscape",
    "meters": "{n} m",
  },
};

// Stage names/briefs live in the generated world data (Spanish). English
// overlay keyed by stage id; Spanish falls through to the manifest strings.
const STAGE_EN = {
  s1: { name: "The Lighthouse", brief: "Deliver the first order of the day. Cruise ships are in — the gringos want to try the famous Churchill." },
  s2: { name: "Paseo de los Turistas", brief: "The boardwalk is packed. Cross the promenade dodging tourists and carnival troupes." },
  s3: { name: "Market & Cathedral", brief: "Downtown streets are narrow and traffic is unforgiving. Watch the cats — and Father Ramírez doesn't like waiting." },
  s4: { name: "Sunset at Las Playitas", brief: "The sun sets over the Yacht Club. Open the throttle on Route 17 — but careful, the football team is out training." },
  s5: { name: "Storm at El Cocal", brief: "The downpour hit and the asphalt is slick. Reach Route 17 before the storm gets worse." },
  s6: { name: "Bridge · Mata de Limón", brief: "Cross the suspension bridge over the estuary. Reach the Mata de Limón kiosk and the Leda seafood house." },
  s7: { name: "Caldera · Finale", brief: "Down Route 27 to the Port of Caldera. The sun is coming up — one last delivery and the shift is done." },
};

// ---- store -----------------------------------------------------------------
function defaultLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch { /* private mode */ }
  const nav = (typeof navigator !== "undefined" && (navigator.language || "")) || "es";
  return nav.toLowerCase().startsWith("es") ? "es" : "en";
}

let lang = typeof window !== "undefined" ? defaultLang() : "es";
const listeners = new Set();

export function getLang() { return lang; }
export function setLang(l) {
  if (l !== "es" && l !== "en") return;
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  for (const fn of listeners) fn();
}

export function t(key, vars) {
  let s = STR[lang][key] ?? STR.es[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

export function stageName(stage) {
  return (lang === "en" && STAGE_EN[stage.id]?.name) || stage.name;
}
export function stageBrief(stage) {
  return (lang === "en" && STAGE_EN[stage.id]?.brief) || stage.brief;
}

// React: re-render on language change. Returns t (stable semantics — reads
// the current language at call time).
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function useT() {
  useSyncExternalStore(subscribe, getLang, () => "es");
  return t;
}
