import { secToTicks } from '../sim/constants.ts';
import {
  applyCc,
  applyShield,
  applySlow,
  applyStatBuff,
  byRank,
  damageCircle,
  dashToward,
  fireSkillshot,
  knockBack,
  pullTowards,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Grommar - the engage tank. One landed hook decides a teamfight, which is
 * why everything else in his kit is about surviving the aftermath.
 */
export default registerChampion({
  id: 'grommar',
  name: 'Grommar',
  title: 'El Muro de Piedra',
  role: 'support',
  ranged: false,
  difficulty: 2,
  colour: '#9aa7b8',
  blurb:
    'Un enganche y la pelea empieza. Arrastra, aturde y aguanta mientras los suyos rematan.',

  base: {
    maxHp: 650,
    hpRegen: 8.5,
    maxMana: 360,
    manaRegen: 8.5,
    ad: 58,
    armor: 35,
    mr: 32,
    attackSpeed: 0.62,
    moveSpeed: 340,
    attackRange: 180,
  },
  growth: { maxHp: 108, ad: 3.1, armor: 4.6, mr: 1.5 },
  radius: 72,

  passive: {
    name: 'Baluarte',
    description: 'Los aliados cercanos reciben armadura y resistencia mágica.',
    onTick(world, unit) {
      if (world.tick % 15 !== 0) return;
      const bonus = 5 + unit.level * 1.1;
      for (const ally of world.alliesOf(unit.team, unit.pos, 700)) {
        if (ally.kind !== 'champion' || ally.id === unit.id) continue;
        world.applyEffect(ally.id, {
          kind: 'stat',
          tag: 'grommar-bulwark',
          sourceId: unit.id,
          endsTick: world.tick + secToTicks(1),
          value: 1,
          stats: { armor: bonus, mr: bonus },
        });
      }
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      name: 'Garra de cadena',
      description:
        'Lanza una cadena: el primer enemigo alcanzado recibe daño y es arrastrado hacia Grommar.',
      targeting: 'direction',
      cooldown: [16, 15, 14, 13, 12],
      cost: [60, 65, 70, 75, 80],
      range: 950,
      indicatorWidth: 64,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [80, 125, 170, 215, 260], ap: 0.5 });
        fireSkillshot(world, caster, {
          speed: 1700,
          width: 64,
          range: 950,
          style: 'chain-claw',
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
              label: 'Garra de cadena',
            });
            pullTowards(w, target, caster.pos, 1400, caster.radius + target.radius + 20);
            applySlow(w, target.id, caster.id, 0.3, 1, 'grommar-q');
            w.addFx({
              style: 'chain-link',
              pos: { ...caster.pos },
              to: { ...target.pos },
              life: 14,
              age: 0,
              colour: '#9aa7b8',
            });
          },
        });
      },
    },

    W: {
      key: 'W',
      name: 'Piel de roca',
      description: 'Se escuda durante 3 s y gana armadura y resistencia mágica.',
      targeting: 'self',
      cooldown: [15, 14, 13, 12, 11],
      cost: [50, 55, 60, 65, 70],
      range: 0,
      cast({ world, caster, rank }) {
        const amount = resolveDamage(caster, rank, { base: [70, 110, 150, 190, 230], maxHp: 0.07 });
        applyShield(world, caster.id, caster.id, amount, 3, 'grommar-w');
        applyStatBuff(
          world,
          caster.id,
          caster.id,
          { armor: byRank([18, 24, 30, 36, 42], rank), mr: byRank([18, 24, 30, 36, 42], rank) },
          3,
          'grommar-w-res',
        );
      },
    },

    E: {
      key: 'E',
      name: 'Golpe sísmico',
      description: 'Golpea el suelo lanzando por los aires a los enemigos muy cercanos.',
      targeting: 'self',
      cooldown: [14, 13, 12, 11, 10],
      cost: [55, 60, 65, 70, 75],
      range: 0,
      indicatorRadius: 300,
      castTime: 0.25,
      cast({ world, caster, rank }) {
        const amount = resolveDamage(caster, rank, { base: [60, 95, 130, 165, 200], ap: 0.45 });
        damageCircle(world, caster, caster.pos, 300, amount, {
          type: 'magic',
          label: 'Golpe sísmico',
          onHit: (target) => knockBack(world, target, caster.pos, 120, 0.6),
        });
        world.addFx({ style: 'quake', pos: { ...caster.pos }, radius: 300, life: 18, age: 0, colour: '#9aa7b8' });
      },
    },

    R: {
      key: 'R',
      name: 'Carga imparable',
      description:
        'Carga hacia delante. El primer campeón enemigo que golpee recibe daño y queda aturdido.',
      targeting: 'point',
      cooldown: [100, 85, 70],
      cost: [100, 100, 100],
      range: 1100,
      isUltimate: true,
      indicatorWidth: 160,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [180, 280, 380], ap: 0.8 });
        const stun = byRank([1.3, 1.6, 1.9], rank);
        dashToward(world, caster, point, 1100, 1300);

        const casterId = caster.id;
        world.spawnZone({
          team: caster.team,
          ownerId: casterId,
          pos: { ...caster.pos },
          radius: 0,
          endsTick: world.tick + secToTicks(1.4),
          period: 1,
          style: 'invisible',
          onTick: (w, zone) => {
            const self = w.getUnit(casterId);
            if (!self || !self.alive) {
              zone.endsTick = w.tick;
              return;
            }
            const hit = w
              .enemiesOf(self.team, self.pos, self.radius + 150)
              .find((u) => u.kind === 'champion');
            if (!hit) {
              // The charge ended without connecting.
              if (!self.displacement) zone.endsTick = w.tick;
              return;
            }
            zone.endsTick = w.tick;
            // Stop dead on impact rather than sliding past the target.
            self.displacement = null;
            w.dealDamage({
              amount,
              type: 'magic',
              sourceId: self.id,
              targetId: hit.id,
              isAuto: false,
              isCrit: true,
              label: 'Carga imparable',
            });
            applyCc(w, hit.id, self.id, 'stun', stun, 'grommar-r');
            w.addFx({ style: 'charge-impact', pos: { ...hit.pos }, radius: 260, life: 20, age: 0, colour: '#9aa7b8' });
          },
        });
      },
    },
  },

  buildOrder: ['bootsbase', 'ruby', 'dawnbanner', 'boots-mist', 'titanaegis', 'voidmantle', 'thornmail'],
  skillOrder: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W', 'R', 'W', 'W'],
});
