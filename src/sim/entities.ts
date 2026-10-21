import type { Vec2 } from '../core/math.ts';
import type { ChampionDef } from '../champions/types.ts';
import {
  BLUE,
  FOUNTAIN_POS,
  NEXUS_POS,
  type CampSpot,
  type InhibitorSpot,
  type LaneId,
  type Team,
  type TowerSpot,
} from '../data/map.ts';
import { TOWER_FORTIFY_UNTIL } from './constants.ts';
import { makeGrowth, makeStats, ZERO_STATS } from './stats.ts';
import { NEUTRAL } from './types.ts';
import type {
  Allegiance,
  MinionKind,
  MonsterKind,
  Unit,
  UnitKind,
} from './types.ts';
import type { World } from './world.ts';

interface BaseUnitInit {
  id: number;
  kind: UnitKind;
  team: Allegiance;
  name: string;
  pos: Vec2;
  radius: number;
  isStatic?: boolean;
}

function baseUnit(init: BaseUnitInit): Unit {
  return {
    id: init.id,
    kind: init.kind,
    team: init.team,
    name: init.name,
    pos: { ...init.pos },
    facing: 0,
    radius: init.radius,
    isStatic: init.isStatic ?? false,
    alive: true,
    hp: 1,
    mana: 0,
    level: 1,
    xp: 0,
    base: { ...ZERO_STATS },
    growth: makeGrowth({}),
    itemStats: {},
    stats: { ...ZERO_STATS },
    effects: [],
    attackCooldown: 0,
    windup: -1,
    attackTargetId: -1,
    castLock: 0,
    displacement: null,
    path: [],
    moveTarget: null,
    orderTargetId: -1,
    deathTick: -1,
    respawnTick: -1,
    lastDamageFrom: [],
  };
}

/* ------------------------------------------------------------------ *
 * Champions
 * ------------------------------------------------------------------ */

export function spawnChampion(
  world: World,
  def: ChampionDef,
  team: Team,
  playerSlot: number,
  lane: LaneId,
  isBot: boolean,
): Unit {
  const unit = baseUnit({
    id: world.allocId(),
    kind: 'champion',
    team,
    name: def.name,
    pos: FOUNTAIN_POS[team],
    radius: def.radius ?? 65,
  });

  unit.base = makeStats({
    maxHp: 600,
    hpRegen: 7,
    maxMana: 400,
    manaRegen: 8,
    ad: 60,
    armor: 30,
    mr: 30,
    attackSpeed: 0.65,
    moveSpeed: 340,
    attackRange: def.ranged ? 550 : 175,
    ...def.base,
  });
  unit.growth = makeGrowth({
    maxHp: 95,
    hpRegen: 0.7,
    maxMana: 40,
    manaRegen: 0.7,
    ad: 3.2,
    armor: 4.2,
    mr: 1.3,
    attackSpeed: 0.025,
    ...def.growth,
  });

  unit.champion = {
    championId: def.id,
    role: def.role,
    playerSlot,
    isBot,
    lane,
    gold: 0,
    totalGold: 0,
    items: [],
    abilities: {
      Q: { rank: 0, cooldown: 0, charges: 1, memory: {} },
      W: { rank: 0, cooldown: 0, charges: 1, memory: {} },
      E: { rank: 0, cooldown: 0, charges: 1, memory: {} },
      R: { rank: 0, cooldown: 0, charges: 1, memory: {} },
    },
    skillPoints: 1,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 0,
    killStreak: 0,
    deathStreak: 0,
    damageDealt: 0,
    damageTaken: 0,
    attackMovePoint: null,
    recallTicks: -1,
    flashCooldown: 0,
    healCooldown: 0,
  };

  return world.addUnit(unit);
}

/* ------------------------------------------------------------------ *
 * Minions
 * ------------------------------------------------------------------ */

/** Minions grow on a timer so late waves can still threaten a turret. */
function minionScale(gameSeconds: number): number {
  return Math.floor(Math.max(0, gameSeconds) / 90);
}

const MINION_SHAPE: Record<MinionKind, { radius: number; name: string }> = {
  melee: { radius: 48, name: 'Vanguardia' },
  caster: { radius: 44, name: 'Artillero' },
  siege: { radius: 60, name: 'Ariete' },
  super: { radius: 66, name: 'Coloso' },
};

