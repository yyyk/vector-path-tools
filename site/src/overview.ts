import {
	bounds,
	contains,
	flatten,
	toQuadratics,
	type ContainsMethod,
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
