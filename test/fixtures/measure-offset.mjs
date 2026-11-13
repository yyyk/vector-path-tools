// Measures the offset code (src/stroke-outline/offset.ts) and kurbo's
// offset_cubic (offset-kurbo.json) against the true offset B(t) + d·N(t), on
// the curves in offset-inputs.txt. The error is the largest gap between the
// offset pieces and the true offset, both ways (from each to the nearest point
// of the other), as a fraction of the curve's size. Where d·curvature exceeds
// 1 somewhere, the true offset folds into a cusp or loop: those are counted as
// their own group; so is the cusp, where the true offset jumps across. Run after `npm run build`:
//   node test/fixtures/measure-offset.mjs
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const so = await import(new URL('../../dist/stroke-outline/offset.js', here));
const ec = await import(new URL('../../dist/offset.js', here));
const kurbo = JSON.parse(readFileSync(new URL('offset-kurbo.json', here), 'utf8'));
const SCALES = [0.01, 1, 100, 10000];
const PER_SCALE = kurbo.length / SCALES.length;

const pt = (x, y) => ({ x, y });
// A Bézier of any degree, its point and derivative at t (de Casteljau).
function evalBez(p, t) {
	let q = p;
	while (q.length > 2)
		q = q
			.slice(1)
			.map((b, i) => pt(q[i].x + (b.x - q[i].x) * t, q[i].y + (b.y - q[i].y) * t));
	const n = p.length - 1;
	return {
		x: q[0].x + (q[1].x - q[0].x) * t,
		y: q[0].y + (q[1].y - q[0].y) * t,
		dx: n * (q[1].x - q[0].x),
		dy: n * (q[1].y - q[0].y),
	};
}
const deriv = p =>
	p
		.slice(1)
		.map((b, i) => pt((b.x - p[i].x) * (p.length - 1), (b.y - p[i].y) * (p.length - 1)));

// The true offset at t, and d times the signed curvature there.
function trueOffset(p, d, t) {
	const e = evalBez(p, t);
	let s = Math.hypot(e.dx, e.dy);
	let tx = e.dx / s;
	let ty = e.dy / s;
	if (!(s > 0)) {
		// Zero speed: the direction of the next nonzero derivative.
		const e2 = evalBez(deriv(p), t);
		s = Math.hypot(e2.dx, e2.dy);
		tx = e2.dx / s;
		ty = e2.dy / s;
	}
	const dd = evalBez(deriv(p), t);
	const speed = Math.hypot(e.dx, e.dy);
	const dk = (d * (e.dx * dd.dy - e.dy * dd.dx)) / speed ** 3;
	return { x: e.x - d * ty, y: e.y + d * tx, dk };
}

// Distance from q to the curve f(t), t in [a, b]: dense samples, then golden
// section around each local minimum of them.
function distTo(f, q, n = 64, a = 0, b = 1) {
	const D = t => {
		const r = f(t);
		return Math.hypot(r.x - q.x, r.y - q.y);
	};
	const ds = Array.from({ length: n + 1 }, (_, i) => D(a + ((b - a) * i) / n));
	let best = Math.min(...ds);
	const g = (Math.sqrt(5) - 1) / 2;
	for (let i = 0; i <= n; i++) {
		if ((i > 0 && ds[i - 1] < ds[i]) || (i < n && ds[i + 1] < ds[i])) continue;
		let lo = a + ((b - a) * Math.max(0, i - 1)) / n;
		let hi = a + ((b - a) * Math.min(n, i + 1)) / n;
		for (let k = 0; k < 60; k++) {
			const m1 = hi - g * (hi - lo);
			const m2 = lo + g * (hi - lo);
			if (D(m1) < D(m2)) hi = m2;
			else lo = m1;
		}
		best = Math.min(best, D((lo + hi) / 2));
	}
	return best;
}

