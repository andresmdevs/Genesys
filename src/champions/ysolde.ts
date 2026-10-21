import { secToTicks } from '../sim/constants.ts';
import {
  applyCc,
  applyShield,
  applySlow,
  byRank,
  createZone,
  damageCircle,
  fireSkillshot,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Ysolde - a control mage. Her damage is ordinary; what she sells is denying
 * ground and locking a target down long enough for her team to arrive.
 */
export default registerChampion({
  id: 'ysolde',
  name: 'Ysolde',
  title: 'Corazón de Escarcha',
  role: 'mage',
  ranged: true,
  difficulty: 2,
  colour: '#5ec8ff',
  blurb:
    'No mata rápido: congela el terreno, parte las peleas en dos y decide quién puede huir.',

  base: {
    maxHp: 560,
    hpRegen: 6.5,
    maxMana: 480,
    manaRegen: 11,
    ad: 54,
    armor: 24,
    mr: 30,
    attackSpeed: 0.62,
    moveSpeed: 335,
    attackRange: 575,
  },
  growth: { maxHp: 86, ad: 2.8, armor: 3.6, mr: 1.3, maxMana: 60, manaRegen: 0.9 },

  passive: {
    name: 'Escarcha',
    description: 'Cualquier habilidad de Ysolde ralentiza un 18 % adicional durante 1 s.',
  },

  abilities: {
    Q: {
      key: 'Q',
      name: 'Lanza de hielo',
      description: 'Dispara una lanza que atraviesa a todos los enemigos en línea recta.',
      targeting: 'direction',
      cooldown: [7, 6.5, 6, 5.5, 5],
      cost: [50, 55, 60, 65, 70],
      range: 1000,
      indicatorWidth: 64,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [65, 100, 135, 170, 205], ap: 0.6 });
        fireSkillshot(world, caster, {
          speed: 1700,
          width: 64,
          range: 1000,
          style: 'ice-lance',
          pierce: true,
          towards: point,
          onHit: (w, _p, target) => {
            if (target.isStatic) return;
            w.dealDamage({
              amount,
              type: 'magic',
              sourceId: caster.id,
              targetId: target.id,
              isAuto: false,
              isCrit: false,
              label: 'Lanza de hielo',
            });
            chill(w, caster, target.id);
          },
        });
      },
    },

    W: {
      key: 'W',
      name: 'Campo gélido',
      description:
        'Cubre una zona de escarcha durante 4 s que causa daño y ralentiza a quien la pise.',
      targeting: 'point',
      cooldown: [14, 13, 12, 11, 10],
      cost: [70, 75, 80, 85, 90],
      range: 850,
      indicatorRadius: 360,
      cast({ world, caster, rank, point }) {
        const perPulse = resolveDamage(caster, rank, { base: [20, 32, 44, 56, 68], ap: 0.12 });
        const slow = byRank([0.3, 0.35, 0.4, 0.45, 0.5], rank);
        createZone(world, caster, point, {
          radius: 360,
          seconds: 4,
          style: 'frost-field',
          period: 0.5,
          onPulse: (w, zone) => {
            damageCircle(w, caster, zone.pos, zone.radius, perPulse, {
              type: 'magic',
              label: 'Campo gélido',
              onHit: (target) => {
                applySlow(w, target.id, caster.id, slow, 0.7, 'ysolde-w');
                chill(w, caster, target.id);
              },
            });
          },
        });
      },
    },

    E: {
      key: 'E',
      name: 'Barrera de hielo',
      description: 'Escuda a un aliado durante 3 s. Puede lanzarse sobre sí misma.',
      targeting: 'ally',
      cooldown: [15, 14, 13, 12, 11],
      cost: [60, 65, 70, 75, 80],
      range: 750,
      cast({ world, caster, rank, targetId }) {
        const target = world.getUnit(targetId) ?? caster;
        const amount = resolveDamage(caster, rank, { base: [80, 125, 170, 215, 260], ap: 0.55 });
        applyShield(world, target.id, caster.id, amount, 3, 'ysolde-e');
      },
    },

    R: {
      key: 'R',
      name: 'Invierno eterno',
      description:
        'Tras 0,75 s, congela una gran zona: daño mágico y enraizamiento a todos los enemigos alcanzados.',
      targeting: 'point',
      cooldown: [120, 105, 90],
      cost: [100, 120, 140],
      range: 900,
      isUltimate: true,
      indicatorRadius: 560,
      castTime: 0.4,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [180, 290, 400], ap: 0.8 });
        const root = byRank([1.3, 1.6, 1.9], rank);
        world.addFx({
          style: 'winter-telegraph',
          pos: { ...point },
          radius: 560,
          life: secToTicks(0.75),
          age: 0,
          colour: '#5ec8ff',
        });
        createZone(world, caster, point, {
          radius: 560,
          seconds: 0.8,
          style: 'invisible',
          period: 0.75,
          onPulse: (w, zone) => {
            zone.endsTick = w.tick;
            damageCircle(w, caster, zone.pos, zone.radius, amount, {
              type: 'magic',
              label: 'Invierno eterno',
              onHit: (target) => {
                applyCc(w, target.id, caster.id, 'root', root, 'ysolde-r');
                chill(w, caster, target.id);
              },
            });
            w.addFx({ style: 'winter-burst', pos: { ...zone.pos }, radius: 560, life: 26, age: 0, colour: '#5ec8ff' });
          },
        });
      },
    },
  },

  buildOrder: ['bootsbase', 'rod', 'abyssal', 'boots-lucid', 'emberbrand', 'rimeveil', 'hourglass'],
  skillOrder: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
});

/** Ysolde's passive: a small extra slow layered on every ability hit. */
function chill(
  world: import('../sim/types.ts').WorldLike,
  caster: import('../sim/types.ts').Unit,
  targetId: number,
): void {
  applySlow(world, targetId, caster.id, 0.18, 1, 'ysolde-chill');
}
