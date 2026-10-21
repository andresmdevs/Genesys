import { dist } from '../core/math.ts';
import { getChampion } from '../champions/index.ts';
import { attackReach, canAutoAttack, isImmobilised } from './combat.ts';
import { ATTACK_WINDUP, AUTO_ATTACK_PROJECTILE_SPEED, DT } from './constants.ts';
import { autoAttackDamage } from './combat.ts';
import type { Unit } from './types.ts';
import type { World } from './world.ts';

/** Distance below which a champion swings instead of firing a projectile. */
const MELEE_THRESHOLD = 320;
/** Each consecutive turret shot on the same target hits harder. */
const TOWER_RAMP_PER_SHOT = 0.4;
const TOWER_RAMP_MAX = 2;

/**
 * Drives auto-attacks for every unit that already has a target. Acquiring the
 * target is the job of `targeting.ts` and the AI modules; this only handles
 * the windup, the shot and the damage.
 */
export function stepAutoAttacks(world: World): void {
  for (const unit of world.units.values()) {
    if (!unit.alive) continue;
    if (unit.stats.attackSpeed <= 0 || unit.stats.ad <= 0) continue;

    if (unit.windup >= 0) {
      if (isImmobilised(unit) && unit.kind === 'champion') {
        // Hard crowd control cancels a swing in progress.
        unit.windup = -1;
        continue;
      }
      if (--unit.windup <= 0) {
        unit.windup = -1;
        fireAttack(world, unit);
      }
      continue;
    }

    if (unit.attackCooldown > 0 || unit.castLock > 0) continue;

    const target = world.living(unit.attackTargetId);
    if (!target || !canAutoAttack(unit, target)) continue;
    if (dist(unit.pos, target.pos) > attackReach(unit, target)) continue;

    const interval = 1 / Math.max(0.2, unit.stats.attackSpeed);
    unit.windup = Math.max(1, Math.round((interval * ATTACK_WINDUP) / DT));
    unit.attackCooldown = Math.max(1, Math.round(interval / DT));
    unit.facing = Math.atan2(target.pos.y - unit.pos.y, target.pos.x - unit.pos.x);
    unit.path.length = 0;
  }
}

function fireAttack(world: World, source: Unit): void {
  const target = world.living(source.attackTargetId);
  if (!target || !canAutoAttack(source, target)) return;
  // The target may have walked out of range during the windup.
  if (dist(source.pos, target.pos) > attackReach(source, target) + 150) return;

  const { amount, crit } = autoAttackDamage(source, world.rngNext());
  let damage = amount;

  if (source.kind === 'tower') {
    // Turrets reuse `invulnerableUntilTowerId` to remember their last target.
    const s = source.structure!;
    if (s.invulnerableUntilTowerId === target.id) {
      s.ramp = Math.min(TOWER_RAMP_MAX, s.ramp + 1);
    } else {
      s.ramp = 0;
      s.invulnerableUntilTowerId = target.id;
    }
    damage *= 1 + TOWER_RAMP_PER_SHOT * s.ramp;
  }

  const deliver = (): void => {
    const live = world.living(target.id);
    if (!live) return;
    const dealt = world.dealDamage({
      amount: damage,
      type: 'physical',
      sourceId: source.id,
      targetId: live.id,
      isAuto: true,
      isCrit: crit,
    });
    if (dealt > 0) onAutoAttackLanded(world, source, live, dealt);
  };

  const ranged = source.stats.attackRange >= MELEE_THRESHOLD;
  if (!ranged) {
    world.addFx({
      style: 'melee-swing',
      pos: { ...source.pos },
      to: { ...target.pos },
      life: 7,
      age: 0,
    });
    deliver();
    return;
  }

  world.spawnProjectile({
    team: source.team,
    ownerId: source.id,
    pos: { ...source.pos },
    dir: { x: Math.cos(source.facing), y: Math.sin(source.facing) },
    speed: source.kind === 'tower' ? 2800 : AUTO_ATTACK_PROJECTILE_SPEED,
    radius: 22,
    travelled: 0,
    maxDistance: source.stats.attackRange + 900,
    homingTargetId: target.id,
    pierce: false,
    hitIds: [],
    style: source.kind === 'tower' ? 'tower-bolt' : 'auto-bolt',
    onHit: () => deliver(),
  });
}

/** Runs the attacker's on-hit passive, if it has one. */
function onAutoAttackLanded(world: World, source: Unit, target: Unit, damage: number): void {
  if (source.champion) {
    const def = getChampion(source.champion.championId);
    def?.passive.onAutoAttackHit?.(world, source, target, damage);
  }
}

/** Clears an attack in progress, used when the unit receives a new order. */
export function cancelAttack(unit: Unit): void {
  unit.windup = -1;
}
