// Ported from stroke-outline (https://github.com/yyyk/stroke-outline), at commit
// 084fd2ca8eb0065951b240a917df5d8d2e616bfd: src/bezier/intersect.cpp;
// compute_quadratic_bounds and compute_cubic_bounds in src/bezier/bounds.cpp;
// points_are_too_close and line_segment_intersection in src/math/geom.hpp;
// solve_linear, solve_quadratic, solve_cubic and their helpers in
// src/math/polynomial.hpp; and AABB::intersects in src/math/AABB.hpp. Same
// author and license as this package. The curve evaluation, splitting and
// extrema it uses are ported in arc-length.ts, bezier.ts and offset.ts.

import type { Point } from '../path.js';
import { cubicBezier, quadraticBezier } from './arc-length.js';
import { splitCubicBezier, splitQuadraticBezier } from './bezier.js';
import { findDerivativeExtremaForCubic, findDerivativeExtremaForQuadratic } from './offset.js';

type Quad = [Point, Point, Point];
type Cubic = [Point, Point, Point, Point];

// math/Eps.hpp
const EPSILON = { point: 1e-5, param: 1e-8, solver: 1e-12 };

export interface CurveIntersection {
	t1: number;
	t2: number;
	point: Point;
}

// ---------- Vec2 (stroke_outline/Vec2.hpp) ----------

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (v: Point, s: number): Point => ({ x: v.x * s, y: v.y * s });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const lengthSquared = (v: Point) => v.x * v.x + v.y * v.y;
const lerp = (a: Point, b: Point, t: number): Point => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});
// std::min, std::max and std::clamp, which differ from Math.min/max on -0.
const min = (a: number, b: number) => (b < a ? b : a);
const max = (a: number, b: number) => (a < b ? b : a);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : hi < v ? hi : v);

// ---------- math/AABB.hpp, bezier/bounds.cpp ----------

