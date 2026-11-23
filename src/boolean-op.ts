// Boolean operations on two paths' fills, without flattening: every output
// segment is a piece of an input segment.
//
// Ported from stroke-outline (https://github.com/yyyk/stroke-outline), at commit
// 5a08aae303e9489a87589eaca5d36ef6b3d7e105: resolve_stroke_outline and its
// helpers in src/stroke/clip.cpp (split_edge, y_turning_points, edge_winding,
// the probe sweep, the duplicate check and the chaining). Same author and
// license as this package. Changed here: the region kept is the operation
// applied to the two inputs' fills, instead of a stroke's coverage; edges meet
// where intersect.ts says, overlaps and endpoints included; pieces are kept with
// the region on their left, so outer contours have positive `area`; and
// chaining takes the sharpest left turn where several pieces meet, so contours
// that touch at a point stay separate.

import { BooleanOpError } from './boolean-op-error.js';
import { bounds } from './bounds.js';
import type { FillRule } from './contains.js';
import {
	controlBox,
	end,
	evaluate,
	parameterOf,
	reversed,
	tangent,
	toBezier,
	type Bezier,
} from './bezier-points.js';
import { intersect, selfIntersection } from './intersect.js';
import { splitSubpaths, type PathCommand, type Point } from './path.js';
import { splitCubicBezier, splitQuadraticBezier } from './stroke-outline/bezier.js';
import { solveQuadratic } from './stroke-outline/intersect.js';
import { cross, dot, lerp, near } from './vec.js';

export type BooleanOperation = 'union' | 'intersection' | 'difference' | 'exclusion';

export interface BooleanOpOptions {
	/** How `a`'s subpaths form its fill. Default `'nonzero'`. */
	fillRuleA?: FillRule;
	/** How `b`'s subpaths form its fill. Default `'nonzero'`. */
	fillRuleB?: FillRule;
	/**
	 * Relative tolerance: points closer than this times the size of both paths
	 * together are the same point. Default 1e-10.
	 */
	tolerance?: number;
}

const OPERATIONS: BooleanOperation[] = ['union', 'intersection', 'difference', 'exclusion'];

/**
 * The path's edges, every subpath closed (by a line back to its start when it
 * doesn't end there), as a fill would. Edges that draw nothing within `tol`
 * are dropped.
 */
function pathEdges(commands: PathCommand[], tol: number): Bezier[] {
	const edges: Bezier[] = [];
	for (const { segments } of splitSubpaths(commands)) {
		const start = segments[0].p0;
		const last = toBezier(segments[segments.length - 1]);
		const all = segments.map(toBezier);
		if (!near(end(last), start, tol)) all.push([end(last), start]);
		for (const e of all) if (!e.every(p => near(p, e[0], tol))) edges.push(e);
	}
	return edges;
}

// Split an edge at ascending ts in (0,1), returning ts.length+1 sub-edges
// that together retrace the original edge exactly (this is where "preserve
// curves" happens — we subdivide, never approximate).
//
// For curves there's a subtlety: de Casteljau's split_*_bezier splits the
// *current remaining* piece at a local parameter in [0,1], but our ts are in
// the original edge's parameter space. After chopping off [0, t_prev], the
// original t maps to local = (t - t_prev) / (1 - t_prev) on what's left.
function splitEdge(e: Bezier, ts: number[]): Bezier[] {
	const out: Bezier[] = [];
	if (e.length === 2) {
		// Lines split by simple interpolation, no reparametrization needed.
		let prev = e[0];
		for (const t of ts) {
			const p = lerp(e[0], e[1], t);
			out.push([prev, p]);
			prev = p;
		}
		out.push([prev, e[1]]);
		return out;
	}
	let cur = e;
	let tPrev = 0.0;
	for (const t of ts) {
		const local = (t - tPrev) / (1.0 - tPrev);
		const [left, right] =
			cur.length === 3
				? splitQuadraticBezier(cur as [Point, Point, Point], local)
				: splitCubicBezier(cur as [Point, Point, Point, Point], local);
		out.push(left);
		cur = right;
		tPrev = t;
	}
	out.push(cur);
	return out;
}

