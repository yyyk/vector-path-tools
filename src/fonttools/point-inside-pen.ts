// Ported from fontTools (https://github.com/fonttools/fonttools), at commit
// 1ff10daa33d4e40af00a76cda7fa804af4200b30: PointInsidePen in
// Lib/fontTools/pens/pointInsidePen.py, BasePen's moveTo, lineTo, curveTo,
// qCurveTo, closePath and _qCurveToOne in Lib/fontTools/pens/basePen.py, and
// solveQuadratic and solveCubic in Lib/fontTools/misc/bezierTools.py.
// Copyright (c) 2017 Just van Rossum, MIT license: see THIRD_PARTY_NOTICES.
// Modified: translated to TypeScript, driven by path commands instead of pen
// calls.

import type { PathCommand, Point } from '../path.js';

// ---------- Lib/fontTools/misc/bezierTools.py ----------

const epsilonDigits = 6;
const epsilon = 1e-10;

const view = new DataView(new ArrayBuffer(8));

/** Python's round(x, ndigits): to nearest, ties to even, on x's exact value. */
function round(x: number, ndigits: number): number {
	if (!Number.isFinite(x)) return x;
	view.setFloat64(0, x);
	const hi = view.getUint32(0);
	const lo = view.getUint32(4);
	const exponent = (hi >>> 20) & 0x7ff;
	let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
	if (exponent) m |= 1n << 52n;
	const e = (exponent || 1) - 1075;
	if (e >= 0) return x; // an integer: already exact
	const num = m * 10n ** BigInt(ndigits);
	const den = 1n << BigInt(-e);
	let q = num / den;
	const r2 = (num % den) * 2n;
	if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
	const result = Number(`${q}e-${ndigits}`);
	return hi >>> 31 ? -result : result;
}

/**
 * Solve a quadratic equation.
 *
 * Solves *a*x*x + b*x + c = 0* where a, b and c are real.
 *
 * Returns a list of roots. Note that the returned list is neither guaranteed
 * to be sorted nor to contain unique values!
 */
function solveQuadratic(a: number, b: number, c: number): number[] {
	let roots: number[];
	if (Math.abs(a) < epsilon) {
		if (Math.abs(b) < epsilon) {
			// We have a non-equation; therefore, we have no valid solution
			roots = [];
		} else {
			// We have a linear equation with 1 root.
			roots = [-c / b];
		}
	} else {
		// We have a true quadratic equation.  Apply the quadratic formula to find two roots.
		const DD = b * b - 4.0 * a * c;
		if (DD >= 0.0) {
			const rDD = Math.sqrt(DD);
			roots = [(-b + rDD) / 2.0 / a, (-b - rDD) / 2.0 / a];
		} else {
			// complex roots, ignore
			roots = [];
		}
	}
	return roots;
}

/**
 * Solve a cubic equation.
 *
 * Solves *a*x*x*x + b*x*x + c*x + d = 0* where a, b, c and d are real.
 *
 * Returns a list of roots. Note that the returned list is neither guaranteed
 * to be sorted nor to contain unique values!
 */
function solveCubic(a: number, b: number, c: number, d: number): number[] {
	//
	// adapted from:
	//   CUBIC.C - Solve a cubic polynomial
	//   public domain by Ross Cottrell
	// found at: http://www.strangecreations.com/library/snippets/Cubic.C
	//
	if (Math.abs(a) < epsilon) {
		// don't just test for zero; for very small values of 'a' solveCubic()
		// returns unreliable results, so we fall back to quad.
		return solveQuadratic(b, c, d);
	}
	const a1 = b / a;
	const a2 = c / a;
	const a3 = d / a;

	const Q = (a1 * a1 - 3.0 * a2) / 9.0;
	const R = (2.0 * a1 * a1 * a1 - 9.0 * a1 * a2 + 27.0 * a3) / 54.0;

	let R2 = R * R;
	let Q3 = Q * Q * Q;
	R2 = R2 < epsilon ? 0 : R2;
	Q3 = Math.abs(Q3) < epsilon ? 0 : Q3;

	const R2_Q3 = R2 - Q3;

	if (R2 === 0.0 && Q3 === 0.0) {
		const x = round(-a1 / 3.0, epsilonDigits);
		return [x, x, x];
	} else if (R2_Q3 <= epsilon * 0.5) {
		// The epsilon * .5 above ensures that Q3 is not zero.
		const theta = Math.acos(Math.max(Math.min(R / Math.sqrt(Q3), 1.0), -1.0));
		const rQ2 = -2.0 * Math.sqrt(Q);
		const a1_3 = a1 / 3.0;
		let x0 = rQ2 * Math.cos(theta / 3.0) - a1_3;
		let x1 = rQ2 * Math.cos((theta + 2.0 * Math.PI) / 3.0) - a1_3;
		let x2 = rQ2 * Math.cos((theta + 4.0 * Math.PI) / 3.0) - a1_3;
		[x0, x1, x2] = [x0, x1, x2].sort((p, q) => p - q);
		// Merge roots that are close-enough
		if (x1 - x0 < epsilon && x2 - x1 < epsilon) {
			x0 = x1 = x2 = round((x0 + x1 + x2) / 3.0, epsilonDigits);
		} else if (x1 - x0 < epsilon) {
			x0 = x1 = round((x0 + x1) / 2.0, epsilonDigits);
			x2 = round(x2, epsilonDigits);
		} else if (x2 - x1 < epsilon) {
			x0 = round(x0, epsilonDigits);
			x1 = x2 = round((x1 + x2) / 2.0, epsilonDigits);
		} else {
			x0 = round(x0, epsilonDigits);
			x1 = round(x1, epsilonDigits);
			x2 = round(x2, epsilonDigits);
		}
		return [x0, x1, x2];
	} else {
		let x = Math.pow(Math.sqrt(R2_Q3) + Math.abs(R), 1 / 3.0);
		x = x + Q / x;
		if (R >= 0.0) {
			x = -x;
		}
		x = round(x - a1 / 3.0, epsilonDigits);
		return [x];
	}
}

