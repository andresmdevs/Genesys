import { clamp, type Vec2 } from '../core/math.ts';
import { MAP_SIZE } from '../data/map.ts';

/**
 * Maps world space to screen space. The camera follows the player's champion
 * unless the player drags it away, and snaps back on demand - the behaviour
 * every game in the genre uses.
 */
export class Camera {
  /** Centre of the view in world coordinates. */
  pos: Vec2 = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
  /** Screen pixels per world unit. */
  zoom = 0.30;
  locked = true;

  /** Backing-store size in device pixels. */
  viewWidth = 1280;
  viewHeight = 720;
  /** Device pixels per CSS pixel, so callers can convert pointer positions. */
  pixelRatio = 1;

  private readonly minZoom = 0.14;
  private readonly maxZoom = 0.62;

  resize(width: number, height: number, pixelRatio = 1): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.pixelRatio = pixelRatio;
  }

  /** Converts a CSS-pixel pointer position into world space. */
  pointerToWorld(cssX: number, cssY: number): Vec2 {
    return this.screenToWorld({ x: cssX * this.pixelRatio, y: cssY * this.pixelRatio });
  }

  follow(target: Vec2, smoothing = 0.18): void {
    if (!this.locked) return;
    this.pos.x += (target.x - this.pos.x) * smoothing;
    this.pos.y += (target.y - this.pos.y) * smoothing;
  }

  snapTo(target: Vec2): void {
    this.pos.x = target.x;
    this.pos.y = target.y;
  }

  /** Pans by a delta given in CSS pixels. */
  pan(dxScreen: number, dyScreen: number): void {
    this.pos.x -= (dxScreen * this.pixelRatio) / this.zoom;
    // Screen y grows downward while world y grows upward.
    this.pos.y += (dyScreen * this.pixelRatio) / this.zoom;
    this.clampToMap();
  }

  zoomBy(factor: number): void {
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
  }

  clampToMap(): void {
    const halfW = this.viewWidth / 2 / this.zoom;
    const halfH = this.viewHeight / 2 / this.zoom;
    // Allow a little overscan so the map edge is reachable.
    const pad = 600;
    this.pos.x = clamp(this.pos.x, -pad + halfW * 0.2, MAP_SIZE + pad - halfW * 0.2);
    this.pos.y = clamp(this.pos.y, -pad + halfH * 0.2, MAP_SIZE + pad - halfH * 0.2);
  }

  worldToScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.pos.x) * this.zoom + this.viewWidth / 2,
      y: (this.pos.y - p.y) * this.zoom + this.viewHeight / 2,
    };
  }

  screenToWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.viewWidth / 2) / this.zoom + this.pos.x,
      y: this.pos.y - (p.y - this.viewHeight / 2) / this.zoom,
    };
  }

  /** World-space rectangle currently on screen, with a margin for culling. */
  viewBounds(margin = 400): { x0: number; y0: number; x1: number; y1: number } {
    const halfW = this.viewWidth / 2 / this.zoom + margin;
    const halfH = this.viewHeight / 2 / this.zoom + margin;
    return {
      x0: this.pos.x - halfW,
      y0: this.pos.y - halfH,
      x1: this.pos.x + halfW,
      y1: this.pos.y + halfH,
    };
  }

  isVisible(p: Vec2, radius = 0): boolean {
    const b = this.viewBounds(radius + 200);
    return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
  }
}
