import { secToTicks } from '../sim/constants.ts';
import {
  applyDot,
  applySlow,
  byRank,
  dashToward,
  createZone,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

const POISON_TAG = 'nyx-corrosion';
const MAX_STACKS = 5;

/**
 * Nyx - an attrition assassin. Instead of one burst window he layers poison
 * and then detonates all of it at once, which rewards patience over timing.
 */
export default registerChampion({
  id: 'nyx',
  name: 'Nyx',
  title: 'El Eco del Vacío',
  role: 'mid',
  ranged: false,
  difficulty: 2,
  colour: '#49e0b0',
  blurb:
    'Envenena primero y mata después. Acumula corrosión en toda la pelea y la detona de golpe.',

  base: {
    maxHp: 600,
    hpRegen: 7.5,
    maxMana: 360,
    manaRegen: 8.5,
    ad: 62,
    armor: 29,
    mr: 30,
    attackSpeed: 0.68,
    moveSpeed: 348,
    attackRange: 185,
  },
  growth: { maxHp: 94, ad: 3.2, armor: 3.9, mr: 1.3, maxMana: 45 },

  passive: {
    name: 'Corrosión',
    description:
      'Sus ataques y habilidades aplican acumulaciones de corrosión (máx. 5) que causan daño mágico con el tiempo.',
    onAutoAttackHit(world, unit, target) {
      applyCorrosion(world, unit, target.id, 1);
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      name: 'Dardo corrosivo',
      description:
        'Lanza un dardo que atraviesa enemigos, causa daño mágico y aplica dos acumulaciones de corrosión.',
      targeting: 'direction',
      cooldown: [8, 7.5, 7, 6.5, 6],
      cost: [45, 50, 55, 60, 65],
      range: 850,
      indicatorWidth: 70,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [55, 85, 115, 145, 175], ap: 0.5 });
        world.spawnProjectile({
          team: caster.team,
          ownerId: caster.id,
          pos: { ...caster.pos },
          dir: normalizeTo(caster.pos, point),
          speed: 1500,
          radius: 70,
          travelled: 0,
          maxDistance: 850,
          homingTargetId: -1,
          pierce: true,
          hitIds: [],
          style: 'dart-toxic',
          onHit: (w, _p, target) => {
            if (target.isStatic) return;
            w.dealDamage({
              amount,
              type: 'magic',
              sourceId: caster.id,
              targetId: target.id,
              isAuto: false,
              isCrit: false,
              label: 'Dardo corrosivo',
            });
            applyCorrosion(w, caster, target.id, 2);
          },
        });
      },
    },

    W: {
      key: 'W',
      name: 'Velo de niebla',
      description:
        'Crea una nube durante 4 s: los aliados en su interior quedan ocultos y los enemigos son ralentizados.',
      targeting: 'point',
      cooldown: [22, 21, 20, 19, 18],
      cost: [60, 65, 70, 75, 80],
      range: 700,
      indicatorRadius: 380,
      cast({ world, caster, rank, point }) {
        const slow = byRank([0.25, 0.3, 0.35, 0.4, 0.45], rank);
        createZone(world, caster, point, {
          radius: 380,
          seconds: 4,
          style: 'fog-cloud',
          period: 0.25,
          onPulse: (w, zone) => {
            for (const ally of w.alliesOf(caster.team, zone.pos, zone.radius)) {
              if (ally.kind !== 'champion') continue;
              w.applyEffect(ally.id, {
                kind: 'stealth',
                tag: 'nyx-fog',
                sourceId: caster.id,
                endsTick: w.tick + secToTicks(0.4),
                value: 1,
              });
            }
            for (const enemy of w.enemiesOf(caster.team, zone.pos, zone.radius)) {
              if (enemy.isStatic) continue;
              applySlow(w, enemy.id, caster.id, slow, 0.5, 'nyx-fog-slow');
            }
          },
        });
      },
    },

    E: {
      key: 'E',
      name: 'Parpadeo umbrío',
      description: 'Se desplaza una corta distancia y aplica corrosión a los enemigos cercanos al llegar.',
      targeting: 'point',
      cooldown: [15, 14, 13, 12, 11],
      cost: [50, 50, 50, 50, 50],
      range: 500,
      cast({ world, caster, point }) {
        dashToward(world, caster, point, 500, 1800);
        const casterId = caster.id;
        world.spawnZone({
          team: caster.team,
          ownerId: casterId,
          pos: { ...point },
          radius: 0,
          endsTick: world.tick + 18,
          period: 12,
          style: 'invisible',
          onTick: (w, zone) => {
            zone.endsTick = w.tick;
            const self = w.getUnit(casterId);
            if (!self) return;
            for (const enemy of w.enemiesOf(self.team, self.pos, 320)) {
              if (enemy.isStatic) continue;
              applyCorrosion(w, self, enemy.id, 1);
            }
            w.addFx({ style: 'void-step', pos: { ...self.pos }, radius: 320, life: 14, age: 0, colour: '#49e0b0' });
          },
        });
      },
    },

    R: {
      key: 'R',
      name: 'Colapso',
      description:
        'Detona la corrosión de todos los enemigos cercanos: daño mágico por cada acumulación consumida.',
      targeting: 'point',
      cooldown: [100, 85, 70],
      cost: [100, 100, 100],
      range: 600,
      isUltimate: true,
      indicatorRadius: 520,
      castTime: 0.35,
      cast({ world, caster, rank, point }) {
        const perStack = resolveDamage(caster, rank, { base: [45, 70, 95], ap: 0.22 });
        const flat = resolveDamage(caster, rank, { base: [70, 120, 170], ap: 0.3 });

        for (const enemy of world.enemiesOf(caster.team, point, 520)) {
          if (enemy.isStatic) continue;
          const poison = enemy.effects.find((e) => e.tag === POISON_TAG);
          const stacks = poison?.stacks ?? 0;
          world.removeEffectsByTag(enemy.id, POISON_TAG);
          world.dealDamage({
            amount: flat + perStack * stacks,
            type: 'magic',
            sourceId: caster.id,
            targetId: enemy.id,
            isAuto: false,
            isCrit: stacks >= MAX_STACKS,
            label: 'Colapso',
          });
          applySlow(world, enemy.id, caster.id, 0.4, 1.5, 'nyx-r-slow');
        }
        world.addFx({ style: 'collapse', pos: { ...point }, radius: 520, life: 22, age: 0, colour: '#49e0b0' });
      },
    },
  },

  buildOrder: ['bootsbase', 'rod', 'emberbrand', 'boots-lucid', 'abyssal', 'rimeveil', 'hourglass'],
  skillOrder: ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
});

function applyCorrosion(
  world: import('../sim/types.ts').WorldLike,
  caster: import('../sim/types.ts').Unit,
  targetId: number,
  stacks: number,
): void {
  const perStack = 7 + caster.level * 1.6 + caster.stats.ap * 0.05;
  for (let i = 0; i < stacks; i++) {
    applyDot(world, targetId, caster.id, perStack, 5, POISON_TAG, 'magic', MAX_STACKS);
  }
}

function normalizeTo(
  from: import('../core/math.ts').Vec2,
  to: import('../core/math.ts').Vec2,
): import('../core/math.ts').Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}
