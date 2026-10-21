import {
  CATEGORY_LABELS,
  ITEMS,
  SHOP_ORDER,
  effectiveCost,
  getItem,
  type ItemDef,
} from '../data/items.ts';
import { MAX_ITEMS, SELL_REFUND } from '../sim/constants.ts';
import type { Unit } from '../sim/types.ts';

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

/** Human-readable summary of an item's stat block. */
function describeStats(item: ItemDef): string {
  const labels: Record<string, string> = {
    maxHp: 'vida',
    hpRegen: 'reg. vida',
    maxMana: 'maná',
    manaRegen: 'reg. maná',
    ad: 'AD',
    ap: 'AP',
    armor: 'armadura',
    mr: 'res. mágica',
    attackSpeed: 'vel. ataque',
    moveSpeed: 'vel. mov.',
    critChance: 'crítico',
    critDamage: 'daño crít.',
    lifesteal: 'robo de vida',
    spellVamp: 'robo mágico',
    haste: 'recarga',
    tenacity: 'tenacidad',
    armorPenFlat: 'pen. armadura',
    armorPenPct: 'pen. armadura %',
    magicPenFlat: 'pen. mágica',
    magicPenPct: 'pen. mágica %',
    damageTaken: 'daño recibido',
    damageDealt: 'daño infligido',
  };
  const percentages = new Set([
    'attackSpeed',
    'critChance',
    'critDamage',
    'lifesteal',
    'spellVamp',
    'tenacity',
    'armorPenPct',
    'magicPenPct',
  ]);

  return Object.entries(item.stats)
    .map(([key, value]) => {
      if (value === undefined) return '';
      if (key === 'damageTaken' || key === 'damageDealt') {
        const pct = Math.round((1 - value) * 100);
        return `${pct > 0 ? '-' : '+'}${Math.abs(pct)}% ${labels[key]}`;
      }
      const shown = percentages.has(key) ? `${Math.round(value * 100)}%` : Math.round(value);
      return `+${shown} ${labels[key] ?? key}`;
    })
    .filter(Boolean)
    .join(', ');
}

export class Shop {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly owned: HTMLElement;
  private readonly hint: HTMLElement;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly onBuy: (id: string) => void,
    private readonly onSell: (index: number) => void,
  ) {
    this.root = el('div', 'shop panel hidden');

    const header = el('header');
    header.append(el('h3', '', 'Tienda'));
    this.hint = el('div', 'hint');
    const close = el('button', '', 'Cerrar (P)');
    close.addEventListener('click', () => this.setOpen(false));
    header.append(this.hint, close);

    this.owned = el('div', 'shop-owned');
    this.body = el('div', 'shop-body');

    this.root.append(header, this.owned, this.body);
    parent.appendChild(this.root);
    this.buildCatalog();
  }

  private buildCatalog(): void {
    for (const category of SHOP_ORDER) {
      const group = ITEMS.filter((i) => i.category === category);
      if (group.length === 0) continue;

      const section = el('div', 'shop-cat');
      section.append(el('h4', '', CATEGORY_LABELS[category]));
      const grid = el('div', 'shop-grid');

      for (const item of group) {
        const button = el('button', 'shop-item');
        button.dataset.item = item.id;
        button.append(el('span', 'name', item.name));
        button.append(el('span', 'price', `${item.cost} oro`));
        button.append(el('span', 'stats', describeStats(item)));
        if (item.note) button.title = item.note;
        button.addEventListener('click', () => this.onBuy(item.id));
        grid.appendChild(button);
      }

      section.appendChild(grid);
      this.body.appendChild(section);
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('hidden', !open);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  /** Refreshes affordability and the sell row; cheap enough to run per frame. */
  update(player: Unit | undefined, canShop: boolean): void {
    if (!this.open || !player) return;
    const champ = player.champion!;

    this.hint.textContent = canShop
      ? `${Math.floor(champ.gold)} oro disponible`
      : 'Vuelve a la base para comprar';

    const buttons = this.body.querySelectorAll<HTMLButtonElement>('.shop-item');
    for (const button of buttons) {
      const item = getItem(button.dataset.item!);
      if (!item) continue;
      const price = effectiveCost(item, champ.items);
      const full = champ.items.length >= MAX_ITEMS && !item.from;
      button.disabled = !canShop || champ.gold < price || full;
      const priceNode = button.querySelector('.price')!;
      priceNode.textContent =
        price === item.cost ? `${item.cost} oro` : `${price} oro (de ${item.cost})`;
    }

    this.owned.replaceChildren();
    champ.items.forEach((id, index) => {
      const item = getItem(id);
      if (!item) return;
      const button = el('button', '', `Vender ${item.name} (+${Math.floor(item.cost * SELL_REFUND)})`);
      button.disabled = !canShop;
      button.addEventListener('click', () => this.onSell(index));
      this.owned.appendChild(button);
    });
    if (champ.items.length === 0) {
      this.owned.appendChild(el('span', 'hint', 'Sin objetos todavía.'));
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
