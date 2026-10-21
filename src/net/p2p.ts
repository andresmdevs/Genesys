/**
 * Peer-to-peer rooms.
 *
 * One player hosts: their browser runs the room logic and relays the tick
 * bundles to everyone else over WebRTC data channels. A public signalling
 * broker introduces the peers and is not used again once they are talking,
 * so a game between friends needs no server, no account and no deployment.
 *
 * The trade-off is NAT traversal: most networks connect fine through STUN,
 * but a few strict ones need a relay the free brokers do not provide. The
 * dedicated room server stays available for those.
 */

import Peer, { type DataConnection } from 'peerjs';
import type { Command } from '../sim/commands.ts';
import type { NetHandlers, RoomLink } from './client.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol.ts';
import { RoomCore, type RoomTransport } from './room-core.ts';

/** Unambiguous alphabet: no O/0, no I/1, so a code can be read aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'genesys-';

export function makeRoomCode(length = 5): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const normaliseCode = (code: string): string =>
  code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const peerIdFor = (code: string): string => PREFIX + normaliseCode(code);

const noopHandlers: NetHandlers = {
  onLobby: () => {},
  onStart: () => {},
  onTick: () => {},
  onDropped: () => {},
  onClosed: () => {},
  onError: () => {},
};

export interface P2POptions {
  /** Custom signalling broker, for anyone running their own PeerServer. */
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  /** Seconds the lobby waits before filling the empty seats with bots. */
  waitSeconds?: number;
}

type PeerConfig = NonNullable<ConstructorParameters<typeof Peer>[1]>;

function peerConfig(options: P2POptions): PeerConfig {
  if (!options.host) return { debug: 0 };
  return {
    debug: 0,
    host: options.host,
    port: options.port ?? (options.secure === false ? 80 : 443),
    path: options.path ?? '/',
    secure: options.secure ?? true,
  };
}

/* ------------------------------------------------------------------ *
 * Host
 * ------------------------------------------------------------------ */

const LOCAL = 'local';

export class PeerHost implements RoomLink {
  handlers: NetHandlers = noopHandlers;
  slot = -1;
  readonly code: string;

  private readonly peer: Peer;
  private readonly room: RoomCore;
  private readonly connections = new Map<string, DataConnection>();
  private closed = false;

  constructor(code: string, options: P2POptions = {}) {
    this.code = normaliseCode(code);
    this.peer = new Peer(peerIdFor(this.code), peerConfig(options));

    const transport: RoomTransport = {
      send: (peerId, msg) => this.deliver(peerId, msg),
      broadcast: (msg) => {
        this.deliver(LOCAL, msg);
        for (const id of this.connections.keys()) this.deliver(id, msg);
      },
    };

    this.room = new RoomCore(transport, { waitSeconds: options.waitSeconds });
    this.room.join(LOCAL);

    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('error', (err) => {
      if (this.closed) return;
      this.handlers.onError(describePeerError(err));
    });
  }

  /** Resolves once the broker has registered the room code. */
  open(name: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const done = (): void => {
        this.room.receive(LOCAL, { t: 'hello', version: PROTOCOL_VERSION, name });
        resolve(this.code);
      };
      if (this.peer.open) {
        done();
        return;
      }
      this.peer.once('open', done);
      this.peer.once('error', (err: Error) => reject(new Error(describePeerError(err))));
    });
  }

  private accept(conn: DataConnection): void {
    if (!this.room.acceptsPlayers) {
      conn.on('open', () => {
        conn.send({ t: 'error', message: 'La sala está llena o la partida ya empezó.' });
        setTimeout(() => conn.close(), 150);
      });
      return;
    }

    this.connections.set(conn.peer, conn);
    this.room.join(conn.peer);

    conn.on('data', (data) => {
      this.room.receive(conn.peer, data as ClientMessage);
    });
    const drop = (): void => {
      this.connections.delete(conn.peer);
      this.room.leave(conn.peer);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private deliver(peerId: string, msg: ServerMessage): void {
    if (peerId === LOCAL) {
      this.applyLocal(msg);
      return;
    }
    const conn = this.connections.get(peerId);
    if (conn?.open) conn.send(msg);
  }

  private applyLocal(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.slot = msg.slot;
        break;
      case 'lobby':
        this.handlers.onLobby(msg.players, msg.secondsLeft);
        break;
      case 'start':
        this.slot = msg.slot;
        this.handlers.onStart(msg.seed, msg.picks, msg.slot);
        break;
      case 'tick':
        this.handlers.onTick(msg.tick, msg.cmds);
        break;
      case 'dropped':
        this.handlers.onDropped(msg.slot, msg.tick);
        break;
      case 'error':
        this.handlers.onError(msg.message);
        break;
      case 'ping':
        break;
    }
  }

  private local(msg: ClientMessage): void {
    this.room.receive(LOCAL, msg);
  }

  pick(championId: string): void {
    this.local({ t: 'pick', championId });
  }

  claimSeat(slot: number): void {
    this.local({ t: 'seat', slot });
  }

  setReady(ready: boolean): void {
    this.local({ t: 'ready', ready });
  }

  /** Starts now rather than waiting out the countdown. */
  startNow(): void {
    this.room.forceStart();
  }

  sendCommands(tick: number, cmds: Command[]): void {
    if (cmds.length === 0) return;
    this.local({ t: 'cmd', tick, cmds });
  }

  close(): void {
    this.closed = true;
    this.room.dispose();
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.peer.destroy();
  }

  get connected(): boolean {
    return !this.closed && this.peer.open;
  }

  get guestCount(): number {
    return this.connections.size;
  }
}

