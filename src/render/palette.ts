/** The game's colour language. One place, so the whole screen stays coherent. */

export const PALETTE = {
  void: '#03050b',
  terrain: '#1b2740',
  terrainEdge: '#4d86c9',
  river: '#1a4a6e',
  brush: '#16401f',
  brushEdge: '#3f9152',
  pit: '#2a1f3d',

  blue: '#39b7ff',
  blueDeep: '#0d4b74',
  red: '#ff5d5d',
  redDeep: '#78212a',
  neutral: '#e0b44c',
  gold: '#ffd166',
  mana: '#5a8cff',
  health: '#43d67a',
  healthEnemy: '#ff6b6b',
  shield: '#cfe6ff',
  xp: '#b98cff',

  text: '#e8eefc',
  textDim: '#8ea0c0',
  danger: '#ff4d6d',
  warning: '#ffb020',
} as const;

export const teamColour = (team: number): string =>
  team === 0 ? PALETTE.blue : team === 1 ? PALETTE.red : PALETTE.gold;

export const teamDeep = (team: number): string =>
  team === 0 ? PALETTE.blueDeep : team === 1 ? PALETTE.redDeep : '#5a4718';

/** Translucent variant of a hex colour. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Mixes two hex colours; `t` of 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round((((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t));
  const g = Math.round((((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t));
  const bl = Math.round(((pa & 255) * (1 - t) + (pb & 255) * t));
  return `rgb(${r}, ${g}, ${bl})`;
}
