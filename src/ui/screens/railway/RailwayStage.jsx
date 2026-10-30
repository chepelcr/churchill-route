// LA PARTIDA: UN CANVAS, DOS PEDALES Y UN HUD QUE NO RE-RENDERIZA.
//
// El HUD se escribe DIRECTO EN EL DOM desde el lazo de dibujo, igual que la
// interfaz de la ciudad lee `Game.state` en un tick de rAF: el estado de una
// partida es un objeto mutable y hacerlo pasar por React sesenta veces por
// segundo es trabajo inventado. React decide QUÉ pantalla hay; los números los
// pone el lazo.
//
// Dos cosas que el modo anterior no tenía y que esta pantalla sí:
//
//   * **DOS PEDALES, COMO EN HILL CLIMB.** Freno a la izquierda, acelerador a la
//     derecha, grandes y en las esquinas de abajo, más flechas en escritorio.
//     El modelo de "el dedo delante acelera" del MVP pedía apuntarle al tren
//     —que en un rizo está boca abajo— y era imposible de explicar.
//   * **LA AGUJA DEL COMBUSTIBLE ES EL RELOJ DE VERDAD.** Lo que mata un intento
//     no es el cronómetro, es quedarse seco: el consumo es potencia, así que ir
//     a todo gas cuesta y soltar en la bajada no cuesta nada.
import React, { useEffect, useRef } from "react";
import { useT } from "../../../i18n/index.js";
import { RAILWAY_ART } from "../../../game/railway/index.js";
import { RUN_PHASE } from "../../../game/railway/run.js";
import { createCamera, drawRailway, frameCamera, stepSmoke } from "../../../render/railway/view.js";

/** UN CUADRANTE REDONDO, en SVG.
 *
 *  Va en el DOM y no en el lienzo a propósito: el canvas ya tiene bastante que
 *  pintar por cuadro y una aguja es UNA transformación CSS que compone la GPU.
 *  Además escala con la tipografía del juego y se lee igual en un teléfono. El
 *  recorrido es de 240°, con el cero abajo a la izquierda. */
