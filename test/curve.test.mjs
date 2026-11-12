import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvePoint, curveTangent, measure, segments } from '../dist/index.js';
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
