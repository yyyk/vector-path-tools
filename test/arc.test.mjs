import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arcTo, bounds } from '../dist/index.js';
import { arcToBezier } from '../dist/svg-arc-to-cubic-bezier/arc-to-bezier.js';

test('svg-arc-to-cubic-bezier: bit-identical to the original (fixtures/svg-arc.json)', () => {
	const cases = JSON.parse(
		readFileSync(new URL('./fixtures/svg-arc.json', import.meta.url), 'utf8'),
	);
	// Through JSON, as the fixture was written (JSON has no -0).
	for (const c of cases)
		assert.deepEqual(JSON.parse(JSON.stringify(arcToBezier(c.arc))), c.out);
});

test('a half circle: two quarter-circle cubics through the top', () => {
	// From (0, 0) to (100, 0), radius 50, sweep: clockwise on screen (y down), so over the top.
	const out = arcTo(0, 0, 50, 50, 0, false, true, 100, 0);
	assert.equal(out.length, 2);
	assert.ok(out.every(c => c.type === 'cubicTo'));
	assert.ok(Math.abs(out[0].x - 50) < 1e-9 && Math.abs(out[0].y + 50) < 1e-9);
	assert.ok(Math.abs(out[1].x - 100) < 1e-9 && Math.abs(out[1].y) < 1e-9);
	const b = bounds([{ type: 'moveTo', x: 0, y: 0 }, ...out]);
	assert.ok(Math.abs(b.minY + 50) < 1e-9);
});

test('as the SVG spec says: identical end points draw nothing, a zero radius is a line', () => {
	assert.deepEqual(arcTo(10, 20, 50, 50, 0, false, true, 10, 20), []);
	assert.deepEqual(arcTo(0, 0, 0, 50, 0, false, true, 30, 40), [
		{ type: 'lineTo', x: 30, y: 40 },
	]);
	assert.deepEqual(arcTo(0, 0, 50, 0, 0, true, false, 30, 40), [
		{ type: 'lineTo', x: 30, y: 40 },
	]);
});

test('the flags choose among the four arcs', () => {
	const ends = flags =>
		arcTo(0, 0, 60, 60, 0, flags[0], flags[1], 100, 0).map(c => [c.c1x, c.c1y, c.x, c.y]);
	const all = [
		[false, false],
		[false, true],
		[true, false],
		[true, true],
	].map(ends);
	for (let i = 0; i < 4; i++)
		for (let j = i + 1; j < 4; j++) assert.notDeepEqual(all[i], all[j]);
});

test('invalid input', () => {
	assert.throws(() => arcTo(0, 0, NaN, 10, 0, false, false, 1, 1), TypeError);
	assert.throws(() => arcTo(0, 0, 10, 10, Infinity, false, false, 1, 1), TypeError);
});
