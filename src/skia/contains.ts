// Ported from Skia (https://skia.googlesource.com/skia), at commit
// 50ba8e6d82572c55b146d8c802fe1fc14d47ca1c: SkPathPriv::Contains and its
// helpers in src/core/SkPathPriv.cpp, SkPathEdgeIter in src/core/SkPathPriv.h,
// SkFindUnitQuadRoots, SkChopQuadAt, SkChopQuadAtYExtrema, SkEvalQuadTangentAt,
// SkFindCubicExtrema, SkChopCubicAt, SkChopCubicAtYExtrema and SkEvalCubicAt
// (its tangent) in src/core/SkGeometry.cpp, SkCubicClipper::ChopMonoAtY (its
// bisection, the compiled branch) in src/core/SkCubicClipper.cpp, and
// SkScalarNearlyZero, SkScalarNearlyEqual and SkScalarSignAsInt in
// include/core/SkScalar.h. Copyright 2006 The Android Open Source Project and
// Google LLC. Use of this source code is governed by a BSD-style license: see
// THIRD_PARTY_NOTICES.
//
// Skia computes in 32-bit floats; this port uses 64-bit numbers. Conics and
// inverse fill types are left out. Checked against Skia's own SkPath::contains
// (test/fixtures/skia.json).

import type { PathCommand, Point } from '../path.js';

// ---------- include/core/SkScalar.h ----------

const SK_ScalarNearlyZero = 1 / (1 << 12);

function SkScalarNearlyZero(x: number, tolerance = SK_ScalarNearlyZero): boolean {
	return Math.abs(x) <= tolerance;
}

function SkScalarNearlyEqual(x: number, y: number, tolerance = SK_ScalarNearlyZero): boolean {
	return Math.abs(x - y) <= tolerance;
}

function SkScalarSignAsInt(x: number): number {
	return x < 0 ? -1 : x > 0 ? 1 : 0;
}

/** Linearly interpolate between A and B, based on t. */
function SkScalarInterp(A: number, B: number, t: number): number {
	return A + (B - A) * t;
}

const pointsEqual = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

// ---------- src/core/SkGeometry.cpp ----------

function is_not_monotonic(a: number, b: number, c: number): boolean {
	const ab = a - b;
	let bc = b - c;
	if (ab < 0) {
		bc = -bc;
	}
	return ab === 0 || bc < 0;
}

/** The ratio numer/denom if it is in (0, 1), else undefined. */
function valid_unit_divide(numer: number, denom: number): number | undefined {
	if (numer < 0) {
		numer = -numer;
		denom = -denom;
	}

	if (denom === 0 || numer === 0 || numer >= denom) {
		return undefined;
	}

	const r = numer / denom;
	if (Number.isNaN(r)) {
		return undefined;
	}
	if (r === 0) {
		// catch underflow if numer <<<< denom
		return undefined;
	}
	return r;
}

/**
 * From Numerical Recipes in C.
 *
 *   Q = -1/2 (B + sign(B) sqrt[B*B - 4*A*C])
 *   x1 = Q / A
 *   x2 = C / Q
 */
function SkFindUnitQuadRoots(A: number, B: number, C: number): number[] {
	const roots: number[] = [];
	const push = (r: number | undefined) => {
		if (r !== undefined) roots.push(r);
	};

	if (A === 0) {
		push(valid_unit_divide(-C, B));
		return roots;
	}

	let dr = B * B - 4 * A * C;
	if (dr < 0) {
		return roots;
	}
	dr = Math.sqrt(dr);
	const R = dr;
	if (!Number.isFinite(R)) {
		return roots;
	}

	const Q = B < 0 ? -(B - R) / 2 : -(B + R) / 2;
	push(valid_unit_divide(Q, A));
	push(valid_unit_divide(C, Q));
	if (roots.length === 2) {
		if (roots[0] > roots[1]) {
			[roots[0], roots[1]] = [roots[1], roots[0]];
		} else if (roots[0] === roots[1]) {
			// nearly-equal?
			roots.pop(); // skip the double root
		}
	}
	return roots;
}

