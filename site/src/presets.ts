// Example paths for the demos, in canvas coordinates (about 600 × 400).
import type { PathCommand } from 'vector-path-tools';

const M = (x: number, y: number): PathCommand => ({ type: 'moveTo', x, y });
const Q = (cx: number, cy: number, x: number, y: number): PathCommand => ({
	type: 'quadTo',
	cx,
	cy,
	x,
	y,
});
const C = (
	c1x: number,
	c1y: number,
	c2x: number,
	c2y: number,
	x: number,
	y: number,
): PathCommand => ({
	type: 'cubicTo',
	c1x,
	c1y,
	c2x,
	c2y,
	x,
	y,
});
const Z: PathCommand = { type: 'close' };

export const PRESETS: Record<string, PathCommand[]> = {
	// S-curve (an inflection)
	s: [M(80, 320), C(560, 320, 40, 80, 520, 80)],
	// Hook (sharp at one end)
	hook: [M(60, 330), C(260, 330, 460, 330, 500, 60)],
	// The same hook as a quadratic
	hookQuad: [M(60, 330), Q(460, 330, 500, 60)],
	// Drop (closed, cubics)
	drop: [
		M(300, 40),
		C(380, 160, 470, 230, 420, 310),
		C(380, 380, 220, 380, 180, 310),
		C(130, 230, 220, 160, 300, 40),
		Z,
	],
	// Glyph-like (quadratics, a hole)
	glyph: [
		M(300, 50),
		Q(470, 50, 470, 200),
		Q(470, 350, 300, 350),
		Q(130, 350, 130, 200),
		Q(130, 50, 300, 50),
		Z,
		M(300, 120),
		Q(220, 120, 220, 200),
		Q(220, 280, 300, 280),
		Q(380, 280, 380, 200),
		Q(380, 120, 300, 120),
		Z,
	],
};

/**
 * Single curves for the comparison pages (four points: the cubic's, or, for a
 * quadratic, the first, second and last), about 400 × 360.
 */
export const CURVES: Record<string, { x: number; y: number }[]> = {
	// Sharp at its start, flat after: where the methods differ most.
	worst: [
		[81.3, -31.7],
		[24.4, 6.4],
		[-55.8, 58.1],
		[-56, 25.4],
	].map(([x, y]) => ({ x: 200 + x * 2.1, y: 150 + y * 2.1 })),
	hook: [
		{ x: 30, y: 320 },
		{ x: 140, y: 320 },
		{ x: 250, y: 320 },
		{ x: 270, y: 40 },
	],
	s: [
		{ x: 30, y: 310 },
		{ x: 370, y: 310 },
		{ x: 30, y: 50 },
		{ x: 370, y: 50 },
	],
	arch: [
		{ x: 30, y: 330 },
		{ x: 50, y: 20 },
		{ x: 350, y: 20 },
		{ x: 370, y: 330 },
	],
	loop: [
		{ x: 50, y: 280 },
		{ x: 400, y: 40 },
		{ x: 0, y: 40 },
		{ x: 350, y: 280 },
	],
	fold: [
		{ x: 40, y: 200 },
		{ x: 380, y: 190 },
		{ x: 380, y: 210 },
		{ x: 60, y: 200 },
	],
};
