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
 * The drawn segments of a path, in order, as an array. `close` adds the line
 * back to the subpath's start (when it isn't there already). A drawing command
 * with no `moveTo` before it, or a coordinate that is NaN or infinite, is a
 * TypeError.
 */
export function segments(commands: Iterable<PathCommand>): Segment[] {
	return [...eachSegment(commands)];
}

/** {@link segments}, one at a time. */
export function* eachSegment(commands: Iterable<PathCommand>): Generator<Segment> {
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

/** One subpath that draws something: its commands, segments, and whether it is closed. */
export interface SubpathParts {
	commands: PathCommand[];
	segments: Segment[];
	closed: boolean;
}

/** The command with only its coordinates, as a new object. */
function copyCommand(c: PathCommand): PathCommand {
	switch (c.type) {
		case 'moveTo':
			return { type: 'moveTo', x: c.x, y: c.y };
		case 'lineTo':
			return { type: 'lineTo', x: c.x, y: c.y };
		case 'quadTo':
			return { type: 'quadTo', cx: c.cx, cy: c.cy, x: c.x, y: c.y };
		case 'cubicTo':
			return {
				type: 'cubicTo',
				c1x: c.c1x,
				c1y: c.c1y,
				c2x: c.c2x,
				c2y: c.c2y,
				x: c.x,
				y: c.y,
			};
		case 'close':
			return { type: 'close' };
	}
}

/**
 * The path's subpaths that draw something, with their segments as
 * {@link segments} gives them. A subpath ends at a `moveTo` or a `close`;
 * drawing after a `close` starts a new one at the same start. `measure` and
 * {@link subpaths} both split here, so they always agree.
 */
export function splitSubpaths(commands: Iterable<PathCommand>): SubpathParts[] {
	const out: SubpathParts[] = [];
	let current: SubpathParts | null = null;
	let start: Point | null = null;
	let last: Point | null = null;
	const add = (c: PathCommand, seg: Segment) => {
		if (!current) {
			current = {
				commands: [{ type: 'moveTo', x: start!.x, y: start!.y }],
				segments: [],
				closed: false,
			};
			out.push(current);
		}
		current.commands.push(c);
		current.segments.push(seg);
	};
	for (const c of commands) {
		checkFinite(c);
		if (c.type === 'moveTo') {
			start = last = { x: c.x, y: c.y };
			current = null;
			continue;
		}
		if (!start || !last)
			throw new TypeError(`path data must start with a moveTo (got ${c.type})`);
		if (c.type === 'close') {
			// With nothing drawn since the start, there is no close line either.
			if (current) {
				if (last.x !== start.x || last.y !== start.y)
					(current as SubpathParts).segments.push({
						type: 'line',
						p0: last,
						p1: start,
					});
				(current as SubpathParts).commands.push({ type: 'close' });
				(current as SubpathParts).closed = true;
			}
			// After a close, drawing starts a new subpath at the same start.
			last = start;
			current = null;
			continue;
		}
		const end = { x: c.x, y: c.y };
		if (c.type === 'lineTo') add(copyCommand(c), { type: 'line', p0: last, p1: end });
		else if (c.type === 'quadTo')
			add(copyCommand(c), { type: 'quad', p0: last, p1: { x: c.cx, y: c.cy }, p2: end });
		else
			add(copyCommand(c), {
				type: 'cubic',
				p0: last,
				p1: { x: c.c1x, y: c.c1y },
				p2: { x: c.c2x, y: c.c2y },
				p3: end,
			});
		last = end;
	}
	return out;
}

/**
 * The path split into its subpaths, each as its own path starting with a
 * `moveTo` and keeping its `close`. Only subpaths that draw something are
 * included, the same ones `measure` counts in `subpathLengths`; a `moveTo` with
 * nothing drawn after it is dropped.
 */
export function subpaths(commands: Iterable<PathCommand>): PathCommand[][] {
	return splitSubpaths(commands).map(s => s.commands);
}
