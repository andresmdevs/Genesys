/**
 * Match orchestration: spawns the map, routes player commands into the world,
 * runs the tick phases in order, pays out gold and experience, respawns the
 * dead and decides when a nexus has fallen.
 *
 * Nothing here touches the DOM, so the identical class runs inside a browser
 * tab for a practice game and inside the authoritative server for an online
 * one.
 */

import { dist, distSq, normalize, type Vec2 } from '../core/math.ts';
import { getChampion } from '../champions/index.ts';
import { getItem, consumedComponents, effectiveCost } from '../data/items.ts';
import {
  BARON_PIT,
  BLUE,
  CAMP_SPOTS,
  DRAGON_PIT,
  FOUNTAIN_POS,
  INHIBITOR_SPOTS,
  LANES,
  LANE_NAMES,
  RED,
  SPAWN_POS,
  TOWER_SPOTS,
  enemyOf,
  inFountain,
  lanePathFor,
  type LaneId,
  type Team,
} from '../data/map.ts';
import { stepAutoAttacks, cancelAttack } from './attacks.ts';
import { canCastSpells, hasEffect } from './combat.ts';
import {
  ASSIST_SHARE,
  BARON_FIRST_SPAWN,
  BARON_RESPAWN,
  CAMP_FIRST_SPAWN,
  CAMP_RESPAWN,
  DRAGON_FIRST_SPAWN,
  DRAGON_RESPAWN,
  DT,
  FIRST_BLOOD_BONUS,
  FIRST_WAVE_AT,
  INHIBITOR_LOCAL_GOLD,
  INHIBITOR_RESPAWN,
  MAX_ITEMS,
  MAX_LEVEL,
  PASSIVE_GOLD_PER_SEC,
  RECALL_CHANNEL,
  SELL_REFUND,
  SIEGE_EVERY,
  STARTING_GOLD,
  TICK_RATE,
  TOWER_LOCAL_GOLD,
  TOWER_TEAM_GOLD,
  WAVE_INTERVAL,
  XP_SHARE_RADIUS,
  bountyFor,
  respawnSeconds,
  secToTicks,
  xpToNextLevel,
} from './constants.ts';
import {
  CAMP_DEFS,
  DRAGON_VARIANTS,
  spawnCamp,
  spawnChampion,
  spawnEpic,
  spawnInhibitor,
  spawnMinion,
  spawnNexus,
  spawnTower,
} from './entities.ts';
import { issueMove, settleIntoTerrain, stepMovement, stopMoving } from './movement.ts';
import { isWalkable, nearestWalkable } from './navgrid.ts';
import { stepMinions, stepMonsters, stepTowers } from './npc.ts';
import { cooldownMultiplier, recomputeStats } from './stats.ts';
import { acquireChampionTarget, structureIsShielded } from './targeting.ts';
import { runBotTick } from './bots/controller.ts';
// Registers the bot controller; imported for the side effect only.
import './bots/brain.ts';
import type { Command } from './commands.ts';
import type { AbilityKey, MinionKind, Unit } from './types.ts';
import { World } from './world.ts';

export interface SlotConfig {
  slot: number;
  championId: string;
  team: Team;
  lane: LaneId;
  isBot: boolean;
  displayName: string;
}

export interface MatchConfig {
  seed: number;
  slots: SlotConfig[];
}

const FLASH_RANGE = 440;
const FLASH_COOLDOWN = secToTicks(280);
const HEAL_COOLDOWN = secToTicks(210);
const ASSIST_WINDOW = secToTicks(10);

export class Match {
  readonly world: World;
  readonly config: MatchConfig;
  /** Unit id for each slot index, or -1 before setup. */
  readonly slotUnits: number[] = [];

  private waveNumber = 0;
  private nextWaveTick: number;
  private campRespawn = new Map<string, number>();
  private dragonTick: number;
  private baronTick: number;
  private dragonsKilled: [string[], string[]] = [[], []];
  private baronUntil: [number, number] = [0, 0];
  private pendingCommands: Command[] = [];

  constructor(config: MatchConfig) {
    this.config = config;
    this.world = new World(config.seed);
    this.nextWaveTick = secToTicks(FIRST_WAVE_AT);
    this.dragonTick = secToTicks(DRAGON_FIRST_SPAWN);
    this.baronTick = secToTicks(BARON_FIRST_SPAWN);
    this.world.onUnitKilled = (victim, killer) => this.onUnitKilled(victim, killer);
    this.setup();
  }

