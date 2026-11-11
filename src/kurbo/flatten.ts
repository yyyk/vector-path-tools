// Ported from kurbo (https://github.com/linebender/kurbo), at commit
// a5f97ff4070773fe01be92c6a607120e49da4e6f: kurbo/src/quadbez.rs
// (estimate_subdiv, determine_subdiv_t, approx_parabola_integral,
// approx_parabola_inv_integral) and the quadratic and cubic cases of flatten
// in kurbo/src/bezpath.rs. Copyright (c) 2018 Raph Levien, MIT license: see
// THIRD_PARTY_NOTICES.
//
// From kurbo's flatten:
//
//   This algorithm is based on the blog post [Flattening quadratic Béziers]
//   but with some refinements. For one, there is a more careful approximation
//   at cusps. For two, the algorithm is extended to work with cubic Béziers
//   as well, by first subdividing into quadratics and then computing the
//   subdivision of each quadratic. However, as a clever trick, these quadratics
//   are subdivided fractionally, and their endpoints are not included.
//
//   [Flattening quadratic Béziers]: https://raphlinus.github.io/graphics/curves/2019/12/23/flatten-quadbez.html

import { quadEval, toQuads } from './to-quads.js';
import type { Point, Sample } from '../path.js';

type Quad = [Point, Point, Point];

export interface FlattenParams {
	a0: number;
	a2: number;
	u0: number;
	uscale: number;
	/** The number of `subdivisions * 2 * sqrt_tol`. */
	val: number;
}

/** Rust's f64::signum: +0 is 1 and −0 is −1, unlike Math.sign. */
function signum(x: number): number {
	if (x > 0 || Object.is(x, 0)) return 1;
	if (x < 0 || Object.is(x, -0)) return -1;
	return NaN;
}

/** Estimate the number of subdivisions for flattening. */
export function estimateSubdiv(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	sqrtTol: number,
): FlattenParams {
	// Determine transformation to $y = x^2$ parabola.
	const d01x = x1 - x0;
	const d01y = y1 - y0;
	const d12x = x2 - x1;
	const d12y = y2 - y1;
	const ddx = d01x - d12x;
	const ddy = d01y - d12y;
	const cross = (x2 - x0) * ddy - (y2 - y0) * ddx;
	const px0 = (d01x * ddx + d01y * ddy) * (1 / cross);
	const px2 = (d12x * ddx + d12y * ddy) * (1 / cross);
	const scale = Math.abs(cross / (Math.sqrt(ddx * ddx + ddy * ddy) * (px2 - px0)));

	// Compute number of subdivisions needed.
	const a0 = approxParabolaIntegral(px0);
	const a2 = approxParabolaIntegral(px2);
	let val: number;
	if (Number.isFinite(scale)) {
		const da = Math.abs(a2 - a0);
		const sqrtScale = Math.sqrt(scale);
		if (signum(px0) === signum(px2)) {
			val = da * sqrtScale;
		} else {
			// Handle cusp case (segment contains curvature maximum)
			const xmin = sqrtTol / sqrtScale;
			val = (sqrtTol * da) / approxParabolaIntegral(xmin);
		}
	} else {
		val = 0;
	}
	const u0 = approxParabolaInvIntegral(a0);
	const u2 = approxParabolaInvIntegral(a2);
	const uscale = 1 / (u2 - u0);
	return { a0, a2, u0, uscale, val };
}

// Maps a value from 0..1 to 0..1.
export function determineSubdivT(params: FlattenParams, x: number): number {
	const a = params.a0 + (params.a2 - params.a0) * x;
	const u = approxParabolaInvIntegral(a);
	return (u - params.u0) * params.uscale;
}

/** An approximation to $\int (1 + 4x^2) ^ -0.25 dx$ */
function approxParabolaIntegral(x: number): number {
	const D = 0.67;
	return x / (1 - D + Math.sqrt(Math.sqrt(D ** 4 + 0.25 * x * x)));
}

/** An approximation to the inverse parabola integral. */
function approxParabolaInvIntegral(x: number): number {
	const B = 0.39;
	return x * (1 - B + Math.sqrt(B * B + 0.25 * x * x));
}

/**
 * The quadratic case of kurbo's flatten: the points strictly inside the curve
 * (control points xs, ys) where it is cut into lines.
 */
export function adaptiveQuadratic(xs: number[], ys: number[], tolerance: number): Sample[] {
	const sqrtTol = Math.sqrt(tolerance);
	const params = estimateSubdiv(xs[0], ys[0], xs[1], ys[1], xs[2], ys[2], sqrtTol);
	// Rust's `as usize` turns NaN into 0; then `.max(1)`.
	const count = Math.ceil((0.5 * params.val) / sqrtTol);
	const n = Math.max(Number.isNaN(count) ? 0 : count, 1);
	const q: Quad = [
		{ x: xs[0], y: ys[0] },
		{ x: xs[1], y: ys[1] },
		{ x: xs[2], y: ys[2] },
	];
	const out: Sample[] = [];
	const step = 1.0 / n;
	for (let i = 1; i < n; i++) {
		const u = i * step;
		const t = determineSubdivT(params, u);
		out.push({ t, ...quadEval(q, t) });
	}
	return out;
}

/** Proportion of tolerance budget that goes to cubic to quadratic conversion. */
const TO_QUAD_TOL = 0.1;

/**
 * The cubic case of kurbo's flatten: the points strictly inside the curve
 * (control points xs, ys) where it is cut into lines, with their parameter on
 * the cubic.
 */
export function adaptiveCubic(xs: number[], ys: number[], tolerance: number): Sample[] {
	const sqrtTol = Math.sqrt(tolerance);
	const c = xs.map((x, i) => ({ x, y: ys[i] })) as [Point, Point, Point, Point];

	// Subdivide into quadratics, and estimate the number of
	// subdivisions required for each, summing to arrive at an
	// estimate for the number of subdivisions for the cubic.
	// Also retain these parameters for later.
	const quadBuf: [number, number, Quad, FlattenParams][] = [];
	const sqrtRemainTol = sqrtTol * Math.sqrt(1.0 - TO_QUAD_TOL);
	let sum = 0.0;
	for (const [t0, t1, q] of toQuads(c, tolerance * TO_QUAD_TOL)) {
		const params = estimateSubdiv(
			q[0].x,
			q[0].y,
			q[1].x,
			q[1].y,
			q[2].x,
			q[2].y,
			sqrtRemainTol,
		);
		sum += params.val;
		quadBuf.push([t0, t1, q, params]);
	}
	// Rust's `as usize` turns NaN into 0; then `.max(1)`.
	const count = Math.ceil((0.5 * sum) / sqrtRemainTol);
	const n = Math.max(Number.isNaN(count) ? 0 : count, 1);

	// Iterate through the quadratics, outputting the points of
	// subdivisions that fall within that quadratic.
	const out: Sample[] = [];
	const step = sum / n;
	let i = 1;
	let valSum = 0.0;
	for (const [t0, t1, q, params] of quadBuf) {
		let target = i * step;
		const recipVal = 1 / params.val;
		while (target < valSum + params.val) {
			const u = (target - valSum) * recipVal;
			const t = determineSubdivT(params, u);
			out.push({ t: t0 + (t1 - t0) * t, ...quadEval(q, t) });
			i += 1;
			if (i === n + 1) break;
			target = i * step;
		}
		valSum += params.val;
	}
	return out;
}
