import { secToTicks } from '../sim/constants.ts';
import {
  applyCc,
  applySlow,
  byRank,
  createZone,
  dashToward,
  fireSkillshot,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Thessa - the artillery marksman. She trades Ryka's sustained output for
 * range, so her game is chipping a lane down from outside its reach.
 */
export default registerChampion({
  id: 'thessa',
  name: 'Thessa',
  title: 'La Cazadora de Brumas',
  role: 'adc',
  ranged: true,
  difficulty: 2,
  colour: '#7ef0c8',
  blurb:
    'Castiga desde fuera de alcance. Marca, acosa y corta la retirada con trampas.',

  base: {
    maxHp: 565,
    hpRegen: 6.8,
    maxMana: 380,
    manaRegen: 9,
    ad: 58,
    armor: 25,
    mr: 30,
    attackSpeed: 0.66,
    moveSpeed: 330,
    attackRange: 625,
  },
  growth: { maxHp: 88, ad: 3.1, armor: 4, mr: 1.3, attackSpeed: 0.028 },

  passive: {
    name: 'Marca de caza',
    description:
      'Sus ataques básicos marcan al objetivo durante 4 s. Los enemigos marcados reciben un 8 % más de daño de cualquier fuente.',
    onAutoAttackHit(world, unit, target) {
      if (target.isStatic) return;
      world.applyEffect(target.id, {
        kind: 'stat',
        tag: 'thessa-mark',
        sourceId: unit.id,
        endsTick: world.tick + secToTicks(4),
        value: 1,
        stats: { damageTaken: 1.08 },
      });
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      botUse: 'damage',
      name: 'Flecha larga',
      description: 'Dispara una flecha de muy largo alcance que atraviesa a todos los enemigos.',
      targeting: 'direction',
      cooldown: [8, 7.5, 7, 6.5, 6],
      cost: [50, 55, 60, 65, 70],
      range: 1400,
      indicatorWidth: 54,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [45, 70, 95, 120, 145], ad: 0.9 });
        fireSkillshot(world, caster, {
          speed: 1900,
          width: 54,
          range: 1400,
          style: 'long-arrow',
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
              label: 'Flecha larga',
            });
          },
        });
      },
    },

    W: {
      key: 'W',
      botUse: 'zone',
      name: 'Trampa de bruma',
      description:
        'Coloca una trampa que permanece 45 s. Al activarse enraíza y ralentiza a los enemigos cercanos.',
      targeting: 'point',
      cooldown: [18, 16, 14, 12, 10],
      cost: [45, 45, 45, 45, 45],
      range: 850,
      indicatorRadius: 200,
      cast({ world, caster, rank, point }) {
        const root = byRank([1, 1.2, 1.4, 1.6, 1.8], rank);
        const amount = resolveDamage(caster, rank, { base: [40, 65, 90, 115, 140], ad: 0.4 });
        createZone(world, caster, point, {
          radius: 200,
          seconds: 45,
          style: 'hunt-trap',
          period: 0.25,
          onPulse: (w, zone) => {
            const caught = w
              .enemiesOf(caster.team, zone.pos, zone.radius)
              .filter((u) => u.kind === 'champion' || u.kind === 'monster');
            if (caught.length === 0) return;
            zone.endsTick = w.tick;
            for (const target of caught) {
              w.dealDamage({
                amount,
                type: 'magic',
                sourceId: caster.id,
                targetId: target.id,
                isAuto: false,
                isCrit: false,
                label: 'Trampa de bruma',
              });
              applyCc(w, target.id, caster.id, 'root', root, 'thessa-w');
              applySlow(w, target.id, caster.id, 0.4, root + 1, 'thessa-w-slow');
            }
            w.addFx({ style: 'trap-snap', pos: { ...zone.pos }, radius: 200, life: 18, age: 0, colour: '#7ef0c8' });
          },
        });
      },
    },

    E: {
      key: 'E',
      botUse: 'escape',
      name: 'Salto atrás',
      description: 'Retrocede de un salto alejándose del punto indicado.',
      targeting: 'point',
      cooldown: [16, 15, 14, 13, 12],
      cost: [50, 50, 50, 50, 50],
      range: 400,
      cast({ world, caster, point }) {
        // Aim is read as "jump away from here", which is how a kite button reads.
        const away = {
          x: caster.pos.x - (point.x - caster.pos.x),
          y: caster.pos.y - (point.y - caster.pos.y),
        };
        dashToward(world, caster, away, 400, 1600);
        world.addFx({ style: 'hop', pos: { ...caster.pos }, to: away, life: 12, age: 0, colour: '#7ef0c8' });
      },
    },

    R: {
      key: 'R',
      botUse: 'damage',
      name: 'Disparo del ocaso',
      description:
        'Un proyectil de alcance enorme cuyo daño aumenta cuanto más lejos viaja.',
      targeting: 'direction',
      cooldown: [100, 85, 70],
      cost: [100, 100, 100],
      range: 3400,
      isUltimate: true,
      indicatorWidth: 90,
      castTime: 0.5,
      cast({ world, caster, rank, point }) {
        const base = resolveDamage(caster, rank, { base: [150, 230, 310], ad: 0.9 });
        fireSkillshot(world, caster, {
          speed: 2200,
          width: 90,
          range: 3400,
          style: 'dusk-shot',
          towards: point,
          onHit: (w, p, target) => {
            if (target.isStatic) return;
            // Up to 80% more damage at maximum travel.
            const ramp = 1 + Math.min(1, p.travelled / 2600) * 0.8;
            w.dealDamage({
              amount: base * ramp,
              type: 'physical',
              sourceId: caster.id,
              targetId: target.id,
              isAuto: false,
              isCrit: ramp > 1.6,
              label: 'Disparo del ocaso',
            });
            applySlow(w, target.id, caster.id, 0.5, 1.5, 'thessa-r');
          },
        });
      },
    },
  },

  buildOrder: ['bootsbase', 'sword', 'stalker', 'boots-speed', 'infinity', 'reaper', 'bloodedge'],
  skillOrder: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
});
