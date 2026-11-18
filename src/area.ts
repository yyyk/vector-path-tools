// The exact signed area, by Green's theorem: half the integral of
// x dy − y dx around each subpath, which for a Bézier curve is a fixed
// combination of the cross products of its control points.

import { type PathCommand, type Point, splitSubpaths } from './path.js';

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

/**
 * The path's signed area, exactly for curves too: every subpath's added up,
 * each counting as closed (as `contains` fills them). Positive where a subpath
 * runs clockwise on screen, with y pointing down (counterclockwise with y up).
 * A subpath that winds around twice counts twice, and one that crosses itself
 * counts its loops with opposite signs.
 */
export function area(commands: Iterable<PathCommand>): number {
	let total = 0;
	for (const { segments } of splitSubpaths(commands)) {
		// Relative to the subpath's start, which leaves the area unchanged but
		// keeps the products small far from the origin.
		const o = segments[0].p0;
		const r = (p: Point): Point => ({ x: p.x - o.x, y: p.y - o.y });
		let twice = 0;
		for (const seg of segments) {
			const p0 = r(seg.p0);
			if (seg.type === 'line') {
				twice += cross(p0, r(seg.p1));
			} else if (seg.type === 'quad') {
				const [p1, p2] = [r(seg.p1), r(seg.p2)];
				twice += (2 * cross(p0, p1) + 2 * cross(p1, p2) + cross(p0, p2)) / 3;
			} else {
				const [p1, p2, p3] = [r(seg.p1), r(seg.p2), r(seg.p3)];
				twice +=
					(6 * cross(p0, p1) +
						3 * cross(p0, p2) +
						cross(p0, p3) +
						3 * cross(p1, p2) +
						3 * cross(p1, p3) +
						6 * cross(p2, p3)) /
					10;
			}
		}
		// The line back to the start of an open subpath adds nothing: relative to
		// the start, its cross product is zero.
		total += twice / 2;
	}
	return total;
}
