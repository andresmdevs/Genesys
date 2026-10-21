/**
 * Uniform spatial hash for "everything within R of P" queries, which the
 * simulation runs many times per tick for targeting, splash and aggro.
 *
 * Rebuilt from scratch each tick: with a few hundred units that is cheaper and
 * far simpler than incremental updates.
 */

import { MAP_SIZE } from '../data/map.ts';
import type { Vec2 } from '../core/math.ts';

const BUCKET = 600;
const COLS = Math.ceil(MAP_SIZE / BUCKET);

export class SpatialHash<T extends { pos: Vec2 }> {
  private buckets: T[][] = [];

  constructor() {
    for (let i = 0; i < COLS * COLS; i++) this.buckets.push([]);
  }

  clear(): void {
    for (const b of this.buckets) b.length = 0;
  }

  private key(x: number, y: number): number {
    const cx = Math.min(COLS - 1, Math.max(0, Math.floor(x / BUCKET)));
    const cy = Math.min(COLS - 1, Math.max(0, Math.floor(y / BUCKET)));
    return cy * COLS + cx;
  }

  insert(item: T): void {
    this.buckets[this.key(item.pos.x, item.pos.y)].push(item);
  }

  /** Calls `fn` for every item in the buckets overlapping the query circle. */
  forEachNear(centre: Vec2, radius: number, fn: (item: T) => void): void {
    const cx0 = Math.max(0, Math.floor((centre.x - radius) / BUCKET));
    const cx1 = Math.min(COLS - 1, Math.floor((centre.x + radius) / BUCKET));
    const cy0 = Math.max(0, Math.floor((centre.y - radius) / BUCKET));
    const cy1 = Math.min(COLS - 1, Math.floor((centre.y + radius) / BUCKET));
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * COLS;
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.buckets[row + cx];
        for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
      }
    }
  }

  /** Items strictly inside the circle, filtered by an optional predicate. */
  query(centre: Vec2, radius: number, filter?: (item: T) => boolean): T[] {
    const out: T[] = [];
    const r2 = radius * radius;
    this.forEachNear(centre, radius, (item) => {
      const dx = item.pos.x - centre.x;
      const dy = item.pos.y - centre.y;
      if (dx * dx + dy * dy <= r2 && (!filter || filter(item))) out.push(item);
    });
    return out;
  }
}
