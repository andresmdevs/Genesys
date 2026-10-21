/**
 * Building blocks shared by the champion kits. Keeping skillshots, zones and
 * crowd control in one place means a new champion is mostly data.
 */

import { dist, normalize, type Vec2 } from '../core/math.ts';
import { applyTenacity } from '../sim/combat.ts';
import { secToTicks } from '../sim/constants.ts';
import type {
  DamageType,
  Effect,
  Projectile,
  Unit,
  WorldLike,
  Zone,
} from '../sim/types.ts';

/** Per-rank value lookup that tolerates a short array. */
export const byRank = (values: number[], rank: number): number =>
  values[Math.min(values.length - 1, Math.max(0, rank - 1))];

/** Attack damage above the champion's base, which most ratios scale from. */
export const bonusAd = (unit: Unit): number => unit.stats.ad - unit.base.ad;

export interface ScaledDamage {
  /** Flat value per rank. */
  base: number[];
  /** Ratio on ability power. */
  ap?: number;
  /** Ratio on total attack damage. */
  ad?: number;
  /** Ratio on bonus attack damage. */
  bonusAd?: number;
  /** Ratio on the caster's maximum health. */
  maxHp?: number;
}

export function resolveDamage(caster: Unit, rank: number, scale: ScaledDamage): number {
  let out = byRank(scale.base, rank);
  if (scale.ap) out += caster.stats.ap * scale.ap;
  if (scale.ad) out += caster.stats.ad * scale.ad;
  if (scale.bonusAd) out += bonusAd(caster) * scale.bonusAd;
  if (scale.maxHp) out += caster.stats.maxHp * scale.maxHp;
  return out;
}

/* ------------------------------------------------------------------ *
 * Crowd control and buffs
 * ------------------------------------------------------------------ */

type CcKind = Extract<Effect['kind'], 'stun' | 'root' | 'silence' | 'disarm' | 'airborne'>;

export function applyCc(
  world: WorldLike,
  targetId: number,
  sourceId: number,
  kind: CcKind,
  seconds: number,
  tag: string = kind,
): void {
  const target = world.getUnit(targetId);
  if (!target) return;
  // Structures are immune, and epic monsters only ever get a clipped version.
  if (target.isStatic) return;
  if (target.monster && target.monster.kind !== 'camp') seconds *= 0.4;
  const ticks = applyTenacity(secToTicks(seconds), target);
  world.applyEffect(targetId, {
    kind,
    tag,
    sourceId,
    endsTick: world.tick + ticks,
    value: 1,
  });
  world.addFx({ style: `cc-${kind}`, pos: { ...target.pos }, life: Math.min(40, ticks), age: 0 });
}

export function applySlow(
  world: WorldLike,
  targetId: number,
  sourceId: number,
  fraction: number,
  seconds: number,
  tag = 'slow',
): void {
  const target = world.getUnit(targetId);
  if (!target || target.isStatic) return;
  world.applyEffect(targetId, {
    kind: 'slow',
    tag,
    sourceId,
    endsTick: world.tick + applyTenacity(secToTicks(seconds), target),
    value: fraction,
  });
}

export function applyHaste(
  world: WorldLike,
  targetId: number,
  sourceId: number,
  fraction: number,
  seconds: number,
  tag = 'haste',
): void {
  world.applyEffect(targetId, {
    kind: 'haste',
    tag,
    sourceId,
    endsTick: world.tick + secToTicks(seconds),
    value: fraction,
  });
}

export function applyShield(
  world: WorldLike,
  targetId: number,
  sourceId: number,
  amount: number,
  seconds: number,
  tag = 'shield',
): void {
  world.applyEffect(targetId, {
    kind: 'shield',
    tag,
    sourceId,
    endsTick: world.tick + secToTicks(seconds),
    value: amount,
  });
  const target = world.getUnit(targetId);
  if (target) {
    world.addFx({ style: 'shield-up', pos: { ...target.pos }, radius: target.radius * 2, life: 18, age: 0 });
  }
}

export function applyDot(
  world: WorldLike,
  targetId: number,
  sourceId: number,
  perTick: number,
  seconds: number,
  tag: string,
  damageType: DamageType = 'magic',
  maxStacks = 1,
): void {
  world.applyEffect(targetId, {
    kind: 'dot',
    tag,
    sourceId,
    endsTick: world.tick + secToTicks(seconds),
    value: perTick,
    damageType,
    period: secToTicks(0.5),
    stacks: 1,
    maxStacks,
  });
}

