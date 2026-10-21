import type { AbilityKey } from './types.ts';

/**
 * Everything a player can do in a tick, in a form that survives JSON
 * serialisation. The online server receives exactly these and feeds them to
 * the same `World.step` the offline game uses.
 */
export type Command =
  | { t: 'move'; slot: number; x: number; y: number }
  | { t: 'attackMove'; slot: number; x: number; y: number }
  | { t: 'attackUnit'; slot: number; target: number }
  | { t: 'stop'; slot: number }
  | { t: 'cast'; slot: number; key: AbilityKey; x: number; y: number; target: number }
  | { t: 'levelUp'; slot: number; key: AbilityKey }
  | { t: 'buy'; slot: number; item: string }
  | { t: 'sell'; slot: number; index: number }
  | { t: 'recall'; slot: number }
  | { t: 'flash'; slot: number; x: number; y: number }
  | { t: 'heal'; slot: number }
  | { t: 'ping'; slot: number; x: number; y: number; kind: number };

export type CommandType = Command['t'];
