import { cubicAt, cubicExtremes, quadAt, quadExtremes } from './bezier.js';
import { eachSegment, type PathCommand } from './path.js';

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * The exact bounding box of what a path draws: curves count by their extremes,
 * not their control points. A `moveTo` with nothing drawn after it adds
 * nothing. Returns null for a path that draws nothing.
 */
export function bounds(commands: Iterable<PathCommand>): Bounds | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const addX = (x: number) => {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
	};
	const addY = (y: number) => {
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	};

	for (const s of eachSegment(commands)) {
		// Every segment starts where the previous one ended, so the start point
		// only matters for the first segment of a subpath; adding it each time
		// is simpler and just as correct.
		addX(s.p0.x);
		addY(s.p0.y);
		switch (s.type) {
			case 'line':
				addX(s.p1.x);
				addY(s.p1.y);
				break;
			case 'quad':
				addX(s.p2.x);
				addY(s.p2.y);
				for (const t of quadExtremes(s.p0.x, s.p1.x, s.p2.x))
					addX(quadAt(s.p0.x, s.p1.x, s.p2.x, t));
				for (const t of quadExtremes(s.p0.y, s.p1.y, s.p2.y))
					addY(quadAt(s.p0.y, s.p1.y, s.p2.y, t));
				break;
			case 'cubic':
				addX(s.p3.x);
				addY(s.p3.y);
				for (const t of cubicExtremes(s.p0.x, s.p1.x, s.p2.x, s.p3.x))
					addX(cubicAt(s.p0.x, s.p1.x, s.p2.x, s.p3.x, t));
				for (const t of cubicExtremes(s.p0.y, s.p1.y, s.p2.y, s.p3.y))
					addY(cubicAt(s.p0.y, s.p1.y, s.p2.y, s.p3.y, t));
				break;
		}
	}
	return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
