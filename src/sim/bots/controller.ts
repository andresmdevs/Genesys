import type { Match } from '../match.ts';

/** Replaced in `bots/brain.ts`; kept separate so `match.ts` has no cycle. */
export let runBotTick: (match: Match) => void = () => {};

export function setBotController(fn: (match: Match) => void): void {
  runBotTick = fn;
}
