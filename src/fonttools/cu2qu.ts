// Ported from fontTools (https://github.com/fonttools/fonttools), at commit
// 1ff10daa33d4e40af00a76cda7fa804af4200b30: Lib/fontTools/cu2qu/cu2qu.py
// (curve_to_quadratic and what it uses, with all_quadratic=True) and
// ApproxNotFoundError from Lib/fontTools/cu2qu/errors.py.
// Copyright 2015 Google Inc., Apache License 2.0: see THIRD_PARTY_NOTICES.
// Modified: translated to TypeScript, with Python's complex numbers as { x, y }.

import type { Point } from '../path.js';

const MAX_N = 100;

type Cubic = [Point, Point, Point, Point];

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const abs = (a: Point): number => Math.hypot(a.x, a.y);

export class ApproxNotFoundError extends Error {
	constructor(curve: Cubic) {
		super(`no approximation found: ${JSON.stringify(curve)}`);
		this.name = 'ApproxNotFoundError';
	}
}

/** Return the dot product of two vectors. */
function dot(v1: Point, v2: Point): number {
	let result = v1.x * v2.x + v1.y * v2.y;
	// When vectors are perpendicular (i.e. dot product is 0), the above expression may
	// yield slightly different results when running in pure Python vs C/Cython,
	// both of which are correct within IEEE-754 floating-point precision.
	// It's probably due to the different order of operations and roundings in each
	// implementation. Because we are using the result in a denominator and catching
	// ZeroDivisionError (see `calc_intersect`), it's best to normalize the result here.
	if (Math.abs(result) < 1e-15) result = 0.0;
	return result;
}

/** Divide complex by real using Python's method (two separate divisions). */
function complexDivByReal(z: Point, den: number): Point {
	return { x: z.x / den, y: z.y / den };
}

function calcCubicPoints(a: Point, b: Point, c: Point, d: Point): Cubic {
	const _1 = d;
	const _2 = add(complexDivByReal(c, 3.0), d);
	const _3 = add(complexDivByReal(add(b, c), 3.0), _2);
	const _4 = add(add(add(a, d), c), b);
	return [_1, _2, _3, _4];
}

function calcCubicParameters(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
): [Point, Point, Point, Point] {
	const c = mul(sub(p1, p0), 3.0);
	const b = sub(mul(sub(p2, p1), 3.0), c);
	const d = p0;
	const a = sub(sub(sub(p3, d), c), b);
	return [a, b, c, d];
}

/**
 * Split a cubic Bezier into n equal parts.
 *
 * Splits the curve into `n` equal parts by curve time.
 * (t=0..1/n, t=1/n..2/n, ...)
 */
function splitCubicIntoN(p0: Point, p1: Point, p2: Point, p3: Point, n: number): Cubic[] {
	// Hand-coded special-cases
	if (n === 2) return splitCubicIntoTwo(p0, p1, p2, p3);
	if (n === 3) return splitCubicIntoThree(p0, p1, p2, p3);
	if (n === 4) {
		const [a, b] = splitCubicIntoTwo(p0, p1, p2, p3);
		return [
			...splitCubicIntoTwo(a[0], a[1], a[2], a[3]),
			...splitCubicIntoTwo(b[0], b[1], b[2], b[3]),
		];
	}
	if (n === 6) {
		const [a, b] = splitCubicIntoTwo(p0, p1, p2, p3);
		return [
			...splitCubicIntoThree(a[0], a[1], a[2], a[3]),
			...splitCubicIntoThree(b[0], b[1], b[2], b[3]),
		];
	}
	return splitCubicIntoNGen(p0, p1, p2, p3, n);
}

