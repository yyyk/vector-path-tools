import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvePoint, curveTangent, offsetCurve, segments } from '../dist/index.js';
import { random } from './helpers.mjs';

const P = (x, y) => ({ x, y });
const pointsOf = s => (s.type === 'quad' ? [s.p0, s.p1, s.p2] : [s.p0, s.p1, s.p2, s.p3]);

/** The exact offset at t: the point moved by d along the tangent turned 90°. */
function trueOffset(curve, d, t) {
	const p = curvePoint(curve, t);
	const v = curveTangent(curve, t);
	const len = Math.hypot(v.x, v.y);
	return P(p.x - (d * v.y) / len, p.y + (d * v.x) / len);
}

/** Distance from q to f(t), t in 0…1: samples, then golden section at each local minimum. */
function distanceTo(f, q, n = 400) {
	const D = t => {
		const r = f(t);
		return Math.hypot(r.x - q.x, r.y - q.y);
	};
	const ds = Array.from({ length: n + 1 }, (_, i) => D(i / n));
	let best = Math.min(...ds);
	const g = (Math.sqrt(5) - 1) / 2;
	for (let i = 0; i <= n; i++) {
		if ((i > 0 && ds[i - 1] < ds[i]) || (i < n && ds[i + 1] < ds[i])) continue;
		let lo = Math.max(0, i - 1) / n;
		let hi = Math.min(n, i + 1) / n;
		for (let k = 0; k < 60; k++) {
			const m1 = hi - g * (hi - lo);
			const m2 = lo + g * (hi - lo);
			if (D(m1) < D(m2)) hi = m2;
			else lo = m1;
		}
		best = Math.min(best, D((lo + hi) / 2));
	}
	return best;
}

/** The largest gap between the segments and the exact offset, both ways. */
function gap(curve, d, segs) {
	const truth = t => trueOffset(curve, d, t);
	let worst = 0;
	for (const s of segs)
		for (let i = 0; i <= 16; i++)
			worst = Math.max(worst, distanceTo(truth, curvePoint(pointsOf(s), i / 16)));
	for (let i = 1; i < 128; i++) {
		const q = truth(i / 128);
		worst = Math.max(
			worst,
			Math.min(...segs.map(s => distanceTo(t => curvePoint(pointsOf(s), t), q, 32))),
		);
	}
	return worst;
}

test('a line moves sideways; positive distances are on the side of (-dy, dx)', () => {
	assert.deepEqual(offsetCurve([P(0, 0), P(10, 0)], 2), [
		{ type: 'line', p0: P(0, 2), p1: P(10, 2) },
	]);
	assert.deepEqual(offsetCurve([P(0, 0), P(0, 10)], 2), [
		{ type: 'line', p0: P(-2, 0), p1: P(-2, 10) },
	]);
	// Straight curves stay one segment of their kind.
	const [q] = offsetCurve([P(0, 0), P(3, 0), P(10, 0)], -2);
	assert.equal(q.type, 'quad');
	for (const p of pointsOf(q)) assert.equal(p.y, -2);
});

test('curves are within the tolerance of the exact offset, folds included', () => {
	const rnd = random(11);
	for (let i = 0; i < 40; i++) {
		const curve = Array.from({ length: 3 + (i % 2) }, () =>
			P(rnd(-100, 100), rnd(-100, 100)),
		);
		for (const [d, tolerance] of [
			[rnd(1, 20), 0.25],
			[-rnd(1, 20), 0.01],
			[rnd(30, 80), 0.25], // large enough to fold on many of these
		]) {
			const segs = offsetCurve(curve, d, { tolerance });
			assert.ok(segs.length > 0);
			assert.ok(segs.every(s => s.type === (curve.length === 3 ? 'quad' : 'cubic')));
			// The check inside samples 7 points per segment: allow 10% over.
			assert.ok(
				gap(curve, d, segs) <= 1.1 * tolerance,
				`${JSON.stringify(curve)} by ${d}`,
			);
		}
	}
});

