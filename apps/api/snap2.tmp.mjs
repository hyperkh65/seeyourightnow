// usage: node snap2.mjs <host> <email|-> <out-prefix> <width> <path...>
import { chromium } from 'playwright-core';
const [,, host, email, prefix, width, ...paths] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: +width, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('TUNNEL') && !m.text().includes('openfreemap')) errors.push(m.text()); });
p.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e)));
if (email !== '-') {
  await p.goto(`http://${host}:3000/login`);
  await p.fill('#email', email);
  await p.fill('#password', 'Demo-Pass-2026!');
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => errors.push('login redirect timeout'));
}
let i = 0;
for (const path of paths) {
  await p.goto(`http://${host}:3000${path}`, { waitUntil: 'networkidle' }).catch((e) => errors.push(String(e)));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${prefix}-${i++}.png`, fullPage: true });
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
await b.close();
