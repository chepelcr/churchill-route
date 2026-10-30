// EL RETRATO DEL CONVOY, con el pintor del juego.
//
// La escala se DERIVA del largo del convoy, así que la María Cecilia con su
// ténder y su coche de madera (31 m) y la AEG con uno solo (30 m) salen las dos
// llenando su tarjeta, sin un `width: 34%` por máquina como tenía el garaje
// anterior. Y como es el pintor de verdad, las ruedas giran: una locomotora
// quieta en un garaje parece una calcomanía.
import React, { useEffect, useRef } from "react";
import { RAILWAY_ART } from "../../../game/railway/index.js";
import { paintCar } from "../../../render/railway/paint.js";
import { consistLengthM } from "../../../game/railway/stats.js";

export default function TrainFigure({ consist, rolling = true, className = "" }) {
  const canvas = useRef(null);
  const live = useRef({ consist, rolling });
  live.current = { consist, rolling };

  useEffect(() => {
    const el = canvas.current;
    const g = el.getContext("2d");
    let raf = 0, last = performance.now(), roll = 0, dpr = 1, w = 1, h = 1;
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
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cars = live.current.consist;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!cars?.length) return;
      const lengthM = consistLengthM(cars) + 2;
      const tallest = Math.max(...cars.map((c) => c.record.heightM || 4.5)) + 1.4;
      const ppm = Math.min((w - 8) / lengthM, (h - 10) / tallest);
      if (live.current.rolling) roll += dt * 2.1;
      const railY = h - Math.max(6, h * 0.12);
      const T = RAILWAY_ART.track;
      g.fillStyle = T.rail;
      g.fillRect(0, railY, w, Math.max(1, T.railM * ppm));
      g.fillStyle = T.sleeper;
      for (let x = 2; x < w; x += T.sleeperPitchM * ppm) {
        g.fillRect(x, railY, T.sleeperWM * ppm, T.sleeperHM * ppm);
      }
      let x = w - 4 - (w - 8 - lengthM * ppm) / 2;
      for (const car of cars) {
        x -= (car.lengthM / 2) * ppm;
        paintCar(g, car.record, { x, y: railY, angle: 0 }, ppm, { rollRad: roll });
        x -= (car.lengthM / 2 + 0.9) * ppm;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={canvas} className={`railway-figure ${className}`} aria-hidden="true" />;
}
