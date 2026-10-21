/**
 * Deterministic RNG. The simulation must produce identical results from
 * identical inputs on every machine, so it never touches Math.random.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid the degenerate zero state.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** mulberry32 - small, fast, good enough statistical quality for a game. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return Math.floor(lo + this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** In-place Fisher-Yates. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Snapshot/restore so a rollback can rewind the generator too. */
  save(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = state >>> 0;
  }
}
