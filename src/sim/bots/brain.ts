/**
 * Bot champions.
 *
 * Each bot re-evaluates a small state machine five times a second. The goal is
 * not a perfect player but a believable one: it farms, it respects turrets, it
 * backs off when it is losing, it groups for objectives, and it presses its
 * buttons at moments that read as intentional.
 *
 * Everything here reads the simulation and issues the same orders a human
 * would, so a bot can take over a disconnected player's champion without the
 * rest of the system noticing.
 */

import { dist, distSq, normalize, type Vec2 } from '../../core/math.ts';
import { getChampion } from '../../champions/index.ts';
import { getItem, effectiveCost } from '../../data/items.ts';
import {
  FOUNTAIN_POS,
  LANES,
  NEXUS_POS,
  enemyOf,
  inFountain,
  lanePathFor,
  type LaneId,
  type Team,
} from '../../data/map.ts';
import { mitigate } from '../combat.ts';
import { MAX_ITEMS, secToTicks } from '../constants.ts';
import { issueMove, stopMoving } from '../movement.ts';
import { structureIsShielded } from '../targeting.ts';
import type { AbilityKey, Unit } from '../types.ts';
import type { Match } from '../match.ts';
import { setBotController } from './controller.ts';

type BotState = 'lane' | 'fight' | 'flee' | 'recall' | 'shop' | 'push' | 'objective';

interface BotMemory {
  state: BotState;
  thinkAt: number;
  buildIndex: number;
  /** Tick until which the bot sticks with its current state. */
  commitUntil: number;
  lastCast: number;
}

const memories = new WeakMap<Match, Map<number, BotMemory>>();

const THINK_INTERVAL = 6;
const DANGER_RADIUS = 1500;
const TOWER_RANGE = 1250;
const ENGAGE_RANGE = 1100;

function memoryFor(match: Match, unit: Unit): BotMemory {
  let table = memories.get(match);
  if (!table) {
    table = new Map();
    memories.set(match, table);
  }
  let memory = table.get(unit.id);
  if (!memory) {
    memory = { state: 'lane', thinkAt: 0, buildIndex: 0, commitUntil: 0, lastCast: -999 };
    table.set(unit.id, memory);
  }
  return memory;
}

export function runBots(match: Match): void {
  const world = match.world;
  for (const unit of match.champions) {
    const champ = unit.champion;
    if (!champ?.isBot || !unit.alive) continue;

    const memory = memoryFor(match, unit);
    spendSkillPoints(match, unit);

    // Stagger thinking across bots so the cost is spread over the tick budget.
    if (world.tick < memory.thinkAt) continue;
    memory.thinkAt = world.tick + THINK_INTERVAL;

    if (match.canShop(unit)) shop(match, unit, memory);

    const situation = assess(match, unit);
    if (world.tick >= memory.commitUntil) {
      memory.state = decide(match, unit, memory, situation);
      // A siege has to be seen through; re-deciding twice a second means the
      // turret never dies. Everything else stays reactive.
      const sticky = memory.state === 'push' || memory.state === 'objective';
      memory.commitUntil = world.tick + secToTicks(sticky ? 2.5 : 0.6);
    }

    act(match, unit, memory, situation);
  }
}

/* ------------------------------------------------------------------ *
 * Situational awareness
 * ------------------------------------------------------------------ */

interface Situation {
  enemies: Unit[];
  allies: Unit[];
  hpFraction: number;
  /** Positive when the bot's side is stronger nearby. */
  advantage: number;
  underEnemyTower: boolean;
  nearestEnemy: Unit | undefined;
  alliedMinionsNear: number;
}

