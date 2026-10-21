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
import type { SlotConfig } from '../sim/match.ts';
import { NetClient } from './client.ts';
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
    net: NetClient,
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

  let net: NetClient | null = null;
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

  /* -- Step 1: where to connect ---------------------------------- */

  const showConnect = (error?: string): void => {
    screen.replaceChildren();
    screen.append(el('h2', 'title', 'PARTIDA ONLINE'));
    screen.append(
      el(
        'p',
        'subtitle',
        'Introduce la dirección de tu servidor de salas. Si no tienes uno, en server/README.md ' +
          'está cómo desplegarlo gratis en unos minutos.',
      ),
    );

    const form = el('div', 'panel detail');
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Tu nombre';
    nameInput.value = read(STORAGE_NAME, 'Jugador');
    nameInput.maxLength = 20;

    const urlInput = el('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'wss://genesys-rooms.tu-cuenta.workers.dev/ws';
    urlInput.value = read(STORAGE_URL, DEFAULT_URL);

    for (const input of [nameInput, urlInput]) {
      input.style.cssText =
        'padding:10px 12px;border-radius:8px;border:1px solid var(--edge);' +
        'background:rgba(10,16,28,.9);color:var(--text);font:inherit;width:100%';
    }

    form.append(el('div', 'role-label', 'Nombre'), nameInput);
    form.append(el('div', 'role-label', 'Servidor'), urlInput);
    if (error) {
      const warn = el('p', '', error);
      warn.style.color = 'var(--danger)';
      warn.style.fontSize = '13px';
      warn.style.margin = '0';
      form.append(warn);
    }

    const row = el('div', 'menu-actions');
    const connect = el('button', 'primary', 'Conectar');
    const back = el('button', '', 'Volver');
    back.addEventListener('click', leave);
    row.append(connect, back);
    form.append(row);
    screen.append(form);

    const go = (): void => {
      const url = urlInput.value.trim();
      const name = nameInput.value.trim() || 'Jugador';
      if (!url) {
        showConnect('Hace falta la dirección del servidor.');
        return;
      }
      write(STORAGE_URL, url);
      write(STORAGE_NAME, name);
      startConnecting(url, name);
    };

    connect.addEventListener('click', go);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  };

  /* -- Step 2: connect ------------------------------------------- */

  const startConnecting = (url: string, name: string): void => {
    screen.replaceChildren();
    screen.append(el('h2', 'title', 'CONECTANDO'));
    screen.append(el('p', 'subtitle', 'Buscando el servidor de salas…'));

    net = new NetClient(url, {
      onLobby: (players, secondsLeft) => showLobby(players, secondsLeft),
      onStart: (seed, picks, slot) => beginMatch(seed, picks, slot),
      onTick: () => {
        // Bundles that arrive before the match screen exists are impossible:
        // the driver is installed synchronously in `beginMatch`.
      },
      onDropped: () => {},
      onClosed: (reason) => showConnect(`Se perdió la conexión: ${reason}`),
      onError: (message) => showConnect(message),
    });

    net.connect(name)
      .then(() => {
        net?.pick(champion.id);
      })
      .catch((err: Error) => {
        showConnect(
          `${err.message} Comprueba que la dirección empieza por wss:// y que el servidor está desplegado.`,
        );
      });
  };

  /* -- Step 3: lobby and champion select ------------------------- */

  const showLobby = (players: LobbyPlayer[], secondsLeft: number): void => {
    screen.replaceChildren();
    screen.append(el('h2', 'title', 'SALA'));

    const humans = players.length;
    screen.append(
      el(
        'p',
        'subtitle',
        humans >= 10
          ? 'Sala completa. Marcad listos para empezar.'
          : `${humans} de 10 jugadores. Si no se llena, los puestos libres los ocuparán bots ` +
            `en ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}.`,
      ),
    );

    const wrap = el('div', 'select-wrap');

    // Champion picker, grouped by role like the offline screen.
    const roster = el('div', 'roster');
    const takenByOthers = new Set(
      players.filter((p) => p.slot !== net?.slot && p.championId).map((p) => p.championId!),
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
      roster.append(section);
    }

    // Roster panel.
    const side = el('div', 'detail panel');
    side.append(el('h3', '', 'Jugadores'));
    for (const p of players) {
      const row = el('div', 'ability-row');
      const tag = el('div', 'ability-key', p.slot < 5 ? 'A' : 'R');
      const body = el('div');
      body.append(el('div', 'ability-name', `${p.name}${p.slot === net?.slot ? ' (tú)' : ''}`));
      const champName = p.championId ? (getChampion(p.championId)?.name ?? '—') : 'eligiendo…';
      body.append(el('div', 'ability-text', `${champName}${p.ready ? ' · listo' : ''}`));
      row.append(tag, body);
      side.append(row);
    }

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

    wrap.append(roster, side);
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
