/**
 * Draws the world. Everything is vector work on a 2D canvas: no sprites, no
 * atlases, nothing to download. Shapes carry the meaning - circles are
 * champions, diamonds are minions, hexagons are structures - and colour
 * carries allegiance.
 */

import { type Vec2 } from '../core/math.ts';
import { CHAMPION_VISION, MINION_VISION, TOWER_VISION, ticksToSec } from '../sim/constants.ts';
import { shieldAmount } from '../sim/stats.ts';
import { getChampion } from '../champions/index.ts';
import { FOUNTAIN_POS, type Team } from '../data/map.ts';
import type { Projectile, Unit, VisualEffect, Zone } from '../sim/types.ts';
import type { Match } from '../sim/match.ts';
import { PALETTE, alpha, teamColour, teamDeep } from './palette.ts';
import { drawTerrain } from './terrain.ts';
import type { Camera } from './camera.ts';

export interface RenderState {
  /** Team whose point of view is drawn. */
  team: Team;
  /** The champion the local player controls, if any. */
  playerId: number;
  /** Ability the player is currently aiming, or null. */
  aiming: { key: string; range: number; radius: number; width: number; targeting: string } | null;
  cursorWorld: Vec2;
  hoveredUnitId: number;
  showRanges: boolean;
}

let fogCanvas: HTMLCanvasElement | null = null;

