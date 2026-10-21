/**
 * The in-game interface. Plain DOM over the canvas: it styles better, scales
 * on phones and stays readable, and it costs nothing the renderer needs.
 */

import { getChampion } from '../champions/index.ts';
import { getItem } from '../data/items.ts';
import { BLUE, RED, type Team } from '../data/map.ts';
import { MAX_LEVEL, ticksToSec, xpToNextLevel } from '../sim/constants.ts';
import type { AbilityKey, Unit } from '../sim/types.ts';
import { ABILITY_KEYS } from '../sim/types.ts';
import type { Match } from '../sim/match.ts';
import { PALETTE } from '../render/palette.ts';

export interface HudCallbacks {
  onAbility(key: AbilityKey): void;
  onLevelUp(key: AbilityKey): void;
  onToggleShop(): void;
  onToggleQuickCast(): void;
  onToggleHelp(): void;
  onToggleCameraLock(): void;
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

const mmss = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Hud {
  readonly root: HTMLElement;
  readonly minimap: HTMLCanvasElement;

  private readonly scoreBlue: HTMLElement;
  private readonly scoreRed: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly objectives: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly portrait: HTMLElement;
  private readonly portraitLetter: HTMLElement;
  private readonly levelBadge: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly manaBar: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly xpBar: HTMLElement;
  private readonly abilityNodes = new Map<AbilityKey, HTMLElement>();
  private readonly summonerNodes = new Map<'D' | 'F', HTMLElement>();
  private readonly itemSlots: HTMLElement[] = [];
  private readonly goldText: HTMLElement;
  private readonly statsText: HTMLElement;
  private readonly deathOverlay: HTMLElement;
  private readonly quickCastButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;

  private readonly netStall: HTMLElement;
  private feedCount = 0;
  aiming: AbilityKey | null = null;

  constructor(parent: HTMLElement, private readonly cb: HudCallbacks) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);

    /* Top bar ----------------------------------------------------- */
    const top = el('div', 'hud-top panel');
    this.scoreBlue = el('span', 'score blue', '0');
    this.clock = el('span', 'clock', '0:00');
    this.scoreRed = el('span', 'score red', '0');
    this.objectives = el('div', 'objectives');
    top.append(this.scoreBlue, this.clock, this.scoreRed, this.objectives);
    this.root.appendChild(top);

    /* Kill feed --------------------------------------------------- */
    this.feed = el('div', 'hud-feed');
    this.root.appendChild(this.feed);

    /* Bottom bar -------------------------------------------------- */
    const bottom = el('div', 'hud-bottom');

    const champBlock = el('div', 'champ-block panel');
    this.portrait = el('div', 'portrait');
    this.portraitLetter = el('span', 'initial', '?');
    this.levelBadge = el('span', 'lvl', '1');
    this.portrait.append(this.portraitLetter, this.levelBadge);

    const vitals = el('div', 'vitals');
    const hpOuter = el('div', 'bar hp');
    this.hpBar = el('span');
    this.hpText = el('em');
    hpOuter.append(this.hpBar, this.hpText);
    const manaOuter = el('div', 'bar mana');
    this.manaBar = el('span');
    this.manaText = el('em');
    manaOuter.append(this.manaBar, this.manaText);
    const xpOuter = el('div', 'bar xp');
    this.xpBar = el('span');
    xpOuter.appendChild(this.xpBar);
    this.goldText = el('div', 'gold-row');
    this.statsText = el('div', 'stat-row');
    vitals.append(hpOuter, manaOuter, xpOuter, this.goldText, this.statsText);

    champBlock.append(this.portrait, vitals);

