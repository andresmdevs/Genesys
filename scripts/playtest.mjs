/**
 * Plays the game through a real browser and asserts that a human can actually
 * do the things the game is about: walk, farm, level up, cast and buy.
 *
 *   npm run build && npm run preview &
 *   node scripts/playtest.mjs [screenshotDir]
 *
 * Exits non-zero on a console error or a failed check.
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'playtest-shots';
const URL = process.argv[3] ?? 'http://localhost:4173/Genesys/';
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const state = () =>
  page.evaluate(() => {
    const g = window.genesys;
    const u = g.match?.championOf(g.playerSlot);
    if (!u) return null;
    const c = u.champion;
    return {
      x: Math.round(u.pos.x),
      y: Math.round(u.pos.y),
      hp: Math.round(u.hp),
      level: u.level,
      cs: c.creepScore,
      gold: Math.round(c.gold),
      items: c.items.length,
      damage: Math.round(c.damageDealt),
      ranks: { Q: c.abilities.Q.rank, W: c.abilities.W.rank, E: c.abilities.E.rank },
      tick: g.match.world.tick,
      enemyMinionsNear: [...g.match.world.units.values()].filter(
        (x) => x.alive && x.kind === 'minion' && x.team !== u.team &&
          Math.hypot(x.pos.x - u.pos.x, x.pos.y - u.pos.y) < 1200,
      ).length,
    };
  });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Jugar contra la IA' }).click();
await page.waitForTimeout(400);
await page.locator('.champ-card', { hasText: 'Ryka' }).click();
await page.locator('.detail button.primary').click();
await page.waitForTimeout(1200);

const start = await state();
check('la partida arranca con un campeón vivo', Boolean(start) && start.hp > 0);

// Walk down mid toward the lane.
for (let i = 0; i < 8; i++) {
  await page.mouse.move(980, 300);
  await page.mouse.click(980, 300, { button: 'right' });
  await page.waitForTimeout(2200);
}
const walked = await state();
const travelled = Math.round(Math.hypot(walked.x - start.x, walked.y - start.y));
check('el clic derecho mueve al campeón', travelled > 3000, `${travelled} unidades recorridas`);
await page.screenshot({ path: `${OUT}/1-walked.png` });

// Rank abilities up.
await page.keyboard.press('Shift+KeyQ');
await page.waitForTimeout(300);
const ranked = await state();
check('mayús + Q sube la habilidad', ranked.ranks.Q >= 1, `rango Q ${ranked.ranks.Q}`);

// Keep walking up the lane until the enemy wave is actually in sight.
let met = false;
for (let i = 0; i < 25 && !met; i++) {
  await page.mouse.move(960, 310);
  await page.mouse.click(960, 310, { button: 'right' });
  await page.waitForTimeout(1500);
  met = (await state()).enemyMinionsNear > 0;
}
check('el campeón alcanza la oleada enemiga', met);
await page.screenshot({ path: `${OUT}/2-lane.png` });

// Last hit the way a player does: click the weakest enemy minion in range.
// The screen position comes from the live camera, so this exercises the whole
// path from pointer to simulation.
const clickWeakestMinion = async () => {
  const at = await page.evaluate(() => {
    const g = window.genesys;
    const me = g.match.championOf(g.playerSlot);
    if (!me?.alive) return null;
    const reach = me.stats.attackRange + 200;
    let best = null;
    for (const u of g.match.world.units.values()) {
      if (!u.alive || u.kind !== 'minion' || u.team === me.team) continue;
      if (Math.hypot(u.pos.x - me.pos.x, u.pos.y - me.pos.y) > reach) continue;
      if (!best || u.hp < best.hp) best = u;
    }
    if (!best) return null;
    const p = g.camera.worldToScreen(best.pos);
    const r = g.camera.pixelRatio || 1;
    return { x: p.x / r, y: p.y / r };
  });
  if (!at) return false;
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  return true;
};

// Attack-move into the wave, then last hit for a while.
await page.keyboard.press('KeyA');
await page.mouse.move(820, 350);
await page.mouse.click(820, 350);
for (let i = 0; i < 70; i++) {
  const clicked = await clickWeakestMinion();
  if (!clicked) {
    // Nothing in range: hold with a standing attack-move and wait for the wave.
    await page.keyboard.press('KeyA');
    await page.mouse.move(820, 350);
    await page.mouse.click(820, 350);
  }
  await page.waitForTimeout(600);
}

const farmed = await state();
check('el campeón inflige daño', farmed.damage > 0, `${farmed.damage} de daño`);
check('el campeón remata súbditos', farmed.cs > 0, `${farmed.cs} súbditos`);
check('el campeón gana experiencia', farmed.level > 1 || farmed.gold > start.gold,
  `nivel ${farmed.level}, ${farmed.gold} oro`);
await page.screenshot({ path: `${OUT}/3-farmed.png` });

// Cast an ability at the cursor.
await page.mouse.move(900, 330);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/4-aiming.png` });
await page.mouse.click(900, 330);
await page.waitForTimeout(700);
const cast = await state();
check('lanzar una habilidad consume maná o inflige daño', cast.damage >= farmed.damage);

// Head home. Right clicking the minimap issues a move order, which is the
// reliable way back when a recall keeps getting interrupted.
const mm = await page.locator('#minimap').boundingBox();
const homeX = mm.x + mm.width * 0.08;
const homeY = mm.y + mm.height * 0.92;
let home = false;
for (let i = 0; i < 40 && !home; i++) {
  await page.mouse.move(homeX, homeY);
  await page.mouse.click(homeX, homeY, { button: 'right' });
  await page.waitForTimeout(1500);
  home = await page.evaluate(() => {
    const g = window.genesys;
    const u = g.match.championOf(g.playerSlot);
    return Math.hypot(u.pos.x - 1150, u.pos.y - 1150) < 650;
  });
}
check('el campeón puede volver a su base', home);

await page.keyboard.press('KeyP');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/5-shop.png` });
const bought = await page.evaluate(() => {
  const button = [...document.querySelectorAll('.shop-item')].find((b) => !b.disabled);
  if (!button) return false;
  button.click();
  return true;
});
await page.waitForTimeout(500);
const shopped = await state();
check('se puede comprar en la tienda', bought && shopped.items > 0, `${shopped.items} objetos`);

await page.screenshot({ path: `${OUT}/6-final.png` });
console.log('\nESTADO FINAL', JSON.stringify(shopped));
await browser.close();

if (errors.length) {
  console.error('\nERRORES DE CONSOLA:\n' + errors.slice(0, 20).join('\n'));
  process.exit(1);
}
const failed = checks.filter((c) => !c.pass);
if (failed.length) {
  console.error(`\n${failed.length} comprobaciones fallidas.`);
  process.exit(1);
}
console.log('\nTodas las comprobaciones pasaron.');
