import type { Command } from './commands.ts';
import { DT } from './constants.ts';
import type { Match } from './match.ts';

/**
 * How the game loop advances a match. Offline play steps immediately; online
 * play waits for the server's command bundle. Both expose the same surface so
 * the loop does not care which it has.
 */
export interface Driver {
  readonly match: Match;
  /** True while the driver cannot advance, e.g. waiting on the network. */
  readonly waiting: boolean;
  /** Submits local player input. */
  queue(cmds: Command[]): void;
  /** Advances the match; returns how many ticks were simulated. */
  advance(elapsedSeconds: number): number;
}

/** Offline driver: input applies on the very next tick. */
export class LocalDriver implements Driver {
  readonly waiting = false;
  private accumulator = 0;
  private pending: Command[] = [];

  constructor(readonly match: Match) {}

  queue(cmds: Command[]): void {
    if (cmds.length > 0) this.pending.push(...cmds);
  }

  advance(elapsedSeconds: number): number {
    this.accumulator += elapsedSeconds;
    let stepped = 0;
    // Cap catch-up so returning to a backgrounded tab does not freeze a frame.
    while (this.accumulator >= DT && stepped < 5) {
      const cmds = this.pending;
      this.pending = [];
      this.match.step(cmds);
      this.accumulator -= DT;
      stepped++;
    }
    if (stepped === 5) this.accumulator = 0;
    return stepped;
  }
}