// ---------- Lib/fontTools/pens/pointInsidePen.py ----------

/**
 * This pen implements "point inside" testing: to test whether a given point
 * lies inside the shape (black) or outside (white).
 *
 * Both the even-odd algorithm and the non-zero-winding-rule algorithm are
 * implemented.
 */
class PointInsidePen {
	// This class implements the classical "shoot a ray from the test point
	// to infinity and count how many times it intersects the outline" (as well
	// as the non-zero variant, where the counter is incremented if the outline
	// intersects the ray in one direction and decremented if it intersects in
	// the other direction).
	// I found an amazingly clear explanation of the subtleties involved in
	// implementing this correctly for polygons here:
	//   http://graphics.cs.ucdavis.edu/~okreylos/TAship/Spring2000/PointInPolygon.html
	// I extended the principles outlined on that page to curves.

	private firstPoint: Point | null = null;
	private intersectionCount = 0;
	private currentPoint: Point | null = null;

	constructor(
		private testPoint: Point,
		private evenOdd = false,
	) {}

	getWinding(): number {
		if (this.firstPoint !== null) {
			// always make sure the sub paths are closed; the algorithm only works
			// for closed paths.
			this.closePath();
		}
		return this.intersectionCount;
	}

	/**
	 * After the shape has been drawn, getResult() returns True if the test
	 * point lies within the (black) shape, and False if it doesn't.
	 */
	getResult(): boolean {
		const winding = this.getWinding();
		let result: number | boolean;
		if (this.evenOdd) {
			result = winding % 2;
		} else {
			// non-zero
			result = this.intersectionCount !== 0;
		}
		return !!result;
	}

	private addIntersection(goingUp: boolean): void {
		if (this.evenOdd || goingUp) {
			this.intersectionCount += 1;
		} else {
			this.intersectionCount -= 1;
		}
	}

	// BasePen's public methods.

	moveTo(pt: Point): void {
		this._moveTo(pt);
		this.currentPoint = pt;
	}

	lineTo(pt: Point): void {
		this._lineTo(pt);
		this.currentPoint = pt;
	}

	curveTo(pt1: Point, pt2: Point, pt3: Point): void {
		this._curveToOne(pt1, pt2, pt3);
		this.currentPoint = pt3;
	}

	qCurveTo(pt1: Point, pt2: Point): void {
		this._qCurveToOne(pt1, pt2);
		this.currentPoint = pt2;
	}

	closePath(): void {
		this._closePath();
		this.currentPoint = null;
	}

	/**
	 * BasePen's _qCurveToOne: "This method implements the basic quadratic
	 * curve type. The default implementation delegates the work to the cubic
	 * curve function."
	 */
	private _qCurveToOne(pt1: Point, pt2: Point): void {
		const { x: pt0x, y: pt0y } = this.currentPoint!;
		const { x: pt1x, y: pt1y } = pt1;
		const { x: pt2x, y: pt2y } = pt2;
		const mid1x = pt0x + 0.66666666666666667 * (pt1x - pt0x);
		const mid1y = pt0y + 0.66666666666666667 * (pt1y - pt0y);
		const mid2x = pt2x + 0.66666666666666667 * (pt1x - pt2x);
		const mid2y = pt2y + 0.66666666666666667 * (pt1y - pt2y);
		this._curveToOne({ x: mid1x, y: mid1y }, { x: mid2x, y: mid2y }, pt2);
	}

