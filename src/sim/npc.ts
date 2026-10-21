/**
 * Per-tick behaviour for everything the players do not control: minions
 * marching down their lane, turrets picking targets, and jungle monsters
 * defending their camp.
 */

import { dist, distSq } from '../core/math.ts';
import { lanePathFor, type Team } from '../data/map.ts';
import { attackReach } from './combat.ts';
import { issueMoveDirect, stopMoving } from './movement.ts';
import {
  acquireMinionTarget,
  acquireMonsterTarget,
  acquireTowerTarget,
} from './targeting.ts';
import type { Unit } from './types.ts';
import type { World } from './world.ts';

/** A minion chases this far past its lane before turning back. */
const MINION_CHASE = 700;
const WAYPOINT_REACHED = 260;

export function stepMinions(world: World): void {
  for (const unit of world.units.values()) {
    if (!unit.alive || unit.kind !== 'minion') continue;
    const m = unit.minion!;

    unit.attackTargetId = acquireMinionTarget(world, unit);
    const target = world.living(unit.attackTargetId);

    if (target) {
      const reach = attackReach(unit, target);
      const d = dist(unit.pos, target.pos);
      if (d <= reach) {
        stopMoving(unit);
        unit.facing = Math.atan2(target.pos.y - unit.pos.y, target.pos.x - unit.pos.x);
        continue;
      }
      // Only chase while the target is still roughly on the way.
      if (d <= reach + MINION_CHASE) {
        issueMoveDirect(unit, target.pos);
        continue;
      }
      unit.attackTargetId = -1;
    }

    marchLane(world, unit, m.lane, unit.team as Team);
  }
}

function marchLane(world: World, unit: Unit, lane: number, team: Team): void {
  const path = lanePathFor(team, lane as 0 | 1 | 2);
  const m = unit.minion!;

  // Snap to the closest waypoint ahead the first time the minion moves.
  if (m.waypoint === 0) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = distSq(unit.pos, path[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    m.waypoint = Math.min(path.length - 1, best + 1);
  }

  while (
    m.waypoint < path.length - 1 &&
    distSq(unit.pos, path[m.waypoint]) < WAYPOINT_REACHED * WAYPOINT_REACHED
  ) {
    m.waypoint++;
  }

  const next = path[Math.min(m.waypoint, path.length - 1)];
  // Spread the wave out a little so minions do not walk in single file.
  const jitterSeed = (unit.id * 2654435761) % 1000;
  const spread = ((jitterSeed / 1000) - 0.5) * 210;
  const toNext = Math.atan2(next.y - unit.pos.y, next.x - unit.pos.x);
  issueMoveDirect(unit, {
    x: next.x + Math.cos(toNext + Math.PI / 2) * spread,
    y: next.y + Math.sin(toNext + Math.PI / 2) * spread,
  });
  void world;
}

export function stepTowers(world: World): void {
  for (const unit of world.units.values()) {
    if (!unit.alive || unit.kind !== 'tower') continue;
    // Re-evaluating every tick is cheap and keeps turret aggro responsive.
    unit.attackTargetId = acquireTowerTarget(world, unit);
    const target = world.living(unit.attackTargetId);
    if (target) {
      unit.facing = Math.atan2(target.pos.y - unit.pos.y, target.pos.x - unit.pos.x);
    } else {
      unit.structure!.ramp = 0;
      unit.structure!.invulnerableUntilTowerId = -1;
    }
  }
}

export function stepMonsters(world: World): void {
  for (const unit of world.units.values()) {
    if (!unit.alive || unit.kind !== 'monster') continue;
    const m = unit.monster!;

    // Pulled too far from home: reset, heal up and walk back.
    if (distSq(unit.pos, m.home) > m.leashRange * m.leashRange) {
      unit.attackTargetId = -1;
      unit.hp = Math.min(unit.stats.maxHp, unit.hp + unit.stats.maxHp * 0.08);
      issueMoveDirect(unit, m.home);
      continue;
    }

    unit.attackTargetId = acquireMonsterTarget(world, unit);
    const target = world.living(unit.attackTargetId);
    if (!target) {
      if (distSq(unit.pos, m.home) > 160 * 160) issueMoveDirect(unit, m.home);
      else stopMoving(unit);
      continue;
    }

    const reach = attackReach(unit, target);
    if (dist(unit.pos, target.pos) <= reach) {
      stopMoving(unit);
      unit.facing = Math.atan2(target.pos.y - unit.pos.y, target.pos.x - unit.pos.x);
    } else {
      issueMoveDirect(unit, target.pos);
    }
  }
}
