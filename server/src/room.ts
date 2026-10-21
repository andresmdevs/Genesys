/**
 * One Durable Object per room. It holds the lobby, the match clock and the
 * command relay.
 *
 * The server never simulates the game. Clients run identical deterministic
 * simulations and the server only decides which commands belong to which
 * tick, which is why a room costs almost nothing to host.
 */

import {
  INPUT_DELAY,
  LOBBY_WAIT_SECONDS,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  TICK_RATE,
  type ClientMessage,
  type Command,
  type LobbyPlayer,
  type Pick,
  type ServerMessage,
} from './protocol.ts';

interface Session {
  socket: WebSocket;
  slot: number;
  name: string;
  championId: string | null;
  ready: boolean;
  joined: boolean;
}

/** Commands are dropped rather than buffered without bound. */
const MAX_BUFFERED_TICKS = 300;

export class Room {
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly buckets = new Map<number, Command[]>();

  private started = false;
  private tick = 0;
  private seed = 0;
  private lobbyEndsAt = 0;
  private clock: ReturnType<typeof setInterval> | null = null;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Se esperaba una conexión WebSocket.', { status: 426 });
    }
    if (this.started) {
      // A room in progress cannot take new players; the client retries on
      // another room name.
      return new Response('La partida ya ha comenzado.', { status: 409 });
    }
    if (this.sessions.size >= MAX_PLAYERS) {
      return new Response('Sala llena.', { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------------------------------------------------------------- *
   * Sessions
   * ---------------------------------------------------------------- */

  private attach(socket: WebSocket): void {
    const session: Session = {
      socket,
      slot: -1,
      name: 'Jugador',
      championId: null,
      ready: false,
      joined: false,
    };
    this.sessions.set(socket, session);

    socket.addEventListener('message', (event: MessageEvent) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(event.data)) as ClientMessage;
      } catch {
        return;
      }
      this.onMessage(session, msg);
    });

    const close = (): void => this.onClose(session);
    socket.addEventListener('close', close);
    socket.addEventListener('error', close);
  }

  private onMessage(session: Session, msg: ClientMessage): void {
    switch (msg.t) {
      case 'hello': {
        if (session.joined) return;
        if (msg.version !== PROTOCOL_VERSION) {
          this.send(session, {
            t: 'error',
            message: 'Tu versión del juego no coincide con la del servidor. Recarga la página.',
          });
          session.socket.close(1002, 'version mismatch');
          return;
        }
        session.joined = true;
        session.name = String(msg.name ?? 'Jugador').slice(0, 20) || 'Jugador';
        session.slot = this.claimSlot();
        this.send(session, { t: 'welcome', slot: session.slot, version: PROTOCOL_VERSION });
        this.beginLobbyCountdown();
        this.broadcastLobby();
        break;
      }

      case 'pick':
        if (this.started) return;
        session.championId = String(msg.championId ?? '').slice(0, 40) || null;
        this.broadcastLobby();
        break;

      case 'ready':
        if (this.started) return;
        session.ready = Boolean(msg.ready);
        this.broadcastLobby();
        this.maybeStart();
        break;

      case 'cmd': {
        if (!this.started || !Array.isArray(msg.cmds)) return;
        // Schedule for the requested tick, but never in the past: a late
        // packet still gets applied, one tick from now.
        const target = Math.max(Number(msg.tick) || 0, this.tick + 1);
        if (target > this.tick + MAX_BUFFERED_TICKS) return;
        const bucket = this.buckets.get(target) ?? [];
        // Stamp every command with its sender's slot so a client cannot move
        // somebody else's champion.
        for (const cmd of msg.cmds) {
          if (cmd && typeof cmd === 'object') bucket.push({ ...cmd, slot: session.slot });
        }
        this.buckets.set(target, bucket);
        break;
      }

      case 'pong':
        break;
    }
  }

  private onClose(session: Session): void {
    if (!this.sessions.delete(session.socket)) return;

    if (this.started) {
      if (session.slot >= 0) {
        // Hand the champion to the bots on a tick every client agrees on.
        this.broadcast({ t: 'dropped', slot: session.slot, tick: this.tick + INPUT_DELAY });
      }
      if (this.sessions.size === 0) this.stopClock();
      return;
    }

    this.broadcastLobby();
    if (this.sessions.size === 0) this.stopLobbyCountdown();
  }

  private claimSlot(): number {
    const used = new Set<number>();
    for (const s of this.sessions.values()) if (s.slot >= 0) used.add(s.slot);
    // Alternate sides so the teams fill evenly: 0, 5, 1, 6, 2, 7...
    const order = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
    for (const slot of order) if (!used.has(slot)) return slot;
    return 0;
  }

  /* ---------------------------------------------------------------- *
   * Lobby
   * ---------------------------------------------------------------- */

  private beginLobbyCountdown(): void {
    if (this.lobbyTimer || this.started) return;
    this.lobbyEndsAt = Date.now() + LOBBY_WAIT_SECONDS * 1000;
    this.lobbyTimer = setInterval(() => {
      if (this.started) return;
      if (Date.now() >= this.lobbyEndsAt) {
        // Waited long enough: start with whoever is here and fill the rest
        // with bots, which is the whole point of the countdown.
        this.start();
      } else {
        this.broadcastLobby();
      }
    }, 1000);
  }

  private stopLobbyCountdown(): void {
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
  }

  private maybeStart(): void {
    if (this.started) return;
    const players = [...this.sessions.values()].filter((s) => s.joined);
    if (players.length === 0) return;
    // Everyone present has pressed ready: no reason to keep them waiting.
    if (players.every((p) => p.ready)) this.start();
  }

  private lobbyPlayers(): LobbyPlayer[] {
    const out: LobbyPlayer[] = [];
    for (const s of this.sessions.values()) {
      if (!s.joined) continue;
      out.push({
        slot: s.slot,
        name: s.name,
        championId: s.championId,
        ready: s.ready,
        bot: false,
      });
    }
    return out.sort((a, b) => a.slot - b.slot);
  }

  private broadcastLobby(): void {
    if (this.started) return;
    const secondsLeft = Math.max(0, Math.round((this.lobbyEndsAt - Date.now()) / 1000));
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), secondsLeft });
  }

  /* ---------------------------------------------------------------- *
   * Match
   * ---------------------------------------------------------------- */

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.stopLobbyCountdown();

    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.tick = 0;

    const picks: Pick[] = this.lobbyPlayers().map((p) => ({
      slot: p.slot,
      name: p.name,
      championId: p.championId,
    }));

    for (const session of this.sessions.values()) {
      if (!session.joined) continue;
      this.send(session, { t: 'start', seed: this.seed, picks, slot: session.slot });
    }

    this.clock = setInterval(() => this.advance(), 1000 / TICK_RATE);
  }

  private advance(): void {
    this.tick++;
    const cmds = this.buckets.get(this.tick) ?? [];
    this.buckets.delete(this.tick);
    this.broadcast({ t: 'tick', tick: this.tick, cmds });
  }

  private stopClock(): void {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
  }

  /* ---------------------------------------------------------------- *
   * Transport
   * ---------------------------------------------------------------- */

  private send(session: Session, msg: ServerMessage): void {
    try {
      session.socket.send(JSON.stringify(msg));
    } catch {
      this.sessions.delete(session.socket);
    }
  }

  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const session of [...this.sessions.values()]) {
      try {
        session.socket.send(payload);
      } catch {
        this.sessions.delete(session.socket);
      }
    }
  }
}
