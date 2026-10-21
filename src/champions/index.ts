import type { ChampionDef } from './types.ts';
import type { ChampionRole } from '../sim/types.ts';

/** Populated by the champion modules; see `registerChampions`. */
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
