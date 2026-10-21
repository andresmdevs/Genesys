/**
 * Turns the lobby's picks into the full ten-slot roster.
 *
 * Every client runs this with the same seed and the same picks, so they all
 * build an identical match without the server knowing anything about
 * champions.
 */

import { CHAMPIONS, championsByRole, getChampion } from '../champions/index.ts';
import type { ChampionDef } from '../champions/types.ts';
import { Rng } from '../core/rng.ts';
import { BLUE, RED, type Team } from '../data/map.ts';
import type { SlotConfig } from '../sim/match.ts';
import { ROLES, type ChampionRole } from '../sim/types.ts';
import { LANE_FOR_ROLE } from '../ui/lanes.ts';
import type { Pick } from './protocol.ts';

const BOT_NAMES = [
  'Arden', 'Brisa', 'Cairo', 'Duna', 'Eris',
  'Faro', 'Gala', 'Hilo', 'Ira', 'Juno',
];

/**
 * Builds the roster. Slots 0-4 are blue and 5-9 are red. Human picks are
 * honoured; every other slot is filled so that each team fields one champion
 * of each role and no champion appears twice.
 */
export function buildOnlineRoster(seed: number, picks: Pick[]): SlotConfig[] {
  const rng = new Rng(seed ^ 0x5bf03635);
  const bySlot = new Map(picks.map((p) => [p.slot, p]));
  const taken = new Set<string>();

  // Honour the human picks first, so nobody loses the champion they chose.
  const assigned = new Map<number, ChampionDef>();
  for (let slot = 0; slot < 10; slot++) {
    const pick = bySlot.get(slot);
    const def = pick?.championId ? getChampion(pick.championId) : undefined;
    if (def && !taken.has(def.id)) {
      assigned.set(slot, def);
      taken.add(def.id);
    }
  }

  // Then fill each team's missing roles with whatever is still free.
  for (const team of [BLUE, RED] as Team[]) {
    const slots = team === BLUE ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
    const open = slots.filter((s) => !assigned.has(s));
    const covered = new Set<ChampionRole>();
    for (const s of slots) {
      const def = assigned.get(s);
      if (def) covered.add(def.role);
    }
    const missing = ROLES.filter((r) => !covered.has(r as ChampionRole)) as ChampionRole[];

    for (const slot of open) {
      const role = missing.shift();
      const pool = (role ? championsByRole(role) : CHAMPIONS).filter((c) => !taken.has(c.id));
      const fallback = CHAMPIONS.filter((c) => !taken.has(c.id));
      const choices = pool.length > 0 ? pool : fallback;
      const def = choices.length > 0 ? choices[rng.int(0, choices.length - 1)] : CHAMPIONS[0];
      assigned.set(slot, def);
      taken.add(def.id);
    }
  }

  const out: SlotConfig[] = [];
  let botName = 0;
  for (let slot = 0; slot < 10; slot++) {
    const def = assigned.get(slot)!;
    const pick = bySlot.get(slot);
    const isBot = !pick;
    out.push({
      slot,
      championId: def.id,
      team: slot < 5 ? BLUE : RED,
      lane: LANE_FOR_ROLE[def.role],
      isBot,
      displayName: isBot ? BOT_NAMES[botName++ % BOT_NAMES.length] : (pick?.name ?? `Jugador ${slot}`),
    });
  }
  return out;
}
