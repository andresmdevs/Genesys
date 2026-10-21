import { getChampion } from '../champions/index.ts';
import { BLUE, RED, type Team } from '../data/map.ts';
import type { Match } from '../sim/match.ts';

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

const COLUMNS = ['Campeón', 'Jugador', 'K/D/A', 'Súbditos', 'Oro', 'Daño', 'Objetos'];

export class Scoreboard {
  readonly root: HTMLElement;
  private readonly table: HTMLTableElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'scoreboard panel hidden');
    this.table = el('table');
    this.root.appendChild(this.table);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  update(match: Match, playerId: number): void {
    if (this.root.classList.contains('hidden')) return;

    const head = el('tr');
    for (const c of COLUMNS) head.appendChild(el('th', '', c));
    const rows: HTMLElement[] = [head];

    for (const team of [BLUE, RED] as Team[]) {
      const label = el('tr');
      const cell = el('td', `team-head ${team === BLUE ? 'blue' : 'red'}`);
      cell.colSpan = COLUMNS.length;
      cell.textContent =
        `${team === BLUE ? 'Equipo azul' : 'Equipo rojo'} — ${match.world.teamKills[team]} asesinatos`;
      label.appendChild(cell);
      rows.push(label);

      const members = match.champions.filter((c) => c.team === team);
      for (const unit of members) {
        const champ = unit.champion!;
        const def = getChampion(champ.championId);
        const row = el('tr', team === BLUE ? 'blue' : 'red');
        if (unit.id === playerId) row.classList.add('me');

        row.append(
          el('td', '', `${def?.name ?? '?'} · nv ${unit.level}`),
          el('td', '', `${unit.name}${champ.isBot ? ' (IA)' : ''}`),
          el('td', '', `${champ.kills}/${champ.deaths}/${champ.assists}`),
          el('td', '', String(champ.creepScore)),
          el('td', '', String(Math.floor(champ.totalGold))),
          el('td', '', String(Math.round(champ.damageDealt))),
          el('td', '', String(champ.items.length)),
        );
        rows.push(row);
      }
    }

    this.table.replaceChildren(...rows);
  }

  destroy(): void {
    this.root.remove();
  }
}
