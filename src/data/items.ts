import type { StatBlock } from '../sim/types.ts';

export type ItemCategory = 'component' | 'boots' | 'physical' | 'magic' | 'defense' | 'support';

export interface ItemDef {
  id: string;
  name: string;
  /** Full price including components. */
  cost: number;
  category: ItemCategory;
  stats: Partial<StatBlock>;
  /** Component item ids consumed when this is built. */
  from?: string[];
  /** Plain-text note shown in the shop. */
  note?: string;
}

const items: ItemDef[] = [
  /* Components ---------------------------------------------------- */
  { id: 'sword', name: 'Espada larga', cost: 350, category: 'component', stats: { ad: 10 } },
  { id: 'dagger', name: 'Daga', cost: 300, category: 'component', stats: { attackSpeed: 0.12 } },
  { id: 'cloak', name: 'Capa de ágata', cost: 300, category: 'component', stats: { armor: 15 } },
  { id: 'null', name: 'Amuleto nulo', cost: 400, category: 'component', stats: { mr: 20 } },
  { id: 'rod', name: 'Vara de amplificación', cost: 450, category: 'component', stats: { ap: 25 } },
  { id: 'staff', name: 'Bastón sin filo', cost: 850, category: 'component', stats: { ap: 45 } },
  { id: 'ruby', name: 'Cristal rubí', cost: 400, category: 'component', stats: { maxHp: 180 } },
  { id: 'belt', name: 'Cinturón del gigante', cost: 900, category: 'component', stats: { maxHp: 350 } },
  { id: 'sapphire', name: 'Cristal zafiro', cost: 300, category: 'component', stats: { maxMana: 250 } },
  { id: 'bf', name: 'Espadón', cost: 1300, category: 'component', stats: { ad: 40 } },
  {
    id: 'bootsbase',
    name: 'Botas',
    cost: 300,
    category: 'component',
    stats: { moveSpeed: 25 },
  },

  /* Boots ---------------------------------------------------------- */
  {
    id: 'boots-speed',
    name: 'Botas de velocidad',
    cost: 1000,
    category: 'boots',
    from: ['bootsbase'],
    stats: { moveSpeed: 50 },
    note: 'La opción pura de movilidad.',
  },
  {
    id: 'boots-lucid',
    name: 'Botas de lucidez',
    cost: 1050,
    category: 'boots',
    from: ['bootsbase'],
    stats: { moveSpeed: 42, haste: 22 },
    note: 'Reduce el tiempo de recarga de tus habilidades.',
  },
  {
    id: 'boots-steel',
    name: 'Grebas de acero',
    cost: 1100,
    category: 'boots',
    from: ['bootsbase', 'cloak'],
    stats: { moveSpeed: 42, armor: 28 },
    note: 'Contra equipos de daño físico.',
  },
  {
    id: 'boots-mist',
    name: 'Sandalias de bruma',
    cost: 1150,
    category: 'boots',
    from: ['bootsbase', 'null'],
    stats: { moveSpeed: 42, mr: 32, tenacity: 0.25 },
    note: 'Resistencia mágica y tenacidad frente al control de masas.',
  },

  /* Physical damage ------------------------------------------------ */
  {
    id: 'infinity',
    name: 'Filo del infinito',
    cost: 3400,
    category: 'physical',
    from: ['bf', 'sword'],
    stats: { ad: 65, critChance: 0.25, critDamage: 0.1 },
    note: 'Tus críticos golpean más fuerte.',
  },
  {
    id: 'bloodedge',
    name: 'Filo sangriento',
    cost: 3200,
    category: 'physical',
    from: ['bf', 'sword'],
    stats: { ad: 55, lifesteal: 0.18 },
    note: 'Robo de vida con ataques básicos.',
  },
  {
    id: 'breaker',
    name: 'Hacha quebrantadora',
    cost: 3100,
    category: 'physical',
    from: ['bf', 'ruby'],
    stats: { ad: 45, maxHp: 320, armorPenPct: 0.22 },
    note: 'Ignora parte de la armadura enemiga.',
  },
  {
    id: 'stalker',
    name: 'Lanza del acechador',
    cost: 3000,
    category: 'physical',
    from: ['sword', 'dagger'],
    stats: { ad: 40, attackSpeed: 0.3, moveSpeed: 25, haste: 15 },
    note: 'Velocidad de ataque y persecución.',
  },
  {
    id: 'reaper',
    name: 'Guadaña del segador',
    cost: 3300,
    category: 'physical',
    from: ['bf', 'cloak'],
    stats: { ad: 55, armorPenFlat: 18, haste: 20 },
    note: 'Penetración plana contra objetivos poco blindados.',
  },

  /* Magic damage --------------------------------------------------- */
  {
    id: 'abyssal',
    name: 'Corona abisal',
    cost: 3000,
    category: 'magic',
    from: ['staff', 'sapphire'],
    stats: { ap: 95, maxMana: 600, manaRegen: 6 },
    note: 'Poder de habilidad y un depósito de maná profundo.',
  },
  {
    id: 'emberbrand',
    name: 'Antorcha de cenizas',
    cost: 3100,
    category: 'magic',
    from: ['staff', 'rod'],
    stats: { ap: 90, haste: 22, magicPenFlat: 16 },
    note: 'Penetración mágica y recarga reducida.',
  },
  {
    id: 'hourglass',
    name: 'Reloj de arena',
    cost: 2800,
    category: 'magic',
    from: ['staff', 'cloak'],
    stats: { ap: 70, armor: 45 },
    note: 'Poder de habilidad sin renunciar a sobrevivir.',
  },
  {
    id: 'rimeveil',
    name: 'Velo de escarcha',
    cost: 2900,
    category: 'magic',
    from: ['staff', 'ruby'],
    stats: { ap: 80, maxHp: 300, haste: 15 },
    note: 'Para magos que pelean de cerca.',
  },

  /* Defense -------------------------------------------------------- */
  {
    id: 'titanaegis',
    name: 'Égida del titán',
    cost: 2900,
    category: 'defense',
    from: ['belt', 'cloak'],
    stats: { maxHp: 800, armor: 45, hpRegen: 5 },
    note: 'El muro contra el daño físico.',
  },
  {
    id: 'thornmail',
    name: 'Coraza espinada',
    cost: 2700,
    category: 'defense',
    from: ['cloak', 'ruby'],
    stats: { maxHp: 450, armor: 70, damageTaken: 0.94 },
    note: 'Reduce el daño que recibes de forma global.',
  },
  {
    id: 'voidmantle',
    name: 'Manto del vacío',
    cost: 2800,
    category: 'defense',
    from: ['null', 'belt'],
    stats: { maxHp: 500, mr: 65, tenacity: 0.2 },
    note: 'Resistencia mágica y tenacidad.',
  },
  {
    id: 'ironheart',
    name: 'Corazón de hierro',
    cost: 2600,
    category: 'defense',
    from: ['belt', 'sapphire'],
    stats: { maxHp: 700, haste: 28, manaRegen: 5, hpRegen: 6 },
    note: 'Aguante y recarga para peleas largas.',
  },

  /* Support -------------------------------------------------------- */
  {
    id: 'dawnbanner',
    name: 'Estandarte del alba',
    cost: 2400,
    category: 'support',
    from: ['ruby', 'cloak'],
    stats: { maxHp: 450, armor: 30, haste: 20, moveSpeed: 20 },
    note: 'Aguante y recarga para iniciar peleas.',
  },
  {
    id: 'lightchalice',
    name: 'Cáliz de luz',
    cost: 2300,
    category: 'support',
    from: ['rod', 'sapphire'],
    stats: { ap: 55, haste: 25, maxMana: 400, manaRegen: 10 },
    note: 'Pensado para escudos y curaciones sostenidas.',
  },
];

