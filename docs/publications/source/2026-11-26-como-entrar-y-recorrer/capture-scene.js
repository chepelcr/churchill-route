import { Game } from '../../../../src/game/index.js';
import { render, setupCanvas } from '../../../../src/render/Renderer.js';
import { WORLD2D as world } from '../../../../src/world2d/index.js';
import { SURFACE } from '../../../../src/domain/vocabulary.generated.js';

setupCanvas(document.querySelector('canvas'));

const roadSurfaces = new Set([SURFACE.ROAD, SURFACE.PASEO]);

function pointAlong(points, progress) {
  const segments = points.slice(1).map(([x, y], index) => {
    const [startX, startY] = points[index];
    return { startX, startY, dx: x - startX, dy: y - startY, length: Math.hypot(x - startX, y - startY) };
  });
  let distance = Math.min(1, Math.max(0, progress)) * segments.reduce((total, segment) => total + segment.length, 0);
  for (const segment of segments) {
    if (distance <= segment.length + 0.0001) {
      const { startX, startY, dx, dy, length } = segment;
      return { x: startX + dx * distance / length, y: startY + dy * distance / length };
    }
    distance -= segment.length;
  }
  const [x, y] = points.at(-1);
  return { x, y };
}

const { state } = Game;
let shot;
window.captureReel = {
  async setup(nextShot) {
    shot = nextShot;
    const [x, y] = shot.points[0];
    await world.ready(x, y, 2400, 2400);
    Game.setAttract(false);
    await Game.startExplore({ x, y, vehicleKey: 'scooter', weather: shot.weather });
    state.barriers = [];
    if (state.vehicleKey !== 'scooter') throw new Error('La toma requiere la moto');
    // Comprueba también los puntos entre cuadros para detectar cualquier salida de la calzada.
    for (let index = 0; index <= 300; index++) {
      const point = pointAlong(shot.points, index / 300);
      if (!world.tileResident(point.x, point.y) || !roadSurfaces.has(world.surfaceAt(point.x, point.y))) {
        throw new Error(`${shot.id}: fuera de calzada en ${point.x.toFixed(1)}, ${point.y.toFixed(1)} (superficie ${world.surfaceAt(point.x, point.y)})`);
      }
    }
  },
  frame(index, count) {
    const progress = index / Math.max(1, count - 1);
    const { x, y } = pointAlong(shot.points, progress);
    const behind = pointAlong(shot.points, progress - 0.025);
    const ahead = pointAlong(shot.points, progress + 0.025);
    const a = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
    const zoom = shot.zoom[0] + (shot.zoom[1] - shot.zoom[0]) * progress;
    const rot = shot.rotation[0] + (shot.rotation[1] - shot.rotation[0]) * progress;
    const [lookX, lookY] = shot.look;
    Object.assign(state.p, { x, y, a, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, speed: 110 });
    Object.assign(state.cam, {
      x: x + lookX + (Math.sin(rot) * 78) / zoom,
      y: y + lookY + (Math.cos(rot) * 78) / zoom,
      shake: 0, rot, zoom,
    });
    render(index / 30 + 2);
  },
};
