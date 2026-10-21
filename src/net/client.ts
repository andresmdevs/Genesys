/**
 * WebSocket client for the room server. It carries lobby state and tick
 * bundles; it never carries world state, because every client simulates the
 * world itself.
 */

import type { Command } from '../sim/commands.ts';
import {
  PROTOCOL_VERSION,
  decode,
  encode,
  type ClientMessage,
  type LobbyPlayer,
  type Pick,
  type ServerMessage,
} from './protocol.ts';

export interface NetHandlers {
  onLobby(players: LobbyPlayer[], secondsLeft: number): void;
  onStart(seed: number, picks: Pick[], slot: number): void;
  onTick(tick: number, cmds: Command[]): void;
  onDropped(slot: number, tick: number): void;
  onClosed(reason: string): void;
  onError(message: string): void;
}

export class NetClient {
  slot = -1;
  /** Round-trip time in milliseconds, or -1 before the first ping. */
  latency = -1;

  private socket: WebSocket | null = null;
  private pingSentAt = 0;
  private closedByUs = false;

  constructor(
    private readonly url: string,
    /** Reassigned when the match screen takes over from the lobby. */
    public handlers: NetHandlers,
  ) {}

  connect(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.socket = socket;

      const failed = (message: string): void => {
        reject(new Error(message));
      };

      socket.addEventListener('open', () => {
        this.send({ t: 'hello', version: PROTOCOL_VERSION, name });
        resolve();
      });

      socket.addEventListener('message', (event) => {
        const msg = decode<ServerMessage>(String(event.data));
        if (!msg) return;
        this.handle(msg);
      });

      socket.addEventListener('error', () => failed('No se pudo conectar con el servidor.'));

      socket.addEventListener('close', (event) => {
        if (this.closedByUs) return;
        this.handlers.onClosed(event.reason || 'Conexión cerrada.');
      });
    });
  }

  private handle(msg: ServerMessage): void {
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
      case 'ping':
        // The server times the round trip; echo immediately.
        this.pingSentAt = performance.now();
        this.send({ t: 'pong', id: msg.id });
        this.latency = Math.round(performance.now() - this.pingSentAt);
        break;
      case 'error':
        this.handlers.onError(msg.message);
        break;
    }
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encode(msg));
  }

  pick(championId: string): void {
    this.send({ t: 'pick', championId });
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  sendCommands(tick: number, cmds: Command[]): void {
    if (cmds.length === 0) return;
    this.send({ t: 'cmd', tick, cmds });
  }

  close(): void {
    this.closedByUs = true;
    this.socket?.close();
    this.socket = null;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}
