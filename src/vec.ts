// Point arithmetic for intersect.ts and boolean-op.ts. The ports keep their
// own copies, as their sources have them.

import type { Point } from './path.js';

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (v: Point, s: number): Point => ({ x: v.x * s, y: v.y * s });
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const length = (v: Point) => Math.hypot(v.x, v.y);
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});
/** Whether a and b are within eps of each other. */
export const near = (a: Point, b: Point, eps: number) => {
	const d = sub(a, b);
	return dot(d, d) <= eps * eps;
};
export const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
