// Generates arclen-inputs.txt: the curves that the arc-length references
// (kurbo-gen's arclen, skia-gen's arclen) measure, one per line:
//   q x0 y0 x1 y1 x2 y2   or   c x0 y0 x1 y1 x2 y2 x3 y3
// Coordinates are 32-bit floats (Skia's precision), so every implementation
// reads exactly the same numbers.
//   node test/fixtures/generate-arclen-inputs.mjs > test/fixtures/arclen-inputs.txt

// xorshift-style generator, so the cases are the same on every run.
let s = 11n;
const next = () => {
	s ^= s << 13n;
	s &= (1n << 64n) - 1n;
	s ^= s >> 7n;
	s ^= s << 17n;
	s &= (1n << 64n) - 1n;
	return Number(s >> 11n) / 2 ** 53;
};
const r = () => next() * 2 - 1;

const special = [
	['c', [0, 0], [1, 1], [0, 1], [1, 0]], // near-cusp
	['c', [0, 0], [1, 1], [0, 1], [1, 0.0001]], // nearly a cusp
	['c', [0, 0], [2, 1], [-1, 1], [1, 0]], // a real cusp
	['c', [0, 0], [1.5, 1], [-0.5, 1], [1, 0]], // a tight loop
	['c', [0, 0], [0, 0], [1, 1], [1, 1]], // control points on the ends
	['q', [0, 0], [2, 0], [1, 0]], // folds back on a line
];
const lines = [];
for (const scale of [0.01, 1, 100, 10000]) {
	const out = (kind, pts) =>
		lines.push(
			[
				kind,
				...pts.flatMap(([x, y]) => [Math.fround(x * scale), Math.fround(y * scale)]),
			].join(' '),
		);
	for (const [kind, ...pts] of special) out(kind, pts);
	for (let i = 0; i < 60; i++) {
		const n = i % 2 ? 4 : 3;
		out(
			n === 4 ? 'c' : 'q',
			Array.from({ length: n }, () => [r(), r()]),
		);
	}
}
console.log(lines.join('\n'));