function SkEvalQuadTangentAt(src: Point[], t: number): Point {
	// The derivative equation is 2(b - a +(a - 2b +c)t). This returns a
	// zero tangent vector when t is 0 or 1, and the control point is equal
	// to the end point. In this case, use the quad end points to compute the tangent.
	if ((t === 0 && pointsEqual(src[0], src[1])) || (t === 1 && pointsEqual(src[1], src[2]))) {
		return { x: src[2].x - src[0].x, y: src[2].y - src[0].y };
	}

	const Bx = src[1].x - src[0].x;
	const By = src[1].y - src[0].y;
	const Ax = src[2].x - src[1].x - Bx;
	const Ay = src[2].y - src[1].y - By;
	const Tx = Ax * t + Bx;
	const Ty = Ay * t + By;

	return { x: Tx + Tx, y: Ty + Ty };
}

const interp = (v0: number, v1: number, t: number) => v0 + (v1 - v0) * t;

function SkChopQuadAt(src: Point[], t: number): Point[] {
	const p01 = { x: interp(src[0].x, src[1].x, t), y: interp(src[0].y, src[1].y, t) };
	const p12 = { x: interp(src[1].x, src[2].x, t), y: interp(src[1].y, src[2].y, t) };

	return [
		src[0],
		p01,
		{ x: interp(p01.x, p12.x, t), y: interp(p01.y, p12.y, t) },
		p12,
		src[2],
	];
}

/**
 * Returns 0 for 1 quad, and 1 for two quads, either way the answer is
 * stored in dst[]. Guarantees that the 1/2 quads will be monotonic.
 */
function SkChopQuadAtYExtrema(src: Point[], dst: Point[]): number {
	const a = src[0].y;
	let b = src[1].y;
	const c = src[2].y;

	if (is_not_monotonic(a, b, c)) {
		const tValue = valid_unit_divide(a - b, a - b - b + c);
		if (tValue !== undefined) {
			const chopped = SkChopQuadAt(src, tValue);
			// flatten_double_quad_extrema
			const flat = chopped[2].y;
			chopped[1] = { x: chopped[1].x, y: flat };
			chopped[3] = { x: chopped[3].x, y: flat };
			dst.splice(0, 5, ...chopped);
			return 1;
		}
		// if we get here, we need to force dst to be monotonic, even though
		// we couldn't compute a unit_divide value (probably underflow).
		b = Math.abs(a - b) < Math.abs(b - c) ? a : c;
	}
	dst[0] = { x: src[0].x, y: a };
	dst[1] = { x: src[1].x, y: b };
	dst[2] = { x: src[2].x, y: c };
	return 0;
}

/** The tangent of SkEvalCubicAt. */
function eval_cubic_derivative(src: Point[], t: number): Point {
	const coord = (k: 'x' | 'y') => {
		const P0 = src[0][k];
		const P1 = src[1][k];
		const P2 = src[2][k];
		const P3 = src[3][k];
		const A = P3 + 3 * (P1 - P2) - P0;
		const B = 2 * (P2 - 2 * P1 + P0);
		const C = P1 - P0;
		return (A * t + B) * t + C;
	};
	return { x: coord('x'), y: coord('y') };
}

function SkEvalCubicTangentAt(src: Point[], t: number): Point {
	// The derivative equation returns a zero tangent vector when t is 0 or 1, and the
	// adjacent control point is equal to the end point. In this case, use the
	// next control point or the end points to compute the tangent.
	if ((t === 0 && pointsEqual(src[0], src[1])) || (t === 1 && pointsEqual(src[2], src[3]))) {
		let tangent: Point;
		if (t === 0) {
			tangent = { x: src[2].x - src[0].x, y: src[2].y - src[0].y };
		} else {
			tangent = { x: src[3].x - src[1].x, y: src[3].y - src[1].y };
		}
		if (!tangent.x && !tangent.y) {
			tangent = { x: src[3].x - src[0].x, y: src[3].y - src[0].y };
		}
		return tangent;
	}
	return eval_cubic_derivative(src, t);
}

/**
 * Cubic'(t) = At^2 + Bt + C, where
 *   A = 3(-a + 3(b - c) + d)
 *   B = 6(a - 2b + c)
 *   C = 3(b - a)
 * Solve for t, keeping only those that fit betwee 0 < t < 1
 */
