import {
	type CurveMeasure as ArcLength,
	cubicMeasure,
	DEFAULT_RELATIVE_TOLERANCE,
	quadraticMeasure,
} from './arc-length.js';
import { controlPoints, type Curve, splitCurve } from './curve.js';
import { type PathCommand, type Point, splitSubpaths, type SubpathParts } from './path.js';
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

function measureSubpaths(parts: SubpathParts[], tolerance: number): Subpath[] {
	return parts.map(({ segments, closed }) => {
		const sub: Subpath = { segments: [], starts: [], length: 0, closed };
		for (const seg of segments) {
			let measured: Segment;
			if (seg.type === 'line') {
				const d = minus(seg.p1, seg.p0);
				measured = { ...seg, length: Math.sqrt(d.x * d.x + d.y * d.y) };
			} else if (seg.type === 'quad') {
				const p: [Point, Point, Point] = [seg.p0, seg.p1, seg.p2];
				const m = quadraticMeasure(...p, tolerance);
				measured = { type: 'quad', p, m, length: m.length };
			} else {
				const p: [Point, Point, Point, Point] = [seg.p0, seg.p1, seg.p2, seg.p3];
				const m = cubicMeasure(...p, tolerance);
				measured = { type: 'cubic', p, m, length: m.length };
			}
			sub.starts.push(sub.length);
			sub.segments.push(measured);
			sub.length += measured.length;
		}
		return sub;
	});
}

const subpaths = (commands: Iterable<PathCommand>, tolerance: number) =>
	measureSubpaths(splitSubpaths(commands), tolerance);

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

/** The drawing command that ends a curve with these control points. */
function toCommand(p: readonly Point[]): PathCommand {
	const end = p[p.length - 1];
	if (p.length === 2) return { type: 'lineTo', x: end.x, y: end.y };
	if (p.length === 3) return { type: 'quadTo', cx: p[1].x, cy: p[1].y, x: end.x, y: end.y };
	return {
		type: 'cubicTo',
		c1x: p[1].x,
		c1y: p[1].y,
		c2x: p[2].x,
		c2y: p[2].y,
		x: end.x,
		y: end.y,
	};
}

const pointsOf = (seg: Segment): Point[] => (seg.type === 'line' ? [seg.p0, seg.p1] : seg.p);

/**
 * The subpath's cuts that count (see {@link splitPath}), sorted: within
 * `epsilon` of each other or of an open subpath's ends, a cut is dropped.
 */
function validCuts(sub: Subpath, cuts: number[], epsilon: number): number[] {
	const L = sub.length;
	if (L === 0) return [];
	const sorted = cuts
		.map(d => (sub.closed && d >= L - epsilon ? 0 : d))
		.filter(d => sub.closed || (d > epsilon && d < L - epsilon))
		.sort((a, b) => a - b);
	const kept: number[] = [];
	// Against the last cut kept, so a chain of close cuts isn't all dropped.
	for (const d of sorted)
		if (!kept.length || d - kept[kept.length - 1] > epsilon) kept.push(d);
	return kept;
}

/** The subpath cut at `cuts` (valid and sorted), as pieces of commands. */
function cutSubpath(sub: Subpath, cuts: number[], epsilon: number): PathCommand[][] {
	const first = pointsOf(sub.segments[0])[0];
	const pieces: PathCommand[][] = [];
	let current: PathCommand[] = [{ type: 'moveTo', x: first.x, y: first.y }];
	// Ends the current piece at `at`. Only the first piece may be empty (a
	// closed subpath cut at its start), and is then joined to the last.
	const cut = (at: Point) => {
		if (!pieces.length || current.length > 1) pieces.push(current);
		current = [{ type: 'moveTo', x: at.x, y: at.y }];
	};
	// A cut within epsilon / 2 of a segment's end is made there, so it leaves
	// no sliver of a segment; cuts more than epsilon apart still can't meet.
	const snap = epsilon / 2;
	let i = 0;
	sub.segments.forEach((seg, k) => {
		const start = sub.starts[k];
		const end = start + seg.length;
		const p = pointsOf(seg);
		while (i < cuts.length && cuts[i] <= start + snap) {
			cut(p[0]);
			i++;
		}
		const ts: number[] = [];
		while (i < cuts.length && cuts[i] < end - snap) {
			const s = cuts[i++] - start;
			ts.push(seg.type === 'line' ? s / seg.length : seg.m.tAtLength(s));
		}
		if (!ts.length) {
			current.push(toCommand(p));
			return;
		}
		splitCurve(p as Curve, ts).forEach((part, j) => {
			const q = controlPoints(part);
			if (j) cut(q[0]);
			current.push(toCommand(q));
		});
	});
	// Cuts left over are within epsilon / 2 of the end: none, as validCuts
	// keeps them more than epsilon from it.
	const last = pointsOf(sub.segments[sub.segments.length - 1]);
	cut(last[last.length - 1]);
	if (sub.closed) {
		// The piece before the first cut continues the last one, across the start.
		const [head, ...rest] = pieces;
		rest[rest.length - 1].push(...head.slice(1));
		return rest;
	}
	return pieces;
}

/**
 * The path cut at `distances` along it, as pieces that are paths of their
 * own, in order. Distances run continuously across subpaths, as in
 * {@link measure} (the jump at a `moveTo` counts as 0, a distance at a boundary
 * falls at the end of the earlier subpath, and distances outside 0…length are
 * clamped). Pieces never cross a `moveTo`, and subpaths that draw nothing are
 * dropped, as in `subpaths`.
 *
 * For each subpath, of length L, with ε = `options.tolerance` · L:
 *
 * - Open: cuts with ε < d < L − ε count, the others are dropped (they would
 *   leave a piece of no length). n cuts give n + 1 open pieces.
 * - Closed: cuts with 0 ≤ d < L − ε count; d ≥ L − ε is the same point as 0.
 *   No cuts give the subpath unchanged, still closed; n ≥ 1 cuts give n open
 *   pieces, the last running from the last cut, through the start, to the
 *   first.
 * - Cuts within ε of a cut already kept (in order along the subpath) are
 *   dropped, so no piece has zero length.
 * - A subpath with L = 0 has no valid cuts, open or closed.
 */
export function splitPath(
	commands: Iterable<PathCommand>,
	distances: Iterable<number>,
	options: MeasureOptions = {},
): PathCommand[][] {
	const tolerance = checkTolerance(options);
	const parts = splitSubpaths(commands);
	const subs = measureSubpaths(parts, tolerance);
	const cuts: number[][] = subs.map(() => []);
	const starts: number[] = [];
	let length = 0;
	for (const sub of subs) {
		starts.push(length);
		length += sub.length;
	}
	for (const distance of distances) {
		if (Number.isNaN(distance)) throw new TypeError('distance must be a number (got NaN)');
		if (!subs.length) continue;
		const d = Math.min(Math.max(distance, 0), length);
		let i = 0;
		// The subpath it falls in (at a boundary, the end of the earlier one).
		while (i + 1 < subs.length && d > starts[i] + subs[i].length) i++;
		cuts[i].push(Math.min(Math.max(d - starts[i], 0), subs[i].length));
	}
	return subs.flatMap((sub, i) => {
		const epsilon = tolerance * sub.length;
		const valid = validCuts(sub, cuts[i], epsilon);
		return valid.length ? cutSubpath(sub, valid, epsilon) : [parts[i].commands];
	});
}
