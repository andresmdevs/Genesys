import type { Vec2 } from '../core/math.ts';
import type {
  AbilityKey,
  ChampionRole,
  Growth,
  StatBlock,
  Unit,
  WorldLike,
} from '../sim/types.ts';

/** How the player aims an ability. */
export type Targeting =
  | 'self' // cast on yourself, no aim
  | 'point' // aimed at a ground position
  | 'direction' // skillshot fired along a vector
  | 'enemy' // click an enemy unit
  | 'ally' // click an allied unit (the caster counts)
  | 'passive'; // never cast

export interface CastContext {
  world: WorldLike;
  caster: Unit;
  /** Rank of the ability being cast, 1-based. */
  rank: number;
  /** Aim point in world space; for unit targeting it is the target's position. */
  point: Vec2;
  /** Target unit id for 'enemy' / 'ally' targeting, else -1. */
  targetId: number;
  /** Per-ability scratch space that survives between casts. */
  memory: Record<string, number>;
}

export interface AbilityDef {
  key: AbilityKey;
  name: string;
  /** Shown in the ability tooltip; may contain plain text only. */
  description: string;
  targeting: Targeting;
  /** Per-rank values. Index 0 is rank 1. */
  cooldown: number[];
  cost: number[];
  /** Cast range in world units. A single number applies to every rank. */
  range: number | number[];
  /** Seconds the caster is locked in place while casting. */
  castTime?: number;
  maxRank?: number;
  /** Ultimates unlock at 6/11/16 instead of 1/2/3... */
  isUltimate?: boolean;
  /** Radius used by the targeting indicator; purely cosmetic. */
  indicatorRadius?: number;
  /** Width used by skillshot indicators. */
  indicatorWidth?: number;
  cast(ctx: CastContext): void;
}

export interface PassiveDef {
  name: string;
  description: string;
  /** Called once per tick for a living champion. */
  onTick?(world: WorldLike, unit: Unit): void;
  /** Called after one of this champion's auto-attacks lands. */
  onAutoAttackHit?(world: WorldLike, unit: Unit, target: Unit, damage: number): void;
  /** Called when this champion takes damage, before shields are consumed. */
  onDamaged?(world: WorldLike, unit: Unit, source: Unit | undefined, amount: number): void;
  /** Called when this champion scores a kill or assist. */
  onKill?(world: WorldLike, unit: Unit, victim: Unit): void;
}

export interface ChampionDef {
  id: string;
  name: string;
  /** One-line fantasy, shown in champion select. */
  title: string;
  role: ChampionRole;
  /** Ranged champions attack from a distance and fire a visible projectile. */
  ranged: boolean;
  /** Difficulty 1-3, shown in champion select. */
  difficulty: number;
  /** Accent colour used for the champion's silhouette and ability art. */
  colour: string;
  blurb: string;

  base: Partial<StatBlock>;
  growth: Partial<Growth>;
  radius?: number;

  passive: PassiveDef;
  abilities: Record<AbilityKey, AbilityDef>;

  /** Item ids a bot buys in order, used as the default build. */
  buildOrder: string[];
  /** Ability keys a bot ranks up in order. */
  skillOrder: AbilityKey[];
}
