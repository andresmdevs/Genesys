/**
 * Wire protocol shared by the client and the room server.
 *
 * Genesys runs deterministic lockstep: every client simulates the same world
 * from the same seed, and the server only decides which commands belong to
 * which tick. That keeps the server stateless about the game itself - it
 * never needs to know what a champion is - so it costs almost nothing to run
 * and the whole match stays in sync by construction.
 */

import type { Command } from '../sim/commands.ts';

export const PROTOCOL_VERSION = 1;

/** Ticks between issuing a command and the tick it is applied on. */
export const INPUT_DELAY = 4;

/** How long matchmaking waits for humans before filling the rest with bots. */
export const LOBBY_WAIT_SECONDS = 300;

export const MAX_PLAYERS = 10;

export interface LobbyPlayer {
  slot: number;
  name: string;
  championId: string | null;
  ready: boolean;
  bot: boolean;
}

export interface Pick {
  slot: number;
  name: string;
  /** null when the slot is a bot, or a human who never picked. */
  championId: string | null;
}

export type ClientMessage =
  | { t: 'hello'; version: number; name: string }
  | { t: 'pick'; championId: string }
  | { t: 'ready'; ready: boolean }
  /** Commands the client wants applied on `tick`. */
  | { t: 'cmd'; tick: number; cmds: Command[] }
  | { t: 'pong'; id: number };

export type ServerMessage =
  | { t: 'welcome'; slot: number; version: number }
  | { t: 'lobby'; players: LobbyPlayer[]; secondsLeft: number }
  /**
   * The match is starting. The server sends only the seed and who picked
   * what; each client derives the identical roster from that, so the server
   * never needs to know a single thing about champions.
   */
  | { t: 'start'; seed: number; picks: Pick[]; slot: number }
  /** The authoritative command bundle for one tick. */
  | { t: 'tick'; tick: number; cmds: Command[] }
  /** A player left; their slot is handed to the bot controller from `tick`. */
  | { t: 'dropped'; slot: number; tick: number }
  | { t: 'ping'; id: number }
  | { t: 'error'; message: string };

export const encode = (msg: ClientMessage | ServerMessage): string => JSON.stringify(msg);

export function decode<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
