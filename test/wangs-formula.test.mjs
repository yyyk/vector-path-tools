// The port of Skia's Wang's formula (an internal module, imported directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cubic, DEFAULT_PRECISION, quadratic } from '../dist/skia/wangs-formula.js';
import { curveAt, random, randomCubic, randomQuad } from './helpers.mjs';

const P = (x, y) => ({ x, y });
const close = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

test('the formula: sqrt(maxLength · precision · n(n − 1)/8)', () => {
	const precision = 4; // tolerance 0.25
	const q = [P(0, 0), P(50, 100), P(100, 0)];
	const mq = Math.hypot(0 - 100 + 100, 0 - 200 + 0); // |p0 − 2p1 + p2|
	assert.ok(close(quadratic(...q, precision), Math.sqrt((mq * precision * 2) / 8)));
	const c = [P(0, 0), P(0, 100), P(100, 100), P(100, 0)];
	const mc = Math.max(
		Math.hypot(0 - 0 + 100, 0 - 200 + 100),
		Math.hypot(0 - 200 + 100, 100 - 200 + 0),
	);
	assert.ok(close(cubic(...c, precision), Math.sqrt((mc * precision * 6) / 8)));
	// Straight curves need no subdivision.
	assert.equal(quadratic(P(0, 0), P(5, 5), P(10, 10), precision), 0);
	assert.equal(cubic(P(0, 0), P(1, 0), P(2, 0), P(3, 0), precision), 0);
});

/** Strict error of cutting a [moveTo, curve] path into n equal steps in t. */
function equalStepError(path, n) {
	let worst = 0;
	for (let i = 0; i < n; i++) {
		const a = curveAt(path, i / n);
		const b = curveAt(path, (i + 1) / n);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const l2 = dx * dx + dy * dy;
		for (let j = 0; j <= 48; j++) {
			const p = curveAt(path, (i + j / 48) / n);
			const t = l2
				? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
				: 0;
			worst = Math.max(worst, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
		}
	}
	return worst;
}

test("precision defaults to 4 (Skia's kPrecision: a quarter of a unit)", () => {
	assert.equal(DEFAULT_PRECISION, 4);
	const q = [P(0, 0), P(50, 100), P(100, 0)];
	const c = [P(0, 0), P(0, 100), P(100, 100), P(100, 0)];
	assert.equal(quadratic(...q), quadratic(...q, 4));
	assert.equal(cubic(...c), cubic(...c, 4));
});

test('its promise: ceil(formula) equal segments stay within 1/precision', () => {
	const rnd = random(23);
	for (let i = 0; i < 600; i++) {
		const tolerance = [0.05, 0.25, 1, 5][i % 4];
		const precision = 1 / tolerance;
		const path = i % 2 ? randomCubic(rnd) : randomQuad(rnd);
		const [m, c] = path;
		const count =
			c.type === 'quadTo'
				? quadratic(P(m.x, m.y), P(c.cx, c.cy), P(c.x, c.y), precision)
				: cubic(P(m.x, m.y), P(c.c1x, c.c1y), P(c.c2x, c.c2y), P(c.x, c.y), precision);
		const n = Math.max(1, Math.ceil(count));
		const err = equalStepError(path, n);
		assert.ok(
			err <= tolerance * (1 + 1e-9),
			`${c.type}: error ${err} > ${tolerance} with ${n} segments`,
		);
	}
});

test("Skia's own results, within 32-bit float precision (fixtures/skia.json)", () => {
	// Skia computes in 32-bit floats, this port in 64-bit: the values agree to
	// about 1e-7 (measured: up to 9.5e-8), and the segment counts exactly.
	const { wang: cases } = JSON.parse(
		readFileSync(new URL('./fixtures/skia.json', import.meta.url), 'utf8'),
	);
	for (const c of cases) {
		const p = c.curve.map(([x, y]) => P(x, y));
		const n = p.length === 3 ? quadratic(...p, c.precision) : cubic(...p, c.precision);
		assert.ok(Math.abs(n - c.n) <= 1e-6 * c.n, `${n} vs ${c.n}`);
		assert.equal(Math.max(1, Math.ceil(n)), Math.max(1, Math.ceil(c.n)));
	}
});
