/**
 * Everything outside a running match: the menu, champion select, the help
 * panel and the end screen.
 */

import { CHAMPIONS, championsByRole } from '../champions/index.ts';
import type { ChampionDef } from '../champions/types.ts';
import { ROLES, ROLE_NAMES, type ChampionRole } from '../sim/types.ts';

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

export interface MenuActions {
  onPractice(): void;
  onOnline(): void;
  onHelp(): void;
}

export function mainMenu(parent: HTMLElement, actions: MenuActions): HTMLElement {
  const screen = el('div', 'screen');
  screen.append(el('h1', 'title', 'GENESYS'));
  screen.append(
    el(
      'p',
      'subtitle',
      'MOBA 5 contra 5 de código abierto. Tres carriles, torres, súbditos, jungla y diez campeones ' +
        'originales. Sin descargas y sin cuenta: se juega en esta pestaña.',
    ),
  );

  const actionsRow = el('div', 'menu-actions');
  const practice = el('button', 'primary', 'Jugar contra la IA');
  practice.addEventListener('click', actions.onPractice);
  const online = el('button', '', 'Partida online');
  online.addEventListener('click', actions.onOnline);
  const help = el('button', '', 'Cómo se juega');
  help.addEventListener('click', actions.onHelp);
  actionsRow.append(practice, online, help);
  screen.append(actionsRow);

  screen.append(
    el(
      'p',
      'menu-note',
      'Clic derecho para moverte y atacar · QWER para habilidades · Mayús o Ctrl + QWER para subirlas · ' +
        'B para volver a la base · P para la tienda · Tab para el marcador.',
    ),
  );

  parent.appendChild(screen);
  return screen;
}

export interface SelectResult {
  champion: ChampionDef;
}

export function championSelect(
  parent: HTMLElement,
  onConfirm: (result: SelectResult) => void,
  onBack: () => void,
): HTMLElement {
  const screen = el('div', 'screen');
  screen.append(el('h2', 'title', 'ELIGE CAMPEÓN'));

  const wrap = el('div', 'select-wrap');
  const roster = el('div', 'roster');
  const detail = el('div', 'detail panel');

  let selected: ChampionDef = CHAMPIONS[0];
  const cards = new Map<string, HTMLElement>();

  const renderDetail = (): void => {
    detail.replaceChildren();
    const head = el('div');
    head.append(el('h3', '', `${selected.name}`));
    head.append(el('div', 'role-tag', `${selected.title} · ${ROLE_NAMES[selected.role]}`));
    detail.append(head);
    detail.append(el('p', '', selected.blurb));

    const list = el('div', 'ability-list');
    const rows: [string, string, string][] = [
      ['P', selected.passive.name, selected.passive.description],
      ...(['Q', 'W', 'E', 'R'] as const).map(
        (k) =>
          [k, selected.abilities[k].name, selected.abilities[k].description] as [
            string,
            string,
            string,
          ],
      ),
    ];
    for (const [key, name, text] of rows) {
      const row = el('div', 'ability-row');
      row.append(el('div', 'ability-key', key));
      const body = el('div');
      body.append(el('div', 'ability-name', name));
      body.append(el('div', 'ability-text', text));
      row.append(body);
      list.append(row);
    }
    detail.append(list);

    const confirm = el('button', 'primary', `Jugar como ${selected.name}`);
    confirm.addEventListener('click', () => onConfirm({ champion: selected }));
    const back = el('button', '', 'Volver');
    back.addEventListener('click', onBack);
    const row = el('div', 'menu-actions');
    row.append(confirm, back);
    detail.append(row);
  };

  const select = (def: ChampionDef): void => {
    selected = def;
    for (const [id, card] of cards) card.classList.toggle('selected', id === def.id);
    renderDetail();
  };

  for (const role of ROLES) {
    const section = el('div', 'role-row');
    section.append(el('div', 'role-label', ROLE_NAMES[role as ChampionRole]));
    const grid = el('div', 'role-cards');

    for (const def of championsByRole(role as ChampionRole)) {
      const card = el('div', 'champ-card');
      const mark = el('div', 'champ-mark', def.name.slice(0, 1));
      mark.style.background = def.colour;
      card.append(mark);
      card.append(el('div', 'champ-name', def.name));
      card.append(el('div', 'champ-title', def.title));
      card.addEventListener('click', () => select(def));
      grid.append(card);
      cards.set(def.id, card);
    }
    section.append(grid);
    roster.append(section);
  }

  wrap.append(roster, detail);
  screen.append(wrap);
  parent.appendChild(screen);
  select(CHAMPIONS[0]);
  return screen;
}

export function helpPanel(parent: HTMLElement): HTMLElement {
  const panel = el('div', 'help panel hidden');
  panel.append(el('h3', '', 'Controles'));
  const dl = el('dl');
  const rows: [string, string][] = [
    ['Clic derecho', 'Moverse, atacar al objetivo o seguir'],
    ['Q W E R', 'Lanzar habilidad (clic izquierdo para confirmar)'],
    ['Mayús/Ctrl + QWER', 'Subir de rango la habilidad'],
    ['A + clic', 'Mover atacando'],
    ['S', 'Detenerse'],
    ['B', 'Volver a la base'],
    ['D / F', 'Destello / Curación'],
    ['P', 'Abrir la tienda (solo en la base)'],
    ['Tab', 'Marcador'],
    ['Espacio', 'Centrar la cámara'],
    ['Y', 'Fijar o soltar la cámara'],
    ['G', 'Señalar en el mapa'],
    ['Rueda', 'Acercar o alejar'],
    ['F1', 'Mostrar u ocultar esta ayuda'],
  ];
  for (const [key, text] of rows) {
    dl.append(el('dt', '', key), el('dd', '', text));
  }
  panel.append(dl);

  const close = el('button', '', 'Cerrar');
  close.addEventListener('click', () => panel.classList.add('hidden'));
  panel.append(close);

  parent.appendChild(panel);
  return panel;
}

export interface EndSummary {
  won: boolean;
  minutes: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  damage: number;
}

export function endScreen(
  parent: HTMLElement,
  summary: EndSummary,
  onAgain: () => void,
  onMenu: () => void,
): HTMLElement {
  const screen = el('div', 'screen');
  const banner = el('h2', `end-banner ${summary.won ? 'win' : 'lose'}`, summary.won ? 'VICTORIA' : 'DERROTA');
  screen.append(banner);

  screen.append(
    el(
      'p',
      'subtitle',
      `${summary.minutes.toFixed(0)} minutos · ${summary.kills}/${summary.deaths}/${summary.assists} · ` +
        `${summary.creepScore} súbditos · ${Math.round(summary.damage).toLocaleString('es')} de daño`,
    ),
  );

  const row = el('div', 'menu-actions');
  const again = el('button', 'primary', 'Jugar otra vez');
  again.addEventListener('click', onAgain);
  const menu = el('button', '', 'Menú principal');
  menu.addEventListener('click', onMenu);
  row.append(again, menu);
  screen.append(row);

  parent.appendChild(screen);
  return screen;
}
