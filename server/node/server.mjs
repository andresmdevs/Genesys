/**
 * Self-hosted room server.
 *
 * Does exactly what the Cloudflare Durable Object does, for anyone who would
 * rather run their own box: holds the lobby, waits up to five minutes for
 * players, fills the rest with bots and then relays one command bundle per
 * tick. It never simulates the game.
 *
 *   npm install ws
 *   node server/node/server.mjs --port 8787
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PROTOCOL_VERSION = 1;
const INPUT_DELAY = 4;
const LOBBY_WAIT_SECONDS = Number(process.env.LOBBY_WAIT ?? 300);
const MAX_PLAYERS = 10;
const TICK_RATE = 30;
const MAX_BUFFERED_TICKS = 300;

const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : (process.env.PORT ?? 8787));

/** Slots alternate sides so the teams fill evenly. */
const SLOT_ORDER = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];

class Room {
  constructor(name) {
    this.name = name;
    this.sessions = new Set();
    this.buckets = new Map();
    this.started = false;
    this.tick = 0;
    this.lobbyEndsAt = 0;
    this.clock = null;
    this.lobbyTimer = null;
  }

  get open() {
    return !this.started && this.sessions.size < MAX_PLAYERS;
  }

  add(socket) {
    const session = {
      socket,
      slot: this.claimSlot(),
      name: 'Jugador',
      championId: null,
      ready: false,
      joined: false,
    };
    this.sessions.add(session);

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.onMessage(session, msg);
    });
    const close = () => this.onClose(session);
    socket.on('close', close);
    socket.on('error', close);
  }

  claimSlot() {
    const used = new Set([...this.sessions].map((s) => s.slot));
    return SLOT_ORDER.find((s) => !used.has(s)) ?? 0;
  }

  onMessage(session, msg) {
    switch (msg.t) {
      case 'hello': {
        if (session.joined) return;
        if (msg.version !== PROTOCOL_VERSION) {
          this.send(session, { t: 'error', message: 'Versión incompatible. Recarga la página.' });
          session.socket.close(1002, 'version mismatch');
          return;
        }
        session.joined = true;
        session.name = String(msg.name ?? 'Jugador').slice(0, 20) || 'Jugador';
        this.send(session, { t: 'welcome', slot: session.slot, version: PROTOCOL_VERSION });
        this.beginCountdown();
        this.broadcastLobby();
        break;
      }
      case 'seat': {
        if (this.started) return;
        const slot = Number(msg.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PLAYERS) return;
        // Somebody already sitting there trades places, so an auto-assigned
        // seat can never block the player who actually wants it.
        const occupant = [...this.sessions].find(
          (other) => other !== session && other.joined && other.slot === slot,
        );
        const previous = session.slot;
        session.slot = slot;
        if (occupant) {
          occupant.slot = previous;
          this.send(occupant, { t: 'welcome', slot: previous, version: PROTOCOL_VERSION });
        }
        // Tell the asker which seat is now theirs; without this their lobby
        // keeps highlighting the one they were first given.
        this.send(session, { t: 'welcome', slot, version: PROTOCOL_VERSION });
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
        const target = Math.max(Number(msg.tick) || 0, this.tick + 1);
        if (target > this.tick + MAX_BUFFERED_TICKS) return;
        const bucket = this.buckets.get(target) ?? [];
        // Stamp the sender's slot so nobody can order another champion about.
        for (const cmd of msg.cmds) {
          if (cmd && typeof cmd === 'object') bucket.push({ ...cmd, slot: session.slot });
        }
        this.buckets.set(target, bucket);
        break;
      }
      default:
        break;
    }
  }

  onClose(session) {
    if (!this.sessions.delete(session)) return;
    if (this.started) {
      this.broadcast({ t: 'dropped', slot: session.slot, tick: this.tick + INPUT_DELAY });
      if (this.sessions.size === 0) this.stop();
      return;
    }
    this.broadcastLobby();
    if (this.sessions.size === 0) this.stopCountdown();
  }

  beginCountdown() {
    if (this.lobbyTimer || this.started) return;
    this.lobbyEndsAt = Date.now() + LOBBY_WAIT_SECONDS * 1000;
    this.lobbyTimer = setInterval(() => {
      if (this.started) return;
      if (Date.now() >= this.lobbyEndsAt) this.start();
      else this.broadcastLobby();
    }, 1000);
  }

  stopCountdown() {
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
  }

  maybeStart() {
    if (this.started) return;
    const players = [...this.sessions].filter((s) => s.joined);
    if (players.length > 0 && players.every((p) => p.ready)) this.start();
  }

  players() {
    return [...this.sessions]
      .filter((s) => s.joined)
      .map((s) => ({ slot: s.slot, name: s.name, championId: s.championId, ready: s.ready, bot: false }))
      .sort((a, b) => a.slot - b.slot);
  }

  broadcastLobby() {
    if (this.started) return;
    const secondsLeft = Math.max(0, Math.round((this.lobbyEndsAt - Date.now()) / 1000));
    this.broadcast({ t: 'lobby', players: this.players(), secondsLeft });
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stopCountdown();
    this.tick = 0;

    const seed = (Math.random() * 0xffffffff) >>> 0;
    const picks = this.players().map((p) => ({ slot: p.slot, name: p.name, championId: p.championId }));
    for (const session of this.sessions) {
      if (session.joined) this.send(session, { t: 'start', seed, picks, slot: session.slot });
    }
    console.log(`[${this.name}] empieza la partida con ${picks.length} jugador(es)`);

    this.clock = setInterval(() => {
      this.tick++;
      const cmds = this.buckets.get(this.tick) ?? [];
      this.buckets.delete(this.tick);
      this.broadcast({ t: 'tick', tick: this.tick, cmds });
    }, 1000 / TICK_RATE);
  }

  stop() {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
    this.stopCountdown();
    console.log(`[${this.name}] sala vacía, se cierra`);
  }

  send(session, msg) {
    try {
      session.socket.send(JSON.stringify(msg));
    } catch {
      this.sessions.delete(session);
    }
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const session of [...this.sessions]) {
      try {
        session.socket.send(payload);
      } catch {
        this.sessions.delete(session);
      }
    }
  }
}

const rooms = new Map();

function roomFor(name) {
  const existing = rooms.get(name);
  if (existing?.open) return existing;
  // A started or full room is rotated out so new players land in a fresh one.
  const room = new Room(`${name}#${Date.now().toString(36)}`);
  rooms.set(name, room);
  return room;
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Servidor de salas de Genesys. Conecta a /ws?room=<nombre>.');
});

const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  roomFor(url.searchParams.get('room') ?? 'public-1').add(socket);
});

http.listen(PORT, () => {
  console.log(`Genesys: servidor de salas escuchando en ws://localhost:${PORT}/ws`);
  console.log(`Espera de emparejamiento: ${LOBBY_WAIT_SECONDS}s antes de rellenar con bots.`);
});
