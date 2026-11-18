import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, splitPath } from '../dist/index.js';
import { random, randomCubic } from './helpers.mjs';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };
const square = [M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z]; // length 40
const eps = 1e-10 * 40; // the default tolerance, times the square's length

test('an open subpath: n cuts give n + 1 pieces', () => {
	const path = [M(0, 0), L(10, 0), L(10, 10)];
	assert.deepEqual(splitPath(path, [5]), [
		[M(0, 0), L(5, 0)],
		[M(5, 0), L(10, 0), L(10, 10)],
	]);
	assert.deepEqual(splitPath(path, [15, 5]), [
		[M(0, 0), L(5, 0)],
		[M(5, 0), L(10, 0), L(10, 5)],
		[M(10, 5), L(10, 10)],
	]);
	// At a joint: no sliver of a segment, even off by a rounding error.
	assert.deepEqual(splitPath(path, [10 + 1e-12]), [
		[M(0, 0), L(10, 0)],
		[M(10, 0), L(10, 10)],
	]);
});

test('an open subpath: cuts at its ends are dropped, within the tolerance', () => {
	const path = [M(0, 0), L(10, 0)];
	assert.deepEqual(splitPath(path, [0, 10, -5, 99, 1e-13, 10 - 1e-13]), [path]);
});

test('a closed subpath: no cuts leave it unchanged, still closed', () => {
	assert.deepEqual(splitPath(square, []), [square]);
});

test('a closed subpath: n cuts give n open pieces, the last across the start', () => {
	assert.deepEqual(splitPath(square, [5]), [
		[M(5, 0), L(10, 0), L(10, 10), L(0, 10), L(0, 0), L(5, 0)],
	]);
	assert.deepEqual(splitPath(square, [15, 5, 25]), [
		[M(5, 0), L(10, 0), L(10, 5)],
		[M(10, 5), L(10, 10), L(5, 10)],
		[M(5, 10), L(0, 10), L(0, 0), L(5, 0)],
	]);
	// A cut at the start splits it open there; the full length is the same point.
	const open = [[M(0, 0), L(10, 0), L(10, 10), L(0, 10), L(0, 0)]];
	assert.deepEqual(splitPath(square, [0]), open);
	assert.deepEqual(splitPath(square, [40]), open);
	assert.deepEqual(splitPath(square, [40 - 1e-13]), open);
	assert.deepEqual(splitPath(square, [0, 40, 0]), open);
	assert.equal(splitPath(square, [0, 10, 20, 30]).length, 4);
});

test('duplicates: dropped within the tolerance of the last cut kept', () => {
	assert.equal(splitPath(square, [5, 5, 5 + 1e-13]).length, 1);
	// 0.6ε is within ε of 0, 1.2ε isn't, and 1.8ε is within ε of 1.2ε.
	const pieces = splitPath(square, [0, 0.6 * eps, 1.2 * eps, 1.8 * eps]);
	assert.equal(pieces.length, 2);
	assert.deepEqual(pieces[0], [M(0, 0), L(1.2 * eps, 0)]);
});

test('zero-length subpaths have no cuts, open or closed', () => {
	assert.deepEqual(splitPath([M(1, 1), L(1, 1)], [0, 0.5, 1]), [[M(1, 1), L(1, 1)]]);
	assert.deepEqual(splitPath([M(1, 1), L(1, 1), Z], [0, 0.5, 1]), [[M(1, 1), L(1, 1), Z]]);
});

test('distances run on across subpaths; pieces never cross a moveTo', () => {
	const path = [M(0, 0), L(10, 0), M(20, 0), L(30, 0)];
	assert.deepEqual(splitPath(path, [5, 15]), [
		[M(0, 0), L(5, 0)],
		[M(5, 0), L(10, 0)],
		[M(20, 0), L(25, 0)],
		[M(25, 0), L(30, 0)],
	]);
	// At a boundary: the end of the earlier subpath. Open, that's dropped...
	assert.deepEqual(splitPath(path, [10]), [
		[M(0, 0), L(10, 0)],
		[M(20, 0), L(30, 0)],
	]);
	// ...closed, it's the same point as its start.
	assert.deepEqual(splitPath([...square, ...path], [40]), [
		[M(0, 0), L(10, 0), L(10, 10), L(0, 10), L(0, 0)],
		[M(0, 0), L(10, 0)],
		[M(20, 0), L(30, 0)],
	]);
	// Subpaths that draw nothing are dropped.
	assert.deepEqual(splitPath([M(9, 9), ...path, M(5, 5)], []), [
		[M(0, 0), L(10, 0)],
		[M(20, 0), L(30, 0)],
	]);
	assert.deepEqual(splitPath([M(9, 9)], [1]), []);
});

test('curves: pieces of the lengths asked for, joining exactly', () => {
	const rnd = random(5);
	for (let i = 0; i < 50; i++) {
		const path = [...randomCubic(rnd), C(0, 0, 50, 50, 0, 0), Z];
		const total = measure(path).length;
		const cuts = [0.1, 0.25, 0.5, 0.7, 0.9].map(f => f * total);
		const pieces = splitPath(path, cuts);
		assert.equal(pieces.length, 5);
		const lengths = pieces.map(p => measure(p).length);
		const expected = [0.15, 0.25, 0.2, 0.2, 0.2].map(f => f * total);
		lengths.forEach((l, k) =>
			assert.ok(Math.abs(l - expected[k]) < 1e-8 * total, `${i}: ${k}`),
		);
		// Each piece starts exactly where the one before ends, the last where
		// the first starts.
		pieces.forEach((p, k) => {
			const next = pieces[(k + 1) % pieces.length][0];
			const end = p[p.length - 1];
			assert.deepEqual([end.x, end.y], [next.x, next.y]);
			assert.ok(p.every(c => c.type !== 'close'));
		});
	}
});

test('new commands; the input is left alone', () => {
	const path = [{ ...M(0, 0), extra: 1 }, L(10, 0)];
	const copy = structuredClone(path);
	const [whole] = splitPath(path, []);
	assert.deepEqual(whole, [M(0, 0), L(10, 0)]);
	assert.deepEqual(path, copy);
});

test('invalid input: errors', () => {
	assert.throws(() => splitPath(square, [NaN]), TypeError);
	assert.throws(() => splitPath([L(0, 0)], []), TypeError);
	assert.throws(() => splitPath(square, [], { tolerance: 0 }), RangeError);
});
