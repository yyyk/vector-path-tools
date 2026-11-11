// Generates svg-arc.json: svg-arc-to-cubic-bezier's own output on random arcs,
// the reference the port in src/svg-arc-to-cubic-bezier must match bit for bit.
//   node test/fixtures/generate-svg-arc.mjs /path/to/svg-arc-to-cubic-bezier > test/fixtures/svg-arc.json
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { default: arcToBezier } = await import(
	pathToFileURL(resolve(process.argv[2], 'src/index.js')).href
);

// xorshift-style generator, so the cases are the same on every run.
let s = 7n;
const next = () => {
	s ^= s << 13n;
	s &= (1n << 64n) - 1n;
	s ^= s >> 7n;
	s ^= s << 17n;
	s &= (1n << 64n) - 1n;
	return Number(s >> 11n) / 2 ** 53;
};
const r = (a, b) => a + (b - a) * next();

const cases = [];
for (let i = 0; i < 500; i++) {
	const arc = {
		px: r(-100, 100),
		py: r(-100, 100),
		cx: r(-100, 100),
		cy: r(-100, 100),
		rx: i % 7 === 0 ? r(0, 5) : r(-120, 120), // small radii get scaled up; negative ones made positive
		ry: i % 11 === 0 ? 0 : r(-120, 120),
		xAxisRotation: [0, 30, 90, -45, r(-360, 360)][i % 5],
		largeArcFlag: i % 2,
		sweepFlag: (i >> 1) % 2,
	};
	if (i % 13 === 0) [arc.cx, arc.cy] = [arc.px, arc.py]; // identical end points
	if (i % 17 === 0) [arc.rx, arc.ry, arc.cx, arc.cy] = [50, 50, arc.px + 100, arc.py]; // half circle
	cases.push({ arc, out: arcToBezier(arc) });
}
console.log(JSON.stringify(cases));