export function render(
  ctx: CanvasRenderingContext2D,
  match: Match,
  camera: Camera,
  state: RenderState,
): void {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, width, height);

  drawTerrain(ctx, camera);

  const world = match.world;
  const visible = world.visible[state.team];

  drawZones(ctx, camera, world.zones, visible, state.team);
  drawAimIndicator(ctx, camera, match, state);
  drawFog(ctx, camera, match, state.team);

  // Structures first so units always read on top of them.
  const units = [...world.units.values()];
  for (const u of units) {
    if (!u.alive || !u.isStatic) continue;
    if (!camera.isVisible(u.pos, u.radius)) continue;
    drawStructure(ctx, camera, u, match, state);
  }

  for (const u of units) {
    if (!u.alive || u.isStatic) continue;
    if (!camera.isVisible(u.pos, u.radius + 120)) continue;
    if (u.team !== state.team && !visible.has(u.id)) continue;
    if (u.kind === 'minion') drawMinion(ctx, camera, u, state);
    else if (u.kind === 'monster') drawMonster(ctx, camera, u);
    else if (u.kind === 'champion') drawChampion(ctx, camera, u, state);
  }

  drawProjectiles(ctx, camera, world.projectiles, visible, state.team);
  drawEffects(ctx, camera, world.fx);

  // Bars go last so nothing can cover them.
  for (const u of units) {
    if (!u.alive) continue;
    if (!camera.isVisible(u.pos, u.radius + 120)) continue;
    if (u.team !== state.team && !visible.has(u.id)) continue;
    drawHealthBar(ctx, camera, u, state);
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Fog of war
 * ------------------------------------------------------------------ */

function drawFog(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  match: Match,
  team: Team,
): void {
  const { width, height } = ctx.canvas;
  if (!fogCanvas) fogCanvas = document.createElement('canvas');
  if (fogCanvas.width !== width || fogCanvas.height !== height) {
    fogCanvas.width = width;
    fogCanvas.height = height;
  }
  const fog = fogCanvas.getContext('2d')!;

  fog.globalCompositeOperation = 'source-over';
  fog.fillStyle = 'rgba(3, 5, 11, 0.66)';
  fog.fillRect(0, 0, width, height);

  // Punch a soft hole in the fog around everything this team can see from.
  fog.globalCompositeOperation = 'destination-out';
  for (const u of match.world.units.values()) {
    if (!u.alive || u.team !== team) continue;
    const range =
      u.kind === 'champion'
        ? CHAMPION_VISION
        : u.kind === 'minion'
          ? MINION_VISION
          : u.isStatic
            ? TOWER_VISION
            : MINION_VISION;
    if (!camera.isVisible(u.pos, range)) continue;

    const p = camera.worldToScreen(u.pos);
    const r = range * camera.zoom;
    const g = fog.createRadialGradient(p.x, p.y, r * 0.55, p.x, p.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fog.fillStyle = g;
    fog.beginPath();
    fog.arc(p.x, p.y, r, 0, Math.PI * 2);
    fog.fill();
  }

  // The fountain is always lit.
  const f = camera.worldToScreen(FOUNTAIN_POS[team]);
  const fr = 1600 * camera.zoom;
  const fg = fog.createRadialGradient(f.x, f.y, fr * 0.5, f.x, f.y, fr);
  fg.addColorStop(0, 'rgba(0,0,0,1)');
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  fog.fillStyle = fg;
  fog.beginPath();
  fog.arc(f.x, f.y, fr, 0, Math.PI * 2);
  fog.fill();

  ctx.drawImage(fogCanvas, 0, 0);
}

/* ------------------------------------------------------------------ *
 * Units
 * ------------------------------------------------------------------ */

function polygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawChampion(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  u: Unit,
  state: RenderState,
): void {
  const p = camera.worldToScreen(u.pos);
  const r = u.radius * camera.zoom;
  const def = getChampion(u.champion!.championId);
  const accent = def?.colour ?? teamColour(u.team);
  const team = teamColour(u.team);
  const stealthed = u.effects.some((e) => e.kind === 'stealth');

  ctx.save();
  if (stealthed) ctx.globalAlpha = 0.45;

  // Selection ring for the champion the player controls.
  if (u.id === state.playerId) {
    ctx.strokeStyle = alpha('#ffffff', 0.85);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Team disc with the champion's own accent at the core.
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.fillStyle = teamDeep(u.team);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.58, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = team;
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();

  // Facing wedge: it is how you read where someone is about to go.
  ctx.fillStyle = team;
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(-u.facing) * r * 1.5, p.y + Math.sin(-u.facing) * r * 1.5);
  ctx.lineTo(
    p.x + Math.cos(-u.facing + 2.5) * r * 0.75,
    p.y + Math.sin(-u.facing + 2.5) * r * 0.75,
  );
  ctx.lineTo(
    p.x + Math.cos(-u.facing - 2.5) * r * 0.75,
    p.y + Math.sin(-u.facing - 2.5) * r * 0.75,
  );
  ctx.closePath();
  ctx.fill();

  if (state.showRanges && u.id === state.playerId) {
    ctx.strokeStyle = alpha('#ffffff', 0.16);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, u.stats.attackRange * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawStatusRing(ctx, p, r, u);
  ctx.restore();

  // Recall channel.
  const champ = u.champion!;
  if (champ.recallTicks >= 0) {
    const progress = ticksToSec(champ.recallTicks) / 7;
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.9, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
  }
}

/** A coloured arc for whatever crowd control is on the unit right now. */
function drawStatusRing(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  r: number,
  u: Unit,
): void {
  let colour: string | null = null;
  for (const e of u.effects) {
    if (e.kind === 'stun' || e.kind === 'airborne') colour = PALETTE.warning;
    else if (e.kind === 'root' && !colour) colour = '#8fd0ff';
    else if (e.kind === 'silence' && !colour) colour = '#c79bff';
  }
  if (colour) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (shieldAmount(u) > 0) {
    ctx.strokeStyle = alpha(PALETTE.shield, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.18, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawMinion(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  u: Unit,
  state: RenderState,
): void {
  const p = camera.worldToScreen(u.pos);
  const r = u.radius * camera.zoom;
  const colour = teamColour(u.team);
  const kind = u.minion!.kind;

  ctx.fillStyle = teamDeep(u.team);
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, r * 0.2);

  if (kind === 'caster') polygon(ctx, p.x, p.y, r, 3, -Math.PI / 2 - u.facing);
  else if (kind === 'siege') polygon(ctx, p.x, p.y, r, 5, -u.facing);
  else if (kind === 'super') polygon(ctx, p.x, p.y, r, 6, -u.facing);
  else polygon(ctx, p.x, p.y, r, 4, Math.PI / 4);

  ctx.fill();
  ctx.stroke();

  if (kind === 'super' || kind === 'siege') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  void state;
}

function drawMonster(ctx: CanvasRenderingContext2D, camera: Camera, u: Unit): void {
  const p = camera.worldToScreen(u.pos);
  const r = u.radius * camera.zoom;
  const epic = u.monster!.kind !== 'camp';

  ctx.save();
  ctx.shadowColor = PALETTE.neutral;
  ctx.shadowBlur = epic ? 24 : 10;
  ctx.fillStyle = epic ? '#3a2d12' : '#2c2a1c';
  ctx.strokeStyle = PALETTE.neutral;
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  polygon(ctx, p.x, p.y, r, epic ? 8 : 5, -u.facing);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (epic) {
    ctx.fillStyle = PALETTE.neutral;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStructure(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  u: Unit,
  match: Match,
  state: RenderState,
): void {
  const p = camera.worldToScreen(u.pos);
  const r = u.radius * camera.zoom;
  const colour = teamColour(u.team);
  const shielded = match.isStructureShielded(u);

  ctx.save();
  ctx.globalAlpha = shielded ? 0.55 : 1;
  ctx.shadowColor = colour;
  ctx.shadowBlur = u.kind === 'nexus' ? 28 : 14;
  ctx.fillStyle = teamDeep(u.team);
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(2, r * 0.12);

  const sides = u.kind === 'nexus' ? 8 : u.kind === 'inhibitor' ? 4 : 6;
  polygon(ctx, p.x, p.y, r, sides, u.kind === 'inhibitor' ? Math.PI / 4 : 0);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Show enemy turret reach, which is the single most useful overlay there is.
  if (u.kind === 'tower' && u.team !== state.team && !shielded) {
    ctx.strokeStyle = alpha(PALETTE.danger, 0.22);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, u.stats.attackRange * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* ------------------------------------------------------------------ *
 * Bars
 * ------------------------------------------------------------------ */

function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  u: Unit,
  state: RenderState,
): void {
  if (u.kind === 'ward') return;
  const p = camera.worldToScreen(u.pos);
  const champion = u.kind === 'champion';
  const big = champion || u.isStatic || u.monster?.kind !== undefined;
  const w = (champion ? 86 : u.isStatic ? 110 : 44) * Math.max(0.55, camera.zoom / 0.33);
  const h = champion ? 8 : u.isStatic ? 9 : 5;
  const y = p.y - u.radius * camera.zoom - (big ? 20 : 12);
  const x = p.x - w / 2;

  const frac = Math.max(0, u.hp / Math.max(1, u.stats.maxHp));
  const friendly = u.team === state.team;

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);

  ctx.fillStyle = friendly ? PALETTE.health : u.team === 2 ? PALETTE.neutral : PALETTE.healthEnemy;
  ctx.fillRect(x, y, w * frac, h);

  const shield = shieldAmount(u);
  if (shield > 0) {
    const sf = Math.min(1 - frac, shield / Math.max(1, u.stats.maxHp));
    ctx.fillStyle = PALETTE.shield;
    ctx.fillRect(x + w * frac, y, w * sf, h);
  }

  // Health ticks make it possible to judge a kill threshold at a glance.
  if (big && u.stats.maxHp > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    const step = u.isStatic ? 1000 : 200;
    for (let v = step; v < u.stats.maxHp; v += step) {
      const tx2 = x + (v / u.stats.maxHp) * w;
      ctx.beginPath();
      ctx.moveTo(tx2, y);
      ctx.lineTo(tx2, y + h);
      ctx.stroke();
    }
  }

  if (champion) {
    const manaFrac = u.stats.maxMana > 0 ? u.mana / u.stats.maxMana : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - 1, y + h + 1, w + 2, 4);
    ctx.fillStyle = PALETTE.mana;
    ctx.fillRect(x, y + h + 2, w * manaFrac, 3);

    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = friendly ? PALETTE.text : PALETTE.healthEnemy;
    ctx.fillText(`${u.name}`, p.x, y - 6);

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${u.level}`, x - 10, y + h);
  }
}

/* ------------------------------------------------------------------ *
 * Projectiles, zones and one-shot effects
 * ------------------------------------------------------------------ */

function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  projectiles: Projectile[],
  visible: Set<number>,
  team: Team,
): void {
  for (const p of projectiles) {
    if (!camera.isVisible(p.pos, 200)) continue;
    // Enemy projectiles only show where the team has vision.
    if (p.team !== team && !visible.has(p.ownerId)) continue;

    const s = camera.worldToScreen(p.pos);
    const r = Math.max(2.5, p.radius * camera.zoom * 0.55);
    const colour = p.style === 'tower-bolt' ? PALETTE.warning : teamColour(p.team);

    ctx.save();
    ctx.shadowColor = colour;
    ctx.shadowBlur = 12;
    ctx.fillStyle = colour;

    if (p.style === 'auto-bolt' || p.style === 'tower-bolt') {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Ability projectiles get an elongated body so direction is obvious.
      const ang = Math.atan2(-p.dir.y, p.dir.x);
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 2.2, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(-r * 2.4, 0, r * 2.6, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawZones(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  zones: Zone[],
  visible: Set<number>,
  team: Team,
): void {
  for (const z of zones) {
    if (z.style === 'invisible' || z.radius <= 0) continue;
    if (!camera.isVisible(z.pos, z.radius)) continue;
    if (z.team !== team && !visible.has(z.ownerId)) continue;

    const p = camera.worldToScreen(z.pos);
    const r = z.radius * camera.zoom;
    const colour = zoneColour(z.style, z.team);

    const g = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
    g.addColorStop(0, alpha(colour, 0.28));
    g.addColorStop(1, alpha(colour, 0.05));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = alpha(colour, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function zoneColour(style: string, team: number): string {
  switch (style) {
    case 'frost-field':
      return '#5ec8ff';
    case 'flame-wall':
      return '#ff8a3d';
    case 'fog-cloud':
      return '#49e0b0';
    case 'hunt-trap':
      return '#7ef0c8';
    case 'forge-aura':
      return '#e0a44c';
    default:
      return teamColour(team);
  }
}

function drawEffects(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  fx: VisualEffect[],
): void {
  for (const f of fx) {
    if (!camera.isVisible(f.pos, (f.radius ?? 100) + 200)) continue;
    const t = f.age / f.life;
    const p = camera.worldToScreen(f.pos);

    switch (f.style) {
      case 'damage-number':
      case 'gold-number': {
        ctx.save();
        ctx.globalAlpha = 1 - t * t;
        const size = (f.style === 'gold-number' ? 12 : 13) * (f.radius ?? 1);
        ctx.font = `700 ${size * Math.max(0.7, camera.zoom / 0.33)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = f.colour ?? PALETTE.text;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 3;
        const rise = t * 42;
        ctx.strokeText(f.text ?? '', p.x, p.y - 26 - rise);
        ctx.fillText(f.text ?? '', p.x, p.y - 26 - rise);
        ctx.restore();
        break;
      }

      case 'melee-swing':
      case 'slash-line':
      case 'chain-link':
      case 'execute':
      case 'bless':
      case 'hop':
      case 'flash': {
        if (!f.to) break;
        const q = camera.worldToScreen(f.to);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.colour ?? '#ffffff';
        ctx.lineWidth = f.style === 'chain-link' ? 4 : 3;
        ctx.shadowColor = f.colour ?? '#ffffff';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'meteor-telegraph':
      case 'winter-telegraph': {
        const r = (f.radius ?? 200) * camera.zoom;
        ctx.save();
        ctx.strokeStyle = alpha(f.colour ?? PALETTE.danger, 0.9);
        ctx.fillStyle = alpha(f.colour ?? PALETTE.danger, 0.14);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // A filling wedge counts the delay down.
        ctx.fillStyle = alpha(f.colour ?? PALETTE.danger, 0.3);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'cone-slash': {
        const r = (f.radius ?? 400) * camera.zoom;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = alpha(f.colour ?? '#ffffff', 0.3);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, r, -(f.angle ?? 0) - Math.PI / 4, -(f.angle ?? 0) + Math.PI / 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'ping': {
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.colour ?? PALETTE.gold;
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          const rr = (20 + i * 16 + t * 40) * Math.max(0.8, camera.zoom / 0.33);
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }

      case 'level-up': {
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = PALETTE.xp;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (40 + t * 70) * camera.zoom * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }

      default: {
        // Generic expanding ring covers impacts, bursts and auras.
        const r = (f.radius ?? 160) * camera.zoom;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.strokeStyle = f.colour ?? '#ffffff';
        ctx.lineWidth = 3;
        ctx.shadowColor = f.colour ?? '#ffffff';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (0.4 + t * 0.7), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Aiming
 * ------------------------------------------------------------------ */

function drawAimIndicator(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  match: Match,
  state: RenderState,
): void {
  if (!state.aiming) return;
  const caster = match.world.getUnit(state.playerId);
  if (!caster || !caster.alive) return;

  const origin = camera.worldToScreen(caster.pos);
  const range = state.aiming.range * camera.zoom;

  ctx.save();
  ctx.strokeStyle = alpha(PALETTE.gold, 0.5);
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const cursor = camera.worldToScreen(state.cursorWorld);
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const len = Math.hypot(dx, dy) || 1;
  const clampedLen = Math.min(len, range);
  const ux = dx / len;
  const uy = dy / len;

  ctx.fillStyle = alpha(PALETTE.gold, 0.2);
  ctx.strokeStyle = alpha(PALETTE.gold, 0.85);

  if (state.aiming.targeting === 'direction') {
    const width = Math.max(10, state.aiming.width * camera.zoom);
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.beginPath();
    ctx.roundRect(0, -width / 2, clampedLen, width, width / 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (state.aiming.targeting === 'point') {
    const r = Math.max(14, (state.aiming.radius || 180) * camera.zoom);
    const px = origin.x + ux * clampedLen;
    const py = origin.y + uy * clampedLen;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (state.aiming.targeting === 'self') {
    const r = Math.max(20, (state.aiming.radius || 300) * camera.zoom);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
