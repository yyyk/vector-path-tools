/**
 * A path command, in absolute coordinates. The same shape as stroke-outline's
 * `PathCommand`, so its outlines' `commands` can be passed in directly.
 */
export type PathCommand =
	| { type: 'moveTo'; x: number; y: number }
	| { type: 'lineTo'; x: number; y: number }
	| { type: 'quadTo'; cx: number; cy: number; x: number; y: number }
	| {
			type: 'cubicTo';
			c1x: number;
			c1y: number;
			c2x: number;
			c2y: number;
			x: number;
			y: number;
	  }
	| { type: 'close' };

export interface Point {
	x: number;
	y: number;
}

/** A point on a curve, with its parameter t on that curve. */
export interface Sample extends Point {
	t: number;
}

/** A drawn piece of a path, with its start point made explicit. */
export type Segment =
	| { type: 'line'; p0: Point; p1: Point }
	| { type: 'quad'; p0: Point; p1: Point; p2: Point }
	| { type: 'cubic'; p0: Point; p1: Point; p2: Point; p3: Point };

const COORDINATES = {
	moveTo: ['x', 'y'],
	lineTo: ['x', 'y'],
	quadTo: ['cx', 'cy', 'x', 'y'],
	cubicTo: ['c1x', 'c1y', 'c2x', 'c2y', 'x', 'y'],
	close: [],
} as const;

/**
 * Throws a TypeError for an unknown command type, or a coordinate that is
 * missing, NaN or infinite. Other properties on a command are ignored.
 */
export function checkFinite(c: PathCommand): void {
	const keys: readonly string[] | undefined = COORDINATES[c.type];
	if (!keys) throw new TypeError(`unknown path command type: ${String(c.type)}`);
	for (const key of keys) {
		const v = (c as unknown as Record<string, unknown>)[key];
		if (typeof v !== 'number' || !Number.isFinite(v))
			throw new TypeError(`${c.type} has a non-finite ${key} (${String(v)})`);
	}
}

/**
 * The drawn segments of a path, in order. `close` adds the line back to the
 * subpath's start (when it isn't there already). A drawing command with no
 * `moveTo` before it, or a coordinate that is NaN or infinite, is a TypeError.
 */
export function* segments(commands: Iterable<PathCommand>): Generator<Segment> {
	let current: Point | null = null;
	let start: Point | null = null;
	for (const c of commands) {
		checkFinite(c);
		if (c.type === 'moveTo') {
			current = start = { x: c.x, y: c.y };
			continue;
		}
		if (!current || !start)
			throw new TypeError(`path data must start with a moveTo (got ${c.type})`);
		switch (c.type) {
			case 'lineTo': {
				const p1 = { x: c.x, y: c.y };
				yield { type: 'line', p0: current, p1 };
				current = p1;
				break;
			}
			case 'quadTo': {
				const p2 = { x: c.x, y: c.y };
				yield { type: 'quad', p0: current, p1: { x: c.cx, y: c.cy }, p2 };
				current = p2;
				break;
			}
			case 'cubicTo': {
				const p3 = { x: c.x, y: c.y };
				yield {
					type: 'cubic',
					p0: current,
					p1: { x: c.c1x, y: c.c1y },
					p2: { x: c.c2x, y: c.c2y },
					p3,
				};
				current = p3;
				break;
			}
			case 'close':
				if (current.x !== start.x || current.y !== start.y)
					yield { type: 'line', p0: current, p1: start };
				// After a close, drawing continues from the subpath's start.
				current = start;
				break;
		}
	}
}
