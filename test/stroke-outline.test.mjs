import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as arc from '../dist/stroke-outline/arc-length.js';
import * as offset from '../dist/stroke-outline/offset.js';

/** stroke-outline's own results (fixtures/generate-stroke-outline.sh). */
const reference = JSON.parse(
	readFileSync(new URL('./fixtures/stroke-outline.json', import.meta.url), 'utf8'),
);
const P = ([x, y]) => ({ x, y });
// Bit for bit, telling 0 from -0.
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

test("arc lengths and dash tables match stroke-outline's bit for bit", () => {
	for (const r of reference.arcLength) {
		const p = r.p.map(P);
		const cubic = p.length === 4;
		const length = cubic ? arc.arcLengthCubic(...p) : arc.arcLengthQuadratic(...p);
		const range = cubic
			? arc.arcLengthCubicRange(...p, 0.2, 0.7)
			: arc.arcLengthQuadraticRange(...p, 0.2, 0.7);
		const lut = cubic
			? arc.ArcLengthLUT.fromCubic(...p, 100)
			: arc.ArcLengthLUT.fromQuadratic(...p, 100);
		const ts = Array.from({ length: 9 }, (_, k) =>
			lut.tAtDistance((lut.totalLength * (k + 1)) / 10),
		);
		assert.ok(
			same(
				[length, range, lut.totalLength, ...ts],
				[r.length, r.range, r.lutLength, ...r.lutT],
			),
			JSON.stringify(r.p),
		);
	}
});

test("curve offsets match stroke-outline's bit for bit, folds and cusps included", () => {
	for (const r of reference.offset) {
		const p = r.p.map(P);
		const pieces =
			p.length === 4
				? offset.offsetCubicBezier(...p, r.d)
				: offset.offsetQuadraticBezier(...p, r.d);
		assert.ok(
			same(
				pieces.flatMap(c => c.flatMap(q => [q.x, q.y])),
				r.out.flat(2),
			) && pieces.length === r.out.length,
			`${JSON.stringify(r.p)} by ${r.d}`,
		);
	}
});
