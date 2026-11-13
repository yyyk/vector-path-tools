import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { curvePoint, measure, measureCurve, pointsAlong, splitCurve } from '../dist/index.js';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };
const P = (x, y) => ({ x, y });
const square = [M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z];
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/** arclen-inputs.txt's curves as paths, with kurbo's lengths and points. */
const kurbo = JSON.parse(
	readFileSync(new URL('./fixtures/arclen-kurbo.json', import.meta.url), 'utf8'),
).map(k => {
	const [kind, ...v] = k.curve.split(' ').map((s, i) => (i ? +s : s));
	const path =
		kind === 'q'
			? [M(v[0], v[1]), Q(v[2], v[3], v[4], v[5])]
			: [M(v[0], v[1]), C(...v.slice(2))];
	return { path, ...k };
});

test('a square: its length, points along it and their directions', () => {
	const m = measure(square);
	assert.equal(m.length, 40);
	assert.deepEqual(m.subpathLengths, [40]);
	assert.deepEqual(m.pointAtLength(5), { x: 5, y: 0, angle: 0 });
	assert.deepEqual(m.pointAtLength(15), { x: 10, y: 5, angle: Math.PI / 2 });
	assert.deepEqual(m.pointAtLength(35), { x: 0, y: 5, angle: -Math.PI / 2 }); // the close line
	assert.deepEqual(m.pointAtFraction(0.5), m.pointAtLength(20));
	// Outside 0…length: clamped.
	assert.deepEqual(m.pointAtLength(-5), m.pointAtLength(0));
	assert.deepEqual(m.pointAtLength(99), m.pointAtLength(40));
});

test('subpaths: one continuous length, the jump at a moveTo counts as 0', () => {
	const m = measure([...square, M(20, 0), L(30, 0)]);
	assert.equal(m.length, 50);
	assert.deepEqual(m.subpathLengths, [40, 10]);
	assert.deepEqual(m.pointAtLength(45), { x: 25, y: 0, angle: 0 });
	// At the boundary: the end of the earlier subpath.
	assert.equal(m.pointAtLength(40).x, 0);
	// After a close, drawing starts a new subpath at the same start.
	assert.deepEqual(measure([...square, L(0, -10)]).subpathLengths, [40, 10]);
});

test("curves: lengths and points within 1e-9 of kurbo's, at every scale (fixtures/arclen-kurbo.json)", () => {
	// Measured: up to 5.1e-10 for lengths and 2.6e-10 for points, on a nearly
	// cusped cubic (test/fixtures/measure-arclen.mjs).
	for (const k of kurbo) {
		const m = measure(k.path);
		assert.ok(near(m.length, k.length, 1e-9), k.curve);
		k.points.forEach(([x, y], j) => {
			const p = m.pointAtFraction((j + 1) / 10);
			assert.ok(Math.hypot(p.x - x, p.y - y) <= 1e-9 * k.length, k.curve);
		});
	}
});

test('the direction follows the curve, and is defined where its speed is zero', () => {
	// A half circle (as two cubics): the direction is perpendicular to the radius.
	const k = 0.5522847498;
	const half = [
		M(50, 0),
		C(50, 50 * k, 50 * k, 50, 0, 50),
		C(-50 * k, 50, -50, 50 * k, -50, 0),
	];
	const m = measure(half);
	for (let i = 1; i < 10; i++) {
		const p = m.pointAtFraction(i / 10);
		const radial = Math.atan2(p.y, p.x);
		assert.ok(Math.abs(Math.cos(p.angle - radial)) < 1e-3);
	}
	// Control points on the ends: zero speed there, but a direction anyway.
	const ends = measure([M(0, 0), C(0, 0, 10, 0, 10, 0)]);
	assert.equal(ends.pointAtLength(0).angle, 0);
	assert.equal(ends.pointAtLength(10).angle, 0);
});

test('the same results, scaled, at any scale', () => {
	const path = [M(0, 0), C(10, 30, 40, -20, 50, 10), Q(70, 40, 20, 30), Z];
	const base = measure(path);
	for (const s of [1e-6, 1e6]) {
		const scaled = measure(
			path.map(c =>
				Object.fromEntries(
					Object.entries(c).map(([key, v]) => [
						key,
						typeof v === 'number' ? v * s : v,
					]),
				),
			),
		);
		assert.ok(near(scaled.length, base.length * s, 1e-12));
		for (let i = 0; i <= 10; i++) {
			const a = base.pointAtFraction(i / 10);
			const b = scaled.pointAtFraction(i / 10);
			assert.ok(Math.hypot(b.x - a.x * s, b.y - a.y * s) <= 1e-12 * base.length * s);
		}
	}
});