function Dial({ label, unit, needleRef, valueRef, warm }) {
  const ticks = Array.from({ length: 9 }, (_, i) => -120 + (i * 240) / 8);
  return (
    <div className={`railway-dial${warm ? " warm" : ""}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="dial-face" cx="50" cy="50" r="46" />
        <circle className="dial-rim" cx="50" cy="50" r="46" />
        {ticks.map((a, i) => (
          <line key={a} className={i >= 6 ? "dial-tick hot" : "dial-tick"}
            x1="50" y1="12" x2="50" y2={i % 2 ? "19" : "22"}
            transform={`rotate(${a} 50 50)`} />
        ))}
        <g ref={needleRef} className="dial-needle" style={{ transform: "rotate(-120deg)" }}>
          <line x1="50" y1="54" x2="50" y2="18" />
        </g>
        <circle className="dial-pin" cx="50" cy="50" r="6" />
      </svg>
      <span className="dial-read">{valueRef ? <b ref={valueRef}>0</b> : null}<i>{unit}</i></span>
      <span className="dial-label">{label}</span>
    </div>
  );
}

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function RailwayStage({ game, paused, onPause, onFinish }) {
  const t = useT();
  const canvas = useRef(null);
  const hud = useRef({});
  const input = useRef({ throttle: 0, brake: 0 });
  const live = useRef({ paused, onFinish });
  live.current = { paused, onFinish };

  useEffect(() => {
    const el = canvas.current;
    const g = el.getContext("2d");
    const { run } = game;
    const smoke = { puffs: [], acc: 0 };
    let raf = 0, last = performance.now(), clockT = 0, dpr = 1, w = 1, h = 1;
    let cam = null, reported = false;

    const resize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width; h = rect.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      if (!cam) cam = createCamera({ ...game, art: RAILWAY_ART }, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const set = (key, value) => {
      const node = hud.current[key];
      if (node && node.textContent !== value) node.textContent = value;
    };
    const needle = (key, fraction) => {
      const node = hud.current[key];
      if (!node) return;
      const k = Math.max(0, Math.min(1, fraction));
      node.style.transform = `rotate(${(-120 + k * 240).toFixed(1)}deg)`;
    };
    const bar = (key, fraction) => {
      const node = hud.current[key];
      if (node) node.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!cam) return;
      if (!live.current.paused) {
        clockT += dt;
        game.step(dt, input.current);
        stepSmoke(smoke, game, dt);
      }
      frameCamera(cam, { ...game, art: RAILWAY_ART }, w, h, live.current.paused ? 1e9 : dt);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      drawRailway(g, { ...game, art: RAILWAY_ART }, cam, w, h, clockT, {
        smoke, stationName: (station) => t(station.nameKey),
      });

      const kmh = Math.round(run.speed * 3.6);
      set("speed", String(kmh));
      set("time", clock(run.elapsed));
      set("km", `${game.map.kmAt(cam.point.x).toFixed(2)} km`);
      set("coins", String(run.coins));
      set("fuel", `${Math.round(run.fuelL)} L`);
      set("fuelDial", String(Math.round(run.fuelL)));
      bar("fuelBar", run.fuelL / run.stats.tankL);
      bar("progressBar", (run.distance - game.track.startS) / (game.track.finishS - game.track.startS));
      bar("throttleBar", run.throttle);
      bar("brakeBar", run.brake);
      const low = run.fuelL / run.stats.tankL;
      hud.current.fuelBar?.classList.toggle("warn", low <= run.sim.fuel.warnFraction);
      hud.current.fuelBar?.classList.toggle("low", low <= run.sim.fuel.lowFraction);
      // LAS AGUJAS SON UNA ROTACIÓN, no un repintado: el HUD es DOM y una
      // transformación CSS la compone la GPU. El recorrido es de 240°, que es
      // lo que da un cuadrante legible de un vistazo.
      needle("speedNeedle", run.speed / run.stats.topSpeed);
      needle("fuelNeedle", run.fuelL / run.stats.tankL);
      hud.current.loop?.classList.toggle("on", !!run.loop);
      hud.current.stall?.classList.toggle("on", run.loopStall);

      if (!reported && (run.phase === RUN_PHASE.FINISHED || run.phase === RUN_PHASE.STRANDED)) {
        reported = true;
        live.current.onFinish?.(game.result());
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [game, t]);

  // Teclado: flechas y WASD para los dos pedales, P/Esc para la pausa.
  useEffect(() => {
    const down = (e) => {
      if (["ArrowRight", "ArrowUp", "KeyD", "KeyW"].includes(e.code)) { input.current.throttle = 1; e.preventDefault(); }
      if (["ArrowLeft", "ArrowDown", "KeyA", "KeyS"].includes(e.code)) { input.current.brake = 1; e.preventDefault(); }
      if (!e.repeat && ["KeyP", "Escape", "Space"].includes(e.code)) { e.preventDefault(); onPause(); }
    };
    const up = (e) => {
      if (["ArrowRight", "ArrowUp", "KeyD", "KeyW"].includes(e.code)) input.current.throttle = 0;
      if (["ArrowLeft", "ArrowDown", "KeyA", "KeyS"].includes(e.code)) input.current.brake = 0;
    };
    const blur = () => { input.current.throttle = 0; input.current.brake = 0; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [onPause]);

  // Los pedales. `setPointerCapture` + `lostpointercapture` es lo que evita que
  // un dedo que se sale del botón deje el acelerador pegado.
  const pedal = (key) => ({
    onPointerDown: (e) => { input.current[key] = 1; e.currentTarget.setPointerCapture?.(e.pointerId); e.preventDefault(); },
    onPointerUp: () => { input.current[key] = 0; },
    onPointerCancel: () => { input.current[key] = 0; },
    onLostPointerCapture: () => { input.current[key] = 0; },
  });
  const ref = (key) => (node) => { hud.current[key] = node; };

  return (
    <div className="railway-stage">
      <canvas ref={canvas} className="railway-canvas" aria-label={t("railway.canvasLabel")} />
      <div className="railway-hud">
        <div className="railway-hud-left">
          <div className="railway-fuel">
            <span className="railway-can" aria-hidden="true" />
            <div className="railway-meter"><span ref={ref("fuelBar")} className="railway-fuel-bar" /></div>
            <span className="railway-fuel-read" ref={ref("fuel")}>0 L</span>
          </div>
          <div className="railway-purse"><span className="railway-coin" aria-hidden="true" />
            <b ref={ref("coins")}>0</b></div>
        </div>
        <div className="railway-hud-mid">
          <div className="railway-route">
            <span ref={ref("progressBar")} className="railway-route-done" />
            <span className="railway-route-flag" aria-hidden="true">⚑</span>
          </div>
          <span className="railway-chip" ref={ref("km")}>—</span>
          <p className="railway-keyhint">{t("railway.hud.keys")}</p>
        </div>
        <div className="railway-hud-right">
          <span className="railway-chip" ref={ref("time")}>00:00</span>
          <button className="railway-pause" onClick={onPause} aria-label={t("railway.pause")}>❙❙</button>
        </div>
      </div>
      <div className="railway-flags">
        <span className="railway-flag loop" ref={ref("loop")}>{t("railway.hud.loop")}</span>
        <span className="railway-flag stall" ref={ref("stall")}>{t("railway.hud.stall")}</span>
      </div>
      <div className="railway-dials">
        <Dial label={t("railway.hud.speedDial")} unit="km/h" needleRef={ref("speedNeedle")}
          valueRef={ref("speed")} warm />
        <Dial label={t("railway.hud.fuelDial")} unit="L" needleRef={ref("fuelNeedle")}
          valueRef={ref("fuelDial")} />
      </div>
      <div className="railway-pedals">
        <button className="railway-pedal brake" {...pedal("brake")} aria-label={t("railway.hud.brake")}>
          <span className="railway-pedal-fill" ref={ref("brakeBar")} />
          <b>{t("railway.hud.brake")}</b>
        </button>
        <button className="railway-pedal gas" {...pedal("throttle")} aria-label={t("railway.hud.throttle")}>
          <span className="railway-pedal-fill" ref={ref("throttleBar")} />
          <b>{t("railway.hud.throttle")}</b>
        </button>
      </div>
    </div>
  );
}
