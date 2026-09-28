// usage: node snap.mjs <url> <out.png> [width] [height] [fullPage]
import { chromium } from 'playwright-core';
const [,, url, out, w = '1440', h = '900', full = '1'] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(url, { waitUntil: 'networkidle' }).catch((e) => errors.push(String(e)));
await p.waitForTimeout(800);
await p.screenshot({ path: out, fullPage: full === '1' });
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
await b.close();