	private _moveTo(point: Point): void {
		if (this.firstPoint !== null) {
			// always make sure the sub paths are closed; the algorithm only works
			// for closed paths.
			this.closePath();
		}
		this.firstPoint = point;
	}

	private _lineTo(point: Point): void {
		const { x, y } = this.testPoint;
		const { x: x1, y: y1 } = this.currentPoint!;
		const { x: x2, y: y2 } = point;

		if (x1 < x && x2 < x) {
			return;
		}
		if (y1 < y && y2 < y) {
			return;
		}
		if (y1 >= y && y2 >= y) {
			return;
		}

		const dx = x2 - x1;
		const dy = y2 - y1;
		const t = (y - y1) / dy;
		const ix = dx * t + x1;
		if (ix < x) {
			return;
		}
		this.addIntersection(y2 > y1);
	}

	private _curveToOne(bcp1: Point, bcp2: Point, point: Point): void {
		const { x, y } = this.testPoint;
		const { x: x1, y: y1 } = this.currentPoint!;
		const { x: x2, y: y2 } = bcp1;
		const { x: x3, y: y3 } = bcp2;
		const { x: x4, y: y4 } = point;

		if (x1 < x && x2 < x && x3 < x && x4 < x) {
			return;
		}
		if (y1 < y && y2 < y && y3 < y && y4 < y) {
			return;
		}
		if (y1 >= y && y2 >= y && y3 >= y && y4 >= y) {
			return;
		}

		const dy = y1;
		const cy = (y2 - dy) * 3.0;
		const by = (y3 - y2) * 3.0 - cy;
		const ay = y4 - dy - cy - by;
		let solutions = solveCubic(ay, by, cy, dy - y).sort((p, q) => p - q);
		solutions = solutions.filter(t => -0.0 <= t && t <= 1.0);
		if (!solutions.length) {
			return;
		}

		const dx = x1;
		const cx = (x2 - dx) * 3.0;
		const bx = (x3 - x2) * 3.0 - cx;
		const ax = x4 - dx - cx - bx;

		let lastT: number | null = null;
		for (const t of solutions) {
			if (t === lastT) {
				continue;
			}
			lastT = t;
			const t2 = t * t;
			const t3 = t2 * t;

			let direction = 3 * ay * t2 + 2 * by * t + cy;
			let incomingGoingUp = direction > 0.0;
			let outgoingGoingUp = incomingGoingUp;
			if (direction === 0.0) {
				direction = 6 * ay * t + 2 * by;
				outgoingGoingUp = direction > 0.0;
				incomingGoingUp = !outgoingGoingUp;
				if (direction === 0.0) {
					direction = ay;
					incomingGoingUp = outgoingGoingUp = direction > 0.0;
				}
			}

			const xt = ax * t3 + bx * t2 + cx * t + dx;
			if (xt < x) {
				continue;
			}

			if (t === 0) {
				if (!outgoingGoingUp) {
					this.addIntersection(outgoingGoingUp);
				}
			} else if (t === 1.0) {
				if (incomingGoingUp) {
					this.addIntersection(incomingGoingUp);
				}
			} else {
				if (incomingGoingUp === outgoingGoingUp) {
					this.addIntersection(outgoingGoingUp);
				}
				// else:
				//   we're not really intersecting, merely touching
			}
		}
	}

	private _closePath(): void {
		const cur = this.currentPoint!;
		const first = this.firstPoint!;
		if (cur.x !== first.x || cur.y !== first.y) {
			this.lineTo(first);
		}
		this.firstPoint = null;
	}
}

/**
 * Draws the path into a PointInsidePen and returns getResult(). A drawing
 * command right after a close starts a new contour at the subpath's start.
 */
export function pointInside(
	commands: PathCommand[],
	testPoint: Point,
	evenOdd: boolean,
): boolean {
	const pen = new PointInsidePen(testPoint, evenOdd);
	let start: Point = { x: 0, y: 0 };
	let open = false;
	for (const c of commands) {
		if (c.type === 'close') {
			if (open) pen.closePath();
			open = false;
			continue;
		}
		const p = { x: c.x, y: c.y };
		if (c.type === 'moveTo') {
			pen.moveTo(p);
			start = p;
			open = true;
			continue;
		}
		if (!open) {
			pen.moveTo(start);
			open = true;
		}
		if (c.type === 'lineTo') pen.lineTo(p);
		else if (c.type === 'quadTo') pen.qCurveTo({ x: c.cx, y: c.cy }, p);
		else pen.curveTo({ x: c.c1x, y: c.c1y }, { x: c.c2x, y: c.c2y }, p);
	}
	return pen.getResult();
}
