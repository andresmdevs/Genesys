import { dist, distSq, normalize, type Vec2 } from '../core/math.ts';
import { MAP_SIZE } from '../data/map.ts';
import { isImmobilised } from './combat.ts';
import { DT } from './constants.ts';
import { findPath, isWalkable, nearestWalkable } from './navgrid.ts';
import type { Unit } from './types.ts';
import type { World } from './world.ts';

/** How close a unit must get to a waypoint before advancing to the next. */
const WAYPOINT_EPSILON = 45;
/** A chase order recomputes its route at most this often. */
const REPATH_INTERVAL = 9;

const EDGE = 60;
const clampToMap = (v: number): number => Math.max(EDGE, Math.min(MAP_SIZE - EDGE, v));

/** Orders a unit to walk to `dest`, routing around terrain. */
export function issueMove(unit: Unit, dest: Vec2): void {
  const target = { x: clampToMap(dest.x), y: clampToMap(dest.y) };
  unit.moveTarget = target;
  unit.path = findPath(unit.pos, target);
  if (unit.path.length === 0) {
    // No route exists; walk toward the closest reachable point instead of
    // standing still, which reads as a stuck unit to the player.
    unit.path = [nearestWalkable(target)];
  }
}

/** Straight-line order used by minions, which already follow a safe corridor. */
export function issueMoveDirect(unit: Unit, dest: Vec2): void {
  const target = { x: clampToMap(dest.x), y: clampToMap(dest.y) };
  unit.moveTarget = target;
  unit.path = [target];
}

export function stopMoving(unit: Unit): void {
  unit.path.length = 0;
  unit.moveTarget = null;
  unit.orderTargetId = -1;
}

/**
 * Advances every mobile unit along its path, then resolves unit-on-unit
 * overlap. Terrain is handled by trying the full step, then each axis alone,
 * which makes units slide along walls instead of sticking to them.
 */
export function stepMovement(world: World): void {
  for (const unit of world.units.values()) {
    if (!unit.alive || unit.isStatic || unit.displacement) continue;
    if (isImmobilised(unit) || unit.castLock > 0 || unit.windup >= 0) continue;

    // Chasing a unit means following it, so refresh the route periodically.
    if (unit.orderTargetId >= 0) {
      const target = world.living(unit.orderTargetId);
      if (!target) {
        unit.orderTargetId = -1;
      } else if ((world.tick + unit.id) % REPATH_INTERVAL === 0) {
        const reach = unit.stats.attackRange + target.radius;
        if (distSq(unit.pos, target.pos) > reach * reach) issueMove(unit, target.pos);
        else unit.path.length = 0;
      }
    }

    if (unit.path.length === 0) continue;

    let budget = unit.stats.moveSpeed * DT;
    while (budget > 0 && unit.path.length > 0) {
      const next = unit.path[0];
      const d = dist(unit.pos, next);
      if (d <= WAYPOINT_EPSILON) {
        unit.path.shift();
        if (unit.path.length === 0) unit.moveTarget = null;
        continue;
      }
      const step = Math.min(budget, d);
      const dir = normalize({ x: next.x - unit.pos.x, y: next.y - unit.pos.y });
      const nx = unit.pos.x + dir.x * step;
      const ny = unit.pos.y + dir.y * step;

      if (isWalkable({ x: nx, y: ny })) {
        unit.pos.x = nx;
        unit.pos.y = ny;
      } else if (isWalkable({ x: nx, y: unit.pos.y })) {
        unit.pos.x = nx;
      } else if (isWalkable({ x: unit.pos.x, y: ny })) {
        unit.pos.y = ny;
      } else {
        // Wedged into a corner: recompute once and give up for this tick.
        if (unit.moveTarget) issueMove(unit, unit.moveTarget);
        break;
      }

      unit.facing = Math.atan2(dir.y, dir.x);
      budget -= step;
    }
  }

  resolveOverlap(world);
}

/**
 * Soft body separation. Units push each other out of overlap a little each
 * tick, which keeps minion waves from collapsing into one point without the
 * cost of a real physics pass.
 */
function resolveOverlap(world: World): void {
  const movers: Unit[] = [];
  for (const u of world.units.values()) {
    if (u.alive && !u.isStatic && !u.displacement) movers.push(u);
  }

  for (const a of movers) {
    world.spatial.forEachNear(a.pos, a.radius + 140, (b) => {
      if (b.id <= a.id || !b.alive || b.isStatic || b.displacement) return;
      const minDist = a.radius + b.radius;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minDist * minDist || d2 < 1e-6) return;

      const d = Math.sqrt(d2);
      // Resolve gently: a full correction makes stacked waves jitter.
      const push = ((minDist - d) / d) * 0.45;
      const ox = dx * push * 0.5;
      const oy = dy * push * 0.5;

      tryShift(a, -ox, -oy);
      tryShift(b, ox, oy);
    });
  }
}

function tryShift(u: Unit, dx: number, dy: number): void {
  const nx = clampToMap(u.pos.x + dx);
  const ny = clampToMap(u.pos.y + dy);
  if (isWalkable({ x: nx, y: ny })) {
    u.pos.x = nx;
    u.pos.y = ny;
  }
}

/** Keeps a unit from drifting into terrain after a dash or knock-back. */
export function settleIntoTerrain(unit: Unit): void {
  if (isWalkable(unit.pos)) return;
  const safe = nearestWalkable(unit.pos);
  unit.pos.x = safe.x;
  unit.pos.y = safe.y;
}
