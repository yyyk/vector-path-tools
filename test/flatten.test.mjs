import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bounds, flatten } from '../dist/index.js';
import { curveSamples } from '../dist/flatten.js';
import {
	controls,
	random,
	randomCubic,
	randomQuad,
	sampledDeviation,
	uniformDeviation,
} from './helpers.mjs';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };
const lines = flat => flat.filter(c => c.type === 'lineTo').length;

test('only moveTo, lineTo and close come out; lines and end points are kept exactly', () => {
	const path = [
		M(0, 0),
		L(10, 0),
		Q(20, 10, 30, 0),
		C(40, -10, 50, 10, 60, 0),
		Z,
		M(100, 100),
		L(110, 110),
	];
	for (const method of ['uniform', 'adaptive']) {
		const flat = flatten(path, 0.1, { method });
		assert.ok(flat.every(c => ['moveTo', 'lineTo', 'close'].includes(c.type)));
		assert.deepEqual(flat[0], M(0, 0));
		assert.deepEqual(flat[1], L(10, 0));
		const ends = flat.filter(c => c.type === 'lineTo').map(c => `${c.x},${c.y}`);
		for (const e of ['30,0', '60,0', '110,110'])
			assert.ok(ends.includes(e), `${e} kept exactly (${method})`);
		assert.equal(flat.filter(c => c.type === 'close').length, 1);
		assert.equal(flat.filter(c => c.type === 'moveTo').length, 2);
	}
});

test('uniform: random curves never exceed the tolerance', () => {
	const rnd = random(3);
	for (let i = 0; i < 600; i++) {
		const path = i % 2 ? randomCubic(rnd) : randomQuad(rnd);
		const tolerance = [0.05, 0.25, 1, 5][i % 4];
		const err = uniformDeviation(path, flatten(path, tolerance));
		assert.ok(err <= tolerance * (1 + 1e-9), `error ${err} > tolerance ${tolerance}`);
	}
});

test('adaptive: random quadratics stay within ~6% of the tolerance, with fewer lines than uniform', () => {
	// kurbo's flattening rests on approximations accurate to a few percent
	// (measured: up to 1.058× the tolerance on random quadratics).
	const rnd = random(5);
	let adaptiveLines = 0;
	let uniformLines = 0;
	for (let i = 0; i < 600; i++) {
		const path = randomQuad(rnd);
		const [xs, ys] = controls(path);
		const tolerance = [0.05, 0.25, 1, 5][i % 4];
		const samples = curveSamples('adaptive', xs, ys, tolerance);
		const err = sampledDeviation(path, samples);
		assert.ok(err <= 1.07 * tolerance, `error ${err} > 1.07 × ${tolerance}`);
		// flatten puts exactly these points in, then the exact end point.
		const flat = flatten(path, tolerance, { method: 'adaptive' });
		assert.deepEqual(
			flat.slice(1, -1).map(c => [c.x, c.y]),
			samples.map(p => [p.x, p.y]),
		);
		adaptiveLines += samples.length + 1;
		uniformLines += curveSamples('uniform', xs, ys, tolerance).length + 1;
	}
	assert.ok(adaptiveLines < 0.85 * uniformLines, `${adaptiveLines} vs ${uniformLines}`);
});

test("adaptive: random cubics, through kurbo's quadratics", () => {
	// kurbo spreads one count over all the quadratics, so the tolerance is "not
	// absolutely guaranteed" (measured: up to 2.64× the tolerance here).
	const rnd = random(6);
	let worst = 0;
	for (let i = 0; i < 600; i++) {
		const path = randomCubic(rnd);
		const [xs, ys] = controls(path);
		const tolerance = [0.05, 0.25, 1, 5][i % 4];
		const samples = curveSamples('adaptive', xs, ys, tolerance);
		worst = Math.max(worst, sampledDeviation(path, samples) / tolerance);
		const flat = flatten(path, tolerance, { method: 'adaptive' });
		assert.deepEqual(
			flat.slice(1, -1).map(c => [c.x, c.y]),
			samples.map(p => [p.x, p.y]),
		);
	}
	assert.ok(worst <= 2.7, `worst ${worst}× the tolerance`);
});

