import { Rng } from '../core/rng.ts';
import {
  clamp,
  dist,
  distSq,
  normalize,
  type Vec2,
} from '../core/math.ts';
import {
  BLUE,
  FOUNTAIN_POS,
  RED,
  brushIndexAt,
  enemyOf,
  type Team,
} from '../data/map.ts';
import {
  BRUSH_REVEAL_RADIUS,
  CHAMPION_VISION,
  DT,
  MINION_VISION,
  TOWER_VISION,
  WARD_VISION,
  resistMultiplier,
} from './constants.ts';
import { SpatialHash } from './spatial.ts';
import { recomputeStats, shieldAmount } from './stats.ts';
import { mitigate } from './combat.ts';
import { NEUTRAL } from './types.ts';
import type {
  Allegiance,
  DamageEvent,
  Effect,
  KillEvent,
  Projectile,
  Unit,
  VisualEffect,
  WorldLike,
  Zone,
} from './types.ts';

/** The phases a match plugs into `World.stepSystems`. */
export interface TickHooks {
  /** Decide orders and targets. */
  ai(): void;
  /** Move units along their paths. */
  movement(): void;
  /** Auto-attacks and ability ticking. */
  combat(): void;
  /** Spawns, deaths, rewards and the win check. */
  late(): void;
}

/** Narrative feed entries the HUD prints. */
export interface FeedEntry {
  tick: number;
  kind: 'kill' | 'tower' | 'inhibitor' | 'objective' | 'info';
  text: string;
  team?: Allegiance;
}

export class World implements WorldLike {
  tick = 0;
  readonly units = new Map<number, Unit>();
  readonly projectiles: Projectile[] = [];
  readonly zones: Zone[] = [];
  readonly fx: VisualEffect[] = [];
  readonly feed: FeedEntry[] = [];
  readonly kills: KillEvent[] = [];
  readonly rng: Rng;

  /** Rebuilt each tick; never iterate it across a tick boundary. */
  readonly spatial = new SpatialHash<Unit>();

  teamKills: [number, number] = [0, 0];
  teamGold: [number, number] = [0, 0];
  winner: Team | null = null;
  firstBloodTaken = false;

  /** Unit ids each team can currently see. Recomputed every few ticks. */
  readonly visible: [Set<number>, Set<number>] = [new Set(), new Set()];

  private nextId = 1;
  private nextEffectId = 1;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  /* ---------------------------------------------------------------- *
   * Identity and lookup
   * ---------------------------------------------------------------- */

  allocId(): number {
    return this.nextId++;
  }

  getUnit(id: number): Unit | undefined {
    return this.units.get(id);
  }

  /** Returns the unit only when it is alive, which most callers want. */
  living(id: number): Unit | undefined {
    const u = this.units.get(id);
    return u && u.alive ? u : undefined;
  }

  addUnit(unit: Unit): Unit {
    this.units.set(unit.id, unit);
    recomputeStats(unit);
    unit.hp = unit.stats.maxHp;
    unit.mana = unit.stats.maxMana;
    return unit;
  }

  rngNext(): number {
    return this.rng.next();
  }

  get seconds(): number {
    return this.tick * DT;
  }

  /* ---------------------------------------------------------------- *
   * Spatial queries
   * ---------------------------------------------------------------- */

  rebuildSpatial(): void {
    this.spatial.clear();
    for (const u of this.units.values()) if (u.alive) this.spatial.insert(u);
  }

  unitsInRadius(centre: Vec2, radius: number, filter?: (u: Unit) => boolean): Unit[] {
    return this.spatial.query(centre, radius, filter);
  }

  /** Enemies of `team` within `radius`, including neutral monsters. */
  enemiesOf(team: Allegiance, centre: Vec2, radius: number): Unit[] {
    return this.spatial.query(centre, radius, (u) => u.alive && u.team !== team);
  }

  alliesOf(team: Allegiance, centre: Vec2, radius: number): Unit[] {
    return this.spatial.query(centre, radius, (u) => u.alive && u.team === team);
  }

  /** Nearest enemy satisfying `filter`, or undefined. */
  nearestEnemy(
    team: Allegiance,
    centre: Vec2,
    radius: number,
    filter?: (u: Unit) => boolean,
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestD = Infinity;
    this.spatial.forEachNear(centre, radius, (u) => {
      if (!u.alive || u.team === team) return;
      if (filter && !filter(u)) return;
      const d = distSq(u.pos, centre);
      if (d < bestD && d <= radius * radius) {
        bestD = d;
        best = u;
      }
    });
    return best;
  }

  /* ---------------------------------------------------------------- *
   * Damage, healing and death
   * ---------------------------------------------------------------- */

