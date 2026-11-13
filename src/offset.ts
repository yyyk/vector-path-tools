// Curve offsetting with error control, as stroke-outline's
// (stroke-outline/offset.ts): the curve is split at its extrema and where the
// offset folds, then halved until each piece is simple and its offset is
// within the tolerance of the true offset B(t) + d·N(t). The only difference
// is the tolerance: stroke-outline's is relative to the offset distance (for a
// stroke, its width); this one is a distance in path units, as flatten's, and
// can be set.
//
// A point of improvement: the port's construction fixes each piece's ends and
// their directions, and its control points follow from them, so nothing is
// fitted to the true offset. kurbo's offset_cubic (kurbo/src/offset.rs, at
// commit a5f97ff4070773fe01be92c6a607120e49da4e6f) fixes the same ends and
// directions, but fits the lengths of a cubic's two handles: it starts from
// those of an arc between the end normals (draw_arc), then refines them by
// least squares on the error at 8 points (refine_least_squares). Tried here
// for cubic pieces, it took about 30% fewer pieces at the default tolerance
// and half at 1e-6, but each curve took 25-45% longer at 1e-3 and 1e-4 (on
// the cubics of test/fixtures/offset-inputs.txt). A quadratic piece has no
// handle length left to fit.

import { controlPoints, type Curve } from './curve.js';
import type { Point, Segment } from './path.js';
import { splitCubicBezier, splitQuadraticBezier } from './stroke-outline/bezier.js';
import * as so from './stroke-outline/offset.js';

export interface OffsetOptions {
	/**
	 * How far the offset may be from the exact one, in path units (default
	 * 0.25, as flatten's).
	 */
	tolerance?: number;
}

type Quad = [Point, Point, Point];
type Cubic = [Point, Point, Point, Point];

function quadraticOffset(
	p0: Point,
	p1: Point,
	p2: Point,
	distance: number,
	tolerance: number,
): Quad[] {
	if (so.isOnChord(p0, p2, [p1])) return so.offsetQuadraticBezier(p0, p1, p2, distance);
	const size = so.curveSize([p0, p1, p2]);
	if (!(size > 0) || so.isQuadraticDegenerate(p0, p1, p2, size)) return [];

	const curve: Quad = [p0, p1, p2];
	const ts = so.uniqueSortedTs([
		...so.quadraticSplitPoints(p0, p1, p2),
		...so.foldPoints(curve, distance),
	]);
	const result: Quad[] = [];
	for (const part of so.splitCurveAtTs(curve, ts, splitQuadraticBezier))
		so.offsetUntilAccurate(
			part,
			distance,
			tolerance,
			result,
			splitQuadraticBezier,
			c => so.isQuadraticSimple(...c),
			c => so.isQuadraticTooSmallToSubdivide(c, size),
			c => so.offsetQuadratic(...c, distance, size),
		);
	return result;
}

function cubicOffset(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	distance: number,
	tolerance: number,
): Cubic[] {
	if (so.isOnChord(p0, p3, [p1, p2])) return so.offsetCubicBezier(p0, p1, p2, p3, distance);
	const size = so.curveSize([p0, p1, p2, p3]);
	if (!(size > 0) || so.isCubicDegenerate(p0, p1, p2, p3, size)) return [];

	const curve: Cubic = [p0, p1, p2, p3];
	const ts = so.uniqueSortedTs([
		...so.cubicSplitPoints(p0, p1, p2, p3),
		...so.foldPoints(curve, distance),
	]);
	const result: Cubic[] = [];
	for (const part of so.splitCurveAtTs(curve, ts, splitCubicBezier))
		so.offsetUntilAccurate(
			part,
			distance,
			tolerance,
			result,
			splitCubicBezier,
			c => so.isCubicSimple(...c),
			c => so.isCubicTooSmallToSubdivide(c, size),
			c => so.offsetCubic(...c, distance, size),
		);
	return result;
}

/**
 * The curve moved sideways by `distance` at every point: its offset (or
 * parallel) curve, as segments of the same kind, within `options.tolerance`
 * of the exact offset. Positive distances are on the side of the curve's
 * direction turned 90° from x toward y: on the left when y points up, on the
 * right on screen, where y points down. Where the offset folds into a cusp
 * (the distance exceeds the curve's radius of curvature on that side), a
 * segment ends there.
 *
 * At a cusp of the curve itself (where it stops and turns back), the pieces
 * next to it are only halved so far, so very small tolerances may not be
 * reached there.
 *
 * One curve only: offsetting a whole path also needs joins between the curves,
 * which is stroking.
 */
export function offsetCurve(
	curve: Curve,
	distance: number,
	options: OffsetOptions = {},
): Segment[] {
	const p = controlPoints(curve);
	if (!Number.isFinite(distance))
		throw new TypeError(`distance must be a finite number (got ${distance})`);
	const tolerance = options.tolerance ?? 0.25;
	if (!(tolerance > 0) || !Number.isFinite(tolerance))
		throw new RangeError(`tolerance must be a positive number (got ${tolerance})`);

	if (p.length === 2) {
		const dx = p[1].x - p[0].x;
		const dy = p[1].y - p[0].y;
		const len = Math.hypot(dx, dy);
		if (!(len > 0)) return [];
		const n = { x: (-dy / len) * distance, y: (dx / len) * distance };
		const at = (q: Point) => ({ x: q.x + n.x, y: q.y + n.y });
		return [{ type: 'line', p0: at(p[0]), p1: at(p[1]) }];
	}
	if (distance === 0) return [toSegment(p.map(q => ({ ...q })) as Quad | Cubic)];
	const pieces =
		p.length === 3
			? quadraticOffset(p[0], p[1], p[2], distance, tolerance)
			: cubicOffset(p[0], p[1], p[2], p[3], distance, tolerance);
	return pieces.map(toSegment);
}

function toSegment(c: Quad | Cubic): Segment {
	return c.length === 3
		? { type: 'quad', p0: c[0], p1: c[1], p2: c[2] }
		: { type: 'cubic', p0: c[0], p1: c[1], p2: c[2], p3: c[3] };
}
