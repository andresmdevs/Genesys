import { BASE_CRIT_DAMAGE } from './constants.ts';
import type { Growth, StatBlock, Unit } from './types.ts';

export const ZERO_STATS: StatBlock = {
  maxHp: 0,
  hpRegen: 0,
  maxMana: 0,
  manaRegen: 0,
  ad: 0,
  ap: 0,
  armor: 0,
  mr: 0,
  attackSpeed: 0,
  moveSpeed: 0,
  attackRange: 0,
  critChance: 0,
  critDamage: 0,
  lifesteal: 0,
  spellVamp: 0,
  haste: 0,
  tenacity: 0,
  armorPenFlat: 0,
  armorPenPct: 0,
  magicPenFlat: 0,
  magicPenPct: 0,
  damageDealt: 1,
  damageTaken: 1,
};

export const ZERO_GROWTH: Growth = {
  maxHp: 0,
  hpRegen: 0,
  maxMana: 0,
  manaRegen: 0,
  ad: 0,
  armor: 0,
  mr: 0,
  attackSpeed: 0,
};

export function makeStats(partial: Partial<StatBlock>): StatBlock {
  return { ...ZERO_STATS, critDamage: BASE_CRIT_DAMAGE, ...partial };
}

export function makeGrowth(partial: Partial<Growth>): Growth {
  return { ...ZERO_GROWTH, ...partial };
}

const STAT_KEYS = Object.keys(ZERO_STATS) as (keyof StatBlock)[];
/** Multiplicative stats start at 1, so they are combined differently. */
const MULTIPLIERS = new Set<keyof StatBlock>(['damageDealt', 'damageTaken']);

/**
 * Recomputes `unit.stats` from base values, per-level growth, item bonuses and
 * every active effect. Called whenever something that feeds it changes, and
 * once per tick for units carrying timed effects.
 */
export function recomputeStats(unit: Unit): void {
  const out = unit.stats;
  const levels = unit.level - 1;

  for (const key of STAT_KEYS) {
    out[key] = MULTIPLIERS.has(key) ? 1 : unit.base[key];
  }

  // Growth is linear per level; attack speed grows as a fraction of its base.
  out.maxHp += unit.growth.maxHp * levels;
  out.hpRegen += unit.growth.hpRegen * levels;
  out.maxMana += unit.growth.maxMana * levels;
  out.manaRegen += unit.growth.manaRegen * levels;
  out.ad += unit.growth.ad * levels;
  out.armor += unit.growth.armor * levels;
  out.mr += unit.growth.mr * levels;
  const attackSpeedGrowth = unit.base.attackSpeed * unit.growth.attackSpeed * levels;

  let bonusAttackSpeed = attackSpeedGrowth;

  for (const key of STAT_KEYS) {
    const v = unit.itemStats[key];
    if (v === undefined) continue;
    if (MULTIPLIERS.has(key)) out[key] *= v;
    else if (key === 'attackSpeed') bonusAttackSpeed += unit.base.attackSpeed * v;
    else out[key] += v;
  }

  for (const effect of unit.effects) {
    if (!effect.stats) continue;
    const scale = effect.stacks ?? 1;
    for (const key of STAT_KEYS) {
      const v = effect.stats[key];
      if (v === undefined) continue;
      if (MULTIPLIERS.has(key)) out[key] *= Math.pow(v, scale);
      else if (key === 'attackSpeed') bonusAttackSpeed += unit.base.attackSpeed * v * scale;
      else out[key] += v * scale;
    }
  }

  out.attackSpeed += bonusAttackSpeed;

  // Slows and movement buffs are stored as effects rather than stat deltas so
  // that only the strongest slow applies, the way players expect.
  let strongestSlow = 0;
  let hasteSum = 0;
  for (const effect of unit.effects) {
    if (effect.kind === 'slow') strongestSlow = Math.max(strongestSlow, effect.value);
    else if (effect.kind === 'haste') hasteSum += effect.value;
  }
  out.moveSpeed *= 1 + hasteSum;
  if (strongestSlow > 0) {
    out.moveSpeed *= Math.max(0.15, 1 - strongestSlow * (1 - unit.base.tenacity * 0.4));
  }

  out.attackSpeed = Math.min(out.attackSpeed, 2.5);
  out.moveSpeed = Math.max(60, Math.min(out.moveSpeed, 1100));
  out.critChance = Math.max(0, Math.min(1, out.critChance));
  out.tenacity = Math.max(0, Math.min(0.8, out.tenacity));
  out.armorPenPct = Math.max(0, Math.min(0.5, out.armorPenPct));
  out.magicPenPct = Math.max(0, Math.min(0.5, out.magicPenPct));
}

/** Ability haste shortens cooldowns with diminishing returns by construction. */
export const cooldownMultiplier = (haste: number): number => 100 / (100 + Math.max(0, haste));

/** Seconds between auto-attacks. */
export const attackInterval = (unit: Unit): number => 1 / Math.max(0.2, unit.stats.attackSpeed);

export const hpFraction = (unit: Unit): number =>
  unit.stats.maxHp > 0 ? unit.hp / unit.stats.maxHp : 0;

export const manaFraction = (unit: Unit): number =>
  unit.stats.maxMana > 0 ? unit.mana / unit.stats.maxMana : 1;

/** Total shield points currently absorbing damage. */
export function shieldAmount(unit: Unit): number {
  let total = 0;
  for (const e of unit.effects) if (e.kind === 'shield') total += e.value;
  return total;
}