function splitCubicIntoNGen(p0: Point, p1: Point, p2: Point, p3: Point, n: number): Cubic[] {
	const [a, b, c, d] = calcCubicParameters(p0, p1, p2, p3);
	const dt = 1 / n;
	const delta_2 = dt * dt;
	const delta_3 = dt * delta_2;
	const out: Cubic[] = [];
	for (let i = 0; i < n; i++) {
		const t1 = i * dt;
		const t1_2 = t1 * t1;
		// calc new a, b, c and d
		const a1 = mul(a, delta_3);
		const b1 = mul(add(mul(mul(a, 3), t1), b), delta_2);
		const c1 = mul(add(add(mul(mul(b, 2), t1), c), mul(mul(a, 3), t1_2)), dt);
		const d1 = add(add(add(mul(mul(a, t1), t1_2), mul(b, t1_2)), mul(c, t1)), d);
		out.push(calcCubicPoints(a1, b1, c1, d1));
	}
	return out;
}

/**
 * Split a cubic Bezier into two equal parts.
 *
 * Splits the curve into two equal parts at t = 0.5
 */
function splitCubicIntoTwo(p0: Point, p1: Point, p2: Point, p3: Point): Cubic[] {
	const mid = mul(add(add(p0, mul(add(p1, p2), 3)), p3), 0.125);
	const deriv3 = mul(sub(sub(add(p3, p2), p1), p0), 0.125);
	return [
		[p0, mul(add(p0, p1), 0.5), sub(mid, deriv3), mid],
		[mid, add(mid, deriv3), mul(add(p2, p3), 0.5), p3],
	];
}

/**
 * Split a cubic Bezier into three equal parts.
 *
 * Splits the curve into three equal parts at t = 1/3 and t = 2/3
 */
function splitCubicIntoThree(p0: Point, p1: Point, p2: Point, p3: Point): Cubic[] {
	const mid1 = mul(add(add(add(mul(p0, 8), mul(p1, 12)), mul(p2, 6)), p3), 1 / 27);
	const deriv1 = mul(sub(add(p3, mul(p2, 3)), mul(p0, 4)), 1 / 27);
	const mid2 = mul(add(add(add(p0, mul(p1, 6)), mul(p2, 12)), mul(p3, 8)), 1 / 27);
	const deriv2 = mul(sub(sub(mul(p3, 4), mul(p1, 3)), p0), 1 / 27);
	return [
		[p0, complexDivByReal(add(mul(p0, 2), p1), 3.0), sub(mid1, deriv1), mid1],
		[mid1, add(mid1, deriv1), sub(mid2, deriv2), mid2],
		[mid2, add(mid2, deriv2), complexDivByReal(add(p2, mul(p3, 2)), 3.0), p3],
	];
}

/** Approximate a cubic Bezier using a quadratic one. */
function cubicApproxControl(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
	const _p1 = add(p0, mul(sub(p1, p0), 1.5));
	const _p2 = add(p3, mul(sub(p2, p3), 1.5));
	return add(_p1, mul(sub(_p2, _p1), t));
}

/**
 * Calculate the intersection of two lines.
 *
 * Returns the location of intersection if one present, (NaN, NaN) if no
 * intersection was found.
 */
function calcIntersect(a: Point, b: Point, c: Point, d: Point): Point {
	const ab = sub(b, a);
	const cd = sub(d, c);
	const p = { x: -ab.y, y: ab.x }; // ab * 1j
	const den = dot(p, cd);
	if (den === 0) {
		// if 3 or 4 points are equal, we do have an intersection despite the zero-div:
		// return one of the off-curves so that the algorithm can attempt a one-curve
		// solution if it's within tolerance:
		// https://github.com/linebender/kurbo/pull/484
		const eq = (u: Point, v: Point) => u.x === v.x && u.y === v.y;
		if (eq(b, c) && (eq(a, b) || eq(c, d))) return b;
		return { x: NaN, y: NaN };
	}
	const h = dot(p, sub(a, c)) / den;
	return add(c, mul(cd, h));
}

/**
 * Check if a cubic Bezier lies within a given distance of the origin.
 *
 * "Origin" means *the* origin (0,0), not the start of the curve. Note that no
 * checks are made on the start and end positions of the curve; this function
 * only checks the inside of the curve.
 */
