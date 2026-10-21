/**
 * Online mode: server address, champion select, lobby and the hand-off into a
 * lockstep match.
 *
 * Matchmaking waits up to five minutes for other players. Whatever slots are
 * still empty when the countdown runs out are filled with bots, so a game
 * always starts.
 */

import { CHAMPIONS, championsByRole, getChampion } from '../champions/index.ts';
import type { ChampionDef } from '../champions/types.ts';
import { ROLES, ROLE_NAMES, type ChampionRole } from '../sim/types.ts';
import {
  POSITIONS,
  POSITION_NAMES,
  POSITION_SHORT,
  positionOfSlot,
  slotFor,
} from '../sim/positions.ts';
import type { SlotConfig } from '../sim/match.ts';
import { NetClient, type RoomLink } from './client.ts';
import { PeerGuest, PeerHost, makeRoomCode, normaliseCode } from './p2p.ts';
import type { LobbyPlayer, Pick } from './protocol.ts';
import { buildOnlineRoster } from './roster.ts';

const STORAGE_URL = 'genesys.serverUrl';
const STORAGE_NAME = 'genesys.playerName';

const DEFAULT_URL = (import.meta.env.VITE_GENESYS_SERVER ?? '').trim();

export interface OnlineHooks {
  onCancel(): void;
  /** Called once the server says the match is starting. */
  onStart(
    champion: ChampionDef,
    seed: number,
    slots: SlotConfig[],
    slot: number,
    net: RoomLink,
  ): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const read = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing: the address simply will not be remembered.
  }
};

