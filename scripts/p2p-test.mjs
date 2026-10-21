/**
 * Peer-to-peer check: one browser hosts a room, another joins with the code,
 * both take seats on the same team and the match is simulated. Lockstep is
 * only correct if the two worlds stay identical, so that is the assertion.
 *
 *   npm run build && npm run preview &
 *   node scripts/p2p-test.mjs [screenshotDir]
 *
 * PEER_HOST / PEER_PORT / PEER_PATH point at a local PeerServer instead of
 * the public broker.
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const GAME = process.env.GAME_URL ?? 'http://localhost:4173/Genesys/';
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.argv[2] ?? 'p2p-shots';
const SECONDS = Number(process.env.SECONDS ?? 20);

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  // Headless Chromium hides local IPs behind mDNS, which never resolves
  // between two processes in a container.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});

const errors = [];
async function open(label) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label}: ${m.text()}`);
  });
  await page.goto(GAME, { waitUntil: 'networkidle' });
  // Point PeerJS at a local broker when one is configured.
  if (process.env.PEER_HOST) {
    await page.evaluate(
      (cfg) => {
        window.__genesysPeer = cfg;
      },
      {
        host: process.env.PEER_HOST,
        port: Number(process.env.PEER_PORT ?? 9000),
        path: process.env.PEER_PATH ?? '/',
        secure: false,
      },
    );
  }
  await page.getByRole('button', { name: 'Partida online' }).click();
  await page.waitForSelector('input');
  return page;
}

const host = await open('host');
await host.locator('input').first().fill('Ana');
await host.getByRole('button', { name: 'Crear sala' }).click();
await host.waitForSelector('.room-code-value', { timeout: 30000 });
const code = (await host.locator('.room-code-value').textContent()).trim();
console.log(`sala creada: ${code}`);
await host.screenshot({ path: `${OUT}/1-host-lobby.png` });

const guest = await open('guest');
await guest.locator('input').first().fill('Bruno');
await guest.locator('input').nth(1).fill(code);
await guest.getByRole('button', { name: 'Unirse' }).click();
await guest.waitForSelector('.seat-board', { timeout: 30000 });
console.log('invitado dentro de la sala');

// Both take seats on the blue side, in different positions.
await host.locator('.seat', { hasText: 'TOP' }).first().click();
await host.waitForTimeout(600);
await guest.locator('.seat', { hasText: 'MID' }).first().click();
await guest.waitForTimeout(600);
await host.locator('.champ-card', { hasText: 'Ryka' }).click();
await guest.locator('.champ-card', { hasText: 'Ysolde' }).click();
await host.waitForTimeout(500);
await guest.screenshot({ path: `${OUT}/2-guest-lobby.png` });

// The lobby must agree with the seat that was actually taken.
const guestSays = (await guest.locator('.detail p').first().textContent()).trim();
console.log(`el invitado cree estar en: ${guestSays}`);
const seatOk = guestSays.includes('azul') && guestSays.includes('Central');
if (!seatOk) {
  console.error(`FAIL: la sala muestra un puesto equivocado para el invitado: ${guestSays}`);
}

await host.getByRole('button', { name: 'Listo', exact: true }).click();
await guest.getByRole('button', { name: 'Listo', exact: true }).click();

await host.waitForSelector('#minimap', { timeout: 30000 });
await guest.waitForSelector('#minimap', { timeout: 30000 });
console.log('partida arrancada en ambos');

// Measure how fast the simulation actually advances. A host whose tick clock
// is throttled by the browser slows the game down for everyone in the room.
const tickOf = (page) => page.evaluate(() => window.genesys.match.world.tick);
const before = await tickOf(host);
const t0 = Date.now();
for (let i = 0; i < 5; i++) {
  await host.mouse.click(700, 280, { button: 'right' });
  await guest.mouse.click(430, 400, { button: 'right' });
  await host.waitForTimeout(900);
}
await host.waitForTimeout(SECONDS * 1000);
const after = await tickOf(host);
const rate = ((after - before) / (Date.now() - t0)) * 1000;
console.log(`ritmo: ${rate.toFixed(1)} ticks/s (objetivo 30)`);

const fingerprint = (page) =>
  page.evaluate(() => {
    const w = window.genesys.match.world;
    const units = [...w.units.values()]
      .map((u) => `${u.id}:${u.hp.toFixed(1)}:${u.pos.x.toFixed(1)}:${u.pos.y.toFixed(1)}`)
      .join('|');
    return { tick: w.tick, units };
  });

let fa = await fingerprint(host);
let fb = await fingerprint(guest);
for (let i = 0; i < 40 && fa.tick !== fb.tick; i++) {
  await host.waitForTimeout(250);
  fa = await fingerprint(host);
  fb = await fingerprint(guest);
}

const seated = await host.evaluate(() =>
  window.genesys.match.champions
    .filter((c) => !c.champion.isBot)
    .map((c) => `${c.name}:${c.team === 0 ? 'azul' : 'rojo'}:${c.champion.position}`),
);

console.log(`tick anfitrión=${fa.tick} invitado=${fb.tick}`);
console.log(`humanos: ${seated.join(' | ')}`);

let failed = !seatOk;
if (fa.tick !== fb.tick) {
  console.error('FAIL: los clientes no convergieron al mismo tick');
  failed = true;
} else if (fa.units !== fb.units) {
  console.error(`FAIL: desincronización en el tick ${fa.tick}`);
  failed = true;
} else {
  console.log(`PASS: mundos idénticos en el tick ${fa.tick} sin ningún servidor propio`);
}
if (rate < 22) {
  console.error(`FAIL: la simulación va a ${rate.toFixed(1)} ticks/s, demasiado lenta`);
  failed = true;
} else {
  console.log('PASS: la partida avanza a ritmo real');
}
if (seated.length !== 2) {
  console.error('FAIL: no hay dos jugadores humanos en la partida');
  failed = true;
} else {
  console.log('PASS: dos jugadores humanos, el resto bots');
}

await host.screenshot({ path: `${OUT}/3-host-game.png` });
await guest.screenshot({ path: `${OUT}/4-guest-game.png` });
await browser.close();

if (errors.length) {
  console.error('ERRORES:\n' + errors.slice(0, 10).join('\n'));
}
process.exit(failed ? 1 : 0);