function cubicFarthestFitInside(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	tolerance: number,
): boolean {
	// First check p2 then p1, as p2 has higher error early on.
	if (abs(p2) <= tolerance && abs(p1) <= tolerance) return true;

	// Split.
	const mid = mul(add(add(p0, mul(add(p1, p2), 3)), p3), 0.125);
	if (abs(mid) > tolerance) return false;
	const deriv3 = mul(sub(sub(add(p3, p2), p1), p0), 0.125);
	return (
		cubicFarthestFitInside(p0, mul(add(p0, p1), 0.5), sub(mid, deriv3), mid, tolerance) &&
		cubicFarthestFitInside(mid, add(mid, deriv3), mul(add(p2, p3), 0.5), p3, tolerance)
	);
}

/** Approximate a cubic Bezier with a single quadratic within a given tolerance. */
function cubicApproxQuadratic(cubic: Cubic, tolerance: number): Point[] | null {
	const q1 = calcIntersect(cubic[0], cubic[1], cubic[2], cubic[3]);
	if (Number.isNaN(q1.y)) return null;
	const c0 = cubic[0];
	const c3 = cubic[3];
	const c1 = add(c0, mul(sub(q1, c0), 2 / 3));
	const c2 = add(c3, mul(sub(q1, c3), 2 / 3));
	const origin = { x: 0, y: 0 };
	if (
		!cubicFarthestFitInside(origin, sub(c1, cubic[1]), sub(c2, cubic[2]), origin, tolerance)
	)
		return null;
	return [c0, q1, c3];
}

/**
 * Approximate a cubic Bezier curve with a spline of n quadratics.
 *
 * Returns a list of n+2 points, representing control points of the quadratic
 * spline if it fits within the given tolerance, or null if no suitable spline
 * could be calculated.
 */
export function cubicApproxSpline(cubic: Cubic, n: number, tolerance: number): Point[] | null {
	if (n === 1) return cubicApproxQuadratic(cubic, tolerance);

	const cubics = splitCubicIntoN(cubic[0], cubic[1], cubic[2], cubic[3], n);

	// calculate the spline of quadratics and check errors at the same time.
	let next = 0;
	let nextCubic = cubics[next++];
	let nextQ1 = cubicApproxControl(0, nextCubic[0], nextCubic[1], nextCubic[2], nextCubic[3]);
	let q2 = cubic[0];
	let d1: Point = { x: 0, y: 0 };
	const spline = [cubic[0], nextQ1];
	for (let i = 1; i < n + 1; i++) {
		// Current cubic to convert
		const [, c1, c2, c3] = nextCubic;

		// Current quadratic approximation of current cubic
		const q0 = q2;
		const q1 = nextQ1;
		if (i < n) {
			nextCubic = cubics[next++];
			nextQ1 = cubicApproxControl(
				i / (n - 1),
				nextCubic[0],
				nextCubic[1],
				nextCubic[2],
				nextCubic[3],
			);
			spline.push(nextQ1);
			q2 = mul(add(q1, nextQ1), 0.5);
		} else {
			q2 = c3;
		}

		// End-point deltas
		const d0 = d1;
		d1 = sub(q2, c3);

		if (
			abs(d1) > tolerance ||
			!cubicFarthestFitInside(
				d0,
				sub(add(q0, mul(sub(q1, q0), 2 / 3)), c1),
				sub(add(q2, mul(sub(q1, q2), 2 / 3)), c2),
				d1,
				tolerance,
			)
		)
			return null;
	}
	spline.push(cubic[3]);

	return spline;
}

/**
 * Approximate a cubic Bezier curve with a spline of n quadratics.
 *
 * Returns a list of points representing control points of the quadratic
 * spline (with implied on-curve points midway between consecutive off-curve
 * points). Throws ApproxNotFoundError if no suitable approximation can be
 * found with the given parameters.
 */
export function curveToQuadratic(curve: Cubic, maxErr: number): Point[] {
	for (let n = 1; n < MAX_N + 1; n++) {
		const spline = cubicApproxSpline(curve, n, maxErr);
		if (spline !== null) {
			// done. go home
			return spline;
		}
	}
	throw new ApproxNotFoundError(curve);
}