export function onlineScreen(parent: HTMLElement, hooks: OnlineHooks): HTMLElement {
  const screen = el('div', 'screen');
  parent.appendChild(screen);

  let net: RoomLink | null = null;
  let hostedCode = '';
  let champion: ChampionDef = CHAMPIONS[0];
  let ready = false;

  const cleanup = (): void => {
    net?.close();
    net = null;
  };

  const leave = (): void => {
    cleanup();
    hooks.onCancel();
  };

  /* -- Step 1: how to meet the other players ---------------------- */

  const showConnect = (error?: string): void => {
    screen.replaceChildren();
    screen.append(el('h2', 'title', 'JUGAR ONLINE'));
    screen.append(
      el(
        'p',
        'subtitle',
        'Crea una sala y pasa el código a quien quieras. Los puestos que nadie ocupe ' +
          'los jugarán bots, así que una partida siempre sale.',
      ),
    );

    if (error) {
      const warn = el('p', '', error);
      warn.style.cssText = 'color:var(--danger);font-size:13px;margin:0;max-width:560px';
      screen.append(warn);
    }

    const form = el('div', 'panel detail');
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Tu nombre';
    nameInput.value = read(STORAGE_NAME, 'Jugador');
    nameInput.maxLength = 20;
    styleInput(nameInput);
    form.append(el('div', 'role-label', 'Nombre'), nameInput);

    const rememberName = (): string => {
      const name = nameInput.value.trim() || 'Jugador';
      write(STORAGE_NAME, name);
      return name;
    };

    // Create a room: this browser hosts and relays for everyone else.
    const createRow = el('div', 'menu-actions');
    const createButton = el('button', 'primary', 'Crear sala');
    createButton.addEventListener('click', () => hostRoom(rememberName()));
    createRow.append(createButton);
    form.append(el('div', 'role-label', 'Partida con amigos'), createRow);

    // Join a room by code.
    const codeInput = el('input');
    codeInput.type = 'text';
    codeInput.placeholder = 'Código de la sala, por ejemplo K7PQR';
    codeInput.maxLength = 8;
    codeInput.style.textTransform = 'uppercase';
    styleInput(codeInput);
    const joinRow = el('div', 'menu-actions');
    const joinButton = el('button', '', 'Unirse');
    const tryJoin = (): void => {
      const code = normaliseCode(codeInput.value);
      if (code.length < 4) {
        showConnect('Ese código no parece válido.');
        return;
      }
      joinRoom(code, rememberName());
    };
    joinButton.addEventListener('click', tryJoin);
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryJoin();
    });
    joinRow.append(joinButton);
    form.append(codeInput, joinRow);

    // Dedicated server, for anyone who deployed one.
    const serverDetails = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Usar un servidor dedicado';
    summary.style.cssText = 'cursor:pointer;color:var(--dim);font-size:12.5px;margin-top:4px';
    serverDetails.append(summary);

    const urlInput = el('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'wss://mi-servidor.workers.dev/ws';
    urlInput.value = read(STORAGE_URL, DEFAULT_URL);
    styleInput(urlInput);
    urlInput.style.marginTop = '8px';
    const serverRow = el('div', 'menu-actions');
    const serverButton = el('button', '', 'Conectar al servidor');
    serverButton.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) {
        showConnect('Hace falta la dirección del servidor.');
        return;
      }
      write(STORAGE_URL, url);
      connectToServer(url, rememberName());
    });
    serverRow.append(serverButton);
    serverDetails.append(urlInput, serverRow);
    serverDetails.append(
      el(
        'p',
        'ability-text',
        'Más fiable en redes restrictivas. Las instrucciones para desplegar uno gratis ' +
          'están en server/README.md del repositorio.',
      ),
    );
    form.append(serverDetails);

    const back = el('button', '', 'Volver');
    back.addEventListener('click', leave);
    const backRow = el('div', 'menu-actions');
    backRow.append(back);
    form.append(backRow);

    screen.append(form);
  };

  const styleInput = (input: HTMLInputElement): void => {
    input.style.cssText =
      'padding:10px 12px;border-radius:8px;border:1px solid var(--edge);' +
      'background:rgba(10,16,28,.9);color:var(--text);font:inherit;width:100%';
  };

  const waitingScreen = (title: string, detail: string): void => {
    screen.replaceChildren();
    screen.append(el('h2', 'title', title));
    screen.append(el('p', 'subtitle', detail));
    const back = el('button', '', 'Cancelar');
    back.addEventListener('click', leave);
    screen.append(back);
  };

  const attachHandlers = (link: RoomLink): void => {
    link.handlers = {
      onLobby: (players, secondsLeft) => showLobby(players, secondsLeft),
      onStart: (seed, picks, slot) => beginMatch(seed, picks, slot),
      onTick: () => {},
      onDropped: () => {},
      onClosed: (reason) => showConnect(`Se perdió la conexión: ${reason}`),
      onError: (message) => showConnect(message),
    };
  };

  const hostRoom = (name: string): void => {
    waitingScreen('CREANDO SALA', 'Registrando el código…');
    const code = makeRoomCode();
    const host = new PeerHost(code);
    net = host;
    hostedCode = code;
    attachHandlers(host);
    host
      .open(name)
      .then(() => host.pick(champion.id))
      .catch((err: Error) => {
        net = null;
        showConnect(err.message);
      });
  };

  const joinRoom = (code: string, name: string): void => {
    waitingScreen('UNIÉNDOSE', `Buscando la sala ${code}…`);
    const guest = new PeerGuest(code);
    net = guest;
    hostedCode = '';
    attachHandlers(guest);
    guest
      .connect(name)
      .then(() => guest.pick(champion.id))
      .catch((err: Error) => {
        net = null;
        showConnect(err.message);
      });
  };

  /* -- Step 2: dedicated server ----------------------------------- */

  const connectToServer = (url: string, name: string): void => {
    waitingScreen('CONECTANDO', 'Buscando el servidor de salas…');
    const client = new NetClient(url, {
      onLobby: (players, secondsLeft) => showLobby(players, secondsLeft),
      onStart: (seed, picks, slot) => beginMatch(seed, picks, slot),
      onTick: () => {},
      onDropped: () => {},
      onClosed: (reason) => showConnect(`Se perdió la conexión: ${reason}`),
      onError: (message) => showConnect(message),
    });
    net = client;
    hostedCode = '';
    client
      .connect(name)
      .then(() => client.pick(champion.id))
      .catch((err: Error) => {
        net = null;
        showConnect(
          `${err.message} Comprueba que la dirección empieza por wss:// y que el servidor está activo.`,
        );
      });
  };

  /* -- Step 3: lobby, seat and champion select -------------------- */

  const showLobby = (players: LobbyPlayer[], secondsLeft: number): void => {
    screen.replaceChildren();
    screen.append(el('h2', 'title', 'SALA'));

    const humans = players.length;
    const mySlot = net?.slot ?? -1;
    screen.append(
      el(
        'p',
        'subtitle',
        humans >= 10
          ? 'Sala completa. Marcad listos para empezar.'
          : `${humans} de 10 jugadores. Elige equipo y posición; los puestos libres los ` +
            `ocuparán bots en ${Math.floor(secondsLeft / 60)}:` +
            `${String(secondsLeft % 60).padStart(2, '0')}. Pulsad listos para empezar antes.`,
      ),
    );

    if (hostedCode) {
      const share = el('div', 'room-code panel');
      share.append(el('span', 'room-code-label', 'Código de la sala'));
      share.append(el('span', 'room-code-value', hostedCode));
      const copy = el('button', '', 'Copiar');
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(hostedCode).then(
          () => (copy.textContent = '¡Copiado!'),
          () => (copy.textContent = hostedCode),
        );
      });
      share.append(copy);
      screen.append(share);
    }

    const wrap = el('div', 'select-wrap');
    const left = el('div', 'roster');

    // Seat grid: two teams by five positions. Clicking a free seat claims it,
    // which is how a player chooses both side and role in one gesture.
    const board = el('div', 'seat-board panel');
    const bySlot = new Map(players.map((p) => [p.slot, p]));

    for (const team of [0, 1] as const) {
      const column = el('div', 'seat-col');
      column.append(
        el('div', `seat-head ${team === 0 ? 'blue' : 'red'}`, team === 0 ? 'Equipo azul' : 'Equipo rojo'),
      );
      for (const position of POSITIONS) {
        const slot = slotFor(team, position);
        const occupant = bySlot.get(slot);
        const seat = el('button', `seat ${team === 0 ? 'blue' : 'red'}`);
        if (slot === mySlot) seat.classList.add('mine');
        if (occupant && slot !== mySlot) seat.classList.add('taken');

        seat.append(el('span', 'seat-pos', POSITION_SHORT[position]));
        const who = occupant
          ? `${occupant.name}${slot === mySlot ? ' (tú)' : ''}`
          : 'Libre · lo tomará un bot';
        seat.append(el('span', 'seat-who', who));
        const champName = occupant?.championId
          ? (getChampion(occupant.championId)?.name ?? '—')
          : '';
        seat.append(el('span', 'seat-champ', occupant ? (champName || 'eligiendo…') : ''));
        if (occupant?.ready) seat.classList.add('ready');

        seat.title = occupant && slot !== mySlot
          ? `${POSITION_NAMES[position]} · tocar para intercambiar con ${occupant.name}`
          : POSITION_NAMES[position];
        seat.addEventListener('click', () => {
          if (slot === mySlot) return;
          net?.claimSeat(slot);
        });
        column.append(seat);
      }
      board.append(column);
    }
    left.append(board);

    // Champion picker.
    const takenByOthers = new Set(
      players.filter((p) => p.slot !== mySlot && p.championId).map((p) => p.championId!),
    );
    for (const role of ROLES) {
      const section = el('div', 'role-row');
      section.append(el('div', 'role-label', ROLE_NAMES[role as ChampionRole]));
      const grid = el('div', 'role-cards');
      for (const def of championsByRole(role as ChampionRole)) {
        const card = el('div', 'champ-card');
        if (def.id === champion.id) card.classList.add('selected');
        const mark = el('div', 'champ-mark', def.name.slice(0, 1));
        mark.style.background = def.colour;
        card.append(mark, el('div', 'champ-name', def.name), el('div', 'champ-title', def.title));
        if (takenByOthers.has(def.id)) {
          card.style.opacity = '0.4';
          card.title = 'Ya elegido por otro jugador';
        }
        card.addEventListener('click', () => {
          champion = def;
          net?.pick(def.id);
          showLobby(players, secondsLeft);
        });
        grid.append(card);
      }
      section.append(grid);
      left.append(section);
    }

    // Side panel: your choice and the ready control.
    const side = el('div', 'detail panel');
    side.append(el('h3', '', 'Tu elección'));
    const seatText =
      mySlot >= 0
        ? `${mySlot < 5 ? 'Equipo azul' : 'Equipo rojo'} · ${POSITION_NAMES[positionOfSlot(mySlot)]}`
        : 'Sin puesto todavía';
    side.append(el('p', '', `${champion.name} — ${seatText}`));
    side.append(
      el(
        'p',
        '',
        'Toca cualquier puesto libre del tablero para cambiarte de equipo o de posición. ' +
          'Lo que no ocupe nadie lo jugará un bot.',
      ),
    );

    const actions = el('div', 'menu-actions');
    const readyButton = el('button', ready ? '' : 'primary', ready ? 'Cancelar listo' : 'Listo');
    readyButton.addEventListener('click', () => {
      ready = !ready;
      net?.setReady(ready);
    });
    const back = el('button', '', 'Salir');
    back.addEventListener('click', leave);
    actions.append(readyButton, back);
    side.append(actions);

    wrap.append(left, side);
    screen.append(wrap);
  };

  /* -- Step 4: start --------------------------------------------- */

  const beginMatch = (seed: number, picks: Pick[], slot: number): void => {
    const slots = buildOnlineRoster(seed, picks);
    const mine = slots.find((s) => s.slot === slot);
    const def = mine ? (getChampion(mine.championId) ?? champion) : champion;
    const client = net;
    // Ownership passes to the game; the screen must not close the socket.
    net = null;
    if (client) hooks.onStart(def, seed, slots, slot, client);
  };

  showConnect();
  return screen;
}
