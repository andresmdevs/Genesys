/** Tuning constants. Times are in seconds unless the name says otherwise. */

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const secToTicks = (s: number): number => Math.round(s * TICK_RATE);
export const ticksToSec = (t: number): number => t / TICK_RATE;

/* Progression ----------------------------------------------------- */

export const MAX_LEVEL = 18;
export const STARTING_GOLD = 500;
/** Passive income, so a player who falls behind still reaches item spikes. */
export const PASSIVE_GOLD_PER_SEC = 2.7;

/** XP needed to go from `level` to `level + 1`. */
export const xpToNextLevel = (level: number): number => 200 + 88 * (level - 1);

/** Radius inside which a kill or a minion death shares XP with nearby allies. */
export const XP_SHARE_RADIUS = 1400;

/* Combat ---------------------------------------------------------- */

export const BASE_CRIT_DAMAGE = 1.75;
/** Fraction of an attack's duration spent winding up before damage lands. */
export const ATTACK_WINDUP = 0.28;
export const AUTO_ATTACK_PROJECTILE_SPEED = 2200;

/** Diminishing returns on negative armour, matching the usual MOBA curve. */
export const resistMultiplier = (resist: number): number =>
  resist >= 0 ? 100 / (100 + resist) : 2 - 100 / (100 - resist);

/* Minions --------------------------------------------------------- */

export const FIRST_WAVE_AT = 25;
export const WAVE_INTERVAL = 30;
/** Every third wave carries a siege minion. */
export const SIEGE_EVERY = 3;
export const MINION_SPAWN_STAGGER = 0.25;

/* Respawn --------------------------------------------------------- */

/** Death timers grow with level and with elapsed game time, as in the genre. */
export function respawnSeconds(level: number, gameSeconds: number): number {
  const base = 6 + level * 2.2;
  const lateGameScale = 1 + Math.max(0, gameSeconds - 900) / 1800;
  return Math.min(62, base * lateGameScale);
}

/* Bounties -------------------------------------------------------- */

export const BASE_KILL_GOLD = 300;
export const ASSIST_SHARE = 0.55;
export const FIRST_BLOOD_BONUS = 150;
export const TOWER_LOCAL_GOLD = 250;
export const TOWER_TEAM_GOLD = 100;
export const INHIBITOR_LOCAL_GOLD = 150;

/** A win streak raises the bounty on your head; a loss streak lowers it. */
export function bountyFor(streak: number, deathStreak: number): number {
  if (deathStreak >= 2) return Math.max(80, BASE_KILL_GOLD - 60 * (deathStreak - 1));
  return BASE_KILL_GOLD + Math.min(700, 90 * Math.max(0, streak - 1));
}

/* Vision ---------------------------------------------------------- */

export const CHAMPION_VISION = 1500;
export const MINION_VISION = 1100;
export const TOWER_VISION = 1500;
export const WARD_VISION = 1300;
export const BRUSH_REVEAL_RADIUS = 220;

/* Objectives ------------------------------------------------------ */

export const DRAGON_FIRST_SPAWN = 240;
export const DRAGON_RESPAWN = 270;
export const BARON_FIRST_SPAWN = 600;
export const BARON_RESPAWN = 330;
export const CAMP_FIRST_SPAWN = 70;
export const CAMP_RESPAWN = 130;

/* Structures ------------------------------------------------------ */

/** Outer turrets shed their plating-era resistance once the laning phase ends. */
export const TOWER_FORTIFY_UNTIL = 300;
export const INHIBITOR_RESPAWN = 240;
export const SUPER_MINION_PER_INHIB = 1;

/* Shop ------------------------------------------------------------ */

export const RECALL_CHANNEL = 7;
export const SELL_REFUND = 0.7;
export const MAX_ITEMS = 6;
