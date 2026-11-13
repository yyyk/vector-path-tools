// Ported from stroke-outline (https://github.com/yyyk/stroke-outline), at commit
// 084fd2ca8eb0065951b240a917df5d8d2e616bfd: offset_quadratic_bezier,
// offset_cubic_bezier and their helpers in src/bezier/offset.cpp;
// find_derivative_extrema_for_quadratic and find_derivative_extrema_for_cubic
// in src/bezier/utils.cpp; split_quadratic_bezier and split_cubic_bezier in
// src/bezier/bezier.hpp; line_intersection in src/math/geom.hpp; and
// normalize_coefficients in src/math/polynomial.hpp. Same author and license as
// this package.
//
// stroke-outline's offsetting is based on bezierjs (https://github.com/Pomax/bezierjs,
// Copyright (c) 2023 Pomax, MIT license: see THIRD_PARTY_NOTICES): Bezier.simple,
// utils.angle and the construction of Bezier.scale; it splits at extrema as
// Bezier.reduce does, then halves pieces until each is simple. Not from
// bezierjs: the error control (pieces are also halved until their offset is
// within a tolerance of the true offset), the splitting where the offset folds,
// and the thresholds relative to the curve's size.

import type { Point } from '../path.js';
import {
	cubicBezier,
	cubicBezierDerivative,
	quadraticBezier,
	quadraticBezierDerivative,
} from './arc-length.js';

type Quad = [Point, Point, Point];
type Cubic = [Point, Point, Point, Point];

// math/Eps.hpp
const EPSILON = { param: 1e-8, solver: 1e-12 };

// ---------- Vec2 (stroke_outline/Vec2.hpp) ----------

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (v: Point, s: number): Point => ({ x: v.x * s, y: v.y * s });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const lengthSquared = (v: Point) => v.x * v.x + v.y * v.y;
const length = (v: Point) => Math.sqrt(lengthSquared(v));
const lerp = (a: Point, b: Point, t: number): Point => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

function normalize(v: Point): Point | null {
	const len = length(v);
	if (len === 0.0) return null;
	const invLen = 1.0 / len;
	return { x: v.x * invLen, y: v.y * invLen };
}

const perpendicular = (v: Point): Point => ({ x: -v.y, y: v.x });

// ---------- math/polynomial.hpp, math/geom.hpp ----------

/** Scales the coefficients by their largest magnitude; false if every one is zero. */
function normalizeCoefficients(c: number[]): boolean {
	const largest = Math.max(...c.map(Math.abs));
	if (!(largest > 0.0) || !Number.isFinite(largest)) return false;
	for (let i = 0; i < c.length; i++) c[i] /= largest;
	return true;
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
	const r = sub(p2, p1);
	const s = sub(p4, p3);
	const rCrossS = cross(r, s);
	// Parallel or collinear: compare the angle between the lines (|sin| < eps),
	// not the raw cross product, which grows with the square of their length.
	if (Math.abs(rCrossS) <= EPSILON.param * length(r) * length(s)) return null;

	const t = cross(sub(p3, p1), s) / rCrossS;
	return add(p1, { x: t * r.x, y: t * r.y });
}

// ---------- bezier/bezier.hpp ----------

export function splitQuadraticBezier(c: Quad, t: number): [Quad, Quad] {
	t = Math.min(Math.max(t, 0.0), 1.0);
	const [p0, p1, p2] = c;

	const a = lerp(p0, p1, t);
	const b = lerp(p1, p2, t);
	const d = lerp(a, b, t);

	return [
		[p0, a, d],
		[d, b, p2],
	];
}

export function splitCubicBezier(c: Cubic, t: number): [Cubic, Cubic] {
	t = Math.min(Math.max(t, 0.0), 1.0);
	const [p0, p1, p2, p3] = c;

	const a = lerp(p0, p1, t);
	const b = lerp(p1, p2, t);
	const cc = lerp(p2, p3, t);

	const d = lerp(a, b, t);
	const e = lerp(b, cc, t);

	const f = lerp(d, e, t);

	return [
		[p0, a, d, f],
		[f, e, cc, p3],
	];
}

// ---------- bezier/utils.cpp ----------