interface AABB {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const aabbIntersects = (a: AABB, b: AABB) =>
	!(b.minX > a.maxX || b.maxX < a.minX || b.minY > a.maxY || b.maxY < a.minY);

function grow(b: AABB, p: Point) {
	b.minX = min(b.minX, p.x);
	b.minY = min(b.minY, p.y);
	b.maxX = max(b.maxX, p.x);
	b.maxY = max(b.maxY, p.y);
}

function computeQuadraticBounds(p0: Point, p1: Point, p2: Point): AABB {
	const bounds = {
		minX: min(p0.x, p2.x),
		minY: min(p0.y, p2.y),
		maxX: max(p0.x, p2.x),
		maxY: max(p0.y, p2.y),
	};

	const tx = findDerivativeExtremaForQuadratic(p0.x, p1.x, p2.x);
	if (tx !== null) grow(bounds, quadraticBezier(p0, p1, p2, tx));

	const ty = findDerivativeExtremaForQuadratic(p0.y, p1.y, p2.y);
	if (ty !== null) grow(bounds, quadraticBezier(p0, p1, p2, ty));

	return bounds;
}

function computeCubicBounds(p0: Point, p1: Point, p2: Point, p3: Point): AABB {
	const bounds = {
		minX: min(p0.x, p3.x),
		minY: min(p0.y, p3.y),
		maxX: max(p0.x, p3.x),
		maxY: max(p0.y, p3.y),
	};

	for (const t of findDerivativeExtremaForCubic(p0.x, p1.x, p2.x, p3.x))
		grow(bounds, cubicBezier(p0, p1, p2, p3, t));

	for (const t of findDerivativeExtremaForCubic(p0.y, p1.y, p2.y, p3.y))
		grow(bounds, cubicBezier(p0, p1, p2, p3, t));

	return bounds;
}

// ---------- math/geom.hpp ----------

const pointsAreTooClose = (p1: Point, p2: Point) =>
	lengthSquared(sub(p1, p2)) <= EPSILON.point * EPSILON.point;

export function lineSegmentIntersection(
	p1: Point,
	p2: Point,
	p3: Point,
	p4: Point,
	eps = EPSILON.param,
): [number, number] | null {
	const a = sub(p2, p1);
	const d = sub(p4, p3);
	const c = sub(p3, p1);
	const aLenSq = lengthSquared(a);
	const dLenSq = lengthSquared(d);
	const tiny = Math.max(EPSILON.solver, eps * eps);

	// Degenerate: one or both segments are points.
	const aIsPoint = aLenSq <= tiny;
	const dIsPoint = dLenSq <= tiny;

	if (aIsPoint && dIsPoint) {
		if (pointsAreTooClose(p1, p3)) return [0.0, 0.0];
		return null;
	} else if (aIsPoint) {
		const t = clamp(dot(sub(p1, p3), d) / dLenSq, 0.0, 1.0);
		if (pointsAreTooClose(add(p3, mul(d, t)), p1)) return [0.0, t];
		return null;
	} else if (dIsPoint) {
		const s = clamp(dot(sub(p3, p1), a) / aLenSq, 0.0, 1.0);
		if (pointsAreTooClose(add(p1, mul(a, s)), p3)) return [s, 0.0];
		return null;
	}

	// Both are real segments: transversal solve.
	const denom = cross(a, d);
	// Scale-relative parallel test (|sin θ| < eps). Safe: a, d are non-degenerate here.
	if (denom * denom < eps * eps * aLenSq * dLenSq) return null; // parallel/collinear — overlap handling intentionally dropped.

	const s = cross(c, d) / denom;
	const t = cross(c, a) / denom;
	if (s >= -eps && s <= 1.0 + eps && t >= -eps && t <= 1.0 + eps)
		return [clamp(s, 0.0, 1.0), clamp(t, 0.0, 1.0)];
	return null;
}

// ---------- math/polynomial.hpp ----------

type Range = [number, number];

// Roots holds at most 3 values.
function push(roots: number[], value: number) {
	if (roots.length < 3) roots.push(value);
}

function dedup(roots: number[]) {
	if (roots.length < 2) return;

	let write = 1;
	for (let i = 1; i < roots.length; ++i)
		if (Math.abs(roots[i] - roots[write - 1]) > EPSILON.param) roots[write++] = roots[i];
	roots.length = write;
}

const sortRoots = (roots: number[]) => roots.sort((a, b) => a - b);

// Divide coefficients by the largest magnitude among them. The roots are
// unchanged, and the "is this coefficient ~0" tests below become relative,
// so they behave the same whatever units (lengths, at any scale) the
// coefficients carry. Returns false if every coefficient is zero.
function normalizeCoefficients(c: number[]): boolean {
	const largest = c.reduce((m, v) => max(m, Math.abs(v)), Math.abs(c[0]));
	if (!(largest > 0.0) || !Number.isFinite(largest)) return false;
	for (let i = 0; i < c.length; i++) c[i] /= largest;
	return true;
}

// Solve `a*x + b = 0`
function solveLinear(a: number, b: number, range?: Range): number[] {
	const roots: number[] = [];
	const c = [a, b];
	if (!normalizeCoefficients(c)) return roots;
	[a, b] = c;
	if (Math.abs(a) < EPSILON.solver) return roots;

	let x = -b / a;
	if (range) {
		const [lo, hi] = range;
		if (x < lo - EPSILON.param || x > hi + EPSILON.param) return roots;
		x = clamp(x, lo, hi);
	}
	push(roots, x);
	return roots;
}

function filterRange(roots: number[], range?: Range): number[] {
	if (!range) return roots;
	const out: number[] = [];
	const [lo, hi] = range;
	for (const x of roots)
		if (x >= lo - EPSILON.param && x <= hi + EPSILON.param) push(out, clamp(x, lo, hi));
	dedup(out);
	return out;
}

// Solve `a*x² + b*x + c = 0`
export function solveQuadratic(a: number, b: number, c: number, range?: Range): number[] {
	const k = [a, b, c];
	if (!normalizeCoefficients(k)) return [];
	[a, b, c] = k;
	if (Math.abs(a) < EPSILON.solver) return solveLinear(b, c, range);

	const roots: number[] = [];
	let discriminant = b * b - 4 * a * c;
	if (discriminant < 0.0 && discriminant > -EPSILON.solver) discriminant = 0.0;
	if (discriminant < 0.0) return roots;

	if (discriminant <= EPSILON.solver) {
		const x = -b / (2 * a);
		push(roots, x);
	} else {
		const sqrtDiscriminant = Math.sqrt(discriminant);
		const q =
			-0.5 * (b + (b < 0 || Object.is(b, -0) ? -sqrtDiscriminant : sqrtDiscriminant)); // std::copysign
		if (Math.abs(q) < EPSILON.solver) {
			const x = -b / (2 * a);
			push(roots, x);
		} else {
			const x1 = q / a;
			const x2 = c / q;
			push(roots, x1);
			if (Math.abs(x2 - x1) > EPSILON.param) push(roots, x2);
		}
	}

	sortRoots(roots);

	return filterRange(roots, range);
}

// Solve `a*x³ + b*x² + c*x + d = 0`
export function solveCubic(
	a: number,
	b: number,
	c: number,
	d: number,
	range?: Range,
): number[] {
	const k = [a, b, c, d];
	if (!normalizeCoefficients(k)) return [];
	[a, b, c, d] = k;
	if (Math.abs(a) < EPSILON.solver) return solveQuadratic(b, c, d, range);

	// Normalize to monic: x^3 + B x^2 + C x + D = 0
	const invA = 1.0 / a;
	b *= invA;
	c *= invA;
	d *= invA;

	// Depress: x = t - B/3 => t^3 + p t + q = 0
	const shift = b / 3.0;
	const p = c - (b * b) / 3.0;
	const q = d - (b * c) / 3.0 + (2.0 * b * b * b) / 27.0;

	const roots: number[] = [];

	// If p ~ 0, it's basically t^3 + q = 0 (one real root)
	if (Math.abs(p) < EPSILON.solver) {
		const t = Math.cbrt(-q);
		push(roots, t - shift);
		sortRoots(roots);
		dedup(roots);

		return filterRange(roots, range);
	}

	// Standard discriminant for depressed cubic:
	// Δ = (q/2)^2 + (p/3)^3
	const halfQ = q * 0.5;
	const thirdP = p / 3.0;
	const delta = halfQ * halfQ + thirdP * thirdP * thirdP;

	// Tolerance scaled to the magnitude of the terms (prevents silly misclassification)
	const scale = Math.abs(halfQ * halfQ) + Math.abs(thirdP * thirdP * thirdP);
	const deltaEps = max(scale, 1.0) * EPSILON.solver;

	if (Math.abs(delta) <= deltaEps) {
		// Repeated root(s): Δ ~ 0
		if (Math.abs(q) < EPSILON.solver && Math.abs(p) < EPSILON.solver) {
			// Triple root at t = 0
			push(roots, -shift);
		} else {
			// One single and one double root
			// t1 = 3q/p, t2 = -3q/(2p) (double)
			const t1 = (3.0 * q) / p;
			const t2 = -0.5 * t1;
			push(roots, t1 - shift);
			if (Math.abs(t2 - t1) > EPSILON.param) push(roots, t2 - shift);
		}
	} else if (delta > 0.0) {
		// One real root (Cardano)
		const sqrtDelta = Math.sqrt(delta);
		const u = Math.cbrt(-halfQ + sqrtDelta);
		const v = Math.cbrt(-halfQ - sqrtDelta);
		push(roots, u + v - shift);
	} else {
		// Three distinct real roots (trigonometric)
		// cos(3θ) = -q/(2 * sqrt(-(p/3)^3))
		const r = Math.sqrt(-thirdP * thirdP * thirdP); // positive
		if (Math.abs(r) < EPSILON.solver) {
			// ultra-degenerate fallback (should be rare due to earlier p~0)
			const t = Math.cbrt(-q);
			push(roots, t - shift);
		} else {
			const arg = clamp(-halfQ / r, -1.0, 1.0);
			const theta = Math.acos(arg) / 3.0;
			const m = 2.0 * Math.sqrt(-thirdP); // since p < 0 in this branch
			const tau = (2.0 * Math.PI) / 3.0;
			push(roots, m * Math.cos(theta) - shift);
			push(roots, m * Math.cos(theta - tau) - shift);
			push(roots, m * Math.cos(theta + tau) - shift);
		}
	}

	sortRoots(roots);
	dedup(roots);

	return filterRange(roots, range);
}

// ---------- bezier/intersect.cpp ----------

function toLineCoords(p: Point, l0: Point, delta: Point, lenSq: number): Point {
	const relativeP = sub(p, l0);
	return {
		x: dot(relativeP, delta) / lenSq,
		y: cross(delta, relativeP) / lenSq,
	};
}

// A quadratic uses p0, p1 and p2; a cubic also p3.
interface CurveSeg {
	isCubic: boolean;
	p0: Point;
	p1: Point;
	p2: Point;
	p3: Point;
	t0: number;
	t1: number;
}

const segAabb = (s: CurveSeg) =>
	s.isCubic
		? computeCubicBounds(s.p0, s.p1, s.p2, s.p3)
		: computeQuadraticBounds(s.p0, s.p1, s.p2);

function isCoincidentWith(s: CurveSeg, other: CurveSeg): boolean {
	if (!s.isCubic && !other.isCubic) {
		const forward =
			pointsAreTooClose(s.p0, other.p0) &&
			pointsAreTooClose(s.p1, other.p1) &&
			pointsAreTooClose(s.p2, other.p2);
		const backward =
			pointsAreTooClose(s.p0, other.p2) &&
			pointsAreTooClose(s.p1, other.p1) &&
			pointsAreTooClose(s.p2, other.p0);
		return forward || backward;
	} else if (s.isCubic && other.isCubic) {
		const forward =
			pointsAreTooClose(s.p0, other.p0) &&
			pointsAreTooClose(s.p1, other.p1) &&
			pointsAreTooClose(s.p2, other.p2) &&
			pointsAreTooClose(s.p3, other.p3);
		const backward =
			pointsAreTooClose(s.p0, other.p3) &&
			pointsAreTooClose(s.p1, other.p2) &&
			pointsAreTooClose(s.p2, other.p1) &&
			pointsAreTooClose(s.p3, other.p0);
		return forward || backward;
	}
	return false;
}

function splitSeg(s: CurveSeg): [CurveSeg, CurveSeg] {
	const midT = (s.t0 + s.t1) * 0.5;
	if (!s.isCubic) {
		const [left, right] = splitQuadraticBezier([s.p0, s.p1, s.p2], 0.5);
		return [
			{
				isCubic: false,
				p0: left[0],
				p1: left[1],
				p2: left[2],
				p3: left[2],
				t0: s.t0,
				t1: midT,
			},
			{
				isCubic: false,
				p0: right[0],
				p1: right[1],
				p2: right[2],
				p3: right[2],
				t0: midT,
				t1: s.t1,
			},
		];
	} else {
		const [left, right] = splitCubicBezier([s.p0, s.p1, s.p2, s.p3], 0.5);
		return [
			{
				isCubic: true,
				p0: left[0],
				p1: left[1],
				p2: left[2],
				p3: left[3],
				t0: s.t0,
				t1: midT,
			},
			{
				isCubic: true,
				p0: right[0],
				p1: right[1],
				p2: right[2],
				p3: right[3],
				t0: midT,
				t1: s.t1,
			},
		];
	}
}

function isFlat(s: CurveSeg): boolean {
	if (!s.isCubic) {
		const d = sub(s.p2, s.p0);
		const lenSq = lengthSquared(d);
		if (lenSq < EPSILON.solver) return true;
		const v = sub(s.p1, s.p0);
		const c = cross(v, d);
		return (c * c) / lenSq <= EPSILON.solver;
	} else {
		const d = sub(s.p3, s.p0);
		const lenSq = lengthSquared(d);
		if (lenSq < EPSILON.solver) return true;
		const v1 = sub(s.p1, s.p0);
		const v2 = sub(s.p2, s.p0);
		const cross1 = cross(v1, d);
		const cross2 = cross(v2, d);
		return max(cross1 * cross1, cross2 * cross2) / lenSq <= EPSILON.solver;
	}
}

const endPoint = (s: CurveSeg) => (s.isCubic ? s.p3 : s.p2);

const MAX_DEPTH = 50;

// Partial overlaps and tangent contacts aren't handled; see intersect.hpp.
function curveCurveRecursive(
	a: CurveSeg,
	b: CurveSeg,
	depth: number,
	out: CurveIntersection[],
) {
	if (isCoincidentWith(a, b)) return;
	if (!aabbIntersects(segAabb(a), segAabb(b))) return;
	if (depth >= MAX_DEPTH || (isFlat(a) && isFlat(b))) {
		const hit = lineSegmentIntersection(a.p0, endPoint(a), b.p0, endPoint(b));
		if (hit) {
			const [s, t] = hit;
			const ta = a.t0 + (a.t1 - a.t0) * s;
			const tb = b.t0 + (b.t1 - b.t0) * t;
			out.push({ t1: ta, t2: tb, point: lerp(a.p0, endPoint(a), s) });
		}
		return;
	}
	const [a1, a2] = splitSeg(a);
	const [b1, b2] = splitSeg(b);
	curveCurveRecursive(a1, b1, depth + 1, out);
	curveCurveRecursive(a1, b2, depth + 1, out);
	curveCurveRecursive(a2, b1, depth + 1, out);
	curveCurveRecursive(a2, b2, depth + 1, out);
}

function dedupIntersections(results: CurveIntersection[], eps: number) {
	if (results.length <= 1) return;

	results.sort((a, b) => a.t1 - b.t1);

	// std::unique: compares each element with the last one kept.
	let write = 1;
	for (let i = 1; i < results.length; ++i) {
		const kept = results[write - 1];
		const r = results[i];
		if (!(Math.abs(kept.t1 - r.t1) < eps && Math.abs(kept.t2 - r.t2) < eps))
			results[write++] = r;
	}
	results.length = write;
}

export function lineQuadraticIntersections(
	l0: Point,
	l1: Point,
	curve: Quad,
): CurveIntersection[] {
	const delta = sub(l1, l0);
	const lenSq = lengthSquared(delta);
	if (lenSq < EPSILON.solver) return [];

	const p0 = toLineCoords(curve[0], l0, delta, lenSq);
	const p1 = toLineCoords(curve[1], l0, delta, lenSq);
	const p2 = toLineCoords(curve[2], l0, delta, lenSq);

	// y(t) = (1-t)^2 * y0 + 2(1-t)t * y1 + t^2 * y2
	//      = (y0 - 2y1 + y2)t^2 + (-2y0 + 2y1)t + y0
	const a = p0.y - 2.0 * p1.y + p2.y;
	const b = -2.0 * p0.y + 2.0 * p1.y;
	const c = p0.y;

	const intersections: CurveIntersection[] = [];
	const roots = solveQuadratic(a, b, c, [0.0, 1.0]);
	for (const tCurve of roots) {
		const point = quadraticBezier(curve[0], curve[1], curve[2], tCurve);
		const lineCoords = toLineCoords(point, l0, delta, lenSq);
		if (lineCoords.x >= -EPSILON.param && lineCoords.x <= 1.0 + EPSILON.param) {
			const tLine = clamp(lineCoords.x, 0.0, 1.0);
			intersections.push({ t1: tLine, t2: tCurve, point });
		}
	}
	return intersections;
}

export function lineCubicIntersections(
	l0: Point,
	l1: Point,
	curve: Cubic,
): CurveIntersection[] {
	const delta = sub(l1, l0);
	const lenSq = lengthSquared(delta);
	if (lenSq < EPSILON.solver) return [];

	const p0 = toLineCoords(curve[0], l0, delta, lenSq);
	const p1 = toLineCoords(curve[1], l0, delta, lenSq);
	const p2 = toLineCoords(curve[2], l0, delta, lenSq);
	const p3 = toLineCoords(curve[3], l0, delta, lenSq);

	// y(t) = (1-t)^3*y0 + 3t(1-t)^2*y1 + 3(1-t)t^2*y2 + t^3*y3
	//      = (-y0+3y1-3y2+y3)t^3 + (3y0-6y1+3y2)t^2 + (-3y0+3y1)t + y0
	const a = -p0.y + 3.0 * p1.y - 3.0 * p2.y + p3.y;
	const b = 3.0 * p0.y - 6.0 * p1.y + 3.0 * p2.y;
	const c = -3.0 * p0.y + 3.0 * p1.y;
	const d = p0.y;

	const intersections: CurveIntersection[] = [];
	const roots = solveCubic(a, b, c, d, [0.0, 1.0]);
	for (const tCurve of roots) {
		const point = cubicBezier(curve[0], curve[1], curve[2], curve[3], tCurve);
		const lineCoords = toLineCoords(point, l0, delta, lenSq);
		if (lineCoords.x >= -EPSILON.param && lineCoords.x <= 1.0 + EPSILON.param) {
			const tLine = clamp(lineCoords.x, 0.0, 1.0);
			intersections.push({ t1: tLine, t2: tCurve, point });
		}
	}
	return intersections;
}

const quadSeg = (c: Quad): CurveSeg => ({
	isCubic: false,
	p0: c[0],
	p1: c[1],
	p2: c[2],
	p3: c[2],
	t0: 0.0,
	t1: 1.0,
});

const cubicSeg = (c: Cubic): CurveSeg => ({
	isCubic: true,
	p0: c[0],
	p1: c[1],
	p2: c[2],
	p3: c[3],
	t0: 0.0,
	t1: 1.0,
});

// Curve-curve intersections, by recursive subdivision: crossings are found
// accurately at any scale. Known limits, harmless for the clipper (a
// stroke's offset edges never exactly coincide with another curve):
// - Curves that overlap along a stretch are only recognized when they are
//   identical; a partial overlap (e.g. a curve and a piece of it) is reported
//   as many intersections along the shared stretch.
// - Curves that touch without crossing (tangent) usually aren't reported.
function curveCurve(a: CurveSeg, b: CurveSeg): CurveIntersection[] {
	const intersections: CurveIntersection[] = [];
	curveCurveRecursive(a, b, 0, intersections);
	dedupIntersections(intersections, EPSILON.param * 10.0);
	return intersections;
}

export const quadraticQuadraticIntersections = (curve1: Quad, curve2: Quad) =>
	curveCurve(quadSeg(curve1), quadSeg(curve2));

export const quadraticCubicIntersections = (curve1: Quad, curve2: Cubic) =>
	curveCurve(quadSeg(curve1), cubicSeg(curve2));

export const cubicCubicIntersections = (curve1: Cubic, curve2: Cubic) =>
	curveCurve(cubicSeg(curve1), cubicSeg(curve2));
