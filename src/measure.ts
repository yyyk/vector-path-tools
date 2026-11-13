import {
	type CurveMeasure as ArcLength,
	cubicMeasure,
	DEFAULT_RELATIVE_TOLERANCE,
	quadraticMeasure,
} from './arc-length.js';
import { controlPoints, type Curve } from './curve.js';
import { checkFinite, type PathCommand, type Point } from './path.js';
import {
	cubicBezier,
	cubicBezierDerivative,
	quadraticBezier,
	quadraticBezierDerivative,
} from './stroke-outline/arc-length.js';

/** A point on the path, with the direction the path runs there. */
export interface PathPoint {
	x: number;
	y: number;
	/** The direction of travel, in radians: Math.atan2(dy, dx). */
	angle: number;
}

export interface MeasureOptions {
	/**
	 * How accurately curves are measured, relative to each curve's length.
	 * Default 1e-10.
	 */
	tolerance?: number;
}

/** A path's length, and points at distances along it. See {@link measure}. */
export interface PathMeasure {
	/** The total length, every subpath's added up (a `close` line counts). */
	readonly length: number;
	/** The length of each subpath that draws something, in order. */
	readonly subpathLengths: readonly number[];
	/**
	 * The point `distance` along the path, from its start, continuing from
	 * one subpath into the next (the jump at a `moveTo` counts as 0). Distances
	 * outside 0…length are clamped. `null` if the path draws nothing.
	 */
	pointAtLength(distance: number): PathPoint | null;
	/** {@link pointAtLength} at `fraction` (0…1) of the total length. */
	pointAtFraction(fraction: number): PathPoint | null;
}

/** One curve's length, and its parameter at distances along it. See {@link measureCurve}. */
export interface CurveMeasure {
	/** The curve's length. */
	readonly length: number;
	/**
	 * The curve's parameter t where its length from the start reaches
	 * `distance` (clamped to 0…length), for `curvePoint` or `splitCurve`.
	 */
	tAtLength(distance: number): number;
}

type Segment =
	| { type: 'line'; p0: Point; p1: Point; length: number }
	| { type: 'quad'; p: [Point, Point, Point]; m: ArcLength; length: number }
	| { type: 'cubic'; p: [Point, Point, Point, Point]; m: ArcLength; length: number };

interface Subpath {
	segments: Segment[];
	/** The length before each segment, within the subpath. */
	starts: number[];
	length: number;
	closed: boolean;
}

const direction = (v: Point) => Math.atan2(v.y, v.x);
const isZero = (v: Point) => v.x === 0 && v.y === 0;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

/** The point and direction at `s` along one segment. */
function onSegment(seg: Segment, s: number): PathPoint {
	if (seg.type === 'line') {
		const d = minus(seg.p1, seg.p0);
		if (s >= seg.length) return { x: seg.p1.x, y: seg.p1.y, angle: direction(d) };
		const t = seg.length > 0 ? Math.max(s / seg.length, 0) : 0;
		// As curvePoint does for lines.
		const u = 1 - t;
		return {
			x: u * seg.p0.x + t * seg.p1.x,
			y: u * seg.p0.y + t * seg.p1.y,
			angle: direction(d),
		};
	}
	const t = seg.m.tAtLength(s);
	if (seg.type === 'quad') {
		const [p0, p1, p2] = seg.p;
		let d = quadraticBezierDerivative(p0, p1, p2, t);
		if (isZero(d)) d = minus(p2, p0); // the control point is on an end
		const q = quadraticBezier(p0, p1, p2, t);
		return { x: q.x, y: q.y, angle: direction(d) };
	}
	const [p0, p1, p2, p3] = seg.p;
	let d = cubicBezierDerivative(p0, p1, p2, p3, t);
	// Zero speed: a control point on an end, or a cusp. Use the direction the
	// curve leaves (or arrives) along.
	if (isZero(d)) d = t < 0.5 ? minus(p2, p0) : minus(p3, p1);
	if (isZero(d)) d = minus(p3, p0);
	const q = cubicBezier(p0, p1, p2, p3, t);
	return { x: q.x, y: q.y, angle: direction(d) };
}

/** The point and direction at `s` (clamped) along one subpath. */
function onSubpath(sub: Subpath, s: number): PathPoint {
	s = Math.min(Math.max(s, 0), sub.length);
	// The last segment starting at or before s.
	let lo = 0;
	let hi = sub.segments.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (sub.starts[mid] <= s) lo = mid;
		else hi = mid - 1;
	}
	const seg = sub.segments[lo];
	// At the end: exactly the end point, whatever rounding the sums left.
	return onSegment(seg, s >= sub.length ? seg.length : s - sub.starts[lo]);
}

