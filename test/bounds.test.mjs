import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bounds } from '../dist/index.js';
import { curveAt, random, randomCubic, randomQuad } from './helpers.mjs';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };

test('nothing drawn: null', () => {
	assert.equal(bounds([]), null);
	assert.equal(bounds([M(5, 5)]), null);
	assert.deepEqual(bounds([M(0, 0), L(1, 1), M(50, 50)]), bounds([M(0, 0), L(1, 1)])); // a trailing moveTo adds nothing
});

test('lines, and the closing line', () => {
	assert.deepEqual(bounds([M(0, 0), L(10, 5), L(-3, 2)]), {
		minX: -3,
		minY: 0,
		maxX: 10,
		maxY: 5,
	});
	assert.deepEqual(bounds([M(1, 1), L(4, 1), L(4, 4), Z]), {
		minX: 1,
		minY: 1,
		maxX: 4,
		maxY: 4,
	});
	assert.deepEqual(bounds([M(2, 3), L(2, 3)]), { minX: 2, minY: 3, maxX: 2, maxY: 3 }); // zero-length: a point
});

test('curves count by their extremes, not their control points', () => {
	// The quadratic's control point is at y = 100, but the curve only reaches 50.
	assert.deepEqual(bounds([M(0, 0), Q(50, 100, 100, 0)]), {
		minX: 0,
		minY: 0,
		maxX: 100,
		maxY: 50,
	});
	// The cubic's control points are at y = 100; the curve reaches 75.
	assert.deepEqual(bounds([M(0, 0), C(0, 100, 100, 100, 100, 0)]), {
		minX: 0,
		minY: 0,
		maxX: 100,
		maxY: 75,
	});
	// An S-curve with extremes in x inside the curve.
	const b = bounds([M(0, 0), C(100, 0, -100, 100, 0, 100)]);
	assert.ok(b.minX < 0 && b.maxX > 0 && b.minX > -100 && b.maxX < 100);
});

test('random curves: the box contains every point and is tight', () => {
	const rnd = random(7);
	for (let i = 0; i < 500; i++) {
		const path = i % 2 ? randomCubic(rnd) : randomQuad(rnd);
		const b = bounds(path);
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (let k = 0; k <= 4000; k++) {
			const p = curveAt(path, k / 4000);
			assert.ok(
				p.x >= b.minX - 1e-9 &&
					p.x <= b.maxX + 1e-9 &&
					p.y >= b.minY - 1e-9 &&
					p.y <= b.maxY + 1e-9,
			);
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
		// Tight: the sampled extremes are within sampling distance of the box.
		for (const [a, e] of [
			[b.minX, minX],
			[b.minY, minY],
			[b.maxX, maxX],
			[b.maxY, maxY],
		])
			assert.ok(Math.abs(a - e) < 1e-3, `box edge ${a} vs sampled ${e}`);
	}
});

test('same result at any scale', () => {
	const path = [M(0, 0), C(10, 40, 90, -40, 100, 0), Q(120, 30, 60, 60), Z];
	const b = bounds(path);
	for (const s of [1e-6, 1e-3, 1e3, 1e6]) {
		const scaled = path.map(c =>
			Object.fromEntries(
				Object.entries(c).map(([k, v]) => [k, typeof v === 'number' ? v * s : v]),
			),
		);
		const bs = bounds(scaled);
		for (const k of ['minX', 'minY', 'maxX', 'maxY'])
			assert.ok(Math.abs(bs[k] / s - b[k]) < 1e-9 * 100, `${k} at scale ${s}`);
	}
});

test('invalid input is a TypeError', () => {
	assert.throws(() => bounds([L(1, 1)]), TypeError); // no moveTo
	assert.throws(() => bounds([M(0, 0), L(NaN, 1)]), TypeError);
	assert.throws(() => bounds([M(0, 0), Q(1, Infinity, 2, 2)]), TypeError);
	assert.throws(() => bounds([M(0, 0), { type: 'arcTo', x: 1, y: 1 }]), TypeError);
	// Extra properties on a command are fine.
	assert.deepEqual(
		bounds([
			{ ...M(0, 0), id: 'a' },
			{ ...L(2, 2), label: 'x' },
		]),
		{ minX: 0, minY: 0, maxX: 2, maxY: 2 },
	);
});
