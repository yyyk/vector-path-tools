import { adaptiveCubic, adaptiveQuadratic } from './kurbo/flatten.js';
import { checkFinite, type PathCommand, type Point, type Sample } from './path.js';
import { evalCubic, quadToCubic } from './skia/eval.js';
import * as wangsFormula from './skia/wangs-formula.js';

/**
 * How `flatten` places the lines along each curve.
 *
 * - `'uniform'` (default): Wang's formula. Equal steps along the curve, as many
 *   as its sharpest bend needs. Guaranteed: no line is ever further than
 *   `tolerance` from the curve. On curves that are sharp in one place and flat
 *   elsewhere it uses more lines than strictly needed.
 * - `'adaptive'`: kurbo's flatten (Raph Levien's method; cubics through
 *   quadratics).
 */
export type FlattenMethod = 'uniform' | 'adaptive';

export interface FlattenOptions {
	/** Default `'uniform'`. */
	method?: FlattenMethod;
}

/**
 * The path with every curve replaced by lines, within `tolerance` of the curve
 * (in path units: for screen output, about 0.25 pixels divided by the zoom).
 * `moveTo`, `lineTo` and `close` are kept as they are, and every curve's end
 * point is kept exactly.
 *
 * `tolerance` defaults to 0.25, as suggested by both originals (Skia: 1/4
 * pixel; kurbo: 0.25 for antialiased rendering).
 */
export function flatten(
	commands: Iterable<PathCommand>,
	tolerance = 0.25,
	options: FlattenOptions = {},
): PathCommand[] {
	if (!(tolerance > 0) || !Number.isFinite(tolerance))
		throw new RangeError(`tolerance must be a positive number (got ${tolerance})`);
	const method = options.method ?? 'uniform';
	const steps = Object.hasOwn(STEPS, method) ? STEPS[method] : undefined;
	if (!steps) throw new TypeError(`unknown flatten method: ${String(method)}`);

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
				out.push(c);
				break;
			case 'quadTo':
				for (const p of steps([x, c.cx, c.x], [y, c.cy, c.y], tolerance))
					out.push({ type: 'lineTo', x: p.x, y: p.y });
				out.push({ type: 'lineTo', x: c.x, y: c.y }); // exact end point
				break;
			case 'cubicTo':
				for (const p of steps(
					[x, c.c1x, c.c2x, c.x],
					[y, c.c1y, c.c2y, c.y],
					tolerance,
				))
					out.push({ type: 'lineTo', x: p.x, y: p.y });
				out.push({ type: 'lineTo', x: c.x, y: c.y });
				break;
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

/**
 * The points strictly inside a curve (control points `xs`, `ys`: three for a
 * quadratic, four for a cubic) where it is cut into lines, in order.
 */
type Steps = (xs: number[], ys: number[], tolerance: number) => Sample[];

/**
 * Equal steps, as many as Wang's formula needs (see skia/wangs-formula.ts), at
 * points evaluated as Skia's tessellation shader does (see skia/eval.ts).
 */
const uniformSteps: Steps = (xs, ys, tolerance) => {
	const p: Point[] = xs.map((x, i) => ({ x, y: ys[i] }));
	const precision = 1 / tolerance;
	const needed = Math.ceil(
		p.length === 3
			? wangsFormula.quadratic(p[0], p[1], p[2], precision)
			: wangsFormula.cubic(p[0], p[1], p[2], p[3], precision),
	);
	const n = Math.max(needed, 1);
	const [p0, p1, p2, p3] = p.length === 3 ? quadToCubic(p[0], p[1], p[2]) : p;
	const out: Sample[] = [];
	for (let i = 1; i < n; i++) {
		const t = i / n;
		out.push({ t, ...evalCubic(p0, p1, p2, p3, t) });
	}
	return out;
};

const adaptiveSteps: Steps = (xs, ys, tolerance) =>
	xs.length === 3 ? adaptiveQuadratic(xs, ys, tolerance) : adaptiveCubic(xs, ys, tolerance);

const STEPS: Record<FlattenMethod, Steps> = {
	uniform: uniformSteps,
	adaptive: adaptiveSteps,
};

/**
 * For tests: the points `flatten` puts inside one curve, with the parameter
 * of each on the original curve. Not part of the package's API.
 */
export function curveSamples(
	method: FlattenMethod,
	xs: number[],
	ys: number[],
	tolerance: number,
): Sample[] {
	return STEPS[method](xs, ys, tolerance);
}