// Parameters in (0,1), ascending, where the edge's y (or x) turns around —
// cutting there leaves pieces along which it is monotone.
function turningPoints(e: Bezier, axis: 'x' | 'y'): number[] {
	let roots: number[] = [];
	if (e.length === 3)
		// y'(t) ∝ (p1 - p0) + t·(p0 - 2p1 + p2)
		roots = solveQuadratic(
			0,
			e[0][axis] - 2.0 * e[1][axis] + e[2][axis],
			e[1][axis] - e[0][axis],
		);
	else if (e.length === 4) {
		// y'(t) ∝ (a - 2b + c)t² + 2(b - a)t + a, with a/b/c the control deltas.
		const a = e[1][axis] - e[0][axis];
		const b = e[2][axis] - e[1][axis];
		const c = e[3][axis] - e[2][axis];
		roots = solveQuadratic(a - 2.0 * b + c, 2.0 * (b - a), a);
	}
	return roots.filter(t => t > 0.0 && t < 1.0);
}

/** A y-monotone piece of a curve edge, from t0 to t1, with its x range. */
interface MonotonePiece {
	t0: number;
	t1: number;
	a: Point;
	b: Point;
	minX: number;
	maxX: number;
}

// The edge's y-monotone pieces, worked out once per edge: every probe's ray
// that reaches the edge needs them.
const monotonePieces = new WeakMap<Bezier, MonotonePiece[]>();
function piecesOf(e: Bezier): MonotonePiece[] {
	let pieces = monotonePieces.get(e);
	if (pieces) return pieces;
	pieces = [];
	const xTurns = turningPoints(e, 'x');
	const cuts = [0.0, ...turningPoints(e, 'y'), 1.0];
	for (let i = 0; i + 1 < cuts.length; i++) {
		const [t0, t1] = [cuts[i], cuts[i + 1]];
		const a = i === 0 ? e[0] : evaluate(e, t0);
		const b = i + 2 === cuts.length ? end(e) : evaluate(e, t1);
		const xs = [
			a.x,
			b.x,
			...xTurns.filter(t => t > t0 && t < t1).map(t => evaluate(e, t).x),
		];
		pieces.push({ t0, t1, a, b, minX: Math.min(...xs), maxX: Math.max(...xs) });
	}
	monotonePieces.set(e, pieces);
	return pieces;
}

// One edge's contribution to the winding number around p. A ray shot to the
// right counts upward crossings +1 and downward ones -1, so a contour with
// positive signed area (interior on its left) winds +1 around its interior.
// Curves are cut into y-monotone pieces and every piece uses the half-open
// rule (y_lo <= p.y < y_hi), so shared endpoints and y-extrema count once.
// Changed here: where p is clear of a piece's x range, which side the crossing
// is on is known without finding it.
function edgeWinding(p: Point, e: Bezier): number {
	let winding = 0;
	const count = (a: Point, b: Point, xAtY: () => number) => {
		if (a.y === b.y || p.y < Math.min(a.y, b.y) || p.y >= Math.max(a.y, b.y)) return;
		if (xAtY() > p.x) winding += a.y < b.y ? 1 : -1;
	};
	if (e.length === 2) {
		const [p0, p3] = e;
		count(p0, p3, () => p0.x + ((p.y - p0.y) * (p3.x - p0.x)) / (p3.y - p0.y));
		return winding;
	}
	// Cheap reject: the curve lies inside its control polygon's bounds.
	if (Math.max(...e.map(q => q.x)) <= p.x) return 0;
	if (p.y < Math.min(...e.map(q => q.y)) || p.y > Math.max(...e.map(q => q.y))) return 0;

	for (const { t0, t1, a, b, minX, maxX } of piecesOf(e))
		count(a, b, () => {
			if (p.x < minX) return Infinity;
			if (p.x >= maxX) return -Infinity;
			// Bisect for y(t) = p.y; y is monotone on [t0, t1].
			let lo = t0;
			let hi = t1;
			if (a.y > b.y) [lo, hi] = [hi, lo];
			for (let k = 0; k < 64; ++k) {
				const mid = 0.5 * (lo + hi);
				if (evaluate(e, mid).y < p.y) lo = mid;
				else hi = mid;
			}
			return evaluate(e, 0.5 * (lo + hi)).x;
		});
	return winding;
}

const filled = (winding: number, rule: FillRule) =>
	rule === 'nonzero' ? winding !== 0 : (winding & 1) !== 0;

function keeps(operation: BooleanOperation, inA: boolean, inB: boolean): boolean {
	switch (operation) {
		case 'union':
			return inA || inB;
		case 'intersection':
			return inA && inB;
		case 'difference':
			return inA && !inB;
		case 'exclusion':
			return inA !== inB;
	}
}

function checkedPath(commands: Iterable<PathCommand>): PathCommand[] {
	const path = [...commands];
	// splitSubpaths checks every command.
	splitSubpaths(path);
	return path;
}

