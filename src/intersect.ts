// Where two segments meet, for booleanOp: crossings, touches, shared
// endpoints, and stretches where they lie on top of each other; and where a
// cubic crosses itself.
//
// Built on stroke-outline's intersection (ported in stroke-outline/intersect.ts):
// two curves are subdivided until both pieces are flat, as there. Added here:
// overlaps, touches without crossing, endpoints, a cubic's own loop, a line
// against a curve by isolating roots (stroke-outline solves it in closed form,
// which loses nearly repeated roots), and a tolerance in path units instead of
// fixed sizes.

import {
	boxesTouch,
	controlBox,
	evaluate,
	parameterOf,
	powerBasis,
	subCurve,
	type Bezier,
} from './bezier-points.js';
import { BooleanOpError } from './boolean-op-error.js';
import type { Point } from './path.js';
import { lineSegmentIntersection, solveCubic } from './stroke-outline/intersect.js';
import { clamp01, cross, distance, dot, length, lerp, sub } from './vec.js';

/**
 * One place where segments `a` and `b` meet. A point is a crossing or a touch,
 * at `t1` on `a` and `t2` on `b`. An overlap is a stretch they share, from
 * `t1[0]` to `t1[1]` on `a` (ascending), which is `t2[0]` to `t2[1]` on `b`
 * (descending when `b` runs the other way).
 */
export type Intersection =
	| { kind: 'point'; t1: number; t2: number; point: Point }
	| { kind: 'overlap'; t1: [number, number]; t2: [number, number] };

// ---------- one curve ----------

/** Whether all the control points lie within `eps` of the chord, in order. */
function isStraight(p: Bezier, eps: number): boolean {
	const chord = sub(p[p.length - 1], p[0]);
	const len = length(chord);
	if (len <= eps) return false;
	for (let i = 1; i + 1 < p.length; i++) {
		const v = sub(p[i], p[0]);
		if (Math.abs(cross(chord, v)) / len > eps) return false;
		const along = dot(chord, v) / len;
		if (along < -eps || along > len + eps) return false;
	}
	return true;
}

/** How far the control points stray from the chord. */
function flatness(p: Bezier): number {
	const chord = sub(p[p.length - 1], p[0]);
	const len = length(chord);
	let most = 0;
	for (let i = 1; i + 1 < p.length; i++) {
		const v = sub(p[i], p[0]);
		most = Math.max(most, len > 0 ? Math.abs(cross(chord, v)) / len : length(v));
	}
	return most;
}

/**
 * Where a cubic crosses itself: [s, t] with s < t and B(s) = B(t), or null.
 * With B(t) = a·t³ + b·t² + c·t + d, B(s) = B(t) for s ≠ t divides by s − t
 * into a·(s² + st + t²) + b·(s + t) + c = 0. In σ = s + t and π = st that is
 * a·(σ² − π) + b·σ + c = 0; its cross product with a gives σ, either
 * coordinate then gives π, and s, t are the roots of z² − σz + π.
 */
export function selfIntersection(p: Bezier): [number, number] | null {
	if (p.length !== 4) return null;
	const [a, b, c] = powerBasis(p);
	const axb = cross(a, b);
	if (!(Math.abs(axb) > 1e-12 * length(a) * length(b))) return null;
	const sigma = -cross(a, c) / axb;
	const k = Math.abs(a.x) >= Math.abs(a.y) ? 'x' : 'y';
	const pi = sigma * sigma + (b[k] * sigma + c[k]) / a[k];
	const disc = sigma * sigma - 4 * pi;
	if (!(disc > 0)) return null;
	const r = Math.sqrt(disc);
	const s = (sigma - r) / 2;
	const t = (sigma + r) / 2;
	if (s < -1e-9 || t > 1 + 1e-9 || t - s < 1e-9) return null;
	return [clamp01(s), clamp01(t)];
}

// ---------- two curves ----------

/**
 * The stretch `a` and `b` share, if any. Ends of each that lie on the other
 * give the stretch's two ends; it counts when points along `a` between them
 * all lie on `b`. That holds for any two pieces of the same curve, of any
 * degree or parameterization (a line and a straight cubic, a quadratic and the
 * same curve as a cubic).
 */
function overlap(a: Bezier, b: Bezier, eps: number): Intersection | null {
	if ((a.length === 2 && !isStraight(b, eps)) || (b.length === 2 && !isStraight(a, eps)))
		return null;
	const pairs: [number, number][] = [];
	const addPair = (ta: number | null, tb: number | null) => {
		if (ta === null || tb === null) return;
		const p = evaluate(a, ta);
		if (!pairs.some(([t]) => distance(evaluate(a, t), p) <= eps)) pairs.push([ta, tb]);
	};
	for (const ta of [0, 1]) addPair(ta, parameterOf(b, evaluate(a, ta), eps));
	for (const tb of [0, 1]) addPair(parameterOf(a, evaluate(b, tb), eps), tb);
	if (pairs.length !== 2) return null;
	pairs.sort((p, q) => p[0] - q[0]);
	const [[ta0, tb0], [ta1, tb1]] = pairs;
	const SAMPLES = 7;
	for (let i = 1; i <= SAMPLES; i++) {
		const t = ta0 + ((ta1 - ta0) * i) / (SAMPLES + 1);
		if (parameterOf(b, evaluate(a, t), eps) === null) return null;
	}
	return { kind: 'overlap', t1: [ta0, ta1], t2: [tb0, tb1] };
}

