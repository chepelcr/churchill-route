import { bundle } from '@remotion/bundler';
import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { serveLocal } from './local-page.mjs';

const source = import.meta.dirname;
execFileSync(process.execPath, [resolve(source, '../../../../brand/export.mjs'), '--out', join(source, 'public/brand')], { stdio: 'inherit' });
const output = resolve(source, '../../Kit_Instagram_Churchill/06_reel_publicacion_03/Reel_03_Como_entrar_y_recorrer.mp4');
const base = 'http://churchill-remotion.local';
const scratch = await mkdtemp(join(tmpdir(), 'churchill-remotion-'));
const proof = process.argv.includes('--proof');
let encoder;
try {
  await bundle({ entryPoint: join(source, 'index.jsx'), outDir: scratch, publicDir: join(source, 'public'), onProgress: () => {} });
  const browser = await chromium.launch({ args: ['--single-process', '--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    page.on('pageerror', (error) => console.error(error));
    await serveLocal(page, base, scratch);
    await page.addInitScript(() => {
      window.remotion_inputProps = '{}';
      window.remotion_initialFrame = 0;
      window.remotion_attempt = 1;
      window.remotion_audioEnabled = false;
      window.remotion_videoEnabled = true;
      window.remotion_logLevel = 'warn';
      window.remotion_isMainTab = true;
      window.remotion_puppeteerTimeout = 20000;
      window.remotion_sampleRate = 48000;
      window.process = { env: { NODE_ENV: 'production' } };
    });
    await page.goto(base + '/');
    await page.waitForFunction(() => !!window.remotion_setBundleMode);
    await page.evaluate(() => window.remotion_setBundleMode({ type: 'evaluation' }));
    await ready(page);
    const composition = await page.evaluate(() => window.remotion_calculateComposition('ChurchillRecorrer'));
    await page.evaluate((value) => window.remotion_setBundleMode({
      type: 'composition',
      compositionName: value.id,
      serializedResolvedPropsWithSchema: value.serializedResolvedPropsWithCustomSchema,
      compositionDurationInFrames: value.durationInFrames,
      compositionFps: value.fps,
      compositionHeight: value.height,
      compositionWidth: value.width,
      compositionDefaultSampleRate: 48000,
    }), composition);
    await ready(page);
    const cdp = await page.context().newCDPSession(page);
    const frames = proof ? [50, 148, 217, 295, 417, 490, 603] : Array.from({ length: composition.durationInFrames }, (_, frame) => frame);
    let finished;
    if (!proof) {
      encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(composition.fps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
        '-i', join(source, 'public/radio.m4a'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264',
        '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-c:a', 'copy', '-movflags', '+faststart', output], { stdio: ['pipe', 'inherit', 'inherit'] });
      finished = once(encoder, 'exit');
    }
    for (const frame of frames) {
      await page.evaluate(([index, id]) => window.remotion_setFrame(index, id, 1), [frame, composition.id]);
      await ready(page);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
      const bytes = Buffer.from(data, 'base64');
      if (proof) await writeFile(join(tmpdir(), `churchill-reel-${frame}.jpg`), bytes);
      else if (!encoder.stdin.write(bytes)) await once(encoder.stdin, 'drain');
      if (frame % 90 === 0 || proof) console.log(`Remotion · cuadro ${frame}/${composition.durationInFrames}`);
    }
    if (encoder) {
      encoder.stdin.end();
      const [code] = await finished;
      if (code !== 0) throw new Error(`FFmpeg terminó con código ${code}`);
      console.log(output);
    }
  } finally {
    await browser.close();
  }
} finally {
  if (encoder?.exitCode === null) encoder.kill();
  await rm(scratch, { recursive: true, force: true });
}

async function ready(page) {
  await page.waitForFunction(() => window.remotion_renderReady || window.remotion_cancelledError, null, { timeout: 20000 });
  const error = await page.evaluate(() => window.remotion_cancelledError);
  if (error) throw new Error(error.message || error);
}
