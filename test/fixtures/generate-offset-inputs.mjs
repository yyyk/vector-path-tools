// Generates offset-inputs.txt: the curves and offset distances that the offset
// references (kurbo-gen's offset) and test/fixtures/measure-offset.mjs use,
// one per line:
//   name q x0 y0 x1 y1 x2 y2 d   or   name c x0 y0 x1 y1 x2 y2 x3 y3 d
// d is a fraction of the curve's size (its control points' bounding-box
// diagonal), on both sides.
//   node test/fixtures/generate-offset-inputs.mjs > test/fixtures/offset-inputs.txt

// xorshift-style generator, so the cases are the same on every run.
let s = 13n;
const next = () => {
	s ^= s << 13n;
	s &= (1n << 64n) - 1n;
	s ^= s >> 7n;
	s ^= s << 17n;
	s &= (1n << 64n) - 1n;
	return Number(s >> 11n) / 2 ** 53;
};
const r = () => next() * 2 - 1;

const K = 0.5522847498;
const special = [
	['arch', 'c', [0, 0], [0, 1], [1, 1], [1, 0]],
	['S-curve', 'c', [0, 0], [1, 0], [0, 1], [1, 1]],
	['cusp', 'c', [0, 0], [1, 1], [0, 1], [1, 0]],
	['tight-loop', 'c', [0, 0], [1.5, 1], [-0.5, 1], [1, 0]],
	['quarter-circle', 'c', [1, 0], [1, K], [K, 1], [0, 1]],
	['quadratic-arch', 'q', [0, 0], [0.5, 1], [1, 0]],
];
const FRACTIONS = [-0.2, -0.05, 0.02, 0.1, 0.3];
const lines = [];
for (const scale of [0.01, 1, 100, 10000]) {
	const out = (name, kind, pts) => {
		const p = pts.map(([x, y]) => [x * scale, y * scale]);
		const xs = p.map(q => q[0]);
		const ys = p.map(q => q[1]);
		const size = Math.hypot(
			Math.max(...xs) - Math.min(...xs),
			Math.max(...ys) - Math.min(...ys),
		);
		for (const f of FRACTIONS) lines.push([name, kind, ...p.flat(), f * size].join(' '));
	};
	for (const [name, kind, ...pts] of special) out(name, kind, pts);
	for (let i = 0; i < 40; i++) {
		const n = i % 2 ? 4 : 3;
		out(
			'random',
			n === 4 ? 'c' : 'q',
			Array.from({ length: n }, () => [r(), r()]),
		);
	}
}
console.log(lines.join('\n'));
