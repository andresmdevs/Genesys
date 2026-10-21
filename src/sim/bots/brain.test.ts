import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../../champions/index.ts';
import { BLUE, RED} from '../../data/map.ts';
import { TICK_RATE } from '../constants.ts';
import { POSITIONS } from '../positions.ts';
import { Match, type SlotConfig } from '../match.ts';

function allBotSlots(): SlotConfig[] {
  
  const out: SlotConfig[] = [];
  for (let i = 0; i < 5; i++) {
    out.push({
      slot: i,
      championId: CHAMPIONS[i].id,
      team: BLUE,
      position: POSITIONS[i],
      isBot: true,
      displayName: `Azul ${i}`,
    });
    out.push({
      slot: i + 5,
      championId: CHAMPIONS[i + 5].id,
      team: RED,
      position: POSITIONS[i],
      isBot: true,
      displayName: `Rojo ${i}`,
    });
  }
  return out;
}

describe('bot play', () => {
  it(
    'plays a complete game to a destroyed nexus',
    () => {
      const match = new Match({ seed: 7, slots: allBotSlots() });
      const limit = TICK_RATE * 60 * 40;
      let ticks = 0;
      while (match.world.winner === null && ticks < limit) {
        match.step();
        ticks++;
      }

      const minutes = ticks / TICK_RATE / 60;
      expect(match.world.winner, 'no team ever won').not.toBeNull();
      // A game that ends in two minutes means structures are made of paper;
      // one that never ends means bots cannot close.
      expect(minutes).toBeGreaterThan(8);
      // A game that drags past half an hour means bots cannot close.
      expect(minutes).toBeLessThan(32);

      const champs = match.champions;
      // Bots must actually play: spend gold, rank abilities, take creeps.
      expect(champs.every((c) => c.champion!.items.length >= 2)).toBe(true);
      expect(Math.max(...champs.map((c) => c.level))).toBeGreaterThanOrEqual(13);
      expect(Math.max(...champs.map((c) => c.champion!.creepScore))).toBeGreaterThan(40);

      const towersDown = [...match.world.units.values()].filter(
        (u) => u.kind === 'tower' && !u.alive,
      ).length;
      expect(towersDown).toBeGreaterThanOrEqual(8);
    },
    { timeout: 180000 },
  );

  it('sends the jungler to clear camps instead of standing in a lane', () => {
    const match = new Match({ seed: 21, slots: allBotSlots() });
    for (let i = 0; i < TICK_RATE * 300; i++) match.step();

    const junglers = match.champions.filter((c) => c.champion!.position === 'jungle');
    expect(junglers).toHaveLength(2);

    for (const jungler of junglers) {
      // Camp kills show up as creep score, same as minions.
      expect(jungler.champion!.creepScore, `${jungler.name} never cleared a camp`)
        .toBeGreaterThan(3);
    }

    // And at least one camp should be on respawn rather than all standing.
    const campsAlive = [...match.world.units.values()].filter(
      (u) => u.kind === 'monster' && u.alive && u.monster!.kind === 'camp',
    ).length;
    expect(campsAlive).toBeLessThan(12 * 3);
  });

  it('keeps bots out of their own fountain once the game is under way', () => {
    const match = new Match({ seed: 11, slots: allBotSlots() });
    for (let i = 0; i < TICK_RATE * 180; i++) match.step();
    const loitering = match.champions.filter(
      (c) => c.alive && c.hp > c.stats.maxHp * 0.9 && c.champion!.recallTicks < 0 &&
        Math.hypot(c.pos.x - 1150, c.pos.y - 1150) < 900,
    );
    expect(loitering.length, 'bots stuck in the fountain').toBe(0);
  });
});
