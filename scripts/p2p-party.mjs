/**
 * Four humans, two a side, in one peer-to-peer room, with bots filling the
 * remaining six seats. Checks that seats cannot collide, that everyone lands
 * where they clicked, and that all four simulations stay identical.
 *
 *   node scripts/p2p-party.mjs [screenshotDir] [gameUrl]
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const GAME = process.argv[3] ?? process.env.GAME_URL ?? 'http://localhost:4173/Genesys/';
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.argv[2] ?? 'party-shots';
const SECONDS = Number(process.env.SECONDS ?? 18);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});

const errors = [];
const open = async (label) => {
  const page = await browser.newPage({ viewport: { width: 960, height: 620 } });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label}: ${m.text()}`);
  });
  await page.goto(GAME, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Partida online' }).click();
  await page.waitForSelector('input');
  return page;
};

// Seats: two on each side, so the room has allies and enemies both.
const roster = [
  { name: 'Ana', team: 'EQUIPO AZUL', pos: 'TOP', champ: 'Ryka' },
  { name: 'Bruno', team: 'EQUIPO AZUL', pos: 'JG', champ: 'Vael' },
  { name: 'Carla', team: 'EQUIPO ROJO', pos: 'MID', champ: 'Pyrrhen' },
  { name: 'Diego', team: 'EQUIPO ROJO', pos: 'SUP', champ: 'Grommar' },
];

const host = await open(roster[0].name);
await host.locator('input').first().fill(roster[0].name);
await host.getByRole('button', { name: 'Crear sala' }).click();
await host.waitForSelector('.room-code-value', { timeout: 40000 });
const code = (await host.locator('.room-code-value').textContent()).trim();
console.log(`sala ${code} creada por ${roster[0].name}`);

const pages = [host];
for (const player of roster.slice(1)) {
  const page = await open(player.name);
  await page.locator('input').first().fill(player.name);
  await page.locator('input').nth(1).fill(code);
  await page.getByRole('button', { name: 'Unirse' }).click();
  await page.waitForSelector('.seat-board', { timeout: 40000 });
  pages.push(page);
  console.log(`${player.name} entró`);
}

// Each takes the seat they want. The column index decides the team.
for (let i = 0; i < roster.length; i++) {
  const { team, pos, champ } = roster[i];
  const column = team === 'EQUIPO AZUL' ? 0 : 1;
  await pages[i].locator('.seat-col').nth(column).locator('.seat', { hasText: pos }).click();
  await pages[i].waitForTimeout(700);
  await pages[i].locator('.champ-card', { hasText: champ }).click();
  await pages[i].waitForTimeout(400);
}
await host.waitForTimeout(800);
await host.screenshot({ path: `${OUT}/1-lobby.png` });

for (const page of pages) {
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
}
for (const page of pages) await page.waitForSelector('#minimap', { timeout: 40000 });
console.log('partida arrancada en los cuatro clientes');

for (let i = 0; i < 5; i++) {
  for (const page of pages) await page.mouse.click(600, 240, { button: 'right' });
  await host.waitForTimeout(800);
}
await host.waitForTimeout(SECONDS * 1000);

const fingerprint = (page) =>
  page.evaluate(() => {
    const w = window.genesys.match.world;
    return {
      tick: w.tick,
      units: [...w.units.values()]
        .map((u) => `${u.id}:${u.hp.toFixed(1)}:${u.pos.x.toFixed(1)}:${u.pos.y.toFixed(1)}`)
        .join('|'),
    };
  });

let prints = await Promise.all(pages.map(fingerprint));
for (let i = 0; i < 50 && new Set(prints.map((p) => p.tick)).size > 1; i++) {
  await host.waitForTimeout(250);
  prints = await Promise.all(pages.map(fingerprint));
}

const seated = await host.evaluate(() =>
  window.genesys.match.champions
    .filter((c) => !c.champion.isBot)
    .map((c) => `${c.name}:${c.team === 0 ? 'azul' : 'rojo'}:${c.champion.position}`)
    .sort(),
);
const botCount = await host.evaluate(
  () => window.genesys.match.champions.filter((c) => c.champion.isBot).length,
);

console.log(`ticks: ${prints.map((p) => p.tick).join(', ')}`);
console.log(`humanos: ${seated.join(' | ')}`);
console.log(`bots: ${botCount}`);

let failed = false;
const ticks = new Set(prints.map((p) => p.tick));
if (ticks.size > 1) {
  console.error('FAIL: los clientes no convergieron al mismo tick');
  failed = true;
} else if (new Set(prints.map((p) => p.units)).size > 1) {
  console.error(`FAIL: desincronización en el tick ${prints[0].tick}`);
  failed = true;
} else {
  console.log(`PASS: los cuatro mundos son idénticos en el tick ${prints[0].tick}`);
}

const expected = ['Ana:azul:top', 'Bruno:azul:jungle', 'Carla:rojo:mid', 'Diego:rojo:support'].sort();
if (JSON.stringify(seated) !== JSON.stringify(expected)) {
  console.error(`FAIL: puestos inesperados. Esperado ${expected.join(' | ')}`);
  failed = true;
} else {
  console.log('PASS: cada jugador en el equipo y la posición que eligió');
}
if (seated.length + botCount !== 10) {
  console.error(`FAIL: la partida no es 5 contra 5 (${seated.length} humanos + ${botCount} bots)`);
  failed = true;
} else {
  console.log(`PASS: 5 contra 5 completo — ${seated.length} humanos y ${botCount} bots`);
}

await host.screenshot({ path: `${OUT}/2-game.png` });
await browser.close();
if (errors.length) console.error('ERRORES:\n' + errors.slice(0, 10).join('\n'));
process.exit(failed ? 1 : 0);