function SkFindCubicExtrema(a: number, b: number, c: number, d: number): number[] {
	// we divide A,B,C by 3 to simplify
	const A = d - a + 3 * (b - c);
	const B = 2 * (a - b - b + c);
	const C = b - a;

	return SkFindUnitQuadRoots(A, B, C);
}

// This does not return b when t==1, but it otherwise seems to get better precision than
// "a*(1 - t) + b*t" for things like chopping cubics on exact cusp points.
// The responsibility falls on the caller to check that t != 1 before calling.
const unchecked_mix = (a: number, b: number, t: number) => (b - a) * t + a;

const mixPoint = (a: Point, b: Point, t: number): Point => ({
	x: unchecked_mix(a.x, b.x, t),
	y: unchecked_mix(a.y, b.y, t),
});

/** Chops src at t into dst[0..6]. */
function chopCubicAt1(src: Point[], t: number): Point[] {
	if (t === 1) {
		return [src[0], src[1], src[2], src[3], src[3], src[3], src[3]];
	}

	const ab = mixPoint(src[0], src[1], t);
	const bc = mixPoint(src[1], src[2], t);
	const cd = mixPoint(src[2], src[3], t);
	const abc = mixPoint(ab, bc, t);
	const bcd = mixPoint(bc, cd, t);
	const abcd = mixPoint(abc, bcd, t);

	return [src[0], ab, abc, abcd, bcd, cd, src[3]];
}

/** Chops src at t0 and t1 into dst[0..9]. */
function chopCubicAt2(src: Point[], t0: number, t1: number): Point[] {
	if (t1 === 1) {
		const dst = chopCubicAt1(src, t0);
		return [...dst, src[3], src[3], src[3]];
	}

	// Perform both chops in parallel.
	const lo = (t: number) => {
		const ab = mixPoint(src[0], src[1], t);
		const bc = mixPoint(src[1], src[2], t);
		const cd = mixPoint(src[2], src[3], t);
		const abc = mixPoint(ab, bc, t);
		const bcd = mixPoint(bc, cd, t);
		return { ab, bc, cd, abc, bcd, abcd: mixPoint(abc, bcd, t) };
	};
	const a = lo(t0);
	const b = lo(t1);
	// middle = unchecked_mix(abc, bcd, shuffle<2,3,0,1>(T))
	const middleLo = mixPoint(a.abc, a.bcd, t1);
	const middleHi = mixPoint(b.abc, b.bcd, t0);

	return [src[0], a.ab, a.abc, a.abcd, middleLo, middleHi, b.abcd, b.bcd, b.cd, src[3]];
}

const pin = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function SkChopCubicAt(src: Point[], tValues: number[]): Point[] {
	const tCount = tValues.length;
	if (tCount === 0) {
		// nothing to chop
		return src.slice(0, 4);
	}
	const dst: Point[] = [];
	let cur = src.slice(0, 4);
	let i = 0;
	for (; i < tCount - 1; i += 2) {
		// Do two chops at once.
		let t0 = tValues[i];
		let t1 = tValues[i + 1];
		if (i !== 0) {
			const lastT = tValues[i - 1];
			t0 = pin((t0 - lastT) / (1 - lastT), 0, 1);
			t1 = pin((t1 - lastT) / (1 - lastT), 0, 1);
		}
		const chopped = chopCubicAt2(cur, t0, t1);
		// src = dst = dst + 6: the next chop overwrites the last cubic.
		dst.splice(Math.max(0, dst.length - 4), 4, ...chopped);
		cur = chopped.slice(6, 10);
	}
	if (i < tCount) {
		// Chop the final cubic if there was an odd number of chops.
		let t = tValues[i];
		if (i !== 0) {
			const lastT = tValues[i - 1];
			t = pin((t - lastT) / (1 - lastT), 0, 1);
		}
		const chopped = chopCubicAt1(cur, t);
		dst.splice(Math.max(0, dst.length - 4), 4, ...chopped);
	}
	return dst;
}

