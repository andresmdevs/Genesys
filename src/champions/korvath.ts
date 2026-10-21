import { secToTicks } from '../sim/constants.ts';
import {
  applyShield,
  applySlow,
  applyStatBuff,
  byRank,
  damageCircle,
  damageCone,
  dashToward,
  knockBack,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Kórvath - a melee juggernaut who gets harder to kill the longer a fight
 * lasts. His whole kit rewards standing in the middle of the enemy team.
 */
export default registerChampion({
  id: 'korvath',
  name: 'Kórvath',
  title: 'El Yunque Viviente',
  role: 'top',
  ranged: false,
  difficulty: 1,
  colour: '#e0a44c',
  blurb:
    'Cuanto más lo golpean, más duro se vuelve. Entra el primero, aguanta el castigo y parte la línea enemiga.',

  base: {
    maxHp: 680,
    hpRegen: 9,
    maxMana: 320,
    manaRegen: 7.5,
    ad: 64,
    armor: 36,
    mr: 32,
    attackSpeed: 0.63,
    moveSpeed: 345,
    attackRange: 180,
  },
  growth: { maxHp: 112, ad: 3.6, armor: 4.8, mr: 1.5, hpRegen: 0.9 },
  radius: 70,

  passive: {
    name: 'Yunque',
    description:
      'Recibir daño otorga una carga de Yunque (máx. 6) que concede 4 de armadura y resistencia mágica durante 5 s.',
    onDamaged(world, unit, _source, amount) {
      if (amount < 8) return;
      world.applyEffect(unit.id, {
        kind: 'stat',
        tag: 'korvath-anvil',
        sourceId: unit.id,
        endsTick: world.tick + secToTicks(5),
        value: 1,
        stats: { armor: 4, mr: 4 },
        stacks: 1,
        maxStacks: 6,
      });
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      name: 'Tajo sísmico',
      description:
        'Barre un cono frente a él causando daño físico y ralentizando un 30 % durante 1,5 s.',
      targeting: 'point',
      cooldown: [7, 6.5, 6, 5.5, 5],
      cost: [35, 40, 45, 50, 55],
      range: 420,
      castTime: 0.25,
      indicatorRadius: 420,
      cast({ world, caster, rank, point }) {
        const facing = Math.atan2(point.y - caster.pos.y, point.x - caster.pos.x);
        const amount = resolveDamage(caster, rank, {
          base: [60, 95, 130, 165, 200],
          bonusAd: 0.9,
        });
        world.addFx({
          style: 'cone-slash',
          pos: { ...caster.pos },
          radius: 420,
          angle: facing,
          life: 12,
          age: 0,
          colour: '#e0a44c',
        });
        damageCone(world, caster, facing, Math.PI / 4, 420, amount, {
          type: 'physical',
          label: 'Tajo sísmico',
          onHit: (target) => applySlow(world, target.id, caster.id, 0.3, 1.5, 'korvath-q'),
        });
      },
    },

    W: {
      key: 'W',
      name: 'Muro de escoria',
      description:
        'Se cubre con un escudo durante 3 s y gana tenacidad mientras dure.',
      targeting: 'self',
      cooldown: [16, 15, 14, 13, 12],
      cost: [50, 55, 60, 65, 70],
      range: 0,
      cast({ world, caster, rank }) {
        const amount = resolveDamage(caster, rank, {
          base: [70, 110, 150, 190, 230],
          maxHp: 0.08,
        });
        applyShield(world, caster.id, caster.id, amount, 3, 'korvath-w');
        applyStatBuff(world, caster.id, caster.id, { tenacity: 0.35 }, 3, 'korvath-w-ten');
      },
    },

    E: {
      key: 'E',
      name: 'Embestida',
      description:
        'Carga hacia delante, causando daño y empujando por los aires a los enemigos alcanzados.',
      targeting: 'point',
      cooldown: [18, 17, 16, 15, 14],
      cost: [60, 65, 70, 75, 80],
      range: 560,
      indicatorWidth: 150,
      cast({ world, caster, rank, point }) {
        const origin = { ...caster.pos };
        dashToward(world, caster, point, 560, 1250);
        const amount = resolveDamage(caster, rank, {
          base: [70, 110, 150, 190, 230],
          bonusAd: 0.7,
        });
        // Damage resolves when the charge ends, so it catches whoever is there.
        const casterId = caster.id;
        world.spawnZone({
          team: caster.team,
          ownerId: casterId,
          pos: origin,
          radius: 0,
          endsTick: world.tick + secToTicks(0.6),
          period: secToTicks(0.45),
          style: 'invisible',
          onTick: (w, zone) => {
            const self = w.getUnit(casterId);
            if (!self) return;
            zone.endsTick = w.tick;
            damageCircle(w, self, self.pos, 230, amount, {
              type: 'physical',
              label: 'Embestida',
              onHit: (target) => knockBack(w, target, self.pos, 180, 0.45),
            });
            w.addFx({ style: 'impact', pos: { ...self.pos }, radius: 230, life: 14, age: 0, colour: '#e0a44c' });
          },
        });
      },
    },

    R: {
      key: 'R',
      name: 'Fragua de guerra',
      description:
        'Durante 7 s reduce el daño recibido y golpea cada 0,5 s a los enemigos cercanos con daño mágico.',
      targeting: 'self',
      cooldown: [110, 95, 80],
      cost: [100, 100, 100],
      range: 0,
      isUltimate: true,
      indicatorRadius: 420,
      cast({ world, caster, rank }) {
        const reduction = byRank([0.18, 0.24, 0.3], rank);
        applyStatBuff(
          world,
          caster.id,
          caster.id,
          { damageTaken: 1 - reduction, moveSpeed: 25 },
          7,
          'korvath-r',
        );
        const perPulse = resolveDamage(caster, rank, { base: [22, 34, 46], maxHp: 0.012 });
        const casterId = caster.id;
        world.spawnZone({
          team: caster.team,
          ownerId: casterId,
          pos: { ...caster.pos },
          radius: 420,
          endsTick: world.tick + secToTicks(7),
          period: secToTicks(0.5),
          style: 'forge-aura',
          onTick: (w, zone) => {
            const self = w.getUnit(casterId);
            if (!self || !self.alive) {
              zone.endsTick = w.tick;
              return;
            }
            zone.pos.x = self.pos.x;
            zone.pos.y = self.pos.y;
            damageCircle(w, self, self.pos, zone.radius, perPulse, {
              type: 'magic',
              label: 'Fragua de guerra',
            });
          },
        });
      },
    },
  },

  buildOrder: ['bootsbase', 'ruby', 'titanaegis', 'boots-steel', 'breaker', 'voidmantle', 'thornmail'],
  skillOrder: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
});
