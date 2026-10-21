/**
 * Map geometry for Genesys.
 *
 * The playfield is a square with 180-degree rotational symmetry about the
 * anti-diagonal (x + y = MAP_SIZE), the same symmetry a three-lane MOBA map
 * uses: blue's base sits bottom-left, red's top-right, mid runs along the main
 * diagonal and the river along the anti-diagonal.
 *
 * Only the blue half is authored by hand. Everything red is derived with
 * `mirror`, which guarantees the two sides are identical to the unit and
 * removes a whole category of balance bug.
 */

import type { Rect, Vec2 } from '../core/math.ts';

export const MAP_SIZE = 14400;

export type Team = 0 | 1;
export const BLUE: Team = 0;
export const RED: Team = 1;
export const enemyOf = (t: Team): Team => (t === BLUE ? RED : BLUE);

export type LaneId = 0 | 1 | 2;
export const TOP: LaneId = 0;
export const MID: LaneId = 1;
export const BOT: LaneId = 2;
export const LANES: readonly LaneId[] = [TOP, MID, BOT];
export const LANE_NAMES: Record<LaneId, string> = { 0: 'Superior', 1: 'Central', 2: 'Inferior' };

/* ------------------------------------------------------------------ *
 * Symmetry helpers
 * ------------------------------------------------------------------ */

/** Reflection across the anti-diagonal: maps the blue half onto the red half. */
export const mirror = (p: Vec2): Vec2 => ({ x: MAP_SIZE - p.y, y: MAP_SIZE - p.x });

/** Reflection across the main diagonal: maps the top jungle onto the bottom. */
export const swapXY = (p: Vec2): Vec2 => ({ x: p.y, y: p.x });

export const mirrorRect = (r: Rect): Rect => ({
  x0: MAP_SIZE - r.y1,
  y0: MAP_SIZE - r.x1,
  x1: MAP_SIZE - r.y0,
  y1: MAP_SIZE - r.x0,
});

const p = (x: number, y: number): Vec2 => ({ x, y });

/** Builds a full lane from the blue-side half, so both halves match exactly. */
function completeLane(half: Vec2[]): Vec2[] {
  const out = half.slice();
  // The last point of `half` sits on the anti-diagonal and is its own mirror,
  // so it is not repeated.
  for (let i = half.length - 2; i >= 0; i--) out.push(mirror(half[i]));
  return out;
}

/* ------------------------------------------------------------------ *
 * Lanes
 * ------------------------------------------------------------------ */

const TOP_HALF: Vec2[] = [
  p(1800, 1800),
  p(1850, 2700),
  p(1500, 3700),
  p(1300, 5600),
  p(1300, 8400),
  p(1300, 11000),
  p(1300, 13100),
];

const MID_HALF: Vec2[] = [
  p(1800, 1800),
  p(2900, 2900),
  p(4200, 4200),
  p(5700, 5700),
  p(7200, 7200),
];

const BOT_HALF: Vec2[] = TOP_HALF.map(swapXY);

/** Lane waypoints ordered from the blue nexus to the red nexus. */
export const LANE_PATHS: Record<LaneId, Vec2[]> = {
  [TOP]: completeLane(TOP_HALF),
  [MID]: completeLane(MID_HALF),
  [BOT]: completeLane(BOT_HALF),
};

/** Lane waypoints as travelled by a given team (red walks them in reverse). */
export function lanePathFor(team: Team, lane: LaneId): Vec2[] {
  const path = LANE_PATHS[lane];
  return team === BLUE ? path : path.slice().reverse();
}

export const LANE_HALF_WIDTH = 560;

/* ------------------------------------------------------------------ *
 * Structures
 * ------------------------------------------------------------------ */

export type TowerTier = 'outer' | 'inner' | 'inhib' | 'nexus';

export interface TowerSpot {
  team: Team;
  lane: LaneId;
  tier: TowerTier;
  pos: Vec2;
}

export interface InhibitorSpot {
  team: Team;
  lane: LaneId;
  pos: Vec2;
}

const BLUE_TOWERS: { lane: LaneId; tier: TowerTier; pos: Vec2 }[] = [
  { lane: TOP, tier: 'outer', pos: p(1300, 8200) },
  { lane: TOP, tier: 'inner', pos: p(1330, 5600) },
  { lane: TOP, tier: 'inhib', pos: p(1500, 3800) },
  { lane: MID, tier: 'outer', pos: p(5600, 5600) },
  { lane: MID, tier: 'inner', pos: p(4300, 4300) },
  { lane: MID, tier: 'inhib', pos: p(3400, 3400) },
  { lane: BOT, tier: 'outer', pos: p(8200, 1300) },
  { lane: BOT, tier: 'inner', pos: p(5600, 1330) },
  { lane: BOT, tier: 'inhib', pos: p(3800, 1500) },
  // The two nexus turrets guard the final approach.
  { lane: TOP, tier: 'nexus', pos: p(1950, 2700) },
  { lane: BOT, tier: 'nexus', pos: p(2700, 1950) },
];

