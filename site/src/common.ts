// Shared by the pages: the page header, a canvas path editor with draggable
// points, drawing helpers, and the tolerance defaults.
import './style.css';
import type { PathCommand } from 'vector-path-tools';

// ---------- header ----------

const PAGES = [
	{ href: '', title: 'Overview' },
	{ href: 'flatten.html', title: 'flatten comparison' },
	{ href: 'quadratics.html', title: 'toQuadratics comparison' },
];

export function header() {
	const base = import.meta.env.BASE_URL;
	const here = location.pathname.slice(base.length).replace(/index\.html$/, '');
	const el = document.createElement('header');
	el.className = 'site';
	el.innerHTML =
		`<div><a class="brand" href="${base}">vector-path-tools</a><nav>` +
		PAGES.map(
			p =>
				`<a href="${base}${p.href}"${p.href === here ? ' class="active"' : ''}>${p.title}</a>`,
		).join('') +
		`<a href="https://github.com/yyyk/vector-path-tools">GitHub</a></nav></div>`;
	document.body.prepend(el);
}

export const css = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- canvas ----------

export interface View {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	width: number;
	height: number;
}

export function view(canvas: HTMLCanvasElement, width: number, height: number): View {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const ctx = canvas.getContext('2d')!;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return { canvas, ctx, width, height };
}

/** Trace commands as a canvas path (call fill/stroke afterwards). */
export function trace(ctx: CanvasRenderingContext2D, commands: readonly PathCommand[]) {
	ctx.beginPath();
	for (const c of commands)
		if (c.type === 'moveTo') ctx.moveTo(c.x, c.y);
		else if (c.type === 'lineTo') ctx.lineTo(c.x, c.y);
		else if (c.type === 'quadTo') ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
		else if (c.type === 'cubicTo') ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.x, c.y);
		else ctx.closePath();
}

export function strokePath(
	v: View,
	commands: readonly PathCommand[],
	color: string,
	width = 1,
	dash: number[] = [],
) {
	const { ctx } = v;
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineJoin = 'round';
	ctx.setLineDash(dash);
	trace(ctx, commands);
	ctx.stroke();
	ctx.restore();
}

/** Small squares on the end point of every command (the vertices). */
export function vertices(v: View, commands: readonly PathCommand[], color: string, size = 4) {
	v.ctx.fillStyle = color;
	for (const c of commands)
		if (c.type !== 'close') v.ctx.fillRect(c.x - size / 2, c.y - size / 2, size, size);
}

// ---------- editing ----------

/** A draggable coordinate pair of a command: which fields, and whether it's a control point. */
interface Handle {
	index: number;
	xKey: string;
	yKey: string;
	control: boolean;
}

function handles(commands: readonly PathCommand[]): Handle[] {
	const out: Handle[] = [];
	commands.forEach((c, index) => {
		if (c.type === 'quadTo') out.push({ index, xKey: 'cx', yKey: 'cy', control: true });
		if (c.type === 'cubicTo')
			out.push(
				{ index, xKey: 'c1x', yKey: 'c1y', control: true },
				{ index, xKey: 'c2x', yKey: 'c2y', control: true },
			);
		if (c.type !== 'close') out.push({ index, xKey: 'x', yKey: 'y', control: false });
	});
	return out;
}

const get = (c: PathCommand, key: string) => (c as unknown as Record<string, number>)[key];

/**
 * A canvas whose path can be edited by dragging its points. `draw` is called
 * after every change (and once at the start) to paint the canvas.
 */
export class PathEditor {
	commands: PathCommand[];
	/** The handles being dragged: on-curve points in the same place move together. */
	private dragging: Handle[] = [];

