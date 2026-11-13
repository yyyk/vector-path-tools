// Ported from stroke-outline (https://github.com/yyyk/stroke-outline), at commit
// 084fd2ca8eb0065951b240a917df5d8d2e616bfd: split_quadratic_bezier and
// split_cubic_bezier in src/bezier/bezier.hpp, and Vec2::lerp in
// src/stroke_outline/Vec2.hpp. Same author and license as this package.
//
// The C++ asserts that t is in 0…1, then clamps it; this clamps only.

import type { Point } from '../path.js';

type Quad = [Point, Point, Point];
type Cubic = [Point, Point, Point, Point];

const lerp = (a: Point, b: Point, t: number): Point => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

export function splitQuadraticBezier(curve: Quad, t: number): [Quad, Quad] {
	t = Math.min(Math.max(t, 0.0), 1.0);
	const [p0, p1, p2] = curve;

	const a = lerp(p0, p1, t);
	const b = lerp(p1, p2, t);
	const c = lerp(a, b, t);

	return [
		[p0, a, c],
		[c, b, p2],
	];
}

export function splitCubicBezier(curve: Cubic, t: number): [Cubic, Cubic] {
	t = Math.min(Math.max(t, 0.0), 1.0);
	const [p0, p1, p2, p3] = curve;

	const a = lerp(p0, p1, t);
	const b = lerp(p1, p2, t);
	const c = lerp(p2, p3, t);

	const d = lerp(a, b, t);
	const e = lerp(b, c, t);

	const f = lerp(d, e, t);

	return [
		[p0, a, d, f],
		[f, e, c, p3],
	];
}
