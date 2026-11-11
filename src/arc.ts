import type { PathCommand } from './path.js';
import { arcToBezier } from './svg-arc-to-cubic-bezier/arc-to-bezier.js';

/**
 * An SVG elliptical arc (the `A` command) from (x0, y0) to (x, y), as path
 * commands: cubics from svg-arc-to-cubic-bezier. `xAxisRotation` is in
 * degrees; `largeArc` and `sweep` are the arc's two flags.
 *
 * As the SVG spec says for out-of-range parameters: identical end points give
 * no commands at all, and a zero radius gives a straight `lineTo`.
 */
export function arcTo(
	x0: number,
	y0: number,
	rx: number,
	ry: number,
	xAxisRotation: number,
	largeArc: boolean,
	sweep: boolean,
	x: number,
	y: number,
): PathCommand[] {
	for (const v of [x0, y0, rx, ry, xAxisRotation, x, y])
		if (!Number.isFinite(v)) throw new TypeError(`arcTo needs finite numbers (got ${v})`);
	if (x0 === x && y0 === y) return [];
	const curves = arcToBezier({
		px: x0,
		py: y0,
		cx: x,
		cy: y,
		rx,
		ry,
		xAxisRotation,
		largeArcFlag: largeArc ? 1 : 0,
		sweepFlag: sweep ? 1 : 0,
	});
	if (!curves.length) return [{ type: 'lineTo', x, y }];
	return curves.map(c => ({
		type: 'cubicTo',
		c1x: c.x1,
		c1y: c.y1,
		c2x: c.x2,
		c2y: c.y2,
		x: c.x,
		y: c.y,
	}));
}
