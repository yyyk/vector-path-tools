import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contains, flatten } from '../dist/index.js';
import { random } from './helpers.mjs';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };
const METHODS = ['skia', 'fonttools'];
const square = (x, y, s, clockwise = true) =>
	clockwise
		? [M(x, y), L(x + s, y), L(x + s, y + s), L(x, y + s), Z]
		: [M(x, y), L(x, y + s), L(x + s, y + s), L(x + s, y), Z];

/** Fixture commands (["M", x, y], ["Q", cx, cy, x, y], ...) as path commands. */
const fromFixture = c =>
	c[0] === 'M'
		? M(c[1], c[2])
		: c[0] === 'L'
			? L(c[1], c[2])
			: c[0] === 'Q'
				? Q(c[1], c[2], c[3], c[4])
				: c[0] === 'C'
					? C(c[1], c[2], c[3], c[4], c[5], c[6])
					: Z;

test('a square: inside, outside, and nothing for an empty path', () => {
	const sq = square(0, 0, 10);
	for (const method of METHODS) {
		assert.equal(contains(sq, 5, 5, { method }), true, method);
		assert.equal(contains(sq, 15, 5, { method }), false, method);
		assert.equal(contains(sq, 5, -1, { method }), false, method);
		assert.equal(contains([], 0, 0, { method }), false, method);
		assert.equal(contains([M(0, 0)], 0, 0, { method }), false, method);
	}
});

test('fill rules: holes, and nested subpaths wound the same way', () => {
	const hole = [...square(0, 0, 30), ...square(10, 10, 10, false)]; // inner wound the other way
	const same = [...square(0, 0, 30), ...square(10, 10, 10)]; // inner wound the same way
	for (const method of METHODS) {
		assert.equal(contains(hole, 15, 15, { method }), false, method);
		assert.equal(contains(hole, 5, 5, { method }), true, method);
		assert.equal(contains(same, 15, 15, { method }), true, method); // winds twice
	}
	for (const method of METHODS) {
		const fillRule = 'evenodd';
		assert.equal(contains(hole, 15, 15, { method, fillRule }), false, method);
		assert.equal(contains(same, 15, 15, { method, fillRule }), false, method); // crosses twice
	}
});

test('open subpaths are filled as if closed', () => {
	const open = [M(0, 0), L(10, 0), L(10, 10)];
	for (const method of METHODS) {
		assert.equal(contains(open, 8, 2, { method }), true, method);
		assert.equal(contains(open, 2, 8, { method }), false, method);
	}
});

test('a drawing command right after close starts again at the subpath start', () => {
	// The triangle after Z starts at (0, 0), not at (0, 10).
	const path = [...square(0, 0, 10), L(-10, 0), L(-10, -10), Z];
	for (const method of METHODS)
		assert.equal(contains(path, -8, -2, { method }), true, method);
});

test('skia: a point on the boundary counts as inside', () => {
	const sq = square(0, 0, 10);
	assert.equal(contains(sq, 0, 5), true);
	assert.equal(contains(sq, 5, 0), true);
	assert.equal(contains(sq, 10, 10), true);
});

test('curves: exact, not their control points', () => {
	// The arch's control points reach y = -100, the curve only -75.
	const arch = [M(0, 0), C(0, -100, 100, -100, 100, 0), Z];
	// A quadratic bump: apex at y = -50.
	const bump = [M(0, 0), Q(50, -100, 100, 0), Z];
	for (const method of METHODS) {
		assert.equal(contains(arch, 50, -74, { method }), true, method);
		assert.equal(contains(arch, 50, -76, { method }), false, method);
		assert.equal(contains(bump, 50, -49.9, { method }), true, method);
		assert.equal(contains(bump, 50, -50.1, { method }), false, method);
	}
});

test("skia: the same answers as Skia's SkPath::contains (fixtures/skia.json)", () => {
	// Skia's inputs are 32-bit floats; JavaScript reads the printed values back
	// exactly, so both see the same numbers.
	const { contains: cases } = JSON.parse(
		readFileSync(new URL('./fixtures/skia.json', import.meta.url), 'utf8'),
	);
	for (const c of cases) {
		const path = c.commands.map(fromFixture);
		c.points.forEach(([x, y], i) => {
			for (const fillRule of ['nonzero', 'evenodd'])
				assert.equal(
					contains(path, x, y, { method: 'skia', fillRule }),
					c[fillRule][i],
				);
		});
	}
});