	constructor(
		readonly v: View,
		commands: PathCommand[],
		private readonly draw: (editor: PathEditor) => void,
		private readonly onChange: (commands: PathCommand[]) => void = () => {},
	) {
		this.commands = structuredClone(commands);
		const pos = (e: PointerEvent) => {
			const r = v.canvas.getBoundingClientRect();
			return {
				x: ((e.clientX - r.left) / r.width) * v.width,
				y: ((e.clientY - r.top) / r.height) * v.height,
			};
		};
		v.canvas.addEventListener('pointerdown', e => {
			const p = pos(e);
			let best: Handle | null = null;
			let bestD = 10;
			for (const h of handles(this.commands)) {
				const c = this.commands[h.index];
				const d = Math.hypot(get(c, h.xKey) - p.x, get(c, h.yKey) - p.y);
				if (d < bestD) [best, bestD] = [h, d];
			}
			this.dragging = [];
			if (!best) return;
			// A subpath that ends its last curve at its start has two on-curve
			// points there (the moveTo and the curve's end): keep them together.
			const at = this.commands[best.index];
			const [bx, by] = [get(at, best.xKey), get(at, best.yKey)];
			this.dragging = best.control
				? [best]
				: handles(this.commands).filter(h => {
						const c = this.commands[h.index];
						return !h.control && get(c, h.xKey) === bx && get(c, h.yKey) === by;
					});
			v.canvas.setPointerCapture(e.pointerId);
		});
		v.canvas.addEventListener('pointermove', e => {
			if (!this.dragging.length) return;
			const p = pos(e);
			for (const h of this.dragging) {
				const c = this.commands[h.index] as unknown as Record<string, number>;
				c[h.xKey] = Math.round(p.x * 10) / 10;
				c[h.yKey] = Math.round(p.y * 10) / 10;
			}
			this.changed();
		});
		v.canvas.addEventListener('pointerup', () => (this.dragging = []));
		this.redraw();
	}

	/** Replace the path. `notify: false` skips onChange (for edits that came from outside). */
	set(commands: PathCommand[], { notify = true } = {}) {
		this.commands = structuredClone(commands);
		if (notify) this.onChange(this.commands);
		this.redraw();
	}

	redraw() {
		this.v.ctx.clearRect(0, 0, this.v.width, this.v.height);
		this.draw(this);
	}

	private changed() {
		this.onChange(this.commands);
		this.redraw();
	}

	/** The control polygon (dashed) and the draggable points. */
	drawHandles() {
		const { ctx } = this.v;
		ctx.save();
		ctx.strokeStyle = css('--input');
		ctx.setLineDash([3, 3]);
		let x = 0;
		let y = 0;
		let sx = 0;
		let sy = 0;
		for (const c of this.commands) {
			if (c.type === 'quadTo' || c.type === 'cubicTo') {
				ctx.beginPath();
				ctx.moveTo(x, y);
				if (c.type === 'quadTo') ctx.lineTo(c.cx, c.cy);
				else (ctx.lineTo(c.c1x, c.c1y), ctx.moveTo(c.c2x, c.c2y));
				ctx.lineTo(c.x, c.y);
				ctx.stroke();
			}
			if (c.type === 'moveTo') [sx, sy] = [c.x, c.y];
			if (c.type === 'close') [x, y] = [sx, sy];
			else [x, y] = [c.x, c.y];
		}
		ctx.setLineDash([]);
		for (const h of handles(this.commands)) {
			const c = this.commands[h.index];
			ctx.beginPath();
			ctx.arc(get(c, h.xKey), get(c, h.yKey), h.control ? 4 : 5.5, 0, 2 * Math.PI);
			ctx.fillStyle = h.control ? css('--bg') : css('--handle');
			ctx.strokeStyle = css('--handle');
			ctx.lineWidth = 1.5;
			ctx.fill();
			ctx.stroke();
		}
		ctx.restore();
	}
}

/**
 * The library's default tolerance (see flatten.ts and to-quadratics.ts), or
 * undefined where it is required.
 */
export function defaultTolerance(
	op: 'flatten' | 'toQuadratics',
	method: string,
): number | undefined {
	if (op === 'flatten') return 0.25;
	if (method === 'fonttools') return 1;
	if (method.startsWith('colomitchi')) return 0.5;
	return undefined;
}

/**
 * Where a tolerance slider starts: the library's default, or 0.5 for methods
 * without one (kurbo's to_quads; at 0.5 it matches Colomitchi's methods at
 * their default in accuracy and number of quadratics).
 */
export function startTolerance(op: 'flatten' | 'toQuadratics', method: string): number {
	return defaultTolerance(op, method) ?? 0.5;
}

/** What to show next to a tolerance slider. */
export function toleranceLabel(value: number, def: number | undefined): string {
	if (def === undefined) return `${value} (no default)`;
	return value === def ? `${value} (default)` : `${value} (default: ${def})`;
}

/**
 * A call as code, leaving out the tolerance when it is the default and the
 * options when there are none.
 */
export function callCode(
	name: string,
	tolerance: number,
	def: number | undefined,
	options: Record<string, string | boolean>,
): string {
	const entries = Object.entries(options).map(
		([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : v}`,
	);
	const args = ['path', tolerance === def ? 'undefined' : String(tolerance)];
	if (entries.length) args.push(`{ ${entries.join(', ')} }`);
	else if (args[1] === 'undefined') args.pop();
	return `${name}(${args.join(', ')})`;
}
