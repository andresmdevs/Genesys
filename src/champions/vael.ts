import { secToTicks } from '../sim/constants.ts';
import {
  applyStatBuff,
  byRank,
  dashToward,
  resolveDamage,
} from './helpers.ts';
import { registerChampion } from './registry.ts';

/**
 * Vael - a reset assassin. She wants to mark a target, burst it down, and let
 * the kill refund her escape so she can repeat it on the next one.
 */
export default registerChampion({
  id: 'vael',
  name: 'Vael',
  title: 'La Hoja Silente',
  role: 'mid',
  ranged: false,
  difficulty: 3,
  colour: '#8f6bff',
  blurb:
    'Marca un objetivo, lo atraviesa y desaparece. Si la presa cae, su salto se reinicia.',

  base: {
    maxHp: 590,
    hpRegen: 7.5,
    maxMana: 340,
    manaRegen: 8,
    ad: 66,
    armor: 30,
    mr: 30,
    attackSpeed: 0.69,
    moveSpeed: 350,
    attackRange: 180,
  },
  growth: { maxHp: 92, ad: 3.4, armor: 4, mr: 1.3, attackSpeed: 0.032 },

  passive: {
    name: 'Filo marcado',
    description:
      'Cada tercer ataque básico contra el mismo objetivo inflige daño verdadero adicional.',
    onAutoAttackHit(world, unit, target) {
      const memory = unit.champion!.abilities.Q.memory;
      if (memory.lastTarget !== target.id) {
        memory.lastTarget = target.id;
        memory.hits = 0;
      }
      memory.hits = (memory.hits ?? 0) + 1;
      if (memory.hits < 3) return;
      memory.hits = 0;
      world.dealDamage({
        amount: 18 + unit.level * 6 + unit.stats.ad * 0.3,
        type: 'true',
        sourceId: unit.id,
        targetId: target.id,
        isAuto: false,
        isCrit: true,
        label: 'Filo marcado',
      });
    },
  },

  abilities: {
    Q: {
      key: 'Q',
      botUse: 'engage',
      name: 'Estocada',
      description: 'Atraviesa al objetivo causando daño físico y queda al otro lado.',
      targeting: 'enemy',
      cooldown: [11, 10, 9, 8, 7],
      cost: [45, 50, 55, 60, 65],
      range: 520,
      cast({ world, caster, rank, targetId }) {
        const target = world.getUnit(targetId);
        if (!target) return;
        const behind = {
          x: target.pos.x + (target.pos.x - caster.pos.x) * 0.35,
          y: target.pos.y + (target.pos.y - caster.pos.y) * 0.35,
        };
        dashToward(world, caster, behind, 700, 1900);
        const amount = resolveDamage(caster, rank, { base: [60, 95, 130, 165, 200], ad: 0.8 });
        world.dealDamage({
          amount,
          type: 'physical',
          sourceId: caster.id,
          targetId: target.id,
          isAuto: false,
          isCrit: false,
          label: 'Estocada',
        });
        detonateMark(world, caster, target.id);
        world.addFx({
          style: 'slash-line',
          pos: { ...caster.pos },
          to: { ...behind },
          life: 12,
          age: 0,
          colour: '#8f6bff',
        });
      },
    },

    W: {
      key: 'W',
      botUse: 'escape',
      name: 'Velo de sombras',
      description:
        'Se vuelve invisible durante 1,25 s y gana velocidad de movimiento.',
      targeting: 'self',
      cooldown: [20, 18, 16, 14, 12],
      cost: [50, 50, 50, 50, 50],
      range: 0,
      cast({ world, caster, rank }) {
        const duration = byRank([1.25, 1.4, 1.55, 1.7, 1.85], rank);
        world.applyEffect(caster.id, {
          kind: 'stealth',
          tag: 'vael-w',
          sourceId: caster.id,
          endsTick: world.tick + secToTicks(duration),
          value: 1,
        });
        applyStatBuff(world, caster.id, caster.id, { moveSpeed: 70 }, duration, 'vael-w-ms');
        world.addFx({ style: 'vanish', pos: { ...caster.pos }, radius: 120, life: 16, age: 0, colour: '#8f6bff' });
      },
    },

    E: {
      key: 'E',
      botUse: 'damage',
      name: 'Marca mortal',
      description:
        'Marca a un enemigo durante 5 s. La siguiente habilidad de Vael sobre él detona la marca causando daño adicional.',
      targeting: 'enemy',
      cooldown: [13, 12, 11, 10, 9],
      cost: [40, 40, 40, 40, 40],
      range: 700,
      cast({ world, caster, rank, targetId, memory }) {
        const target = world.getUnit(targetId);
        if (!target) return;
        memory.power = resolveDamage(caster, rank, { base: [50, 80, 110, 140, 170], ad: 0.5 });
        world.applyEffect(target.id, {
          kind: 'marker',
          tag: 'vael-mark',
          sourceId: caster.id,
          endsTick: world.tick + secToTicks(5),
          value: memory.power,
        });
        world.addFx({ style: 'mark', pos: { ...target.pos }, life: secToTicks(5), age: 0, colour: '#8f6bff' });
      },
    },

    R: {
      key: 'R',
      botUse: 'damage',
      name: 'Juicio',
      description:
        'Golpe devastador a un solo objetivo. Si lo elimina, Estocada y Velo de sombras se reinician.',
      targeting: 'enemy',
      cooldown: [80, 65, 50],
      cost: [100, 100, 100],
      range: 450,
      isUltimate: true,
      castTime: 0.25,
      cast({ world, caster, rank, targetId }) {
        const target = world.getUnit(targetId);
        if (!target) return;
        const amount = resolveDamage(caster, rank, { base: [200, 320, 440], ad: 1.4 });
        world.dealDamage({
          amount,
          type: 'physical',
          sourceId: caster.id,
          targetId: target.id,
          isAuto: false,
          isCrit: true,
          label: 'Juicio',
        });
        detonateMark(world, caster, target.id);
        world.addFx({
          style: 'judgement',
          pos: { ...target.pos },
          radius: 220,
          life: 20,
          age: 0,
          colour: '#8f6bff',
        });

        const victim = world.getUnit(target.id);
        if (victim && !victim.alive && caster.champion) {
          caster.champion.abilities.Q.cooldown = 0;
          caster.champion.abilities.W.cooldown = 0;
        }
      },
    },
  },

  buildOrder: ['bootsbase', 'sword', 'reaper', 'boots-lucid', 'infinity', 'breaker', 'hourglass'],
  skillOrder: ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W', 'R', 'W', 'W'],
});

/** Consumes Vael's mark on `targetId`, if she placed one. */
function detonateMark(
  world: import('../sim/types.ts').WorldLike,
  caster: import('../sim/types.ts').Unit,
  targetId: number,
): void {
  const target = world.getUnit(targetId);
  if (!target) return;
  const mark = target.effects.find((e) => e.tag === 'vael-mark' && e.sourceId === caster.id);
  if (!mark) return;
  world.removeEffectsByTag(target.id, 'vael-mark');
  world.dealDamage({
    amount: mark.value,
    type: 'magic',
    sourceId: caster.id,
    targetId: target.id,
    isAuto: false,
    isCrit: false,
    label: 'Marca mortal',
  });
  world.addFx({ style: 'mark-pop', pos: { ...target.pos }, radius: 160, life: 14, age: 0, colour: '#8f6bff' });
}
