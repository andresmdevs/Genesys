import { distSq } from '../core/math.ts';
import { canAutoAttack, isVisibleToEnemies } from './combat.ts';
import { secToTicks } from './constants.ts';
import { NEUTRAL } from './types.ts';
import type { Unit } from './types.ts';
import type { World } from './world.ts';

/** How long a minion remembers who hit its allied champion. */
const MINION_AGGRO_WINDOW = secToTicks(2.5);
const MINION_SEARCH = 900;
const MONSTER_SEARCH = 900;

const attackable = (world: World, seeker: Unit, u: Unit): boolean => {
  if (!canAutoAttack(seeker, u)) return false;
  if (u.kind === 'ward') return false;
  if (!isVisibleToEnemies(u)) return false;
  if (u.kind === 'inhibitor' || u.kind === 'nexus') {
    return !structureIsShielded(world, u);
  }
  return true;
};

/**
 * Inhibitors and the nexus only become attackable once the turrets guarding
 * them are gone, which is what forces a team to push a lane rather than run
 * straight at the core.
 */
export function structureIsShielded(world: World, structure: Unit): boolean {
  const s = structure.structure;
  if (!s) return false;

  if (structure.kind === 'inhibitor') {
    for (const u of world.units.values()) {
      if (u.kind !== 'tower' || !u.alive || u.team !== structure.team) continue;
      if (u.structure!.lane === s.lane && u.structure!.tier !== 'nexus') return true;
    }
    return false;
  }

  if (structure.kind === 'nexus') {
    // The nexus turrets must fall, and at least one inhibitor must be down.
    for (const u of world.units.values()) {
      if (!u.alive || u.team !== structure.team) continue;
      if (u.kind === 'tower' && u.structure!.tier === 'nexus') return true;
    }
    let anyInhibDown = false;
    for (const u of world.units.values()) {
      if (u.kind === 'inhibitor' && u.team === structure.team && !u.alive) anyInhibDown = true;
    }
    return !anyInhibDown;
  }

  if (structure.kind === 'tower') {
    // Turrets fall from the outside in.
    const order = { outer: 0, inner: 1, inhib: 2, nexus: 3 } as const;
    const myRank = order[s.tier as keyof typeof order] ?? 0;
    for (const u of world.units.values()) {
      if (u.kind !== 'tower' || !u.alive || u.team !== structure.team) continue;
      const t = u.structure!;
      if (t.lane !== s.lane) continue;
      const rank = order[t.tier as keyof typeof order] ?? 0;
      if (rank < myRank) return true;
    }
    return false;
  }

  return false;
}

/**
 * Turret priority: defend a champion being attacked, otherwise clear the
 * biggest minion, otherwise shoot whatever champion is standing in range.
 */
export function acquireTowerTarget(world: World, tower: Unit): number {
  const range = tower.stats.attackRange;
  const candidates = world.enemiesOf(tower.team, tower.pos, range);
  if (candidates.length === 0) return -1;

  let defendTarget: Unit | undefined;
  let bestMinion: Unit | undefined;
  let bestMinionRank = -1;
  let nearestChampion: Unit | undefined;
  let nearestChampionD = Infinity;

  const rankOf = (u: Unit): number => {
    switch (u.minion?.kind) {
      case 'siege':
        return 4;
      case 'super':
        return 3;
      case 'melee':
        return 2;
      case 'caster':
        return 1;
      default:
        return 0;
    }
  };

  for (const c of candidates) {
    if (!attackable(world, tower, c)) continue;

    if (c.kind === 'champion') {
      // A champion who just hit one of ours in turret range takes priority.
      const victim = world.getUnit(c.attackTargetId);
      if (
        victim &&
        victim.kind === 'champion' &&
        victim.team === tower.team &&
        c.windup >= 0 &&
        distSq(victim.pos, tower.pos) <= range * range
      ) {
        defendTarget = c;
      }
      const d = distSq(c.pos, tower.pos);
      if (d < nearestChampionD) {
        nearestChampionD = d;
        nearestChampion = c;
      }
      continue;
    }

    if (c.kind === 'minion') {
      const rank = rankOf(c);
      if (rank > bestMinionRank) {
        bestMinionRank = rank;
        bestMinion = c;
      }
    }
  }

  return (defendTarget ?? bestMinion ?? nearestChampion)?.id ?? -1;
}