/**
 * Given 4 points on a cubic bezier, chop it into 1, 2, 3 beziers such that
 * the resulting beziers are monotonic in Y. Returns the number of chops and
 * the points: 0: dst[0..3] is the original cubic; 1: dst[0..3] and dst[3..6]
 * are the two new cubics; 2: dst[0..3], dst[3..6], dst[6..9] are the three
 * new cubics.
 */
function SkChopCubicAtYExtrema(src: Point[]): { roots: number; dst: Point[] } {
	const tValues = SkFindCubicExtrema(src[0].y, src[1].y, src[2].y, src[3].y);
	const roots = tValues.length;

	const dst = SkChopCubicAt(src, tValues);
	if (roots > 0) {
		// we do some cleanup to ensure our Y extrema are flat
		// flatten_double_cubic_extrema
		const flatten = (k: number) => {
			const y = dst[k + 3].y;
			dst[k + 2] = { x: dst[k + 2].x, y };
			dst[k + 4] = { x: dst[k + 4].x, y };
		};
		flatten(0);
		if (roots === 2) {
			flatten(3);
		}
	}
	return { roots, dst };
}

// ---------- src/core/SkCubicClipper.cpp ----------

/** The bisection branch of SkCubicClipper::ChopMonoAtY (the one compiled). */
function ChopMonoAtY(pts: Point[], y: number): number | undefined {
	const ycrv = [pts[0].y - y, pts[1].y - y, pts[2].y - y, pts[3].y - y];

	// Check that the endpoints straddle zero.
	let tNeg: number;
	let tPos: number; // Negative and positive function parameters.
	if (ycrv[0] < 0) {
		if (ycrv[3] < 0) return undefined;
		tNeg = 0;
		tPos = 1;
	} else if (ycrv[0] > 0) {
		if (ycrv[3] > 0) return undefined;
		tNeg = 1;
		tPos = 0;
	} else {
		return 0;
	}

	const tol = 1 / 65536; // 1 for fixed, 1e-5 for float.
	do {
		const tMid = (tPos + tNeg) / 2;
		const y01 = SkScalarInterp(ycrv[0], ycrv[1], tMid);
		const y12 = SkScalarInterp(ycrv[1], ycrv[2], tMid);
		const y23 = SkScalarInterp(ycrv[2], ycrv[3], tMid);
		const y012 = SkScalarInterp(y01, y12, tMid);
		const y123 = SkScalarInterp(y12, y23, tMid);
		const y0123 = SkScalarInterp(y012, y123, tMid);
		if (y0123 === 0) {
			return tMid;
		}
		if (y0123 < 0) tNeg = tMid;
		else tPos = tMid;
	} while (!(Math.abs(tPos - tNeg) <= tol)); // Nan-safe

	return (tNeg + tPos) / 2;
}

// ---------- src/core/SkPathPriv.cpp ----------

function poly_eval3(A: number, B: number, C: number, t: number): number {
	return (A * t + B) * t + C;
}

function poly_eval4(A: number, B: number, C: number, D: number, t: number): number {
	return ((A * t + B) * t + C) * t + D;
}

function between(a: number, b: number, c: number): boolean {
	return (a - b) * (c - b) <= 0;
}

function eval_cubic_pts(c0: number, c1: number, c2: number, c3: number, t: number): number {
	const A = c3 + 3 * (c1 - c2) - c0;
	const B = 3 * (c2 - c1 - c1 + c0);
	const C = 3 * (c1 - c0);
	const D = c0;
	return poly_eval4(A, B, C, D, t);
}

function find_minmax(pts: Point[], n: number): [number, number] {
	let min = pts[0].x;
	let max = pts[0].x;
	for (let i = 1; i < n; ++i) {
		min = Math.min(min, pts[i].x);
		max = Math.max(max, pts[i].x);
	}
	return [min, max];
}

function checkOnCurve(x: number, y: number, start: Point, end: Point): boolean {
	if (start.y === end.y) {
		return between(start.x, x, end.x) && x !== end.x;
	} else {
		return x === start.x && y === start.y;
	}
}

interface Counter {
	onCurveCount: number;
}