function assess(match: Match, unit: Unit): Situation {
  const world = match.world;
  const team = unit.team as Team;

  const enemies = world
    .enemiesOf(team, unit.pos, DANGER_RADIUS)
    .filter((u) => u.kind === 'champion' && world.isVisibleTo(team, u.id));
  const allies = world
    .alliesOf(team, unit.pos, DANGER_RADIUS)
    .filter((u) => u.kind === 'champion');

  const power = (u: Unit): number =>
    (u.hp / Math.max(1, u.stats.maxHp)) * (u.level + 4) * (1 + u.stats.ad / 200);

  const mine = allies.reduce((sum, u) => sum + power(u), 0);
  const theirs = enemies.reduce((sum, u) => sum + power(u), 0);

  let underEnemyTower = false;
  for (const u of world.units.values()) {
    if (u.kind !== 'tower' || !u.alive || u.team === team) continue;
    if (distSq(u.pos, unit.pos) < TOWER_RANGE * TOWER_RANGE) {
      underEnemyTower = true;
      break;
    }
  }

  let nearestEnemy: Unit | undefined;
  let bestD = Infinity;
  for (const e of enemies) {
    const d = distSq(e.pos, unit.pos);
    if (d < bestD) {
      bestD = d;
      nearestEnemy = e;
    }
  }

  const alliedMinionsNear = world
    .alliesOf(team, unit.pos, 900)
    .filter((u) => u.kind === 'minion').length;

  return {
    enemies,
    allies,
    hpFraction: unit.hp / Math.max(1, unit.stats.maxHp),
    advantage: mine - theirs,
    underEnemyTower,
    nearestEnemy,
    alliedMinionsNear,
  };
}

/* ------------------------------------------------------------------ *
 * Decision
 * ------------------------------------------------------------------ */

function decide(match: Match, unit: Unit, memory: BotMemory, s: Situation): BotState {
  const champ = unit.champion!;

  if (inFountain(unit.team as Team, unit.pos)) {
    const wantsToStay = unit.hp < unit.stats.maxHp * 0.92 || unit.mana < unit.stats.maxMana * 0.6;
    if (wantsToStay) return 'shop';
  }

  // Badly hurt with company: get out first, think later.
  if (s.hpFraction < 0.32 && s.enemies.length > 0) return 'flee';
  if (s.hpFraction < 0.28 && s.enemies.length === 0) return 'recall';
  if (champ.recallTicks >= 0) return 'recall';

  const minutes = match.world.seconds / 60;

  if (s.enemies.length > 0) {
    if (shouldCommit(s)) return 'fight';
    if (s.hpFraction < 0.4 || s.advantage < -3) return 'flee';
    // Not worth a fight: carry on farming and trade on the way past.
  }

  // Mid game onwards bots group on structures, but they keep farming while
  // they wait. Fighting on sight at this point stalls the economy completely.
  if (minutes > 9 && memory.state !== 'recall') return 'objective';

  const target = nextStructureInLane(match, unit.team as Team, champ.lane);
  if (target && s.alliedMinionsNear >= 2 && dist(unit.pos, target.pos) < 1400) return 'push';

  return 'lane';
}

/**
 * Whether the bot should drop what it is doing and commit to a fight.
 * Committing on sight turns the whole game into a brawl and nobody farms, so
 * a bot needs an actual reason: it is ahead, it has numbers, or the target is
 * nearly dead.
 */
function shouldCommit(s: Situation): boolean {
  if (s.enemies.length === 0 || s.hpFraction <= 0.45) return false;
  if (s.underEnemyTower && s.alliedMinionsNear < 3) return false;
  const weakest = s.nearestEnemy ? s.nearestEnemy.hp / Math.max(1, s.nearestEnemy.stats.maxHp) : 1;
  return s.advantage > 2.5 || s.allies.length > s.enemies.length || weakest < 0.38;
}

/* ------------------------------------------------------------------ *
 * Behaviour
 * ------------------------------------------------------------------ */

function act(match: Match, unit: Unit, memory: BotMemory, s: Situation): void {
  switch (memory.state) {
    case 'shop':
      doShop(match, unit);
      break;
    case 'recall':
      doRecall(unit, s);
      break;
    case 'flee':
      doFlee(match, unit, memory, s);
      break;
    case 'fight':
      doFight(match, unit, memory, s);
      break;
    case 'push':
    case 'objective':
      doPush(match, unit, memory, s);
      break;
    default:
      doLane(match, unit, memory, s);
  }
}

function doShop(match: Match, unit: Unit): void {
  // Healed up and done buying: head back out to lane.
  if (unit.hp > unit.stats.maxHp * 0.9 && unit.mana > unit.stats.maxMana * 0.6) {
    issueMove(unit, laneAnchor(match, unit.team as Team, unit.champion!.lane));
  } else {
    stopMoving(unit);
  }
}

