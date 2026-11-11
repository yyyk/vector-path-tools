import { colomitchi } from './caffeineowl/bezier-utils.js';
import { curveToQuadratic } from './fonttools/cu2qu.js';
import { toQuads } from './kurbo/to-quads.js';
import { checkFinite, type PathCommand, type Point } from './path.js';

/**
 * How cubics become quadratics:
 *
 * - `'kurbo'` (default): kurbo's CubicBez::to_quads.
 * - `'fonttools'`: fontTools' cu2qu curve_to_quadratic, a smooth quadratic
 *   spline. Throws ApproxNotFoundError when 100 quadratics aren't enough.
 * - `'colomitchi-half'`, `'colomitchi-adaptive'`, `'colomitchi-symmetric'`:
 *   Adrian Colomitchi's half-splitting, simple adaptive division and symmetric
 *   adaptive division.
 */
export type ToQuadraticsMethod =
	'kurbo' | 'fonttools' | 'colomitchi-half' | 'colomitchi-adaptive' | 'colomitchi-symmetric';

export interface ToQuadraticsOptions {
	/** Default `'kurbo'`. */
	method?: ToQuadraticsMethod;
	/** Colomitchi's "Detect inflexion": divide each cubic at its inflection points first. Default false. */
	detectInflections?: boolean;
}

const METHODS: ToQuadraticsMethod[] = [
	'kurbo',
	'fonttools',
	'colomitchi-half',
	'colomitchi-adaptive',
	'colomitchi-symmetric',
];

/**
 * Default tolerance per method, as suggested by each original:
 *
 * - `'fonttools'`: 1 (cu2qu: 0.001 em, at 1000 units per em).
 * - Colomitchi's methods: 0.5 (bezier-utils: 0.5 px at the least).
 * - `'kurbo'`: none (kurbo suggests no value), so `tolerance` is required.
 */
const DEFAULT_TOLERANCE: Partial<Record<ToQuadraticsMethod, number>> = {
	fonttools: 1,
	'colomitchi-half': 0.5,
	'colomitchi-adaptive': 0.5,
	'colomitchi-symmetric': 0.5,
};

/**
 * The path with every cubic replaced by quadratics within `tolerance` of it.
 * Lines and quadratics are kept as they are. `tolerance` defaults to 1 for
 * `'fonttools'` and 0.5 for Colomitchi's methods, and is required for
 * `'kurbo'`.
 */
export function toQuadratics(
	commands: Iterable<PathCommand>,
	tolerance?: number,
	options: ToQuadraticsOptions = {},
): PathCommand[] {
	const method = options.method ?? 'kurbo';
	if (!METHODS.includes(method))
		throw new TypeError(`unknown toQuadratics method: ${String(method)}`);
	if (tolerance === undefined) {
		tolerance = DEFAULT_TOLERANCE[method];
		if (tolerance === undefined)
			throw new TypeError(`tolerance is required for the '${method}' method`);
	}
	if (!(tolerance > 0) || !Number.isFinite(tolerance))
		throw new RangeError(`tolerance must be a positive number (got ${tolerance})`);
	if (options.detectInflections && !method.startsWith('colomitchi-'))
		throw new TypeError('detectInflections is for the colomitchi methods');

	const out: PathCommand[] = [];
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let started = false;
	for (const c of commands) {
		checkFinite(c);
		if (c.type !== 'moveTo' && !started)
			throw new TypeError(`path data must start with a moveTo (got ${c.type})`);
		switch (c.type) {
			case 'moveTo':
				started = true;
				startX = c.x;
				startY = c.y;
				out.push(c);
				break;
			case 'lineTo':
			case 'quadTo':
				out.push(c);
				break;
			case 'cubicTo': {
				const cubic: [Point, Point, Point, Point] = [
					{ x, y },
					{ x: c.c1x, y: c.c1y },
					{ x: c.c2x, y: c.c2y },
					{ x: c.x, y: c.y },
				];
				for (const [, q1, q2] of quadratics(
					cubic,
					tolerance,
					method,
					options.detectInflections,
				))
					out.push({ type: 'quadTo', cx: q1.x, cy: q1.y, x: q2.x, y: q2.y });
				break;
			}
			case 'close':
				out.push(c);
				x = startX;
				y = startY;
				continue;
		}
		x = c.x;
		y = c.y;
	}
	return out;
}

function quadratics(
	cubic: [Point, Point, Point, Point],
	tolerance: number,
	method: ToQuadraticsMethod,
	detectInflections = false,
): [Point, Point, Point][] {
	if (method === 'kurbo') return toQuads(cubic, tolerance).map(([, , q]) => q);
	if (method === 'fonttools') {
		// The spline's on-curve points between quadratics are implied, midway
		// between consecutive off-curve points.
		const spline = curveToQuadratic(cubic, tolerance);
		const out: [Point, Point, Point][] = [];
		let start = spline[0];
		for (let i = 1; i < spline.length - 1; i++) {
			const end =
				i === spline.length - 2
					? spline[spline.length - 1]
					: {
							x: (spline[i].x + spline[i + 1].x) * 0.5,
							y: (spline[i].y + spline[i + 1].y) * 0.5,
						};
			out.push([start, spline[i], end]);
			start = end;
		}
		return out;
	}
	const variant =
		method === 'colomitchi-half'
			? 'half'
			: method === 'colomitchi-adaptive'
				? 'adaptive'
				: 'symmetric';
	return colomitchi(cubic, tolerance, variant, detectInflections);
}