/**
 * A line against a curve. The curve's signed distance from the line is a
 * polynomial in t; cut where its derivative is zero, it is monotone on each
 * piece, so every sign change is found by bisection, however close the roots
 * (a closed-form cubic solver merges nearly repeated ones). Where the curve
 * turns back within `eps` of the line without crossing, it touches.
 */
function lineCurve(line: Bezier, curve: Bezier, eps: number): Intersection[] {
	const [l0, l1] = line;
	if (curve.length === 2) {
		const hit = lineSegmentIntersection(l0, l1, curve[0], curve[1]);
		return hit
			? [{ kind: 'point', t1: hit[0], t2: hit[1], point: lerp(l0, l1, hit[0]) }]
			: [];
	}
	const delta = sub(l1, l0);
	const len = length(delta);
	if (len === 0) return [];
	const n = { x: -delta.y / len, y: delta.x / len };
	const f = (t: number) => dot(sub(evaluate(curve, t), l0), n);
	const [a, b, c] = powerBasis(curve);
	const turns = solveCubic(0, 3 * dot(a, n), 2 * dot(b, n), dot(c, n), [0, 1]).filter(
		t => t > 0 && t < 1,
	);
	const ts: number[] = [];
	const cuts = [0, ...turns, 1];
	for (let i = 0; i + 1 < cuts.length; i++) {
		let lo = cuts[i];
		let hi = cuts[i + 1];
		const flo = f(lo);
		const fhi = f(hi);
		if (flo === 0) ts.push(lo);
		if (flo * fhi >= 0) continue;
		for (let k = 0; k < 64; k++) {
			const mid = (lo + hi) / 2;
			if (f(mid) * flo > 0) lo = mid;
			else hi = mid;
		}
		ts.push((lo + hi) / 2);
	}
	if (f(1) === 0) ts.push(1);
	for (const t of turns) if (Math.abs(f(t)) <= eps) ts.push(t);

	const hits: Intersection[] = [];
	for (const t of ts) {
		const point = evaluate(curve, t);
		const along = dot(sub(point, l0), delta) / (len * len);
		const slack = eps / len;
		if (along >= -slack && along <= 1 + slack)
			hits.push({ kind: 'point', t1: clamp01(along), t2: t, point });
	}
	return hits;
}

interface Leaf {
	t1: number;
	t2: number;
	point: Point;
	gap: number;
	range: [number, number, number, number];
}

/**
 * Two curves, by subdivision until both pieces are flat to within a fraction
 * of `eps`, as in stroke-outline. A pair of flat pieces that cross gives a
 * crossing; one that misses by at most `eps` gives a touch, at its closest
 * points. A crossing or touch is found on several neighbouring pairs, so
 * neighbours are grouped and each group keeps its closest pair. Curves that
 * stay within `eps` of each other along a stretch without being the same
 * curve would split without end; after 200,000 pairs this gives up with a
 * BooleanOpError.
 */
