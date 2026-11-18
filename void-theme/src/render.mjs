// Screenshots every .icon in icons.html to <outdir>/<id>.png (512x512, transparent).
// usage: node render.mjs <icons.html> <outdir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [html, outdir] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.goto('file://' + resolve(html));
const ids = await page.$$eval('.icon', els => els.map(e => e.id));
for (const id of ids) {
  await page.locator('#' + id).screenshot({ path: `${outdir}/${id}.png`, omitBackground: true });
}
await browser.close();
console.log(`rendered ${ids.length} icons`);