export function spawnMinion(
  world: World,
  team: Team,
  lane: LaneId,
  kind: MinionKind,
  pos: Vec2,
  wave: number,
): Unit {
  const s = minionScale(world.seconds);
  const shape = MINION_SHAPE[kind];
  const unit = baseUnit({
    id: world.allocId(),
    kind: 'minion',
    team,
    name: shape.name,
    pos,
    radius: shape.radius,
  });

  const table: Record<MinionKind, Partial<typeof ZERO_STATS>> = {
    melee: {
      maxHp: 470 + 25 * s,
      ad: 12 + 1.6 * s,
      armor: 1.5 * s,
      mr: 1.5 * s,
      attackSpeed: 1.25,
      moveSpeed: 325,
      attackRange: 120,
    },
    caster: {
      maxHp: 300 + 16 * s,
      ad: 24 + 2.6 * s,
      armor: 1 * s,
      mr: 1 * s,
      attackSpeed: 0.8,
      moveSpeed: 325,
      attackRange: 560,
    },
    siege: {
      maxHp: 820 + 58 * s,
      ad: 42 + 3.2 * s,
      armor: 10 + 2 * s,
      mr: 2 * s,
      attackSpeed: 0.7,
      moveSpeed: 325,
      attackRange: 620,
    },
    super: {
      maxHp: 1600 + 95 * s,
      ad: 105 + 6 * s,
      armor: 30 + 3 * s,
      mr: 30 + 3 * s,
      attackSpeed: 0.85,
      moveSpeed: 325,
      attackRange: 170,
    },
  };

  unit.base = makeStats(table[kind]);
  unit.minion = { kind, lane, waypoint: 0, aggroTicks: 0, spawnWave: wave };
  return world.addUnit(unit);
}

/* ------------------------------------------------------------------ *
 * Structures
 * ------------------------------------------------------------------ */

const TOWER_STATS = {
  outer: { maxHp: 3900, armor: 45, mr: 45, ad: 180 },
  inner: { maxHp: 4800, armor: 55, mr: 55, ad: 190 },
  inhib: { maxHp: 5000, armor: 60, mr: 60, ad: 200 },
  nexus: { maxHp: 5200, armor: 65, mr: 65, ad: 210 },
} as const;

export function spawnTower(world: World, spot: TowerSpot): Unit {
  const unit = baseUnit({
    id: world.allocId(),
    kind: 'tower',
    team: spot.team,
    name: 'Torre',
    pos: spot.pos,
    radius: 130,
    isStatic: true,
  });
  const s = TOWER_STATS[spot.tier];
  unit.base = makeStats({
    ...s,
    attackSpeed: 0.83,
    attackRange: 1250,
    moveSpeed: 0,
  });
  unit.structure = {
    tier: spot.tier,
    lane: spot.lane,
    ramp: 0,
    respawnTick: 0,
    invulnerableUntilTowerId: -1,
  };
  return world.addUnit(unit);
}

export function spawnInhibitor(world: World, spot: InhibitorSpot): Unit {
  const unit = baseUnit({
    id: world.allocId(),
    kind: 'inhibitor',
    team: spot.team,
    name: 'Inhibidor',
    pos: spot.pos,
    radius: 150,
    isStatic: true,
  });
  unit.base = makeStats({ maxHp: 4000, armor: 40, mr: 40, moveSpeed: 0 });
  unit.structure = {
    tier: 'inhibitor',
    lane: spot.lane,
    ramp: 0,
    respawnTick: 0,
    invulnerableUntilTowerId: -1,
  };
  return world.addUnit(unit);
}

export function spawnNexus(world: World, team: Team): Unit {
  const unit = baseUnit({
    id: world.allocId(),
    kind: 'nexus',
    team,
    name: 'Núcleo',
    pos: NEXUS_POS[team],
    radius: 230,
    isStatic: true,
  });
  unit.base = makeStats({ maxHp: 5500, armor: 40, mr: 40, moveSpeed: 0 });
  unit.structure = {
    tier: 'core',
    lane: 1,
    ramp: 0,
    respawnTick: 0,
    invulnerableUntilTowerId: -1,
  };
  return world.addUnit(unit);
}

/** Outer turrets shrug off early damage so laners cannot rush them at level 3. */
export function towerFortification(world: World): number {
  return world.seconds < TOWER_FORTIFY_UNTIL ? 0.33 : 1;
}

/* ------------------------------------------------------------------ *
 * Neutral monsters
 * ------------------------------------------------------------------ */

export interface CampDef {
  label: string;
  /** Units in the camp; the first is the leader that carries the buff. */
  members: { hp: number; ad: number; radius: number; big: boolean }[];
  gold: number;
  xp: number;
  buff?: 'arcane' | 'fury';
}