/* ------------------------------------------------------------------ *
 * Guest
 * ------------------------------------------------------------------ */

export class PeerGuest implements RoomLink {
  handlers: NetHandlers = noopHandlers;
  slot = -1;

  private readonly peer: Peer;
  private conn: DataConnection | null = null;
  private closed = false;

  constructor(
    private readonly code: string,
    private readonly options: P2POptions = {},
  ) {
    this.peer = new Peer(peerConfig(options));
  }

  connect(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const fail = (message: string): void => reject(new Error(message));

      const dial = (): void => {
        const conn = this.peer.connect(peerIdFor(this.code), { reliable: true });
        this.conn = conn;

        // A code nobody is hosting never opens, so do not wait for ever.
        const timer = setTimeout(() => {
          if (!conn.open) fail('Nadie está alojando esa sala. Revisa el código.');
        }, 12000);

        conn.on('open', () => {
          clearTimeout(timer);
          conn.send({ t: 'hello', version: PROTOCOL_VERSION, name });
          resolve();
        });
        conn.on('data', (data) => this.apply(data as ServerMessage));
        conn.on('close', () => {
          if (!this.closed) this.handlers.onClosed('El anfitrión cerró la sala.');
        });
        conn.on('error', (err: Error) => {
          clearTimeout(timer);
          fail(describePeerError(err));
        });
      };

      if (this.peer.open) dial();
      else {
        this.peer.once('open', dial);
        this.peer.once('error', (err: Error) => fail(describePeerError(err)));
      }
      void this.options;
    });
  }

  private apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.slot = msg.slot;
        break;
      case 'lobby':
        this.handlers.onLobby(msg.players, msg.secondsLeft);
        break;
      case 'start':
        this.slot = msg.slot;
        this.handlers.onStart(msg.seed, msg.picks, msg.slot);
        break;
      case 'tick':
        this.handlers.onTick(msg.tick, msg.cmds);
        break;
      case 'dropped':
        this.handlers.onDropped(msg.slot, msg.tick);
        break;
      case 'error':
        this.handlers.onError(msg.message);
        break;
      case 'ping':
        break;
    }
  }

  private send(msg: ClientMessage): void {
    if (this.conn?.open) this.conn.send(msg);
  }

  pick(championId: string): void {
    this.send({ t: 'pick', championId });
  }

  claimSeat(slot: number): void {
    this.send({ t: 'seat', slot });
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  sendCommands(tick: number, cmds: Command[]): void {
    if (cmds.length === 0) return;
    this.send({ t: 'cmd', tick, cmds });
  }

  close(): void {
    this.closed = true;
    this.conn?.close();
    this.peer.destroy();
  }

  get connected(): boolean {
    return !this.closed && Boolean(this.conn?.open);
  }
}

/** Turns a PeerJS error into something a player can act on. */
function describePeerError(err: unknown): string {
  const type = (err as { type?: string }).type ?? '';
  switch (type) {
    case 'peer-unavailable':
      return 'Nadie está alojando esa sala. Revisa el código.';
    case 'unavailable-id':
      return 'Ese código ya está en uso. Genera otro.';
    case 'browser-incompatible':
      return 'Este navegador no admite conexiones directas. Usa Chrome, Edge o Firefox.';
    case 'network':
    case 'server-error':
      return 'No se pudo contactar con el servicio de emparejamiento. Reintenta en unos segundos.';
    case 'webrtc':
      return 'La conexión directa falló. Puede que tu red la bloquee; prueba con un servidor propio.';
    default:
      return (err as Error)?.message ?? 'Fallo de conexión.';
  }
}