test("fonttools: the same answers as fontTools' PointInsidePen (fixtures/point-inside.json)", () => {
	const cases = JSON.parse(
		readFileSync(new URL('./fixtures/point-inside.json', import.meta.url), 'utf8'),
	);
	for (const c of cases) {
		const path = c.commands.map(fromFixture);
		c.points.forEach(([x, y], i) => {
			for (const fillRule of ['nonzero', 'evenodd'])
				assert.equal(
					contains(path, x, y, { method: 'fonttools', fillRule }),
					c[fillRule][i],
				);
		});
	}
});

/** Polygon winding (a plain reference implementation for the tests). */
function polygonWinding(flat, x, y) {
	let w = 0;
	let start = null;
	let prev = null;
	const edge = (a, b) => {
		if (a.y <= y && y < b.y && a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x) > x) w++;
		else if (b.y <= y && y < a.y && a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x) > x) w--;
	};
	for (const c of flat) {
		if (c.type === 'moveTo') {
			if (prev && start) edge(prev, start);
			start = prev = c;
		} else if (c.type === 'lineTo') {
			edge(prev, c);
			prev = c;
		} else {
			edge(prev, start);
			prev = start;
		}
	}
	if (prev && start) edge(prev, start);
	return w;
}

function distanceToPolyline(flat, x, y) {
	let best = Infinity;
	let prev = null;
	let start = null;
	const seg = (a, b) => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const l2 = dx * dx + dy * dy;
		const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
		best = Math.min(best, Math.hypot(x - a.x - dx * t, y - a.y - dy * t));
	};
	for (const c of flat) {
		if (c.type === 'moveTo') {
			if (prev && start) seg(prev, start);
			start = prev = c;
		} else if (c.type === 'lineTo') {
			seg(prev, c);
			prev = c;
		} else {
			seg(prev, start);
			prev = start;
		}
	}
	if (prev && start) seg(prev, start);
	return best;
}

test('all three agree with a finely flattened polygon away from the boundary', () => {
	const rnd = random(31);
	const tolerance = 1e-4;
	let checked = 0;
	for (let shape = 0; shape < 60; shape++) {
		// Two closed subpaths of random quadratics and cubics, overlapping.
		const path = [];
		for (let sub = 0; sub < 2; sub++) {
			path.push(M(rnd(-50, 50), rnd(-50, 50)));
			for (let k = 0; k < 3; k++) {
				const r = () => rnd(-60, 60);
				path.push(
					rnd() < 0.5 ? Q(r(), r(), r(), r()) : C(r(), r(), r(), r(), r(), r()),
				);
			}
			path.push(Z);
		}
		const flat = flatten(path, tolerance);
		for (let i = 0; i < 80; i++) {
			const x = rnd(-70, 70);
			const y = rnd(-70, 70);
			// Skia counts points within 1/4096 of the curve as on it.
			if (distanceToPolyline(flat, x, y) < 0.01) continue;
			const w = polygonWinding(flat, x, y);
			for (const method of METHODS)
				assert.equal(
					contains(path, x, y, { method }),
					w !== 0,
					`${method}, shape ${shape}`,
				);
			for (const method of ['skia', 'fonttools'])
				assert.equal(
					contains(path, x, y, { method, fillRule: 'evenodd' }),
					w % 2 !== 0,
				);
			checked++;
		}
	}
	assert.ok(checked > 4000);
});

test('invalid input', () => {
	const sq = square(0, 0, 1);
	assert.throws(() => contains(sq, 0.5, 0.5, { method: 'cairo' }), TypeError);
	assert.throws(() => contains(sq, 0.5, 0.5, { fillRule: 'winding' }), TypeError);
	assert.throws(() => contains(sq, NaN, 0), TypeError);
	assert.throws(() => contains([L(1, 1)], 0, 0), TypeError);
	assert.throws(() => contains([M(0, 0), L(NaN, 1)], 0, 0), TypeError);
});
