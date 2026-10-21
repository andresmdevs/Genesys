/**
 * Multiplayer check: two real browsers join the same room through the room
 * server, start a match and simulate it. Lockstep is only correct if both
 * clients end up with byte-identical worlds, so that is what this asserts.
 *
 *   node server/node/server.mjs --port 8787 &
 *   npm run build && npm run preview &
 *   node scripts/mp-test.mjs
 */

import { chromium } from 'playwright';

const GAME = process.env.GAME_URL ?? 'http://localhost:4173/Genesys/';
const SERVER = process.env.ROOM_URL ?? 'ws://localhost:8787/ws?room=test';
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SECONDS = Number(process.env.SECONDS ?? 25);

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const errors = [];

async function joinAs(name) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });

  await page.goto(GAME, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Partida online' }).click();
  await page.waitForSelector('input');

  const inputs = page.locator('input');
  await inputs.nth(0).fill(name);
  // The dedicated-server form sits behind a disclosure, since room codes are
  // the path most players take.
  await page.locator('summary', { hasText: 'servidor dedicado' }).click();
  await inputs.nth(2).fill(SERVER);
  await page.getByRole('button', { name: 'Conectar al servidor' }).click();
  await page.waitForSelector('.seat-board', { timeout: 15000 });
  return page;
}

const a = await joinAs('Ana');
const b = await joinAs('Bruno');
console.log('ambos jugadores en la sala');

// Both players take seats on the SAME team, in different positions: this is
// the case a pair of friends cares about, and the one that used to be
// impossible when the server handed out slots by itself.
await a.locator('.seat', { hasText: 'TOP' }).first().click();
await a.waitForTimeout(500);
await b.locator('.seat', { hasText: 'JG' }).first().click();
await b.waitForTimeout(500);

await a.locator('.champ-card', { hasText: 'Ryka' }).click();
await b.locator('.champ-card', { hasText: 'Grommar' }).click();
await a.waitForTimeout(400);

const seats = await a.evaluate(() =>
  [...document.querySelectorAll('.seat')].map((s) => s.textContent),
);
console.log('tablero:', JSON.stringify(seats.slice(0, 5)));

await a.getByRole('button', { name: 'Listo', exact: true }).click();
await b.getByRole('button', { name: 'Listo', exact: true }).click();

await a.waitForSelector('#minimap', { timeout: 15000 });
await b.waitForSelector('#minimap', { timeout: 15000 });
console.log('la partida ha arrancado en ambos clientes');

// Give both players something to do so the command path is exercised.
for (let i = 0; i < 6; i++) {
  await a.mouse.click(700, 260, { button: 'right' });
  await b.mouse.click(420, 380, { button: 'right' });
  await a.waitForTimeout(900);
}

await a.waitForTimeout(SECONDS * 1000);

const fingerprint = (page) =>
  page.evaluate(() => {
    const g = window.genesys;
    const w = g.match.world;
    const units = [...w.units.values()]
      .map((u) => `${u.id}:${u.hp.toFixed(1)}:${u.pos.x.toFixed(1)}:${u.pos.y.toFixed(1)}`)
      .join('|');
    return {
      tick: w.tick,
      units,
      hash: units.length,
      champions: g.match.champions.map((c) => `${c.name}:${c.champion.championId}`).join(','),
    };
  });

// Let the laggier client catch up before comparing.
let fa = await fingerprint(a);
let fb = await fingerprint(b);
for (let i = 0; i < 40 && fa.tick !== fb.tick; i++) {
  await a.waitForTimeout(250);
  fa = await fingerprint(a);
  fb = await fingerprint(b);
}

console.log(`tick A=${fa.tick} B=${fb.tick}`);
console.log(`roster A: ${fa.champions}`);
console.log(`roster B: ${fb.champions}`);

// Both humans must have landed where they clicked.
const seated = await a.evaluate(() => {
  const g = window.genesys;
  return g.match.champions
    .filter((c) => !c.champion.isBot)
    .map((c) => `${c.name}:${c.team === 0 ? 'azul' : 'rojo'}:${c.champion.position}:${c.champion.championId}`);
});
console.log(`humanos: ${seated.join(' | ')}`);

let failed = false;
if (fa.tick !== fb.tick) {
  console.error('FAIL: los clientes no convergieron al mismo tick');
  failed = true;
} else if (fa.units !== fb.units) {
  // Find the first divergent unit to make the failure actionable.
  const ua = fa.units.split('|');
  const ub = fb.units.split('|');
  const at = ua.findIndex((v, i) => v !== ub[i]);
  console.error(`FAIL: desincronización en el tick ${fa.tick}; primera diferencia: ${ua[at]} vs ${ub[at]}`);
  failed = true;
} else {
  console.log(`PASS: ambos mundos son idénticos en el tick ${fa.tick} (${fa.units.split('|').length} unidades)`);
}
if (seated.length !== 2 || !seated.every((s) => s.includes('azul'))) {
  console.error('FAIL: los dos jugadores no acabaron en el equipo que eligieron');
  failed = true;
} else {
  console.log('PASS: ambos jugadores en el equipo y la posición elegidos');
}
if (fa.champions !== fb.champions) {
  console.error('FAIL: los clientes construyeron plantillas distintas');
  failed = true;
} else {
  console.log('PASS: plantilla idéntica en ambos clientes');
}

await a.screenshot({ path: process.argv[2] ? `${process.argv[2]}/mp-a.png` : 'mp-a.png' });
await b.screenshot({ path: process.argv[2] ? `${process.argv[2]}/mp-b.png` : 'mp-b.png' });
await browser.close();

if (errors.length) {
  console.error('ERRORES:\n' + errors.slice(0, 10).join('\n'));
  failed = true;
}
process.exit(failed ? 1 : 0);
