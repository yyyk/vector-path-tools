import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApproxNotFoundError, toQuadratics } from '../dist/index.js';
import { colomitchi, computeInflexion } from '../dist/caffeineowl/bezier-utils.js';
import { curveToQuadratic } from '../dist/fonttools/cu2qu.js';
import { toQuads } from '../dist/kurbo/to-quads.js';
import { curveAt, random, randomCubic } from './helpers.mjs';

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };
const METHODS = [
	'kurbo',
	'fonttools',
	'colomitchi-half',
	'colomitchi-adaptive',
	'colomitchi-symmetric',
];
const quads = out => out.filter(c => c.type === 'quadTo');

/** Dense points along the quadratics that replaced a cubic starting at (x0, y0). */
function quadPoints(x0, y0, qs, per = 200) {
	const pts = [];
	let x = x0;
	let y = y0;
	for (const q of qs) {
		for (let i = 0; i <= per; i++) {
			const t = i / per;
			const u = 1 - t;
			pts.push({
				x: u * u * x + 2 * u * t * q.cx + t * t * q.x,
				y: u * u * y + 2 * u * t * q.cy + t * t * q.y,
			});
		}
		x = q.x;
		y = q.y;
	}
	return pts;
}

function distanceToSegment(p, a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
	return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Largest distance from the points of `a` to the dense polyline `b`. */
function oneWay(a, b) {
	let worst = 0;
	for (const p of a) {
		let best = Infinity;
		for (let i = 0; i + 1 < b.length; i++)
			best = Math.min(best, distanceToSegment(p, b[i], b[i + 1]));
		worst = Math.max(worst, best);
	}
	return worst;
}

test('every method: random cubics become quadratics within the tolerance, both ways', () => {
	const rnd = random(21);
	for (let i = 0; i < 60; i++) {
		const path = randomCubic(rnd);
		const tolerance = [0.1, 0.5, 3][i % 3];
		const cubic = Array.from({ length: 401 }, (_, k) => curveAt(path, k / 400));
		for (const method of METHODS)
			for (const detectInflections of method.startsWith('colomitchi')
				? [false, true]
				: [false]) {
				const qs = quads(toQuadratics(path, tolerance, { method, detectInflections }));
				const approx = quadPoints(path[0].x, path[0].y, qs);
				const slack = 0.01 * tolerance; // the dense polylines' own distance from their curves
				const label = `${method}${detectInflections ? ' + inflections' : ''} at ${tolerance}`;
				assert.ok(oneWay(cubic, approx) <= tolerance + slack, label);
				assert.ok(oneWay(approx, cubic) <= tolerance + slack, label);
				assert.deepEqual(
					[qs.at(-1).x, qs.at(-1).y],
					[path[1].x, path[1].y],
					`${label}: exact end`,
				);
			}
	}
});

test('fonttools: bit-identical to fontTools cu2qu (fixtures/cu2qu.json)', () => {
	const cases = JSON.parse(
		readFileSync(new URL('./fixtures/cu2qu.json', import.meta.url), 'utf8'),
	);
	for (const c of cases) {
		const out = curveToQuadratic(
			c.curve.map(([x, y]) => ({ x, y })),
			c.tol,
		).map(p => [p.x, p.y]);
		assert.deepEqual(out, c.out);
	}
});

test('fonttools: a smooth spline that keeps the end tangents', () => {
	const rnd = random(8);
	const angle = (ax, ay, bx, by) =>
		Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
	for (let i = 0; i < 100; i++) {
		const path = randomCubic(rnd);
		const [m, c] = path;
		const qs = quads(toQuadratics(path, 0.25, { method: 'fonttools' }));
		// Start and end tangents point the cubic's way.
		assert.ok(angle(c.c1x - m.x, c.c1y - m.y, qs[0].cx - m.x, qs[0].cy - m.y) < 1e-9);
		const last = qs.at(-1);
		assert.ok(angle(c.x - c.c2x, c.y - c.c2y, last.x - last.cx, last.y - last.cy) < 1e-9);
		// Every joint is smooth: the control points on both sides line up through it.
		for (let k = 0; k + 1 < qs.length; k++) {
			const a = qs[k];
			const b = qs[k + 1];
			assert.ok(angle(a.x - a.cx, a.y - a.cy, b.cx - a.x, b.cy - a.y) < 1e-9);
		}
	}
});

test('fonttools: ApproxNotFoundError past 100 quadratics', () => {
	assert.throws(
		() =>
			toQuadratics([M(0, 0), C(0, 1e6, 1e6, 1e6, 1e6, 0)], 1e-6, { method: 'fonttools' }),
		ApproxNotFoundError,
	);
});

test('kurbo: n = ceil((err / (432 · accuracy²))^(1/6)) equal pieces in t', () => {
	const path = [M(0, 0), C(10, 80, 90, -80, 100, 0)];
	const [m, c] = path;
	const ex = 3 * c.c2x - c.x - (3 * c.c1x - m.x);
	const ey = 3 * c.c2y - c.y - (3 * c.c1y - m.y);
	for (const tolerance of [0.01, 0.1, 1, 10]) {
		const n = Math.max(
			1,
			Math.ceil(((ex * ex + ey * ey) / (432 * tolerance * tolerance)) ** (1 / 6)),
		);
		const qs = quads(toQuadratics(path, tolerance));
		assert.equal(qs.length, n);
		// Piece i ends at t = (i + 1)/n on the cubic.
		qs.forEach((q, i) => {
			const p = curveAt(path, (i + 1) / n);
			assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 1e-9);
		});
	}
});