const secondDifference = (p0: number, p1: number, p2: number) => p0 - 2.0 * p1 + p2;

function findDerivativeExtremaForQuadratic(p0: number, p1: number, p2: number): number | null {
	// The derivative is ∝ (p1 - p0) + t·(p0 - 2p1 + p2); compare its slope
	// to the size of its terms, not to an absolute length.
	const c = [secondDifference(p0, p1, p2), p0 - p1];
	if (!normalizeCoefficients(c) || Math.abs(c[0]) < EPSILON.solver) return null;
	const [slope, offset] = c;

	const t = offset / slope;
	if (t < 0.0 || t > 1.0) return null;

	return t;
}

function findDerivativeExtremaForCubic(
	p0: number,
	p1: number,
	p2: number,
	p3: number,
): number[] {
	// Cubic in power basis: P(t) = a t^3 + b t^2 + c t + d.
	const a = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
	const b = 3.0 * p0 - 6.0 * p1 + 3.0 * p2;
	const c = -3.0 * p0 + 3.0 * p1;

	// P'(t) = qa t^2 + qb t + qc, normalized so the "~0" tests below are
	// relative to the size of the coefficients, not absolute lengths.
	const q = [3.0 * a, 2.0 * b, c];

	const result: number[] = [];
	if (!normalizeCoefficients(q)) return result;
	const [qa, qb, qc] = q;

	if (Math.abs(qa) < EPSILON.solver) {
		if (Math.abs(qb) < EPSILON.solver) return result;

		const t = -qc / qb;
		if (t >= 0.0 && t <= 1.0) result.push(t);
		return result;
	}

	let disc = qb * qb - 4.0 * qa * qc;
	if (disc < 0.0 && disc > -EPSILON.solver) disc = 0.0;
	if (disc < 0.0) return result;

	if (disc <= EPSILON.solver) {
		const t = -qb / (2.0 * qa);
		if (t >= 0.0 && t <= 1.0) result.push(t);
		return result;
	}

	const sqrtD = Math.sqrt(disc);
	const qq = -0.5 * (qb + (qb < 0 || Object.is(qb, -0) ? -sqrtD : sqrtD)); // std::copysign

	if (Math.abs(qq) < EPSILON.solver) {
		const t = -qb / (2.0 * qa);
		if (t >= 0.0 && t <= 1.0) result.push(t);
		return result;
	}

	const r0 = qq / qa;
	const r1 = qc / qq;

	if (r0 >= 0.0 && r0 <= 1.0) result.push(r0);
	if (r1 >= 0.0 && r1 <= 1.0) {
		if (result.length === 0 || Math.abs(result[0] - r1) > EPSILON.param) result.push(r1);
	}

	return result;
}

// ---------- bezier/offset.cpp ----------

function computeNormal(tangent: Point): Point | null {
	const normalizedTangent = normalize(tangent);
	if (!normalizedTangent) return null;

	const normal = perpendicular(normalizedTangent);
	return normal;
}

function angle(p1: Point, p2: Point, p3: Point): number {
	const d1 = sub(p1, p2);
	const d2 = sub(p3, p2);
	return Math.atan2(cross(d1, d2), dot(d1, d2));
}

function isSimple(t0: Point, t1: Point): boolean {
	const n0 = computeNormal(t0);
	if (!n0) return false;
	const n1 = computeNormal(t1);
	if (!n1) return false;

	return Math.abs(Math.acos(dot(n0, n1))) < Math.PI / 3.0;
}

export function isQuadraticSimple(p0: Point, p1: Point, p2: Point): boolean {
	const t0 = quadraticBezierDerivative(p0, p1, p2, 0.0);
	const t1 = quadraticBezierDerivative(p0, p1, p2, 1.0);
	return isSimple(t0, t1);
}

export function isCubicSimple(p0: Point, p1: Point, p2: Point, p3: Point): boolean {
	const angle0 = angle(p0, p3, p1);
	const angle1 = angle(p0, p3, p2);
	if ((angle0 > 0.0 && angle1 < 0.0) || (angle0 < 0.0 && angle1 > 0.0)) return false;
	const t0 = cubicBezierDerivative(p0, p1, p2, p3, 0.0);
	const t1 = cubicBezierDerivative(p0, p1, p2, p3, 1.0);
	return isSimple(t0, t1);
}