  /* ---------------------------------------------------------------- *
   * Setup
   * ---------------------------------------------------------------- */

  private setup(): void {
    for (const team of [BLUE, RED] as Team[]) spawnNexus(this.world, team);
    for (const spot of INHIBITOR_SPOTS) spawnInhibitor(this.world, spot);
    for (const spot of TOWER_SPOTS) spawnTower(this.world, spot);

    for (const cfg of this.config.slots) {
      const def = getChampion(cfg.championId);
      if (!def) throw new Error(`Unknown champion: ${cfg.championId}`);
      const unit = spawnChampion(this.world, def, cfg.team, cfg.slot, cfg.lane, cfg.isBot);
      unit.name = cfg.displayName;
      unit.champion!.gold = STARTING_GOLD;
      unit.champion!.totalGold = STARTING_GOLD;
      this.slotUnits[cfg.slot] = unit.id;
      // Everyone starts with one point available, spent on the first cast.
      unit.champion!.skillPoints = 1;
    }

    for (const spot of CAMP_SPOTS) this.campRespawn.set(spot.id, secToTicks(CAMP_FIRST_SPAWN));

    this.world.log({ kind: 'info', text: '¡La partida comienza!' });
  }

  championOf(slot: number): Unit | undefined {
    const id = this.slotUnits[slot];
    return id === undefined ? undefined : this.world.getUnit(id);
  }

