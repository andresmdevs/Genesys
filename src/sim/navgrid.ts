/**
 * Navigation grid: rasterises the authored terrain shapes into a walkability
 * bitmap, then serves line-of-sight tests and A* paths on top of it.
 *
 * Built once at module load; the result is immutable and shared by the
 * simulation, the bots and the renderer.
 */

import { clamp, distSqToSegment, type Vec2 } from '../core/math.ts';
import { MAP_SIZE, NEXUS_POS, BLUE, WALKABLE_SHAPES } from '../data/map.ts';

export const CELL = 90;
export const GRID = Math.round(MAP_SIZE / CELL); // 160 x 160

const idx = (cx: number, cy: number): number => cy * GRID + cx;

export const toCell = (world: number): number =>
  clamp(Math.floor(world / CELL), 0, GRID - 1);

export const cellCenter = (c: number): number => c * CELL + CELL / 2;

function rasterise(): Uint8Array {
  const grid = new Uint8Array(GRID * GRID);

  for (const s of WALKABLE_SHAPES) {
    if (s.kind === 'disc') {
      const r = s.r;
      const cx0 = toCell(s.c.x - r);
      const cx1 = toCell(s.c.x + r);
      const cy0 = toCell(s.c.y - r);
      const cy1 = toCell(s.c.y + r);
      const r2 = r * r;
      for (let cy = cy0; cy <= cy1; cy++) {
        const wy = cellCenter(cy) - s.c.y;
        for (let cx = cx0; cx <= cx1; cx++) {
          const wx = cellCenter(cx) - s.c.x;
          if (wx * wx + wy * wy <= r2) grid[idx(cx, cy)] = 1;
        }
      }
    } else {
      const r = s.r;
      const cx0 = toCell(Math.min(s.a.x, s.b.x) - r);
      const cx1 = toCell(Math.max(s.a.x, s.b.x) + r);
      const cy0 = toCell(Math.min(s.a.y, s.b.y) - r);
      const cy1 = toCell(Math.max(s.a.y, s.b.y) + r);
      const r2 = r * r;
      const probe = { x: 0, y: 0 };
      for (let cy = cy0; cy <= cy1; cy++) {
        probe.y = cellCenter(cy);
        for (let cx = cx0; cx <= cx1; cx++) {
          probe.x = cellCenter(cx);
          if (distSqToSegment(probe, s.a, s.b) <= r2) grid[idx(cx, cy)] = 1;
        }
      }
    }
  }

  return grid;
}

/**
 * Terrain authoring can leave pockets that no unit can ever reach. Keeping
 * them walkable would let A* target a cell it cannot path to, so only the
 * component containing the blue nexus survives.
 */
function keepMainComponent(grid: Uint8Array): Uint8Array {
  const out = new Uint8Array(grid.length);
  const start = idx(toCell(NEXUS_POS[BLUE].x), toCell(NEXUS_POS[BLUE].y));
  if (!grid[start]) return grid;

  const stack = [start];
  out[start] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % GRID;
    const cy = (cur / GRID) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const n = idx(nx, ny);
        if (grid[n] && !out[n]) {
          out[n] = 1;
          stack.push(n);
        }
      }
    }
  }
  return out;
}

export const WALK: Uint8Array = keepMainComponent(rasterise());

export const isWalkableCell = (cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < GRID && cy < GRID && WALK[idx(cx, cy)] === 1;

export const isWalkable = (p: Vec2): boolean => isWalkableCell(toCell(p.x), toCell(p.y));

/** Nearest walkable point, searched in rings. Used to un-stick units. */
export function nearestWalkable(p: Vec2, maxRings = 24): Vec2 {
  const cx = toCell(p.x);
  const cy = toCell(p.y);
  if (isWalkableCell(cx, cy)) return { x: p.x, y: p.y };

  for (let r = 1; r <= maxRings; r++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isWalkableCell(cx + dx, cy + dy)) continue;
        const wx = cellCenter(cx + dx);
        const wy = cellCenter(cy + dy);
        const d = (wx - p.x) ** 2 + (wy - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x: wx, y: wy };
        }
      }
    }
    if (best) return best;
  }
  return { x: p.x, y: p.y };
}

/**
 * Supercover line walk. Returns false as soon as the segment crosses a wall,
 * so it doubles as both a vision test and a path-smoothing test.
 */
