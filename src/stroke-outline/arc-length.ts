// Ported from stroke-outline (https://github.com/yyyk/stroke-outline), at commit
// 16aa4a004971b38280c3dfd9b256724fcb85969e:
// arc_length_quadratic, arc_length_cubic and their ranges in
// src/bezier/arc_length.cpp; quadratic_bezier, cubic_bezier and their
// derivatives in src/bezier/bezier.hpp; and the dash arc-length table
// (resolve_lut_steps, ArcLengthLUT) in src/stroke/dash.cpp, which builds it with
// steps = 100. Same author and license as this package.
//
// stroke-outline's length is based on bezierjs (https://github.com/Pomax/bezierjs,
// Copyright (c) 2023 Pomax, MIT license: see THIRD_PARTY_NOTICES): the same
// quadrature and constants as its Bezier.length and utils.length, with the
// curve's derivative in closed form, which for cubics rounds differently in the
// last bit.
//
// Length is a fixed 24-point Gauss–Legendre quadrature of the curve's speed;
// the table sums chords at about one sample per unit of length and finds the
// parameter at a distance by bisection and linear interpolation.

import type { Point } from '../path.js';

const T_VALUES = [
	-0.0640568928626056260850430826247450385909, 0.0640568928626056260850430826247450385909,
	-0.1911188674736163091586398207570696318404, 0.1911188674736163091586398207570696318404,
	-0.3150426796961633743867932913198102407864, 0.3150426796961633743867932913198102407864,
	-0.4337935076260451384870842319133497124524, 0.4337935076260451384870842319133497124524,
	-0.5454214713888395356583756172183723700107, 0.5454214713888395356583756172183723700107,
	-0.6480936519369755692524957869107476266696, 0.6480936519369755692524957869107476266696,
	-0.7401241915785543642438281030999784255232, 0.7401241915785543642438281030999784255232,
	-0.8200019859739029219539498726697452080761, 0.8200019859739029219539498726697452080761,
	-0.8864155270044010342131543419821967550873, 0.8864155270044010342131543419821967550873,
	-0.9382745520027327585236490017087214496548, 0.9382745520027327585236490017087214496548,
	-0.9747285559713094981983919930081690617411, 0.9747285559713094981983919930081690617411,
	-0.9951872199970213601799974097007368118745, 0.9951872199970213601799974097007368118745,
];

// Legendre-Gauss weights with n=24 (w_i values, defined by a function linked to in the
// Bezier primer article)
const C_VALUES = [
	0.1279381953467521569740561652246953718517, 0.1279381953467521569740561652246953718517,
	0.1258374563468282961213753825111836887264, 0.1258374563468282961213753825111836887264,
	0.121670472927803391204463153476262425607, 0.121670472927803391204463153476262425607,
	0.1155056680537256013533444839067835598622, 0.1155056680537256013533444839067835598622,
	0.1074442701159656347825773424466062227946, 0.1074442701159656347825773424466062227946,
	0.0976186521041138882698806644642471544279, 0.0976186521041138882698806644642471544279,
	0.086190161531953275917185202983742667185, 0.086190161531953275917185202983742667185,
	0.0733464814110803057340336152531165181193, 0.0733464814110803057340336152531165181193,
	0.0592985849154367807463677585001085845412, 0.0592985849154367807463677585001085845412,
	0.0442774388174198061686027482113382288593, 0.0442774388174198061686027482113382288593,
	0.0285313886289336631813078159518782864491, 0.0285313886289336631813078159518782864491,
	0.0123412297999871995468056670700372915759, 0.0123412297999871995468056670700372915759,
];

const EPSILON_SOLVER = 1e-12; // math/Eps.hpp: EPSILON.solver

const clamp = (t: number) => Math.min(Math.max(t, 0.0), 1.0);
const length = (v: Point) => Math.sqrt(v.x * v.x + v.y * v.y);

export function quadraticBezier(p0: Point, p1: Point, p2: Point, t: number): Point {
	t = clamp(t);
	const u = 1.0 - t;

	let x = u * u * p0.x;
	let y = u * u * p0.y;
	x += 2.0 * u * t * p1.x;
	y += 2.0 * u * t * p1.y;
	x += t * t * p2.x;
	y += t * t * p2.y;

	return { x, y };
}

export function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	t = clamp(t);
	const u = 1.0 - t;
	const tt = t * t;
	const uu = u * u;

	let x = uu * u * p0.x;
	let y = uu * u * p0.y;
	x += 3.0 * uu * t * p1.x;
	y += 3.0 * uu * t * p1.y;
	x += 3.0 * u * tt * p2.x;
	y += 3.0 * u * tt * p2.y;
	x += tt * t * p3.x;
	y += tt * t * p3.y;

	return { x, y };
}

export function quadraticBezierDerivative(p0: Point, p1: Point, p2: Point, t: number): Point {
	const u = 1.0 - t;
	return {
		x: 2.0 * u * (p1.x - p0.x) + 2.0 * t * (p2.x - p1.x),
		y: 2.0 * u * (p1.y - p0.y) + 2.0 * t * (p2.y - p1.y),
	};
}

