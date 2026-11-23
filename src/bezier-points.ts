// A curve as its control points (2 for a line, 3 for a quadratic, 4 for a
// cubic), and what intersect.ts and boolean-op.ts do with one curve: evaluate
// it, cut a piece out, find a point's parameter, its direction, its box.

import type { Point, Segment } from './path.js';
import { cubicBezier, quadraticBezier } from './stroke-outline/arc-length.js';
import { solveCubic } from './stroke-outline/intersect.js';
import { add, clamp01, distance, dot, lerp, mul, sub } from './vec.js';

/** Control points: 2 for a line, 3 for a quadratic, 4 for a cubic. */
export type Bezier = Point[];

export const toBezier = (s: Segment): Bezier =>
	s.type === 'line'
		? [s.p0, s.p1]
		: s.type === 'quad'
			? [s.p0, s.p1, s.p2]
			: [s.p0, s.p1, s.p2, s.p3];

export const end = (e: Bezier) => e[e.length - 1];
export const reversed = (e: Bezier): Bezier => [...e].reverse();

export function evaluate(p: Bezier, t: number): Point {
	if (p.length === 2) {
		// (1 - t)·p0 + t·p1: exactly p0 and p1 at the ends, as curvePoint.
		const u = 1 - t;
		return { x: u * p[0].x + t * p[1].x, y: u * p[0].y + t * p[1].y };
	}
	if (p.length === 3) return quadraticBezier(p[0], p[1], p[2], t);
	return cubicBezier(p[0], p[1], p[2], p[3], t);
}

/** Power-basis coefficients [a, b, c, d]: B(t) = a·t³ + b·t² + c·t + d. */
export function powerBasis(p: Bezier): [Point, Point, Point, Point] {
	const zero = { x: 0, y: 0 };
	if (p.length === 2) return [zero, zero, sub(p[1], p[0]), p[0]];
	if (p.length === 3)
		return [zero, add(sub(p[0], mul(p[1], 2)), p[2]), mul(sub(p[1], p[0]), 2), p[0]];
	const [p0, p1, p2, p3] = p;
	return [
		add(sub(mul(sub(p1, p2), 3), p0), p3),
		mul(add(sub(p0, mul(p1, 2)), p2), 3),
		mul(sub(p1, p0), 3),
		p0,
	];
}

/** The piece of the curve from t0 to t1, which may be in either order. */
export function subCurve(p: Bezier, t0: number, t1: number): Bezier {
	const split = (q: Bezier, t: number): [Bezier, Bezier] => {
		const left = [q[0]];
		const right = [q[q.length - 1]];
		let level = q;
		while (level.length > 1) {
			const next: Point[] = [];
			for (let i = 0; i + 1 < level.length; i++)
				next.push(lerp(level[i], level[i + 1], t));
			left.push(next[0]);
			right.unshift(next[next.length - 1]);
			level = next;
		}
		return [left, right];
	};
	const lo = Math.min(t0, t1);
	const hi = Math.max(t0, t1);
	let piece = hi < 1 ? split(p, hi)[0] : p;
	if (lo > 0) piece = split(piece, lo / hi)[1];
	return t0 <= t1 ? piece : [...piece].reverse();
}

/** The parameter of the point on the curve within `eps` of `p`, or null. */
export function parameterOf(p: Bezier, point: Point, eps: number): number | null {
	const [a, b, c, d] = powerBasis(p);
	const candidates = [0, 1];
	for (const axis of ['x', 'y'] as const)
		candidates.push(
			...solveCubic(a[axis], b[axis], c[axis], d[axis] - point[axis], [0, 1]),
		);

	let best: number | null = null;
	let bestDistance = Infinity;
	for (let t of candidates) {
		// Newton's method on (B(t) - point)·B'(t) = 0, the nearest point.
		for (let i = 0; i < 4; i++) {
			const q = sub(evaluate(p, t), point);
			const d1 = add(add(mul(a, 3 * t * t), mul(b, 2 * t)), c);
			const d2 = add(mul(a, 6 * t), mul(b, 2));
			const f = dot(q, d1);
			const df = dot(d1, d1) + dot(q, d2);
			if (!(Math.abs(df) > 0)) break;
			t = clamp01(t - f / df);
		}
		const gap = distance(evaluate(p, t), point);
		if (gap < bestDistance) {
			bestDistance = gap;
			best = t;
		}
	}
	return bestDistance <= eps ? best : null;
}

/** Direction of travel along an edge at parameter t (not normalized). */
export function tangent(e: Bezier, t: number): Point {
	const n = e.length - 1;
	if (n === 1) return sub(e[1], e[0]);
	// The derivative's control points, evaluated at t.
	const d: Point[] = [];
	for (let i = 0; i < n; i++)
		d.push({ x: n * (e[i + 1].x - e[i].x), y: n * (e[i + 1].y - e[i].y) });
	const v = d.length === 2 ? lerp(d[0], d[1], t) : evaluate(d, t);
	// At a cusp-like end the derivative vanishes; the chord still points the way.
	return v.x !== 0 || v.y !== 0 ? v : sub(end(e), e[0]);
}

// Control-point bounds (a curve lies inside its control polygon), grown by
// `margin`.
export function controlBox(p: Bezier, margin: number) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const q of p) {
		minX = Math.min(minX, q.x);
		minY = Math.min(minY, q.y);
		maxX = Math.max(maxX, q.x);
		maxY = Math.max(maxY, q.y);
	}
	return {
		minX: minX - margin,
		minY: minY - margin,
		maxX: maxX + margin,
		maxY: maxY + margin,
	};
}

export type Box = ReturnType<typeof controlBox>;
export const boxesTouch = (a: Box, b: Box) =>
	a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
