import {
	bounds,
	contains,
	curvePoint,
	curveTangent,
	flatten,
	measure,
	offsetCurve,
	pointsAlong,
	toQuadratics,
	type ContainsMethod,
	type Point,
	type FillRule,
	type FlattenMethod,
	type ToQuadraticsMethod,
	type PathCommand,
} from 'vector-path-tools';
import {
	callCode,
	css,
	defaultTolerance,
	header,
	startTolerance,
	PathEditor,
	strokePath,
	toleranceLabel,
	vertices,
	view,
} from './common';
import { highlightAll } from './highlight';
import { PRESETS } from './presets';

header();
highlightAll();

const W = 600;
const H = 400;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Re-run `render` whenever a form control changes; shows range values in <output for>. */
function bind(form: HTMLFormElement, render: () => void) {
	const sync = () => {
		for (const out of form.querySelectorAll<HTMLOutputElement>('output[for]'))
			out.value = (form.elements.namedItem(out.htmlFor.value) as HTMLInputElement).value;
		render();
	};
	form.addEventListener('input', sync);
	sync();
}
const value = (form: HTMLFormElement, name: string) =>
	(form.elements.namedItem(name) as HTMLInputElement).value;

/**
 * When the method changes to one that starts at a different tolerance, move
 * the form's tolerance slider there.
 */
function followDefault(form: HTMLFormElement, op: 'flatten' | 'toQuadratics') {
	const select = form.elements.namedItem('method') as HTMLSelectElement;
	let previous = startTolerance(op, select.value);
	select.addEventListener('input', () => {
		const start = startTolerance(op, select.value);
		if (start !== previous)
			(form.elements.namedItem('tolerance') as HTMLInputElement).value = String(start);
		previous = start;
	});
}

/** The tolerance slider's label, with the method's default. */
function showTolerance(form: HTMLFormElement, tolerance: number, def: number | undefined) {
	form.querySelector<HTMLOutputElement>('output[for="tolerance"]')!.value = toleranceLabel(
		tolerance,
		def,
	);
}

function box(
	v: { ctx: CanvasRenderingContext2D },
	b: ReturnType<typeof bounds>,
	color: string,
	dash: number[] = [],
) {
	if (!b) return;
	v.ctx.save();
	v.ctx.strokeStyle = color;
	v.ctx.setLineDash(dash);
	v.ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
	v.ctx.restore();
}

/** The box of the points as given, control points included (what bounds() improves on). */
function controlBox(commands: readonly PathCommand[]) {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const c of commands)
		for (const [k, n] of Object.entries(c))
			if (typeof n === 'number') (k.endsWith('x') ? xs : ys).push(n);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}

// ---------- bounds ----------
new PathEditor(view($('bounds'), W, H), PRESETS.drop, e => {
	const b = bounds(e.commands)!;
	box(e.v, controlBox(e.commands), css('--input'), [4, 4]);
	box(e.v, b, css('--accent'));
	strokePath(e.v, e.commands, css('--fg'), 2);
	e.drawHandles();
	$('bounds-info').textContent =
		`bounds(path) = { minX: ${b.minX.toFixed(1)}, minY: ${b.minY.toFixed(1)}, maxX: ${b.maxX.toFixed(1)}, maxY: ${b.maxY.toFixed(1)} }. ` +
		'Blue: the exact box. Dashed: the box of the points as given, control points included.';
});

// ---------- contains ----------
const containsForm = $<HTMLFormElement>('contains-form');
let pointer: { x: number; y: number } | null = null;

/** The glyph preset, with its inner loop reversed for "wound the same way". */
function glyph(inner: string): PathCommand[] {
	const path = structuredClone(PRESETS.glyph);
	if (inner === 'opposite') return path;
	const at = path.findIndex(c => c.type === 'close') + 1;
	const pts = path.slice(at).filter(c => c.type !== 'close') as Extract<
		PathCommand,
		{ type: 'moveTo' | 'quadTo' }
	>[];
	const last = pts[pts.length - 1];
	const reversed: PathCommand[] = [{ type: 'moveTo', x: last.x, y: last.y }];
	for (let i = pts.length - 1; i > 0; i--) {
		const c = pts[i] as Extract<PathCommand, { type: 'quadTo' }>;
		reversed.push({ type: 'quadTo', cx: c.cx, cy: c.cy, x: pts[i - 1].x, y: pts[i - 1].y });
	}
	reversed.push({ type: 'close' });
	return [...path.slice(0, at), ...reversed];
}