function winding_mono_cubic(pts: Point[], x: number, y: number, c: Counter): number {
	let y0 = pts[0].y;
	let y3 = pts[3].y;

	let dir = 1;
	if (y0 > y3) {
		[y0, y3] = [y3, y0];
		dir = -1;
	}
	if (y < y0 || y > y3) {
		return 0;
	}
	if (checkOnCurve(x, y, pts[0], pts[3])) {
		c.onCurveCount += 1;
		return 0;
	}
	if (y === y3) {
		return 0;
	}

	// quickreject or quickaccept
	const [min, max] = find_minmax(pts, 4);
	if (x < min) {
		return 0;
	}
	if (x > max) {
		return dir;
	}

	// compute the actual x(t) value
	const t = ChopMonoAtY(pts, y);
	if (t === undefined) {
		return 0;
	}
	const xt = eval_cubic_pts(pts[0].x, pts[1].x, pts[2].x, pts[3].x, t);
	if (SkScalarNearlyEqual(xt, x)) {
		if (x !== pts[3].x || y !== pts[3].y) {
			// don't test end points; they're start points
			c.onCurveCount += 1;
			return 0;
		}
	}
	return xt < x ? dir : 0;
}

function winding_cubic(pts: Point[], x: number, y: number, c: Counter): number {
	const { roots: n, dst } = SkChopCubicAtYExtrema(pts);
	let w = 0;
	for (let i = 0; i <= n; ++i) {
		w += winding_mono_cubic(dst.slice(i * 3, i * 3 + 4), x, y, c);
	}
	return w;
}

function is_mono_quad(y0: number, y1: number, y2: number): boolean {
	if (y0 === y1) {
		return true;
	}
	if (y0 < y1) {
		return y1 <= y2;
	} else {
		return y1 >= y2;
	}
}

function winding_mono_quad(pts: Point[], x: number, y: number, c: Counter): number {
	let y0 = pts[0].y;
	let y2 = pts[2].y;

	let dir = 1;
	if (y0 > y2) {
		[y0, y2] = [y2, y0];
		dir = -1;
	}
	if (y < y0 || y > y2) {
		return 0;
	}
	if (checkOnCurve(x, y, pts[0], pts[2])) {
		c.onCurveCount += 1;
		return 0;
	}
	if (y === y2) {
		return 0;
	}

	const roots = SkFindUnitQuadRoots(
		pts[0].y - 2 * pts[1].y + pts[2].y,
		2 * (pts[1].y - pts[0].y),
		pts[0].y - y,
	);
	let xt: number;
	if (roots.length === 0) {
		// zero roots are returned only when y0 == y
		// Need [0] if dir == 1
		// and  [2] if dir == -1
		xt = pts[1 - dir].x;
	} else {
		const t = roots[0];
		const C = pts[0].x;
		const A = pts[2].x - 2 * pts[1].x + C;
		const B = 2 * (pts[1].x - C);
		xt = poly_eval3(A, B, C, t);
	}
	if (SkScalarNearlyEqual(xt, x)) {
		if (x !== pts[2].x || y !== pts[2].y) {
			// don't test end points; they're start points
			c.onCurveCount += 1;
			return 0;
		}
	}
	return xt < x ? dir : 0;
}

function winding_quad(pts: Point[], x: number, y: number, c: Counter): number {
	let span = pts;
	let n = 0;

	if (!is_mono_quad(pts[0].y, pts[1].y, pts[2].y)) {
		const spanStorage: Point[] = [];
		n = SkChopQuadAtYExtrema(pts, spanStorage);
		span = spanStorage;
	}
	let w = winding_mono_quad(span, x, y, c);
	if (n > 0) {
		w += winding_mono_quad(span.slice(2), x, y, c);
	}
	return w;
}

