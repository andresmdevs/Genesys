import type { ChampionRole } from '../sim/types.ts';
import type { ChampionDef } from './types.ts';

/**
 * Champion modules register themselves here on import. Kept separate from
 * `index.ts` so the champion files can import the registry without the
 * circular reference that a self-importing barrel would create.
 */
export const CHAMPIONS: ChampionDef[] = [];

const byId = new Map<string, ChampionDef>();

export function registerChampion(def: ChampionDef): ChampionDef {
  CHAMPIONS.push(def);
  byId.set(def.id, def);
  return def;
}

export const getChampion = (id: string): ChampionDef | undefined => byId.get(id);

export const championsByRole = (role: ChampionRole): ChampionDef[] =>
  CHAMPIONS.filter((c) => c.role === role);
