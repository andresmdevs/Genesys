/**
 * Wire protocol, duplicated from `src/net/protocol.ts` so the server can be
 * deployed on its own. The server is deliberately game-agnostic: it moves
 * commands around and never inspects them.
 */

export const PROTOCOL_VERSION = 1;
export const INPUT_DELAY = 4;
export const LOBBY_WAIT_SECONDS = 300;
export const MAX_PLAYERS = 10;
export const TICK_RATE = 30;

/** Opaque to the server: it only ever relays these. */
export type Command = Record<string, unknown>;

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
  championId: string | null;
}

export type ClientMessage =
  | { t: 'hello'; version: number; name: string }
  /** Claim a seat: slots 0-4 are blue, 5-9 red, ordered top to support. */
  | { t: 'seat'; slot: number }
  | { t: 'pick'; championId: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'cmd'; tick: number; cmds: Command[] }
  | { t: 'pong'; id: number };

export type ServerMessage =
  | { t: 'welcome'; slot: number; version: number }
  | { t: 'lobby'; players: LobbyPlayer[]; secondsLeft: number }
  | { t: 'start'; seed: number; picks: Pick[]; slot: number }
  | { t: 'tick'; tick: number; cmds: Command[] }
  | { t: 'dropped'; slot: number; tick: number }
  | { t: 'ping'; id: number }
  | { t: 'error'; message: string };
