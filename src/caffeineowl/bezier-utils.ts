// Ported from Adrian Colomitchi's bezier-utils
// (com/caffeineowl/graphics/bezier/BezierUtils.java, from bezier-utils-src.jar
// on caffeineowl.com): halfSplitCurve, splitCurve, computeInflexion,
// adaptiveHalving, applyMidPointApprox, MidPointApproxSubdivCriterion,
// adaptiveHalvingDegreeReduction and doAdaptiveDegreeReduction.
// Copyright (c) 2006 Adrian Colomitchi, MIT license: see THIRD_PARTY_NOTICES.
//
// The algorithms are described in Adrian Colomitchi, "Approximating cubic
// Bezier curves by quadratic ones" (Sep. 2006),
// http://www.caffeineowl.com/graphics/2d/vectorial/cubic2quad01.html
// (archived: https://web.archive.org/web/20150403003715/http://www.caffeineowl.com/graphics/2d/vectorial/cubic2quad01.html),
// and "Inflection points of a cubic Bezier" (Sep. 2004),
// http://www.caffeineowl.com/graphics/2d/vectorial/cubic-inflexion.html
// (archived: https://web.archive.org/web/20150425075200/http://www.caffeineowl.com/graphics/2d/vectorial/cubic-inflexion.html).
//
// Changes from the Java code, to match the article:
//
// - MidPointApproxSubdivCriterion.shouldSplit returned true when the defect
//   was within the tolerance (`<=`), so a cubic already good enough was split
//   forever and one that wasn't was never split. Fixed to `>`.
// - doAdaptiveDegreeReduction computed `defect = 18/sqrt(3) · D0-1`, which
//   ignores `precision`. The article's tmax is the root of
//   sqrt(3)/18 · D0-1 · tmax^3 = prec, so this is fixed to
//   `defect = precision · 18/sqrt(3) / D0-1` (= tmax^3); the branches then
//   follow the article: >= 1 one quadratic, >= 0.125 (tmax >= 0.5) two halves,
//   otherwise split at tmax and 1 - tmax.
// - computeInflexion didn't count the second root when it was smaller than
//   the first (it moved it to params[0] without toRet++), so a cubic with two
//   inflection points returned only one. Fixed: both are returned, as its
//   documentation says.
//
// Not in the Java code, written from the article: the simple adaptive
// division, and dividing the cubic at its inflection points first ("Detect
// inflexion"), here with splitCurve and computeInflexion.

import type { Point } from '../path.js';

type Cubic = [Point, Point, Point, Point];
type Quad = [Point, Point, Point];

export type ColomitchiMethod = 'half' | 'adaptive' | 'symmetric';

/**
 * Subdivides a cubic Bézier at a value for the curve's parameter of 1/2.
 * The method uses de Casteljau algorithm.
 */
function halfSplitCurve(cubic: Cubic): [Cubic, Cubic] {
	const [{ x: x0, y: y0 }, { x: cx0, y: cy0 }, { x: cx1, y: cy1 }, { x: x1, y: y1 }] = cubic;

	const p0x = (x0 + cx0) / 2.0;
	const p0y = (y0 + cy0) / 2.0;
	const p1x = (cx0 + cx1) / 2.0;
	const p1y = (cy0 + cy1) / 2.0;
	const p2x = (cx1 + x1) / 2.0;
	const p2y = (cy1 + y1) / 2.0;

	const p01x = (p0x + p1x) / 2.0;
	const p01y = (p0y + p1y) / 2.0;
	const p12x = (p1x + p2x) / 2.0;
	const p12y = (p1y + p2y) / 2.0;

	const dpx = (p01x + p12x) / 2.0;
	const dpy = (p01y + p12y) / 2.0;

	return [
		[cubic[0], { x: p0x, y: p0y }, { x: p01x, y: p01y }, { x: dpx, y: dpy }],
		[{ x: dpx, y: dpy }, { x: p12x, y: p12y }, { x: p2x, y: p2y }, cubic[3]],
	];
}

/**
 * Subdivides a cubic Bézier at a given value for the curve's parameter.
 * The method uses de Casteljau algorithm.
 */
function splitCurve(cubic: Cubic, tSplit: number): [Cubic, Cubic] {
	const [{ x: x0, y: y0 }, { x: cx0, y: cy0 }, { x: cx1, y: cy1 }, { x: x1, y: y1 }] = cubic;

	const p0x = x0 + tSplit * (cx0 - x0);
	const p0y = y0 + tSplit * (cy0 - y0);
	const p1x = cx0 + tSplit * (cx1 - cx0);
	const p1y = cy0 + tSplit * (cy1 - cy0);
	const p2x = cx1 + tSplit * (x1 - cx1);
	const p2y = cy1 + tSplit * (y1 - cy1);

	const p01x = p0x + tSplit * (p1x - p0x);
	const p01y = p0y + tSplit * (p1y - p0y);
	const p12x = p1x + tSplit * (p2x - p1x);
	const p12y = p1y + tSplit * (p2y - p1y);

	const dpx = p01x + tSplit * (p12x - p01x);
	const dpy = p01y + tSplit * (p12y - p01y);

	return [
		[cubic[0], { x: p0x, y: p0y }, { x: p01x, y: p01y }, { x: dpx, y: dpy }],
		[{ x: dpx, y: dpy }, { x: p12x, y: p12y }, { x: p2x, y: p2y }, cubic[3]],
	];
}

