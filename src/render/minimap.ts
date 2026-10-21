/**
 * Minimap. Shares the terrain texture with the main view, so the two can never
 * disagree about where the walls are.
 */

import { MAP_SIZE } from '../data/map.ts';
import type { Match } from '../sim/match.ts';
import type { Team } from '../data/map.ts';
import type { Vec2 } from '../core/math.ts';
import { PALETTE, alpha, teamColour } from './palette.ts';
import { terrainTexture } from './terrain.ts';
import type { Camera } from './camera.ts';

export function drawMinimap(
  canvas: HTMLCanvasElement,
  match: Match,
  camera: Camera,
  team: Team,
  playerId: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width;
  const scale = size / MAP_SIZE;
  const toMap = (p: Vec2): Vec2 => ({ x: p.x * scale, y: size - p.y * scale });

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(terrainTexture(), 0, 0, size, size);

  // Dim what the team cannot currently see.
  ctx.fillStyle = 'rgba(3, 5, 12, 0.55)';
  ctx.fillRect(0, 0, size, size);

  const world = match.world;
  const visible = world.visible[team];

  // Structures.
  for (const u of world.units.values()) {
    if (!u.alive || !u.isStatic) continue;
    const p = toMap(u.pos);
    const r = u.kind === 'nexus' ? 5 : u.kind === 'inhibitor' ? 4 : 3;
    ctx.fillStyle = teamColour(u.team);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Minions as faint specks, so lane pressure is readable at a glance.
  for (const u of world.units.values()) {
    if (!u.alive || u.kind !== 'minion') continue;
    if (u.team !== team && !visible.has(u.id)) continue;
    const p = toMap(u.pos);
    ctx.fillStyle = alpha(teamColour(u.team), 0.65);
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }

  // Epic monsters.
  for (const u of world.units.values()) {
    if (!u.alive || u.kind !== 'monster' || u.monster!.kind === 'camp') continue;
    const p = toMap(u.pos);
    ctx.fillStyle = PALETTE.neutral;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Champions last and largest: they are what the minimap is for.
  for (const u of world.units.values()) {
    if (u.kind !== 'champion' || !u.alive) continue;
    if (u.team !== team && !visible.has(u.id)) continue;
    const p = toMap(u.pos);
    ctx.fillStyle = teamColour(u.team);
    ctx.strokeStyle = u.id === playerId ? '#ffffff' : 'rgba(0,0,0,0.7)';
    ctx.lineWidth = u.id === playerId ? 2 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, u.id === playerId ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Pings.
  for (const f of world.fx) {
    if (f.style !== 'ping') continue;
    const p = toMap(f.pos);
    const t = f.age / f.life;
    ctx.strokeStyle = alpha(f.colour ?? PALETTE.gold, 1 - t);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 + t * 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Camera viewport rectangle.
  const b = camera.viewBounds(0);
  const tl = toMap({ x: b.x0, y: b.y1 });
  const br = toMap({ x: b.x1, y: b.y0 });
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

/** Converts a click inside the minimap to a world position. */
export function minimapToWorld(canvas: HTMLCanvasElement, clientX: number, clientY: number): Vec2 {
  const rect = canvas.getBoundingClientRect();
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  return { x: fx * MAP_SIZE, y: (1 - fy) * MAP_SIZE };
}