const containsEditor = new PathEditor(view($('contains'), W, H), glyph('opposite'), e => {
	const method = value(containsForm, 'method') as ContainsMethod;
	const fillRule = value(containsForm, 'rule') as FillRule;
	const options = { method, fillRule };
	// The options as code, leaving out the defaults.
	const shown = [
		...(method === 'skia' ? [] : [`method: '${method}'`]),
		...(fillRule === 'nonzero' ? [] : [`fillRule: '${fillRule}'`]),
	];
	const optionsCode = shown.length ? `, { ${shown.join(', ')} }` : '';
	let inside = 0;
	let total = 0;
	for (let y = 10; y < H; y += 20)
		for (let x = 10; x < W; x += 20) {
			const hit = contains(e.commands, x, y, options);
			e.v.ctx.fillStyle = hit ? css('--accent') : css('--input');
			e.v.ctx.globalAlpha = hit ? 1 : 0.35;
			e.v.ctx.fillRect(x - 3, y - 3, 6, 6);
			inside += hit ? 1 : 0;
			total++;
		}
	e.v.ctx.globalAlpha = 1;
	strokePath(e.v, e.commands, css('--fg'), 1.5);
	e.drawHandles();
	let text = `${inside} of ${total} grid points inside.`;
	if (pointer) {
		const hit = contains(e.commands, pointer.x, pointer.y, options);
		e.v.ctx.beginPath();
		e.v.ctx.arc(pointer.x, pointer.y, 6, 0, 2 * Math.PI);
		e.v.ctx.strokeStyle = hit ? css('--good') : css('--bad');
		e.v.ctx.lineWidth = 2;
		e.v.ctx.stroke();
		text += ` contains(path, ${pointer.x.toFixed(0)}, ${pointer.y.toFixed(0)}${optionsCode}) = ${hit}.`;
	} else text += ' Move the pointer over the shape to test a point.';
	$('contains-info').textContent = text;
});
containsEditor.v.canvas.addEventListener('pointermove', e => {
	const r = containsEditor.v.canvas.getBoundingClientRect();
	pointer = {
		x: ((e.clientX - r.left) / r.width) * W,
		y: ((e.clientY - r.top) / r.height) * H,
	};
	containsEditor.redraw();
});
let lastInner = 'opposite';
bind(containsForm, () => {
	const inner = value(containsForm, 'inner');
	if (inner === lastInner) return containsEditor.redraw();
	lastInner = inner;
	containsEditor.set(glyph(inner));
});

// ---------- flatten ----------
const flattenForm = $<HTMLFormElement>('flatten-form');
const flattenEditor = new PathEditor(view($('flatten'), W, H), PRESETS.hook, e => {
	const method = value(flattenForm, 'method') as FlattenMethod;
	const tolerance = Number(value(flattenForm, 'tolerance'));
	const def = defaultTolerance('flatten', method);
	showTolerance(flattenForm, tolerance, def);
	const flat = flatten(e.commands, tolerance, { method });
	e.v.ctx.save();
	e.v.ctx.lineCap = 'round';
	strokePath(e.v, e.commands, css('--band'), 2 * tolerance);
	e.v.ctx.restore();
	strokePath(e.v, e.commands, css('--input'), 1);
	strokePath(e.v, flat, css('--accent'), 2);
	vertices(e.v, flat, css('--accent'), 5);
	e.drawHandles();
	const lines = flat.filter(c => c.type === 'lineTo').length;
	$('flatten-info').textContent =
		`${callCode('flatten', tolerance, def, method === 'uniform' ? {} : { method })}: ${lines} lines. ` +
		'The gray band is the curve drawn twice the tolerance wide: the lines stay inside it.';
});
followDefault(flattenForm, 'flatten');
let lastCurve = 'cubic';
bind(flattenForm, () => {
	const curve = value(flattenForm, 'curve');
	if (curve === lastCurve) return flattenEditor.redraw();
	lastCurve = curve;
	flattenEditor.set(curve === 'quad' ? PRESETS.hookQuad : PRESETS.hook);
});