function doRecall(unit: Unit, s: Situation): void {
  const team = unit.team as Team;
  if (inFountain(team, unit.pos)) {
    unit.champion!.recallTicks = -1;
    return;
  }
  if (s.enemies.length === 0 && unit.champion!.recallTicks < 0) {
    stopMoving(unit);
    unit.attackTargetId = -1;
    unit.champion!.recallTicks = 0;
    return;
  }
  if (s.enemies.length > 0) {
    unit.champion!.recallTicks = -1;
    issueMove(unit, FOUNTAIN_POS[team]);
  }
}

function doFlee(match: Match, unit: Unit, memory: BotMemory, s: Situation): void {
  unit.attackTargetId = -1;

  castByUse(match, unit, memory, 'escape', s);
  // Summoner spells are the last resort, in the order a player would use them.
  if (s.hpFraction < 0.18) useSummonerEscape(match, unit, s);

  const safe = retreatPoint(match, unit, s);
  issueMove(unit, safe);
}

function doFight(match: Match, unit: Unit, memory: BotMemory, s: Situation): void {
  const target = pickFightTarget(unit, s);
  if (!target) {
    doLane(match, unit, memory, s);
    return;
  }

  const def = getChampion(unit.champion!.championId);
  const d = dist(unit.pos, target.pos);

  castByUse(match, unit, memory, 'buff', s, target);
  if (d <= ENGAGE_RANGE) {
    castByUse(match, unit, memory, 'damage', s, target);
    castByUse(match, unit, memory, 'zone', s, target);
  }
  if (d > unit.stats.attackRange && d < ENGAGE_RANGE) {
    castByUse(match, unit, memory, 'engage', s, target);
  }
  castByUse(match, unit, memory, 'support', s, target);

  unit.attackTargetId = target.id;
  unit.orderTargetId = target.id;

  // Ranged champions back off when something melee closes the gap.
  const reach = unit.stats.attackRange + target.radius;
  if (def?.ranged && d < reach * 0.55 && target.stats.attackRange < 300) {
    const away = normalize({ x: unit.pos.x - target.pos.x, y: unit.pos.y - target.pos.y });
    issueMove(unit, { x: unit.pos.x + away.x * 420, y: unit.pos.y + away.y * 420 });
  } else if (d > reach) {
    issueMove(unit, target.pos);
  }
}

function doLane(match: Match, unit: Unit, memory: BotMemory, s: Situation): void {
  const world = match.world;
  const team = unit.team as Team;
  const lane = unit.champion!.lane;

  // Standing in enemy turret range without a wave is how bots feed.
  if (s.underEnemyTower && s.alliedMinionsNear < 3) {
    issueMove(unit, laneAnchor(match, team, lane));
    unit.attackTargetId = -1;
    return;
  }

  const minions = world
    .enemiesOf(team, unit.pos, unit.stats.attackRange + 260)
    .filter((u) => u.kind === 'minion' || u.kind === 'monster');

  // Last hitting: prefer a minion this swing would finish, and otherwise keep
  // the weakest one selected so the next swing trends toward a kill. Picking
  // the lowest rather than the first is what actually earns the gold.
  let killable: Unit | undefined;
  let weakest: Unit | undefined;
  for (const m of minions) {
    const dmg = mitigate(unit.stats.ad, 'physical', unit, m);
    if (m.hp <= dmg * 1.2 && (!killable || m.hp < killable.hp)) killable = m;
    if (!weakest || m.hp < weakest.hp) weakest = m;
  }

  if (killable) {
    unit.attackTargetId = killable.id;
    unit.orderTargetId = killable.id;
    return;
  }

  // Free poke on an enemy champion standing in range.
  const pokeTarget = s.enemies.find(
    (e) => dist(unit.pos, e.pos) <= unit.stats.attackRange + e.radius && !s.underEnemyTower,
  );
  if (pokeTarget) {
    unit.attackTargetId = pokeTarget.id;
    if (unit.champion!.role !== 'support') {
      castByUse(match, unit, memory, 'damage', s, pokeTarget);
    }
    return;
  }

  // Otherwise hold the lane with the weakest minion selected, so the bot keeps
  // chipping the wave down instead of standing idle.
  unit.attackTargetId = weakest?.id ?? -1;
  const anchor = laneAnchor(match, team, lane);
  if (distSq(unit.pos, anchor) > 420 * 420) issueMove(unit, anchor);
}