test('a smaller tolerance gives more segments', () => {
	const curve = [P(0, 0), P(150, 100), P(-50, 100), P(100, 0)];
	const counts = [1, 0.25, 0.01, 1e-4].map(
		tolerance => offsetCurve(curve, 5, { tolerance }).length,
	);
	for (let i = 1; i < counts.length; i++)
		assert.ok(counts[i] >= counts[i - 1], String(counts));
	assert.ok(counts.at(-1) > counts[0]);
});

test('the same result, scaled, at any scale (with the tolerance scaled too)', () => {
	const curve = [P(0, 0), P(100, 100), P(0, 100), P(100, 0)]; // a cusp
	const base = offsetCurve(curve, 5, { tolerance: 0.01 });
	for (const s of [1e-4, 1e6]) {
		const scaled = offsetCurve(
			curve.map(p => P(p.x * s, p.y * s)),
			5 * s,
			{ tolerance: 0.01 * s },
		);
		assert.equal(scaled.length, base.length);
		scaled.forEach((seg, k) =>
			pointsOf(seg).forEach((p, j) => {
				const b = pointsOf(base[k])[j];
				assert.ok(Math.hypot(p.x / s - b.x, p.y / s - b.y) <= 1e-9 * 100);
			}),
		);
	}
});

test('where the offset folds, a segment ends at its cusp', () => {
	// The arch's tightest radius of curvature is 37.5, at its top: offset by 50
	// on its inner side, the exact offset has two cusps.
	const arch = [P(0, 0), P(0, 100), P(100, 100), P(100, 0)];
	const segs = offsetCurve(arch, -50);
	// Where the offset's direction reverses, its speed is zero: find those t.
	const speed = t => {
		const a = trueOffset(arch, -50, t - 1e-7);
		const b = trueOffset(arch, -50, t + 1e-7);
		return Math.hypot(b.x - a.x, b.y - a.y);
	};
	for (const [lo, hi] of [
		[0.05, 0.5],
		[0.5, 0.95],
	]) {
		let best = lo;
		for (let t = lo; t <= hi; t += 1e-4) if (speed(t) < speed(best)) best = t;
		const cusp = trueOffset(arch, -50, best);
		assert.ok(
			segs.some(s => Math.hypot(s.p3.x - cusp.x, s.p3.y - cusp.y) < 0.05),
			JSON.stringify(cusp),
		);
	}
});

test('segments from segments() and plain points give the same result; distance 0 is the curve', () => {
	const path = [
		{ type: 'moveTo', x: 0, y: 0 },
		{ type: 'cubicTo', c1x: 10, c1y: 30, c2x: 40, c2y: -20, x: 50, y: 10 },
	];
	const [seg] = segments(path);
	const points = [P(0, 0), P(10, 30), P(40, -20), P(50, 10)];
	assert.deepEqual(offsetCurve(seg, 3), offsetCurve(points, 3));
	assert.deepEqual(offsetCurve(seg, 0), [seg]);
	// A line or curve collapsed to a point has no offset.
	assert.deepEqual(offsetCurve([P(1, 1), P(1, 1)], 3), []);
	assert.deepEqual(offsetCurve([P(1, 1), P(1, 1), P(1, 1), P(1, 1)], 3), []);
});

test('invalid input', () => {
	const curve = [P(0, 0), P(10, 10), P(20, 0)];
	assert.throws(() => offsetCurve([P(0, 0)], 1), TypeError);
	assert.throws(() => offsetCurve([P(0, 0), P(NaN, 1)], 1), TypeError);
	for (const d of [NaN, Infinity]) assert.throws(() => offsetCurve(curve, d), TypeError);
	for (const tolerance of [0, -1, NaN, Infinity])
		assert.throws(() => offsetCurve(curve, 1, { tolerance }), RangeError);
});