export const ITEMS: ReadonlyArray<ItemDef> = items;

const byId = new Map(items.map((i) => [i.id, i]));
export const getItem = (id: string): ItemDef | undefined => byId.get(id);

/** Price after crediting components already in the inventory. */
export function effectiveCost(item: ItemDef, inventory: readonly string[]): number {
  if (!item.from) return item.cost;
  const pool = inventory.slice();
  let credit = 0;
  for (const componentId of item.from) {
    const at = pool.indexOf(componentId);
    if (at >= 0) {
      pool.splice(at, 1);
      credit += getItem(componentId)?.cost ?? 0;
    }
  }
  return Math.max(0, item.cost - credit);
}

/** Components consumed when buying `item`, given the current inventory. */
export function consumedComponents(item: ItemDef, inventory: readonly string[]): number[] {
  if (!item.from) return [];
  const taken: number[] = [];
  const used = new Set<number>();
  for (const componentId of item.from) {
    for (let i = 0; i < inventory.length; i++) {
      if (used.has(i) || inventory[i] !== componentId) continue;
      used.add(i);
      taken.push(i);
      break;
    }
  }
  return taken.sort((a, b) => b - a);
}

export const SHOP_ORDER: ItemCategory[] = [
  'boots',
  'physical',
  'magic',
  'defense',
  'support',
  'component',
];

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  component: 'Componentes',
  boots: 'Botas',
  physical: 'Daño físico',
  magic: 'Poder de habilidad',
  defense: 'Defensa',
  support: 'Soporte',
};