export function cubicBezierDerivative(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	t: number,
): Point {
	const u = 1.0 - t;
	return {
		x:
			3.0 * u * u * (p1.x - p0.x) +
			6.0 * u * t * (p2.x - p1.x) +
			3.0 * t * t * (p3.x - p2.x),
		y:
			3.0 * u * u * (p1.y - p0.y) +
			6.0 * u * t * (p2.y - p1.y) +
			3.0 * t * t * (p3.y - p2.y),
	};
}

export function arcLengthQuadraticRange(
	p0: Point,
	p1: Point,
	p2: Point,
	t0: number,
	t1: number,
): number {
	const halfRange = 0.5 * (t1 - t0);
	const center = 0.5 * (t1 + t0);
	let sum = 0.0;
	for (let i = 0; i < T_VALUES.length; ++i) {
		const t = halfRange * T_VALUES[i] + center;
		const derivative = quadraticBezierDerivative(p0, p1, p2, t);
		sum += C_VALUES[i] * length(derivative);
	}
	return halfRange * sum;
}

export function arcLengthCubicRange(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	t0: number,
	t1: number,
): number {
	const halfRange = 0.5 * (t1 - t0);
	const center = 0.5 * (t1 + t0);
	let sum = 0.0;
	for (let i = 0; i < T_VALUES.length; ++i) {
		const t = halfRange * T_VALUES[i] + center;
		const derivative = cubicBezierDerivative(p0, p1, p2, p3, t);
		sum += C_VALUES[i] * length(derivative);
	}
	return halfRange * sum;
}

export function arcLengthQuadratic(p0: Point, p1: Point, p2: Point): number {
	return arcLengthQuadraticRange(p0, p1, p2, 0.0, 1.0);
}

export function arcLengthCubic(p0: Point, p1: Point, p2: Point, p3: Point): number {
	return arcLengthCubicRange(p0, p1, p2, p3, 0.0, 1.0);
}

// Samples for an arc-length table: about one per unit of length, at least
// `steps`, but capped — a huge curve would otherwise allocate one sample per
// unit (and overflow `int` past 2^31).
const kMaxLutSteps = 4096.0;
function resolveLutSteps(arcLength: number, steps: number): number {
	const estimated = Number.isFinite(arcLength) ? Math.ceil(arcLength) : 0.0;
	return Math.trunc(Math.min(Math.max(Math.max(estimated, steps), 10.0), kMaxLutSteps));
}

export class ArcLengthLUT {
	constructor(
		readonly totalLength: number,
		readonly lengths: number[],
		readonly steps: number,
	) {}

	static fromQuadratic(p0: Point, p1: Point, p2: Point, steps: number): ArcLengthLUT {
		const resolvedSteps = resolveLutSteps(arcLengthQuadratic(p0, p1, p2), steps);
		const lengths = [0.0];
		let cumulative = 0.0;
		let prevPoint = p0;
		for (let i = 1; i <= resolvedSteps; ++i) {
			const t = i / resolvedSteps;
			const point = quadraticBezier(p0, p1, p2, t);
			cumulative += Math.sqrt(
				(point.x - prevPoint.x) * (point.x - prevPoint.x) +
					(point.y - prevPoint.y) * (point.y - prevPoint.y),
			);
			lengths.push(cumulative);
			prevPoint = point;
		}
		return new ArcLengthLUT(cumulative, lengths, resolvedSteps);
	}

	static fromCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: number): ArcLengthLUT {
		const resolvedSteps = resolveLutSteps(arcLengthCubic(p0, p1, p2, p3), steps);
		const lengths = [0.0];
		let cumulative = 0.0;
		let prevPoint = p0;
		for (let i = 1; i <= resolvedSteps; ++i) {
			const t = i / resolvedSteps;
			const point = cubicBezier(p0, p1, p2, p3, t);
			cumulative += Math.sqrt(
				(point.x - prevPoint.x) * (point.x - prevPoint.x) +
					(point.y - prevPoint.y) * (point.y - prevPoint.y),
			);
			lengths.push(cumulative);
			prevPoint = point;
		}
		return new ArcLengthLUT(cumulative, lengths, resolvedSteps);
	}

	tAtDistance(distance: number): number {
		if (distance <= 0.0) return 0.0;
		if (distance >= this.totalLength) return 1.0;
		let low = 0;
		let high = this.steps;
		while (low < high) {
			const mid = Math.trunc((low + high) / 2);
			if (this.lengths[mid] < distance) low = mid + 1;
			else high = mid;
		}
		const index = Math.min(low, this.steps);
		if (index === 0) return 0.0;
		const lengthBefore = this.lengths[index - 1];
		const lengthAt = this.lengths[index];
		const segmentLength = lengthAt - lengthBefore;
		const tBefore = (index - 1) / this.steps;
		if (segmentLength < EPSILON_SOLVER) return tBefore;
		const tAt = index / this.steps;
		const ratio = (distance - lengthBefore) / segmentLength;
		return tBefore + ratio * (tAt - tBefore);
	}
}
