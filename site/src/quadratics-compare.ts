// The five toQuadratics methods on the same cubic, side by side, with the
// error of each measured both ways: the cubic against the quadratics, and the
// quadratics against the cubic.
import { toQuadratics, type PathCommand, type ToQuadraticsMethod } from 'vector-path-tools';
import { callCode, css, defaultTolerance, header } from './common';
import { CURVES } from './presets';

header();

interface Point {
	x: number;
	y: number;
}
type Quad = [Point, Point, Point];

const W = 400;
const H = 360;
const R = 7; // handle radius
const METHODS: ToQuadraticsMethod[] = [
	'kurbo',
	'fonttools',
	'colomitchi-half',
	'colomitchi-adaptive',
	'colomitchi-symmetric',
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- curves ----------
const lerp = (a: Point, b: Point, t: number): Point => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

function cubicAt(p: Point[], t: number): Point {
	const a = lerp(p[0], p[1], t);
	const b = lerp(p[1], p[2], t);
	const c = lerp(p[2], p[3], t);
	return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

const quadAt = (q: Quad, t: number): Point => lerp(lerp(q[0], q[1], t), lerp(q[1], q[2], t), t);

/** The method's quadratics for the cubic p. */
function quadsOf(
	method: ToQuadraticsMethod,
	p: Point[],
	tol: number,
	detectInflections: boolean,
): Quad[] {
	const path: PathCommand[] = [
		{ type: 'moveTo', x: p[0].x, y: p[0].y },
		{
			type: 'cubicTo',
			c1x: p[1].x,
			c1y: p[1].y,
			c2x: p[2].x,
			c2y: p[2].y,
			x: p[3].x,
			y: p[3].y,
		},
	];
	const out: Quad[] = [];
	let last = p[0];
	for (const c of toQuadratics(path, tol, { method, detectInflections })) {
		if (c.type !== 'quadTo') continue;
		const end = { x: c.x, y: c.y };
		out.push([last, { x: c.cx, y: c.cy }, end]);
		last = end;
	}
	return out;
}

// ---------- measuring the error ----------
function closest(q: Point, a: Point, b: Point): Point {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
	return { x: a.x + dx * t, y: a.y + dy * t };
}

/** The furthest any point of `from` is from the polyline `to`. */
function oneWay(from: Point[], to: Point[]) {
	let worst = { d: 0, at: from[0], on: from[0] };
	for (const q of from) {
		let best = { d: Infinity, on: q };
		for (let i = 0; i + 1 < to.length; i++) {
			const on = closest(q, to[i], to[i + 1]);
			const d = Math.hypot(q.x - on.x, q.y - on.y);
			if (d < best.d) best = { d, on };
		}
		if (best.d > worst.d) worst = { d: best.d, at: q, on: best.on };
	}
	return worst;
}

function maxError(p: Point[], quads: Quad[]) {
	const cubic = Array.from({ length: 601 }, (_, i) => cubicAt(p, i / 600));
	const approx = quads.flatMap((q, k) =>
		Array.from({ length: 101 }, (_, i) => quadAt(q, i / 100)).slice(k ? 1 : 0),
	);
	const a = oneWay(cubic, approx);
	const b = oneWay(approx, cubic);
	return a.d >= b.d ? a : b;
}

// ---------- state ----------
let points = CURVES.s.map(p => ({ ...p }));

// ---------- drawing ----------
function setup(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const dpr = devicePixelRatio || 1;
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	canvas.style.width = W + 'px';
	canvas.style.height = H + 'px';
	const ctx = canvas.getContext('2d')!;
	ctx.scale(dpr, dpr);
	return ctx;
}
const views = Object.fromEntries(METHODS.map(m => [m, setup($<HTMLCanvasElement>(m))]));

function draw(method: ToQuadraticsMethod) {
	const ctx = views[method];
	const p = points;
	const tol = Number($<HTMLInputElement>('tol').value);
	const detectInflections =
		method.startsWith('colomitchi') && $<HTMLInputElement>('inflections').checked;
	ctx.clearRect(0, 0, W, H);

	// control polygon
	ctx.strokeStyle = css('--input');
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 4]);
	ctx.beginPath();
	p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
	ctx.stroke();
	ctx.setLineDash([]);

	// the cubic as a band twice the tolerance wide, and its centerline
	ctx.beginPath();
	for (let i = 0; i <= 400; i++) {
		const q = cubicAt(p, i / 400);
		if (i) ctx.lineTo(q.x, q.y);
		else ctx.moveTo(q.x, q.y);
	}
	ctx.strokeStyle = css('--band');
	ctx.lineWidth = 2 * tol;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();
	ctx.strokeStyle = css('--input');
	ctx.lineWidth = 1;
	ctx.stroke();

	let quads: Quad[];
	try {
		quads = quadsOf(method, p, tol, detectInflections);
	} catch (err) {
		drawHandles(ctx, p);
		$(method + 'Info').textContent = (err as Error).message;
		return;
	}

	// the quadratics, in alternating colors, joined at the dots
	quads.forEach((q, i) => {
		ctx.strokeStyle = i % 2 ? css('--accent') : css('--good');
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.moveTo(q[0].x, q[0].y);
		ctx.quadraticCurveTo(q[1].x, q[1].y, q[2].x, q[2].y);
		ctx.stroke();
	});
	ctx.fillStyle = css('--fg');
	for (const q of quads) {
		ctx.beginPath();
		ctx.arc(q[2].x, q[2].y, 3, 0, 2 * Math.PI);
		ctx.fill();
	}

	// worst error
	const err = maxError(p, quads);
	const over = err.d > tol * (1 + 1e-9);
	ctx.strokeStyle = over ? css('--bad') : css('--good');
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(err.at.x, err.at.y);
	ctx.lineTo(err.on.x, err.on.y);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(err.at.x, err.at.y, 5, 0, 2 * Math.PI);
	ctx.stroke();

	drawHandles(ctx, p);

	const code = callCode('toQuadratics', tol, defaultTolerance('toQuadratics', method), {
		...(method === 'kurbo' ? {} : { method }),
		...(detectInflections ? { detectInflections } : {}),
	});
	$(method + 'Info').innerHTML =
		`<code>${code}</code><br>${quads.length} quadratic${quads.length === 1 ? '' : 's'} · ` +
		`max error ${err.d.toFixed(2)} px = ` +
		`<span class="${over ? 'bad' : 'good'}">${(err.d / tol).toFixed(2)}× tolerance</span>` +
		(over ? ' (over!)' : '');
}

