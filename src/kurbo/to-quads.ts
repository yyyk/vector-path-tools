// Ported from kurbo (https://github.com/linebender/kurbo), at commit
// a5f97ff4070773fe01be92c6a607120e49da4e6f: CubicBez::to_quads and its ToQuads
// iterator, CubicBez::eval, CubicBez::deriv and CubicBez::subsegment in
// kurbo/src/cubicbez.rs, and QuadBez::eval in kurbo/src/quadbez.rs.
// Copyright (c) 2018 Raph Levien, MIT license: see THIRD_PARTY_NOTICES.

import type { Point } from '../path.js';

type Cubic = [Point, Point, Point, Point];
type Quad = [Point, Point, Point];

function cubicEval(c: Cubic, t: number): Point {
	const mt = 1 - t;
	const [p0, p1, p2, p3] = c;
	return {
		x:
			p0.x * (mt * mt * mt) +
			(p1.x * (mt * mt * 3) + (p2.x * (mt * 3) + p3.x * t) * t) * t,
		y:
			p0.y * (mt * mt * mt) +
			(p1.y * (mt * mt * 3) + (p2.y * (mt * 3) + p3.y * t) * t) * t,
	};
}

function deriv(c: Cubic): Quad {
	const [p0, p1, p2, p3] = c;
	return [
		{ x: 3 * (p1.x - p0.x), y: 3 * (p1.y - p0.y) },
		{ x: 3 * (p2.x - p1.x), y: 3 * (p2.y - p1.y) },
		{ x: 3 * (p3.x - p2.x), y: 3 * (p3.y - p2.y) },
	];
}

export function quadEval(q: Quad, t: number): Point {
	const mt = 1 - t;
	const [p0, p1, p2] = q;
	return {
		x: p0.x * (mt * mt) + (p1.x * (mt * 2) + p2.x * t) * t,
		y: p0.y * (mt * mt) + (p1.y * (mt * 2) + p2.y * t) * t,
	};
}

function subsegment(c: Cubic, t0: number, t1: number): Cubic {
	const p0 = cubicEval(c, t0);
	const p3 = cubicEval(c, t1);
	const d = deriv(c);
	const scale = (t1 - t0) * (1 / 3);
	const d0 = quadEval(d, t0);
	const d1 = quadEval(d, t1);
	const p1 = { x: p0.x + scale * d0.x, y: p0.y + scale * d0.y };
	const p2 = { x: p3.x - scale * d1.x, y: p3.y - scale * d1.y };
	return [p0, p1, p2, p3];
}

/**
 * Converts to a sequence of quadratic Béziers ([p0, p1, p2] each), with the
 * start and end parameter in the cubic of each.
 *
 * Note that the resulting quadratic Béziers are not in general G1 continuous;
 * they are optimized for minimizing distance error.
 *
 * This always produces at least one quadratic.
 */
export function toQuads(c: Cubic, accuracy: number): [number, number, Quad][] {
	// The maximum error, as a vector from the cubic to the best approximating
	// quadratic, is proportional to the third derivative, which is constant
	// across the segment. Thus, the error scales down as the third power of
	// the number of subdivisions. Our strategy then is to subdivide `t` evenly.
	//
	// This is an overestimate of the error because only the component
	// perpendicular to the first derivative is important. But the simplicity is
	// appealing.

	// This magic number is the square of 36 / sqrt(3).
	// See: http://caffeineowl.com/graphics/2d/vectorial/cubic2quad01.html
	const maxHypot2 = 432 * accuracy * accuracy;
	const [p0, p1, p2, p3] = c;
	const p1x2 = { x: 3 * p1.x - p0.x, y: 3 * p1.y - p0.y };
	const p2x2 = { x: 3 * p2.x - p3.x, y: 3 * p2.y - p3.y };
	const ex = p2x2.x - p1x2.x;
	const ey = p2x2.y - p1x2.y;
	const err = ex * ex + ey * ey;
	// Rust's `as usize` turns NaN into 0; then `.max(1)`.
	const count = Math.ceil(Math.pow(err / maxHypot2, 1 / 6));
	const n = Math.max(Number.isNaN(count) ? 0 : count, 1);

	const out: [number, number, Quad][] = [];
	for (let i = 0; i < n; i++) {
		const t0 = i / n;
		const t1 = (i + 1) / n;
		const seg = subsegment(c, t0, t1);
		const s1x2 = { x: 3 * seg[1].x - seg[0].x, y: 3 * seg[1].y - seg[0].y };
		const s2x2 = { x: 3 * seg[2].x - seg[3].x, y: 3 * seg[2].y - seg[3].y };
		out.push([
			t0,
			t1,
			[seg[0], { x: (s1x2.x + s2x2.x) / 4, y: (s1x2.y + s2x2.y) / 4 }, seg[3]],
		]);
	}
	return out;
}
