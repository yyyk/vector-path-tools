// Measures the arc-length code against kurbo (arclen-kurbo.json, close to
// exact) and compares Skia (arclen-skia.json), on the curves in
// arclen-inputs.txt. Prints the worst relative error per scale and kind of
// curve, and the time each length method takes. Run after `npm run build`:
//   node test/fixtures/measure-arclen.mjs
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, here), 'utf8'));
const so = await import(new URL('../../dist/stroke-outline/arc-length.js', here));
const ec = await import(new URL('../../dist/arc-length.js', here));
const kurbo = read('arclen-kurbo.json');
const skia = read('arclen-skia.json');

// arclen-inputs.txt: per scale, 6 hard cases, then 60 random curves.
const SPECIAL = [
	'near-cusp',
	'nearly a cusp',
	'real cusp',
	'tight loop',
	'ends doubled',
	'quad folds back',
];
const SCALES = [0.01, 1, 100, 10000];
const PER_SCALE = SPECIAL.length + 60;

const curves = kurbo.map(k => {
	const [kind, ...v] = k.curve.split(' ');
	const p = [];
	for (let j = 0; j < v.length; j += 2) p.push({ x: +v[j], y: +v[j + 1] });
	return { cubic: kind === 'c', p };
});

const methods = {
	fixed: c => (c.cubic ? so.arcLengthCubic(...c.p) : so.arcLengthQuadratic(...c.p)),
	adaptive: c => (c.cubic ? ec.cubicLength(...c.p) : ec.quadraticLength(...c.p)),
	table: c =>
		(c.cubic
			? so.ArcLengthLUT.fromCubic(...c.p, 100)
			: so.ArcLengthLUT.fromQuadratic(...c.p, 100)
		).totalLength,
};

// The points at 10%..90% by the error-controlled length and its pieces
// (measured once per curve, then queried).
function piecePoints(c) {
	const m = c.cubic ? ec.cubicMeasure(...c.p) : ec.quadraticMeasure(...c.p);
	return Array.from({ length: 9 }, (_, j) => {
		const t = m.tAtLength((m.length * (j + 1)) / 10);
		return c.cubic ? so.cubicBezier(...c.p, t) : so.quadraticBezier(...c.p, t);
	});
}

// The points at 10%..90% by the dash table.
function tablePoints(c) {
	const lut = c.cubic
		? so.ArcLengthLUT.fromCubic(...c.p, 100)
		: so.ArcLengthLUT.fromQuadratic(...c.p, 100);
	return Array.from({ length: 9 }, (_, j) => {
		const t = lut.tAtDistance((lut.totalLength * (j + 1)) / 10);
		return c.cubic ? so.cubicBezier(...c.p, t) : so.quadraticBezier(...c.p, t);
	});
}

const rows = curves.map((c, i) => {
	const k = kurbo[i];
	const L = k.length;
	const rel = x => Math.abs(x - L) / L;
	const lut = c.cubic
		? so.ArcLengthLUT.fromCubic(...c.p, 100)
		: so.ArcLengthLUT.fromQuadratic(...c.p, 100);
	const at = t => (c.cubic ? so.cubicBezier(...c.p, t) : so.quadraticBezier(...c.p, t));
	const posErr = pts =>
		Math.max(...pts.map((q, j) => Math.hypot(q.x - k.points[j][0], q.y - k.points[j][1]))) /
		L;
	const idx = i % PER_SCALE;
	return {
		scale: SCALES[Math.floor(i / PER_SCALE)],
		group: idx < SPECIAL.length ? SPECIAL[idx] : 'random',
		fixed: rel(methods.fixed(c)),
		adaptive: rel(methods.adaptive(c)),
		table: rel(lut.totalLength),
		skia: rel(skia[i].length),
		tablePos: posErr(
			Array.from({ length: 9 }, (_, j) =>
				at(lut.tAtDistance((lut.totalLength * (j + 1)) / 10)),
			),
		),
		piecesPos: posErr(piecePoints(c)),
		skiaPos: posErr(skia[i].points.map(([x, y]) => ({ x, y }))),
	};
});

const fmt = x => (x === 0 ? '0' : x.toExponential(1));
const COLUMNS = ['fixed', 'adaptive', 'table', 'skia', 'tablePos', 'piecesPos', 'skiaPos'];
console.log('Worst relative error against kurbo.');
console.log(
	'  length: fixed = 24-point Gauss (bezierjs / stroke-outline), adaptive = with error',
);
console.log(
	'          control (src/arc-length.ts), table = dash table, skia = SkContourMeasure',
);
console.log('  point at 10%..90% of the length, as a fraction of it: tablePos = dash table,');
console.log(
	"  piecesPos = the error-controlled length's pieces (src/arc-length.ts), skiaPos\n",
);
console.log(['scale ', 'group          ', ...COLUMNS.map(c => c.padEnd(9))].join(' '));
for (const scale of SCALES)
	for (const group of ['random', ...SPECIAL]) {
		const r = rows.filter(x => x.scale === scale && x.group === group);
		console.log(
			[
				String(scale).padEnd(6),
				group.padEnd(15),
				...COLUMNS.map(col => fmt(Math.max(...r.map(x => x[col]))).padEnd(9)),
			].join(' '),
		);
	}

console.log('\nTime per curve (all 264, repeated):');
const timed = {
	...methods,
	'9 points by table': tablePoints,
	'9 points by pieces': piecePoints,
};
for (const [name, fn] of Object.entries(timed)) {
	for (const c of curves) fn(c); // warm up
	const reps = 50;
	const start = performance.now();
	for (let r = 0; r < reps; r++) for (const c of curves) fn(c);
	const us = ((performance.now() - start) * 1000) / (reps * curves.length);
	console.log(`  ${name.padEnd(19)} ${us.toFixed(1)} µs`);
}