test('pointsAlong: even points per subpath; a closed one does not repeat its start', () => {
	const [points] = pointsAlong(square, 5);
	assert.deepEqual(
		points.map(p => [p.x, p.y]),
		[
			[0, 0],
			[5, 0],
			[10, 0],
			[10, 5],
			[10, 10],
			[5, 10],
			[0, 10],
			[0, 5],
		],
	);
	// An open line of length 10 at spacing 3: 3 gaps of 10/3, both ends included.
	const [line] = pointsAlong([M(0, 0), L(10, 0)], 3);
	assert.equal(line.length, 4);
	assert.ok(near(line[1].x, 10 / 3) && line[3].x === 10);
	// One array per subpath that draws something.
	assert.equal(pointsAlong([...square, M(50, 50), M(20, 0), L(30, 0)], 5).length, 2);
});

test('a path that draws nothing', () => {
	for (const path of [[], [M(1, 2)]]) {
		const m = measure(path);
		assert.equal(m.length, 0);
		assert.deepEqual(m.subpathLengths, []);
		assert.equal(m.pointAtLength(0), null);
		assert.deepEqual(pointsAlong(path, 1), []);
	}
});

test('invalid input', () => {
	assert.throws(() => measure([L(1, 1)]), TypeError);
	assert.throws(() => measure([M(0, 0), L(NaN, 1)]), TypeError);
	for (const tolerance of [0, -1, 1, NaN])
		assert.throws(() => measure(square, { tolerance }), RangeError);
	assert.throws(() => measure(square).pointAtLength(NaN), TypeError);
	for (const spacing of [0, -1, NaN, Infinity])
		assert.throws(() => pointsAlong(square, spacing), RangeError);
});

test('measureCurve: the length and points of measure, for one curve', () => {
	const curves = [
		[P(0, 0), P(30, 40)],
		[P(0, 0), P(50, 100), P(100, 0)],
		[P(0, 0), P(0, 100), P(100, 100), P(100, 0)],
	];
	for (const p of curves) {
		const path = [
			M(p[0].x, p[0].y),
			[L, Q, C][p.length - 2](...p.slice(1).flatMap(q => [q.x, q.y])),
		];
		const pm = measure(path);
		const m = measureCurve(p);
		assert.equal(m.length, pm.length);
		for (const f of [0, 0.1, 0.5, 0.77, 1]) {
			const q = curvePoint(p, m.tAtLength(f * m.length));
			const r = pm.pointAtFraction(f);
			assert.ok(Math.hypot(q.x - r.x, q.y - r.y) <= 1e-9 * m.length);
		}
		// Clamped.
		assert.equal(m.tAtLength(-5), 0);
		assert.equal(m.tAtLength(Infinity), 1);
	}
	assert.equal(measureCurve([P(0, 0), P(30, 40)]).tAtLength(25), 0.5);
});

test('measureCurve and splitCurve: parts of the lengths asked for', () => {
	const p = [P(0, 0), P(0, 100), P(100, 100), P(100, 0)];
	const m = measureCurve(p);
	const distances = [10, 50, 120];
	const parts = splitCurve(p, distances.map(m.tAtLength));
	const lengths = parts.map(s => measureCurve(s).length);
	const expected = [10, 40, 70, m.length - 120];
	lengths.forEach((l, i) => assert.ok(near(l, expected[i], 1e-9)));
});

test('measureCurve: invalid input', () => {
	assert.throws(() => measureCurve([P(0, 0)]), TypeError);
	assert.throws(() => measureCurve([P(0, 0), P(1, 1)], { tolerance: 0 }), RangeError);
	assert.throws(() => measureCurve([P(0, 0), P(1, 1)]).tAtLength(NaN), TypeError);
	// A curve that stays at one point.
	const m = measureCurve([P(3, 3), P(3, 3), P(3, 3)]);
	assert.equal(m.length, 0);
	assert.equal(m.tAtLength(1), 1);
});