function doPush(match: Match, unit: Unit, memory: BotMemory, s: Situation): void {
  const team = unit.team as Team;
  const champ = unit.champion!;
  const minutes = match.world.seconds / 60;

  // Mid game onwards everyone converges on one lane so pushes are not solo.
  const lane: LaneId = minutes > 9 ? teamPushLane(match, team) : champ.lane;
  const structure = nextStructureInLane(match, team, lane);

  if (!structure) {
    issueMove(unit, NEXUS_POS[enemyOf(team)]);
    return;
  }

  const d = dist(unit.pos, structure.pos);
  const sieging = d <= structure.radius + unit.stats.attackRange + 150;
  // Chasing a kill off a half-dead turret is how a team loses its push. Once
  // the siege is under way only a threat in your face is worth answering.
  const breakOffRange = sieging ? 800 : DANGER_RADIUS;
  const threat = s.nearestEnemy && dist(unit.pos, s.nearestEnemy.pos) <= breakOffRange;
  if (threat && shouldCommit(s)) {
    doFight(match, unit, memory, s);
    return;
  }

  // Walking into a turret alone gets the bot shot for nothing, so it farms
  // while it waits. Three allies standing with it is enough to dive anyway,
  // and without that exception a team never closes out a game.
  const grouped = s.allies.length >= 3;
  if (structure.kind === 'tower' && s.alliedMinionsNear < 2 && !grouped && d < TOWER_RANGE * 1.3) {
    doLane(match, unit, memory, s);
    return;
  }

  // Clear whatever is defending, weakest first, so the gold still comes in.
  let weakest: Unit | undefined;
  for (const m of match.world.enemiesOf(team, unit.pos, unit.stats.attackRange + 200)) {
    if (m.kind !== 'minion') continue;
    if (!weakest || m.hp < weakest.hp) weakest = m;
  }
  if (weakest) {
    unit.attackTargetId = weakest.id;
    return;
  }

  unit.attackTargetId = structure.id;
  unit.orderTargetId = structure.id;
  if (d > unit.stats.attackRange + structure.radius) issueMove(unit, structure.pos);
}

/* ------------------------------------------------------------------ *
 * Ability and item use
 * ------------------------------------------------------------------ */

function castByUse(
  match: Match,
  unit: Unit,
  memory: BotMemory,
  use: string,
  s: Situation,
  target?: Unit,
): void {
  // One cast per think keeps bots from dumping a whole kit in a single frame.
  if (match.world.tick - memory.lastCast < THINK_INTERVAL * 2) return;

  const def = getChampion(unit.champion!.championId);
  if (!def) return;

  for (const key of ['R', 'Q', 'W', 'E'] as AbilityKey[]) {
    const ability = def.abilities[key];
    const resolved = ability.botUse ?? (ability.targeting === 'self' ? 'buff' : 'damage');
    if (resolved !== use) continue;
    if (!match.canCast(unit, key)) continue;

    const range = match.abilityRange(unit, key);
    const aim = aimFor(match, unit, use, ability.targeting, range, s, target);
    if (!aim) continue;

    // An ultimate on a single healthy minion is a waste.
    if (ability.isUltimate && use !== 'support' && (!target || target.kind !== 'champion')) continue;

    if (match.castAbility(unit, key, aim.point, aim.targetId)) {
      memory.lastCast = match.world.tick;
      return;
    }
  }
}

