import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, subCurve } from '../dist/bezier-points.js';
import { intersect, selfIntersection } from '../dist/intersect.js';

const P = ([x, y]) => ({ x, y });
const pts = (...ps) => ps.map(P);
const EPS = 1e-7;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const points = hits => hits.filter(h => h.kind === 'point');

test('crossing lines', () => {
	const hits = intersect(pts([0, 0], [10, 10]), pts([0, 10], [10, 0]), EPS);
	assert.equal(hits.length, 1);
	assert.ok(near(hits[0].t1, 0.5) && near(hits[0].t2, 0.5));
});

test('collinear lines on top of each other: one overlap (H crossbar flush with the stem)', () => {
	const stem = pts([0, 0], [0, 100]);
	const bar = pts([0, 40], [0, 60]);
	const [o, ...rest] = intersect(stem, bar, EPS);
	assert.equal(rest.length, 0);
	assert.equal(o.kind, 'overlap');
	assert.ok(near(o.t1[0], 0.4) && near(o.t1[1], 0.6));
	assert.deepEqual(o.t2, [0, 1]);

	const reversed = intersect(stem, [...bar].reverse(), EPS)[0];
	assert.equal(reversed.kind, 'overlap');
	assert.deepEqual(reversed.t2, [1, 0]);
});

test('collinear lines meeting end to end: a point, not an overlap', () => {
	const hits = intersect(pts([0, 0], [10, 0]), pts([10, 0], [20, 0]), EPS);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].kind, 'point');
	assert.equal(hits[0].t1, 1);
	assert.equal(hits[0].t2, 0);
});

test('shared vertex: reported once, at exactly t = 1 and t = 0 (W meeting at the baseline)', () => {
	const hits = intersect(pts([0, 0], [10, 100]), pts([10, 100], [20, 0]), EPS);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].t1, 1);
	assert.equal(hits[0].t2, 0);
});

test('T junction: the end lands exactly at t = 0', () => {
	const hits = intersect(pts([5, 0], [5, 10]), pts([0, 0], [10, 0]), EPS);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].t1, 0);
	assert.ok(near(hits[0].t2, 0.5));
});

test('nearly coincident: a crossbar ending 1e-12 inside the stem still meets it at its end', () => {
	const hits = intersect(pts([1e-12, 50], [30, 50]), pts([0, 0], [0, 100]), EPS);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].t1, 0);
	assert.ok(near(hits[0].t2, 0.5));
});

test('a curve and itself, reversed, and a piece of it: overlaps', () => {
	for (const c of [
		pts([0, 0], [50, 100], [100, 0]),
		pts([0, 0], [30, 100], [70, -50], [100, 30]),
	]) {
		const same = intersect(c, c, EPS);
		assert.equal(same.length, 1);
		assert.equal(same[0].kind, 'overlap');
		assert.deepEqual(same[0].t1, [0, 1]);
		assert.deepEqual(same[0].t2, [0, 1]);

		const back = intersect(c, [...c].reverse(), EPS);
		assert.equal(back[0].kind, 'overlap');
		assert.deepEqual(back[0].t2, [1, 0]);

		const piece = intersect(c, subCurve(c, 0.25, 0.7), EPS);
		assert.equal(piece.length, 1);
		assert.equal(piece[0].kind, 'overlap');
		assert.ok(near(piece[0].t1[0], 0.25, 1e-7) && near(piece[0].t1[1], 0.7, 1e-7));
		assert.deepEqual(piece[0].t2, [0, 1]);
	}
});

test('pieces of one curve that only partly overlap', () => {
	const c = pts([0, 0], [30, 100], [70, -50], [100, 30]);
	const [o] = intersect(subCurve(c, 0, 0.6), subCurve(c, 0.4, 1), EPS);
	assert.equal(o.kind, 'overlap');
	// On the first piece, 0.4…0.6 of c is 2/3…1; on the second, 0…1/3.
	assert.ok(near(o.t1[0], 2 / 3, 1e-7) && near(o.t1[1], 1, 1e-7));
	assert.ok(near(o.t2[0], 0, 1e-7) && near(o.t2[1], 1 / 3, 1e-7));
});

