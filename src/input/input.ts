/**
 * Mouse and keyboard handling.
 *
 * The scheme follows the genre so nobody has to learn it: right click moves
 * and attacks, QWER cast, Tab shows the scoreboard, B recalls. Abilities arm
 * on key press and fire on left click, with a quick-cast toggle for players
 * who would rather fire straight from the key.
 */

import type { Vec2 } from '../core/math.ts';
import type { AbilityKey } from '../sim/types.ts';
import type { Command } from '../sim/commands.ts';
import type { Camera } from './../render/camera.ts';

export interface InputHooks {
  /** World position under the cursor right now. */
  cursorWorld(): Vec2;
  /** Enemy under the cursor, or -1. A right click only attacks enemies. */
  hoveredEnemy(): number;
  /** Allied champion under the cursor, or -1. Used by ally-targeted spells. */
  hoveredAlly(): number;
  /** How the given ability is aimed, so the cast can pick the right target. */
  abilityTargeting(key: AbilityKey): string;
  /** The slot the local player controls. */
  slot(): number;
  onToggleScoreboard(show: boolean): void;
  onToggleShop(): void;
  onToggleHelp(): void;
  onCentreCamera(): void;
  onMinimapClick(world: Vec2, alt: boolean): void;
  /** Returns true when the ability can currently be armed. */
  canAim(key: AbilityKey): boolean;
  onAimChanged(key: AbilityKey | null): void;
}

const ABILITY_BINDINGS: Record<string, AbilityKey> = {
  KeyQ: 'Q',
  KeyW: 'W',
  KeyE: 'E',
  KeyR: 'R',
};

export class Input {
  quickCast = false;
  aiming: AbilityKey | null = null;
  attackMoveArmed = false;

  private queue: Command[] = [];
  private readonly pressed = new Set<string>();
  private panning = false;
  private lastPan: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly hooks: InputHooks,
  ) {
    this.attach();
  }

  /** Hands the accumulated commands to the caller and clears the queue. */
  drain(): Command[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  private push(cmd: Command): void {
    this.queue.push(cmd);
  }

  /**
   * Picks the unit id a cast should carry. An ally-targeted spell aimed at an
   * enemy would simply fail, so it falls back to the caster instead.
   */
  private castTarget(key: AbilityKey): number {
    return this.hooks.abilityTargeting(key) === 'ally'
      ? this.hooks.hoveredAlly()
      : this.hooks.hoveredEnemy();
  }

  private setAiming(key: AbilityKey | null): void {
    this.aiming = key;
    this.hooks.onAimChanged(key);
  }

  private attach(): void {
    const canvas = this.canvas;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
      const slot = this.hooks.slot();
      if (slot < 0) return;
      const world = this.hooks.cursorWorld();

      // Middle button drags the camera.
      if (e.button === 1) {
        this.panning = true;
        this.lastPan = { x: e.clientX, y: e.clientY };
        this.camera.locked = false;
        e.preventDefault();
        return;
      }

      if (e.button === 2) {
        // Right click cancels an aim rather than issuing a move, which is what
        // everyone expects and prevents a misclick walking you into a fight.
        if (this.aiming) {
          this.setAiming(null);
          return;
        }
        this.attackMoveArmed = false;
        // Only an enemy turns a right click into an attack. Anything else -
        // an ally, a structure of ours, empty ground - is a move order, which
        // is what makes right click feel reliable.
        const target = this.hooks.hoveredEnemy();
        if (target >= 0) this.push({ t: 'attackUnit', slot, target });
        else this.push({ t: 'move', slot, x: world.x, y: world.y });
        return;
      }

      if (e.button === 0) {
        if (this.aiming) {
          const key = this.aiming;
          this.setAiming(null);
          this.push({ t: 'cast', slot, key, x: world.x, y: world.y, target: this.castTarget(key) });
          return;
        }
        if (this.attackMoveArmed) {
          this.attackMoveArmed = false;
          this.push({ t: 'attackMove', slot, x: world.x, y: world.y });
          return;
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.panning = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.panning) return;
      this.camera.pan(e.clientX - this.lastPan.x, e.clientY - this.lastPan.y);
      this.lastPan = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      // Never swallow typing in a form control.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const slot = this.hooks.slot();
      if (this.pressed.has(e.code)) return;
      this.pressed.add(e.code);

      const ability = ABILITY_BINDINGS[e.code];
      if (ability && slot >= 0) {
        e.preventDefault();
        if (e.ctrlKey || e.shiftKey) {
          this.push({ t: 'levelUp', slot, key: ability });
          return;
        }
        if (!this.hooks.canAim(ability)) return;
        const world = this.hooks.cursorWorld();
        if (this.quickCast) {
          this.push({
            t: 'cast',
            slot,
            key: ability,
            x: world.x,
            y: world.y,
            target: this.castTarget(ability),
          });
        } else {
          this.setAiming(this.aiming === ability ? null : ability);
        }
        return;
      }

      switch (e.code) {
        case 'KeyA':
          if (slot >= 0) this.attackMoveArmed = true;
          break;
        case 'KeyS':
          if (slot >= 0) this.push({ t: 'stop', slot });
          this.setAiming(null);
          break;
        case 'KeyB':
          if (slot >= 0) this.push({ t: 'recall', slot });
          break;
        case 'KeyD': {
          if (slot < 0) break;
          const w = this.hooks.cursorWorld();
          this.push({ t: 'flash', slot, x: w.x, y: w.y });
          break;
        }
        case 'KeyF':
          if (slot >= 0) this.push({ t: 'heal', slot });
          break;
        case 'KeyG': {
          if (slot < 0) break;
          const w = this.hooks.cursorWorld();
          this.push({ t: 'ping', slot, x: w.x, y: w.y, kind: 0 });
          break;
        }
        case 'KeyP':
          this.hooks.onToggleShop();
          break;
        case 'KeyY':
          this.camera.locked = !this.camera.locked;
          break;
        case 'Space':
          e.preventDefault();
          this.camera.locked = true;
          this.hooks.onCentreCamera();
          break;
        case 'Tab':
          e.preventDefault();
          this.hooks.onToggleScoreboard(true);
          break;
        case 'F1':
          e.preventDefault();
          this.hooks.onToggleHelp();
          break;
        case 'Escape':
          this.setAiming(null);
          this.attackMoveArmed = false;
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.pressed.delete(e.code);
      if (e.code === 'Tab') this.hooks.onToggleScoreboard(false);
    });

    // Releasing focus must not leave keys stuck down.
    window.addEventListener('blur', () => {
      this.pressed.clear();
      this.panning = false;
    });
  }

  /** Wires a minimap canvas for click-to-move and alt-click-to-ping. */
  attachMinimap(canvas: HTMLCanvasElement, toWorld: (x: number, y: number) => Vec2): void {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const world = toWorld(e.clientX, e.clientY);
      this.hooks.onMinimapClick(world, e.button === 0 && !e.shiftKey ? false : true);
      const slot = this.hooks.slot();
      if (slot < 0) return;
      if (e.button === 2) this.push({ t: 'move', slot, x: world.x, y: world.y });
      else if (e.shiftKey) this.push({ t: 'ping', slot, x: world.x, y: world.y, kind: 1 });
    });
  }
}
