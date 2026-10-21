import type { Vec2 } from '../core/math.ts';
import type { LaneId, Team } from '../data/map.ts';
import type { Position } from './positions.ts';

export const NEUTRAL = 2;
/** Jungle monsters belong to no team; `Team` stays 0/1 for players. */
export type Allegiance = Team | typeof NEUTRAL;

export type UnitKind =
  | 'champion'
  | 'minion'
  | 'tower'
  | 'inhibitor'
  | 'nexus'
  | 'monster'
  | 'ward';

export type MinionKind = 'melee' | 'caster' | 'siege' | 'super';

export type DamageType = 'physical' | 'magic' | 'true';

export interface StatBlock {
  maxHp: number;
  hpRegen: number;
  maxMana: number;
  manaRegen: number;
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  /** Attacks per second. */
  attackSpeed: number;
  moveSpeed: number;
  attackRange: number;
  critChance: number;
  critDamage: number;
  lifesteal: number;
  spellVamp: number;
  /** Ability haste, converted to a cooldown multiplier by `cooldownMultiplier`. */
  haste: number;
  /** 0..1 reduction of crowd-control durations. */
  tenacity: number;
  armorPenFlat: number;
  armorPenPct: number;
  magicPenFlat: number;
  magicPenPct: number;
  /** Multiplier applied to all damage dealt, and to all damage taken. */
  damageDealt: number;
  damageTaken: number;
}

export type StatKey = keyof StatBlock;

/** Per-level growth, added linearly from level 1 to 18. */
export interface Growth {
  maxHp: number;
  hpRegen: number;
  maxMana: number;
  manaRegen: number;
  ad: number;
  armor: number;
  mr: number;
  /** Fractional attack-speed gain per level. */
  attackSpeed: number;
}

export type EffectKind =
  | 'stun'
  | 'root'
  | 'silence'
  | 'disarm'
  | 'airborne'
  | 'slow'
  | 'haste'
  | 'shield'
  | 'stealth'
  | 'reveal'
  | 'dot'
  | 'heal-over-time'
  | 'stat'
  | 'untargetable'
  | 'invulnerable'
  | 'marker';

export interface Effect {
  id: number;
  kind: EffectKind;
  /** Grouping tag so a reapplied buff refreshes instead of stacking. */
  tag: string;
  sourceId: number;
  endsTick: number;
  /** Meaning depends on `kind`: slow fraction, shield points, damage per tick. */
  value: number;
  /** Flat stat deltas applied while the effect is active. */
  stats?: Partial<StatBlock>;
  damageType?: DamageType;
  /** Ticks between applications for periodic effects. */
  period?: number;
  nextTick?: number;
  stacks?: number;
  maxStacks?: number;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  team: Allegiance;
  name: string;

  pos: Vec2;
  facing: number;
  radius: number;
  /** Structures never move and are skipped by collision resolution. */
  isStatic: boolean;

  alive: boolean;
  hp: number;
  mana: number;
  level: number;
  xp: number;

  base: StatBlock;
  growth: Growth;
  /** Flat bonuses from items, recomputed when inventory changes. */
  itemStats: Partial<StatBlock>;
  /** Final stats for this tick, after growth, items and effects. */
  stats: StatBlock;

  effects: Effect[];

  /** Ticks remaining before the next auto-attack may start. */
  attackCooldown: number;
  /** Ticks remaining in the current attack windup; -1 when not attacking. */
  windup: number;
  attackTargetId: number;

  /** Ticks remaining in a cast that locks movement; 0 when free. */
  castLock: number;
  /** Set while a dash or knock-back owns this unit's position. */
  displacement: Displacement | null;

  path: Vec2[];
  moveTarget: Vec2 | null;
  /** Unit the owner ordered this unit to chase, if any. */
  orderTargetId: number;

  /** Champion-only fields. */
  champion?: ChampionState;
  /** Minion-only fields. */
  minion?: MinionState;
  /** Structure-only fields. */
  structure?: StructureState;
  /** Monster-only fields. */
  monster?: MonsterState;

  deathTick: number;
  respawnTick: number;
  lastDamageFrom: { id: number; tick: number }[];
}

export interface Displacement {
  from: Vec2;
  to: Vec2;
  elapsed: number;
  duration: number;
  /** A dash is self-propelled; a knock-back is not and ignores slows. */
  kind: 'dash' | 'knockback';
  onArrive?: (unitId: number) => void;
}

export interface AbilitySlot {
  rank: number;
  /** Ticks until the ability is ready. */
  cooldown: number;
  /** Charges for abilities that store them; 1 for ordinary spells. */
  charges: number;
  /** Arbitrary per-ability scratch space (stacks, toggled state, stored ids). */
  memory: Record<string, number>;
}

export interface ChampionState {
  championId: string;
  role: ChampionRole;
  /** Slot in the match: 0..4 blue, 5..9 red. */
  playerSlot: number;
  isBot: boolean;
  /** Where this champion plays. The lane is derived from it. */
  position: Position;
  lane: LaneId;

