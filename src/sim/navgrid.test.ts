import { describe, expect, it } from 'vitest';
import { WALK, GRID, findPath, isWalkable } from './navgrid.ts';
import {
  BARON_PIT,
  BLUE,
  CAMP_SPOTS,
  DRAGON_PIT,
  FOUNTAIN_POS,
  LANE_PATHS,
  LANES,
  NEXUS_POS,
  RED,
  TOWER_SPOTS,
  mirror,
} from '../data/map.ts';

describe('map terrain', () => {
  it('leaves a sane share of the square walkable', () => {
    let open = 0;
    for (let i = 0; i < WALK.length; i++) open += WALK[i];
    const ratio = open / (GRID * GRID);
    // Too low and the map is unplayable; too high and there is no jungle left.
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.7);
  });

  it('places every structure on walkable ground', () => {
    for (const t of TOWER_SPOTS) {
      expect(isWalkable(t.pos), `tower ${t.team}/${t.lane}/${t.tier}`).toBe(true);
    }
    for (const c of CAMP_SPOTS) expect(isWalkable(c.pos), `camp ${c.id}`).toBe(true);
    expect(isWalkable(NEXUS_POS[BLUE])).toBe(true);
    expect(isWalkable(NEXUS_POS[RED])).toBe(true);
    expect(isWalkable(DRAGON_PIT)).toBe(true);
    expect(isWalkable(BARON_PIT)).toBe(true);
  });

  it('keeps every lane waypoint walkable', () => {
    for (const lane of LANES) {
      for (const wp of LANE_PATHS[lane]) {
        expect(isWalkable(wp), `lane ${lane} waypoint ${wp.x},${wp.y}`).toBe(true);
      }
    }
  });

  it('connects every point of interest to both fountains', () => {
    const targets = [
      ...CAMP_SPOTS.map((c) => c.pos),
      ...TOWER_SPOTS.map((t) => t.pos),
      DRAGON_PIT,
      BARON_PIT,
      NEXUS_POS[BLUE],
      NEXUS_POS[RED],
    ];
    for (const origin of [FOUNTAIN_POS[BLUE], FOUNTAIN_POS[RED]]) {
      for (const target of targets) {
        const path = findPath(origin, target, 40000);
        expect(path.length, `no route to ${target.x},${target.y}`).toBeGreaterThan(0);
      }
    }
  });

  it('is symmetric: a mirrored point is walkable exactly when its source is', () => {
    for (let y = 100; y < 14400; y += 311) {
      for (let x = 100; x < 14400; x += 311) {
        const a = { x, y };
        expect(isWalkable(a), `asymmetry at ${x},${y}`).toBe(isWalkable(mirror(a)));
      }
    }
  });
});
