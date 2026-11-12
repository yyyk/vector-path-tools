// Arc length with error control, built on stroke-outline's fixed 24-point
// Gauss–Legendre quadrature (stroke-outline/arc-length.ts): each piece of the
// curve is measured whole and as two halves, and split again where the two
// disagree by more than its share of the tolerance. Curves whose speed nearly
// drops to zero (sharp turns, near-cusps) get more pieces there; gentle ones
// stay at one or two.
//
// The parameter at a distance uses those pieces as its table: it finds the
// piece the distance falls in, then solves for t inside it by Newton's method
// on the 24-point length (whose derivative is the speed), kept inside the piece
// by bisection. The pieces follow the curve's shape and every tolerance is
// relative to its length, so the result doesn't depend on the coordinate units.

import type { Point } from './path.js';
import {
	arcLengthCubicRange,
	arcLengthQuadraticRange,
	cubicBezierDerivative,
	quadraticBezierDerivative,
} from './stroke-outline/arc-length.js';

/** The default tolerance, relative to the curve's length. */
export const DEFAULT_RELATIVE_TOLERANCE = 1e-10;

/** At most this many halvings of a piece: a bound on the work, 2^30 pieces. */
const MAX_DEPTH = 30;

/** At most this many Newton (or bisection) steps inside a piece. */
const MAX_STEPS = 60;

type Range = (t0: number, t1: number) => number;

interface Piece {
	t0: number;
	t1: number;
	length: number;
}

function adaptive(
	range: Range,
	t0: number,
	t1: number,
	whole: number,
	tolerance: number,
	depth: number,
	pieces?: Piece[],
): number {
	const mid = (t0 + t1) / 2;
	const left = range(t0, mid);
	const right = range(mid, t1);
	const halves = left + right;
	if (depth >= MAX_DEPTH || Math.abs(halves - whole) <= tolerance) {
		pieces?.push({ t0, t1: mid, length: left }, { t0: mid, t1, length: right });
		return halves;
	}
	return (
		adaptive(range, t0, mid, left, tolerance / 2, depth + 1, pieces) +
		adaptive(range, mid, t1, right, tolerance / 2, depth + 1, pieces)
	);
}

function lengthOf(range: Range, relativeTolerance: number, pieces?: Piece[]): number {
	const whole = range(0, 1);
	return adaptive(range, 0, 1, whole, relativeTolerance * Math.abs(whole), 0, pieces);
}

/**
 * A curve's length and the parameter at a distance along it. The pieces the
 * length is measured in are kept, so each query only solves inside one piece.
 */
export class CurveMeasure {
	readonly length: number;
	private readonly pieces: Piece[] = [];
	/** The length before each piece. */
	private readonly starts: number[] = [];
	private readonly tolerance: number;

	constructor(
		private readonly range: Range,
		private readonly speed: (t: number) => number,
		relativeTolerance = DEFAULT_RELATIVE_TOLERANCE,
	) {
		this.length = lengthOf(range, relativeTolerance, this.pieces);
		this.tolerance = relativeTolerance * this.length;
		let before = 0;
		for (const piece of this.pieces) {
			this.starts.push(before);
			before += piece.length;
		}
	}

	/** The parameter t where the length from the curve's start reaches `distance`. */
	tAtLength(distance: number): number {
		if (!(distance > 0)) return 0;
		if (distance >= this.length) return 1;

		// The last piece starting before the distance (binary search).
		let lo = 0;
		let hi = this.pieces.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.starts[mid] < distance) lo = mid;
			else hi = mid - 1;
		}
		const piece = this.pieces[lo];
		const target = distance - this.starts[lo];

		// Solve range(piece.t0, t) = target, starting from a linear guess.
		let a = piece.t0;
		let b = piece.t1;
		let t = piece.length > 0 ? a + ((b - a) * target) / piece.length : a;
		for (let step = 0; step < MAX_STEPS; step++) {
			const g = this.range(piece.t0, t) - target;
			if (Math.abs(g) <= this.tolerance) break;
			if (g < 0) a = t;
			else b = t;
			let next = t - g / this.speed(t);
			if (!(next > a && next < b)) next = (a + b) / 2; // keep it inside the piece
			if (next === t) break;
			t = next;
		}
		return t;
	}
}

const norm = (v: Point) => Math.sqrt(v.x * v.x + v.y * v.y);

export function quadraticMeasure(
	p0: Point,
	p1: Point,
	p2: Point,
	relativeTolerance = DEFAULT_RELATIVE_TOLERANCE,
): CurveMeasure {
	return new CurveMeasure(
		(t0, t1) => arcLengthQuadraticRange(p0, p1, p2, t0, t1),
		t => norm(quadraticBezierDerivative(p0, p1, p2, t)),
		relativeTolerance,
	);
}

export function cubicMeasure(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	relativeTolerance = DEFAULT_RELATIVE_TOLERANCE,
): CurveMeasure {
	return new CurveMeasure(
		(t0, t1) => arcLengthCubicRange(p0, p1, p2, p3, t0, t1),
		t => norm(cubicBezierDerivative(p0, p1, p2, p3, t)),
		relativeTolerance,
	);
}

export function quadraticLength(
	p0: Point,
	p1: Point,
	p2: Point,
	relativeTolerance = DEFAULT_RELATIVE_TOLERANCE,
): number {
	return lengthOf((t0, t1) => arcLengthQuadraticRange(p0, p1, p2, t0, t1), relativeTolerance);
}

export function cubicLength(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	relativeTolerance = DEFAULT_RELATIVE_TOLERANCE,
): number {
	return lengthOf((t0, t1) => arcLengthCubicRange(p0, p1, p2, p3, t0, t1), relativeTolerance);
}

/** The parameter t where the quadratic's length from its start reaches `distance`. */
export function quadraticTAtLength(
	p0: Point,
	p1: Point,
	p2: Point,
	distance: number,
	relativeTolerance = DEFAULT_RELATIVE_TOLERANCE,
): number {
	return quadraticMeasure(p0, p1, p2, relativeTolerance).tAtLength(distance);
}

/** The parameter t where the cubic's length from its start reaches `distance`. */
export function cubicTAtLength(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	distance: number,
	relativeTolerance = DEFAULT_RELATIVE_TOLERANCE,
): number {
	return cubicMeasure(p0, p1, p2, p3, relativeTolerance).tAtLength(distance);
}
