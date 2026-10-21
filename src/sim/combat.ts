import { resistMultiplier } from './constants.ts';
import type { DamageType, Unit } from './types.ts';

/**
 * Converts a raw damage number into the amount that actually lands, after
 * penetration, resistances and the attacker's and defender's damage
 * multipliers. Shields are handled by the world when the damage is applied.
 */
export function mitigate(
  raw: number,
  type: DamageType,
  source: Unit | undefined,
  target: Unit,
): number {
  let amount = raw;
  if (source) amount *= source.stats.damageDealt;
  amount *= target.stats.damageTaken;

  if (type === 'true') return Math.max(0, amount);

  const isPhysical = type === 'physical';
  const resistBase = isPhysical ? target.stats.armor : target.stats.mr;
  const penPct = source ? (isPhysical ? source.stats.armorPenPct : source.stats.magicPenPct) : 0;
  const penFlat = source ? (isPhysical ? source.stats.armorPenFlat : source.stats.magicPenFlat) : 0;

  // Percentage penetration applies first, then flat, and flat never pushes a
  // positive resistance below zero.
  let effective = resistBase * (1 - penPct);
  effective = effective >= 0 ? Math.max(0, effective - penFlat) : effective;

  return Math.max(0, amount * resistMultiplier(effective));
}

/** Damage of one auto-attack before mitigation, including a crit roll. */
export function autoAttackDamage(source: Unit, roll: number): { amount: number; crit: boolean } {
  const crit = roll < source.stats.critChance;
  const amount = source.stats.ad * (crit ? source.stats.critDamage : 1);
  return { amount, crit };
}

/** True when `source` can legally auto-attack `target` right now. */
export function canAutoAttack(source: Unit, target: Unit): boolean {
  if (!source.alive || !target.alive) return false;
  if (source.team === target.team) return false;
  if (hasEffect(source, 'disarm') || hasEffect(source, 'stun') || hasEffect(source, 'airborne')) {
    return false;
  }
  if (hasEffect(target, 'untargetable') || hasEffect(target, 'invulnerable')) return false;
  return true;
}

export function hasEffect(unit: Unit, kind: string): boolean {
  for (const e of unit.effects) if (e.kind === kind) return true;
  return false;
}

/** Movement is blocked by hard crowd control and by cast locks. */
export function isImmobilised(unit: Unit): boolean {
  return (
    hasEffect(unit, 'stun') ||
    hasEffect(unit, 'root') ||
    hasEffect(unit, 'airborne') ||
    unit.displacement !== null
  );
}

export function canCastSpells(unit: Unit): boolean {
  return !hasEffect(unit, 'stun') && !hasEffect(unit, 'silence') && !hasEffect(unit, 'airborne');
}

export function isTargetable(unit: Unit): boolean {
  return unit.alive && !hasEffect(unit, 'untargetable');
}

/** Hidden units cannot be auto-attacked or targeted by click-to-cast spells. */
export function isVisibleToEnemies(unit: Unit): boolean {
  if (hasEffect(unit, 'reveal')) return true;
  return !hasEffect(unit, 'stealth');
}

/** Distance at which `source` can start an auto-attack on `target`. */
export const attackReach = (source: Unit, target: Unit): number =>
  source.stats.attackRange + target.radius;

/** Crowd-control duration after the target's tenacity is applied. */
export const applyTenacity = (durationTicks: number, target: Unit): number =>
  Math.max(1, Math.round(durationTicks * (1 - target.stats.tenacity)));
