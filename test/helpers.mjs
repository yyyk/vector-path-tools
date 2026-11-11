// Shared test helpers: a seeded random generator, curve evaluation and the
// distance from a point to a polyline, for checking results by sampling.

/** Deterministic pseudo-random numbers in [min, max). */
export function random(seed = 1) {
	let s = seed;
	return (min = 0, max = 1) => {
		s = (s * 16807) % 2147483647;
		return min + ((s - 1) / 2147483646) * (max - min);
	};
}

export function randomCubic(rnd, size = 100) {
	const r = () => rnd(-size, size);
	return [
		{ type: 'moveTo', x: r(), y: r() },
		{ type: 'cubicTo', c1x: r(), c1y: r(), c2x: r(), c2y: r(), x: r(), y: r() },
	];
}

export function randomQuad(rnd, size = 100) {
	const r = () => rnd(-size, size);
	return [
		{ type: 'moveTo', x: r(), y: r() },
		{ type: 'quadTo', cx: r(), cy: r(), x: r(), y: r() },
	];
}

/** The point at parameter t of the single curve of a [moveTo, curve] path. */
export function curveAt(path, t) {
	const [m, c] = path;
	const u = 1 - t;
	if (c.type === 'quadTo')
		return {
			x: u * u * m.x + 2 * u * t * c.cx + t * t * c.x,
			y: u * u * m.y + 2 * u * t * c.cy + t * t * c.y,
		};
	return {
		x: u * u * u * m.x + 3 * u * u * t * c.c1x + 3 * u * t * t * c.c2x + t * t * t * c.x,
		y: u * u * u * m.y + 3 * u * u * t * c.c1y + 3 * u * t * t * c.c2y + t * t * t * c.y,
	};
}

function distanceToSegment(p, a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
	return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

const vertices = flattened =>
	flattened.filter(c => c.type !== 'close').map(c => ({ x: c.x, y: c.y }));

/**
 * Strict error of a flattening made with equal steps in t (the uniform
 * method): line i replaces the curve from t = i/n to (i+1)/n, and every curve
 * point in that stretch is measured against that line.
 */
export function uniformDeviation(path, flattened) {
	const poly = vertices(flattened);
	const n = poly.length - 1;
	let worst = 0;
	for (let i = 0; i < n; i++)
		for (let j = 0; j <= 64; j++) {
			const p = curveAt(path, (i + j / 64) / n);
			worst = Math.max(worst, distanceToSegment(p, poly[i], poly[i + 1]));
		}
	return worst;
}

/**
 * A lower bound on the error of any flattening: the largest distance from a
 * curve point to the nearest line. If this exceeds the tolerance, the
 * flattening certainly does.
 */
export function nearestDeviation(path, flattened) {
	const poly = vertices(flattened);
	let worst = 0;
	for (let k = 0; k <= 2000; k++) {
		const p = curveAt(path, k / 2000);
		let best = Infinity;
		for (let i = 0; i + 1 < poly.length; i++)
			best = Math.min(best, distanceToSegment(p, poly[i], poly[i + 1]));
		worst = Math.max(worst, best);
	}
	return worst;
}

/**
 * Strict error of the points a method puts inside one curve (see
 * curveSamples): each line, between two consecutive points, is measured
 * against the curve between their two parameters.
 */
export function sampledDeviation(path, samples) {
	const [m, c] = path;
	const pts = [{ t: 0, x: m.x, y: m.y }, ...samples, { t: 1, x: c.x, y: c.y }];
	let worst = 0;
	for (let i = 0; i + 1 < pts.length; i++)
		for (let j = 0; j <= 64; j++) {
			const t = pts[i].t + ((pts[i + 1].t - pts[i].t) * j) / 64;
			worst = Math.max(worst, distanceToSegment(curveAt(path, t), pts[i], pts[i + 1]));
		}
	return worst;
}

/** The control points of a [moveTo, curve] path, as [xs, ys]. */
export function controls(path) {
	const [m, c] = path;
	return c.type === 'quadTo'
		? [
				[m.x, c.cx, c.x],
				[m.y, c.cy, c.y],
			]
		: [
				[m.x, c.c1x, c.c2x, c.x],
				[m.y, c.c1y, c.c2y, c.y],
			];
}
