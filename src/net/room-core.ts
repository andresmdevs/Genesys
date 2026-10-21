/**
 * The room logic, with no transport attached.
 *
 * The same rules run in three places: a Cloudflare Durable Object, a Node
 * process, and - through this module - inside the browser of whoever hosts a
 * peer-to-peer game. Keeping it transport-agnostic means a lobby behaves
 * identically however the players reached each other.
 *
 * It never simulates the game. It assigns seats, counts down, and relays one
 * bundle of commands per tick.
 */

import type { Command } from '../sim/commands.ts';
import {
  INPUT_DELAY,
  LOBBY_WAIT_SECONDS,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type LobbyPlayer,
  type Pick,
  type ServerMessage,
} from './protocol.ts';
import { TICK_RATE } from '../sim/constants.ts';
import { createTicker, type StopTicker } from './ticker.ts';

interface Seat {
  peerId: string;
  slot: number;
  name: string;
  championId: string | null;
  ready: boolean;
  joined: boolean;
}

export interface RoomTransport {
  send(peerId: string, msg: ServerMessage): void;
  broadcast(msg: ServerMessage): void;
}

export interface RoomOptions {
  /** Seconds to wait for more players before filling with bots. */
  waitSeconds?: number;
}

const MAX_BUFFERED_TICKS = 300;

export class RoomCore {
  private readonly seats = new Map<string, Seat>();
  private readonly buckets = new Map<number, Command[]>();
  private readonly waitSeconds: number;

  started = false;
  tick = 0;

  private lobbyEndsAt = 0;
  private stopClock: StopTicker | null = null;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly transport: RoomTransport,
    options: RoomOptions = {},
  ) {
    this.waitSeconds = options.waitSeconds ?? LOBBY_WAIT_SECONDS;
  }

  get playerCount(): number {
    return [...this.seats.values()].filter((s) => s.joined).length;
  }

  get acceptsPlayers(): boolean {
    return !this.started && this.seats.size < MAX_PLAYERS;
  }

  join(peerId: string): void {
    if (this.seats.has(peerId)) return;
    this.seats.set(peerId, {
      peerId,
      slot: this.freeSlot(),
      name: 'Jugador',
      championId: null,
      ready: false,
      joined: false,
    });
  }

  leave(peerId: string): void {
    const seat = this.seats.get(peerId);
    if (!seat) return;
    this.seats.delete(peerId);

    if (this.started) {
      // Hand the champion to the bots on a tick every client agrees on.
      this.transport.broadcast({ t: 'dropped', slot: seat.slot, tick: this.tick + INPUT_DELAY });
      if (this.seats.size === 0) this.dispose();
      return;
    }
    this.broadcastLobby();
    if (this.seats.size === 0) this.stopCountdown();
  }

  receive(peerId: string, msg: ClientMessage): void {
    const seat = this.seats.get(peerId);
    if (!seat) return;

    switch (msg.t) {
      case 'hello': {
        if (seat.joined) return;
        if (msg.version !== PROTOCOL_VERSION) {
          this.transport.send(peerId, {
            t: 'error',
            message: 'Versión incompatible. Recarga la página.',
          });
          return;
        }
        seat.joined = true;
        seat.name = String(msg.name ?? 'Jugador').slice(0, 20) || 'Jugador';
        this.transport.send(peerId, { t: 'welcome', slot: seat.slot, version: PROTOCOL_VERSION });
        this.startCountdown();
        this.broadcastLobby();
        break;
      }

      case 'seat': {
        if (this.started) return;
        const slot = Number(msg.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PLAYERS) return;
        // Somebody already sitting there trades places, so an auto-assigned
        // seat can never block the player who actually wants it.
        const occupant = [...this.seats.values()].find(
          (other) => other !== seat && other.joined && other.slot === slot,
        );
        const previous = seat.slot;
        seat.slot = slot;
        if (occupant) {
          occupant.slot = previous;
          this.transport.send(occupant.peerId, {
            t: 'welcome',
            slot: previous,
            version: PROTOCOL_VERSION,
          });
        }
        // Tell the asker which seat is now theirs; without this their lobby
        // keeps highlighting the one they were first given.
        this.transport.send(peerId, { t: 'welcome', slot, version: PROTOCOL_VERSION });
        this.broadcastLobby();
        break;
      }

      case 'pick':
        if (this.started) return;
        seat.championId = String(msg.championId ?? '').slice(0, 40) || null;
        this.broadcastLobby();
        break;

      case 'ready':
        if (this.started) return;
        seat.ready = Boolean(msg.ready);
        this.broadcastLobby();
        this.maybeStart();
        break;

      case 'cmd': {
        if (!this.started || !Array.isArray(msg.cmds)) return;
        const target = Math.max(Number(msg.tick) || 0, this.tick + 1);
        if (target > this.tick + MAX_BUFFERED_TICKS) return;
        const bucket = this.buckets.get(target) ?? [];
        // Stamp the sender's slot so nobody can order another champion about.
        for (const cmd of msg.cmds) {
          if (cmd && typeof cmd === 'object') {
            bucket.push({ ...(cmd as object), slot: seat.slot } as Command);
          }
        }
        this.buckets.set(target, bucket);
        break;
      }

      case 'pong':
        break;
    }
  }

  /** Starts immediately, filling the empty seats with bots. */
  forceStart(): void {
    this.start();
  }

  private freeSlot(): number {
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    // Alternate sides so two people who just join land opposite each other,
    // then let them move with a seat claim.
    const order = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
    return order.find((slot) => !used.has(slot)) ?? 0;
  }

  private startCountdown(): void {
    if (this.lobbyTimer || this.started) return;
    this.lobbyEndsAt = Date.now() + this.waitSeconds * 1000;
    this.lobbyTimer = setInterval(() => {
      if (this.started) return;
      if (Date.now() >= this.lobbyEndsAt) this.start();
      else this.broadcastLobby();
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
  }

  private maybeStart(): void {
    if (this.started) return;
    const players = [...this.seats.values()].filter((s) => s.joined);
    if (players.length > 0 && players.every((p) => p.ready)) this.start();
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return [...this.seats.values()]
      .filter((s) => s.joined)
      .map((s) => ({
        slot: s.slot,
        name: s.name,
        championId: s.championId,
        ready: s.ready,
        bot: false,
      }))
      .sort((a, b) => a.slot - b.slot);
  }

  private broadcastLobby(): void {
    if (this.started) return;
    const secondsLeft = Math.max(0, Math.round((this.lobbyEndsAt - Date.now()) / 1000));
    this.transport.broadcast({ t: 'lobby', players: this.lobbyPlayers(), secondsLeft });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.stopCountdown();
    this.tick = 0;

    const seed = (Math.random() * 0xffffffff) >>> 0;
    const picks: Pick[] = this.lobbyPlayers().map((p) => ({
      slot: p.slot,
      name: p.name,
      championId: p.championId,
    }));

    for (const seat of this.seats.values()) {
      if (seat.joined) {
        this.transport.send(seat.peerId, { t: 'start', seed, picks, slot: seat.slot });
      }
    }

    // The clock runs in a worker: a host whose tab loses focus must not slow
    // the match down for everyone else in the room.
    this.stopClock = createTicker(1000 / TICK_RATE, () => {
      this.tick++;
      const cmds = this.buckets.get(this.tick) ?? [];
      this.buckets.delete(this.tick);
      this.transport.broadcast({ t: 'tick', tick: this.tick, cmds });
    });
  }

  dispose(): void {
    this.stopClock?.();
    this.stopClock = null;
    this.stopCountdown();
  }
}
