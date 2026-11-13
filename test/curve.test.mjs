import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvePoint, curveTangent, measure, segments, splitCurve } from '../dist/index.js';
import { random } from './helpers.mjs';

const P = (x, y) => ({ x, y });
const near = (a, b, eps = 1e-12) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;

/** The Bézier formulas written out, as a reference. */
function bernstein(p, t) {
	const u = 1 - t;
	const w =
		p.length === 2
			? [u, t]
			: p.length === 3
				? [u * u, 2 * u * t, t * t]
				: [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
	return {
		x: w.reduce((s, wi, i) => s + wi * p[i].x, 0),
		y: w.reduce((s, wi, i) => s + wi * p[i].y, 0),
	};
}

test('points: the Bézier curve at t, for lines, quadratics and cubics', () => {
	const rnd = random(4);
	for (let i = 0; i < 300; i++) {
		const p = Array.from({ length: 2 + (i % 3) }, () => P(rnd(-100, 100), rnd(-100, 100)));
		for (const t of [0, 0.25, 0.5, rnd(), 1])
			assert.ok(near(curvePoint(p, t), bernstein(p, t), 1e-12));
		// The ends exactly.
		assert.deepEqual(curvePoint(p, 0), p[0]);
		assert.deepEqual(curvePoint(p, 1), p.at(-1));
	}
});

test('tangents: the derivative, as a finite difference of the points shows', () => {
	const rnd = random(5);
	for (let i = 0; i < 300; i++) {
		const p = Array.from({ length: 2 + (i % 3) }, () => P(rnd(-100, 100), rnd(-100, 100)));
		const t = rnd(0.01, 0.99);
		const h = 1e-6;
		const a = curvePoint(p, t - h);
		const b = curvePoint(p, t + h);
		const fd = P((b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h));
		const d = curveTangent(p, t);
		assert.ok(
			Math.hypot(d.x - fd.x, d.y - fd.y) <= 1e-5 * Math.max(1, Math.hypot(d.x, d.y)),
		);
	}
	// Zero where the curve stops: a cubic whose first control point is on its start.
	assert.deepEqual(curveTangent([P(0, 0), P(0, 0), P(10, 0), P(10, 5)], 0), P(0, 0));
});

test("segments from segments() work too, and agree with measure's points", () => {
	const path = [
		{ type: 'moveTo', x: 0, y: 0 },
		{ type: 'cubicTo', c1x: 0, c1y: 100, c2x: 100, c2y: 100, x: 100, y: 0 },
	];
	const [seg] = segments(path);
	assert.deepEqual(curvePoint(seg, 0.5), curvePoint([seg.p0, seg.p1, seg.p2, seg.p3], 0.5));
	// This symmetric arch's middle is at t = 0.5, half its length along.
	assert.ok(near(measure(path).pointAtFraction(0.5), curvePoint(seg, 0.5), 1e-9));
});

test('t is clamped to 0…1; invalid input', () => {
	const p = [P(0, 0), P(5, 10), P(10, 0)];
	assert.deepEqual(curvePoint(p, -1), curvePoint(p, 0));
	assert.deepEqual(curveTangent(p, 2), curveTangent(p, 1));
	assert.throws(() => curvePoint(p, NaN), TypeError);
	assert.throws(() => curvePoint([P(0, 0)], 0.5), TypeError);
	assert.throws(() => curvePoint([P(0, 0), P(NaN, 1)], 0.5), TypeError);
	assert.throws(() => curveTangent({ type: 'arc' }, 0.5), TypeError);
});

const pointsOf = seg =>
	seg.type === 'line'
		? [seg.p0, seg.p1]
		: seg.type === 'quad'
			? [seg.p0, seg.p1, seg.p2]
			: [seg.p0, seg.p1, seg.p2, seg.p3];

test('split: the two parts draw the curve, each reparametrized onto its half', () => {
	const rnd = random(6);
	for (let i = 0; i < 300; i++) {
		const p = Array.from({ length: 2 + (i % 3) }, () => P(rnd(-100, 100), rnd(-100, 100)));
		const t = rnd(0.05, 0.95);
		const [a, b] = splitCurve(p, t);
		const kind = ['line', 'quad', 'cubic'][p.length - 2];
		assert.equal(a.type, kind);
		assert.equal(b.type, kind);
		const pa = pointsOf(a);
		const pb = pointsOf(b);
		// The ends exactly, and the parts meet.
		assert.deepEqual(pa[0], p[0]);
		assert.deepEqual(pb.at(-1), p.at(-1));
		assert.deepEqual(pa.at(-1), pb[0]);
		assert.ok(near(pb[0], bernstein(p, t), 1e-12));
		for (const s of [0, 0.3, 0.7, 1]) {
			assert.ok(near(bernstein(pa, s), bernstein(p, s * t), 1e-11));
			assert.ok(near(bernstein(pb, s), bernstein(p, t + s * (1 - t)), 1e-11));
		}
	}
});

test('split: segments in, new points out; t clamped; invalid input', () => {
	const path = [
		{ type: 'moveTo', x: 0, y: 0 },
		{ type: 'quadTo', cx: 5, cy: 10, x: 10, y: 0 },
	];
	const [seg] = segments(path);
	const [a, b] = splitCurve(seg, 0.5);
	assert.deepEqual(a, { type: 'quad', p0: P(0, 0), p1: P(2.5, 5), p2: P(5, 5) });
	assert.deepEqual(b, { type: 'quad', p0: P(5, 5), p1: P(7.5, 5), p2: P(10, 0) });
	// No point is shared with the input or between the parts.
	assert.notEqual(a.p0, seg.p0);
	assert.notEqual(b.p2, seg.p2);
	assert.notEqual(a.p2, b.p0);

	const p = [P(0, 0), P(0, 10), P(10, 10), P(10, 0)];
	const [before] = splitCurve(p, -1);
	assert.deepEqual(pointsOf(before), [P(0, 0), P(0, 0), P(0, 0), P(0, 0)]);
	assert.deepEqual(splitCurve(p, 2)[0], splitCurve(p, 1)[0]);
	assert.throws(() => splitCurve(p, NaN), TypeError);
	assert.throws(() => splitCurve([P(0, 0)], 0.5), TypeError);
	assert.throws(() => splitCurve({ type: 'arc' }, 0.5), TypeError);
});

test('split at several parameters: n + 1 parts in order, each the curve over its range', () => {
	const rnd = random(7);
	for (let i = 0; i < 300; i++) {
		const p = Array.from({ length: 2 + (i % 3) }, () => P(rnd(-100, 100), rnd(-100, 100)));
		const ts = Array.from({ length: 1 + (i % 5) }, () => rnd(0.02, 0.98));
		const parts = splitCurve(p, ts);
		assert.equal(parts.length, ts.length + 1);
		// Given in any order, split in order.
		const bounds = [0, ...[...ts].sort((a, b) => a - b), 1];
		assert.deepEqual(pointsOf(parts[0])[0], p[0]);
		assert.deepEqual(pointsOf(parts.at(-1)).at(-1), p.at(-1));
		parts.forEach((part, k) => {
			const q = pointsOf(part);
			const [t0, t1] = [bounds[k], bounds[k + 1]];
			if (k > 0) assert.deepEqual(q[0], pointsOf(parts[k - 1]).at(-1));
			for (const s of [0, 0.5, 1])
				assert.ok(near(bernstein(q, s), bernstein(p, t0 + s * (t1 - t0)), 1e-10));
		});
	}
});

test('split at several parameters: one, none, repeats and the ends', () => {
	const p = [P(0, 0), P(0, 10), P(10, 10), P(10, 0)];
	assert.deepEqual(splitCurve(p, [0.3]), splitCurve(p, 0.3));
	const [whole] = splitCurve(p, []);
	assert.deepEqual(pointsOf(whole), p);
	assert.notEqual(whole.p0, p[0]);
	// Every parameter gives a part, a single point where it repeats or is an end.
	const parts = splitCurve(p, [1, 0.5, 0, 0.5]);
	assert.equal(parts.length, 5);
	const point = part =>
		pointsOf(part).every(q => q.x === pointsOf(part)[0].x && q.y === pointsOf(part)[0].y);
	assert.deepEqual(parts.map(point), [true, false, true, false, true]);
	assert.throws(() => splitCurve(p, [0.5, NaN]), TypeError);
});

test('segments() is an array, so it can be indexed', () => {
	const path = [
		{ type: 'moveTo', x: 0, y: 0 },
		{ type: 'lineTo', x: 10, y: 0 },
		{ type: 'quadTo', cx: 15, cy: 5, x: 10, y: 10 },
		{ type: 'close' },
	];
	const segs = segments(path);
	assert.ok(Array.isArray(segs));
	assert.deepEqual(
		segs.map(s => s.type),
		['line', 'quad', 'line'],
	);
	assert.deepEqual(curveTangent(segs[0], 0), P(10, 0));
});