  get champions(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.slotUnits) {
      const u = this.world.getUnit(id);
      if (u) out.push(u);
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Tick
   * ---------------------------------------------------------------- */

  step(commands: Command[] = []): void {
    if (this.world.winner !== null) return;
    this.pendingCommands = commands;

    this.world.stepSystems({
      ai: () => {
        this.applyCommands();
        runBotTick(this);
        stepMinions(this.world);
        stepTowers(this.world);
        stepMonsters(this.world);
        this.steerChampions();
      },
      movement: () => stepMovement(this.world),
      combat: () => {
        stepAutoAttacks(this.world);
        this.tickChampions();
      },
      late: () => {
        this.spawnWaves();
        this.spawnNeutrals();
        this.handleRespawns();
        this.passiveIncome();
        this.checkWin();
      },
    });
  }

  /* ---------------------------------------------------------------- *
   * Commands
   * ---------------------------------------------------------------- */

  private applyCommands(): void {
    for (const cmd of this.pendingCommands) {
      const unit = this.championOf(cmd.slot);
      if (!unit || !unit.alive) continue;
      const champ = unit.champion!;

      switch (cmd.t) {
        case 'move':
          this.cancelRecall(unit);
          cancelAttack(unit);
          unit.orderTargetId = -1;
          unit.attackTargetId = -1;
          champ.recallTicks = -1;
          issueMove(unit, { x: cmd.x, y: cmd.y });
          break;

        case 'attackMove': {
          this.cancelRecall(unit);
          cancelAttack(unit);
          unit.orderTargetId = -1;
          const found = acquireChampionTarget(this.world, unit, unit.stats.attackRange + 250);
          if (found >= 0) {
            unit.attackTargetId = found;
            unit.orderTargetId = found;
          } else {
            unit.attackTargetId = -1;
            issueMove(unit, { x: cmd.x, y: cmd.y });
          }
          break;
        }

        case 'attackUnit': {
          this.cancelRecall(unit);
          const target = this.world.living(cmd.target);
          if (target && target.team !== unit.team) {
            unit.attackTargetId = target.id;
            unit.orderTargetId = target.id;
          }
          break;
        }

        case 'stop':
          this.cancelRecall(unit);
          cancelAttack(unit);
          stopMoving(unit);
          unit.attackTargetId = -1;
          break;

        case 'cast':
          this.cancelRecall(unit);
          this.castAbility(unit, cmd.key, { x: cmd.x, y: cmd.y }, cmd.target);
          break;

        case 'levelUp':
          this.levelUpAbility(unit, cmd.key);
          break;

        case 'buy':
          this.buyItem(unit, cmd.item);
          break;

        case 'sell':
          this.sellItem(unit, cmd.index);
          break;

        case 'recall':
          if (champ.recallTicks >= 0) champ.recallTicks = -1;
          else if (!inFountain(unit.team as Team, unit.pos)) {
            champ.recallTicks = 0;
            stopMoving(unit);
            unit.attackTargetId = -1;
          }
          break;

        case 'flash':
          this.castFlash(unit, { x: cmd.x, y: cmd.y });
          break;

        case 'heal':
          this.castHeal(unit);
          break;

        case 'ping':
          this.world.addFx({
            style: 'ping',
            pos: { x: cmd.x, y: cmd.y },
            life: 60,
            age: 0,
            radius: cmd.kind,
            colour: unit.team === BLUE ? '#4fd4ff' : '#ff6b6b',
          });
          break;
      }
    }
    this.pendingCommands = [];
  }

  /** Keeps champions walking toward whatever they were ordered to attack. */
  private steerChampions(): void {
    for (const unit of this.champions) {
      if (!unit.alive || unit.castLock > 0) continue;
      const target = this.world.living(unit.attackTargetId);
      if (!target) {
        if (unit.orderTargetId >= 0 && !this.world.living(unit.orderTargetId)) {
          unit.orderTargetId = -1;
        }
        continue;
      }
      const reach = unit.stats.attackRange + target.radius;
      if (dist(unit.pos, target.pos) <= reach) {
        if (unit.path.length > 0) stopMoving(unit);
        unit.orderTargetId = target.id;
      } else if (unit.orderTargetId === target.id && unit.path.length === 0) {
        issueMove(unit, target.pos);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Abilities
   * ---------------------------------------------------------------- */

  canCast(unit: Unit, key: AbilityKey): boolean {
    const champ = unit.champion;
    if (!champ || !unit.alive) return false;
    const slot = champ.abilities[key];
    if (slot.rank === 0 || slot.cooldown > 0) return false;
    if (!canCastSpells(unit)) return false;
    const def = getChampion(champ.championId)?.abilities[key];
    if (!def) return false;
    return unit.mana >= (def.cost[slot.rank - 1] ?? 0);
  }

  abilityRange(unit: Unit, key: AbilityKey): number {
    const champ = unit.champion!;
    const def = getChampion(champ.championId)?.abilities[key];
    if (!def) return 0;
    const rank = Math.max(1, champ.abilities[key].rank);
    return Array.isArray(def.range) ? (def.range[rank - 1] ?? def.range[0]) : def.range;
  }

  castAbility(unit: Unit, key: AbilityKey, point: Vec2, targetId: number): boolean {
    if (!this.canCast(unit, key)) return false;
    const champ = unit.champion!;
    const slot = champ.abilities[key];
    const def = getChampion(champ.championId)!.abilities[key];
    const rank = slot.rank;

    let aim = { ...point };
    if (def.targeting === 'enemy' || def.targeting === 'ally') {
      const target = this.world.living(targetId);
      if (!target) return false;
      if (def.targeting === 'enemy' && target.team === unit.team) return false;
      if (def.targeting === 'ally' && target.team !== unit.team) return false;
      if (hasEffect(target, 'untargetable')) return false;
      aim = { ...target.pos };
    }

    const range = this.abilityRange(unit, key);
    if (def.targeting !== 'self' && range > 0) {
      const d = dist(unit.pos, aim);
      if (d > range) {
        if (def.targeting === 'enemy' || def.targeting === 'ally') return false;
        // Ground-targeted spells clamp to maximum range instead of failing.
        const dir = normalize({ x: aim.x - unit.pos.x, y: aim.y - unit.pos.y });
        aim = { x: unit.pos.x + dir.x * range, y: unit.pos.y + dir.y * range };
      }
    }

    unit.mana -= def.cost[rank - 1] ?? 0;
    const cd = (def.cooldown[rank - 1] ?? def.cooldown[0]) * cooldownMultiplier(unit.stats.haste);
    slot.cooldown = Math.max(1, Math.round(cd / DT));
    if (def.castTime) unit.castLock = Math.max(unit.castLock, Math.round(def.castTime / DT));
    unit.facing = Math.atan2(aim.y - unit.pos.y, aim.x - unit.pos.x);
    cancelAttack(unit);

    def.cast({
      world: this.world,
      caster: unit,
      rank,
      point: aim,
      targetId: def.targeting === 'enemy' || def.targeting === 'ally' ? targetId : -1,
      memory: slot.memory,
    });
    return true;
  }

  levelUpAbility(unit: Unit, key: AbilityKey): boolean {
    const champ = unit.champion!;
    if (champ.skillPoints <= 0) return false;
    const def = getChampion(champ.championId)?.abilities[key];
    if (!def) return false;
    const slot = champ.abilities[key];

    const maxRank = def.maxRank ?? (def.isUltimate ? 3 : 5);
    if (slot.rank >= maxRank) return false;
    // Ultimates unlock at levels 6, 11 and 16.
    if (def.isUltimate && unit.level < 6 + slot.rank * 5) return false;
    // A basic ability cannot be ranked more than one step above the others.
    if (!def.isUltimate && slot.rank + 1 > Math.ceil(unit.level / 2)) return false;

    slot.rank++;
    champ.skillPoints--;
    return true;
  }

  /** Public so the bot controller can use it without re-entering `step`. */
  castFlash(unit: Unit, point: Vec2): void {
    const champ = unit.champion!;
    if (champ.flashCooldown > 0 || !canCastSpells(unit)) return;
    const d = dist(unit.pos, point);
    const dir = normalize({ x: point.x - unit.pos.x, y: point.y - unit.pos.y });
    const reach = Math.min(d, FLASH_RANGE);

    // Walk the blink back from maximum range until it lands on open ground,
    // which is what makes flashing over a thin wall work.
    let landed: Vec2 | null = null;
    for (let r = reach; r > 60; r -= 40) {
      const candidate = { x: unit.pos.x + dir.x * r, y: unit.pos.y + dir.y * r };
      if (isWalkable(candidate)) {
        landed = candidate;
        break;
      }
    }
    if (!landed) return;

    champ.flashCooldown = FLASH_COOLDOWN;
    this.world.addFx({ style: 'flash', pos: { ...unit.pos }, to: { ...landed }, life: 14, age: 0 });
    unit.pos.x = landed.x;
    unit.pos.y = landed.y;
    stopMoving(unit);
    cancelAttack(unit);
    settleIntoTerrain(unit);
  }

  /** Public so the bot controller can use it without re-entering `step`. */
  castHeal(unit: Unit): void {
    const champ = unit.champion!;
    if (champ.healCooldown > 0) return;
    champ.healCooldown = HEAL_COOLDOWN;
    const amount = 90 + unit.level * 26;
    this.world.heal(unit.id, amount, unit.id);
    this.world.applyEffect(unit.id, {
      kind: 'haste',
      tag: 'summoner-heal',
      sourceId: unit.id,
      endsTick: this.world.tick + secToTicks(1.5),
      value: 0.3,
    });
    const ally = this.world
      .alliesOf(unit.team, unit.pos, 900)
      .find((u) => u.kind === 'champion' && u.id !== unit.id);
    if (ally) {
      this.world.heal(ally.id, amount, unit.id);
      this.world.applyEffect(ally.id, {
        kind: 'haste',
        tag: 'summoner-heal',
        sourceId: unit.id,
        endsTick: this.world.tick + secToTicks(1.5),
        value: 0.3,
      });
    }
    this.world.addFx({ style: 'heal-burst', pos: { ...unit.pos }, radius: 900, life: 24, age: 0 });
  }

  /* ---------------------------------------------------------------- *
   * Shop
   * ---------------------------------------------------------------- */

  canShop(unit: Unit): boolean {
    return unit.alive && inFountain(unit.team as Team, unit.pos);
  }

  buyItem(unit: Unit, itemId: string): boolean {
    const champ = unit.champion!;
    const item = getItem(itemId);
    if (!item || !this.canShop(unit)) return false;

    const consumed = consumedComponents(item, champ.items);
    const price = effectiveCost(item, champ.items);
    if (champ.gold < price) return false;
    if (champ.items.length - consumed.length >= MAX_ITEMS) return false;

    champ.gold -= price;
    for (const index of consumed) champ.items.splice(index, 1);
    champ.items.push(item.id);
    this.refreshItemStats(unit);
    return true;
  }

  sellItem(unit: Unit, index: number): boolean {
    const champ = unit.champion!;
    if (!this.canShop(unit)) return false;
    const itemId = champ.items[index];
    const item = itemId ? getItem(itemId) : undefined;
    if (!item) return false;
    champ.items.splice(index, 1);
    champ.gold += Math.floor(item.cost * SELL_REFUND);
    this.refreshItemStats(unit);
    return true;
  }

  private refreshItemStats(unit: Unit): void {
    const champ = unit.champion!;
    const totals: Record<string, number> = {};
    for (const id of champ.items) {
      const item = getItem(id);
      if (!item) continue;
      for (const [key, value] of Object.entries(item.stats)) {
        if (value === undefined) continue;
        // Damage multipliers compose, every other stat adds up.
        if (key === 'damageDealt' || key === 'damageTaken') {
          totals[key] = (totals[key] ?? 1) * value;
        } else {
          totals[key] = (totals[key] ?? 0) + value;
        }
      }
    }
    const beforeMax = unit.stats.maxHp;
    unit.itemStats = totals as Unit['itemStats'];
    recomputeStats(unit);
    // Buying health should grant that health immediately.
    if (unit.stats.maxHp > beforeMax) unit.hp += unit.stats.maxHp - beforeMax;
    unit.hp = Math.min(unit.hp, unit.stats.maxHp);
  }

  /* ---------------------------------------------------------------- *
   * Per-tick champion upkeep
   * ---------------------------------------------------------------- */

  private tickChampions(): void {
    for (const unit of this.champions) {
      const champ = unit.champion!;
      if (champ.flashCooldown > 0) champ.flashCooldown--;
      if (champ.healCooldown > 0) champ.healCooldown--;
      for (const key of ['Q', 'W', 'E', 'R'] as AbilityKey[]) {
        const slot = champ.abilities[key];
        if (slot.cooldown > 0) slot.cooldown--;
      }
      if (!unit.alive) continue;

      getChampion(champ.championId)?.passive.onTick?.(this.world, unit);
      this.tickRecall(unit);
    }
  }

  private tickRecall(unit: Unit): void {
    const champ = unit.champion!;
    if (champ.recallTicks < 0) return;

    // Taking damage in the last half second breaks the channel.
    const recent = unit.lastDamageFrom.some((d) => this.world.tick - d.tick < secToTicks(0.5));
    if (recent || unit.path.length > 0 || hasEffect(unit, 'stun') || hasEffect(unit, 'root')) {
      champ.recallTicks = -1;
      return;
    }

    champ.recallTicks++;
    if (champ.recallTicks >= secToTicks(RECALL_CHANNEL)) {
      champ.recallTicks = -1;
      const f = FOUNTAIN_POS[unit.team as Team];
      unit.pos.x = f.x;
      unit.pos.y = f.y;
      stopMoving(unit);
      this.world.addFx({ style: 'recall', pos: { ...f }, life: 20, age: 0 });
    }
  }

  private cancelRecall(unit: Unit): void {
    if (unit.champion) unit.champion.recallTicks = -1;
  }

  private passiveIncome(): void {
    if (this.world.tick % TICK_RATE !== 0) return;
    for (const unit of this.champions) {
      const champ = unit.champion!;
      champ.gold += PASSIVE_GOLD_PER_SEC;
      champ.totalGold += PASSIVE_GOLD_PER_SEC;
    }
  }

  /* ---------------------------------------------------------------- *
   * Waves and neutrals
   * ---------------------------------------------------------------- */

  private spawnWaves(): void {
    if (this.world.tick < this.nextWaveTick) return;
    this.nextWaveTick = this.world.tick + secToTicks(WAVE_INTERVAL);
    this.waveNumber++;

    const siege = this.waveNumber % SIEGE_EVERY === 0;
    for (const team of [BLUE, RED] as Team[]) {
      const superCount = this.superMinionsFor(team);
      for (const lane of LANES) {
        const composition: MinionKind[] = [
          'melee',
          'melee',
          'melee',
          'caster',
          'caster',
          'caster',
        ];
        if (siege) composition.push('siege');
        for (let i = 0; i < superCount; i++) composition.push('super');

        composition.forEach((kind, i) => {
          const base = SPAWN_POS[team];
          const path = lanePathFor(team, lane);
          const toward = normalize({ x: path[1].x - base.x, y: path[1].y - base.y });
          const pos = nearestWalkable({
            x: base.x + toward.x * (i * 70) + (i % 2 ? 60 : -60),
            y: base.y + toward.y * (i * 70) + (i % 2 ? -60 : 60),
          });
          const unit = spawnMinion(this.world, team, lane, kind, pos, this.waveNumber);
          // The baron buff makes a team's whole wave noticeably stronger.
          if (this.world.tick < this.baronUntil[team]) {
            unit.itemStats = { maxHp: unit.stats.maxHp * 0.4, ad: unit.stats.ad * 0.35 };
            recomputeStats(unit);
            unit.hp = unit.stats.maxHp;
          }
        });
      }
    }
  }

  /** One super minion per enemy inhibitor that is currently down. */
  private superMinionsFor(team: Team): number {
    let count = 0;
    for (const u of this.world.units.values()) {
      if (u.kind === 'inhibitor' && u.team === enemyOf(team) && !u.alive) count++;
    }
    return count;
  }

  private spawnNeutrals(): void {
    for (const spot of CAMP_SPOTS) {
      const at = this.campRespawn.get(spot.id);
      if (at === undefined || this.world.tick < at) continue;
      this.campRespawn.delete(spot.id);
      spawnCamp(this.world, spot);
    }

    if (this.dragonTick > 0 && this.world.tick >= this.dragonTick) {
      this.dragonTick = -1;
      const variant = DRAGON_VARIANTS[this.world.rng.int(0, DRAGON_VARIANTS.length - 1)];
      spawnEpic(this.world, 'dragon', DRAGON_PIT, variant);
      this.world.log({ kind: 'objective', text: 'Un dragón ha aparecido en el río.' });
    }

    if (this.baronTick > 0 && this.world.tick >= this.baronTick) {
      this.baronTick = -1;
      spawnEpic(this.world, 'baron', BARON_PIT, 'baron');
      this.world.log({ kind: 'objective', text: 'El Heraldo Abisal ha despertado.' });
    }
  }

  /* ---------------------------------------------------------------- *
   * Death, rewards and respawn
   * ---------------------------------------------------------------- */

  private onUnitKilled(victim: Unit, killer: Unit | undefined): void {
    switch (victim.kind) {
      case 'minion':
        this.rewardMinion(victim, killer);
        break;
      case 'monster':
        this.rewardMonster(victim, killer);
        break;
      case 'champion':
        this.rewardChampionKill(victim, killer);
        break;
      case 'tower':
        this.rewardStructure(victim, killer, TOWER_LOCAL_GOLD, TOWER_TEAM_GOLD);
        this.world.log({
          kind: 'tower',
          team: enemyOf(victim.team as Team),
          text: `Torre ${LANE_NAMES[victim.structure!.lane]} destruida.`,
        });
        break;
      case 'inhibitor':
        victim.structure!.respawnTick = this.world.tick + secToTicks(INHIBITOR_RESPAWN);
        this.rewardStructure(victim, killer, INHIBITOR_LOCAL_GOLD, 50);
        this.world.log({
          kind: 'inhibitor',
          team: enemyOf(victim.team as Team),
          text: `Inhibidor ${LANE_NAMES[victim.structure!.lane]} destruido.`,
        });
        break;
      case 'nexus':
        this.world.winner = enemyOf(victim.team as Team);
        break;
    }
  }

  private rewardMinion(victim: Unit, killer: Unit | undefined): void {
    const gold: Record<MinionKind, number> = { melee: 23, caster: 16, siege: 62, super: 60 };
    const xp: Record<MinionKind, number> = { melee: 68, caster: 42, siege: 112, super: 125 };
    const kind = victim.minion!.kind;

    if (killer?.champion) {
      killer.champion.gold += gold[kind];
      killer.champion.totalGold += gold[kind];
      killer.champion.creepScore++;
      this.world.addFx({
        style: 'gold-number',
        pos: { ...victim.pos },
        life: 30,
        age: 0,
        text: `+${gold[kind]}`,
        colour: '#ffd166',
      });
    }
    this.shareXp(victim, xp[kind], killer?.team as Team | undefined);
  }

  private rewardMonster(victim: Unit, killer: Unit | undefined): void {
    const m = victim.monster!;

    if (m.kind === 'camp') {
      const spot = CAMP_SPOTS.find((c) => c.id === m.campId);
      const def = spot ? CAMP_DEFS[spot.type] : undefined;
      const stillAlive = [...this.world.units.values()].some(
        (u) => u.alive && u.kind === 'monster' && u.monster!.campId === m.campId,
      );
      if (killer?.champion && def) {
        const share = Math.round(def.gold / Math.max(1, def.members.length));
        killer.champion.gold += share;
        killer.champion.totalGold += share;
        killer.champion.creepScore++;
      }
      this.shareXp(victim, def ? def.xp / Math.max(1, def.members.length) : 40, killer?.team as Team);

      if (!stillAlive) {
        this.campRespawn.set(m.campId, this.world.tick + secToTicks(CAMP_RESPAWN));
        if (def?.buff && killer?.champion) this.applyCampBuff(killer, def.buff);
      }
      return;
    }

    const team = killer?.team as Team | undefined;
    if (m.kind === 'dragon') {
      this.dragonTick = this.world.tick + secToTicks(DRAGON_RESPAWN);
      if (team !== undefined) {
        this.dragonsKilled[team].push(m.variant);
        this.applyDragonBuffs(team);
        this.world.log({
          kind: 'objective',
          team,
          text: `${victim.name} abatido (${this.dragonsKilled[team].length}).`,
        });
      }
      this.shareXp(victim, 220, team, 3000);
      this.grantTeamGold(team, 110);
      return;
    }

    this.baronTick = this.world.tick + secToTicks(BARON_RESPAWN);
    if (team !== undefined) {
      this.baronUntil[team] = this.world.tick + secToTicks(180);
      for (const u of this.champions) {
        if (u.team !== team || !u.alive) continue;
        this.world.applyEffect(u.id, {
          kind: 'stat',
          tag: 'baron',
          sourceId: victim.id,
          endsTick: this.baronUntil[team],
          value: 1,
          stats: { ad: 28, ap: 42, hpRegen: 10, manaRegen: 10 },
        });
      }
      this.world.log({ kind: 'objective', team, text: 'Heraldo Abisal abatido.' });
    }
    this.shareXp(victim, 320, team, 3200);
    this.grantTeamGold(team, 160);
  }

  private applyCampBuff(killer: Unit, buff: 'arcane' | 'fury'): void {
    const duration = secToTicks(105);
    if (buff === 'arcane') {
      this.world.applyEffect(killer.id, {
        kind: 'stat',
        tag: 'buff-arcane',
        sourceId: killer.id,
        endsTick: this.world.tick + duration,
        value: 1,
        stats: { manaRegen: 14, haste: 18, ap: 14 },
      });
    } else {
      this.world.applyEffect(killer.id, {
        kind: 'stat',
        tag: 'buff-fury',
        sourceId: killer.id,
        endsTick: this.world.tick + duration,
        value: 1,
        stats: { ad: 16, maxHp: 180, hpRegen: 12 },
      });
    }
  }

  /** Dragon stacks are permanent, so they are reapplied after every death. */
  private applyDragonBuffs(team: Team): void {
    const counts = new Map<string, number>();
    for (const v of this.dragonsKilled[team]) counts.set(v, (counts.get(v) ?? 0) + 1);

    const statsFor: Record<string, Record<string, number>> = {
      ember: { damageDealt: 1.04 },
      gale: { moveSpeed: 14, attackSpeed: 0.06 },
      tide: { hpRegen: 5, spellVamp: 0.04, lifesteal: 0.04 },
      stone: { armor: 9, mr: 9 },
    };

    for (const unit of this.champions) {
      if (unit.team !== team || !unit.alive) continue;
      for (const [variant, count] of counts) {
        this.world.removeEffectsByTag(unit.id, `dragon-${variant}`);
        const base = statsFor[variant] ?? {};
        const scaled: Record<string, number> = {};
        for (const [k, v] of Object.entries(base)) {
          scaled[k] = k === 'damageDealt' ? Math.pow(v, count) : v * count;
        }
        this.world.applyEffect(unit.id, {
          kind: 'stat',
          tag: `dragon-${variant}`,
          sourceId: unit.id,
          // Permanent for the rest of the game.
          endsTick: Number.MAX_SAFE_INTEGER,
          value: count,
          stats: scaled as Unit['itemStats'],
        });
      }
    }
  }

  private rewardChampionKill(victim: Unit, killer: Unit | undefined): void {
    const vc = victim.champion!;
    vc.deaths++;
    vc.killStreak = 0;
    vc.deathStreak++;
    victim.respawnTick =
      this.world.tick + secToTicks(respawnSeconds(victim.level, this.world.seconds));

    const assists = killer ? this.world.assistsFor(victim, killer.id, ASSIST_WINDOW) : [];
    const bounty = bountyFor(vc.killStreak, vc.deathStreak);

    if (killer?.champion) {
      const kc = killer.champion;
      kc.kills++;
      kc.killStreak++;
      kc.deathStreak = 0;
      let gold = bounty;
      if (!this.world.firstBloodTaken) {
        this.world.firstBloodTaken = true;
        gold += FIRST_BLOOD_BONUS;
        this.world.log({ kind: 'kill', team: killer.team, text: `¡Primera sangre para ${killer.name}!` });
      }
      kc.gold += gold;
      kc.totalGold += gold;
      this.world.teamKills[killer.team as Team]++;
      getChampion(kc.championId)?.passive.onKill?.(this.world, killer, victim);

      this.world.log({
        kind: 'kill',
        team: killer.team,
        text: `${killer.name} eliminó a ${victim.name}.`,
      });
    } else {
      this.world.log({ kind: 'kill', text: `${victim.name} ha caído.` });
    }

    const assistGold = Math.round((bounty * ASSIST_SHARE) / Math.max(1, assists.length));
    for (const id of assists) {
      const ally = this.world.getUnit(id);
      if (!ally?.champion) continue;
      ally.champion.assists++;
      ally.champion.gold += assistGold;
      ally.champion.totalGold += assistGold;
      getChampion(ally.champion.championId)?.passive.onKill?.(this.world, ally, victim);
    }

    this.shareXp(victim, 90 + victim.level * 38, killer?.team as Team | undefined);
  }

  private rewardStructure(
    victim: Unit,
    killer: Unit | undefined,
    localGold: number,
    teamGold: number,
  ): void {
    const team = (killer?.team ?? enemyOf(victim.team as Team)) as Team;
    if (killer?.champion) {
      killer.champion.gold += localGold;
      killer.champion.totalGold += localGold;
    }
    this.grantTeamGold(team, teamGold);
    this.shareXp(victim, 180, team, 2200);
  }

  private grantTeamGold(team: Team | undefined, amount: number): void {
    if (team === undefined) return;
    for (const unit of this.champions) {
      if (unit.team !== team) continue;
      unit.champion!.gold += amount;
      unit.champion!.totalGold += amount;
    }
  }

  /** Splits experience among the killing team's champions standing nearby. */
  private shareXp(
    victim: Unit,
    amount: number,
    team: Team | undefined,
    radius = XP_SHARE_RADIUS,
  ): void {
    if (team === undefined || amount <= 0) return;
    const nearby = this.champions.filter(
      (u) => u.alive && u.team === team && distSq(u.pos, victim.pos) <= radius * radius,
    );
    if (nearby.length === 0) return;
    // Sharing costs a little, but not proportionally, so duo lanes still work.
    const each = (amount / nearby.length) * (1 + (nearby.length - 1) * 0.22);
    for (const u of nearby) this.grantXp(u, each);
  }

  grantXp(unit: Unit, amount: number): void {
    if (unit.level >= MAX_LEVEL) return;
    unit.xp += amount;
    while (unit.level < MAX_LEVEL && unit.xp >= xpToNextLevel(unit.level)) {
      unit.xp -= xpToNextLevel(unit.level);
      unit.level++;
      unit.champion!.skillPoints++;
      const beforeMax = unit.stats.maxHp;
      recomputeStats(unit);
      unit.hp += unit.stats.maxHp - beforeMax;
      this.world.addFx({ style: 'level-up', pos: { ...unit.pos }, life: 26, age: 0 });
    }
    if (unit.level >= MAX_LEVEL) unit.xp = 0;
  }

  private handleRespawns(): void {
    for (const unit of this.world.units.values()) {
      if (unit.alive) continue;

      if (unit.kind === 'champion') {
        if (this.world.tick < unit.respawnTick) continue;
        const f = FOUNTAIN_POS[unit.team as Team];
        unit.alive = true;
        unit.pos = { ...f };
        unit.lastDamageFrom.length = 0;
        recomputeStats(unit);
        unit.hp = unit.stats.maxHp;
        unit.mana = unit.stats.maxMana;
        unit.respawnTick = -1;
        stopMoving(unit);
        this.applyDragonBuffs(unit.team as Team);
        continue;
      }

      if (unit.kind === 'inhibitor') {
        const s = unit.structure!;
        if (s.respawnTick === 0 || this.world.tick < s.respawnTick) continue;
        unit.alive = true;
        recomputeStats(unit);
        unit.hp = unit.stats.maxHp;
        s.respawnTick = 0;
        this.world.log({
          kind: 'inhibitor',
          team: unit.team,
          text: `El inhibidor ${LANE_NAMES[s.lane]} se ha restaurado.`,
        });
        continue;
      }

      // Minions, monsters and fallen turrets leave the world for good.
      if (unit.kind === 'minion' || unit.kind === 'monster' || unit.kind === 'ward') {
        if (this.world.tick - unit.deathTick > secToTicks(1.5)) this.world.units.delete(unit.id);
      }
    }
  }

  private checkWin(): void {
    if (this.world.winner !== null) return;
    for (const u of this.world.units.values()) {
      if (u.kind === 'nexus' && !u.alive) {
        this.world.winner = enemyOf(u.team as Team);
        this.world.log({
          kind: 'objective',
          team: this.world.winner,
          text: this.world.winner === BLUE ? '¡Victoria del equipo azul!' : '¡Victoria del equipo rojo!',
        });
        return;
      }
    }
  }

  /** Exposed for the HUD: whether a structure can currently be attacked. */
  isStructureShielded(unit: Unit): boolean {
    return structureIsShielded(this.world, unit);
  }
}
