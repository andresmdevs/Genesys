/** Small, allocation-conscious 2D math used by the simulation and the renderer. */

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const clone = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const lenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export const distSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Returns a unit vector, or (0,0) when the input has no direction. */
export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-6 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Unit vector pointing from `a` to `b`. */
export function dir(a: Vec2, b: Vec2): Vec2 {
  return normalize({ x: b.x - a.x, y: b.y - a.y });
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x);
export const fromAngle = (a: number, r = 1): Vec2 => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rotateTowards(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  return Math.abs(d) <= maxStep ? to : from + Math.sign(d) * maxStep;
}

/** Squared distance from point `p` to the segment `a`-`b`. */
export function distSqToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq < 1e-9) return apx * apx + apy * apy;
  const t = clamp((apx * abx + apy * aby) / abLenSq, 0, 1);
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  return dx * dx + dy * dy;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq < 1e-9) return clone(a);
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / abLenSq, 0, 1);
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Point-in-axis-aligned-rectangle, where the rect is stored as min/max corners. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const rectContains = (r: Rect, p: Vec2): boolean =>
  p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/** True when a circle overlaps a cone originating at `apex` facing `facing`. */
export function circleInCone(
  apex: Vec2,
  facing: number,
  halfAngle: number,
  range: number,
  target: Vec2,
  targetRadius: number,
): boolean {
  const dx = target.x - apex.x;
  const dy = target.y - apex.y;
  const d = Math.hypot(dx, dy);
  if (d > range + targetRadius) return false;
  if (d < 1e-6) return true;
  const ang = Math.atan2(dy, dx);
  const delta = Math.abs(angleDelta(facing, ang));
  // Widen the cone near the apex so large units touching the caster still register.
  const slack = Math.atan2(targetRadius, Math.max(d, 1));
  return delta <= halfAngle + slack;
}

/** True when a circle of radius `r` overlaps the capsule a-b of radius `w`. */
export function circleHitsCapsule(p: Vec2, r: number, a: Vec2, b: Vec2, w: number): boolean {
  const limit = r + w;
  return distSqToSegment(p, a, b) <= limit * limit;
}
