/**
 * Positions are where a player plays, which is separate from what a champion
 * is good at. Picking a mage for the jungle is a choice, not an error, so the
 * two are kept apart: the champion's `role` is a suggestion, the player's
 * `position` is what the game acts on.
 */

import { BOT, MID, TOP, type LaneId } from '../data/map.ts';
import type { ChampionRole } from './types.ts';

export type Position = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

/** Order used for lobby seats, so slot 0..4 reads top to support. */
export const POSITIONS: readonly Position[] = ['top', 'jungle', 'mid', 'adc', 'support'];

export const POSITION_NAMES: Record<Position, string> = {
  top: 'Superior',
  jungle: 'Jungla',
  mid: 'Central',
  adc: 'Tirador',
  support: 'Soporte',
};

export const POSITION_SHORT: Record<Position, string> = {
  top: 'TOP',
  jungle: 'JG',
  mid: 'MID',
  adc: 'ADC',
  support: 'SUP',
};

/** The lane a position holds, or null for the jungle. */
export const LANE_FOR_POSITION: Record<Position, LaneId | null> = {
  top: TOP,
  jungle: null,
  mid: MID,
  adc: BOT,
  support: BOT,
};

/** Where a champion in this position starts and returns to. */
export const laneOf = (position: Position): LaneId =>
  LANE_FOR_POSITION[position] ?? MID;

export const isJungle = (position: Position): boolean => position === 'jungle';

/** The position a champion's kit is built for, used to seed default rosters. */
export const DEFAULT_POSITION_FOR_ROLE: Record<ChampionRole, Position> = {
  top: 'top',
  mid: 'jungle',
  mage: 'mid',
  adc: 'adc',
  support: 'support',
};

/** Slots 0-4 are blue, 5-9 red, ordered by position. */
export const slotFor = (team: 0 | 1, position: Position): number =>
  team * 5 + POSITIONS.indexOf(position);

export const teamOfSlot = (slot: number): 0 | 1 => (slot < 5 ? 0 : 1);
export const positionOfSlot = (slot: number): Position => POSITIONS[slot % 5];