// ---------- toQuadratics ----------
const quadForm = $<HTMLFormElement>('quad-form');
const quadEditor = new PathEditor(view($('quad'), W, H), PRESETS.s, e => {
	const tolerance = Number(value(quadForm, 'tolerance'));
	const method = value(quadForm, 'method') as ToQuadraticsMethod;
	const inflections = (quadForm.elements.namedItem('inflections') as HTMLInputElement)
		.checked;
	const detectInflections = method.startsWith('colomitchi') && inflections;
	const def = defaultTolerance('toQuadratics', method);
	showTolerance(quadForm, tolerance, def);
	const out = toQuadratics(e.commands, tolerance, { method, detectInflections });
	strokePath(e.v, e.commands, css('--input'), 6);
	// Alternate colors so the pieces are visible.
	let x = 0;
	let y = 0;
	out.forEach((c, i) => {
		if (c.type === 'quadTo') {
			strokePath(
				e.v,
				[{ type: 'moveTo', x, y }, c],
				i % 2 ? css('--accent') : css('--good'),
				2.5,
			);
			e.v.ctx.fillStyle = css('--fg');
			e.v.ctx.beginPath();
			e.v.ctx.arc(c.x, c.y, 3, 0, 2 * Math.PI);
			e.v.ctx.fill();
		}
		if (c.type !== 'close') [x, y] = [c.x, c.y];
	});
	e.drawHandles();
	const n = out.filter(c => c.type === 'quadTo').length;
	$('quad-info').textContent =
		`${callCode('toQuadratics', tolerance, def, {
			...(method === 'kurbo' ? {} : { method }),
			...(detectInflections ? { detectInflections } : {}),
		})}: ` +
		`${n} quadratic${n === 1 ? '' : 's'} (alternating colors, joined at the dots), over the cubic in gray.`;
});
followDefault(quadForm, 'toQuadratics');
bind(quadForm, () => quadEditor.redraw());