export function hasLineOfSight(a: Vec2, b: Vec2): boolean {
  let x = toCell(a.x);
  let y = toCell(a.y);
  const x1 = toCell(b.x);
  const y1 = toCell(b.y);
  if (!isWalkableCell(x, y) || !isWalkableCell(x1, y1)) return false;

  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx - dy;

  // Bounded so a malformed call can never spin.
  for (let guard = 0; guard < GRID * 2; guard++) {
    if (x === x1 && y === y1) return true;
    const e2 = err * 2;
    let steppedX = false;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
      steppedX = true;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
      // A pure diagonal step must not squeeze between two wall corners.
      if (steppedX && !isWalkableCell(x - sx, y) && !isWalkableCell(x, y - sy)) return false;
    }
    if (!isWalkableCell(x, y)) return false;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * A*
 * ------------------------------------------------------------------ */

const openHeap = new Int32Array(GRID * GRID);
const fScore = new Float32Array(GRID * GRID);
const gScore = new Float32Array(GRID * GRID);
const cameFrom = new Int32Array(GRID * GRID);
const visited = new Uint8Array(GRID * GRID);
/** Bumped per search instead of clearing the whole `visited` array. */
const stamp = new Uint32Array(GRID * GRID);
let stampCounter = 0;
let heapSize = 0;

function heapPush(cell: number): void {
  let i = heapSize++;
  openHeap[i] = cell;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (fScore[openHeap[parent]] <= fScore[openHeap[i]]) break;
    [openHeap[parent], openHeap[i]] = [openHeap[i], openHeap[parent]];
    i = parent;
  }
}

function heapPop(): number {
  const top = openHeap[0];
  openHeap[0] = openHeap[--heapSize];
  let i = 0;
  for (;;) {
    const l = i * 2 + 1;
    const r = l + 1;
    let smallest = i;
    if (l < heapSize && fScore[openHeap[l]] < fScore[openHeap[smallest]]) smallest = l;
    if (r < heapSize && fScore[openHeap[r]] < fScore[openHeap[smallest]]) smallest = r;
    if (smallest === i) break;
    [openHeap[smallest], openHeap[i]] = [openHeap[i], openHeap[smallest]];
    i = smallest;
  }
  return top;
}

const SQRT2 = Math.SQRT2;

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
}

/**
 * Grid A* with string-pulled output. Returns world-space waypoints excluding
 * the start, or an empty array when no route exists.
 *
 * `maxNodes` keeps a pathological request (a unit asking for a route across
 * the whole map every tick) from stalling a frame.
 */
export function findPath(from: Vec2, to: Vec2, maxNodes = 6000): Vec2[] {
  const start = nearestWalkable(from);
  const goal = nearestWalkable(to);

  // Nothing to compute when the destination is in plain sight.
  if (hasLineOfSight(start, goal)) return [goal];

  const sx = toCell(start.x);
  const sy = toCell(start.y);
  const gx = toCell(goal.x);
  const gy = toCell(goal.y);
  const startCell = idx(sx, sy);
  const goalCell = idx(gx, gy);
  if (startCell === goalCell) return [goal];

  stampCounter++;
  heapSize = 0;

  gScore[startCell] = 0;
  fScore[startCell] = octile(sx, sy, gx, gy);
  cameFrom[startCell] = -1;
  stamp[startCell] = stampCounter;
  visited[startCell] = 0;
  heapPush(startCell);

  let expanded = 0;
  let found = false;

  while (heapSize > 0 && expanded < maxNodes) {
    const cur = heapPop();
    if (cur === goalCell) {
      found = true;
      break;
    }
    if (visited[cur] === 1 && stamp[cur] === stampCounter) continue;
    visited[cur] = 1;
    expanded++;

    const cx = cur % GRID;
    const cy = (cur / GRID) | 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isWalkableCell(nx, ny)) continue;
        // Forbid cutting a wall corner diagonally.
        if (dx !== 0 && dy !== 0 && (!isWalkableCell(cx + dx, cy) || !isWalkableCell(cx, cy + dy))) {
          continue;
        }
        const n = idx(nx, ny);
        const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
        const tentative = gScore[cur] + step;
        const seen = stamp[n] === stampCounter;
        if (seen && tentative >= gScore[n]) continue;
        stamp[n] = stampCounter;
        visited[n] = 0;
        gScore[n] = tentative;
        fScore[n] = tentative + octile(nx, ny, gx, gy);
        cameFrom[n] = cur;
        heapPush(n);
      }
    }
  }

  if (!found) return [];

  // Rebuild, then string-pull: drop any waypoint the previous kept point can
  // already see, which turns the staircase into a handful of long legs.
  const cells: number[] = [];
  for (let c = goalCell; c !== -1; c = cameFrom[c]) cells.push(c);
  cells.reverse();

  const raw: Vec2[] = cells.map((c) => ({
    x: cellCenter(c % GRID),
    y: cellCenter((c / GRID) | 0),
  }));
  raw[raw.length - 1] = goal;

  const out: Vec2[] = [];
  let anchor = start;
  let i = 1;
  while (i < raw.length) {
    let furthest = i;
    for (let j = raw.length - 1; j > i; j--) {
      if (hasLineOfSight(anchor, raw[j])) {
        furthest = j;
        break;
      }
    }
    out.push(raw[furthest]);
    anchor = raw[furthest];
    i = furthest + 1;
  }
  return out;
}
