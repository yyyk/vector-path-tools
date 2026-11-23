import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as arc from '../dist/stroke-outline/arc-length.js';
import * as offset from '../dist/stroke-outline/offset.js';
import * as intersect from '../dist/stroke-outline/intersect.js';

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

// Line-cubic intersections solve a cubic with Math.cbrt, Math.acos and
// Math.cos, which round differently in the last bit from the C library, so
// those match within 1e-12 (parameters absolutely, points relative to the
// curves' size). Everything else matches bit for bit.
test("intersections match stroke-outline's", () => {
	for (const r of reference.intersect) {
		const a = r.a.map(P);
		const b = r.b.map(P);
		let out;
		if (a.length === 2 && b.length === 2) {
			const hit = intersect.lineSegmentIntersection(...a, ...b);
			out = hit ? [hit] : [];
		} else {
			const hits =
				a.length === 2
					? b.length === 3
						? intersect.lineQuadraticIntersections(...a, b)
						: intersect.lineCubicIntersections(...a, b)
					: a.length === 3
						? b.length === 3
							? intersect.quadraticQuadraticIntersections(a, b)
							: intersect.quadraticCubicIntersections(a, b)
						: intersect.cubicCubicIntersections(a, b);
			out = hits.map(h => [h.t1, h.t2, h.point.x, h.point.y]);
		}
		const message = `${JSON.stringify(r.a)} and ${JSON.stringify(r.b)}`;
		assert.equal(out.length, r.out.length, message);
		if (a.length === 2 && b.length === 4) {
			const size = Math.max(...[...r.a, ...r.b].flat().map(Math.abs));
			out.forEach((h, i) =>
				h.forEach((v, j) =>
					assert.ok(Math.abs(v - r.out[i][j]) <= (j < 2 ? 1 : size) * 1e-12, message),
				),
			);
		} else assert.ok(same(out.flat(), r.out.flat()), message);
	}
});