test("kurbo: bit-identical to kurbo's CubicBez::to_quads (fixtures/kurbo.json)", () => {
	const { toQuads: cases } = JSON.parse(
		readFileSync(new URL('./fixtures/kurbo.json', import.meta.url), 'utf8'),
	);
	for (const c of cases) {
		const out = toQuads(
			c.curve.map(([x, y]) => ({ x, y })),
			c.accuracy,
		).map(([t0, t1, q]) => [t0, t1, q.map(p => [p.x, p.y])]);
		assert.deepEqual(out, c.out);
	}
});

test('colomitchi: matches bezier-utils with the fixes (fixtures/colomitchi.json)', () => {
	// Half-splitting and the inflection points are bit-identical. The symmetric
	// division uses Math.hypot and Math.cbrt, which differ from Java's (fdlibm)
	// in the last bit (measured: up to 6.7e-14 relative).
	const cases = JSON.parse(
		readFileSync(new URL('./fixtures/colomitchi.json', import.meta.url), 'utf8'),
	);
	const run = (c, method, inflections) =>
		colomitchi(
			c.curve.map(([x, y]) => ({ x, y })),
			c.tol,
			method,
			inflections,
		).map(q => q.map(p => [p.x, p.y]));
	for (const c of cases) {
		assert.deepEqual(computeInflexion(c.curve.map(([x, y]) => ({ x, y }))), c.inflexions);
		assert.deepEqual(run(c, 'half', false), c.half);
		assert.deepEqual(run(c, 'half', true), c.halfInflections);
		for (const [key, inflections] of [
			['symmetric', false],
			['symmetricInflections', true],
		]) {
			const out = run(c, 'symmetric', inflections);
			assert.equal(out.length, c[key].length);
			out.forEach((q, i) =>
				q.forEach((p, j) =>
					p.forEach((v, a) => {
						const r = c[key][i][j][a];
						assert.ok(Math.abs(v - r) <= 1e-13 * Math.max(1, Math.abs(r)));
					}),
				),
			);
		}
	}
});

test('colomitchi: a cubic close to a quadratic is one mid-point quadratic', () => {
	// A degree-elevated quadratic: its third difference is 0, so tmax is infinite.
	const path = [M(0, 0), C(100 / 3, 200 / 3, 200 / 3, 200 / 3, 100, 0)];
	for (const method of ['colomitchi-half', 'colomitchi-adaptive', 'colomitchi-symmetric']) {
		const qs = quads(toQuadratics(path, 0.1, { method }));
		assert.equal(qs.length, 1, method);
		assert.ok(Math.abs(qs[0].cx - 50) < 1e-9 && Math.abs(qs[0].cy - 100) < 1e-9, method);
	}
});

