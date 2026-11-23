import { chromium } from '../../../../node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('tmp/playitas', { recursive: true });

const browser = await chromium.launch();
try {
  for (const [version, port] of [['02-version-intermedia', 8746], ['03-version-actual', 8745]]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('churchill_tuning_v1', JSON.stringify({speed:1,zoom:1,poiNames:false}));
      localStorage.setItem('churchill_progress_v1', JSON.stringify({unlocked:['carmen','centro','paseo','playitas','cocal','mata','caldera'],clearedStages:[],best:0}));
    });
    await page.goto(`http://127.0.0.1:${port}/?canvas`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.Game?.state && document.querySelector('canvas') && !document.body.innerText.includes('LOADING'), null, {timeout:60000});
    await page.evaluate(async (version) => {
      const G = window.Game;
      G.setAttract(false); G.startExplore(); G.setWeather('sunny');
      const [x,y] = [31615,18425];
      Object.assign(G.state.p, {x,y,vx:0,vy:0,speed:0,a:0});
      Object.assign(G.state.cam, {x,y,rot:0,shake:0});
      const sh = new URL('/src/render/c2d/shadows.js', location.href);
      const sunPath = (await fetch(sh).then(r=>r.text())).match(/from\s+["']([^"']*\/render\/sun\.js[^"']*)["']/)[1];
      const sun = new URL(sunPath, sh);
      const dayPath = (await fetch(sun).then(r=>r.text())).match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)[1];
      (await import(new URL(dayPath,sun).href)).setDayCycle(true,0.25);
    },version);
    await page.waitForTimeout(6000);
    const metadata = await page.evaluate(async (version) => {
      const G = window.Game;
      G.state.paused = true;
      const [x,y,zoom] = [31615,18400,2.15];
      Object.assign(G.state.cam, {x,y,rot:0,shake:0,zoom,z:zoom});
      G.state.barriers = [];
      G.setWeather('sunny');
      for (const el of document.querySelectorAll('body > *:not(canvas), #root > *:not(canvas)')) {
        if (!el.querySelector('canvas')) el.style.display='none';
      }
      for (const el of document.querySelectorAll('canvas')) el.style.visibility='visible';
      return {cam:{...G.state.cam},player:{x:G.state.p.x,y:G.state.p.y},url:location.href};
    },version);
    await page.waitForTimeout(350);
    const dest = `docs/publications/img/2026-11-12-las-playitas/${version}.png`;
    await page.screenshot({path:dest});
    writeFileSync(`tmp/playitas/${version}.json`, JSON.stringify({metadata,errors},null,2));
    console.log(JSON.stringify({version,dest,errors}));
    await page.close();
    if(errors.length) throw Error(errors.join('\n'));
  }
} finally { await browser.close(); }
