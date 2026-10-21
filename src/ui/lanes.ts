import type { ChampionRole } from '../sim/types.ts';
import { BOT as BOT_LANE, MID as MID_LANE, TOP as TOP_LANE, type LaneId } from '../data/map.ts';

/**
 * Which lane each role walks to. There is no jungler in Genesys, so the five
 * roles split one, two and two across the three lanes.
 */
export const LANE_FOR_ROLE: Record<ChampionRole, LaneId> = {
  top: TOP_LANE,
  mid: MID_LANE,
  mage: MID_LANE,
  adc: BOT_LANE,
  support: BOT_LANE,
};

export { BOT_LANE as BOT, MID_LANE as MID, TOP_LANE as TOP };
export type { LaneId };
