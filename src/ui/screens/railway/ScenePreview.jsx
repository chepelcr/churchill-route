// EL PAISAJE DE LA CAMPAÑA, PASANDO EN BUCLE.
//
// Lo que el selector muestra no es una foto del nivel: es el MISMO pintor de
// fondos del juego, con la cámara andando despacio, cambiando de escena cada
// `scenes.previewHoldS` segundos. Y pasa TODAS las escenas del modo —las cinco
// del tramo jugable y las cuatro de los tramos propuestos (Río Grande, Orotina,
// Caldera, el estero)—, así que el avance de la campaña se ve antes de existir.
//
// Que sea el pintor de verdad y no una imagen es lo que hace que no haya una
// segunda copia del arte: reteñir el cafetal lo reteñe en el selector el mismo
// cuadro. Es el mismo argumento por el que el inspector del editor resuelve el
// arte con `landmarkProp` en vez de dibujarse el suyo.
import React, { useEffect, useRef } from "react";
import { RAILWAY_ART, RAILWAY_SIM, railwayScenes } from "../../../game/railway/index.js";
import { paintBackdrop } from "../../../render/railway/backdrop.js";
import { paintCar } from "../../../render/railway/paint.js";

export default function ScenePreview({ consist = [], className = "", onScene, pinned = null }) {
  const canvas = useRef(null);
  const live = useRef({ consist, onScene, pinned });
  live.current = { consist, onScene, pinned };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = el.getContext("2d");
    const scenes = railwayScenes();
    const art = RAILWAY_ART;
    const S = RAILWAY_SIM.scenes;
    let raf = 0, last = performance.now(), t = 0, held = 0, index = 0, dpr = 1;
    let w = 1, h = 1;

    const resize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width; h = rect.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;
      held += dt;
      // UN TRAMO ELEGIDO FIJA SU PAISAJE. Es la respuesta a «¿y ese tramo que
      // todavía no se juega, cómo se ve?»: su escena existe desde hoy y se
      // puede mirar, que es lo que convierte una lista de nombres en una línea.
      const pin = live.current.pinned;
      if (pin && scenes.includes(pin) && scenes[index] !== pin) {
        index = scenes.indexOf(pin);
        held = 0;
        live.current.onScene?.(scenes[index]);
      }
      if (!pin && held > S.previewHoldS + S.previewFadeS) {
        held = 0;
        index = (index + 1) % scenes.length;
        live.current.onScene?.(scenes[index]);
      }
      const next = scenes[(index + 1) % scenes.length];
      const fade = pin ? 0 : Math.max(0, (held - S.previewHoldS) / S.previewFadeS);

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      // La cámara del selector anda sola: sin ella el parallax no se lee y un
      // fondo en capas se ve igual que un dibujo plano.
      const camX = t * 46;
      paintBackdrop(g, art, w, h, {
        a: scenes[index], b: fade > 0 ? next : null, blend: fade, camX, camY: 0, t,
      });

      // Una franja de suelo y el convoy elegido pasando: el selector tiene que
      // decir también CON QUÉ se viaja.
      const scene = art.scenes[scenes[index]];
      const nextScene = art.scenes[next];
      const railY = h * 0.88;
      g.fillStyle = fade > 0.5 ? nextScene.ground.soil : scene.ground.soil;
      g.fillRect(0, railY, w, h - railY);
      g.fillStyle = fade > 0.5 ? nextScene.ground.grass : scene.ground.grass;
      g.fillRect(0, railY, w, Math.max(2, h * 0.02));
      const T = art.track;
      g.fillStyle = T.sleeper;
      const ppm = Math.max(2.4, h / 54);
      for (let x = (-camX * 0.9) % (T.sleeperPitchM * ppm); x < w; x += T.sleeperPitchM * ppm) {
        g.fillRect(x, railY, T.sleeperWM * ppm, T.sleeperHM * ppm);
      }
      g.fillStyle = T.rail;
      g.fillRect(0, railY - T.railM * ppm * 0.5, w, Math.max(1, T.railM * ppm));

      const cars = live.current.consist;
      if (cars.length) {
        let x = w * 0.62;
        for (const car of cars) {
          paintCar(g, car.record, { x, y: railY - T.railM * ppm * 0.5, angle: 0 }, ppm, {
            rollRad: (-camX * 0.9) / Math.max(0.3, car.record.wheels?.[0]?.r || 0.8) / ppm,
          });
          x -= (car.lengthM + 0.9) * ppm;
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={canvas} className={`railway-preview ${className}`} aria-hidden="true" />;
}