export function applyStatBuff(
  world: WorldLike,
  targetId: number,
  sourceId: number,
  stats: Effect['stats'],
  seconds: number,
  tag: string,
): void {
  world.applyEffect(targetId, {
    kind: 'stat',
    tag,
    sourceId,
    endsTick: world.tick + secToTicks(seconds),
    value: 1,
    stats,
  });
}

/* ------------------------------------------------------------------ *
 * Area damage
 * ------------------------------------------------------------------ */

export interface AreaOptions {
  type?: DamageType;
  label?: string;
  /** Called for every enemy struck, after the damage lands. */
  onHit?: (target: Unit, dealt: number) => void;
  /** Restrict which enemies are eligible. */
  filter?: (target: Unit) => boolean;
  includeStructures?: boolean;
}

/** Damages every enemy inside a circle and returns how many were hit. */
export function damageCircle(
  world: WorldLike,
  caster: Unit,
  centre: Vec2,
  radius: number,
  amount: number,
  opts: AreaOptions = {},
): number {
  let hits = 0;
  for (const target of world.enemiesOf(caster.team, centre, radius)) {
    if (!opts.includeStructures && target.isStatic) continue;
    if (opts.filter && !opts.filter(target)) continue;
    const dealt = world.dealDamage({
      amount,
      type: opts.type ?? 'magic',
      sourceId: caster.id,
      targetId: target.id,
      isAuto: false,
      isCrit: false,
      label: opts.label,
    });
    opts.onHit?.(target, dealt);
    hits++;
  }
  return hits;
}

/** Extra search radius so large units clipping the cone edge still register. */
const CONE_SEARCH_SLACK = 220;

/** Damages enemies inside a cone centred on `facing`. */
export function damageCone(
  world: WorldLike,
  caster: Unit,
  facing: number,
  halfAngle: number,
  range: number,
  amount: number,
  opts: AreaOptions = {},
): number {
  let hits = 0;
  for (const target of world.enemiesOf(caster.team, caster.pos, range + CONE_SEARCH_SLACK)) {
    if (!opts.includeStructures && target.isStatic) continue;
    if (opts.filter && !opts.filter(target)) continue;
    const dx = target.pos.x - caster.pos.x;
    const dy = target.pos.y - caster.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > range + target.radius) continue;
    let delta = Math.abs(Math.atan2(dy, dx) - facing) % (Math.PI * 2);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta > halfAngle + Math.atan2(target.radius, Math.max(d, 1))) continue;

    const dealt = world.dealDamage({
      amount,
      type: opts.type ?? 'magic',
      sourceId: caster.id,
      targetId: target.id,
      isAuto: false,
      isCrit: false,
      label: opts.label,
    });
    opts.onHit?.(target, dealt);
    hits++;
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * Skillshots
 * ------------------------------------------------------------------ */

export interface SkillshotOptions {
  speed: number;
  width: number;
  range: number;
  style: string;
  pierce?: boolean;
  /** Fire toward this point instead of the caster's facing. */
  towards: Vec2;
  onHit: (world: WorldLike, projectile: Projectile, target: Unit) => void;
  onExpire?: (world: WorldLike, projectile: Projectile) => void;
  /** Skillshots ignore structures unless this is set. */
  hitStructures?: boolean;
}

export function fireSkillshot(
  world: WorldLike,
  caster: Unit,
  opts: SkillshotOptions,
): Projectile {
  const dir = normalize({
    x: opts.towards.x - caster.pos.x,
    y: opts.towards.y - caster.pos.y,
  });
  const heading = dir.x === 0 && dir.y === 0 ? { x: Math.cos(caster.facing), y: Math.sin(caster.facing) } : dir;

  return world.spawnProjectile({
    team: caster.team,
    ownerId: caster.id,
    pos: { x: caster.pos.x + heading.x * caster.radius, y: caster.pos.y + heading.y * caster.radius },
    dir: heading,
    speed: opts.speed,
    radius: opts.width,
    travelled: 0,
    maxDistance: opts.range,
    homingTargetId: -1,
    pierce: opts.pierce ?? false,
    hitIds: [],
    style: opts.style,
    onHit: (w, p, target) => {
      if (!opts.hitStructures && target.isStatic) {
        // Pass through structures rather than being eaten by them.
        p.hitIds.push(target.id);
        return;
      }
      opts.onHit(w, p, target);
    },
    onExpire: opts.onExpire,
  });
}

