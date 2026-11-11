// The two flatten methods on the same curve, side by side, with the error of
// each measured the strict way: every line against its own stretch of curve.
import { curveSamples } from 'vector-path-tools/internal/flatten';
import type { FlattenMethod } from 'vector-path-tools';
import { css, defaultTolerance, header, toleranceLabel } from './common';
import { CURVES } from './presets';

header();

interface Point {
	x: number;
	y: number;
}
interface Sample extends Point {
	t: number;
}

const W = 400;
const H = 360;
const R = 7; // handle radius
const METHODS: FlattenMethod[] = ['uniform', 'adaptive'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- curves ----------
const lerp = (a: Point, b: Point, t: number): Point => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

function at(p: Point[], t: number): Point {
	if (p.length === 3) return lerp(lerp(p[0], p[1], t), lerp(p[1], p[2], t), t);
	const a = lerp(p[0], p[1], t);
	const b = lerp(p[1], p[2], t);
	const c = lerp(p[2], p[3], t);
	return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

/** The points of a method's lines, including both ends, with their parameter t. */
function linesOf(method: FlattenMethod, p: Point[], tol: number): Sample[] {
	const end = p[p.length - 1];
	return [
		{ t: 0, x: p[0].x, y: p[0].y },
		...curveSamples(
			method,
			p.map(q => q.x),
			p.map(q => q.y),
			tol,
		),
		{ t: 1, x: end.x, y: end.y },
	];
}

// ---------- measuring the error ----------
function closest(q: Point, a: Point, b: Point): Point {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
	return { x: a.x + dx * t, y: a.y + dy * t };
}

function maxError(p: Point[], pts: Sample[]) {
	let worst = { d: 0, at: pts[0] as Point, on: pts[0] as Point };
	for (let i = 0; i + 1 < pts.length; i++)
		for (let j = 1; j < 100; j++) {
			const q = at(p, pts[i].t + ((pts[i + 1].t - pts[i].t) * j) / 100);
			const on = closest(q, pts[i], pts[i + 1]);
			const d = Math.hypot(q.x - on.x, q.y - on.y);
			if (d > worst.d) worst = { d, at: q, on };
		}
	return worst;
}

// ---------- state, presets ----------
let points = CURVES.worst.map(p => ({ ...p }));
let kind = 'cubic';
const curve = () => (kind === 'cubic' ? points : [points[0], points[1], points[3]]);

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

function draw(method: FlattenMethod) {
	const ctx = views[method];
	const p = curve();
	const tol = Number($<HTMLInputElement>('tol').value);
	const pts = linesOf(method, p, tol);
	const err = maxError(p, pts);
	ctx.clearRect(0, 0, W, H);

	// control polygon
	ctx.strokeStyle = css('--input');
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 4]);
	ctx.beginPath();
	p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
	ctx.stroke();
	ctx.setLineDash([]);

	// the curve as a band twice the tolerance wide, and its centerline
	ctx.beginPath();
	for (let i = 0; i <= 400; i++) {
		const q = at(p, i / 400);
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

	// the lines
	ctx.strokeStyle = css('--accent');
	ctx.lineWidth = 2;
	ctx.beginPath();
	pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
	ctx.stroke();
	ctx.fillStyle = css('--accent');
	for (const q of pts) ctx.fillRect(q.x - 2.5, q.y - 2.5, 5, 5);

	// worst error
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

	// handles
	for (const q of p) {
		ctx.fillStyle = css('--bg');
		ctx.strokeStyle = css('--handle');
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(q.x, q.y, R, 0, 2 * Math.PI);
		ctx.fill();
		ctx.stroke();
	}

	$(method + 'Info').innerHTML =
		`${pts.length - 1} lines · max error ${err.d.toFixed(2)} px = ` +
		`<span class="${over ? 'bad' : 'good'}">${(err.d / tol).toFixed(2)}× tolerance</span>` +
		(over ? ' (over!)' : '');
}

function render() {
	// Both methods default to the same tolerance.
	$<HTMLOutputElement>('tolOut').value = toleranceLabel(
		Number($<HTMLInputElement>('tol').value),
		defaultTolerance('flatten', 'uniform'),
	);
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
		const visible = kind === 'cubic' ? [0, 1, 2, 3] : [0, 1, 3];
		dragging =
			visible.find(i => Math.hypot(points[i].x - q.x, points[i].y - q.y) < R + 4) ?? -1;
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
$('kind').addEventListener('change', e => {
	kind = (e.target as HTMLSelectElement).value;
	render();
});
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