export const CAMP_DEFS: Record<string, CampDef> = {
  toad: {
    label: 'Sapo del Soto',
    members: [{ hp: 1300, ad: 50, radius: 90, big: true }],
    gold: 80,
    xp: 130,
  },
  arcane: {
    label: 'Centinela Arcano',
    members: [{ hp: 1600, ad: 60, radius: 95, big: true }],
    gold: 95,
    xp: 170,
    buff: 'arcane',
  },
  wolves: {
    label: 'Manada del Ocaso',
    members: [
      { hp: 900, ad: 42, radius: 80, big: true },
      { hp: 420, ad: 20, radius: 55, big: false },
      { hp: 420, ad: 20, radius: 55, big: false },
    ],
    gold: 85,
    xp: 135,
  },
  raptors: {
    label: 'Nido de Esquirlas',
    members: [
      { hp: 800, ad: 38, radius: 75, big: true },
      { hp: 260, ad: 14, radius: 48, big: false },
      { hp: 260, ad: 14, radius: 48, big: false },
      { hp: 260, ad: 14, radius: 48, big: false },
    ],
    gold: 85,
    xp: 135,
  },
  fury: {
    label: 'Guardián de la Pira',
    members: [{ hp: 1700, ad: 70, radius: 95, big: true }],
    gold: 95,
    xp: 170,
    buff: 'fury',
  },
  krugs: {
    label: 'Lomorroca',
    members: [
      { hp: 1100, ad: 48, radius: 88, big: true },
      { hp: 500, ad: 22, radius: 60, big: false },
    ],
    gold: 90,
    xp: 145,
  },
};

export function spawnCamp(world: World, spot: CampSpot): Unit[] {
  const def = CAMP_DEFS[spot.type];
  const out: Unit[] = [];
  const scale = 1 + Math.max(0, world.seconds - 120) / 1400;

  def.members.forEach((m, i) => {
    const angle = (i / Math.max(1, def.members.length)) * Math.PI * 2;
    const offset = i === 0 ? 0 : 150;
    const unit = baseUnit({
      id: world.allocId(),
      kind: 'monster',
      team: NEUTRAL,
      name: def.label,
      pos: {
        x: spot.pos.x + Math.cos(angle) * offset,
        y: spot.pos.y + Math.sin(angle) * offset,
      },
      radius: m.radius,
    });
    unit.base = makeStats({
      maxHp: m.hp * scale,
      ad: m.ad * scale,
      armor: 15,
      mr: 15,
      attackSpeed: 0.7,
      moveSpeed: 320,
      attackRange: m.radius + 60,
      hpRegen: 10,
    });
    unit.monster = {
      kind: 'camp',
      campId: spot.id,
      home: { ...spot.pos },
      leashRange: 1400,
      respawnTick: 0,
      variant: spot.type,
    };
    out.push(world.addUnit(unit));
  });

  return out;
}

export const DRAGON_VARIANTS = ['ember', 'gale', 'tide', 'stone'] as const;
export type DragonVariant = (typeof DRAGON_VARIANTS)[number];

export const DRAGON_LABELS: Record<DragonVariant, string> = {
  ember: 'Dragón de Brasa',
  gale: 'Dragón de Vendaval',
  tide: 'Dragón de Marea',
  stone: 'Dragón de Roca',
};

export function spawnEpic(
  world: World,
  kind: Exclude<MonsterKind, 'camp'>,
  pos: Vec2,
  variant: string,
): Unit {
  const isBaron = kind === 'baron';
  const scale = 1 + Math.max(0, world.seconds - 300) / 900;
  const unit = baseUnit({
    id: world.allocId(),
    kind: 'monster',
    team: NEUTRAL,
    name: isBaron ? 'Heraldo Abisal' : DRAGON_LABELS[variant as DragonVariant],
    pos,
    radius: isBaron ? 180 : 150,
  });
  unit.base = makeStats({
    maxHp: (isBaron ? 7200 : 3600) * scale,
    ad: (isBaron ? 180 : 110) * scale,
    armor: isBaron ? 90 : 40,
    mr: isBaron ? 90 : 40,
    attackSpeed: 0.6,
    moveSpeed: 330,
    attackRange: isBaron ? 320 : 280,
    hpRegen: 20,
  });
  unit.monster = {
    kind,
    campId: isBaron ? 'baron' : 'dragon',
    home: { ...pos },
    leashRange: 1600,
    respawnTick: 0,
    variant,
  };
  return world.addUnit(unit);
}

export const isStructure = (u: Unit): boolean =>
  u.kind === 'tower' || u.kind === 'inhibitor' || u.kind === 'nexus';

export const isBlueTeam = (u: Unit): boolean => u.team === BLUE;