/**
 * Subdivides a cubic Bézier in more than one subdivision points. The method
 * calls repeatedly the single point split method. The params are supposed to
 * be sorted in ascending order.
 */
function splitCurveMany(curve: Cubic, params: number[]): Cubic[] {
	const resultsHere: Cubic[] = [];
	let remainder = curve;
	let lastParam = 0;
	for (let i = 0; i < params.length && params[i] > 0.0; i++) {
		let firstPart: Cubic;
		[firstPart, remainder] = splitCurve(
			remainder,
			(params[i] - lastParam) / (1 - lastParam),
		);
		resultsHere.push(firstPart);
		lastParam = params[i];
	}
	resultsHere.push(remainder);
	return resultsHere;
}

/**
 * Computes the parameter values corresponding to the inflexion points of a
 * cubic Bézier (if any). Note that the method will return the values for the
 * parameter only if they fall in the (0, 1) range (excluding the range ends).
 * Note that if the curve has 2 inflexion points, they will be placed into the
 * results array in increasing order of their corresponding curve's parameter
 * values.
 */
export function computeInflexion(curve: Cubic): number[] {
	const params: number[] = [];
	// unpack the coordinates of the points defining the curve
	const [{ x: p0x, y: p0y }, { x: c0x, y: c0y }, { x: c1x, y: c1y }, { x: p1x, y: p1y }] =
		curve;

	// aux variables involved in computing the numerator
	// in the formula (fraction) of a cubic Bézier curvature
	const ax = c0x - p0x;
	const ay = c0y - p0y;
	const bx = c1x - c0x - ax;
	const by = c1y - c0y - ay;
	const cx = p1x - c1x - ax - bx - bx;
	const cy = p1y - c1y - ay - by - by;

	// coefficients of the polynomial in t that acts as the numerator
	// of the formula (fraction) of a cubic Bézier curvature.
	const c0 = ax * by - ay * bx;
	const c1 = ax * cy - ay * cx;
	let c2 = bx * cy - by * cx;

	if (c2 !== 0.0) {
		// quadratic equation
		let discr = c1 * c1 - 4 * c0 * c2;
		c2 *= 2;

		if (discr === 0) {
			const root = -c1 / c2;

			if (root > 0 && root < 1) {
				params[0] = root;
			}
		} else if (discr > 0) {
			discr = Math.sqrt(discr);

			let root = (-c1 - discr) / c2;
			if (root > 0 && root < 1) {
				// collect it only if between [0..1]
				params.push(root);
			}

			root = (-c1 + discr) / c2;
			if (root > 0 && root < 1) {
				// collect it only if between [0..1]
				if (params.length > 0 && params[0] > root) {
					// Fixed: counted, where the Java code has no toRet++.
					params[1] = params[0];
					params[0] = root;
				} else {
					params.push(root);
				}
			}

			if (params.length === 2 && params[0] > params[1]) {
				const aux = params[0];
				params[0] = params[1];
				params[1] = aux;
			}
		}
	} else if (c1 !== 0.0) {
		// linear equation c1*t+c0=0
		const root = -c0 / c1;
		if (root > 0 && root < 1) {
			params.push(root);
		}
	}
	// else its a totally degenerate curve: a single point
	return params;
}

/**
 * Method to perform an adaptive halving of a cubic Bézier, based on a
 * subdivision criterion (which tells when a cubic is good enough not to need
 * splitting in two anymore).
 */
function adaptiveHalving(
	curve: Cubic,
	shouldSplit: (c: Cubic) => boolean,
	segConsumer: (c: Cubic) => void,
): void {
	if (shouldSplit(curve)) {
		const [firstHalf, secondHalf] = halfSplitCurve(curve);
		adaptiveHalving(firstHalf, shouldSplit, segConsumer);
		adaptiveHalving(secondHalf, shouldSplit, segConsumer);
	} else {
		segConsumer(curve);
	}
}

/** Converts a cubic Bézier to a quadratic one, using the mid-point approximation. */
function applyMidPointApprox(cubic: Cubic): Quad {
	const [a0, c1, c2, a1] = cubic;
	const p0x = (3 * c1.x - a0.x) / 2.0;
	const p0y = (3 * c1.y - a0.y) / 2.0;
	const p1x = (3 * c2.x - a1.x) / 2.0;
	const p1y = (3 * c2.y - a1.y) / 2.0;
	return [a0, { x: (p0x + p1x) / 2, y: (p0y + p1y) / 2 }, a1];
}

