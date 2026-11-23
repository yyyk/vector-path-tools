import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { booleanOp } from '../dist/boolean-op.js';
import { bounds, subpaths } from '../dist/index.js';
import { fillAt } from './helpers.mjs';

// The pairs of shapes in boolean-inputs.txt, each with all four operations,
// and Skia PathOps' and path-bool's results for them (fixtures/README.md).
// Results are compared by fill: at seeded points away from every edge,
// booleanOp must match the operation applied to the inputs' fills, and where a
// reference disagrees with booleanOp, the reference must be the one that is
// wrong.

const read = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const inputs = read('boolean-inputs.txt').split('\n').filter(Boolean);
const skia = JSON.parse(read('pathops-skia.json'));
const pathBool = JSON.parse(read('path-bool.json'));

const ARITY = { M: 1, L: 1, Q: 2, C: 3, Z: 0 };
function parse(d) {
	const t = d.split(' ').filter(Boolean);
	const out = [];
	for (let i = 0; i < t.length;) {
		const op = t[i++];
		const v = [];
		for (let k = 0; k < 2 * ARITY[op]; k++) v.push(Number(t[i++]));
		if (op === 'M') out.push({ type: 'moveTo', x: v[0], y: v[1] });
		else if (op === 'L') out.push({ type: 'lineTo', x: v[0], y: v[1] });
		else if (op === 'Q') out.push({ type: 'quadTo', cx: v[0], cy: v[1], x: v[2], y: v[3] });
		else if (op === 'C')
			out.push({
				type: 'cubicTo',
				c1x: v[0],
				c1y: v[1],
				c2x: v[2],
				c2y: v[3],
				x: v[4],
				y: v[5],
			});
		else out.push({ type: 'close' });
	}
	return out;
}

const keep = (op, inA, inB) =>
	op === 'union'
		? inA || inB
		: op === 'intersection'
			? inA && inB
			: op === 'difference'
				? inA && !inB
				: inA !== inB;

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

test('booleanOp matches the inputs, and wins every disagreement with Skia and path-bool', t => {
	assert.equal(skia.length, inputs.length);
	assert.equal(pathBool.length, inputs.length);
	const wrong = { skia: 0, pathBool: 0, skiaFailed: 0, pathBoolFailed: 0 };
	inputs.forEach((line, i) => {
		const [head, da, db] = line.split('|');
		const [op, ruleA, ruleB] = head.split(' ');
		const a = parse(da);
		const b = parse(db);
		const ours = booleanOp(a, b, op, {
			fillRuleA: ruleA,
			fillRuleB: ruleB,
		});
		const truth = (x, y) => {
			const inA = fillAt(a, x, y, ruleA);
			const inB = fillAt(b, x, y, ruleB);
			return inA === null || inB === null ? null : keep(op, inA, inB);
		};
		const refs = [
			['skia', skia[i].ok ? parse(skia[i].d) : null, skia[i].fillRule],
			['pathBool', pathBool[i].ok ? parse(pathBool[i].d) : null, 'nonzero'],
		];
		if (!refs[0][1]) wrong.skiaFailed++;
		if (!refs[1][1]) wrong.pathBoolFailed++;
		const message = `case ${i + 1}: ${head}`;

		for (const contour of subpaths(ours)) {
			assert.equal(contour[contour.length - 1].type, 'close', message);
			const last = contour[contour.length - 2];
			assert.ok(
				last.x === contour[0].x && last.y === contour[0].y,
				`${message}: not closed`,
			);
		}

		const box = bounds([...a, ...b]);
		if (!box) return;
		const size = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
		const d = size * 1e-4;
		const random = seeded(i + 1);
		const near = f =>
			[
				[d, 0],
				[-d, 0],
				[0, d],
				[0, -d],
			].some(([dx, dy]) => f(0, 0) !== f(dx, dy));
		const counted = { skia: false, pathBool: false };
		for (let k = 0; k < 60; k++) {
			const x = box.minX + random() * (box.maxX - box.minX);
			const y = box.minY + random() * (box.maxY - box.minY);
			const want = truth(x, y);
			if (want === null || near((dx, dy) => truth(x + dx, y + dy))) continue;
			const got = fillAt(ours, x, y);
			const gotEvenOdd = fillAt(ours, x, y, 'evenodd');
			if (got === null || gotEvenOdd === null) continue;
			assert.equal(got, want, `${message}: fill differs at ${x}, ${y}`);
			assert.equal(gotEvenOdd, want, `${message}: overlap left at ${x}, ${y}`);
			for (const [name, ref, rule] of refs) {
				if (!ref || counted[name]) continue;
				const refFill = (dx, dy) => fillAt(ref, x + dx, y + dy, rule);
				// The reference's own edges can be off by its curve approximation.
				if (refFill(0, 0) === null || near(refFill)) continue;
				if (refFill(0, 0) !== want) {
					wrong[name]++;
					counted[name] = true;
				}
			}
		}
	});
	t.diagnostic(
		`${inputs.length} cases. Cases where the reference's fill is wrong somewhere: ` +
			`Skia ${wrong.skia}, path-bool ${wrong.pathBool}; ` +
			`where it gives up: Skia ${wrong.skiaFailed}, path-bool ${wrong.pathBoolFailed}.`,
	);
});
