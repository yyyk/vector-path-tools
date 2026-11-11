import { pointInside } from './fonttools/point-inside-pen.js';
import { checkFinite, type PathCommand } from './path.js';
import { skiaContains } from './skia/contains.js';

export type FillRule = 'nonzero' | 'evenodd';

/**
 * How `contains` decides:
 *
 * - `'skia'` (default): Skia's SkPath::contains. Every subpath counts as
 *   closed, as canvas fills it; points on the boundary count as inside.
 * - `'fonttools'`: fontTools' PointInsidePen. Every subpath counts as closed.
 */
export type ContainsMethod = 'skia' | 'fonttools';

export interface ContainsOptions {
	/** Default `'skia'`. */
	method?: ContainsMethod;
	/** Default `'nonzero'`. */
	fillRule?: FillRule;
}

const METHODS: ContainsMethod[] = ['skia', 'fonttools'];

/**
 * Whether the point (x, y) is inside the path's fill. `fillRule` decides how
 * overlapping and nested subpaths combine: `'nonzero'` fills where they wind
 * around the point a non-zero number of times, `'evenodd'` where they cross a
 * ray from it an odd number of times.
 */
export function contains(
	commands: Iterable<PathCommand>,
	x: number,
	y: number,
	options: ContainsOptions = {},
): boolean {
	const method = options.method ?? 'skia';
	if (!METHODS.includes(method))
		throw new TypeError(`unknown contains method: ${String(method)}`);
	const fillRule = options.fillRule ?? 'nonzero';
	if (fillRule !== 'nonzero' && fillRule !== 'evenodd')
		throw new TypeError(`unknown fill rule: ${String(fillRule)}`);
	if (!Number.isFinite(x) || !Number.isFinite(y))
		throw new TypeError(`the point must be finite (got ${x}, ${y})`);

	const path: PathCommand[] = [];
	for (const c of commands) {
		checkFinite(c);
		if (c.type !== 'moveTo' && !path.length)
			throw new TypeError(`path data must start with a moveTo (got ${c.type})`);
		path.push(c);
	}

	const p = { x, y };
	const evenOdd = fillRule === 'evenodd';
	if (method === 'skia') return skiaContains(path, p, evenOdd);
	return pointInside(path, p, evenOdd);
}