const v18div_sqrt3 = 18.0 / Math.sqrt(3.0);

const v3div_sq36 = 3.0 / (36.0 * 36);

/**
 * The adaptive halving criterion for approximating a cubic by the mid-point
 * approximation quadratic, tuned for the specified precision (the minimum
 * accepted being 1.0e-5).
 */
function midPointApproxSubdivCriterion(prec: number): (c: Cubic) => boolean {
	// The square of the tolerance (degree of precision) accepted by this criterion.
	let sqTol = prec * prec;
	if (sqTol < 1.0e-10) {
		sqTol = 1.0e-5;
	}
	// Whether the square of the distance between the control points of 0- and
	// 1- approximations of the given cubic multiplied by
	// 1/432=1/(sqrt(3)/36)^2 is greater than the square of the requested
	// precision. (Fixed: `>`, where the Java code has `<=`.)
	return c => {
		let dx = c[2].x - c[1].x;
		dx = c[3].x - c[0].x - dx - dx - dx;
		let dy = c[2].y - c[1].y;
		dy = c[3].y - c[0].y - dy - dy - dy;
		const sqDist = dx * dx + dy * dy;
		return sqDist * v3div_sq36 > sqTol;
	};
}

function adaptiveHalvingDegreeReduction(cubic: Cubic, precision: number, out: Quad[]): void {
	adaptiveHalving(cubic, midPointApproxSubdivCriterion(precision), c =>
		out.push(applyMidPointApprox(c)),
	);
}

/** The very core of the adaptive cubic Bézier degree reduction. */
function doAdaptiveDegreeReduction(cubic: Cubic, precision: number, out: Quad[]): void {
	const [a0, c1, c2, a1] = cubic;
	const p0x = (3 * c1.x - a0.x) / 2.0;
	const p0y = (3 * c1.y - a0.y) / 2.0;
	const p1x = (3 * c2.x - a1.x) / 2.0;
	const p1y = (3 * c2.y - a1.y) / 2.0;

	// Fixed: the Java code has `v18div_sqrt3*Math.hypot(p1x-p0x, p1y-p0y)`.
	const defect = (precision * v18div_sqrt3) / Math.hypot(p1x - p0x, p1y - p0y);
	if (defect >= 1.0) {
		// a single segment
		out.push([a0, { x: (p0x + p1x) / 2, y: (p0y + p1y) / 2 }, a1]);
	} else if (defect >= 0.125) {
		// 0.125=(0.5)^3
		// split the curve in 2 halves
		const [firstHalf, secondHalf] = halfSplitCurve(cubic);
		out.push(applyMidPointApprox(firstHalf));
		out.push(applyMidPointApprox(secondHalf));
	} else {
		// div t is less than 0.5, go on 1 step adaptive
		const t = Math.cbrt(defect);
		const segs = splitCurveMany(cubic, [t, 1.0 - t]);
		out.push(applyMidPointApprox(segs[0]));
		doAdaptiveDegreeReduction(segs[1], precision, out);
		out.push(applyMidPointApprox(segs[2]));
	}
}

/**
 * The simple adaptive division, from the article: compute tmax as the root
 * of sqrt(3)/18 · D0-1 · tmax^3 = prec; if tmax is less than 1.0, subdivide
 * the cubic at tmax, approximate the first segment using mid-point
 * approximation and enter again the first step with the second cubic segment;
 * otherwise use mid-point approximation and exit the cycle.
 */
function simpleAdaptiveDegreeReduction(cubic: Cubic, precision: number, out: Quad[]): void {
	for (;;) {
		const [a0, c1, c2, a1] = cubic;
		const p0x = (3 * c1.x - a0.x) / 2.0;
		const p0y = (3 * c1.y - a0.y) / 2.0;
		const p1x = (3 * c2.x - a1.x) / 2.0;
		const p1y = (3 * c2.y - a1.y) / 2.0;
		const tmax = Math.cbrt((precision * v18div_sqrt3) / Math.hypot(p1x - p0x, p1y - p0y));
		if (!(tmax < 1.0)) {
			out.push(applyMidPointApprox(cubic));
			return;
		}
		const [first, second] = splitCurve(cubic, tmax);
		out.push(applyMidPointApprox(first));
		cubic = second;
	}
}

/** Quadratics approximating the cubic within prec, by one of the article's three methods. */
export function colomitchi(
	c: Cubic,
	prec: number,
	method: ColomitchiMethod,
	detectInflections = false,
): Quad[] {
	const parts = detectInflections ? splitCurveMany(c, computeInflexion(c)) : [c];
	const run =
		method === 'half'
			? adaptiveHalvingDegreeReduction
			: method === 'adaptive'
				? simpleAdaptiveDegreeReduction
				: doAdaptiveDegreeReduction;
	const out: Quad[] = [];
	for (const part of parts) run(part, prec, out);
	return out;
}
