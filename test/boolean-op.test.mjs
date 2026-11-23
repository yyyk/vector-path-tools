import { test } from 'node:test';
import assert from 'node:assert/strict';
import { booleanOp } from '../dist/boolean-op.js';
import { evaluate, parameterOf } from '../dist/bezier-points.js';
import { intersect } from '../dist/intersect.js';
import { area, BooleanOpError, bounds, segments, subpaths } from '../dist/index.js';
import { fillAt } from './helpers.mjs';

// ---------- helpers ----------

const M = (x, y) => ({ type: 'moveTo', x, y });
const L = (x, y) => ({ type: 'lineTo', x, y });
const Q = (cx, cy, x, y) => ({ type: 'quadTo', cx, cy, x, y });
const C = (c1x, c1y, c2x, c2y, x, y) => ({ type: 'cubicTo', c1x, c1y, c2x, c2y, x, y });
const Z = { type: 'close' };

/** A closed polygon; clockwise on screen when the points go that way. */
const poly = (...ps) => [M(...ps[0]), ...ps.slice(1).map(p => L(...p)), Z];
const rect = (x, y, w, h) => poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const rectBack = (x, y, w, h) => poly([x, y], [x, y + h], [x + w, y + h], [x + w, y]);
/** A circle of four cubics, clockwise on screen. */
const circle = (cx, cy, r) => {
	const k = r * 0.5522847498;
	return [
		M(cx + r, cy),
		C(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
		C(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
		C(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
		C(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
		Z,
	];
};

function seeded(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const bez = s =>
	s.type === 'line'
		? [s.p0, s.p1]
		: s.type === 'quad'
			? [s.p0, s.p1, s.p2]
			: [s.p0, s.p1, s.p2, s.p3];

/**
 * Checks the design doc's properties: the same fill as `expected` (a
 * function of a point), no overlaps left, closed, simple, wound +1, and only
 * pieces of input segments.
 */
function check(input, output, expected, message = '') {
	const inputBox = bounds(input);
	const size = inputBox
		? Math.hypot(inputBox.maxX - inputBox.minX, inputBox.maxY - inputBox.minY)
		: 1;
	const eps = size * 1e-10; // booleanOp's default tolerance

	// Closed: every contour starts with moveTo, ends with close, exactly where it began.
	for (const contour of subpaths(output)) {
		assert.equal(contour[0].type, 'moveTo', message);
		assert.equal(contour[contour.length - 1].type, 'close', message);
		const last = contour[contour.length - 2];
		assert.ok(
			last.x === contour[0].x && last.y === contour[0].y,
			`${message}: not closed exactly`,
		);
	}

	// The same fill, and no overlaps left, at random points away from edges.
	if (inputBox) {
		const random = seeded(1);
		const pad = size * 0.05;
		const d = size * 1e-4; // contains (Skia) differs between a curve and its pieces this close
		for (let i = 0; i < 2000; i++) {
			const x =
				inputBox.minX - pad + random() * (inputBox.maxX - inputBox.minX + 2 * pad);
			const y =
				inputBox.minY - pad + random() * (inputBox.maxY - inputBox.minY + 2 * pad);
			const want = expected(x, y);
			// Near an edge, the answer can go either way.
			if (
				want === null ||
				[
					[d, 0],
					[-d, 0],
					[0, d],
					[0, -d],
				].some(([dx, dy]) => expected(x + dx, y + dy) !== want)
			)
				continue;
			const got = fillAt(output, x, y);
			const gotEvenOdd = fillAt(output, x, y, 'evenodd');
			if (got === null || gotEvenOdd === null) continue;
			assert.equal(got, want, `${message}: fill differs at ${x}, ${y}`);
			assert.equal(gotEvenOdd, want, `${message}: overlap left at ${x}, ${y}`);
		}
	}

	// Simple: output pieces only meet at their ends.
	const outSegs = segments(output).map(bez);
	for (let i = 0; i < outSegs.length; i++)
		for (let j = i + 1; j < outSegs.length; j++)
			for (const h of intersect(outSegs[i], outSegs[j], eps)) {
				assert.equal(h.kind, 'point', `${message}: output pieces overlap`);
				const atEnd = t => t === 0 || t === 1;
				assert.ok(
					atEnd(h.t1) && atEnd(h.t2),
					`${message}: output pieces cross at ${h.t1}, ${h.t2}`,
				);
			}

	// Only split, never approximated: each piece lies on an input segment of its kind.
	// Every subpath counts as closed, so an open one's closing line is an input segment too.
	const inSegs = subpaths(input)
		.flatMap(sp => segments(sp[sp.length - 1].type === 'close' ? sp : [...sp, Z]))
		.map(bez);
	for (const s of outSegs) {
		const onInput = inSegs.some(
			e =>
				e.length === s.length &&
				[0, 0.25, 0.5, 0.75, 1].every(
					t => parameterOf(e, evaluate(s, t), eps * 10) !== null,
				),
		);
		assert.ok(onInput, `${message}: piece not on an input segment of its kind`);
	}
}

const union1 = (path, options) => booleanOp(path, [], 'union', options);
const fillOf =
	(path, fillRule = 'nonzero') =>
	(x, y) =>
		fillAt(path, x, y, fillRule);

// ---------- removing a path's own overlaps ----------

test('H: two stems and a crossbar laid over them, its ends flush with the stems', () => {
	const H = [...rect(0, 0, 20, 100), ...rect(80, 0, 20, 100), ...rect(0, 45, 100, 10)];
	const out = union1(H);
	check(H, out, fillOf(H), 'H');
	assert.equal(subpaths(out).length, 1);
	assert.ok(Math.abs(area(out) - (2 * 2000 + 60 * 10)) < 1e-9);
});

test('W: two overlapping Vs', () => {
	const v1 = poly([0, 0], [20, 0], [40, 80], [30, 100], [20, 100]);
	const v2 = poly([30, 0], [50, 0], [70, 80], [60, 100], [50, 100]);
	const W = [...v1, ...v2];
	check(W, union1(W), fillOf(W), 'W');
});

test('two overlapping circles in one path', () => {
	const path = [...circle(0, 0, 50), ...circle(60, 0, 50)];
	const out = union1(path);
	check(path, out, fillOf(path), 'circles');
	assert.equal(subpaths(out).length, 1);
});

test('a contour crossing itself: a bowtie becomes two triangles', () => {
	const bowtie = poly([0, 0], [100, 100], [100, 0], [0, 100]);
	for (const fillRule of ['nonzero', 'evenodd']) {
		const out = union1(bowtie, { fillRuleA: fillRule });
		check(bowtie, out, fillOf(bowtie, fillRule), `bowtie ${fillRule}`);
		assert.equal(subpaths(out).length, 2);
		assert.ok(Math.abs(area(out) - 5000) < 1e-9);
	}
});

test('a figure eight drawn as one contour', () => {
	const eight = poly([0, 0], [100, 100], [200, 0], [200, 100], [100, 0], [0, 100]);
	check(eight, union1(eight), fillOf(eight), 'eight');
});

test('the same contour twice: winding 2 under nonzero, 0 under evenodd', () => {
	const twice = [...rect(0, 0, 50, 50), ...rect(0, 0, 50, 50)];
	const nonzero = union1(twice);
	check(twice, nonzero, fillOf(twice), 'twice nonzero');
	assert.ok(Math.abs(area(nonzero) - 2500) < 1e-9);
	assert.deepEqual(union1(twice, { fillRuleA: 'evenodd' }), []);
});

test('a hole wound against its outer contour, and one wound the same way', () => {
	const against = [...rect(0, 0, 100, 100), ...rectBack(25, 25, 50, 50)];
	const out = union1(against);
	check(against, out, fillOf(against), 'hole against');
	assert.equal(subpaths(out).length, 2);
	assert.ok(Math.abs(area(out) - 7500) < 1e-9);

	const same = [...rect(0, 0, 100, 100), ...rect(25, 25, 50, 50)];
	const filledIn = union1(same);
	check(same, filledIn, fillOf(same), 'hole same way, nonzero');
	assert.equal(subpaths(filledIn).length, 1);
	const hole = union1(same, { fillRuleA: 'evenodd' });
	check(same, hole, fillOf(same, 'evenodd'), 'hole same way, evenodd');
	assert.ok(Math.abs(area(hole) - 7500) < 1e-9);
});

test('outer contours have positive area, holes negative', () => {
	const out = union1([...rectBack(0, 0, 100, 100), ...rect(25, 25, 50, 50)]);
	const areas = subpaths(out)
		.map(area)
		.sort((p, q) => p - q);
	assert.ok(Math.abs(areas[0] + 2500) < 1e-9 && Math.abs(areas[1] - 10000) < 1e-9);
});

test('two squares corner to corner: two contours that touch', () => {
	const path = [...rect(0, 0, 10, 10), ...rect(10, 10, 10, 10)];
	const out = union1(path);
	check(path, out, fillOf(path), 'corner to corner');
	assert.equal(subpaths(out).length, 2);
});

test('a ring touching itself: the outer contour and the hole stay separate', () => {
	// A square with a square hole whose corner touches the outer edge.
	const path = [...rect(0, 0, 100, 100), ...poly([50, 0], [25, 25], [50, 50], [75, 25])];
	const out = union1(path, { fillRuleA: 'evenodd' });
	check(path, out, fillOf(path, 'evenodd'), 'touching hole');
	assert.equal(subpaths(out).length, 2);
});

test('zero-length segments are ignored', () => {
	const path = [M(0, 0), L(0, 0), L(100, 0), L(100, 0), L(100, 100), L(0, 100), Z];
	const out = union1(path);
	check(path, out, fillOf(path), 'zero length');
	assert.ok(Math.abs(area(out) - 10000) < 1e-9);
});

test('a cubic crossing itself', () => {
	const path = [M(0, 0), C(200, 100, -100, 100, 100, 0), Z];
	check(path, union1(path), fillOf(path), 'cubic loop');
});

test('a simple path keeps its fill and area', () => {
	const path = [M(0, 0), Q(50, -40, 100, 0), C(130, 30, 130, 70, 100, 100), L(0, 100), Z];
	const out = union1(path);
	check(path, out, fillOf(path), 'simple');
	assert.ok(Math.abs(area(out) - area(path)) < 1e-9 * Math.abs(area(path)));
});

test('the same at any scale and far from the origin', () => {
	const H = [...rect(0, 0, 20, 100), ...rect(80, 0, 20, 100), ...rect(0, 45, 100, 10)];
	for (const [s, o] of [
		[1e-3, 0],
		[1e4, 0],
		[1, 1e6],
	]) {
		const moved = H.map(c =>
			c.type === 'close' ? c : { ...c, x: c.x * s + o, y: c.y * s + o },
		);
		const out = union1(moved);
		check(moved, out, fillOf(moved), `H at ${s}, ${o}`);
		assert.equal(subpaths(out).length, 1);
	}
});

test('an open subpath counts as closed', () => {
	const path = [M(0, 0), L(100, 0), L(100, 100), L(0, 100)];
	const out = union1(path);
	check(path, out, fillOf(path), 'open');
	assert.ok(Math.abs(area(out) - 10000) < 1e-9);
});

test('nothing to fill gives []', () => {
	assert.deepEqual(union1([]), []);
	assert.deepEqual(union1([M(5, 5)]), []);
	assert.deepEqual(union1([...rect(0, 0, 10, 10), ...rectBack(0, 0, 10, 10)]), []);
});

test('BooleanOpError is exported, as an Error with its own name', () => {
	const e = new BooleanOpError('a contour of the result does not close');
	assert.ok(e instanceof Error);
	assert.equal(e.name, 'BooleanOpError');
});

test('bad input is a TypeError', () => {
	assert.throws(() => booleanOp([], [], 'xor'), TypeError);
	assert.throws(() => booleanOp([], [], 'union', { fillRuleA: 'odd' }), TypeError);
	assert.throws(() => booleanOp([], [], 'union', { tolerance: 0 }), TypeError);
	assert.throws(() => booleanOp([L(1, 1)], [], 'union'), TypeError);
	assert.throws(() => booleanOp([M(0, NaN)], [], 'union'), TypeError);
});

test('the input is not changed', () => {
	const path = [...rect(0, 0, 20, 100), ...rect(0, 45, 100, 10)];
	const copy = structuredClone(path);
	const out = union1(path);
	assert.deepEqual(path, copy);
	for (const c of out) assert.ok(!path.includes(c));
});

test('random paths crossing themselves and each other', () => {
	const random = seeded(7);
	const r = () => Math.round(random() * 1000) / 10;
	for (let n = 0; n < 150; n++) {
		const path = [];
		for (let s = 0; s < 1 + (n % 3); s++) {
			path.push(M(r(), r()));
			for (let k = 0; k < 3 + (n % 4); k++) {
				const kind = Math.floor(random() * 3);
				if (kind === 0) path.push(L(r(), r()));
				else if (kind === 1) path.push(Q(r(), r(), r(), r()));
				else path.push(C(r(), r(), r(), r(), r(), r()));
			}
			path.push(Z);
		}
		const fillRule = n % 2 ? 'evenodd' : 'nonzero';
		check(
			path,
			union1(path, { fillRuleA: fillRule }),
			fillOf(path, fillRule),
			`random ${n}`,
		);
	}
});

test('regression: a piece classified by its exact shape, not its snapped ends', () => {
	// Snapping a long cubic piece's ends to nearby crossings moved its middle
	// further than the probe distance, so both probes fell on the same side.
	const path = [
		{ type: 'moveTo', x: 79.2, y: 64.5 },
		{ type: 'lineTo', x: 21, y: 7.6 },
		{ type: 'quadTo', cx: 86.7, cy: 73, x: 3.4, y: 52.6 },
		{ type: 'cubicTo', c1x: 46, c1y: 37.8, c2x: 75.2, c2y: 39.6, x: 55.6, y: 14.4 },
		{ type: 'quadTo', cx: 49, cy: 60.3, x: 58.5, y: 32.3 },
		{ type: 'close' },
		{ type: 'moveTo', x: 80.5, y: 4.5 },
		{ type: 'cubicTo', c1x: 55.9, c1y: 61, c2x: 27.9, c2y: 86, x: 71.5, y: 30.6 },
		{ type: 'cubicTo', c1x: 34.1, c1y: 79.8, c2x: 30.1, c2y: 75.8, x: 94.3, y: 35.1 },
		{ type: 'quadTo', cx: 0.9, cy: 38.4, x: 15.4, y: 10.1 },
		{ type: 'quadTo', cx: 0.3, cy: 10.7, x: 27.4, y: 68.5 },
		{ type: 'close' },
		{ type: 'moveTo', x: 43.7, y: 84.3 },
		{ type: 'quadTo', cx: 26.3, cy: 80.7, x: 50.7, y: 98.6 },
		{ type: 'quadTo', cx: 58.4, cy: 47, x: 93.6, y: 75.4 },
		{ type: 'lineTo', x: 99.4, y: 91.4 },
		{ type: 'cubicTo', c1x: 31.6, c1y: 42.2, c2x: 77.2, c2y: 20.6, x: 15.2, y: 82 },
		{ type: 'close' },
	];
	check(
		path,
		union1(path, { fillRuleA: 'evenodd' }),
		fillOf(path, 'evenodd'),
		'snapped piece',
	);
});

test('regression: a line and a cubic crossing twice right next to their shared vertex', () => {
	// Three nearly repeated roots; a closed-form solver merged two of them.
	const path = [
		{ type: 'moveTo', x: 73.4, y: 51.9 },
		{ type: 'lineTo', x: 4.4, y: 45.6 },
		{ type: 'quadTo', cx: 94.7, cy: 80.4, x: 44.1, y: 83.1 },
		{ type: 'cubicTo', c1x: 6.6, c1y: 28.1, c2x: 28.3, c2y: 74.3, x: 14.9, y: 60.3 },
		{ type: 'cubicTo', c1x: 15.4, c1y: 96.6, c2x: 4.4, c2y: 43.2, x: 91.2, y: 96.8 },
		{ type: 'lineTo', x: 94.9, y: 3 },
		{ type: 'close' },
	];
	check(path, union1(path), fillOf(path), 'near-tangent vertex');
});

// ---------- two paths ----------

const OPS = ['union', 'intersection', 'difference', 'exclusion'];
const keep = (op, inA, inB) =>
	op === 'union'
		? inA || inB
		: op === 'intersection'
			? inA && inB
			: op === 'difference'
				? inA && !inB
				: inA !== inB;
const opFill =
	(a, b, op, ruleA = 'nonzero', ruleB = 'nonzero') =>
	(x, y) => {
		const inA = fillAt(a, x, y, ruleA);
		const inB = fillAt(b, x, y, ruleB);
		return inA === null || inB === null ? null : keep(op, inA, inB);
	};

/** Runs and checks every operation on a and b; returns the outputs by operation. */
function checkOps(a, b, message, options = {}) {
	const out = {};
	for (const op of OPS) {
		out[op] = booleanOp(a, b, op, options);
		check(
			[...a, ...b],
			out[op],
			opFill(a, b, op, options.fillRuleA, options.fillRuleB),
			`${message} ${op}`,
		);
	}
	return out;
}

const near = (x, y, tol = 1e-9) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));

test('two overlapping squares: every operation, with exact areas', () => {
	const out = checkOps(rect(0, 0, 100, 100), rect(50, 50, 100, 100), 'squares');
	assert.ok(near(area(out.union), 17500));
	assert.ok(near(area(out.intersection), 2500));
	assert.ok(near(area(out.difference), 7500));
	assert.ok(near(area(out.exclusion), 15000));
	assert.equal(subpaths(out.exclusion).length, 2);
});

test('a circle and a square', () => {
	checkOps(circle(50, 50, 40), rect(50, 0, 100, 100), 'circle and square');
});

test('B inside A: difference makes a hole, intersection is B', () => {
	const a = rect(0, 0, 100, 100);
	const b = circle(50, 50, 20);
	const out = checkOps(a, b, 'inside');
	assert.equal(subpaths(out.difference).length, 2);
	assert.ok(near(area(out.difference), 10000 - area(b), 1e-12));
	assert.ok(near(area(out.intersection), area(b), 1e-12));
	assert.ok(near(area(out.union), 10000));
});

test('B wound the other way gives the same results', () => {
	const a = rect(0, 0, 100, 100);
	const forward = checkOps(a, rect(50, 50, 100, 100), 'forward');
	const backward = checkOps(a, rectBack(50, 50, 100, 100), 'backward');
	for (const op of OPS) assert.ok(near(area(forward[op]), area(backward[op])), op);
});

test('disjoint paths', () => {
	const a = rect(0, 0, 10, 10);
	const b = rect(20, 0, 10, 10);
	const out = checkOps(a, b, 'disjoint');
	assert.deepEqual(out.intersection, []);
	assert.equal(subpaths(out.union).length, 2);
	assert.ok(near(area(out.difference), 100));
});

test('identical paths', () => {
	const a = circle(0, 0, 50);
	const out = checkOps(a, circle(0, 0, 50), 'identical');
	assert.ok(near(area(out.union), area(a), 1e-12));
	assert.ok(near(area(out.intersection), area(a), 1e-12));
	assert.deepEqual(out.difference, []);
	assert.deepEqual(out.exclusion, []);
});

test('squares sharing an edge: union is one contour, intersection is empty', () => {
	for (const b of [
		rect(100, 0, 100, 100),
		rectBack(100, 0, 100, 100),
		rect(100, 25, 100, 50),
	]) {
		const out = checkOps(rect(0, 0, 100, 100), b, 'shared edge');
		assert.equal(subpaths(out.union).length, 1);
		assert.deepEqual(out.intersection, []);
	}
});

test('squares sharing part of an edge from inside: difference cuts a notch', () => {
	// B overlaps A along A's top edge: the H crossbar case between two paths.
	const out = checkOps(rect(0, 0, 100, 100), rect(25, 0, 50, 30), 'notch');
	assert.equal(subpaths(out.difference).length, 1);
	assert.ok(near(area(out.difference), 10000 - 1500));
	assert.ok(near(area(out.intersection), 1500));
});

test('squares corner to corner', () => {
	const out = checkOps(rect(0, 0, 10, 10), rect(10, 10, 10, 10), 'corner');
	assert.equal(subpaths(out.union).length, 2);
	assert.deepEqual(out.intersection, []);
});

test("each path's own overlaps and fill rule count", () => {
	const a = [...rect(0, 0, 100, 100), ...rect(25, 25, 50, 50)]; // a hole only under evenodd
	const b = circle(50, 50, 30);
	for (const fillRuleA of ['nonzero', 'evenodd'])
		for (const fillRuleB of ['nonzero', 'evenodd'])
			checkOps(a, b, `rules ${fillRuleA} ${fillRuleB}`, { fillRuleA, fillRuleB });
});

test('a path against nothing, and nothing against a path', () => {
	const a = circle(0, 0, 10);
	assert.ok(near(area(booleanOp(a, [], 'difference')), area(a), 1e-12));
	assert.deepEqual(booleanOp(a, [], 'intersection'), []);
	assert.deepEqual(booleanOp([], a, 'difference'), []);
	assert.ok(near(area(booleanOp([], a, 'exclusion')), area(a), 1e-12));
});

test('random pairs of paths, every operation', () => {
	const random = seeded(3);
	const r = () => Math.round(random() * 1000) / 10;
	const randomPath = n => {
		const path = [];
		for (let s = 0; s < 1 + (n % 2); s++) {
			path.push(M(r(), r()));
			for (let k = 0; k < 3 + (n % 3); k++) {
				const kind = Math.floor(random() * 3);
				if (kind === 0) path.push(L(r(), r()));
				else if (kind === 1) path.push(Q(r(), r(), r(), r()));
				else path.push(C(r(), r(), r(), r(), r(), r()));
			}
			path.push(Z);
		}
		return path;
	};
	for (let n = 0; n < 40; n++) {
		const options = {
			fillRuleA: n % 2 ? 'evenodd' : 'nonzero',
			fillRuleB: n % 4 < 2 ? 'nonzero' : 'evenodd',
		};
		checkOps(randomPath(n), randomPath(n + 1), `random pair ${n}`, options);
	}
});