const BLUE_INHIBITORS: { lane: LaneId; pos: Vec2 }[] = [
  { lane: TOP, pos: p(1600, 3100) },
  { lane: MID, pos: p(2800, 2800) },
  { lane: BOT, pos: p(3100, 1600) },
];

export const TOWER_SPOTS: TowerSpot[] = [
  ...BLUE_TOWERS.map((t) => ({ ...t, team: BLUE })),
  ...BLUE_TOWERS.map((t) => ({ ...t, team: RED, pos: mirror(t.pos) })),
];

export const INHIBITOR_SPOTS: InhibitorSpot[] = [
  ...BLUE_INHIBITORS.map((t) => ({ ...t, team: BLUE })),
  ...BLUE_INHIBITORS.map((t) => ({ ...t, team: RED, pos: mirror(t.pos) })),
];

export const NEXUS_POS: Record<Team, Vec2> = {
  [BLUE]: p(1800, 1800),
  [RED]: mirror(p(1800, 1800)),
};

export const FOUNTAIN_POS: Record<Team, Vec2> = {
  [BLUE]: p(1150, 1150),
  [RED]: mirror(p(1150, 1150)),
};

/** Where minions enter their lane after leaving the base. */
export const SPAWN_POS: Record<Team, Vec2> = {
  [BLUE]: p(2050, 2050),
  [RED]: mirror(p(2050, 2050)),
};

/* ------------------------------------------------------------------ *
 * Neutral camps and epic monsters
 * ------------------------------------------------------------------ */

export type CampType = 'toad' | 'arcane' | 'wolves' | 'raptors' | 'fury' | 'krugs';

export interface CampSpot {
  id: string;
  type: CampType;
  /** Side of the river the camp belongs to - used by bot pathing, not ownership. */
  side: Team;
  pos: Vec2;
}

const BLUE_CAMPS: { type: CampType; pos: Vec2 }[] = [
  // Upper jungle quadrant.
  { type: 'toad', pos: p(2400, 8200) },
  { type: 'arcane', pos: p(3300, 7000) },
  { type: 'wolves', pos: p(3700, 5000) },
  // Lower jungle quadrant (the mirror of the upper one across the main diagonal).
  { type: 'raptors', pos: p(5000, 3700) },
  { type: 'fury', pos: p(7000, 3300) },
  { type: 'krugs', pos: p(8200, 2400) },
];

export const CAMP_SPOTS: CampSpot[] = [
  ...BLUE_CAMPS.map((c, i) => ({ ...c, side: BLUE, id: `camp-b${i}` })),
  ...BLUE_CAMPS.map((c, i) => ({ ...c, side: RED, id: `camp-r${i}`, pos: mirror(c.pos) })),
];

/** Both epic pits sit on the anti-diagonal, equidistant from either base. */
export const DRAGON_PIT: Vec2 = p(10200, 4200);
export const BARON_PIT: Vec2 = p(4200, 10200);

/* ------------------------------------------------------------------ *
 * Brush
 * ------------------------------------------------------------------ */

const brush = (cx: number, cy: number, w: number, h: number): Rect => ({
  x0: cx - w / 2,
  y0: cy - h / 2,
  x1: cx + w / 2,
  y1: cy + h / 2,
});

const BLUE_BRUSH: Rect[] = [
  brush(1980, 7350, 820, 1180), // top lane
  brush(2900, 9850, 980, 860), // top river
  brush(2780, 6150, 860, 820), // top tri-brush
  brush(4550, 5450, 760, 700), // mid, top side
  brush(7350, 1980, 1180, 820), // bot lane
  brush(9850, 2900, 860, 980), // bot river
  brush(6150, 2780, 820, 860), // bot tri-brush
  brush(5450, 4550, 700, 760), // mid, bot side
  brush(6250, 7950, 820, 760), // mid river, top side
  brush(3450, 2500, 900, 760), // base entrance
];

export const BRUSH_RECTS: Rect[] = [...BLUE_BRUSH, ...BLUE_BRUSH.map(mirrorRect)];

/* ------------------------------------------------------------------ *
 * Walkable geometry
 *
 * Terrain is authored as a union of discs and capsules. Anything the union
 * does not cover is impassable wall. The navigation grid rasterises this and
 * the renderer draws the very same shapes, so what you see is what you can
 * walk on.
 * ------------------------------------------------------------------ */

export interface Disc {
  kind: 'disc';
  c: Vec2;
  r: number;
}

export interface Capsule {
  kind: 'capsule';
  a: Vec2;
  b: Vec2;
  r: number;
}

export type Shape = Disc | Capsule;

