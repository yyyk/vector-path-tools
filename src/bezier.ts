// Bézier curve evaluation and extremes, one coordinate at a time.

export function quadAt(p0: number, p1: number, p2: number, t: number): number {
	const u = 1 - t;
	return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

export function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
	const u = 1 - t;
	return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Parameters in (0, 1) where a quadratic coordinate has an extreme. */
export function quadExtremes(p0: number, p1: number, p2: number): number[] {
	// B'(t) = 2[(p1 - p0) + t(p0 - 2p1 + p2)]
	const d = p0 - 2 * p1 + p2;
	if (d === 0) return [];
	const t = (p0 - p1) / d;
	return t > 0 && t < 1 ? [t] : [];
}

/** Parameters in (0, 1) where a cubic coordinate has an extreme. */
export function cubicExtremes(p0: number, p1: number, p2: number, p3: number): number[] {
	// B'(t) = 3(a t² + b t + c)
	const a = p3 - 3 * p2 + 3 * p1 - p0;
	const b = 2 * (p2 - 2 * p1 + p0);
	const c = p1 - p0;
	return quadraticRoots(a, b, c).filter(t => t > 0 && t < 1);
}

/**
 * Real roots of a t² + b t + c = 0. Uses the numerically stable form, so a
 * nearly-zero `a` (a cubic that is almost a quadratic) gives one huge root and
 * one accurate root instead of garbage.
 */
export function quadraticRoots(a: number, b: number, c: number): number[] {
	if (a === 0) return b === 0 ? [] : [-c / b];
	const disc = b * b - 4 * a * c;
	if (disc < 0) return [];
	const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
	const roots = [q / a];
	if (q !== 0) roots.push(c / q);
	return roots;
}