function aimFor(
  match: Match,
  unit: Unit,
  use: string,
  targeting: string,
  range: number,
  s: Situation,
  target: Unit | undefined,
): { point: Vec2; targetId: number } | null {
  if (targeting === 'self') return { point: { ...unit.pos }, targetId: -1 };

  if (targeting === 'ally' || use === 'support') {
    const hurt = match.world
      .alliesOf(unit.team, unit.pos, range)
      .filter((u) => u.kind === 'champion' && u.hp < u.stats.maxHp * 0.72)
      .sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp)[0];
    const chosen = hurt ?? (unit.hp < unit.stats.maxHp * 0.6 ? unit : undefined);
    if (!chosen) return null;
    return { point: { ...chosen.pos }, targetId: chosen.id };
  }

  if (use === 'escape') {
    const threat = s.nearestEnemy;
    const away = threat
      ? normalize({ x: unit.pos.x - threat.pos.x, y: unit.pos.y - threat.pos.y })
      : normalize({
          x: FOUNTAIN_POS[unit.team as Team].x - unit.pos.x,
          y: FOUNTAIN_POS[unit.team as Team].y - unit.pos.y,
        });
    // Thessa's hop reads its aim as "jump away from here", so point at the threat.
    const point =
      threat && targeting === 'point'
        ? { ...threat.pos }
        : { x: unit.pos.x + away.x * range, y: unit.pos.y + away.y * range };
    return { point, targetId: -1 };
  }

  if (!target) return null;
  if (dist(unit.pos, target.pos) > range + target.radius) return null;

  // Lead a skillshot by roughly how long it takes to arrive.
  if (targeting === 'direction') {
    const lead = leadTarget(unit, target);
    return { point: lead, targetId: -1 };
  }
  return { point: { ...target.pos }, targetId: target.id };
}

/** Rough interception point, assuming the target keeps walking as it is. */
function leadTarget(unit: Unit, target: Unit): Vec2 {
  const next = target.path[0];
  if (!next) return { ...target.pos };
  const heading = normalize({ x: next.x - target.pos.x, y: next.y - target.pos.y });
  const travelTime = dist(unit.pos, target.pos) / 1600;
  const lead = Math.min(260, target.stats.moveSpeed * travelTime);
  return { x: target.pos.x + heading.x * lead, y: target.pos.y + heading.y * lead };
}

function useSummonerEscape(match: Match, unit: Unit, s: Situation): void {
  const champ = unit.champion!;
  if (champ.healCooldown <= 0) {
    match.castHeal(unit);
    return;
  }
  if (champ.flashCooldown <= 0 && s.nearestEnemy) {
    const away = normalize({
      x: unit.pos.x - s.nearestEnemy.pos.x,
      y: unit.pos.y - s.nearestEnemy.pos.y,
    });
    match.castFlash(unit, { x: unit.pos.x + away.x * 440, y: unit.pos.y + away.y * 440 });
  }
}

function spendSkillPoints(match: Match, unit: Unit): void {
  const champ = unit.champion!;
  if (champ.skillPoints <= 0) return;
  const def = getChampion(champ.championId);
  if (!def) return;

  // Walk the authored order and take the first pick that is currently legal.
  const taken = Object.values(champ.abilities).reduce((sum, slot) => sum + slot.rank, 0);
  for (let i = taken; i < def.skillOrder.length; i++) {
    if (match.levelUpAbility(unit, def.skillOrder[i])) return;
  }
  // The order stalled (an ultimate not yet unlocked): take anything legal.
  for (const key of ['Q', 'W', 'E', 'R'] as AbilityKey[]) {
    if (match.levelUpAbility(unit, key)) return;
  }
}

function shop(match: Match, unit: Unit, memory: BotMemory): void {
  const champ = unit.champion!;
  const def = getChampion(champ.championId);
  if (!def) return;

  // Buy as far down the build as the purse allows, one item per visit tick.
  while (memory.buildIndex < def.buildOrder.length) {
    const itemId = def.buildOrder[memory.buildIndex];
    const item = getItem(itemId);
    if (!item) {
      memory.buildIndex++;
      continue;
    }
    if (champ.items.length >= MAX_ITEMS && !item.from) break;
    if (champ.gold < effectiveCost(item, champ.items)) break;
    if (!match.buyItem(unit, itemId)) break;
    memory.buildIndex++;
  }
}

/* ------------------------------------------------------------------ *
 * Positional helpers
 * ------------------------------------------------------------------ */

