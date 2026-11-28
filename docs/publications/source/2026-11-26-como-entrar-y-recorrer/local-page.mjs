import { extname, resolve, sep } from 'node:path';
import { stat, open } from 'node:fs/promises';

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
};

// Playwright serves this render's static files from disk without a listening server.
export async function serveLocal(page, base, directory) {
  const root = resolve(directory);
  await page.route(`${base}/**`, async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) return route.fulfill({ status: 403 });
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return route.fulfill({ status: 404 });
    const contentType = mime[extname(path)] || 'application/octet-stream';
    const range = /^(?:bytes=)(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ path, contentType });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end) return route.fulfill({ status: 416, headers: { 'content-range': `bytes */${info.size}` } });
    const file = await open(path);
    try {
      const body = Buffer.alloc(end - start + 1);
      await file.read(body, 0, body.length, start);
      return route.fulfill({ body, status: 206, contentType,
        headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${info.size}` } });
    } finally {
      await file.close();
    }
  });
}