// Two-way gap between the pieces and the true offset of p by d.
function gap(p, d, pieces) {
	const T = t => trueOffset(p, d, t);
	let worst = 0;
	for (const c of pieces)
		for (let i = 0; i <= 16; i++)
			worst = Math.max(worst, distTo(T, evalBez(c, i / 16), 256));
	for (let i = 0; i <= 256; i++) {
		const q = T(i / 256);
		let best = Infinity;
		for (const c of pieces)
			best = Math.min(
				best,
				distTo(t => evalBez(c, t), q, 16),
			);
		worst = Math.max(worst, best);
	}
	return worst;
}

const toPieces = arr =>
	arr.map(v => [pt(v[0], v[1]), pt(v[2], v[3]), pt(v[4], v[5]), pt(v[6], v[7])]);
const rows = kurbo.map((k, i) => {
	const [name, kind, ...v] = k.curve.split(' ');
	const nums = v.map(Number);
	const d = nums.pop();
	const p = [];
	for (let j = 0; j < nums.length; j += 2) p.push(pt(nums[j], nums[j + 1]));
	const xs = p.map(q => q.x);
	const ys = p.map(q => q.y);
	const size = Math.hypot(
		Math.max(...xs) - Math.min(...xs),
		Math.max(...ys) - Math.min(...ys),
	);
	let folds = false;
	for (let j = 0; j <= 1000; j++) if (trueOffset(p, d, j / 1000).dk > 1) folds = true;
	const port =
		kind === 'q' ? so.offsetQuadraticBezier(...p, d) : so.offsetCubicBezier(...p, d);
	const own = tol =>
		ec
			.offsetCurve(p, d, { tolerance: tol * size })
			.map(c => (c.type === 'quad' ? [c.p0, c.p1, c.p2] : [c.p0, c.p1, c.p2, c.p3]));
	const sets = {
		port,
		own3: own(1e-3),
		own6: own(1e-6),
		coarse: toPieces(k.coarse),
		fine: toPieces(k.fine),
	};
	const r = {
		scale: SCALES[Math.floor(i / PER_SCALE)],
		group:
			name === 'cusp'
				? 'cusp'
				: folds
					? 'folds'
					: name === 'random'
						? `random ${kind}`
						: name,
	};
	for (const [key, pieces] of Object.entries(sets)) {
		r[key] = gap(p, d, pieces) / size;
		r[`${key}N`] = pieces.length;
	}
	return r;
});

const fmt = x => (x === 0 ? '0' : x.toExponential(1));
console.log('Worst gap to the true offset, as a fraction of the curve size, and the most');
console.log('pieces. port = src/stroke-outline/offset.ts; own3, own6 = src/offset.ts and');
console.log('kurbo offset_cubic (coarse, fine) at a tolerance of 1e-3 and 1e-6 of the size.\n');
const groups = [...new Set(rows.map(r => r.group))].sort(
	(a, b) =>
		(a === 'folds') - (b === 'folds') ||
		(a === 'cusp') - (b === 'cusp') ||
		a.localeCompare(b),
);
console.log(
	'scale  group            cases  port     own3     own6     coarse   fine     | pieces: port own3 own6 coarse fine',
);
for (const scale of SCALES)
	for (const group of groups) {
		const r = rows.filter(x => x.scale === scale && x.group === group);
		if (!r.length) continue;
		const max = col => Math.max(...r.map(x => x[col]));
		const mean = col => (r.reduce((s, x) => s + x[col], 0) / r.length).toFixed(1);
		console.log(
			[
				String(scale).padEnd(6),
				group.padEnd(16),
				String(r.length).padEnd(6),
				...['port', 'own3', 'own6', 'coarse', 'fine'].map(c => fmt(max(c)).padEnd(8)),
				'|        ',
				...['portN', 'own3N', 'own6N', 'coarseN', 'fineN'].map(c =>
					`${max(c)} (${mean(c)})`.padEnd(10),
				),
			].join(' '),
		);
	}
