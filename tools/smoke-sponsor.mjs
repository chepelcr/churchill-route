// A parcel sponsor must render INSIDE the parcel's own slot rect.
//
//   node tools/smoke-sponsor.mjs http://localhost:8799/
//
// The world reserves a `slot` on every parcel precisely so a sponsor's plate has
// a known place and size; drawParcels() matches content lotes by `parcel` id.
// This drives the game to Lito Pérez twice — once with a parcel-bound sponsor,
// once without — and asserts the pixels inside the slot changed. It guards the
// regression that made the feature unreachable: the content loader dropping the
// `parcel` field, so the match never fired.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const url = process.argv[2] || 'http://localhost:8799/';
const manifest = JSON.parse(await fs.readFile(new URL('../src/world2d/manifest.json', import.meta.url), 'utf8'));
const parcel = manifest.parcels.find((entry) => entry.id === 'estadio_field');
const [sx, sy, sw, sh] = parcel.slot;

async function shot(withSponsor) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (event) => errors.push(String(event)));
  await page.route('**/content.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      version: 1, meta: {}, supporters: [], npcs: [],
      lotes: withSponsor
        ? [{ id: 'pfc', name: 'Puntarenas FC', label: 'PFC', parcel: 'estadio_field', tone: '#e8342f' }]
        : [],
      ui: {},
    }),
  }));
  await page.goto(`${url}?editorPlay=1&x=${Math.round(sx + sw / 2)}&y=${Math.round(sy + sh / 2)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const buffer = await page.screenshot({ clip: { x: 540, y: 260, width: 200, height: 200 } });
  await browser.close();
  return { buffer, errors };
}

const plain = await shot(false);
const sponsored = await shot(true);
const differing = plain.buffer.length !== sponsored.buffer.length
  || plain.buffer.compare(sponsored.buffer) !== 0;

const problems = [];
if (!differing) problems.push('the sponsored render is pixel-identical — the parcel lote never reached drawParcels');
for (const error of [...plain.errors, ...sponsored.errors]) problems.push(`page error: ${error}`);
if (problems.length) {
  for (const problem of problems) console.error(`[sponsor] ${problem}`);
  process.exit(1);
}
console.log(`[sponsor] ok — parcel slot ${sw}x${sh} at ${sx},${sy} renders the sponsor plate`);