/** Homing bolt used by click-to-cast damage abilities. */
export function fireBolt(
  world: WorldLike,
  caster: Unit,
  targetId: number,
  style: string,
  speed: number,
  onHit: (world: WorldLike, projectile: Projectile, target: Unit) => void,
): void {
  world.spawnProjectile({
    team: caster.team,
    ownerId: caster.id,
    pos: { ...caster.pos },
    dir: { x: Math.cos(caster.facing), y: Math.sin(caster.facing) },
    speed,
    radius: 26,
    travelled: 0,
    maxDistance: 4000,
    homingTargetId: targetId,
    pierce: false,
    hitIds: [],
    style,
    onHit,
  });
}

/* ------------------------------------------------------------------ *
 * Zones and movement
 * ------------------------------------------------------------------ */

export interface ZoneOptions {
  radius: number;
  seconds: number;
  style: string;
  /** Seconds between pulses. */
  period?: number;
  onPulse?: (world: WorldLike, zone: Zone) => void;
  onExpire?: (world: WorldLike, zone: Zone) => void;
}

export function createZone(
  world: WorldLike,
  caster: Unit,
  centre: Vec2,
  opts: ZoneOptions,
): Zone {
  return world.spawnZone({
    team: caster.team,
    ownerId: caster.id,
    pos: { ...centre },
    radius: opts.radius,
    endsTick: world.tick + secToTicks(opts.seconds),
    period: secToTicks(opts.period ?? 0.5),
    style: opts.style,
    onTick: opts.onPulse,
    onExpire: opts.onExpire,
  });
}

/** Dash toward a point, stopping at `maxRange` and never inside terrain. */
export function dashToward(
  world: WorldLike,
  caster: Unit,
  point: Vec2,
  maxRange: number,
  speed: number,
): void {
  const d = dist(caster.pos, point);
  const dir = normalize({ x: point.x - caster.pos.x, y: point.y - caster.pos.y });
  const reach = Math.min(d, maxRange);
  world.dash(
    caster.id,
    { x: caster.pos.x + dir.x * reach, y: caster.pos.y + dir.y * reach },
    speed,
  );
}

/** Pushes `target` away from `from` by `distance`. */
export function knockBack(
  world: WorldLike,
  target: Unit,
  from: Vec2,
  distance: number,
  seconds: number,
): void {
  if (target.isStatic) return;
  const dir = normalize({ x: target.pos.x - from.x, y: target.pos.y - from.y });
  const away = dir.x === 0 && dir.y === 0 ? { x: 1, y: 0 } : dir;
  world.dash(
    target.id,
    { x: target.pos.x + away.x * distance, y: target.pos.y + away.y * distance },
    distance / Math.max(0.05, seconds),
    'knockback',
  );
  applyCc(world, target.id, target.id, 'airborne', seconds, 'airborne');
}

/** Pulls `target` toward `to`. */
export function pullTowards(
  world: WorldLike,
  target: Unit,
  to: Vec2,
  speed: number,
  stopDistance = 120,
): void {
  if (target.isStatic) return;
  const dir = normalize({ x: to.x - target.pos.x, y: to.y - target.pos.y });
  const d = Math.max(0, dist(target.pos, to) - stopDistance);
  world.dash(
    target.id,
    { x: target.pos.x + dir.x * d, y: target.pos.y + dir.y * d },
    speed,
    'knockback',
  );
}

/** Enemy champions first, then anything else, nearest within `radius`. */
export function nearestEnemyChampion(
  world: WorldLike,
  caster: Unit,
  radius: number,
): Unit | undefined {
  let best: Unit | undefined;
  let bestD = Infinity;
  for (const u of world.enemiesOf(caster.team, caster.pos, radius)) {
    if (u.kind !== 'champion') continue;
    const d = dist(u.pos, caster.pos);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

export function lowestHealthAlly(
  world: WorldLike,
  caster: Unit,
  radius: number,
): Unit | undefined {
  let best: Unit | undefined;
  let bestFraction = Infinity;
  for (const u of world.alliesOf(caster.team, caster.pos, radius)) {
    if (u.kind !== 'champion') continue;
    const f = u.hp / Math.max(1, u.stats.maxHp);
    if (f < bestFraction) {
      bestFraction = f;
      best = u;
    }
  }
  return best;
}
