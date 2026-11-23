// Generates boolean-inputs.txt: the cases that the boolean-operation references
// (skia-gen's pathops, generate-path-bool.mjs) run, one per line:
//   operation fillRuleA fillRuleB|path A|path B
// where the operation is union, intersection, difference or exclusion, and a
// path is compact path data: M x y, L x y, Q cx cy x y, C c1x c1y c2x c2y x y, Z.
// Every pair of shapes is run with all four operations. The pairs are built
// shapes for the cases in docs/remove-overlaps.md's robustness table (shared
// and partly shared edges, touching corners, containment, holes, tangent
// curves, …), some of them scaled or far from the origin, and seeded random
// pairs: curves crossing themselves and each other, and polygons on a coarse
// grid, which share edges and vertices. Coordinates are multiples of 1/1024,
// which 32-bit floats (Skia) hold exactly.
//   node test/fixtures/generate-boolean-inputs.mjs > test/fixtures/boolean-inputs.txt

const OPERATIONS = ['union', 'intersection', 'difference', 'exclusion'];
const q = v => Math.round(v * 1024) / 1024;

// ---------- built shapes, as lists of [command, ...coordinates] ----------

const poly = (...ps) => [['M', ...ps[0]], ...ps.slice(1).map(p => ['L', ...p]), ['Z']];
const rect = (x, y, w, h) => poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const rectBack = (x, y, w, h) => poly([x, y], [x, y + h], [x + w, y + h], [x + w, y]);
/** A circle of four cubics; `back` runs it the other way. */
function circle(cx, cy, r, back = false) {
	const k = r * 0.5522847498;
	const c = [
		['M', cx + r, cy],
		['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
		['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
		['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
		['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
		['Z'],
	];
	if (!back) return c;
	const pts = [[cx + r, cy]];
	for (const s of c.slice(1, 5)) pts.push([s[1], s[2]], [s[3], s[4]], [s[5], s[6]]);
	pts.reverse();
	const out = [['M', ...pts[0]]];
	for (let i = 1; i < pts.length; i += 3)
		out.push(['C', ...pts[i], ...pts[i + 1], ...pts[i + 2]]);
	return [...out, ['Z']];
}
const star = (cx, cy, r) =>
	poly(
		...[0, 2, 4, 1, 3].map(i => [
			cx + r * Math.sin((i * 2 * Math.PI) / 5),
			cy - r * Math.cos((i * 2 * Math.PI) / 5),
		]),
	);
/** An arch: a cubic up from (x, y) and back down, closed by its base. */
const arch = (x, y, w, h) => [
	['M', x, y],
	['C', x, y - (h * 4) / 3, x + w, y - (h * 4) / 3, x + w, y],
	['Z'],
];

const shapes = [
	['overlapping squares', rect(0, 0, 100, 100), rect(50, 50, 100, 100)],
	['squares, B wound the other way', rect(0, 0, 100, 100), rectBack(50, 50, 100, 100)],
	['circle and square', circle(50, 50, 40), rect(50, 0, 100, 100)],
	['overlapping circles', circle(0, 0, 50), circle(60, 0, 50)],
	['circles, B the other way', circle(0, 0, 50), circle(60, 0, 50, true)],
	['B inside A', rect(0, 0, 100, 100), circle(50, 50, 20)],
	['A inside B', circle(50, 50, 20), rect(0, 0, 100, 100)],
	['disjoint', rect(0, 0, 10, 10), rect(20, 0, 10, 10)],
	['identical squares', rect(0, 0, 100, 100), rect(0, 0, 100, 100)],
	['identical circles', circle(0, 0, 50), circle(0, 0, 50)],
	['identical, opposite ways', circle(0, 0, 50), circle(0, 0, 50, true)],
	['shared edge', rect(0, 0, 100, 100), rect(100, 0, 100, 100)],
	['shared edge, opposite ways', rect(0, 0, 100, 100), rectBack(100, 0, 100, 100)],
	['partly shared edge', rect(0, 0, 100, 100), rect(100, 25, 100, 50)],
	['edge shared from inside (notch)', rect(0, 0, 100, 100), rect(25, 0, 50, 30)],
	['crossbar flush with a stem', rect(0, 0, 20, 100), rect(20, 45, 60, 10)],
	['corners touching', rect(0, 0, 10, 10), rect(10, 10, 10, 10)],
	['vertex on an edge', rect(0, 0, 100, 100), poly([50, 100], [100, 150], [0, 150])],
	[
		'ring and a circle across its hole',
		[...rect(0, 0, 100, 100), ...rectBack(25, 25, 50, 50)],
		circle(50, 50, 30),
	],
	[
		'two rings',
		[...circle(0, 0, 50), ...circle(0, 0, 30, true)],
		[...circle(40, 0, 50), ...circle(40, 0, 30, true)],
	],
	['star crossing itself, and a square', star(50, 50, 50), rect(30, 30, 40, 40)],
	['two stars', star(50, 50, 50), star(70, 50, 50)],
	['circles touching inside', circle(0, 0, 50), circle(20, 0, 30)],
	['circles touching outside', circle(0, 0, 50), circle(80, 0, 30)],
	['arches touching at their tops', arch(0, 75, 100, 75), arch(25, 75, 50, 50)],
	['curve along a line', arch(0, 50, 100, 50), rect(0, 50, 100, 20)],
	[
		'ring with its hole wound the same way, under evenodd',
		[...rect(0, 0, 100, 100), ...rect(25, 25, 50, 50)],
		circle(50, 50, 30),
		'evenodd',
	],
];

// The same pairs at other scales and far from the origin.
const transform = (path, s, o) => path.map(([c, ...v]) => [c, ...v.map(x => x * s + o)]);
for (const [name, a, b] of shapes.slice(0, 18))
	for (const [s, o] of [
		[0.01, 0],
		[1000, 0],
		[1, 1e5],
	])
		shapes.push([`${name} at ${s}, ${o}`, transform(a, s, o), transform(b, s, o)]);

const format = path => path.map(([c, ...v]) => [c, ...v.map(q)].join(' ')).join(' ');

// ---------- random pairs ----------

// xorshift-style generator, so the cases are the same on every run.
let s = 23n;
const next = () => {
	s ^= s << 13n;
	s &= (1n << 64n) - 1n;
	s ^= s >> 7n;
	s ^= s << 17n;
	s &= (1n << 64n) - 1n;
	return Number(s >> 11n) / 2 ** 53;
};
const coordinate = () => Math.round(next() * 100 * 64) / 64;
const grid = () => Math.round(next() * 10) * 10;

function randomPath(curves) {
	const d = [];
	const c = curves ? coordinate : grid;
	for (let sub = 0; sub < 1 + Math.floor(next() * 2); sub++) {
		d.push('M', c(), c());
		for (let k = 0; k < 3 + Math.floor(next() * 3); k++) {
			const kind = curves ? Math.floor(next() * 3) : 0;
			if (kind === 0) d.push('L', c(), c());
			else if (kind === 1) d.push('Q', c(), c(), c(), c());
			else d.push('C', c(), c(), c(), c(), c(), c());
		}
		d.push('Z');
	}
	return d.join(' ');
}

const lines = [];
const rules = ['nonzero', 'evenodd'];
for (const [, a, b, ruleA = 'nonzero'] of shapes) {
	const [da, db] = [format(a), format(b)];
	for (const op of OPERATIONS) lines.push(`${op} ${ruleA} nonzero|${da}|${db}`);
}
for (let n = 0; n < 120; n++) {
	const curves = n % 4 !== 0;
	const a = randomPath(curves);
	const b = randomPath(curves);
	const ruleA = rules[n % 2];
	const ruleB = rules[Math.floor(n / 2) % 2];
	for (const op of OPERATIONS) lines.push(`${op} ${ruleA} ${ruleB}|${a}|${b}`);
}
console.log(lines.join('\n'));
