// Generates path-bool.json: path-bool (npm 1.0.4, MIT) on the cases in
// boolean-inputs.txt, a second reference for booleanOp, one result per case in
// the same compact path data, to 9 significant digits (as Skia's results).
// path-bool returns its contours in open pieces (for nearly every case here);
// they are joined end to start into closed contours (within 1e-9 of the
// inputs' size), as the path-builder app does, so what is compared is
// path-bool plus that joining.
//   node test/fixtures/generate-path-bool.mjs < test/fixtures/boolean-inputs.txt > test/fixtures/path-bool.json
import { readFileSync } from 'node:fs';
import {
	FillRule,
	PathBoolean,
	PathBooleanOperation,
	pathFromCommands,
	pathToCommands,
} from 'path-bool';

const OPERATIONS = {
	union: PathBooleanOperation.Union,
	intersection: PathBooleanOperation.Intersection,
	difference: PathBooleanOperation.Difference,
	exclusion: PathBooleanOperation.Exclusion,
};
const ARITY = { M: 1, L: 1, Q: 2, C: 3, Z: 0 };

/** Compact path data to path-bool commands, and the coordinates seen. */
function parse(d, xs, ys) {
	const tokens = d.split(' ').filter(Boolean);
	const commands = [];
	for (let i = 0; i < tokens.length;) {
		const op = tokens[i++];
		const points = [];
		for (let k = 0; k < ARITY[op]; k++) {
			const p = [Number(tokens[i++]), Number(tokens[i++])];
			xs.push(p[0]);
			ys.push(p[1]);
			points.push(p);
		}
		commands.push([op, ...points]);
	}
	return commands;
}

/** Joins open chains that meet end to start into closed contours. */
function joinChains(chains, tolerance) {
	const open = [...chains];
	const result = [];
	while (open.length) {
		const chain = open.shift();
		for (;;) {
			const end = chain[chain.length - 1];
			if (end[0] === 'Z') break;
			const start = chain[0][1];
			const last = end[end.length - 1];
			if (
				chain.length > 1 &&
				Math.hypot(start[0] - last[0], start[1] - last[1]) <= tolerance
			) {
				chain[chain.length - 1] = [...end.slice(0, -1), start];
				chain.push(['Z']);
				break;
			}
			const k = open.findIndex(
				other =>
					Math.hypot(other[0][1][0] - last[0], other[0][1][1] - last[1]) <= tolerance,
			);
			if (k === -1) break;
			chain.push(...open.splice(k, 1)[0].slice(1));
		}
		result.push(chain);
	}
	return result;
}

const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
const out = lines.map(line => {
	const [head, a, b] = line.split('|');
	const [op, ruleA, ruleB] = head.split(' ');
	const rule = r => (r === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero);
	const xs = [];
	const ys = [];
	const inputs = [
		{ path: [...pathFromCommands(parse(a, xs, ys))], fillRule: rule(ruleA) },
		{ path: [...pathFromCommands(parse(b, xs, ys))], fillRule: rule(ruleB) },
	];
	const size = Math.hypot(
		Math.max(...xs) - Math.min(...xs),
		Math.max(...ys) - Math.min(...ys),
	);
	try {
		const chains = [];
		let chain = [];
		for (const path of new PathBoolean(inputs).get(OPERATIONS[op]))
			for (const cmd of pathToCommands(path)) {
				if (cmd[0] === 'M' && chain.length) (chains.push(chain), (chain = []));
				chain.push(cmd);
				if (cmd[0] === 'Z') (chains.push(chain), (chain = []));
			}
		if (chain.length) chains.push(chain);
		const d = joinChains(chains, size * 1e-9)
			.flat()
			.map(([c, ...points]) =>
				[c, ...points.flat().map(v => Number(v.toPrecision(9)))].join(' '),
			)
			.join(' ');
		return { ok: true, d };
	} catch (e) {
		return { ok: false, error: String(e.message ?? e) };
	}
});
console.log(`[${out.map(r => JSON.stringify(r)).join(',\n')}]`);
