import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, subpaths } from '../dist/index.js';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const Z = { type: 'close' };
const square = [M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z];

test('each subpath as its own path, keeping its close', () => {
	assert.deepEqual(subpaths([...square, M(20, 0), Q(25, 5, 30, 0)]), [
		square,
		[M(20, 0), Q(25, 5, 30, 0)],
	]);
});

test('drawing after a close starts a new subpath at the same start', () => {
	assert.deepEqual(subpaths([...square, L(0, -10)]), [square, [M(0, 0), L(0, -10)]]);
});

test('the same subpaths measure counts, on awkward inputs', () => {
	const inputs = [
		[M(0, 0)],
		[M(0, 0), M(5, 5), L(10, 10)],
		[M(0, 0), Z],
		[M(0, 0), Z, Z, L(5, 0)],
		[M(0, 0), L(5, 0), Z, L(0, 5), Z],
		[M(0, 0), L(5, 0), M(9, 9)],
		[M(1, 1), L(1, 1)], // draws something, of length 0
		[M(1, 1), L(1, 1), Z],
	];
	for (const path of inputs)
		assert.equal(
			subpaths(path).length,
			measure(path).subpathLengths.length,
			JSON.stringify(path),
		);
	assert.deepEqual(subpaths([M(0, 0), Z]), []);
	assert.deepEqual(subpaths([M(0, 0), L(5, 0), M(9, 9)]), [[M(0, 0), L(5, 0)]]);
	assert.deepEqual(subpaths([M(1, 1), L(1, 1), Z]), [[M(1, 1), L(1, 1), Z]]);
});

test('new commands, without extra properties; the input is left alone', () => {
	const path = [
		{ ...M(0, 0), extra: 1 },
		{ ...L(5, 0), extra: 2 },
	];
	const copy = structuredClone(path);
	const [sub] = subpaths(path);
	assert.deepEqual(sub, [M(0, 0), L(5, 0)]);
	assert.notEqual(sub[1], path[1]);
	assert.deepEqual(path, copy);
});

test('invalid input: a TypeError', () => {
	assert.throws(() => subpaths([L(0, 0)]), TypeError);
	assert.throws(() => subpaths([M(0, NaN)]), TypeError);
});