function winding_line(pts: Point[], x: number, y: number, c: Counter): number {
	const x0 = pts[0].x;
	let y0 = pts[0].y;
	const x1 = pts[1].x;
	let y1 = pts[1].y;

	const dy = y1 - y0;

	let dir = 1;
	if (y0 > y1) {
		[y0, y1] = [y1, y0];
		dir = -1;
	}
	if (y < y0 || y > y1) {
		return 0;
	}
	if (checkOnCurve(x, y, pts[0], pts[1])) {
		c.onCurveCount += 1;
		return 0;
	}
	if (y === y1) {
		return 0;
	}
	const cross = (x1 - x0) * (y - pts[0].y) - dy * (x - x0);

	if (!cross) {
		// zero cross means the point is on the line, and since the case where
		// y of the query point is at the end point is handled above, we can be
		// sure that we're on the line (excluding the end point) here
		if (x !== x1 || y !== pts[1].y) {
			c.onCurveCount += 1;
		}
		dir = 0;
	} else if (SkScalarSignAsInt(cross) === dir) {
		dir = 0;
	}
	return dir;
}

function tangent_cubic(pts: Point[], x: number, y: number, tangents: Point[]): void {
	if (
		!between(pts[0].y, y, pts[1].y) &&
		!between(pts[1].y, y, pts[2].y) &&
		!between(pts[2].y, y, pts[3].y)
	) {
		return;
	}
	if (
		!between(pts[0].x, x, pts[1].x) &&
		!between(pts[1].x, x, pts[2].x) &&
		!between(pts[2].x, x, pts[3].x)
	) {
		return;
	}
	const { roots: n, dst } = SkChopCubicAtYExtrema(pts);
	for (let i = 0; i <= n; ++i) {
		const c = dst.slice(i * 3, i * 3 + 4);
		const t = ChopMonoAtY(c, y);
		if (t === undefined) {
			continue;
		}
		const xt = eval_cubic_pts(c[0].x, c[1].x, c[2].x, c[3].x, t);
		if (!SkScalarNearlyEqual(x, xt)) {
			continue;
		}
		tangents.push(SkEvalCubicTangentAt(c, t));
	}
}

function tangent_quad(pts: Point[], x: number, y: number, tangents: Point[]): void {
	if (!between(pts[0].y, y, pts[1].y) && !between(pts[1].y, y, pts[2].y)) {
		return;
	}
	if (!between(pts[0].x, x, pts[1].x) && !between(pts[1].x, x, pts[2].x)) {
		return;
	}
	const roots = SkFindUnitQuadRoots(
		pts[0].y - 2 * pts[1].y + pts[2].y,
		2 * (pts[1].y - pts[0].y),
		pts[0].y - y,
	);
	for (const t of roots) {
		const C = pts[0].x;
		const A = pts[2].x - 2 * pts[1].x + C;
		const B = 2 * (pts[1].x - C);
		const xt = poly_eval3(A, B, C, t);
		if (!SkScalarNearlyEqual(x, xt)) {
			continue;
		}
		tangents.push(SkEvalQuadTangentAt(pts, t));
	}
}

function tangent_line(pts: Point[], x: number, y: number, tangents: Point[]): void {
	const y0 = pts[0].y;
	const y1 = pts[1].y;
	if (!between(y0, y, y1)) {
		return;
	}
	const x0 = pts[0].x;
	const x1 = pts[1].x;
	if (!between(x0, x, x1)) {
		return;
	}
	const dx = x1 - x0;
	const dy = y1 - y0;
	if (!SkScalarNearlyEqual((x - x0) * dy, dx * (y - y0))) {
		return;
	}
	tangents.push({ x: dx, y: dy });
}

// ---------- SkPathEdgeIter (src/core/SkPathPriv.h) ----------

type Edge = { type: 'line' | 'quad' | 'cubic'; pts: Point[] };

/**
 * The edges of the path as SkPathEdgeIter returns them: every contour is
 * closed with a line back to its start. A drawing command right after a close
 * starts a new contour at the same start, as SkPath inserts a moveTo there.
 */
function* edges(commands: PathCommand[]): Generator<Edge> {
	let moveTo: Point = { x: 0, y: 0 };
	let last: Point = moveTo;
	let needsCloseLine = false;
	const closeline = (): Edge => {
		needsCloseLine = false;
		return { type: 'line', pts: [last, moveTo] };
	};
	for (const c of commands) {
		switch (c.type) {
			case 'moveTo':
				if (needsCloseLine) yield closeline();
				moveTo = last = { x: c.x, y: c.y };
				continue;
			case 'close':
				if (needsCloseLine) yield closeline();
				last = moveTo;
				continue;
		}
		needsCloseLine = true;
		const p = { x: c.x, y: c.y };
		if (c.type === 'lineTo') yield { type: 'line', pts: [last, p] };
		else if (c.type === 'quadTo')
			yield { type: 'quad', pts: [last, { x: c.cx, y: c.cy }, p] };
		else
			yield {
				type: 'cubic',
				pts: [last, { x: c.c1x, y: c.c1y }, { x: c.c2x, y: c.c2y }, p],
			};
		last = p;
	}
	if (needsCloseLine) yield closeline();
}