function isValidSplitT(t: number): boolean {
	return Number.isFinite(t) && t > EPSILON.param && t < 1.0 - EPSILON.param;
}

// Shorter than 1e-6 of `size`, the size of the curve being offset, so the
// test is the same at any scale.
const isTiny = (v: Point, size: number) => lengthSquared(v) < EPSILON.solver * size * size;

// std::min / std::max, which keep the first argument unless the second is
// smaller / larger (unlike Math.min and Math.max with NaN).
const stdMin = (a: number, b: number) => (b < a ? b : a);
const stdMax = (a: number, b: number) => (a < b ? b : a);

/** The diagonal of the control points' bounding box. */
export function curveSize(points: Point[]): number {
	let lo = points[0];
	let hi = lo;
	for (const p of points) {
		lo = { x: stdMin(lo.x, p.x), y: stdMin(lo.y, p.y) };
		hi = { x: stdMax(hi.x, p.x), y: stdMax(hi.y, p.y) };
	}
	return length(sub(hi, lo));
}

export function isQuadraticTooSmallToSubdivide(curve: Quad, size: number): boolean {
	const chord = sub(curve[2], curve[0]);
	const d0 = sub(curve[1], curve[0]);
	const d1 = sub(curve[2], curve[1]);
	return isTiny(chord, size) || (isTiny(d0, size) && isTiny(d1, size));
}

export function isCubicTooSmallToSubdivide(curve: Cubic, size: number): boolean {
	const chord = sub(curve[3], curve[0]);
	const d0 = sub(curve[1], curve[0]);
	const d1 = sub(curve[3], curve[2]);
	return isTiny(chord, size) || (isTiny(d0, size) && isTiny(d1, size));
}

export function isQuadraticDegenerate(p0: Point, p1: Point, p2: Point, size: number): boolean {
	const d0 = quadraticBezierDerivative(p0, p1, p2, 0.0);
	const d1 = quadraticBezierDerivative(p0, p1, p2, 1.0);
	return isTiny(sub(p2, p0), size) || (isTiny(d0, size) && isTiny(d1, size));
}

export function isCubicDegenerate(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	size: number,
): boolean {
	const d0 = cubicBezierDerivative(p0, p1, p2, p3, 0.0);
	const d1 = cubicBezierDerivative(p0, p1, p2, p3, 1.0);
	return isTiny(sub(p3, p0), size) || (isTiny(d0, size) && isTiny(d1, size));
}

// Every point of `points` lies on the line through `from` and `to` (compared
// by angle, so at any scale). Such a curve is geometrically straight even if
// its control points aren't on its endpoints.
export function isOnChord(from: Point, to: Point, points: Point[]): boolean {
	const chord = sub(to, from);
	const chordLen = length(chord);
	if (!(chordLen > 0.0)) return false;
	return points.every(p => {
		const v = sub(p, from);
		return Math.abs(cross(chord, v)) <= EPSILON.param * chordLen * length(v);
	});
}

export function uniqueSortedTs(ts: number[]): number[] {
	ts = ts.filter(t => Number.isFinite(t)).sort((a, b) => a - b);
	const result: number[] = [];
	for (const t of ts)
		if (result.length === 0 || Math.abs(t - result[result.length - 1]) >= EPSILON.param)
			result.push(t);
	return result;
}

export function splitCurveAtTs<C>(
	curve: C,
	splitPoints: number[],
	splitFn: (c: C, t: number) => [C, C],
): C[] {
	const curves: C[] = [];
	let current = curve;
	let lastT = 0.0;

	for (const t of splitPoints) {
		if (!isValidSplitT(t)) continue;
		const localT = (t - lastT) / (1.0 - lastT);
		const [left, right] = splitFn(current, localT);
		curves.push(left);
		current = right;
		lastT = t;
	}
	curves.push(current);
	return curves;
}

// At most this many halvings of a piece: a bound on the work.
const MAX_DEPTH = 24;

