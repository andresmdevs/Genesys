import { secToTicks } from '../sim/constants.ts';
import {
  applyHaste,
  applyShield,
  byRank,
  fireSkillshot,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Lumen - a pure enchanter. No escape and almost no damage: every button is
 * spent on somebody else, so positioning is the whole skill expression.
 */
export default registerChampion({
  id: 'lumen',
  name: 'Lumen',
  title: 'Guardián del Alba',
  role: 'support',
  ranged: true,
  difficulty: 1,
  colour: '#ffe9a8',
  blurb:
    'Mantiene viva a su línea. Cura, escuda y acelera; sin ella el tirador no existe.',

  base: {
    maxHp: 580,
    hpRegen: 7.5,
    maxMana: 460,
    manaRegen: 11,
    ad: 51,
    armor: 26,
    mr: 30,
    attackSpeed: 0.62,
    moveSpeed: 335,
    attackRange: 550,
  },
  growth: { maxHp: 90, ad: 2.6, armor: 4, mr: 1.3, maxMana: 55, manaRegen: 1 },

  passive: {
    name: 'Aura del alba',
    description: 'Los aliados cercanos regeneran vida de forma constante.',
    onTick(world, unit) {
      // Throttled: a heal every half second is plenty and keeps the cost down.
      if (world.tick % 15 !== 0) return;
      const amount = 3 + unit.level * 0.8 + unit.stats.ap * 0.02;
      for (const ally of world.alliesOf(unit.team, unit.pos, 800)) {
        if (ally.kind !== 'champion' || ally.id === unit.id) continue;
        world.heal(ally.id, amount, unit.id);
      }
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      botUse: 'damage',
      name: 'Rayo de luz',
      description: 'Proyecta un haz que daña al primer enemigo alcanzado.',
      targeting: 'direction',
      cooldown: [7, 6.5, 6, 5.5, 5],
      cost: [50, 55, 60, 65, 70],
      range: 950,
      indicatorWidth: 60,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [60, 95, 130, 165, 200], ap: 0.55 });
        fireSkillshot(world, caster, {
          speed: 1800,
          width: 60,
          range: 950,
          style: 'light-beam',
          towards: point,
          onHit: (w, _p, target) => {
            w.dealDamage({
              amount,
              type: 'magic',
              sourceId: caster.id,
              targetId: target.id,
              isAuto: false,
              isCrit: false,
              label: 'Rayo de luz',
            });
          },
        });
      },
    },

    W: {
      key: 'W',
      botUse: 'support',
      name: 'Bendición',
      description: 'Cura a un aliado y le concede velocidad de movimiento durante 2 s.',
      targeting: 'ally',
      cooldown: [12, 11, 10, 9, 8],
      cost: [70, 75, 80, 85, 90],
      range: 750,
      cast({ world, caster, rank, targetId }) {
        const target = world.getUnit(targetId) ?? caster;
        const amount = resolveDamage(caster, rank, { base: [70, 110, 150, 190, 230], ap: 0.5 });
        world.heal(target.id, amount, caster.id);
        applyHaste(world, target.id, caster.id, 0.25, 2, 'lumen-w');
        world.addFx({
          style: 'bless',
          pos: { ...caster.pos },
          to: { ...target.pos },
          life: 18,
          age: 0,
          colour: '#ffe9a8',
        });
      },
    },

    E: {
      key: 'E',
      botUse: 'support',
      name: 'Égida',
      description: 'Escuda a un aliado durante 3 s.',
      targeting: 'ally',
      cooldown: [14, 13, 12, 11, 10],
      cost: [60, 65, 70, 75, 80],
      range: 800,
      cast({ world, caster, rank, targetId }) {
        const target = world.getUnit(targetId) ?? caster;
        const amount = resolveDamage(caster, rank, { base: [85, 135, 185, 235, 285], ap: 0.6 });
        applyShield(world, target.id, caster.id, amount, 3, 'lumen-e');
      },
    },

    R: {
      key: 'R',
      botUse: 'buff',
      name: 'Amanecer',
      description:
        'Cura a todos los aliados cercanos, los escuda y elimina las ralentizaciones que sufran.',
      targeting: 'self',
      cooldown: [120, 105, 90],
      cost: [100, 120, 140],
      range: 0,
      isUltimate: true,
      indicatorRadius: 900,
      castTime: 0.3,
      cast({ world, caster, rank }) {
        const heal = resolveDamage(caster, rank, { base: [180, 280, 380], ap: 0.7 });
        const shield = byRank([80, 130, 180], rank) + caster.stats.ap * 0.3;
        for (const ally of world.alliesOf(caster.team, caster.pos, 900)) {
          if (ally.kind !== 'champion') continue;
          world.heal(ally.id, heal, caster.id);
          applyShield(world, ally.id, caster.id, shield, 3, 'lumen-r');
          world.removeEffectsByTag(ally.id, 'slow');
          // Clear the named slows the other kits apply as well.
          for (const tag of ['ysolde-w', 'ysolde-chill', 'nyx-fog-slow', 'korvath-q', 'thessa-r']) {
            world.removeEffectsByTag(ally.id, tag);
          }
          world.applyEffect(ally.id, {
            kind: 'haste',
            tag: 'lumen-r-ms',
            sourceId: caster.id,
            endsTick: world.tick + secToTicks(2),
            value: 0.2,
          });
        }
        world.addFx({ style: 'dawn', pos: { ...caster.pos }, radius: 900, life: 34, age: 0, colour: '#ffe9a8' });
      },
    },
  },

  buildOrder: ['bootsbase', 'rod', 'lightchalice', 'boots-lucid', 'dawnbanner', 'abyssal', 'ironheart'],
  skillOrder: ['W', 'E', 'Q', 'W', 'W', 'R', 'W', 'E', 'W', 'E', 'R', 'E', 'E', 'Q', 'Q', 'R', 'Q', 'Q'],
});
