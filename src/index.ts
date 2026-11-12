// vector-path-tools: geometry for vector paths made of lines and quadratic and
// cubic Bézier curves. Every function takes path commands in absolute
// coordinates.
export type { PathCommand, Point, Segment } from './path.js';
export { segments } from './path.js';
export { arcTo } from './arc.js';
export { curvePoint, curveTangent, type Curve } from './curve.js';
export {
	measure,
	pointsAlong,
	type MeasureOptions,
	type PathMeasure,
	type PathPoint,
} from './measure.js';
export { bounds, type Bounds } from './bounds.js';
export {
	contains,
	type ContainsMethod,
	type ContainsOptions,
	type FillRule,
} from './contains.js';
export { flatten, type FlattenMethod, type FlattenOptions } from './flatten.js';
export {
	toQuadratics,
	type ToQuadraticsMethod,
	type ToQuadraticsOptions,
} from './to-quadratics.js';
export { ApproxNotFoundError } from './fonttools/cu2qu.js';
