import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../champions/index.ts';
import { ABILITY_KEYS, type AbilityKey } from './types.ts';
import { BLUE, LANES, RED, type LaneId, type Team } from '../data/map.ts';
import { Match, type SlotConfig } from './match.ts';
import { TICK_RATE } from './constants.ts';

function buildSlots(): SlotConfig[] {
  const roles: LaneId[] = [0, 1, 1, 2, 2];
  return CHAMPIONS.flatMap((def, i) =>
    ([BLUE, RED] as Team[]).map((team) => ({
      slot: team === BLUE ? i : i + 10,
      championId: def.id,
      team,
      lane: roles[i % roles.length],
      isBot: true,
      displayName: `${def.name}-${team}`,
    })),
  );
}

/** Ten champions, five a side, mirrored so both teams have the same kits. */
function tenSlots(): SlotConfig[] {
  const picks = CHAMPIONS.slice(0, 5).map((c) => c.id);
  const lanes: LaneId[] = [0, 1, 1, 2, 2];
  const out: SlotConfig[] = [];
  for (let i = 0; i < 5; i++) {
    out.push({
      slot: i,
      championId: picks[i],
      team: BLUE,
      lane: lanes[i],
      isBot: true,
      displayName: `Azul ${i}`,
    });
    out.push({
      slot: i + 5,
      championId: CHAMPIONS[5 + i].id,
      team: RED,
      lane: lanes[i],
      isBot: true,
      displayName: `Rojo ${i}`,
    });
  }
  return out;
}

describe('champion definitions', () => {
  it('ships ten champions, two for every role', () => {
    expect(CHAMPIONS).toHaveLength(10);
    const counts = new Map<string, number>();
    for (const c of CHAMPIONS) counts.set(c.role, (counts.get(c.role) ?? 0) + 1);
    expect([...counts.entries()].sort()).toEqual([
      ['adc', 2],
      ['mage', 2],
      ['mid', 2],
      ['support', 2],
      ['top', 2],
    ]);
  });

  it('gives every ability enough ranks of cooldown and cost data', () => {
    for (const c of CHAMPIONS) {
      for (const key of ABILITY_KEYS) {
        const a = c.abilities[key];
        const ranks = a.maxRank ?? (a.isUltimate ? 3 : 5);
        expect(a.cooldown.length, `${c.id}.${key} cooldown`).toBeGreaterThanOrEqual(ranks);
        expect(a.cost.length, `${c.id}.${key} cost`).toBeGreaterThanOrEqual(ranks);
        expect(a.key).toBe(key);
      }
      // A full skill order is 18 picks, one per level.
      expect(c.skillOrder.length, `${c.id} skill order`).toBe(18);
      expect(c.buildOrder.length, `${c.id} build order`).toBeGreaterThan(3);
    }
  });

  it('uses only item ids that exist in the shop', async () => {
    const { getItem } = await import('../data/items.ts');
    for (const c of CHAMPIONS) {
      for (const id of c.buildOrder) {
        expect(getItem(id), `${c.id} buys unknown item ${id}`).toBeDefined();
      }
    }
  });
});