test('colomitchi: the adaptive divisions need no more pieces than half-splitting', () => {
	const rnd = random(3);
	let half = 0;
	let adaptive = 0;
	let symmetric = 0;
	for (let i = 0; i < 300; i++) {
		const path = randomCubic(rnd);
		half += quads(toQuadratics(path, 0.25, { method: 'colomitchi-half' })).length;
		adaptive += quads(toQuadratics(path, 0.25, { method: 'colomitchi-adaptive' })).length;
		symmetric += quads(toQuadratics(path, 0.25, { method: 'colomitchi-symmetric' })).length;
	}
	assert.ok(
		adaptive <= half && symmetric <= half,
		`half ${half}, adaptive ${adaptive}, symmetric ${symmetric}`,
	);
});

test('colomitchi: symmetric division is the same run backwards', () => {
	const rnd = random(9);
	for (let i = 0; i < 50; i++) {
		const [m, c] = randomCubic(rnd);
		const forward = quads(toQuadratics([m, c], 0.25, { method: 'colomitchi-symmetric' }));
		const backward = quads(
			toQuadratics([M(c.x, c.y), C(c.c2x, c.c2y, c.c1x, c.c1y, m.x, m.y)], 0.25, {
				method: 'colomitchi-symmetric',
			}),
		);
		assert.equal(forward.length, backward.length);
		forward.forEach((q, k) => {
			const r = backward[backward.length - 1 - k];
			assert.ok(Math.hypot(q.cx - r.cx, q.cy - r.cy) < 1e-6);
		});
	}
});

test('colomitchi: detectInflections makes every inflection a piece boundary', () => {
	const rnd = random(4);
	for (let i = 0; i < 100; i++) {
		const path = randomCubic(rnd);
		const [m, c] = path;
		const ts = computeInflexion([
			{ x: m.x, y: m.y },
			{ x: c.c1x, y: c.c1y },
			{ x: c.c2x, y: c.c2y },
			{ x: c.x, y: c.y },
		]);
		for (const method of [
			'colomitchi-half',
			'colomitchi-adaptive',
			'colomitchi-symmetric',
		]) {
			const ends = quads(toQuadratics(path, 0.5, { method, detectInflections: true }));
			for (const t of ts) {
				const p = curveAt(path, t);
				assert.ok(
					ends.some(e => Math.hypot(e.x - p.x, e.y - p.y) < 1e-9),
					method,
				);
			}
		}
	}
});

test('default tolerance: 1 for fonttools, 0.5 for colomitchi, none for kurbo', () => {
	const path = [M(0, 0), C(0, 100, 100, 100, 100, 0)];
	assert.deepEqual(
		toQuadratics(path, undefined, { method: 'fonttools' }),
		toQuadratics(path, 1, { method: 'fonttools' }),
	);
	for (const method of ['colomitchi-half', 'colomitchi-adaptive', 'colomitchi-symmetric'])
		assert.deepEqual(
			toQuadratics(path, undefined, { method }),
			toQuadratics(path, 0.5, { method }),
		);
	assert.throws(() => toQuadratics(path), TypeError);
	assert.throws(() => toQuadratics(path, undefined, { method: 'kurbo' }), TypeError);
});

test('lines, quadratics, moveTo and close pass through; invalid input', () => {
	const path = [M(0, 0), L(10, 0), Q(20, 10, 30, 0), Z, M(5, 5), L(6, 6)];
	for (const method of METHODS) assert.deepEqual(toQuadratics(path, 0.1, { method }), path);
	for (const tolerance of [0, -1, NaN, Infinity])
		assert.throws(() => toQuadratics([M(0, 0)], tolerance), RangeError);
	assert.throws(() => toQuadratics([M(0, 0)], 1, { method: 'lyon' }), TypeError);
	assert.throws(
		() => toQuadratics([M(0, 0)], 1, { method: 'kurbo', detectInflections: true }),
		TypeError,
	);
	assert.throws(() => toQuadratics([C(0, 0, 1, 1, 2, 2)], 1), TypeError);
	assert.throws(() => toQuadratics([M(0, 0), C(0, NaN, 1, 1, 2, 2)], 1), TypeError);
});