/**
 * Minion priority, closely following the genre's rules: answer a champion who
 * attacked an ally, then whatever hit you, then the nearest minion, then any
 * champion, then the structure in front of you.
 */
export function acquireMinionTarget(world: World, minion: Unit): number {
  const m = minion.minion!;
  const current = world.living(minion.attackTargetId);

  if (m.aggroTicks > 0) {
    m.aggroTicks--;
    if (current && attackable(world, minion, current)) {
      const reach = minion.stats.attackRange + current.radius + 250;
      if (distSq(minion.pos, current.pos) <= reach * reach) return current.id;
    }
  }

  const nearby = world.enemiesOf(minion.team, minion.pos, MINION_SEARCH);
  let bestMinion: Unit | undefined;
  let bestMinionD = Infinity;
  let bestChampion: Unit | undefined;
  let bestChampionD = Infinity;
  let bestStructure: Unit | undefined;
  let bestStructureD = Infinity;

  for (const c of nearby) {
    if (!attackable(world, minion, c)) continue;
    const d = distSq(minion.pos, c.pos);

    if (c.kind === 'champion') {
      // A champion attacking an allied champion pulls the whole wave.
      const victim = world.getUnit(c.attackTargetId);
      if (victim?.kind === 'champion' && victim.team === minion.team && c.windup >= 0) {
        m.aggroTicks = MINION_AGGRO_WINDOW;
        return c.id;
      }
      if (d < bestChampionD) {
        bestChampionD = d;
        bestChampion = c;
      }
    } else if (c.kind === 'minion' || c.kind === 'monster') {
      if (d < bestMinionD) {
        bestMinionD = d;
        bestMinion = c;
      }
    } else if (c.isStatic) {
      if (d < bestStructureD) {
        bestStructureD = d;
        bestStructure = c;
      }
    }
  }

  const chosen = bestMinion ?? bestChampion ?? bestStructure;
  if (chosen) m.aggroTicks = MINION_AGGRO_WINDOW;
  return chosen?.id ?? -1;
}

/** Monsters hit back at whoever is closest once they have been provoked. */
export function acquireMonsterTarget(world: World, monster: Unit): number {
  const current = world.living(monster.attackTargetId);
  if (current && attackable(world, monster, current)) {
    const reach = monster.monster!.leashRange;
    if (distSq(monster.pos, current.pos) <= reach * reach) return current.id;
  }
  const near = world.nearestEnemy(monster.team, monster.pos, MONSTER_SEARCH, (u) =>
    attackable(world, monster, u) && u.team !== NEUTRAL,
  );
  return near?.id ?? -1;
}

/** Nearest valid auto-attack target for a champion on attack-move. */
export function acquireChampionTarget(
  world: World,
  champion: Unit,
  range: number,
): number {
  let best: Unit | undefined;
  let bestScore = -Infinity;
  for (const c of world.enemiesOf(champion.team, champion.pos, range)) {
    if (!attackable(world, champion, c)) continue;
    const d = Math.sqrt(distSq(champion.pos, c.pos));
    // Prefer champions, then low-health units, then whatever is closest.
    let score = -d;
    if (c.kind === 'champion') score += 2200;
    else if (c.kind === 'monster') score += 300;
    else if (c.isStatic) score -= 1200;
    if (c.stats.maxHp > 0) score += (1 - c.hp / c.stats.maxHp) * 500;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best?.id ?? -1;
}
