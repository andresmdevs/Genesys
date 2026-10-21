import {
  applyDot,
  applyStatBuff,
  byRank,
  dashToward,
  damageCircle,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Mordrax - a sustain bruiser. He wins extended duels rather than short ones,
 * trading burst for healing that scales with how hurt he already is.
 */
export default registerChampion({
  id: 'mordrax',
  name: 'Mordrax',
  title: 'El Hambre Carmesí',
  role: 'top',
  ranged: false,
  difficulty: 2,
  colour: '#d6435f',
  blurb:
    'Se cura con la sangre ajena. Cuanto más baja tiene la vida, más devuelve cada golpe.',

  base: {
    maxHp: 655,
    hpRegen: 8.5,
    maxMana: 300,
    manaRegen: 7,
    ad: 68,
    armor: 33,
    mr: 32,
    attackSpeed: 0.66,
    moveSpeed: 345,
    attackRange: 175,
  },
  growth: { maxHp: 105, ad: 3.9, armor: 4.4, mr: 1.3 },

  passive: {
    name: 'Sed',
    description:
      'Se cura por el 12 % del daño que inflige; por el 28 % mientras esté por debajo del 50 % de vida.',
    onAutoAttackHit(world, unit, _target, damage) {
      const ratio = unit.hp / Math.max(1, unit.stats.maxHp) < 0.5 ? 0.28 : 0.12;
      world.heal(unit.id, damage * ratio, unit.id);
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      name: 'Desgarro',
      description:
        'Desgarra al objetivo causando daño físico inmediato y una hemorragia durante 4 s.',
      targeting: 'enemy',
      cooldown: [6, 5.5, 5, 4.5, 4],
      cost: [30, 35, 40, 45, 50],
      range: 300,
      cast({ world, caster, rank, targetId }) {
        const target = world.getUnit(targetId);
        if (!target) return;
        const burst = resolveDamage(caster, rank, { base: [45, 70, 95, 120, 145], bonusAd: 0.6 });
        const dealt = world.dealDamage({
          amount: burst,
          type: 'physical',
          sourceId: caster.id,
          targetId: target.id,
          isAuto: false,
          isCrit: false,
          label: 'Desgarro',
        });
        world.heal(caster.id, dealt * 0.3, caster.id);
        const bleed = resolveDamage(caster, rank, { base: [8, 13, 18, 23, 28], bonusAd: 0.08 });
        applyDot(world, target.id, caster.id, bleed, 4, 'mordrax-bleed', 'physical');
        world.addFx({ style: 'rend', pos: { ...target.pos }, life: 14, age: 0, colour: '#d6435f' });
      },
    },

    W: {
      key: 'W',
      name: 'Frenesí',
      description:
        'Durante 5 s gana velocidad de ataque y robo de vida adicional.',
      targeting: 'self',
      cooldown: [15, 14, 13, 12, 11],
      cost: [40, 45, 50, 55, 60],
      range: 0,
      cast({ world, caster, rank }) {
        applyStatBuff(
          world,
          caster.id,
          caster.id,
          {
            attackSpeed: byRank([0.3, 0.4, 0.5, 0.6, 0.7], rank),
            lifesteal: byRank([0.08, 0.11, 0.14, 0.17, 0.2], rank),
            moveSpeed: 20,
          },
          5,
          'mordrax-w',
        );
        world.addFx({ style: 'frenzy', pos: { ...caster.pos }, radius: 140, life: 20, age: 0, colour: '#d6435f' });
      },
    },

    E: {
      key: 'E',
      name: 'Salto depredador',
      description: 'Salta a la posición indicada causando daño al aterrizar.',
      targeting: 'point',
      cooldown: [14, 13, 12, 11, 10],
      cost: [50, 55, 60, 65, 70],
      range: 600,
      cast({ world, caster, rank, point }) {
        dashToward(world, caster, point, 600, 1400);
        const amount = resolveDamage(caster, rank, { base: [55, 85, 115, 145, 175], bonusAd: 0.5 });
        const casterId = caster.id;
        world.spawnZone({
          team: caster.team,
          ownerId: casterId,
          pos: { ...point },
          radius: 0,
          endsTick: world.tick + 20,
          period: 14,
          style: 'invisible',
          onTick: (w, zone) => {
            const self = w.getUnit(casterId);
            zone.endsTick = w.tick;
            if (!self) return;
            damageCircle(w, self, self.pos, 260, amount, {
              type: 'physical',
              label: 'Salto depredador',
            });
            w.addFx({ style: 'impact', pos: { ...self.pos }, radius: 260, life: 12, age: 0, colour: '#d6435f' });
          },
        });
      },
    },

    R: {
      key: 'R',
      name: 'Ejecución carmesí',
      description:
        'Daño que aumenta con la vida que le falta al objetivo. Se cura por una parte del daño causado.',
      targeting: 'enemy',
      cooldown: [90, 75, 60],
      cost: [100, 100, 100],
      range: 450,
      isUltimate: true,
      castTime: 0.3,
      cast({ world, caster, rank, targetId }) {
        const target = world.getUnit(targetId);
        if (!target) return;
        const missing = 1 - target.hp / Math.max(1, target.stats.maxHp);
        const base = resolveDamage(caster, rank, { base: [160, 260, 360], bonusAd: 1.0 });
        // Up to double damage against a target at the brink.
        const amount = base * (1 + missing);
        const dealt = world.dealDamage({
          amount,
          type: 'physical',
          sourceId: caster.id,
          targetId: target.id,
          isAuto: false,
          isCrit: missing > 0.6,
          label: 'Ejecución carmesí',
        });
        world.heal(caster.id, dealt * 0.35, caster.id);
        world.addFx({
          style: 'execute',
          pos: { ...caster.pos },
          to: { ...target.pos },
          life: 18,
          age: 0,
          colour: '#d6435f',
        });
      },
    },
  },

  buildOrder: ['bootsbase', 'sword', 'bloodedge', 'boots-steel', 'breaker', 'titanaegis', 'thornmail'],
  skillOrder: ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
});
