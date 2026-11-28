import { build } from 'vite';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serveLocal } from './local-page.mjs';

const source = import.meta.dirname;
const repo = resolve(source, '../../../..');
const publicDir = join(source, 'public');
const scratch = await mkdtemp(join(tmpdir(), 'churchill-poses-'));
const base = 'http://churchill-capture.local';
const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];
const proof = process.argv.includes('--proof');
const shots = [
  // Camera blocking comes from the generated roads beside each landmark.
  { id: 'faro', weather: 'sunny', seconds: 4.3, zoom: [2.06, 2.30], rotation: [-0.18, -0.38], look: [-70, 5],
    points: [[23840,19180],[23849,19205],[23867,19241],[23894,19280],[23930,19331],[23966,19374],[23996,19403]] },
  { id: 'paseo', weather: 'sunset', seconds: 5.1, zoom: [2.55, 2.30], rotation: [-0.80, -0.65], look: [0, 54],
    points: [[29930,19596],[30215,19573],[30437,19555],[30500,19554]] },
  { id: 'catedral', weather: 'sunny', seconds: 3.1, zoom: [1.74, 1.95], rotation: [0.44, 0.30], look: [3, -72],
    points: [[29305,19013],[29410,19004],[29500,18998]] },
  { id: 'litoperez', weather: 'sunset', seconds: 3.1, zoom: [1.30, 1.37], rotation: [-0.37, -0.24], look: [5, 99],
    points: [[27858,19148],[27970,19135],[28105,19125]] },
  { id: 'faro-noche', weather: 'night', seconds: 3.7, zoom: [1.58, 1.64], rotation: [-0.21, -0.32], look: [-80, 20],
    points: [[23835,19150],[23840,19186],[23863,19235],[23893,19281],[23930,19331],[23966,19374],[23996,19403]] },
];

try {
  await mkdir(publicDir, { recursive: true });
  await build({ root: repo, logLevel: 'warn', build: { outDir: scratch, emptyOutDir: true, rollupOptions: {
    input: { app: join(repo, 'index.html'), capture: join(source, 'capture.html') },
  } } });
  const browser = await chromium.launch({ args: ['--single-process', '--disable-gpu'] });
  try {
    const context = await browser.newContext({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5, locale: 'es-CR', serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('churchill_tuning_v1', JSON.stringify({ resolution: 'alta', poiNames: false }));
      localStorage.setItem('churchill_intro_seen_v1', '1');
      localStorage.setItem('churchill_progress_v1', JSON.stringify({ unlocked: ['carmen','centro','paseo','playitas','cocal','mata','caldera'], clearedStages: [], best: 0 }));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await serveLocal(page, base, scratch);
    const cdp = await context.newCDPSession(page);
    const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 })).data, 'base64');

    if (!only || only === 'menu') {
      await page.setViewportSize({ width: 960, height: 540 });
      await page.goto(base + '/?canvas');
      const explore = page.getByRole('button', { name: /^Recorrer/ });
      await explore.waitFor({ timeout: 18000 }).catch(async (error) => {
        console.error(await page.locator('body').innerText(), errors);
        throw error;
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(550);
      await explore.evaluate((element) => { element.style.outline = '3px solid #ffe077'; });
      await writeFile(join(publicDir, 'menu.jpg'), await grab());
      await explore.click();
      const city = page.getByRole('button', { name: /^La ciudad/i });
      await city.waitFor();
      await city.evaluate((element) => { element.style.outline = '3px solid #ffe077'; });
      await page.waitForTimeout(450);
      await writeFile(join(publicDir, 'ciudad.jpg'), await grab());
      console.log('Menús de Recorrer y La ciudad capturados');
    }

    if (only !== 'menu') {
      await page.setViewportSize({ width: 720, height: 1280 });
      await page.goto(base + '/' + capturePath());
      await page.waitForFunction(() => !!window.captureReel);
      for (const shot of shots.filter(({ id }) => !only || only === id)) {
        await page.evaluate((setup) => window.captureReel.setup(setup), shot);
        const count = Math.round(30 * shot.seconds);
        if (proof) {
          await page.evaluate((total) => window.captureReel.frame(Math.floor(total / 2), total), count);
          await writeFile(join(publicDir, shot.id + '-proof.jpg'), await grab());
          continue;
        }
        for (let index = 0; index < count; index++) {
          await page.evaluate(([frame, total]) => window.captureReel.frame(frame, total), [index, count]);
          await writeFile(join(scratch, 'frame-' + String(index).padStart(4, '0') + '.jpg'), await grab());
        }
        const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '30', '-i', join(scratch, 'frame-%04d.jpg'),
          '-frames:v', String(count), '-c:v', 'libx264', '-crf', '19', '-pix_fmt', 'yuv420p', '-g', '30', '-movflags', '+faststart',
          join(publicDir, shot.id + '.mp4')], { stdio: 'inherit' });
        if (encoded.status !== 0) throw new Error('No se pudo codificar ' + shot.id);
        console.log(`${shot.id}: ${count} cuadros, recorrido verificado sobre calzada`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  } finally {
    await browser.close();
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function capturePath() {
  return 'docs/publications/source/2026-11-26-como-entrar-y-recorrer/capture.html';
}