    /* Abilities --------------------------------------------------- */
    const abilities = el('div', 'abilities panel');
    for (const key of ABILITY_KEYS) {
      const node = el('div', 'ability locked');
      node.dataset.key = key;
      node.append(el('span', 'glyph', key));
      const cd = el('div', 'cd hidden');
      const rank = el('div', 'rank');
      for (let i = 0; i < 5; i++) rank.appendChild(el('i'));
      const plus = el('div', 'plus hidden', '+');
      node.append(cd, rank, plus);

      node.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey) this.cb.onLevelUp(key);
        else this.cb.onAbility(key);
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cb.onLevelUp(key);
      });
      plus.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onLevelUp(key);
      });

      abilities.appendChild(node);
      this.abilityNodes.set(key, node);
    }
    for (const key of ['D', 'F'] as const) {
      const node = el('div', 'ability summoner');
      node.append(el('span', 'glyph', key));
      node.append(el('div', 'cd hidden'));
      abilities.appendChild(node);
      this.summonerNodes.set(key, node);
    }

    /* Items ------------------------------------------------------- */
    const items = el('div', 'items panel');
    for (let i = 0; i < 6; i++) {
      const slot = el('div', 'item-slot');
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        slot.dispatchEvent(new CustomEvent('sell', { bubbles: true, detail: i }));
      });
      items.appendChild(slot);
      this.itemSlots.push(slot);
    }

    bottom.append(champBlock, abilities, items);
    this.root.appendChild(bottom);

    /* Minimap and toggles ----------------------------------------- */
    const right = el('div', 'hud-right');
    this.minimap = el('canvas');
    this.minimap.id = 'minimap';
    this.minimap.width = 480;
    this.minimap.height = 480;
    this.minimap.className = 'panel';

    const toggles = el('div', 'hud-toggles');
    const shopButton = el('button', '', 'Tienda (P)');
    shopButton.addEventListener('click', () => this.cb.onToggleShop());
    this.quickCastButton = el('button', '', 'Tiro rápido');
    this.quickCastButton.addEventListener('click', () => this.cb.onToggleQuickCast());
    this.cameraButton = el('button', 'on', 'Cámara (Y)');
    this.cameraButton.addEventListener('click', () => this.cb.onToggleCameraLock());
    const helpButton = el('button', '', 'Ayuda (F1)');
    helpButton.addEventListener('click', () => this.cb.onToggleHelp());
    toggles.append(shopButton, this.quickCastButton, this.cameraButton, helpButton);

    right.append(toggles, this.minimap);
    this.root.appendChild(right);

    /* Network stall notice ---------------------------------------- */
    this.netStall = el('div', 'net-stall panel hidden', 'Esperando a la red…');
    this.root.appendChild(this.netStall);

    /* Death overlay ----------------------------------------------- */
    this.deathOverlay = el('div', 'death-overlay hidden');
    const deathInner = el('div');
    deathInner.append(el('div', 'small', 'Reapareces en'), el('div', 'big', '0'));
    this.deathOverlay.appendChild(deathInner);
    this.root.appendChild(this.deathOverlay);
  }

  /** Shown while a lockstep client is waiting for the next command bundle. */
  setNetworkStalled(stalled: boolean): void {
    this.netStall.classList.toggle('hidden', !stalled);
  }

  setQuickCast(on: boolean): void {
    this.quickCastButton.classList.toggle('on', on);
  }

  setCameraLocked(on: boolean): void {
    this.cameraButton.classList.toggle('on', on);
  }

  toast(text: string): void {
    const node = el('div', 'toast panel', text);
    this.root.appendChild(node);
    setTimeout(() => node.remove(), 1700);
  }

  /* ---------------------------------------------------------------- */

  update(match: Match, player: Unit | undefined, team: Team): void {
    const world = match.world;

    this.scoreBlue.textContent = String(world.teamKills[BLUE]);
    this.scoreRed.textContent = String(world.teamKills[RED]);
    this.clock.textContent = mmss(world.seconds);
    this.updateObjectives(match);
    this.updateFeed(match);

    if (!player) return;
    const champ = player.champion!;
    const def = getChampion(champ.championId);

    this.portrait.style.background = def?.colour ?? PALETTE.blue;
    this.portraitLetter.textContent = (def?.name ?? '?').slice(0, 1);
    this.levelBadge.textContent = String(player.level);

    const hpFrac = Math.max(0, player.hp / Math.max(1, player.stats.maxHp));
    this.hpBar.style.width = `${hpFrac * 100}%`;
    this.hpText.textContent = `${Math.ceil(Math.max(0, player.hp))} / ${Math.round(player.stats.maxHp)}`;

    const manaFrac = player.stats.maxMana > 0 ? player.mana / player.stats.maxMana : 0;
    this.manaBar.style.width = `${manaFrac * 100}%`;
    this.manaText.textContent = `${Math.ceil(player.mana)} / ${Math.round(player.stats.maxMana)}`;

    const needed = player.level >= MAX_LEVEL ? 1 : xpToNextLevel(player.level);
    this.xpBar.style.width = `${Math.min(100, (player.xp / needed) * 100)}%`;

    this.goldText.textContent = `${Math.floor(champ.gold)} oro`;
    this.statsText.textContent =
      `${champ.kills}/${champ.deaths}/${champ.assists}  ·  ${champ.creepScore} súbditos  ·  ` +
      `${Math.round(player.stats.ad)} AD  ${Math.round(player.stats.ap)} AP  ` +
      `${Math.round(player.stats.armor)}/${Math.round(player.stats.mr)} def`;

    this.updateAbilities(match, player);
    this.updateItems(player);
    this.updateDeath(match, player);
    void team;
  }

  private updateAbilities(match: Match, player: Unit): void {
    const champ = player.champion!;
    const def = getChampion(champ.championId);

    for (const key of ABILITY_KEYS) {
      const node = this.abilityNodes.get(key)!;
      const slot = champ.abilities[key];
      const ability = def?.abilities[key];
      const maxRank = ability?.maxRank ?? (ability?.isUltimate ? 3 : 5);

      node.classList.toggle('locked', slot.rank === 0);
      node.classList.toggle('ready', slot.rank > 0 && slot.cooldown <= 0 && match.canCast(player, key));
      node.classList.toggle('aiming', this.aiming === key);
      node.title = ability ? `${ability.name}\n${ability.description}` : '';

      const cd = node.querySelector('.cd') as HTMLElement;
      if (slot.cooldown > 0) {
        cd.classList.remove('hidden');
        cd.textContent = ticksToSec(slot.cooldown).toFixed(ticksToSec(slot.cooldown) < 10 ? 1 : 0);
      } else {
        cd.classList.add('hidden');
      }

      const pips = node.querySelectorAll('.rank i');
      pips.forEach((pip, i) => {
        pip.classList.toggle('on', i < slot.rank);
        (pip as HTMLElement).style.display = i < maxRank ? '' : 'none';
      });

      const plus = node.querySelector('.plus') as HTMLElement;
      const canRank =
        champ.skillPoints > 0 &&
        slot.rank < maxRank &&
        (!ability?.isUltimate || player.level >= 6 + slot.rank * 5) &&
        (ability?.isUltimate || slot.rank + 1 <= Math.ceil(player.level / 2));
      plus.classList.toggle('hidden', !canRank);
    }

    const summoners: [('D' | 'F'), number][] = [
      ['D', champ.flashCooldown],
      ['F', champ.healCooldown],
    ];
    for (const [key, cooldown] of summoners) {
      const node = this.summonerNodes.get(key)!;
      const cd = node.querySelector('.cd') as HTMLElement;
      node.classList.toggle('ready', cooldown <= 0);
      if (cooldown > 0) {
        cd.classList.remove('hidden');
        cd.textContent = String(Math.ceil(ticksToSec(cooldown)));
      } else {
        cd.classList.add('hidden');
      }
    }
  }

  private updateItems(player: Unit): void {
    const items = player.champion!.items;
    for (let i = 0; i < this.itemSlots.length; i++) {
      const slot = this.itemSlots[i];
      const item = items[i] ? getItem(items[i]) : undefined;
      slot.classList.toggle('filled', Boolean(item));
      slot.textContent = item ? shortName(item.name) : '';
      slot.title = item ? `${item.name}\nClic derecho para vender` : 'Vacío';
    }
  }

  private updateDeath(match: Match, player: Unit): void {
    if (player.alive) {
      this.deathOverlay.classList.add('hidden');
      return;
    }
    this.deathOverlay.classList.remove('hidden');
    const remaining = Math.max(0, ticksToSec(player.respawnTick - match.world.tick));
    (this.deathOverlay.querySelector('.big') as HTMLElement).textContent = remaining.toFixed(0);
  }

  private updateObjectives(match: Match): void {
    const world = match.world;
    const epics = [...world.units.values()].filter(
      (u) => u.kind === 'monster' && u.alive && u.monster!.kind !== 'camp',
    );
    const parts: string[] = [];
    for (const e of epics) parts.push(`<b>${e.name}</b> vivo`);
    const towers = [...world.units.values()].filter((u) => u.kind === 'tower');
    const blueDown = towers.filter((t) => t.team === BLUE && !t.alive).length;
    const redDown = towers.filter((t) => t.team === RED && !t.alive).length;
    parts.push(`torres ${redDown} · ${blueDown}`);
    this.objectives.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }

  private updateFeed(match: Match): void {
    const entries = match.world.feed;
    while (this.feedCount < entries.length) {
      const entry = entries[this.feedCount++];
      const line = el('div', 'feed-line', entry.text);
      if (entry.kind === 'objective' || entry.kind === 'inhibitor') line.classList.add('objective');
      else if (entry.team === BLUE) line.classList.add('blue');
      else if (entry.team === RED) line.classList.add('red');
      this.feed.appendChild(line);
      setTimeout(() => line.remove(), 7000);
      while (this.feed.childElementCount > 6) this.feed.firstElementChild?.remove();
    }
    // The world trims its own feed, so keep the cursor in range.
    this.feedCount = Math.min(this.feedCount, entries.length);
  }

  destroy(): void {
    this.root.remove();
  }
}

/** Compresses an item name to something that fits a 34px slot. */
function shortName(name: string): string {
  const words = name.split(' ').filter((w) => w.length > 2 && w !== 'del' && w !== 'de' && w !== 'la');
  if (words.length === 1) return words[0].slice(0, 6);
  return words
    .slice(0, 2)
    .map((w) => w.slice(0, 4))
    .join('\n');
}