  gold: number;
  totalGold: number;
  items: string[];

  abilities: Record<AbilityKey, AbilitySlot>;
  /** Skill points not yet spent. */
  skillPoints: number;

  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  killStreak: number;
  deathStreak: number;
  damageDealt: number;
  damageTaken: number;

  /**
   * Destination of a standing attack-move order, or null. Keeping it lets the
   * champion pick a new target the moment the current one dies, which is what
   * makes farming with attack-move feel right.
   */
  attackMovePoint: Vec2 | null;
  /** Ticks of recall channel completed, or -1 when not recalling. */
  recallTicks: number;
  /** Summoner spell cooldowns in ticks. */
  flashCooldown: number;
  healCooldown: number;
}

export type AbilityKey = 'Q' | 'W' | 'E' | 'R';
export const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

export type ChampionRole = 'top' | 'mid' | 'mage' | 'adc' | 'support';
export const ROLES: readonly ChampionRole[] = ['top', 'mid', 'mage', 'adc', 'support'];
export const ROLE_NAMES: Record<ChampionRole, string> = {
  top: 'Línea superior',
  mid: 'Asesino',
  mage: 'Mago',
  adc: 'Tirador',
  support: 'Soporte',
};

export interface MinionState {
  kind: MinionKind;
  lane: LaneId;
  waypoint: number;
  /** Ticks left before the minion gives up chasing and returns to its lane. */
  aggroTicks: number;
  spawnWave: number;
}

export interface StructureState {
  tier: 'outer' | 'inner' | 'inhib' | 'nexus' | 'inhibitor' | 'core';
  lane: LaneId;
  /** Consecutive attacks on the same target, which ramp tower damage. */
  ramp: number;
  /** Tick the inhibitor comes back; 0 when standing. */
  respawnTick: number;
  /** Turrets further from the base must fall first. */
  invulnerableUntilTowerId: number;
}

export type MonsterKind = 'camp' | 'dragon' | 'baron';

export interface MonsterState {
  kind: MonsterKind;
  campId: string;
  /** Monsters leash back to their camp when pulled too far. */
  home: Vec2;
  leashRange: number;
  respawnTick: number;
  /** Which dragon element was rolled, for the team buff it grants. */
  variant: string;
}

export interface Projectile {
  id: number;
  team: Allegiance;
  ownerId: number;
  pos: Vec2;
  /** Unit direction of travel. */
  dir: Vec2;
  speed: number;
  radius: number;
  travelled: number;
  maxDistance: number;
  /** When set, the projectile homes and cannot miss. */
  homingTargetId: number;
  pierce: boolean;
  hitIds: number[];
  /** Visual identity, resolved by the renderer. */
  style: string;
  onHit: (world: WorldLike, projectile: Projectile, target: Unit) => void;
  onExpire?: (world: WorldLike, projectile: Projectile) => void;
}

export interface Zone {
  id: number;
  team: Allegiance;
  ownerId: number;
  pos: Vec2;
  radius: number;
  endsTick: number;
  nextTick: number;
  period: number;
  style: string;
  onTick?: (world: WorldLike, zone: Zone) => void;
  onExpire?: (world: WorldLike, zone: Zone) => void;
}

export interface DamageEvent {
  amount: number;
  type: DamageType;
  sourceId: number;
  targetId: number;
  isAuto: boolean;
  isCrit: boolean;
  /** Label shown by the floating combat text, e.g. an ability name. */
  label?: string;
}

export interface KillEvent {
  victimId: number;
  killerId: number;
  assistIds: number[];
  tick: number;
}

/**
 * The subset of the world that abilities and projectiles touch. Declared
 * structurally so `world.ts` can implement it without a circular import.
 */
export interface WorldLike {
  tick: number;
  units: Map<number, Unit>;
  getUnit(id: number): Unit | undefined;
  dealDamage(ev: DamageEvent): number;
  heal(targetId: number, amount: number, sourceId: number): void;
  applyEffect(targetId: number, effect: Omit<Effect, 'id'>): Effect | null;
  removeEffectsByTag(targetId: number, tag: string): void;
  spawnProjectile(p: Omit<Projectile, 'id'>): Projectile;
  spawnZone(z: Omit<Zone, 'id' | 'nextTick'>): Zone;
  dash(unitId: number, to: Vec2, speed: number, kind?: 'dash' | 'knockback'): void;
  unitsInRadius(centre: Vec2, radius: number, filter?: (u: Unit) => boolean): Unit[];
  enemiesOf(team: Allegiance, centre: Vec2, radius: number): Unit[];
  alliesOf(team: Allegiance, centre: Vec2, radius: number): Unit[];
  addFx(fx: VisualEffect): void;
  rngNext(): number;
}

/** Fire-and-forget visuals the renderer plays; they never affect the sim. */
export interface VisualEffect {
  style: string;
  pos: Vec2;
  to?: Vec2;
  radius?: number;
  /** Lifetime in ticks. */
  life: number;
  age: number;
  colour?: string;
  text?: string;
  angle?: number;
}
