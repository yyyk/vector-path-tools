import { test } from 'node:test';
import assert from 'node:assert/strict';
import { area, flatten, measure } from '../dist/index.js';
import { random, randomCubic, randomQuad } from './helpers.mjs';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };

/** The shoelace area of one closed subpath of lines, relative to its start. */
function shoelace(lines) {
	const [o, ...rest] = lines.filter(c => c.type !== 'close');
	let twice = 0;
	let last = { x: 0, y: 0 };
	for (const c of rest) {
		const p = { x: c.x - o.x, y: c.y - o.y };
		twice += last.x * p.y - p.x * last.y;
		last = p;
	}
	return twice / 2;
}

test('positive clockwise on screen (y down), negative the other way', () => {
	assert.equal(area([M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z]), 100);
	assert.equal(area([M(0, 0), L(0, 10), L(10, 10), L(10, 0), Z]), -100);
});

test('open subpaths count as closed; subpaths add up', () => {
	assert.equal(area([M(0, 0), L(10, 0), L(10, 10), L(0, 10)]), 100);
	// A hole running the other way.
	const outer = [M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z];
	const hole = [M(2, 2), L(2, 8), L(8, 8), L(8, 2), Z];
	assert.equal(area([...outer, ...hole]), 64);
	assert.equal(area([M(0, 0)]), 0);
	assert.equal(area([M(0, 0), L(10, 0)]), 0);
});

test('a parabola segment: exactly 2/3 of its box', () => {
	// Height 1 at x = 1, over 0…2: 4/3, running counterclockwise on screen.
	assert.ok(Math.abs(area([M(0, 0), Q(1, 2, 2, 0), Z]) + 4 / 3) < 1e-15);
});

test('curves: as a fine flattening, within its error', () => {
	const rnd = random(7);
	for (let i = 0; i < 200; i++) {
		const path = [...(i % 2 ? randomCubic : randomQuad)(rnd), L(0, 0), Z];
		// Lines within 1e-5 of the curve: the area differs by less than 1e-5 per
		// unit of length.
		const expected = shoelace(flatten(path, 1e-5));
		assert.ok(Math.abs(area(path) - expected) < 1e-5 * measure(path).length, String(i));
	}
});

test('cubics: as integrating x dy − y dx exactly', () => {
	// x·y′ − y·x′ is of degree 5: 3-point Gauss–Legendre is exact for it.
	const nodes = [
		[0.5, 8 / 18],
		[0.5 - Math.sqrt(0.15), 5 / 18],
		[0.5 + Math.sqrt(0.15), 5 / 18],
	];
	const rnd = random(3);
	for (let i = 0; i < 100; i++) {
		const [m, c] = randomCubic(rnd);
		const xs = [m.x, c.c1x, c.c2x, c.x];
		const ys = [m.y, c.c1y, c.c2y, c.y];
		const at = (v, t) => {
			const u = 1 - t;
			return (
				u * u * u * v[0] +
				3 * u * u * t * v[1] +
				3 * u * t * t * v[2] +
				t * t * t * v[3]
			);
		};
		const d = (v, t) => {
			const u = 1 - t;
			return (
				3 * (u * u * (v[1] - v[0]) + 2 * u * t * (v[2] - v[1]) + t * t * (v[3] - v[2]))
			);
		};
		let twice = 0;
		for (const [t, w] of nodes) twice += w * (at(xs, t) * d(ys, t) - at(ys, t) * d(xs, t));
		// The closing line from the end to the start.
		twice += c.x * m.y - m.x * c.y;
		assert.ok(Math.abs(area([m, c]) - twice / 2) < 1e-9, String(i));
	}
});

test('moved far from the origin: the same area', () => {
	const rnd = random(7);
	for (let i = 0; i < 200; i++) {
		const path = [...(i % 2 ? randomCubic : randomQuad)(rnd), L(0, 0), Z];
		const moved = path.map(c => {
			const m = { ...c };
			for (const k of Object.keys(c)) if (k !== 'type') m[k] = c[k] + 1e5;
			return m;
		});
		// Coordinates of 1e5 have rounding errors of about 1e-11, times sizes of 100.
		assert.ok(Math.abs(area(moved) - area(path)) < 1e-7, String(i));
	}
});

test('a circle of four cubics: about π r²', () => {
	const k = 0.5522847498 * 50;
	const circle = [
		M(50, 0),
		C(50, k, k, 50, 0, 50),
		C(-k, 50, -50, k, -50, 0),
		C(-50, -k, -k, -50, 0, -50),
		C(k, -50, 50, -k, 50, 0),
		Z,
	];
	assert.ok(Math.abs(area(circle) / (Math.PI * 2500) - 1) < 1e-3);
});