function drawHandles(ctx: CanvasRenderingContext2D, p: Point[]) {
	for (const q of p) {
		ctx.fillStyle = css('--bg');
		ctx.strokeStyle = css('--handle');
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(q.x, q.y, R, 0, 2 * Math.PI);
		ctx.fill();
		ctx.stroke();
	}
}

function render() {
	// One tolerance for all, so the methods are compared at the same accuracy.
	$<HTMLOutputElement>('tolOut').value = $<HTMLInputElement>('tol').value;
	for (const m of METHODS) draw(m);
}

// ---------- interaction ----------
let dragging = -1;
for (const m of METHODS) {
	const canvas = $<HTMLCanvasElement>(m);
	const pos = (e: PointerEvent): Point => {
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	canvas.addEventListener('pointerdown', e => {
		const q = pos(e);
		dragging = points.findIndex(p => Math.hypot(p.x - q.x, p.y - q.y) < R + 4);
		if (dragging >= 0) canvas.setPointerCapture(e.pointerId);
	});
	canvas.addEventListener('pointermove', e => {
		if (dragging < 0) return;
		points[dragging] = pos(e);
		render();
	});
	canvas.addEventListener('pointerup', () => (dragging = -1));
}
$('tol').addEventListener('input', render);
$('inflections').addEventListener('input', render);
$('preset').addEventListener('change', e => {
	points = CURVES[(e.target as HTMLSelectElement).value].map(p => ({ ...p }));
	render();
});
$('random').addEventListener('click', () => {
	const r = () => ({ x: 30 + Math.random() * (W - 60), y: 30 + Math.random() * (H - 60) });
	points = [r(), r(), r(), r()];
	render();
});
render();
