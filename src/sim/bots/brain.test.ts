import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../../champions/index.ts';
import { BLUE, RED, type LaneId } from '../../data/map.ts';
import { TICK_RATE } from '../constants.ts';
import { Match, type SlotConfig } from '../match.ts';

function allBotSlots(): SlotConfig[] {
  const lanes: LaneId[] = [0, 1, 1, 2, 2];
  const out: SlotConfig[] = [];
  for (let i = 0; i < 5; i++) {
    out.push({
      slot: i,
      championId: CHAMPIONS[i].id,
      team: BLUE,
      lane: lanes[i],
      isBot: true,
      displayName: `Azul ${i}`,
    });
    out.push({
      slot: i + 5,
      championId: CHAMPIONS[i + 5].id,
      team: RED,
      lane: lanes[i],
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
      expect(minutes).toBeLessThan(40);

      const champs = match.champions;
      // Bots must actually play: spend gold, rank abilities, take creeps.
      expect(champs.every((c) => c.champion!.items.length >= 2)).toBe(true);
      expect(Math.max(...champs.map((c) => c.level))).toBeGreaterThanOrEqual(13);
      expect(Math.max(...champs.map((c) => c.champion!.creepScore))).toBeGreaterThan(40);

      const towersDown = [...match.world.units.values()].filter(
        (u) => u.kind === 'tower' && !u.alive,
      ).length;
      expect(towersDown).toBeGreaterThanOrEqual(5);
    },
    { timeout: 180000 },
  );

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
