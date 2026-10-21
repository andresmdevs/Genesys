import {
  applyStatBuff,
  byRank,
  dashToward,
  fireSkillshot,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Ryka - the straightforward crit marksman. Low range, high ceiling: she
 * needs the attack-speed window to be worth anything, and dies if caught.
 */
export default registerChampion({
  id: 'ryka',
  name: 'Ryka',
  title: 'Puntería Perfecta',
  role: 'adc',
  ranged: true,
  difficulty: 1,
  colour: '#ffd166',
  blurb:
    'Daño sostenido puro. Si sobrevive a los primeros tres segundos de una pelea, la gana.',

  base: {
    maxHp: 575,
    hpRegen: 7,
    maxMana: 350,
    manaRegen: 8,
    ad: 62,
    armor: 26,
    mr: 30,
    attackSpeed: 0.72,
    moveSpeed: 335,
    attackRange: 550,
  },
  growth: { maxHp: 92, ad: 3.4, armor: 4.2, mr: 1.3, attackSpeed: 0.035 },

  passive: {
    name: 'Cadencia',
    description: 'Cada tercer ataque básico inflige daño físico adicional.',
    onAutoAttackHit(world, unit, target) {
      const memory = unit.champion!.abilities.W.memory;
      memory.hits = (memory.hits ?? 0) + 1;
      if (memory.hits < 3) return;
      memory.hits = 0;
      world.dealDamage({
        amount: 12 + unit.level * 4 + unit.stats.ad * 0.45,
        type: 'physical',
        sourceId: unit.id,
        targetId: target.id,
        isAuto: true,
        isCrit: false,
        label: 'Cadencia',
      });
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      botUse: 'damage',
      name: 'Disparo perforante',
      description: 'Dispara una flecha que atraviesa a todos los enemigos en línea.',
      targeting: 'direction',
      cooldown: [9, 8, 7, 6, 5],
      cost: [40, 45, 50, 55, 60],
      range: 1000,
      indicatorWidth: 56,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [30, 50, 70, 90, 110], ad: 1.1 });
        fireSkillshot(world, caster, {
          speed: 2000,
          width: 56,
          range: 1000,
          style: 'pierce-arrow',
          pierce: true,
          towards: point,
          onHit: (w, _p, target) => {
            if (target.isStatic) return;
            w.dealDamage({
              amount,
              type: 'physical',
              sourceId: caster.id,
              targetId: target.id,
              isAuto: false,
              isCrit: false,
              label: 'Disparo perforante',
            });
          },
        });
      },
    },

    W: {
      key: 'W',
      botUse: 'buff',
      name: 'Ráfaga',
      description: 'Durante 4 s gana velocidad de ataque y de movimiento.',
      targeting: 'self',
      cooldown: [16, 15, 14, 13, 12],
      cost: [45, 45, 45, 45, 45],
      range: 0,
      cast({ world, caster, rank }) {
        applyStatBuff(
          world,
          caster.id,
          caster.id,
          {
            attackSpeed: byRank([0.35, 0.45, 0.55, 0.65, 0.75], rank),
            moveSpeed: byRank([25, 32, 39, 46, 53], rank),
          },
          4,
          'ryka-w',
        );
        world.addFx({ style: 'speed-up', pos: { ...caster.pos }, radius: 130, life: 18, age: 0, colour: '#ffd166' });
      },
    },

    E: {
      key: 'E',
      botUse: 'escape',
      name: 'Reposición',
      description: 'Da un salto corto en la dirección indicada.',
      targeting: 'point',
      cooldown: [17, 16, 15, 14, 13],
      cost: [50, 50, 50, 50, 50],
      range: 420,
      cast({ world, caster, point }) {
        dashToward(world, caster, point, 420, 1700);
        world.addFx({ style: 'hop', pos: { ...caster.pos }, to: { ...point }, life: 12, age: 0, colour: '#ffd166' });
      },
    },

    R: {
      key: 'R',
      botUse: 'damage',
      name: 'Tiro de precisión',
      description:
        'Un disparo de largo alcance que atraviesa y causa un daño físico devastador.',
      targeting: 'direction',
      cooldown: [90, 75, 60],
      cost: [100, 100, 100],
      range: 2200,
      isUltimate: true,
      indicatorWidth: 74,
      castTime: 0.35,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [180, 280, 380], ad: 1.5 });
        fireSkillshot(world, caster, {
          speed: 2600,
          width: 74,
          range: 2200,
          style: 'precision-shot',
          pierce: true,
          towards: point,
          onHit: (w, _p, target) => {
            if (target.isStatic) return;
            w.dealDamage({
              amount,
              type: 'physical',
              sourceId: caster.id,
              targetId: target.id,
              isAuto: false,
              isCrit: true,
              label: 'Tiro de precisión',
            });
          },
        });
      },
    },
  },

  buildOrder: ['bootsbase', 'dagger', 'stalker', 'boots-speed', 'infinity', 'bloodedge', 'breaker'],
  skillOrder: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
});