  /**
   * Applies a damage event and returns the health actually removed.
   * Shields absorb first, oldest expiring first so short shields are spent
   * before long ones.
   */
  dealDamage(ev: DamageEvent): number {
    const target = this.units.get(ev.targetId);
    if (!target || !target.alive) return 0;
    const source = this.units.get(ev.sourceId);

    for (const e of target.effects) {
      if (e.kind === 'invulnerable') return 0;
    }

    let amount = mitigate(ev.amount, ev.type, source, target);
    if (amount <= 0) return 0;

    const beforeShield = amount;
    if (shieldAmount(target) > 0) {
      const shields = target.effects
        .filter((e) => e.kind === 'shield')
        .sort((a, b) => a.endsTick - b.endsTick);
      for (const shield of shields) {
        if (amount <= 0) break;
        const absorbed = Math.min(shield.value, amount);
        shield.value -= absorbed;
        amount -= absorbed;
      }
      target.effects = target.effects.filter((e) => e.kind !== 'shield' || e.value > 0.5);
    }

    if (beforeShield > amount) {
      this.addFx({ style: 'shield-hit', pos: { ...target.pos }, life: 8, age: 0 });
    }

    target.hp -= amount;
    this.noteDamageSource(target, ev.sourceId);

    if (source?.champion) source.champion.damageDealt += amount;
    if (target.champion) target.champion.damageTaken += amount;

    if (amount > 0) {
      this.addFx({
        style: 'damage-number',
        pos: { ...target.pos },
        life: 32,
        age: 0,
        text: String(Math.round(amount)),
        colour: ev.type === 'magic' ? '#c79bff' : ev.type === 'true' ? '#ffffff' : '#ffd28a',
        radius: ev.isCrit ? 1.6 : 1,
      });
    }

    // Lifesteal and spell vamp feed off post-mitigation damage.
    if (source && source.alive) {
      const vamp = ev.isAuto ? source.stats.lifesteal : source.stats.spellVamp;
      if (vamp > 0) this.heal(source.id, amount * vamp, source.id);
    }

    if (target.hp <= 0) this.killUnit(target, source);
    return amount;
  }

  heal(targetId: number, amount: number, _sourceId: number): void {
    const target = this.units.get(targetId);
    if (!target || !target.alive || amount <= 0) return;
    const before = target.hp;
    target.hp = Math.min(target.stats.maxHp, target.hp + amount);
    const healed = target.hp - before;
    if (healed > 1) {
      this.addFx({
        style: 'damage-number',
        pos: { ...target.pos },
        life: 28,
        age: 0,
        text: `+${Math.round(healed)}`,
        colour: '#6ef7a0',
      });
    }
  }

  /** Remembers recent attackers so assists can be credited on death. */
  private noteDamageSource(target: Unit, sourceId: number): void {
    const source = this.units.get(sourceId);
    if (!source || source.kind !== 'champion') return;
    const existing = target.lastDamageFrom.find((d) => d.id === sourceId);
    if (existing) existing.tick = this.tick;
    else target.lastDamageFrom.push({ id: sourceId, tick: this.tick });
  }