// The tolerance for the offset's distance from the true offset, as a share
// of the offset distance: 0.2%, so 0.1% of a centered stroke's width.
export const RELATIVE_TOLERANCE = 2e-3;

// A curve's point, first and second derivatives at t.
interface PointAndDerivatives {
	p: Point;
	d1: Point;
	d2: Point;
}

function evaluate(c: Quad | Cubic, t: number): PointAndDerivatives {
	if (c.length === 3) {
		const [p0, p1, p2] = c;
		return {
			p: quadraticBezier(p0, p1, p2, t),
			d1: quadraticBezierDerivative(p0, p1, p2, t),
			d2: mul(add(sub(p0, mul(p1, 2.0)), p2), 2.0),
		};
	}
	const [p0, p1, p2, p3] = c;
	const a = add(sub(p0, mul(p1, 2.0)), p2);
	const b = add(sub(p1, mul(p2, 2.0)), p3);
	return {
		p: cubicBezier(p0, p1, p2, p3, t),
		d1: cubicBezierDerivative(p0, p1, p2, p3, t),
		d2: mul(add(mul(a, 1.0 - t), mul(b, t)), 6.0),
	};
}

// std::clamp(v, 0, 1).
const clamp = (v: number) => (v < 0.0 ? 0.0 : 1.0 < v ? 1.0 : v);

// Vec2 / double, which multiplies by the reciprocal.
const div = (v: Point, s: number): Point => mul(v, 1.0 / s);

// The largest distance from the true offset of `curve` by d, B(t) + d·N(t),
// to `piece`, at seven points: each true-offset point is projected onto the
// piece by Newton's method, starting at the same parameter.
function offsetError<C extends Quad | Cubic>(curve: C, piece: C, d: number): number {
	let worst = 0.0;
	for (let k = 1; k < 8; ++k) {
		const u = k / 8.0;
		const b = evaluate(curve, u);
		const speed = length(b.d1);
		if (!(speed > 0.0)) continue;
		const target = add(b.p, div(mul({ x: -b.d1.y, y: b.d1.x }, d), speed));
		let s = u;
		for (let step = 0; step < 4; ++step) {
			const q = evaluate(piece, s);
			const e = sub(q.p, target);
			const f = dot(e, q.d1);
			const df = dot(q.d1, q.d1) + dot(e, q.d2);
			if (!(df > 0.0)) break;
			s = clamp(s - f / df);
		}
		worst = stdMax(worst, length(sub(evaluate(piece, s).p, target)));
	}
	return worst;
}

// Samples of the fold value along the curve, to find where it changes sign.
const FOLD_SAMPLES = 64;

// Where the offset by d folds: the t values at which
// 1 + d·(B'' × B')/|B'|³ (one minus d times the curvature) crosses zero.
// There the true offset has a cusp, and halving near it would leave a piece
// across it. Found by its sign changes between samples, then bisection.
export function foldPoints(curve: Quad | Cubic, d: number): number[] {
	const fold = (t: number) => {
		const j = evaluate(curve, t);
		const speed = length(j.d1);
		return 1.0 + (d * cross(j.d2, j.d1)) / (speed * speed * speed);
	};
	const ts: number[] = [];
	let t0 = 0.0;
	let f0 = fold(0.0);
	for (let i = 1; i <= FOLD_SAMPLES; ++i) {
		const t1 = i / FOLD_SAMPLES;
		const f1 = fold(t1);
		if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0.0) {
			let lo = t0;
			let hi = t1;
			const positive = f0 > 0.0;
			for (let k = 0; k < 60 && hi - lo > 1e-15; ++k) {
				const mid = (lo + hi) / 2.0;
				if (fold(mid) > 0.0 === positive) lo = mid;
				else hi = mid;
			}
			ts.push((lo + hi) / 2.0);
		}
		t0 = t1;
		f0 = f1;
	}
	return ts;
}