/** The path's bounds: of all its points, control points included. */
function bounds(commands: PathCommand[]) {
	let fLeft = Infinity;
	let fTop = Infinity;
	let fRight = -Infinity;
	let fBottom = -Infinity;
	const add = (x: number, y: number) => {
		fLeft = Math.min(fLeft, x);
		fTop = Math.min(fTop, y);
		fRight = Math.max(fRight, x);
		fBottom = Math.max(fBottom, y);
	};
	for (const c of commands) {
		if (c.type === 'close') continue;
		if (c.type === 'quadTo') add(c.cx, c.cy);
		if (c.type === 'cubicTo') {
			add(c.c1x, c.c1y);
			add(c.c2x, c.c2y);
		}
		add(c.x, c.y);
	}
	return { fLeft, fTop, fRight, fBottom };
}

function contains_inclusive(r: ReturnType<typeof bounds>, p: Point): boolean {
	return r.fLeft <= p.x && p.x <= r.fRight && r.fTop <= p.y && p.y <= r.fBottom;
}

/** SkPathPriv::Contains, for the nonzero (kWinding) and even-odd fill types. */
export function skiaContains(commands: PathCommand[], p: Point, evenOddFill: boolean): boolean {
	if (!commands.some(c => c.type !== 'close')) {
		return false;
	}

	if (!contains_inclusive(bounds(commands), p)) {
		return false;
	}

	let w = 0;
	const counter: Counter = { onCurveCount: 0 };

	for (const rec of edges(commands)) {
		switch (rec.type) {
			case 'line':
				w += winding_line(rec.pts, p.x, p.y, counter);
				break;
			case 'quad':
				w += winding_quad(rec.pts, p.x, p.y, counter);
				break;
			case 'cubic':
				w += winding_cubic(rec.pts, p.x, p.y, counter);
				break;
		}
	}
	const { onCurveCount } = counter;
	if (evenOddFill) {
		w &= 1;
	}
	if (w) {
		return true;
	}
	if (onCurveCount <= 1) {
		return Boolean(onCurveCount);
	}
	if (onCurveCount & 1 || evenOddFill) {
		return Boolean(onCurveCount & 1);
	}
	// If the point touches an even number of curves, and the fill is winding, check for
	// coincidence. Count coincidence as places where the on curve points have identical tangents.
	const tangents: Point[] = [];
	for (const rec of edges(commands)) {
		const oldCount = tangents.length;
		switch (rec.type) {
			case 'line':
				tangent_line(rec.pts, p.x, p.y, tangents);
				break;
			case 'quad':
				tangent_quad(rec.pts, p.x, p.y, tangents);
				break;
			case 'cubic':
				tangent_cubic(rec.pts, p.x, p.y, tangents);
				break;
		}
		if (tangents.length > oldCount) {
			const last = tangents.length - 1;
			const tangent = tangents[last];
			if (SkScalarNearlyZero(tangent.x * tangent.x + tangent.y * tangent.y)) {
				tangents.splice(last, 1);
			} else {
				for (let index = 0; index < last; ++index) {
					const test = tangents[index];
					if (
						SkScalarNearlyZero(test.x * tangent.y - test.y * tangent.x) &&
						SkScalarSignAsInt(tangent.x * test.x) <= 0 &&
						SkScalarSignAsInt(tangent.y * test.y) <= 0
					) {
						tangents.splice(last, 1);
						// removeShuffle(index): the last element takes its place.
						const moved = tangents.pop()!;
						if (index < tangents.length) tangents[index] = moved;
						break;
					}
				}
			}
		}
	}
	return Boolean(tangents.length);
}