describe('match simulation', () => {
  it('runs several minutes without throwing and spawns waves', () => {
    const match = new Match({ seed: 1234, slots: tenSlots() });
    for (let i = 0; i < TICK_RATE * 240; i++) match.step();

    const minions = [...match.world.units.values()].filter((u) => u.kind === 'minion' && u.alive);
    expect(minions.length).toBeGreaterThan(0);
    // Both teams should have fielded minions in all three lanes.
    for (const lane of LANES) {
      expect(minions.some((m) => m.minion!.lane === lane && m.team === BLUE)).toBe(true);
      expect(minions.some((m) => m.minion!.lane === lane && m.team === RED)).toBe(true);
    }
    expect(match.world.winner).toBeNull();
  });

  it('keeps every unit on walkable terrain', async () => {
    const { isWalkable } = await import('./navgrid.ts');
    const match = new Match({ seed: 77, slots: tenSlots() });
    for (let i = 0; i < TICK_RATE * 120; i++) match.step();
    for (const u of match.world.units.values()) {
      if (!u.alive || u.isStatic) continue;
      expect(isWalkable(u.pos), `${u.name} #${u.id} left the map`).toBe(true);
    }
  });

  it('pays passive gold and lets minions trade kills', () => {
    const match = new Match({ seed: 5, slots: tenSlots() });
    for (let i = 0; i < TICK_RATE * 150; i++) match.step();
    for (const champ of match.champions) {
      // Lifetime earnings, not the purse: bots spend theirs in the shop.
      expect(champ.champion!.totalGold).toBeGreaterThan(500);
      expect(champ.champion!.gold).toBeGreaterThanOrEqual(0);
    }
    // Waves meeting in the middle must actually kill each other.
    const deadMinions = [...match.world.units.values()].filter(
      (u) => u.kind === 'minion' && !u.alive,
    );
    expect(deadMinions.length + match.world.feed.length).toBeGreaterThan(0);
  });

  it('casts every ability of every champion without throwing', () => {
    for (const def of CHAMPIONS) {
      const match = new Match({
        seed: 99,
        slots: [
          { slot: 0, championId: def.id, team: BLUE, lane: 1, isBot: false, displayName: 'A' },
          {
            slot: 1,
            championId: CHAMPIONS[(CHAMPIONS.indexOf(def) + 1) % CHAMPIONS.length].id,
            team: RED,
            lane: 1,
            isBot: false,
            displayName: 'B',
          },
        ],
      });

      const caster = match.championOf(0)!;
      const victim = match.championOf(1)!;
      // Put them next to each other, at max level, with everything unlocked.
      caster.level = 18;
      victim.level = 18;
      caster.pos = { x: 7000, y: 7000 };
      victim.pos = { x: 7260, y: 7000 };
      caster.champion!.skillPoints = 18;
      for (const key of ABILITY_KEYS) {
        const slot = caster.champion!.abilities[key];
        slot.rank = def.abilities[key].isUltimate ? 3 : 5;
      }
      caster.mana = 9999;
      caster.stats.maxMana = 9999;

      for (const key of ABILITY_KEYS) {
        caster.champion!.abilities[key].cooldown = 0;
        caster.mana = 9999;
        expect(
          () => match.castAbility(caster, key as AbilityKey, { ...victim.pos }, victim.id),
          `${def.id}.${key} threw`,
        ).not.toThrow();
        // Let the projectiles, zones and delayed hits resolve.
        for (let i = 0; i < TICK_RATE * 3; i++) match.step();
      }
    }
  });

  it('ends when a nexus falls', () => {
    const match = new Match({ seed: 42, slots: tenSlots() });
    const redNexus = [...match.world.units.values()].find(
      (u) => u.kind === 'nexus' && u.team === RED,
    )!;
    match.world.killUnit(redNexus, undefined);
    match.step();
    expect(match.world.winner).toBe(BLUE);
  });

  it('produces an identical world from an identical seed', () => {
    const fingerprint = (seed: number): string => {
      const m = new Match({ seed, slots: tenSlots() });
      for (let i = 0; i < TICK_RATE * 90; i++) m.step();
      return [...m.world.units.values()]
        .map((u) => `${u.id}:${u.hp.toFixed(2)}:${u.pos.x.toFixed(2)}:${u.pos.y.toFixed(2)}`)
        .join('|');
    };
    expect(fingerprint(2024)).toBe(fingerprint(2024));
  });

  it('diverges between seeds once something actually rolls the dice', () => {
    // Minion waves and turret behaviour are deliberately deterministic, so the
    // seed only shows up where a roll happens - here, critical strikes.
    const duelHp = (seed: number): number => {
      const m = new Match({
        seed,
        slots: [
          { slot: 0, championId: 'ryka', team: BLUE, lane: 1, isBot: false, displayName: 'A' },
          { slot: 1, championId: 'korvath', team: RED, lane: 1, isBot: false, displayName: 'B' },
        ],
      });
      const attacker = m.championOf(0)!;
      const victim = m.championOf(1)!;
      attacker.pos = { x: 7000, y: 7000 };
      victim.pos = { x: 7300, y: 7000 };
      attacker.itemStats = { critChance: 0.5 };
      attacker.attackTargetId = victim.id;
      victim.base.hpRegen = 0;
      for (let i = 0; i < TICK_RATE * 8; i++) {
        attacker.attackTargetId = victim.id;
        m.step();
      }
      return victim.hp;
    };
    expect(duelHp(2024)).toBe(duelHp(2024));
    expect(duelHp(2024)).not.toBe(duelHp(777));
  });
});

describe('slot layout helper', () => {
  it('builds two mirrored teams', () => {
    const slots = buildSlots();
    expect(slots.filter((s) => s.team === BLUE)).toHaveLength(10);
    expect(slots.filter((s) => s.team === RED)).toHaveLength(10);
  });
});
