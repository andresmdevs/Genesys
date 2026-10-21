/**
 * Deterministic lockstep driver.
 *
 * The client never advances past a tick it has not received the command
 * bundle for. Local input is tagged `INPUT_DELAY` ticks ahead, which gives
 * the bundle time to reach everyone before that tick comes up. The cost is a
 * fixed, predictable input delay; the benefit is that no world state ever
 * crosses the wire and desync is impossible as long as the simulation stays
 * deterministic.
 */

import type { Command } from '../sim/commands.ts';
import { DT } from '../sim/constants.ts';
import type { Match } from '../sim/match.ts';
import { INPUT_DELAY } from './protocol.ts';
import type { NetClient } from './client.ts';

export class LockstepDriver {
  /** True while the client is stalled waiting for the next bundle. */
  waiting = false;
  /** Ticks the client is behind the newest bundle it has seen. */
  behind = 0;

  private readonly bundles = new Map<number, Command[]>();
  private readonly drops = new Map<number, number[]>();
  private nextTick = 1;
  private newestSeen = 0;
  private accumulator = 0;
  private outgoing: Command[] = [];

  constructor(
    readonly match: Match,
    private readonly net: NetClient,
  ) {}

  receiveBundle(tick: number, cmds: Command[]): void {
    if (tick < this.nextTick) return;
    this.bundles.set(tick, cmds);
    if (tick > this.newestSeen) this.newestSeen = tick;
  }

  /** A player left; their slot is handed to the bots from `tick` onwards. */
  receiveDrop(slot: number, tick: number): void {
    const list = this.drops.get(tick) ?? [];
    list.push(slot);
    this.drops.set(tick, list);
  }

  queue(cmds: Command[]): void {
    if (cmds.length > 0) this.outgoing.push(...cmds);
  }

  /**
   * Advances as far as the received bundles allow. Returns the number of
   * ticks simulated.
   */
  advance(elapsedSeconds: number): number {
    this.accumulator += elapsedSeconds;
    let stepped = 0;

    // Catch up faster when behind, so a brief stall does not accumulate lag.
    const budget = this.behind > 6 ? 8 : 3;

    while (this.accumulator >= DT && stepped < budget) {
      const bundle = this.bundles.get(this.nextTick);
      if (!bundle) {
        this.waiting = true;
        // Hold the accumulator so no time is lost while stalled.
        this.accumulator = Math.min(this.accumulator, DT * 3);
        break;
      }

      this.applyDrops(this.nextTick);
      this.match.step(bundle);
      this.bundles.delete(this.nextTick);
      this.nextTick++;
      this.accumulator -= DT;
      stepped++;
      this.waiting = false;
    }

    this.behind = Math.max(0, this.newestSeen - this.nextTick);
    this.flushOutgoing();
    return stepped;
  }

  private applyDrops(tick: number): void {
    const slots = this.drops.get(tick);
    if (!slots) return;
    this.drops.delete(tick);
    for (const slot of slots) {
      const unit = this.match.championOf(slot);
      // Handing the champion to the bot controller keeps the game playable
      // and stays deterministic, because every client does it on this tick.
      if (unit?.champion) unit.champion.isBot = true;
    }
  }

  /** Sends queued input tagged for a tick far enough ahead to arrive in time. */
  private flushOutgoing(): void {
    if (this.outgoing.length === 0) return;
    const target = this.nextTick + INPUT_DELAY;
    this.net.sendCommands(target, this.outgoing);
    this.outgoing = [];
  }

  get tick(): number {
    return this.nextTick - 1;
  }
}