/**
 * The operation applied to the fills of paths `a` and `b`, as simple, closed
 * contours: `'union'` (in either), `'intersection'` (in both), `'difference'`
 * (in `a` and not in `b`) or `'exclusion'` (in exactly one). Every subpath
 * counts as closed. Outer contours run clockwise on screen (positive `area`)
 * and holes the other way, so the result fills the same under either fill
 * rule. Curves are only split, never approximated. A path's own overlaps are
 * resolved too: `booleanOp(path, [], 'union')` removes them.
 */
export function booleanOp(
	a: Iterable<PathCommand>,
	b: Iterable<PathCommand>,
	operation: BooleanOperation,
	options: BooleanOpOptions = {},
): PathCommand[] {
	if (!OPERATIONS.includes(operation))
		throw new TypeError(`unknown boolean operation: ${String(operation)}`);
	const ruleA = options.fillRuleA ?? 'nonzero';
	const ruleB = options.fillRuleB ?? 'nonzero';
	for (const rule of [ruleA, ruleB])
		if (rule !== 'nonzero' && rule !== 'evenodd')
			throw new TypeError(`unknown fill rule: ${String(rule)}`);
	const tolerance = options.tolerance ?? 1e-10;
	if (!(tolerance > 0) || !Number.isFinite(tolerance))
		throw new TypeError(`tolerance must be a positive number (got ${tolerance})`);

	const pathA = checkedPath(a);
	const pathB = checkedPath(b);
	const box = bounds([...pathA, ...pathB]);
	if (!box) return [];

	// Relative to the paths' size, never inside floating-point noise.
	const extent = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
	const magnitude = Math.max(
		Math.abs(box.minX),
		Math.abs(box.maxX),
		Math.abs(box.minY),
		Math.abs(box.maxY),
	);
	const tol = Math.max(extent * tolerance, magnitude * 1e-14);

	// Stage 1: the edges of both paths, each tagged with its path.
	const edgesA = pathEdges(pathA, tol);
	const edgesB = pathEdges(pathB, tol);
	const edges = [...edgesA, ...edgesB];
	if (!edges.length) return [];
	const isA = (i: number) => i < edgesA.length;

	// Stage 2: every point where two edges meet, recorded as a split on each
	// edge whose interior it lies on. A hit at an edge's own endpoint needs no
	// split there, but the *other* edge may still need one (a vertex landing
	// on another edge's interior).
	const splits: { t: number; pt: Point }[][] = edges.map(() => []);
	const addSplit = (i: number, t: number, pt: Point) => {
		const e = edges[i];
		if (t <= 0.0 || t >= 1.0 || near(pt, e[0], tol) || near(pt, end(e), tol)) return;
		splits[i].push({ t, pt });
	};
	edges.forEach((e, i) => {
		const loop = selfIntersection(e);
		if (loop) {
			const pt = evaluate(e, loop[0]);
			addSplit(i, loop[0], pt);
			addSplit(i, loop[1], pt);
		}
	});
	// Broad phase: only edges whose boxes (grown by `tol`) touch can meet.
	// Sort by left edge and sweep: each edge is paired only with the edges
	// that start before it ends in x, then checked in y.
	const boxes = edges.map(e => controlBox(e, tol));
	const byX = edges.map((_, i) => i).sort((p, q) => boxes[p].minX - boxes[q].minX);
	for (let i = 0; i < byX.length; ++i)
		for (let j = i + 1; j < byX.length && boxes[byX[j]].minX <= boxes[byX[i]].maxX; ++j) {
			const [p, q] = [byX[i], byX[j]];
			if (boxes[p].minY > boxes[q].maxY || boxes[q].minY > boxes[p].maxY) continue;
			for (const h of intersect(edges[p], edges[q], tol))
				if (h.kind === 'point') {
					addSplit(p, h.t1, h.point);
					addSplit(q, h.t2, h.point);
				} else
					for (const k of [0, 1]) {
						// Both edges are split at the same point, so their pieces match.
						const pt = evaluate(edges[p], h.t1[k]);
						addSplit(p, h.t1[k], pt);
						addSplit(q, h.t2[k], pt);
					}
		}

	// Split every edge at its (sorted, de-duplicated) points. Sub-edge ends
	// are snapped to the shared intersection point so pieces from different
	// edges meet exactly; pieces shorter than `tol` are dropped. Each piece
	// also keeps its exact shape, before snapping, for classifying: snapping
	// moves its middle a little, which can be more than the probe distance.
	const pieces: Bezier[] = [];
	const exact: Bezier[] = [];
	edges.forEach((e, i) => {
		const s = splits[i].sort((p, q) => p.t - q.t);
		// Two splits at the same point are one, unless the edge goes somewhere in
		// between: a cubic's loop starts and ends at the same point.
		const unique: typeof s = [];
		for (const sp of s) {
			const prev = unique[unique.length - 1];
			const same =
				prev &&
				near(sp.pt, prev.pt, tol) &&
				near(evaluate(e, (sp.t + prev.t) / 2), prev.pt, tol);
			if (!same) unique.push(sp);
		}
		const subs = splitEdge(
			e,
			unique.map(sp => sp.t),
		);
		const unsnapped = subs.map(piece => [...piece]);
		for (let k = 0; k < unique.length; ++k) {
			subs[k][subs[k].length - 1] = unique[k].pt;
			subs[k + 1][0] = unique[k].pt;
		}
		subs.forEach((piece, k) => {
			if (piece.every(p => near(p, piece[0], tol))) return;
			pieces.push(piece);
			exact.push(unsnapped[k]);
		});
	});

	// Stage 3: probe points just left and right of every piece's midpoint,
	// classified in one batch by a sweep in y: a winding test's horizontal ray
	// only meets edges spanning the point's y. Each probe gets a winding count
	// per path. The probe stays clear of edges within `tol` of the piece, but
	// within a short piece, so it doesn't reach past the piece's neighbours.
	interface Probe {
		left: Point;
		right: Point;
	}
	const probes: (Probe | null)[] = exact.map(e => {
		const dir = tangent(e, 0.5);
		const len = Math.hypot(dir.x, dir.y);
		if (len === 0) return null;
		// The piece's size by its control points: a loop's ends coincide.
		const box = controlBox(e, 0);
		const size = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
		const offset = Math.min(4 * tol, size / 4);
		const left = { x: (-dir.y / len) * offset, y: (dir.x / len) * offset };
		const mid = evaluate(e, 0.5);
		return {
			left: { x: mid.x + left.x, y: mid.y + left.y },
			right: { x: mid.x - left.x, y: mid.y - left.y },
		};
	});
	const points: Point[] = [];
	for (const p of probes) if (p) points.push(p.left, p.right);
	const windingA = new Array<number>(points.length).fill(0);
	const windingB = new Array<number>(points.length).fill(0);
	const spans = edges.map(e => controlBox(e, tol));
	const pointOrder = points.map((_, i) => i).sort((p, q) => points[p].y - points[q].y);
	const edgeOrder = edges.map((_, i) => i).sort((p, q) => spans[p].minY - spans[q].minY);
	let active: number[] = [];
	let expires = Infinity; // the lowest maxY among the active edges
	let next = 0;
	for (const pi of pointOrder) {
		const y = points[pi].y;
		while (next < edgeOrder.length && spans[edgeOrder[next]].minY <= y) {
			const k = edgeOrder[next++];
			active.push(k);
			expires = Math.min(expires, spans[k].maxY);
		}
		if (expires < y) {
			active = active.filter(k => spans[k].maxY >= y);
			expires = active.reduce((m, k) => Math.min(m, spans[k].maxY), Infinity);
		}
		for (const k of active) {
			const w = edgeWinding(points[pi], edges[k]);
			if (isA(k)) windingA[pi] += w;
			else windingB[pi] += w;
		}
	}
	const inRegion = (pi: number) =>
		keeps(operation, filled(windingA[pi], ruleA), filled(windingB[pi], ruleB));

	// Keep the pieces with the region on exactly one side, oriented with it on
	// their left. Pieces on top of each other classify the same; keep the first.
	// Two kept pieces on top of each other but running opposite ways bound a
	// sliver thinner than `tol` (two edges that meet, then cross again right
	// next to it); drop both. "On top" compares the middle of one with the
	// other piece, so a line and a curve, parameterized differently, match too.
	// Pieces are looked up by their start point in a grid of cells no smaller
	// than either tolerance, so near points land in the same or a neighbouring
	// cell: only the 3 × 3 cells around a point need checking.
	const chainTol = tol * 4.0;
	const cellOf = (v: number) => Math.floor(v / chainTol);
	const grid = () => {
		const cells = new Map<string, number[]>();
		return {
			add(p: Point, index: number) {
				const key = `${cellOf(p.x)},${cellOf(p.y)}`;
				const list = cells.get(key);
				if (list) list.push(index);
				else cells.set(key, [index]);
			},
			*near(p: Point) {
				const [cx, cy] = [cellOf(p.x), cellOf(p.y)];
				for (let dx = -1; dx <= 1; dx++)
					for (let dy = -1; dy <= 1; dy++)
						yield* cells.get(`${cx + dx},${cy + dy}`) ?? [];
			},
		};
	};

	const candidates: (Bezier | null)[] = [];
	const byStart = grid();
	const onTop = (q: Bezier, from: Point, to: Point, mid: Point) =>
		near(q[0], from, tol) && near(end(q), to, tol) && parameterOf(q, mid, tol) !== null;
	const findOnTop = (from: Point, to: Point, mid: Point) => {
		for (const k of byStart.near(from)) {
			const q = candidates[k];
			if (q && onTop(q, from, to, mid)) return k;
		}
		return -1;
	};
	let pi = 0;
	pieces.forEach((e, k) => {
		if (!probes[k]) return;
		const inLeft = inRegion(pi++);
		const inRight = inRegion(pi++);
		if (inLeft === inRight) return;
		const oriented = inLeft ? e : reversed(e);
		const mid = evaluate(oriented, 0.5);
		if (findOnTop(oriented[0], end(oriented), mid) !== -1) return;
		const back = findOnTop(end(oriented), oriented[0], mid);
		if (back !== -1) candidates[back] = null;
		else {
			byStart.add(oriented[0], candidates.length);
			candidates.push(oriented);
		}
	});
	const kept = candidates.filter((q): q is Bezier => q !== null);

	// Stage 4: chain kept pieces end to end into closed contours. Every vertex
	// of a region boundary has as many pieces leaving as arriving, so a walk
	// from any unused piece can only end back at its start. Where several
	// pieces leave the same point, take the sharpest left turn: that follows
	// the boundary of the region right next to the walk, so where the region
	// touches itself at a point, the contours separate there.
	const result: PathCommand[] = [];
	const used = new Array<boolean>(kept.length).fill(false);
	const keptByStart = grid();
	kept.forEach((q, k) => keptByStart.add(q[0], k));
	const turn = (from: Bezier, to: Bezier) => {
		const din = tangent(from, 1);
		const dout = tangent(to, 0);
		return Math.atan2(cross(din, dout), dot(din, dout));
	};
	for (let start = 0; start < kept.length; ++start) {
		if (used[start]) continue;
		used[start] = true;
		const loop = [kept[start]];
		while (!near(end(loop[loop.length - 1]), loop[0][0], chainTol)) {
			const last = loop[loop.length - 1];
			let best = -1;
			for (const k of keptByStart.near(end(last))) {
				if (used[k] || !near(kept[k][0], end(last), chainTol)) continue;
				if (best === -1 || turn(last, kept[k]) > turn(last, kept[best])) best = k;
			}
			// Every vertex has as many kept pieces leaving as arriving, so this
			// only happens when the pieces are inconsistent.
			if (best === -1) throw new BooleanOpError('a contour of the result does not close');
			used[best] = true;
			loop.push(kept[best]);
		}
		for (const contour of separate(loop, chainTol)) emitContour(contour, result);
	}
	return result;
}

