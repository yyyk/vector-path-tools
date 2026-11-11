// Ported from Skia, src/gpu/tessellate/WangsFormula.h
// (https://github.com/google/skia/blob/50ba8e6d82572c55b146d8c802fe1fc14d47ca1c/src/gpu/tessellate/WangsFormula.h),
// Copyright 2020 Google LLC, BSD-3-Clause license: see THIRD_PARTY_NOTICES.
// Only the quadratic and cubic formulas, with precision as the last parameter.
//
// Wang's formula gives the minimum number of evenly spaced (in the parametric sense) line segments
// that a bezier curve must be chopped into in order to guarantee all lines stay within a distance
// of "1/precision" pixels from the true curve. Its definition for a bezier curve of degree "n" is
// as follows:
//
//     maxLength = max([length(p[i+2] - 2p[i+1] + p[i]) for (0 <= i <= n-2)])
//     numParametricSegments = sqrt(maxLength * precision * n*(n - 1)/8)
//
// (Goldman, Ron. (2003). 5.6.3 Wang's Formula. "Pyramid Algorithms: A Dynamic Programming Approach
// to Curves and Surfaces for Geometric Modeling". Morgan Kaufmann Publishers.)

import type { Point } from '../path.js';

// Don't allow linearized segments to be off by more than 1/4th of a pixel from the true curve.
// (Skia's kPrecision, src/gpu/tessellate/Tessellation.h)
export const DEFAULT_PRECISION = 4;

function lengthTermP2(degree: number, precision: number): number {
	return ((degree * degree * ((degree - 1) * (degree - 1))) / 64) * (precision * precision);
}

function root4(x: number): number {
	return Math.sqrt(Math.sqrt(x));
}

// Returns Wang's formula, raised to the 4th power, specialized for a quadratic curve.
function quadraticP4(precision: number, p0: Point, p1: Point, p2: Point): number {
	const vx = -2 * p1.x + p0.x + p2.x;
	const vy = -2 * p1.y + p0.y + p2.y;
	return (vx * vx + vy * vy) * lengthTermP2(2, precision);
}

// Returns Wang's formula specialized for a quadratic curve.
export function quadratic(
	p0: Point,
	p1: Point,
	p2: Point,
	precision: number = DEFAULT_PRECISION,
): number {
	return root4(quadraticP4(precision, p0, p1, p2));
}

// Returns Wang's formula, raised to the 4th power, specialized for a cubic curve.
function cubicP4(precision: number, p0: Point, p1: Point, p2: Point, p3: Point): number {
	const ax = -2 * p1.x + p0.x + p2.x;
	const ay = -2 * p1.y + p0.y + p2.y;
	const bx = -2 * p2.x + p1.x + p3.x;
	const by = -2 * p2.y + p1.y + p3.y;
	return Math.max(ax * ax + ay * ay, bx * bx + by * by) * lengthTermP2(3, precision);
}

// Returns Wang's formula specialized for a cubic curve.
export function cubic(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	precision: number = DEFAULT_PRECISION,
): number {
	return root4(cubicP4(precision, p0, p1, p2, p3));
}
