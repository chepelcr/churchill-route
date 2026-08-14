// Pixel-exact PNG comparison, for "did the art move?" gates.
//
//   node tools/png-diff.mjs a.png b.png [diff.png]
//
// Exists because a byte-size comparison is not a comparison: two PNGs of the
// same image can differ by a few bytes of deflate framing, and two genuinely
// different images can be the same size. Decoding is done in a headless page
// because that is the same decoder the art was drawn with.
//
// Writes an optional diff image where every changed pixel is magenta, which is
// the only way to answer "where" rather than just "how many".
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [a, b, out] = process.argv.slice(2);
if (!a || !b) { console.error("usage: png-diff.mjs a.png b.png [diff.png]"); process.exit(2); }

const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const result = await page.evaluate(async ([srcA, srcB]) => {
  const load = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
  const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
  if (ia.width !== ib.width || ia.height !== ib.height) {
    return { sized: false, a: [ia.width, ia.height], b: [ib.width, ib.height] };
  }
  const px = (img) => {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.getContext("2d").getImageData(0, 0, img.width, img.height);
  };
  const pa = px(ia), pb = px(ib);
  const diff = new Uint8ClampedArray(pa.data.length);
  let changed = 0, worst = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(pa.data[i + k] - pb.data[i + k]));
    if (d) { changed++; worst = Math.max(worst, d); }
    // the base image, dimmed, with every changed pixel called out in magenta
    diff[i] = d ? 255 : pa.data[i] * 0.35 + 160;
    diff[i + 1] = d ? 0 : pa.data[i + 1] * 0.35 + 160;
    diff[i + 2] = d ? 255 : pa.data[i + 2] * 0.35 + 160;
    diff[i + 3] = 255;
  }
  const c = document.createElement("canvas");
  c.width = pa.width; c.height = pa.height;
  c.getContext("2d").putImageData(new ImageData(diff, pa.width, pa.height), 0, 0);
  return {
    sized: true, changed, worst,
    total: pa.data.length / 4,
    png: c.toDataURL("image/png").split(",")[1],
  };
}, [dataUri(a), dataUri(b)]);

await browser.close();

if (!result.sized) {
  console.error(`[diff] different dimensions: ${result.a} vs ${result.b}`);
  process.exit(1);
}
if (out && result.changed) writeFileSync(out, Buffer.from(result.png, "base64"));

const pct = (100 * result.changed / result.total).toFixed(4);
if (result.changed === 0) {
  console.log(`[diff] IDENTICAL — ${result.total} pixels`);
  process.exit(0);
}
console.log(`[diff] ${result.changed} of ${result.total} pixels differ (${pct}%), worst channel delta ${result.worst}`
            + (out ? ` -> ${out}` : ""));
process.exit(1);