test('a quadratic and the same curve as a cubic, and a line and a straight cubic: overlaps', () => {
	const q = pts([0, 0], [50, 100], [100, 0]);
	const asCubic = [q[0], P([100 / 3, 200 / 3]), P([200 / 3, 200 / 3]), q[2]];
	assert.equal(intersect(q, asCubic, EPS)[0]?.kind, 'overlap');

	const line = pts([0, 0], [100, 0]);
	const straight = pts([20, 0], [25, 0], [70, 0], [80, 0]); // other parameterization
	const [o] = intersect(line, straight, EPS);
	assert.equal(o.kind, 'overlap');
	assert.ok(near(o.t1[0], 0.2) && near(o.t1[1], 0.8));
});

test('two squares corner to corner: one point', () => {
	const hits = intersect(pts([0, 0], [10, 10]), pts([10, 10], [20, 0]), EPS);
	assert.equal(points(hits).length, 1);
});

test('a line touching a quadratic at its apex', () => {
	const hits = intersect(pts([-100, 50], [100, 50]), pts([-100, 0], [0, 100], [100, 0]), EPS);
	assert.equal(hits.length, 1);
	assert.ok(near(hits[0].t1, 0.5) && near(hits[0].t2, 0.5));
});

test('a line missing a quadratic apex by less than eps still touches it', () => {
	const hits = intersect(
		pts([-100, 50 + 1e-9], [100, 50 + 1e-9]),
		pts([-100, 0], [0, 100], [100, 0]),
		EPS,
	);
	assert.equal(hits.length, 1);
});

test('two curves touching tangentially: one point (circle inside a circle)', () => {
	// Two arches touching at their tops, at (50, 75) and (50, 75).
	const outer = pts([0, 0], [0, 100], [100, 100], [100, 0]);
	const inner = pts([25, 25], [25, 91.66666666666667], [75, 91.66666666666667], [75, 25]);
	const hits = intersect(outer, inner, EPS);
	assert.equal(hits.length, 1, JSON.stringify(hits));
	assert.ok(near(hits[0].point.x, 50, 1e-3) && near(hits[0].point.y, 75, 1e-6));
});

test('two S curves crossing three times', () => {
	const a = pts([0, 0], [100, 300], [200, -200], [300, 100]);
	const b = pts([0, 100], [100, -200], [200, 300], [300, 0]);
	const hits = intersect(a, b, EPS);
	assert.equal(hits.length, 3);
	for (const h of hits) {
		const p = evaluate(a, h.t1);
		const q = evaluate(b, h.t2);
		assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= 1e-6);
	}
});

test('a cubic loop', () => {
	const c = pts([0, 0], [200, 100], [-100, 100], [100, 0]);
	const [s, t] = selfIntersection(c);
	assert.ok(s < t);
	const p = evaluate(c, s);
	const q = evaluate(c, t);
	assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= 1e-9);
	assert.equal(selfIntersection(pts([0, 0], [30, 100], [70, 100], [100, 0])), null);
	assert.equal(selfIntersection(pts([0, 0], [50, 100], [100, 0])), null);
});

test("crossings agree with stroke-outline's on its fixture", () => {
	const reference = JSON.parse(
		readFileSync(new URL('./fixtures/stroke-outline.json', import.meta.url), 'utf8'),
	);
	for (const r of reference.intersect) {
		const a = r.a.map(P);
		const b = r.b.map(P);
		const size = Math.max(...[...r.a, ...r.b].flat().map(Math.abs));
		const hits = intersect(a, b, size * 1e-10);
		if (hits.some(h => h.kind === 'overlap')) continue; // stroke-outline skips identical curves
		const message = `${JSON.stringify(r.a)} and ${JSON.stringify(r.b)}`;
		// Every crossing stroke-outline finds is found here too. Its flatness
		// test is absolute (pieces flat to about 1e-6), so on small curves its
		// points are only that accurate; here the tolerance follows the size.
		for (const [t1, t2, x, y] of r.out) {
			const at = x === undefined ? evaluate(a, t1) : { x, y };
			assert.ok(
				hits.some(
					h => Math.hypot(h.point.x - at.x, h.point.y - at.y) <= 1e-5 + size * 1e-8,
				),
				`${message}: missing ${t1}, ${t2}`,
			);
		}
		// And everything found here is a real meeting point.
		for (const h of hits) {
			const p = evaluate(a, h.t1);
			const q = evaluate(b, h.t2);
			assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= size * 1e-8, message);
		}
	}
});