  killUnit(target: Unit, source: Unit | undefined): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.deathTick = this.tick;
    target.attackTargetId = -1;
    target.path.length = 0;
    target.moveTarget = null;
    target.displacement = null;
    target.castLock = 0;
    // Buffs do not survive death.
    target.effects = target.effects.filter((e) => e.kind === 'marker');
    this.onUnitKilled?.(target, source);
  }

  /** Assigned by the match layer; keeps rewards out of the core world. */
  onUnitKilled?: (victim: Unit, killer: Unit | undefined) => void;

  /** Champion ids that damaged `victim` in the assist window, excluding the killer. */
  assistsFor(victim: Unit, killerId: number, windowTicks: number): number[] {
    const out: number[] = [];
    for (const d of victim.lastDamageFrom) {
      if (d.id === killerId) continue;
      if (this.tick - d.tick > windowTicks) continue;
      const u = this.units.get(d.id);
      if (u?.kind === 'champion' && u.team === this.units.get(killerId)?.team) out.push(d.id);
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Effects
   * ---------------------------------------------------------------- */

  applyEffect(targetId: number, effect: Omit<Effect, 'id'>): Effect | null {
    const target = this.units.get(targetId);
    if (!target || !target.alive) return null;

    const existing = target.effects.find((e) => e.tag === effect.tag);
    if (existing) {
      // Refresh rather than stack, unless the effect declares stacking.
      if (existing.maxStacks && existing.maxStacks > 1) {
        existing.stacks = Math.min(existing.maxStacks, (existing.stacks ?? 1) + 1);
      }
      existing.endsTick = Math.max(existing.endsTick, effect.endsTick);
      existing.value = Math.max(existing.value, effect.value);
      recomputeStats(target);
      return existing;
    }

    const created: Effect = { ...effect, id: this.nextEffectId++ };
    if (created.period && created.nextTick === undefined) {
      created.nextTick = this.tick + created.period;
    }
    target.effects.push(created);
    recomputeStats(target);
    return created;
  }

  removeEffectsByTag(targetId: number, tag: string): void {
    const target = this.units.get(targetId);
    if (!target) return;
    const before = target.effects.length;
    target.effects = target.effects.filter((e) => e.tag !== tag);
    if (target.effects.length !== before) recomputeStats(target);
  }

  private updateEffects(unit: Unit): void {
    if (unit.effects.length === 0) return;
    let dirty = false;

    for (let i = unit.effects.length - 1; i >= 0; i--) {
      const e = unit.effects[i];
      if (this.tick >= e.endsTick) {
        unit.effects.splice(i, 1);
        dirty = true;
        continue;
      }
      if (e.period && e.nextTick !== undefined && this.tick >= e.nextTick) {
        e.nextTick = this.tick + e.period;
        if (e.kind === 'dot') {
          this.dealDamage({
            amount: e.value * (e.stacks ?? 1),
            type: e.damageType ?? 'magic',
            sourceId: e.sourceId,
            targetId: unit.id,
            isAuto: false,
            isCrit: false,
          });
          if (!unit.alive) return;
        } else if (e.kind === 'heal-over-time') {
          this.heal(unit.id, e.value * (e.stacks ?? 1), e.sourceId);
        }
      }
    }

    if (dirty) recomputeStats(unit);
  }

  /* ---------------------------------------------------------------- *
   * Projectiles, zones, displacement, visuals
   * ---------------------------------------------------------------- */

  spawnProjectile(p: Omit<Projectile, 'id'>): Projectile {
    const proj: Projectile = { ...p, id: this.allocId() };
    this.projectiles.push(proj);
    return proj;
  }

  spawnZone(z: Omit<Zone, 'id' | 'nextTick'>): Zone {
    const zone: Zone = { ...z, id: this.allocId(), nextTick: this.tick };
    this.zones.push(zone);
    return zone;
  }

  dash(unitId: number, to: Vec2, speed: number, kind: 'dash' | 'knockback' = 'dash'): void {
    const unit = this.units.get(unitId);
    if (!unit || !unit.alive || unit.isStatic) return;
    const distance = dist(unit.pos, to);
    if (distance < 1) return;
    unit.displacement = {
      from: { ...unit.pos },
      to: { ...to },
      elapsed: 0,
      duration: Math.max(1, Math.round((distance / speed) / DT)),
      kind,
    };
    unit.path.length = 0;
    unit.moveTarget = null;
  }

  addFx(fx: VisualEffect): void {
    // Keep the buffer bounded so a long fight cannot grow it without limit.
    if (this.fx.length > 900) this.fx.splice(0, 200);
    this.fx.push(fx);
  }

  log(entry: Omit<FeedEntry, 'tick'>): void {
    this.feed.push({ ...entry, tick: this.tick });
    if (this.feed.length > 120) this.feed.splice(0, 40);
  }

  private stepProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = p.speed * DT;

      if (p.homingTargetId >= 0) {
        const target = this.units.get(p.homingTargetId);
        if (!target || !target.alive) {
          this.projectiles.splice(i, 1);
          continue;
        }
        p.dir = normalize({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
        p.pos.x += p.dir.x * step;
        p.pos.y += p.dir.y * step;
        p.travelled += step;
        if (dist(p.pos, target.pos) <= target.radius + p.radius) {
          p.onHit(this, p, target);
          this.projectiles.splice(i, 1);
          continue;
        }
        if (p.travelled > p.maxDistance * 2.5) this.projectiles.splice(i, 1);
        continue;
      }

      p.pos.x += p.dir.x * step;
      p.pos.y += p.dir.y * step;
      p.travelled += step;

      let consumed = false;
      const candidates = this.spatial.query(
        p.pos,
        p.radius + 160,
        (u) => u.alive && u.team !== p.team && !u.isStatic,
      );
      for (const u of candidates) {
        if (p.hitIds.includes(u.id)) continue;
        if (dist(p.pos, u.pos) > u.radius + p.radius) continue;
        p.hitIds.push(u.id);
        p.onHit(this, p, u);
        if (!p.pierce) {
          consumed = true;
          break;
        }
      }

      if (consumed || p.travelled >= p.maxDistance) {
        if (!consumed) p.onExpire?.(this, p);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private stepZones(): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (this.tick >= z.endsTick) {
        z.onExpire?.(this, z);
        this.zones.splice(i, 1);
        continue;
      }
      if (z.onTick && this.tick >= z.nextTick) {
        z.nextTick = this.tick + Math.max(1, z.period);
        z.onTick(this, z);
      }
    }
  }

  private stepDisplacements(): void {
    for (const u of this.units.values()) {
      const d = u.displacement;
      if (!d) continue;
      d.elapsed++;
      const t = clamp(d.elapsed / d.duration, 0, 1);
      u.pos.x = d.from.x + (d.to.x - d.from.x) * t;
      u.pos.y = d.from.y + (d.to.y - d.from.y) * t;
      if (t >= 1) {
        u.displacement = null;
        d.onArrive?.(u.id);
      }
    }
  }

  private ageFx(): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      if (++f.age >= f.life) this.fx.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------------- *
   * Vision
   * ---------------------------------------------------------------- */

  /**
   * Fog of war. A unit is visible to a team when an allied unit is within its
   * vision radius, with the brush rule applied: a hidden unit standing in
   * brush is only revealed by an enemy in the same brush or very close to it.
   */
  recomputeVision(): void {
    for (const team of [BLUE, RED] as Team[]) {
      const set = this.visible[team];
      set.clear();

      const observers: { pos: Vec2; range: number; brush: number }[] = [];
      for (const u of this.units.values()) {
        if (!u.alive || u.team !== team) continue;
        const range =
          u.kind === 'champion'
            ? CHAMPION_VISION
            : u.kind === 'ward'
              ? WARD_VISION
              : u.kind === 'minion'
                ? MINION_VISION
                : TOWER_VISION;
        observers.push({ pos: u.pos, range, brush: brushIndexAt(u.pos) });
        set.add(u.id);
      }

      for (const u of this.units.values()) {
        if (!u.alive || u.team === team) continue;
        const targetBrush = brushIndexAt(u.pos);
        const stealthed = u.effects.some((e) => e.kind === 'stealth');
        const revealed = u.effects.some((e) => e.kind === 'reveal');

        if (stealthed && !revealed) continue;
        if (revealed) {
          set.add(u.id);
          continue;
        }

        for (const o of observers) {
          const d = dist(o.pos, u.pos);
          if (d > o.range) continue;
          if (targetBrush >= 0 && o.brush !== targetBrush && d > BRUSH_REVEAL_RADIUS) continue;
          set.add(u.id);
          break;
        }
      }
    }
  }

  isVisibleTo(team: Team, unitId: number): boolean {
    return this.visible[team].has(unitId);
  }

  /* ---------------------------------------------------------------- *
   * Tick
   * ---------------------------------------------------------------- */

  /**
   * Advances the world by one tick. The phases run in a fixed order so that
   * identical inputs always produce an identical world, which is what lets the
   * online server and the offline client share this code.
   */
  stepSystems(hooks: TickHooks): void {
    this.tick++;
    this.rebuildSpatial();

    for (const u of this.units.values()) {
      if (!u.alive) continue;
      this.updateEffects(u);
      if (!u.alive) continue;
      recomputeStats(u);
      this.regenerate(u);
      if (u.attackCooldown > 0) u.attackCooldown--;
      if (u.castLock > 0) u.castLock--;
    }

    hooks.ai();
    this.stepDisplacements();
    hooks.movement();
    hooks.combat();

    this.stepProjectiles();
    this.stepZones();
    // Vision is expensive and barely changes between neighbouring ticks.
    if (this.tick % 3 === 0) this.recomputeVision();
    hooks.late();
    this.ageFx();
  }

  private regenerate(u: Unit): void {
    if (u.isStatic) return;
    if (u.hp < u.stats.maxHp) {
      u.hp = Math.min(u.stats.maxHp, u.hp + (u.stats.hpRegen / 5) * DT);
    }
    if (u.mana < u.stats.maxMana) {
      u.mana = Math.min(u.stats.maxMana, u.mana + (u.stats.manaRegen / 5) * DT);
    }

    // Fountain healing is deliberately fast so recalls stay short.
    if (u.kind === 'champion' && u.team !== NEUTRAL) {
      const f = FOUNTAIN_POS[u.team as Team];
      if (distSq(u.pos, f) < 700 * 700) {
        u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.maxHp * 0.22 * DT);
        u.mana = Math.min(u.stats.maxMana, u.mana + u.stats.maxMana * 0.22 * DT);
      }
    }
  }

  /** Damage reduction a unit currently has, for bot threat evaluation. */
  effectiveHp(u: Unit, type: 'physical' | 'magic'): number {
    const resist = type === 'physical' ? u.stats.armor : u.stats.mr;
    return (u.hp + shieldAmount(u)) / resistMultiplier(resist);
  }

  enemyTeamOf(team: Allegiance): Allegiance {
    return team === NEUTRAL ? NEUTRAL : enemyOf(team as Team);
  }
}
