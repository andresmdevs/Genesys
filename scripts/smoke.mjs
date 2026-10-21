/**
 * Visual smoke test. Builds nothing itself: point it at a running
 * `npm run preview` and it drives the game through a real browser, saving
 * screenshots and failing on any console error.
 *
 *   npm run build && npm run preview &
 *   node scripts/smoke.mjs [outputDir] [url]
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'smoke-shots';
const URL = process.argv[3] ?? 'http://localhost:4173/Genesys/';
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.png` });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await shot('1-menu');

await page.getByRole('button', { name: 'Jugar contra la IA' }).click();
await page.waitForTimeout(500);
await shot('2-select');

await page.locator('.champ-card').nth(4).click();
await page.waitForTimeout(300);
await shot('3-detail');
await page.locator('.detail button.primary').click();

await page.waitForTimeout(2500);
await shot('4-game-start');

await page.waitForTimeout(12000);
await shot('5-game-later');

await page.keyboard.down('Tab');
await page.waitForTimeout(400);
await shot('6-scoreboard');
await page.keyboard.up('Tab');

await page.keyboard.press('KeyP');
await page.waitForTimeout(400);
await shot('7-shop');
await page.keyboard.press('KeyP');

await page.mouse.move(900, 300);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(300);
await shot('8-aim');

const stats = await page.evaluate(() => ({
  hp: document.querySelector('.bar.hp em')?.textContent,
  gold: document.querySelector('.gold-row')?.textContent,
  clock: document.querySelector('.clock')?.textContent,
  stat: document.querySelector('.stat-row')?.textContent,
  feed: [...document.querySelectorAll('.feed-line')].map((n) => n.textContent),
}));

console.log('STATS', JSON.stringify(stats, null, 2));
await browser.close();

if (errors.length) {
  console.error('CONSOLE ERRORS:\n' + errors.slice(0, 20).join('\n'));
  process.exit(1);
}
console.log('No console errors.');