test('adaptive: a quadratic on a line is one line, as in kurbo', () => {
	// kurbo: a collinear quadratic has no parabola to map to (val = 0), so one
	// line, even when its control point makes it overshoot and come back.
	assert.equal(lines(flatten([M(0, 0), Q(5, 0, 10, 0)], 0.25, { method: 'adaptive' })), 1);
	assert.equal(lines(flatten([M(0, 0), Q(20, 0, 10, 0)], 0.25, { method: 'adaptive' })), 1);
});

test('a looser tolerance never needs more lines', () => {
	const path = [M(0, 0), C(0, 100, 100, 100, 100, 0)];
	for (const method of ['uniform', 'adaptive']) {
		let previous = Infinity;
		for (const tolerance of [0.01, 0.05, 0.1, 0.5, 1, 5, 20]) {
			const n = lines(flatten(path, tolerance, { method }));
			assert.ok(n <= previous, method);
			previous = n;
		}
	}
});

test('straight curves become one line', () => {
	for (const method of ['uniform', 'adaptive']) {
		assert.equal(lines(flatten([M(0, 0), Q(5, 5, 10, 10)], 0.1, { method })), 1);
		assert.equal(lines(flatten([M(0, 0), C(1, 0, 2, 0, 3, 0)], 0.1, { method })), 1);
	}
});

test('drawing continues from the subpath start after close', () => {
	const flat = flatten([M(0, 0), L(10, 0), L(10, 10), Z, Q(5, -20, 10, 0)], 0.5);
	// The curve after Z starts at (0, 0), so its first line starts there.
	const afterClose = flat.slice(flat.findIndex(c => c.type === 'close') + 1);
	const path = [M(0, 0), Q(5, -20, 10, 0)];
	assert.deepEqual(afterClose, flatten(path, 0.5).slice(1));
});

test('uniform: same result at any scale', () => {
	const path = [M(0, 0), C(10, 40, 90, -40, 100, 0)];
	for (const method of ['uniform']) {
		const n = lines(flatten(path, 0.1, { method }));
		for (const s of [1e-6, 1e-3, 1e3, 1e6]) {
			const scaled = path.map(c =>
				Object.fromEntries(
					Object.entries(c).map(([k, v]) => [k, typeof v === 'number' ? v * s : v]),
				),
			);
			assert.equal(
				lines(flatten(scaled, 0.1 * s, { method })),
				n,
				`${method} at scale ${s}`,
			);
		}
	}
});

test('invalid input', () => {
	for (const tolerance of [0, -1, NaN, Infinity])
		assert.throws(() => flatten([M(0, 0)], tolerance), RangeError);
	assert.throws(() => flatten([M(0, 0)], 1, { method: 'fast' }), TypeError);
	assert.throws(() => flatten([L(1, 1)], 1), TypeError);
	assert.throws(() => flatten([M(0, 0), C(0, 0, NaN, 0, 1, 1)], 1), TypeError);
});

test("adaptive: bit-identical to kurbo's flatten (fixtures/kurbo.json)", () => {
	const { flatten: cases } = JSON.parse(
		readFileSync(new URL('./fixtures/kurbo.json', import.meta.url), 'utf8'),
	);
	for (const c of cases) {
		const [p0, p1, p2, p3] = c.curve;
		const curve = p3
			? C(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1])
			: Q(p1[0], p1[1], p2[0], p2[1]);
		const out = flatten([M(p0[0], p0[1]), curve], c.tol, { method: 'adaptive' });
		assert.deepEqual(
			out.slice(1).map(l => [l.x, l.y]),
			c.out,
		);
	}
});

test('tolerance defaults to 0.25', () => {
	const path = [M(0, 0), C(0, 100, 100, 100, 100, 0)];
	for (const method of ['uniform', 'adaptive'])
		assert.deepEqual(flatten(path, undefined, { method }), flatten(path, 0.25, { method }));
	assert.deepEqual(flatten(path), flatten(path, 0.25));
});