// ---------- measure / pointsAlong ----------
const measureForm = $<HTMLFormElement>('measure-form');
const measureEditor = new PathEditor(view($('measure'), W, H), PRESETS.glyph, e => {
	const fraction = Number(value(measureForm, 'fraction'));
	const spacing = Number(value(measureForm, 'spacing'));
	const m = measure(e.commands);
	strokePath(e.v, e.commands, css('--input'), 1.5);
	const { ctx } = e.v;
	// pointsAlong: a dot per point, with a short tick along its direction.
	const subpaths = pointsAlong(e.commands, spacing);
	ctx.save();
	ctx.strokeStyle = css('--good');
	ctx.fillStyle = css('--good');
	ctx.lineWidth = 1.5;
	for (const points of subpaths)
		for (const p of points) {
			ctx.beginPath();
			ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
			ctx.fill();
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
			ctx.lineTo(p.x + 9 * Math.cos(p.angle), p.y + 9 * Math.sin(p.angle));
			ctx.stroke();
		}
	// pointAtFraction: a ring and an arrow along the direction there.
	const p = m.pointAtFraction(fraction);
	if (p) {
		const [dx, dy] = [Math.cos(p.angle), Math.sin(p.angle)];
		const [tx, ty] = [p.x + 32 * dx, p.y + 32 * dy];
		ctx.strokeStyle = css('--accent');
		ctx.fillStyle = css('--accent');
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(p.x, p.y);
		ctx.lineTo(tx, ty);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(tx, ty);
		ctx.lineTo(tx - 9 * dx + 5 * dy, ty - 9 * dy - 5 * dx);
		ctx.lineTo(tx - 9 * dx - 5 * dy, ty - 9 * dy + 5 * dx);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
	e.drawHandles();
	const n = subpaths.reduce((sum, s) => sum + s.length, 0);
	$('measure-info').textContent =
		`measure(path).length = ${m.length.toFixed(2)} (subpaths ${m.subpathLengths.map(l => l.toFixed(2)).join(' + ')}). ` +
		(p
			? `Blue: pointAtFraction(${fraction}) = { x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)}, angle: ${p.angle.toFixed(3)} }. `
			: '') +
		`Green: pointsAlong(path, ${spacing}), ${n} points.`;
});
bind(measureForm, () => measureEditor.redraw());

// ---------- curvePoint / curveTangent ----------
const curveForm = $<HTMLFormElement>('curve-form');
const curveEditor = new PathEditor(view($('curve'), W, H), PRESETS.hook, e => {
	const t = Number(value(curveForm, 't'));
	const c = e.commands.find(c => c.type === 'cubicTo');
	const start = e.commands[0];
	if (!c || start.type !== 'moveTo') return;
	const curve = [
		{ x: start.x, y: start.y },
		{ x: c.c1x, y: c.c1y },
		{ x: c.c2x, y: c.c2y },
		{ x: c.x, y: c.y },
	] as [Point, Point, Point, Point];
	strokePath(e.v, e.commands, css('--input'), 1.5);
	const { ctx } = e.v;
	// Equal steps in t: dots crowd where the curve is slow.
	ctx.save();
	ctx.fillStyle = css('--good');
	for (let i = 0; i <= 20; i++) {
		const q = curvePoint(curve, i / 20);
		ctx.beginPath();
		ctx.arc(q.x, q.y, 2.5, 0, 2 * Math.PI);
		ctx.fill();
	}
	// The point at t, and the derivative there as an arrow (a third of it, to fit).
	const p = curvePoint(curve, t);
	const d = curveTangent(curve, t);
	const [tx, ty] = [p.x + d.x / 3, p.y + d.y / 3];
	const len = Math.hypot(d.x, d.y);
	ctx.strokeStyle = css('--accent');
	ctx.fillStyle = css('--accent');
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
	ctx.stroke();
	if (len > 0) {
		const [ux, uy] = [d.x / len, d.y / len];
		ctx.beginPath();
		ctx.moveTo(p.x, p.y);
		ctx.lineTo(tx, ty);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(tx, ty);
		ctx.lineTo(tx - 9 * ux + 5 * uy, ty - 9 * uy - 5 * ux);
		ctx.lineTo(tx - 9 * ux - 5 * uy, ty - 9 * uy + 5 * ux);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
	e.drawHandles();
	$('curve-info').textContent =
		`curvePoint(curve, ${t}) = { x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)} }; ` +
		`curveTangent(curve, ${t}) = { x: ${d.x.toFixed(1)}, y: ${d.y.toFixed(1)} } (speed ${len.toFixed(1)}, drawn at a third). ` +
		'Green: t = 0, 0.05 … 1, crowding where the curve is slow.';
});
bind(curveForm, () => curveEditor.redraw());

// ---------- offsetCurve ----------
const offsetForm = $<HTMLFormElement>('offset-form');
const offsetEditor = new PathEditor(view($('offset'), W, H), PRESETS.hook, e => {
	const distance = Number(value(offsetForm, 'distance'));
	const tolerance = Number(value(offsetForm, 'tolerance'));
	showTolerance(offsetForm, tolerance, 0.25);
	const c = e.commands.find(c => c.type === 'cubicTo');
	const start = e.commands[0];
	if (!c || start.type !== 'moveTo') return;
	const curve = [
		{ x: start.x, y: start.y },
		{ x: c.c1x, y: c.c1y },
		{ x: c.c2x, y: c.c2y },
		{ x: c.x, y: c.y },
	] as [Point, Point, Point, Point];
	const { ctx } = e.v;
	strokePath(e.v, e.commands, css('--input'), 1.5);
	// The segments, in alternating colors, joined at the dots.
	const segs = offsetCurve(curve, distance, { tolerance });
	segs.forEach((s, i) => {
		const [a, b, cc, d] =
			s.type === 'cubic' ? [s.p0, s.p1, s.p2, s.p3] : [s.p0, s.p0, s.p0, s.p0];
		strokePath(
			e.v,
			[
				{ type: 'moveTo', x: a.x, y: a.y },
				{ type: 'cubicTo', c1x: b.x, c1y: b.y, c2x: cc.x, c2y: cc.y, x: d.x, y: d.y },
			],
			i % 2 ? css('--accent') : css('--good'),
			2.5,
		);
		ctx.fillStyle = css('--fg');
		ctx.beginPath();
		ctx.arc(d.x, d.y, 3, 0, 2 * Math.PI);
		ctx.fill();
	});
	// The exact offset on top, dashed; and whether it folds: where d times the
	// curvature passes 1, it turns back on itself.
	let folds = false;
	ctx.save();
	ctx.strokeStyle = css('--fg');
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 3]);
	ctx.beginPath();
	let started = false;
	for (let i = 0; i <= 800; i++) {
		const t = i / 800;
		const p = curvePoint(curve, t);
		const d = curveTangent(curve, t);
		const len = Math.hypot(d.x, d.y);
		if (!(len > 0)) continue;
		const d2 = curveTangent(curve, Math.min(1, t + 1e-6));
		const turn = (d.x * (d2.y - d.y) - d.y * (d2.x - d.x)) / 1e-6 / len ** 3;
		if (distance * turn > 1) folds = true;
		const q = { x: p.x - (distance * d.y) / len, y: p.y + (distance * d.x) / len };
		if (started) ctx.lineTo(q.x, q.y);
		else ctx.moveTo(q.x, q.y);
		started = true;
	}
	ctx.stroke();
	ctx.restore();
	e.drawHandles();
	const options = tolerance === 0.25 ? '' : `, { tolerance: ${tolerance} }`;
	$('offset-info').textContent =
		`offsetCurve(curve, ${distance}${options}): ${segs.length} cubic${segs.length === 1 ? '' : 's'} ` +
		'(alternating colors, joined at the dots), within the tolerance of the exact offset (dashed).' +
		(folds
			? ' Here the distance exceeds the radius of curvature: the exact offset turns back on itself at a cusp, and the segments follow it.'
			: '');
});
bind(offsetForm, () => offsetEditor.redraw());
