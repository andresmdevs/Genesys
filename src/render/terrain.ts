/**
 * The map is drawn once into an offscreen texture and blitted each frame.
 *
 * It is built from the very same `WALKABLE_SHAPES` the navigation grid
 * rasterises, so anywhere that looks like ground is ground.
 */

import { MAP_SIZE } from '../data/map.ts';
import {
  BARON_PIT,
  BLUE,
  BRUSH_RECTS,
  DRAGON_PIT,
  FOUNTAIN_POS,
  LANES,
  LANE_PATHS,
  NEXUS_POS,
  RED,
  WALKABLE_SHAPES,
  type Shape,
} from '../data/map.ts';
import { PALETTE, alpha } from './palette.ts';
import type { Camera } from './camera.ts';

const TEX = 3072;
const SCALE = TEX / MAP_SIZE;

/** World point to texture pixel. World y points up, texture y points down. */
const tx = (x: number): number => x * SCALE;
const ty = (y: number): number => TEX - y * SCALE;

let texture: HTMLCanvasElement | null = null;

function traceShape(ctx: CanvasRenderingContext2D, s: Shape, grow = 0): void {
  if (s.kind === 'disc') {
    ctx.beginPath();
    ctx.arc(tx(s.c.x), ty(s.c.y), (s.r + grow) * SCALE, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineCap = 'round';
    ctx.lineWidth = (s.r + grow) * 2 * SCALE;
    ctx.beginPath();
    ctx.moveTo(tx(s.a.x), ty(s.a.y));
    ctx.lineTo(tx(s.b.x), ty(s.b.y));
    ctx.stroke();
  }
}

/** Fills or strokes every walkable shape in the current style. */
function paintTerrain(ctx: CanvasRenderingContext2D, colour: string, grow = 0): void {
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  for (const s of WALKABLE_SHAPES) traceShape(ctx, s, grow);
}

function buildTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TEX;
  canvas.height = TEX;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, TEX, TEX);

  // Three passes build a lit edge: a soft halo, a bright rim, then the floor.
  // Without the rim the playable area is hard to read at gameplay zoom.
  paintTerrain(ctx, alpha(PALETTE.terrainEdge, 0.14), 110);
  paintTerrain(ctx, alpha(PALETTE.terrainEdge, 0.85), 26);
  paintTerrain(ctx, PALETTE.terrain, 0);

  // Faint grid inside the walkable area gives the floor a sense of scale and
  // keeps large open spaces from looking like flat fill.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = alpha('#ffffff', 0.035);
  ctx.lineWidth = 1;
  const gridStep = 600 * SCALE;
  ctx.beginPath();
  for (let g = 0; g <= TEX; g += gridStep) {
    ctx.moveTo(g, 0);
    ctx.lineTo(g, TEX);
    ctx.moveTo(0, g);
    ctx.lineTo(TEX, g);
  }
  ctx.stroke();
  ctx.restore();

  // River: a translucent band along the anti-diagonal.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = alpha(PALETTE.river, 0.85);
  ctx.lineWidth = 1400 * SCALE;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tx(2550), ty(11850));
  ctx.lineTo(tx(11850), ty(2550));
  ctx.stroke();

  // Epic pits.
  for (const pit of [DRAGON_PIT, BARON_PIT]) {
    const g = ctx.createRadialGradient(tx(pit.x), ty(pit.y), 0, tx(pit.x), ty(pit.y), 950 * SCALE);
    g.addColorStop(0, alpha(PALETTE.pit, 0.95));
    g.addColorStop(1, alpha(PALETTE.pit, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tx(pit.x), ty(pit.y), 950 * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }

  // Base tint, so each side reads as home ground at a glance.
  for (const team of [BLUE, RED] as const) {
    const base = NEXUS_POS[team];
    const colour = team === BLUE ? PALETTE.blue : PALETTE.red;
    const g = ctx.createRadialGradient(tx(base.x), ty(base.y), 0, tx(base.x), ty(base.y), 2600 * SCALE);
    g.addColorStop(0, alpha(colour, 0.22));
    g.addColorStop(1, alpha(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tx(base.x), ty(base.y), 2600 * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Lane centre lines, faint, to make the three routes legible from far out.
  ctx.strokeStyle = alpha(PALETTE.terrainEdge, 0.5);
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 18]);
  for (const lane of LANES) {
    const path = LANE_PATHS[lane];
    ctx.beginPath();
    ctx.moveTo(tx(path[0].x), ty(path[0].y));
    for (let i = 1; i < path.length; i++) ctx.lineTo(tx(path[i].x), ty(path[i].y));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Brush. Drawn as clustered blobs rather than flat rectangles so the shape
  // still reads as foliage at minimap scale.
  for (const r of BRUSH_RECTS) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    ctx.fillStyle = alpha(PALETTE.brush, 0.92);
    ctx.beginPath();
    ctx.roundRect(tx(r.x0), ty(r.y1), w * SCALE, h * SCALE, 10);
    ctx.fill();
    ctx.strokeStyle = alpha(PALETTE.brushEdge, 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Deterministic blob positions keep the texture stable between loads.
    let seed = Math.round(r.x0 * 7 + r.y0 * 13);
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    ctx.fillStyle = alpha(PALETTE.brushEdge, 0.4);
    const blobs = Math.max(5, Math.round((w * h) / 90000));
    for (let i = 0; i < blobs; i++) {
      const bx = r.x0 + rand() * w;
      const by = r.y0 + rand() * h;
      ctx.beginPath();
      ctx.arc(tx(bx), ty(by), (40 + rand() * 50) * SCALE, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Fountain pads.
  for (const team of [BLUE, RED] as const) {
    const f = FOUNTAIN_POS[team];
    ctx.strokeStyle = alpha(team === BLUE ? PALETTE.blue : PALETTE.red, 0.7);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(tx(f.x), ty(f.y), 700 * SCALE, 0, Math.PI * 2);
    ctx.stroke();
  }

  return canvas;
}

export function terrainTexture(): HTMLCanvasElement {
  if (!texture) texture = buildTexture();
  return texture;
}

/** Blits only the part of the map that is on screen. */
export function drawTerrain(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const tex = terrainTexture();
  const b = camera.viewBounds(200);

  const sx0 = Math.max(0, tx(b.x0));
  const sx1 = Math.min(TEX, tx(b.x1));
  const sy0 = Math.max(0, ty(b.y1));
  const sy1 = Math.min(TEX, ty(b.y0));
  if (sx1 <= sx0 || sy1 <= sy0) return;

  // Convert the clipped source rect back to world space, then to screen.
  const worldTopLeft = { x: sx0 / SCALE, y: (TEX - sy0) / SCALE };
  const worldBotRight = { x: sx1 / SCALE, y: (TEX - sy1) / SCALE };
  const tl = camera.worldToScreen(worldTopLeft);
  const br = camera.worldToScreen(worldBotRight);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tex, sx0, sy0, sx1 - sx0, sy1 - sy0, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

export const TERRAIN_TEX_SIZE = TEX;
export const TERRAIN_SCALE = SCALE;
export { tx as texX, ty as texY };
