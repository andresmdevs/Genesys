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
import { BLUE, RED } from '../data/map.ts';
import type { SlotConfig } from '../sim/match.ts';
import type { ChampionRole } from '../sim/types.ts';
import {
  POSITIONS,
  positionOfSlot,
  teamOfSlot,
  type Position,
} from '../sim/positions.ts';
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

  // Each seat has a champion pair that suits it; empty seats take whichever
  // of those is still free, falling back to anything left.
  const roleFor: Record<Position, ChampionRole> = {
    top: 'top',
    jungle: 'mid',
    mid: 'mage',
    adc: 'adc',
    support: 'support',
  };

  for (let slot = 0; slot < 10; slot++) {
    if (assigned.has(slot)) continue;
    const pool = championsByRole(roleFor[positionOfSlot(slot)]).filter((c) => !taken.has(c.id));
    const fallback = CHAMPIONS.filter((c) => !taken.has(c.id));
    const choices = pool.length > 0 ? pool : fallback;
    const def = choices.length > 0 ? choices[rng.int(0, choices.length - 1)] : CHAMPIONS[0];
    assigned.set(slot, def);
    taken.add(def.id);
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
      team: teamOfSlot(slot) === 0 ? BLUE : RED,
      position: positionOfSlot(slot),
      isBot,
      displayName: isBot ? BOT_NAMES[botName++ % BOT_NAMES.length] : (pick?.name ?? `Jugador ${slot}`),
    });
  }
  return out;
}

export { POSITIONS };