function curveCurve(a: Bezier, b: Bezier, eps: number): Intersection[] {
	const leaves: Leaf[] = [];
	const flat = eps / 4;
	let budget = 200000;
	const visit = (
		p: Bezier,
		ta0: number,
		ta1: number,
		q: Bezier,
		tb0: number,
		tb1: number,
		depth: number,
	) => {
		if (--budget < 0)
			throw new BooleanOpError(
				'two curves stay within the tolerance of each other without being the same curve',
			);
		if (!boxesTouch(controlBox(p, eps / 2), controlBox(q, eps / 2))) return;
		const pFlat = flatness(p) <= flat;
		const qFlat = flatness(q) <= flat;
		if ((pFlat && qFlat) || depth >= 50) {
			const p0 = p[0];
			const p1 = p[p.length - 1];
			const q0 = q[0];
			const q1 = q[q.length - 1];
			const range: Leaf['range'] = [ta0, ta1, tb0, tb1];
			const hit = lineSegmentIntersection(p0, p1, q0, q1);
			if (hit) {
				leaves.push({
					t1: ta0 + (ta1 - ta0) * hit[0],
					t2: tb0 + (tb1 - tb0) * hit[1],
					point: lerp(p0, p1, hit[0]),
					gap: 0,
					range,
				});
				return;
			}
			const closest = closestOnSegments(p0, p1, q0, q1);
			if (closest.gap <= eps)
				leaves.push({
					t1: ta0 + (ta1 - ta0) * closest.s,
					t2: tb0 + (tb1 - tb0) * closest.t,
					point: lerp(lerp(p0, p1, closest.s), lerp(q0, q1, closest.t), 0.5),
					gap: closest.gap,
					range,
				});
			return;
		}
		// Split only the pieces that aren't flat yet.
		const ps = pFlat ? [[p, ta0, ta1] as const] : halves(p, ta0, ta1);
		const qs = qFlat ? [[q, tb0, tb1] as const] : halves(q, tb0, tb1);
		for (const [pp, pa, pb] of ps)
			for (const [qq, qa, qb] of qs) visit(pp, pa, pb, qq, qa, qb, depth + 1);
	};
	visit(a, 0, 1, b, 0, 1, 0);

	// Group leaves whose parameter ranges touch on both curves.
	const parent = leaves.map((_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	const touches = (r: Leaf['range'], s: Leaf['range']) =>
		r[0] <= s[1] && s[0] <= r[1] && r[2] <= s[3] && s[2] <= r[3];
	for (let i = 0; i < leaves.length; i++)
		for (let j = i + 1; j < leaves.length; j++)
			if (touches(leaves[i].range, leaves[j].range)) parent[find(i)] = find(j);
	const best = new Map<number, Leaf>();
	for (let i = 0; i < leaves.length; i++) {
		const root = find(i);
		const kept = best.get(root);
		if (!kept || leaves[i].gap < kept.gap) best.set(root, leaves[i]);
	}
	return [...best.values()].map(l => ({ kind: 'point', t1: l.t1, t2: l.t2, point: l.point }));
}

function halves(p: Bezier, t0: number, t1: number) {
	const mid = (t0 + t1) / 2;
	return [
		[subCurve(p, 0, 0.5), t0, mid],
		[subCurve(p, 0.5, 1), mid, t1],
	] as const;
}

/** The closest points of segments p0p1 and q0q1, which don't cross. */
function closestOnSegments(p0: Point, p1: Point, q0: Point, q1: Point) {
	const onSegment = (a: Point, b: Point, x: Point) => {
		const d = sub(b, a);
		const lenSq = dot(d, d);
		return lenSq > 0 ? clamp01(dot(sub(x, a), d) / lenSq) : 0;
	};
	// Without a crossing, the closest pair has an endpoint on one of them.
	const options = [
		{ s: 0, t: onSegment(q0, q1, p0) },
		{ s: 1, t: onSegment(q0, q1, p1) },
		{ s: onSegment(p0, p1, q0), t: 0 },
		{ s: onSegment(p0, p1, q1), t: 1 },
	];
	let best = { s: 0, t: 0, gap: Infinity };
	for (const { s, t } of options) {
		const gap = distance(lerp(p0, p1, s), lerp(q0, q1, t));
		if (gap < best.gap) best = { s, t, gap };
	}
	return best;
}

/**
 * Where segments `a` and `b` meet, within `eps` (a distance in path units),
 * sorted by `t1`. Ends of one that lie on the other are reported at exactly
 * t = 0 or 1. When they overlap, the overlap is the only result: two pieces of
 * the same curve whose underlying curve loops back over itself can also cross
 * outside their overlap, and that crossing isn't reported.
 */
export function intersect(a: Bezier, b: Bezier, eps: number): Intersection[] {
	if (!boxesTouch(controlBox(a, eps), controlBox(b, eps))) return [];

	const shared = overlap(a, b, eps);
	if (shared?.kind === 'overlap') return [shared];

	// Ends first, so that they win over the same point found less exactly.
	const hits: Intersection[] = [];
	const addHit = (h: Intersection) => {
		if (h.kind !== 'point') return;
		if (!hits.some(k => k.kind === 'point' && distance(k.point, h.point) <= 2 * eps))
			hits.push(h);
	};
	// An end on the other's end is exactly there too.
	const endOn = (p: Bezier, point: Point) =>
		distance(p[0], point) <= eps
			? 0
			: distance(p[p.length - 1], point) <= eps
				? 1
				: parameterOf(p, point, eps);
	for (const ta of [0, 1]) {
		const point = evaluate(a, ta);
		const tb = endOn(b, point);
		if (tb !== null) addHit({ kind: 'point', t1: ta, t2: tb, point });
	}
	for (const tb of [0, 1]) {
		const point = evaluate(b, tb);
		const ta = endOn(a, point);
		if (ta !== null) addHit({ kind: 'point', t1: ta, t2: tb, point });
	}

	let found: Intersection[];
	if (a.length === 2) found = lineCurve(a, b, eps);
	else if (b.length === 2)
		found = lineCurve(b, a, eps).map(h =>
			h.kind === 'point' ? { ...h, t1: h.t2, t2: h.t1 } : h,
		);
	else found = curveCurve(a, b, eps);
	for (const h of found) addHit(h);

	return hits.sort((p, q) => (p.t1 as number) - (q.t1 as number));
}
