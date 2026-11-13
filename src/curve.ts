// The point and derivative of one curve at its parameter t, with the same
// evaluation `measure` uses (stroke-outline's, ported in
// stroke-outline/arc-length.ts), so the two always agree.

import type { Point, Segment } from './path.js';
import {
	cubicBezier,
	cubicBezierDerivative,
	quadraticBezier,
	quadraticBezierDerivative,
} from './stroke-outline/arc-length.js';

/**
 * One curve: a segment from `segments()`, or its control points (two for a
 * line, three for a quadratic, four for a cubic).
 */
export type Curve =
	Segment | [Point, Point] | [Point, Point, Point] | [Point, Point, Point, Point];

/** The curve's points, checked: 2, 3 or 4 finite ones. */
export function controlPoints(curve: Curve): Point[] {
	const points = Array.isArray(curve)
		? curve
		: curve.type === 'line'
			? [curve.p0, curve.p1]
			: curve.type === 'quad'
				? [curve.p0, curve.p1, curve.p2]
				: curve.type === 'cubic'
					? [curve.p0, curve.p1, curve.p2, curve.p3]
					: [];
	if (points.length < 2 || points.length > 4)
		throw new TypeError('a curve is a segment, or 2 to 4 control points');
	for (const p of points)
		if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y))
			throw new TypeError(`a curve's points must be finite (got ${JSON.stringify(p)})`);
	return points;
}

function checkT(t: number): number {
	if (!Number.isFinite(t)) throw new TypeError(`t must be a finite number (got ${t})`);
	return Math.min(Math.max(t, 0), 1);
}

/** The point on the curve at its parameter `t` (clamped to 0…1). */
export function curvePoint(curve: Curve, t: number): Point {
	const p = controlPoints(curve);
	t = checkT(t);
	if (p.length === 2) {
		// (1 - t)·p0 + t·p1: exactly p0 and p1 at the ends.
		const u = 1 - t;
		return { x: u * p[0].x + t * p[1].x, y: u * p[0].y + t * p[1].y };
	}
	if (p.length === 3) return quadraticBezier(p[0], p[1], p[2], t);
	return cubicBezier(p[0], p[1], p[2], p[3], t);
}

/**
 * The curve's derivative at its parameter `t` (clamped to 0…1): the direction
 * it runs there, with its speed as the length. `Math.atan2(y, x)` is the
 * angle. Zero where the curve stops, e.g. at a cusp, or at an end whose
 * control point is on it.
 */
export function curveTangent(curve: Curve, t: number): Point {
	const p = controlPoints(curve);
	t = checkT(t);
	if (p.length === 2) return { x: p[1].x - p[0].x, y: p[1].y - p[0].y };
	if (p.length === 3) return quadraticBezierDerivative(p[0], p[1], p[2], t);
	return cubicBezierDerivative(p[0], p[1], p[2], p[3], t);
}