const disc = (c: Vec2, r: number): Disc => ({ kind: 'disc', c, r });
const capsule = (a: Vec2, b: Vec2, r: number): Capsule => ({ kind: 'capsule', a, b, r });

const mirrorShape = (s: Shape): Shape =>
  s.kind === 'disc' ? disc(mirror(s.c), s.r) : capsule(mirror(s.a), mirror(s.b), s.r);

const swapShape = (s: Shape): Shape =>
  s.kind === 'disc' ? disc(swapXY(s.c), s.r) : capsule(swapXY(s.a), swapXY(s.b), s.r);

/** Jungle trails of the blue upper quadrant; the other three are derived. */
const JUNGLE_TRAILS_Q1: Shape[] = [
  capsule(p(2500, 3150), p(3700, 5000), 400), // base -> wolves
  capsule(p(3700, 5000), p(3300, 7000), 400), // wolves -> arcane sentinel
  capsule(p(3300, 7000), p(2400, 8200), 400), // arcane -> toad
  capsule(p(2400, 8200), p(1600, 8500), 380), // toad -> top lane
  capsule(p(2400, 8200), p(3050, 10350), 400), // toad -> river mouth
  capsule(p(3050, 10350), p(4200, 10200), 440), // river mouth -> baron pit
  capsule(p(3300, 7000), p(4750, 6350), 380), // arcane -> mid lane
  capsule(p(3700, 5000), p(4300, 4300), 380), // wolves -> mid lane
  capsule(p(4750, 6350), p(5700, 7450), 380), // mid -> upper river
  capsule(p(5700, 7450), p(4600, 9500), 380), // upper river link
];

const LANE_SHAPES: Shape[] = LANES.flatMap((lane) => {
  const path = LANE_PATHS[lane];
  const out: Shape[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    out.push(capsule(path[i], path[i + 1], LANE_HALF_WIDTH));
  }
  return out;
});

const BASE_SHAPES: Shape[] = [
  disc(NEXUS_POS[BLUE], 1650),
  disc(FOUNTAIN_POS[BLUE], 820),
  capsule(FOUNTAIN_POS[BLUE], NEXUS_POS[BLUE], 700),
].flatMap((s) => [s, mirrorShape(s)]);

/** The river runs corner to corner along the anti-diagonal. */
const RIVER_SHAPES: Shape[] = [
  capsule(p(2550, 11850), p(11850, 2550), 700),
  disc(DRAGON_PIT, 950),
  disc(BARON_PIT, 950),
];

const CAMP_CLEARINGS: Shape[] = CAMP_SPOTS.map((c) => disc(c.pos, 700));

const JUNGLE_SHAPES: Shape[] = (() => {
  const q1 = JUNGLE_TRAILS_Q1;
  const q2 = q1.map(swapShape); // blue lower quadrant
  const blue = [...q1, ...q2];
  return [...blue, ...blue.map(mirrorShape)]; // and the two red quadrants
})();

export const WALKABLE_SHAPES: Shape[] = [
  ...LANE_SHAPES,
  ...BASE_SHAPES,
  ...RIVER_SHAPES,
  ...CAMP_CLEARINGS,
  ...JUNGLE_SHAPES,
];

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export function inBrush(pos: Vec2): boolean {
  for (const r of BRUSH_RECTS) {
    if (pos.x >= r.x0 && pos.x <= r.x1 && pos.y >= r.y0 && pos.y <= r.y1) return true;
  }
  return false;
}

/** Index of the brush containing `pos`, or -1. Two units share vision inside one. */
export function brushIndexAt(pos: Vec2): number {
  for (let i = 0; i < BRUSH_RECTS.length; i++) {
    const r = BRUSH_RECTS[i];
    if (pos.x >= r.x0 && pos.x <= r.x1 && pos.y >= r.y0 && pos.y <= r.y1) return i;
  }
  return -1;
}

/** Fountain healing and shop access are limited to this radius. */
export const FOUNTAIN_RADIUS = 700;

export function inFountain(team: Team, pos: Vec2): boolean {
  const f = FOUNTAIN_POS[team];
  const dx = pos.x - f.x;
  const dy = pos.y - f.y;
  return dx * dx + dy * dy <= FOUNTAIN_RADIUS * FOUNTAIN_RADIUS;
}

/** How far along its lane a position is, as a 0..1 fraction from blue to red. */
export function laneProgress(lane: LaneId, pos: Vec2): number {
  const path = LANE_PATHS[lane];
  let best = Infinity;
  let bestT = 0;
  let travelled = 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const segLen = Math.hypot(abx, aby);
    const t = Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (pos.y - a.y) * aby) / (segLen * segLen)));
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const d = (pos.x - px) ** 2 + (pos.y - py) ** 2;
    if (d < best) {
      best = d;
      bestT = travelled + segLen * t;
    }
    travelled += segLen;
  }
  return total > 0 ? bestT / total : 0;
}