/**
 * The loop cut at every point it passes through twice, into loops that each
 * pass through their points once. The turn rule above already separates
 * regions that touch at a point; this separates a hole that touches its outer
 * contour, where the region's boundary comes back to the point.
 */
function separate(loop: Bezier[], eps: number): Bezier[][] {
	const out: Bezier[][] = [];
	const stack: Bezier[] = [];
	for (const e of loop) {
		stack.push(e);
		for (let i = stack.length - 1; i >= 0; i--)
			if (near(stack[i][0], end(e), eps)) {
				out.push(stack.splice(i));
				break;
			}
	}
	return out;
}

// Turn a walked list of pieces back into path commands (one closed subpath),
// ending exactly where it starts.
function emitContour(loop: Bezier[], out: PathCommand[]) {
	const start = loop[0][0];
	out.push({ type: 'moveTo', x: start.x, y: start.y });
	loop.forEach((e, i) => {
		const to = i === loop.length - 1 ? start : end(e);
		if (e.length === 2) out.push({ type: 'lineTo', x: to.x, y: to.y });
		else if (e.length === 3)
			out.push({ type: 'quadTo', cx: e[1].x, cy: e[1].y, x: to.x, y: to.y });
		else
			out.push({
				type: 'cubicTo',
				c1x: e[1].x,
				c1y: e[1].y,
				c2x: e[2].x,
				c2y: e[2].y,
				x: to.x,
				y: to.y,
			});
	});
	out.push({ type: 'close' });
}