// Halves `curve` until each piece is simple and its offset is within
// `tolerance` of the true offset, and appends the offsets to `result`. A
// piece too small to halve, or at MAX_DEPTH, keeps the offset it has.
export function offsetUntilAccurate<C extends Quad | Cubic>(
	curve: C,
	offsetDistance: number,
	tolerance: number,
	result: C[],
	splitFn: (c: C, t: number) => [C, C],
	isSimpleFn: (c: C) => boolean,
	shouldStopFn: (c: C) => boolean,
	offsetFn: (c: C) => C | null,
): void {
	const stack: [C, number][] = [[curve, 0]];

	while (stack.length) {
		const [segment, depth] = stack.pop()!;

		let piece: C | null = null;
		if (isSimpleFn(segment)) piece = offsetFn(segment);
		if (piece && offsetError(segment, piece, offsetDistance) <= tolerance) {
			result.push(piece);
			continue;
		}
		if (depth >= MAX_DEPTH || shouldStopFn(segment)) {
			if (piece) result.push(piece);
			continue;
		}

		const [left, right] = splitFn(segment, 0.5);
		// Push right first so left is processed first (stable order).
		stack.push([right, depth + 1]);
		stack.push([left, depth + 1]);
	}
}

function offsetLineSegment(
	p0: Point,
	p1: Point,
	offsetDistance: number,
): [Point, Point] | null {
	const tangent = sub(p1, p0);

	const normal = computeNormal(tangent);
	if (!normal) return null;

	const offsetVector = mul(normal, offsetDistance);
	const offsetP0 = add(p0, offsetVector);
	const offsetP1 = add(p1, offsetVector);
	return [offsetP0, offsetP1];
}

function offsetEndpoints(
	start: Point,
	startDerivative: Point,
	end: Point,
	endDerivative: Point,
	offsetDistance: number,
): [Point, Point, Point] | null {
	const startNormal = computeNormal(startDerivative);
	if (!startNormal) return null;
	const endNormal = computeNormal(endDerivative);
	if (!endNormal) return null;

	const startPoint = add(start, mul(startNormal, 10.0));
	const endPoint = add(end, mul(endNormal, 10.0));
	const anchor = lineIntersection(startPoint, start, endPoint, end);
	if (!anchor) return null;
	const newStart = add(start, mul(startNormal, offsetDistance));
	const newEnd = add(end, mul(endNormal, offsetDistance));
	return [anchor, newStart, newEnd];
}

export function quadraticSplitPoints(p0: Point, p1: Point, p2: Point): number[] {
	const ts: number[] = [];
	const extremaX = findDerivativeExtremaForQuadratic(p0.x, p1.x, p2.x);
	if (extremaX !== null) ts.push(extremaX);
	const extremaY = findDerivativeExtremaForQuadratic(p0.y, p1.y, p2.y);
	if (extremaY !== null) ts.push(extremaY);
	return uniqueSortedTs(ts);
}

export function cubicSplitPoints(p0: Point, p1: Point, p2: Point, p3: Point): number[] {
	const ts: number[] = [];
	ts.push(...findDerivativeExtremaForCubic(p0.x, p1.x, p2.x, p3.x));
	ts.push(...findDerivativeExtremaForCubic(p0.y, p1.y, p2.y, p3.y));
	return uniqueSortedTs(ts);
}

export function offsetQuadratic(
	p0: Point,
	p1: Point,
	p2: Point,
	offsetDistance: number,
	size: number,
): Quad | null {
	if (isQuadraticDegenerate(p0, p1, p2, size)) return null;

	const d0 = quadraticBezierDerivative(p0, p1, p2, 0.0);
	const d1 = quadraticBezierDerivative(p0, p1, p2, 1.0);
	const offsetEndpointsResult = offsetEndpoints(p0, d0, p2, d1, offsetDistance);
	if (!offsetEndpointsResult) return null;
	const [o, newP0, newP2] = offsetEndpointsResult;
	const p0DerivativeEnd = add(newP0, d0);
	const newP1 = lineIntersection(newP0, p0DerivativeEnd, o, p1);
	if (!newP1) return null;
	return [newP0, newP1, newP2];
}

