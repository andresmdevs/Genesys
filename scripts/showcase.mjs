/**
 * Captures screenshots of a match already in progress by fast-forwarding the
 * deterministic simulation, which is far quicker than playing in real time.
 *
 *   node scripts/showcase.mjs <outputDir>
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'showcase';
const URL = process.argv[3] ?? 'http://localhost:4173/Genesys/';
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/01-menu.png` });

await page.getByRole('button', { name: 'Jugar contra la IA' }).click();
await page.waitForTimeout(400);
await page.locator('.champ-card', { hasText: 'Ysolde' }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/02-seleccion.png` });
await page.locator('.detail button.primary').click();
await page.waitForTimeout(1200);

/** Advances the simulation without waiting for wall-clock time. */
const fastForward = (seconds) =>
  page.evaluate((s) => {
    const g = window.genesys;
    const me = g.match.championOf(g.playerSlot);
    // Let the bots drive our champion too, so the screenshots show a real game.
    if (me?.champion) me.champion.isBot = true;
    for (let i = 0; i < 30 * s; i++) {
      if (g.match.world.winner !== null) break;
      g.match.step();
    }
    return g.match.world.seconds;
  }, seconds);

for (const [minutes, name] of [[4, '03-linea'], [9, '04-media'], [15, '05-tardia']]) {
  const until = minutes * 60;
  let at = await page.evaluate(() => window.genesys.match.world.seconds);
  while (at < until) {
    at = await fastForward(Math.min(90, until - at));
  }
  // Centre on the biggest cluster of champions so the shot shows something.
  await page.evaluate(() => {
    const g = window.genesys;
    const champs = g.match.champions.filter((c) => c.alive);
    let best = champs[0];
    let bestCount = -1;
    for (const c of champs) {
      const n = champs.filter((o) => Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) < 2200).length;
      if (n > bestCount) {
        bestCount = n;
        best = c;
      }
    }
    if (best) {
      g.camera.locked = false;
      g.camera.snapTo(best.pos);
    }
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}: ${Math.round(at / 60)} min`);
}

// A wide view of the whole map.
await page.evaluate(() => {
  const g = window.genesys;
  g.camera.zoom = 0.055;
  g.camera.snapTo({ x: 7200, y: 7200 });
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/06-mapa.png` });

await page.keyboard.down('Tab');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/07-marcador.png` });
await page.keyboard.up('Tab');

const info = await page.evaluate(() => {
  const g = window.genesys;
  const c = g.match.champions;
  return {
    minutos: Math.round(g.match.world.seconds / 60),
    asesinatos: g.match.world.teamKills,
    nivelMax: Math.max(...c.map((u) => u.level)),
    csMax: Math.max(...c.map((u) => u.champion.creepScore)),
    torresCaidas: [...g.match.world.units.values()].filter((u) => u.kind === 'tower' && !u.alive).length,
  };
});
console.log(JSON.stringify(info));
await browser.close();