function subpaths(commands: Iterable<PathCommand>, tolerance: number): Subpath[] {
	const out: Subpath[] = [];
	let current: Subpath | null = null;
	let start: Point | null = null;
	let last: Point | null = null;
	const add = (seg: Segment) => {
		if (!current) {
			current = { segments: [], starts: [], length: 0, closed: false };
			out.push(current);
		}
		current.starts.push(current.length);
		current.segments.push(seg);
		current.length += seg.length;
	};
	for (const c of commands) {
		checkFinite(c);
		if (c.type === 'moveTo') {
			start = last = { x: c.x, y: c.y };
			current = null;
			continue;
		}
		if (!start || !last)
			throw new TypeError(`path data must start with a moveTo (got ${c.type})`);
		if (c.type === 'close') {
			if (last.x !== start.x || last.y !== start.y) {
				const d = minus(start, last);
				add({
					type: 'line',
					p0: last,
					p1: start,
					length: Math.sqrt(d.x * d.x + d.y * d.y),
				});
			}
			if (current) (current as Subpath).closed = true;
			// After a close, drawing starts a new subpath at the same start.
			last = start;
			current = null;
			continue;
		}
		const end = { x: c.x, y: c.y };
		if (c.type === 'lineTo') {
			const d = minus(end, last);
			add({ type: 'line', p0: last, p1: end, length: Math.sqrt(d.x * d.x + d.y * d.y) });
		} else if (c.type === 'quadTo') {
			const p: [Point, Point, Point] = [last, { x: c.cx, y: c.cy }, end];
			const m = quadraticMeasure(...p, tolerance);
			add({ type: 'quad', p, m, length: m.length });
		} else {
			const p: [Point, Point, Point, Point] = [
				last,
				{ x: c.c1x, y: c.c1y },
				{ x: c.c2x, y: c.c2y },
				end,
			];
			const m = cubicMeasure(...p, tolerance);
			add({ type: 'cubic', p, m, length: m.length });
		}
		last = end;
	}
	return out;
}

function checkTolerance(options: MeasureOptions): number {
	const tolerance = options.tolerance ?? DEFAULT_RELATIVE_TOLERANCE;
	if (!(tolerance > 0 && tolerance < 1))
		throw new RangeError(`tolerance must be between 0 and 1 (got ${tolerance})`);
	return tolerance;
}

/**
 * Measures the path once, for its length and for points at distances along
 * it. Curves are measured to `options.tolerance` of their length (default
 * 1e-10), so the results don't depend on the coordinate units.
 */
export function measure(
	commands: Iterable<PathCommand>,
	options: MeasureOptions = {},
): PathMeasure {
	const subs = subpaths(commands, checkTolerance(options));
	const starts: number[] = [];
	let length = 0;
	for (const sub of subs) {
		starts.push(length);
		length += sub.length;
	}
	const pointAtLength = (distance: number): PathPoint | null => {
		if (!subs.length) return null;
		if (Number.isNaN(distance)) throw new TypeError('distance must be a number (got NaN)');
		const d = Math.min(Math.max(distance, 0), length);
		let i = 0;
		// The subpath it falls in (at a boundary, the end of the earlier one).
		while (i + 1 < subs.length && d > starts[i] + subs[i].length) i++;
		return onSubpath(subs[i], d - starts[i]);
	};
	return {
		length,
		subpathLengths: subs.map(s => s.length),
		pointAtLength,
		pointAtFraction: fraction => pointAtLength(fraction * length),
	};
}

/**
 * Measures one curve once, for its length and for its parameter at distances
 * along it: to split it, or find its points, at a distance rather than at a
 * parameter. As accurate as {@link measure}.
 */
export function measureCurve(curve: Curve, options: MeasureOptions = {}): CurveMeasure {
	const p = controlPoints(curve).map(q => ({ x: q.x, y: q.y }));
	const tolerance = checkTolerance(options);
	const checkDistance = (distance: number) => {
		if (Number.isNaN(distance)) throw new TypeError('distance must be a number (got NaN)');
	};
	if (p.length === 2) {
		const d = minus(p[1], p[0]);
		const length = Math.sqrt(d.x * d.x + d.y * d.y);
		return {
			length,
			tAtLength: distance => {
				checkDistance(distance);
				return length > 0 ? Math.min(Math.max(distance / length, 0), 1) : 0;
			},
		};
	}
	const m =
		p.length === 3
			? quadraticMeasure(p[0], p[1], p[2], tolerance)
			: cubicMeasure(p[0], p[1], p[2], p[3], tolerance);
	return {
		length: m.length,
		tAtLength: distance => {
			checkDistance(distance);
			return m.tAtLength(distance);
		},
	};
}

/**
 * Points about `spacing` apart along each subpath, with their directions, as
 * p5's `textToPoints` does for glyphs: one array per subpath that draws
 * something. Each subpath's spacing is adjusted slightly so its points are
 * even and reach its end; a closed subpath doesn't repeat its start at the end.
 */
export function pointsAlong(
	commands: Iterable<PathCommand>,
	spacing: number,
	options: MeasureOptions = {},
): PathPoint[][] {
	if (!(spacing > 0) || !Number.isFinite(spacing))
		throw new RangeError(`spacing must be a positive number (got ${spacing})`);
	return subpaths(commands, checkTolerance(options)).map(sub => {
		const n = Math.max(1, Math.round(sub.length / spacing));
		const count = sub.closed ? n : n + 1;
		return Array.from({ length: count }, (_, k) => onSubpath(sub, (sub.length * k) / n));
	});
}