/** Where the bot should stand in its lane: just behind its own wave. */
function laneAnchor(match: Match, team: Team, lane: LaneId): Vec2 {
  const world = match.world;
  const path = lanePathFor(team, lane);

  let furthest: Unit | undefined;
  let bestProgress = -1;
  for (const u of world.units.values()) {
    if (!u.alive || u.kind !== 'minion' || u.team !== team || u.minion!.lane !== lane) continue;
    const progress = u.minion!.waypoint;
    if (progress > bestProgress) {
      bestProgress = progress;
      furthest = u;
    }
  }

  if (!furthest) {
    // No wave of ours alive: fall back to the midpoint of the lane.
    return path[Math.floor(path.length / 2)];
  }

  // Stand level with the leading minion, pulled back just enough to stay out
  // of the enemy wave's focus. Sitting behind the wave means enemy minions are
  // never in range and the bot never farms.
  const back = path[Math.max(0, Math.min(path.length - 1, furthest.minion!.waypoint - 1))];
  const toBack = normalize({ x: back.x - furthest.pos.x, y: back.y - furthest.pos.y });
  return { x: furthest.pos.x + toBack.x * 120, y: furthest.pos.y + toBack.y * 120 };
}

/** The outermost enemy structure still standing in a lane. */
function nextStructureInLane(match: Match, team: Team, lane: LaneId): Unit | undefined {
  const foe = enemyOf(team);
  const order = ['outer', 'inner', 'inhib', 'nexus'];
  let best: Unit | undefined;
  let bestRank = 99;

  for (const u of match.world.units.values()) {
    if (!u.alive || u.team !== foe) continue;
    if (u.kind === 'tower') {
      if (u.structure!.lane !== lane) continue;
      const rank = order.indexOf(u.structure!.tier);
      if (rank >= 0 && rank < bestRank) {
        bestRank = rank;
        best = u;
      }
    }
  }
  if (best) return best;

  for (const u of match.world.units.values()) {
    if (!u.alive || u.team !== foe) continue;
    if (u.kind === 'inhibitor' && u.structure!.lane === lane) {
      if (!structureIsShielded(match.world, u)) return u;
    }
  }
  for (const u of match.world.units.values()) {
    if (u.kind === 'nexus' && u.team === foe && u.alive) {
      if (!structureIsShielded(match.world, u)) return u;
    }
  }
  return undefined;
}

/** The lane the whole team should converge on: the one that is furthest in. */
function teamPushLane(match: Match, team: Team): LaneId {
  let best: LaneId = 1;
  let bestRank = -1;
  const order = ['outer', 'inner', 'inhib', 'nexus'];
  for (const lane of LANES) {
    const next = nextStructureInLane(match, team, lane);
    const rank = next?.structure ? order.indexOf(next.structure.tier) : 9;
    if (rank > bestRank) {
      bestRank = rank;
      best = lane;
    }
  }
  return best;
}

/** Somewhere safer than here: behind the nearest friendly turret. */
function retreatPoint(match: Match, unit: Unit, s: Situation): Vec2 {
  const team = unit.team as Team;
  const home = FOUNTAIN_POS[team];

  let best: Vec2 = home;
  let bestD = Infinity;
  for (const u of match.world.units.values()) {
    if (!u.alive || u.kind !== 'tower' || u.team !== team) continue;
    const d = dist(u.pos, unit.pos);
    if (d < bestD) {
      bestD = d;
      best = u.pos;
    }
  }

  // If the threat is between the bot and that turret, just run for the base.
  if (s.nearestEnemy) {
    const toTurret = dist(unit.pos, best);
    const enemyToTurret = dist(s.nearestEnemy.pos, best);
    if (enemyToTurret < toTurret * 0.75) return home;
  }
  return { x: best.x, y: best.y };
}

/** Lowest effective health enemy champion the bot can actually reach. */
function pickFightTarget(unit: Unit, s: Situation): Unit | undefined {
  let best: Unit | undefined;
  let bestScore = -Infinity;
  for (const e of s.enemies) {
    const d = dist(unit.pos, e.pos);
    if (d > ENGAGE_RANGE + 400) continue;
    const squishiness = 1 - Math.min(1, (e.stats.armor + e.stats.mr) / 300);
    const wounded = 1 - e.hp / Math.max(1, e.stats.maxHp);
    const score = wounded * 2.2 + squishiness * 1.3 - d / 1200;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (best) return best;
  // Nothing worth chasing: fall back to whatever is closest.
  return s.nearestEnemy;
}

setBotController(runBots);