export function offsetCubic(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	offsetDistance: number,
	size: number,
): Cubic | null {
	if (isCubicDegenerate(p0, p1, p2, p3, size)) return null;

	const d0 = cubicBezierDerivative(p0, p1, p2, p3, 0.0);
	const d3 = cubicBezierDerivative(p0, p1, p2, p3, 1.0);
	const offsetEndpointsResult = offsetEndpoints(p0, d0, p3, d3, offsetDistance);
	if (!offsetEndpointsResult) return null;
	const [o, newP0, newP3] = offsetEndpointsResult;
	const p0DerivativeEnd = add(newP0, d0);
	const p3DerivativeEnd = add(newP3, d3);
	const newP1 = lineIntersection(newP0, p0DerivativeEnd, o, p1);
	if (!newP1) return null;
	const newP2 = lineIntersection(newP3, p3DerivativeEnd, o, p2);
	if (!newP2) return null;
	return [newP0, newP1, newP2, newP3];
}

export function offsetQuadraticBezier(
	p0: Point,
	p1: Point,
	p2: Point,
	offsetDistance: number,
): Quad[] {
	// A straight curve's offset is the curve moved sideways. (The general
	// construction intersects the end normals, which are parallel here, so
	// it would fail and drop the curve.)
	if (isOnChord(p0, p2, [p1])) {
		const shifted = offsetLineSegment(p0, p2, offsetDistance);
		if (!shifted) return [];
		const by = sub(shifted[0], p0);
		return [[add(p0, by), add(p1, by), add(p2, by)]];
	}
	const size = curveSize([p0, p1, p2]);
	// A curve collapsed to a point (or a non-finite one) has no offset.
	if (!(size > 0.0)) return [];
	if (isQuadraticDegenerate(p0, p1, p2, size)) return [];

	const sourceCurve: Quad = [p0, p1, p2];
	// Split at the extrema, as Bezier.reduce does, and where the offset folds.
	let splitPoints = quadraticSplitPoints(p0, p1, p2);
	for (const t of foldPoints(sourceCurve, offsetDistance)) splitPoints.push(t);
	splitPoints = uniqueSortedTs(splitPoints);
	const curves = splitCurveAtTs(sourceCurve, splitPoints, splitQuadraticBezier);
	const tolerance = RELATIVE_TOLERANCE * Math.abs(offsetDistance);
	const result: Quad[] = [];
	for (const curve of curves)
		offsetUntilAccurate(
			curve,
			offsetDistance,
			tolerance,
			result,
			splitQuadraticBezier,
			c => isQuadraticSimple(c[0], c[1], c[2]),
			c => isQuadraticTooSmallToSubdivide(c, size),
			c => offsetQuadratic(c[0], c[1], c[2], offsetDistance, size),
		);
	return result;
}

export function offsetCubicBezier(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	offsetDistance: number,
): Cubic[] {
	// A straight curve's offset is the curve moved sideways (see the
	// quadratic case).
	if (isOnChord(p0, p3, [p1, p2])) {
		const shifted = offsetLineSegment(p0, p3, offsetDistance);
		if (!shifted) return [];
		const by = sub(shifted[0], p0);
		return [[add(p0, by), add(p1, by), add(p2, by), add(p3, by)]];
	}
	const size = curveSize([p0, p1, p2, p3]);
	// A curve collapsed to a point (or a non-finite one) has no offset.
	if (!(size > 0.0)) return [];
	if (isCubicDegenerate(p0, p1, p2, p3, size)) return [];

	const sourceCurve: Cubic = [p0, p1, p2, p3];
	// Split at the extrema, as Bezier.reduce does, and where the offset folds.
	let splitPoints = cubicSplitPoints(p0, p1, p2, p3);
	for (const t of foldPoints(sourceCurve, offsetDistance)) splitPoints.push(t);
	splitPoints = uniqueSortedTs(splitPoints);
	const curves = splitCurveAtTs(sourceCurve, splitPoints, splitCubicBezier);
	const tolerance = RELATIVE_TOLERANCE * Math.abs(offsetDistance);
	const result: Cubic[] = [];
	for (const curve of curves)
		offsetUntilAccurate(
			curve,
			offsetDistance,
			tolerance,
			result,
			splitCubicBezier,
			c => isCubicSimple(c[0], c[1], c[2], c[3]),
			c => isCubicTooSmallToSubdivide(c, size),
			c => offsetCubic(c[0], c[1], c[2], c[3], offsetDistance, size),
		);
	return result;
}
