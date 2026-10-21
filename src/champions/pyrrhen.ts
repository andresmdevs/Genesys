import { secToTicks } from '../sim/constants.ts';
import {
  applyDot,
  createZone,
  damageCircle,
  dashToward,
  fireSkillshot,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

const BURN_TAG = 'pyrrhen-burn';

/**
 * Pyrrhen - a burst mage whose damage arrives in two parts: the hit, then the
 * burn. Chaining abilities on the same target is what makes her lethal.
 */
export default registerChampion({
  id: 'pyrrhen',
  name: 'Pyrrhen',
  title: 'La Llama Devoradora',
  role: 'mage',
  ranged: true,
  difficulty: 2,
  colour: '#ff8a3d',
  blurb:
    'Todo lo que toca arde. Encadena habilidades sobre el mismo objetivo y el fuego hace el resto.',

  base: {
    maxHp: 555,
    hpRegen: 6.5,
    maxMana: 470,
    manaRegen: 10.5,
    ad: 55,
    armor: 23,
    mr: 30,
    attackSpeed: 0.63,
    moveSpeed: 335,
    attackRange: 560,
  },
  growth: { maxHp: 85, ad: 2.9, armor: 3.5, mr: 1.3, maxMana: 58, manaRegen: 0.85 },

  passive: {
    name: 'Combustión',
    description:
      'Sus habilidades prenden al objetivo, causando daño mágico durante 3 s. Se acumula hasta 3 veces.',
  },

  abilities: {
    Q: {
      key: 'Q',
      name: 'Bola de fuego',
      description: 'Lanza una bola que estalla al impactar causando daño en área.',
      targeting: 'direction',
      cooldown: [7, 6.5, 6, 5.5, 5],
      cost: [55, 60, 65, 70, 75],
      range: 900,
      indicatorWidth: 70,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [70, 110, 150, 190, 230], ap: 0.65 });
        const explode = (w: import('../sim/types.ts').WorldLike, at: { x: number; y: number }) => {
          damageCircle(w, caster, at, 240, amount, {
            type: 'magic',
            label: 'Bola de fuego',
            onHit: (target) => ignite(w, caster, target.id),
          });
          w.addFx({ style: 'fire-burst', pos: { ...at }, radius: 240, life: 16, age: 0, colour: '#ff8a3d' });
        };
        fireSkillshot(world, caster, {
          speed: 1450,
          width: 70,
          range: 900,
          style: 'fireball',
          towards: point,
          onHit: (w, p) => explode(w, p.pos),
          onExpire: (w, p) => explode(w, p.pos),
        });
      },
    },

    W: {
      key: 'W',
      name: 'Muro de llamas',
      description:
        'Levanta una línea de fuego durante 4 s que quema a los enemigos que la cruzan.',
      targeting: 'point',
      cooldown: [16, 15, 14, 13, 12],
      cost: [70, 75, 80, 85, 90],
      range: 800,
      indicatorWidth: 500,
      cast({ world, caster, rank, point }) {
        const perPulse = resolveDamage(caster, rank, { base: [22, 35, 48, 61, 74], ap: 0.14 });
        // Three overlapping discs laid across the aim direction form the wall.
        const angle = Math.atan2(point.y - caster.pos.y, point.x - caster.pos.x) + Math.PI / 2;
        for (let i = -1; i <= 1; i++) {
          const centre = {
            x: point.x + Math.cos(angle) * i * 200,
            y: point.y + Math.sin(angle) * i * 200,
          };
          createZone(world, caster, centre, {
            radius: 170,
            seconds: 4,
            style: 'flame-wall',
            period: 0.5,
            onPulse: (w, zone) => {
              damageCircle(w, caster, zone.pos, zone.radius, perPulse, {
                type: 'magic',
                label: 'Muro de llamas',
                onHit: (target) => ignite(w, caster, target.id),
              });
            },
          });
        }
      },
    },

    E: {
      key: 'E',
      name: 'Fulgor',
      description: 'Se desplaza rápidamente y quema a los enemigos cercanos al llegar.',
      targeting: 'point',
      cooldown: [18, 17, 16, 15, 14],
      cost: [60, 60, 60, 60, 60],
      range: 450,
      cast({ world, caster, rank, point }) {
        dashToward(world, caster, point, 450, 2000);
        const amount = resolveDamage(caster, rank, { base: [50, 80, 110, 140, 170], ap: 0.4 });
        const casterId = caster.id;
        world.spawnZone({
          team: caster.team,
          ownerId: casterId,
          pos: { ...point },
          radius: 0,
          endsTick: world.tick + 16,
          period: 10,
          style: 'invisible',
          onTick: (w, zone) => {
            zone.endsTick = w.tick;
            const self = w.getUnit(casterId);
            if (!self) return;
            damageCircle(w, self, self.pos, 300, amount, {
              type: 'magic',
              label: 'Fulgor',
              onHit: (target) => ignite(w, self, target.id),
            });
            w.addFx({ style: 'fire-burst', pos: { ...self.pos }, radius: 300, life: 14, age: 0, colour: '#ff8a3d' });
          },
        });
      },
    },

    R: {
      key: 'R',
      name: 'Meteoro',
      description:
        'Invoca un meteoro que cae tras 1,2 s causando un daño enorme en un área amplia.',
      targeting: 'point',
      cooldown: [110, 95, 80],
      cost: [100, 120, 140],
      range: 1500,
      isUltimate: true,
      indicatorRadius: 480,
      castTime: 0.4,
      cast({ world, caster, rank, point }) {
        const amount = resolveDamage(caster, rank, { base: [260, 400, 540], ap: 1.0 });
        world.addFx({
          style: 'meteor-telegraph',
          pos: { ...point },
          radius: 480,
          life: secToTicks(1.2),
          age: 0,
          colour: '#ff8a3d',
        });
        createZone(world, caster, point, {
          radius: 480,
          seconds: 1.25,
          style: 'invisible',
          period: 1.2,
          onPulse: (w, zone) => {
            zone.endsTick = w.tick;
            damageCircle(w, caster, zone.pos, zone.radius, amount, {
              type: 'magic',
              label: 'Meteoro',
              onHit: (target) => {
                ignite(w, caster, target.id);
                ignite(w, caster, target.id);
              },
            });
            w.addFx({ style: 'meteor-impact', pos: { ...zone.pos }, radius: 480, life: 30, age: 0, colour: '#ff8a3d' });
          },
        });
      },
    },
  },

  buildOrder: ['bootsbase', 'rod', 'emberbrand', 'boots-lucid', 'abyssal', 'rimeveil', 'hourglass'],
  skillOrder: ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
});

function ignite(
  world: import('../sim/types.ts').WorldLike,
  caster: import('../sim/types.ts').Unit,
  targetId: number,
): void {
  const target = world.getUnit(targetId);
  if (!target || target.isStatic) return;
  applyDot(world, targetId, caster.id, 8 + caster.level * 1.4 + caster.stats.ap * 0.045, 3, BURN_TAG, 'magic', 3);
}
