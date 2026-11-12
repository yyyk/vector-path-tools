# vector-path-tools

[![npm](https://img.shields.io/npm/v/vector-path-tools)](https://www.npmjs.com/package/vector-path-tools)
[![CI](https://github.com/yyyk/vector-path-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/yyyk/vector-path-tools/actions/workflows/ci.yml)

Geometry for vector paths made of lines and quadratic and cubic Bézier curves:
exact bounding boxes, hit testing, lengths and points along paths, flattening
curves into lines within a tolerance, converting cubics to quadratics, and SVG
arcs as cubics.

Pure TypeScript, no dependencies, no WebAssembly. Works in browsers, workers
and Node 20+.

**[Docs and demos](https://yyyk.github.io/vector-path-tools/)**

```sh
npm install vector-path-tools
```

```ts
import { arcTo, bounds, contains, flatten, toQuadratics } from 'vector-path-tools';

const path = [
  { type: 'moveTo', x: 0, y: 0 },
  { type: 'cubicTo', c1x: 0, c1y: 100, c2x: 100, c2y: 100, x: 100, y: 0 },
  { type: 'close' },
];

bounds(path); // { minX: 0, minY: 0, maxX: 100, maxY: 75 }: the curve, not its control points
contains(path, 50, 70); // true: inside the fill
flatten(path); // only moveTo / lineTo / close, every line within 0.25 of the curve
toQuadratics(path, 0.1); // the cubic as quadratics within 0.1

// an SVG arc as cubics, to put in a path
const halfCircle = [
  { type: 'moveTo', x: 0, y: 0 },
  ...arcTo(0, 0, 50, 50, 0, false, true, 100, 0),
];
```

## Paths

A path is an array (or any iterable) of commands in absolute coordinates:

```ts
type PathCommand =
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'quadTo'; cx: number; cy: number; x: number; y: number }
  | {
      type: 'cubicTo';
      c1x: number;
      c1y: number;
      c2x: number;
      c2y: number;
      x: number;
      y: number;
    }
  | { type: 'close' };
```

There is no arc command: `arcTo` turns an SVG arc into cubic commands to put in
the path. Every function returns a new array and leaves its input alone. Extra
properties on commands are ignored. Invalid input is a `TypeError`: a drawing command
before any `moveTo`, an unknown command type, or a NaN or infinite coordinate.

### With stroke-outline

This is the same format as [stroke-outline](https://www.npmjs.com/package/stroke-outline)'s
`commands`, so its outlines (and paths parsed from SVG) go straight in:

```ts
import { init } from 'stroke-outline';
import { flatten } from 'vector-path-tools';

const so = await init();
const outline = so.buildOutline('M 10 10 H 90 A 20 20 0 0 1 90 50', { lineWidth: 8 });
const polygon = flatten(outline.commands, 0.25); // ready for a triangulator
```

### With fonts

Glyph outlines are paths too. For example, with opentype.js, whose commands use
`M`, `L`, `Q`, `C`, `Z`:

```ts
function fromOpenType(c) {
  switch (c.type) {
    case 'M':
      return { type: 'moveTo', x: c.x, y: c.y };
    case 'L':
      return { type: 'lineTo', x: c.x, y: c.y };
    case 'Q':
      return { type: 'quadTo', cx: c.x1, cy: c.y1, x: c.x, y: c.y };
    case 'C':
      return {
        type: 'cubicTo',
        c1x: c.x1,
        c1y: c.y1,
        c2x: c.x2,
        c2y: c.y2,
        x: c.x,
        y: c.y,
      };
    default:
      return { type: 'close' };
  }
}

const commands = glyph.getPath(0, 0, 72).commands.map(fromOpenType);
bounds(commands);
```

## API

### `segments(path)`

The drawn pieces of a path as `{ type: 'line' | 'quad' | 'cubic', p0, p1, ... }`,
with each one's start point made explicit and `close` turned into its closing
line. For writing your own geometry on top.

### `curvePoint(curve, t)` and `curveTangent(curve, t)`

The point on one curve at its parameter `t` (0…1, clamped), and the curve's
derivative there: the direction it runs, with its speed as the length
(`Math.atan2(y, x)` is the angle). A `curve` is a segment from `segments()`, or
its control points: two for a line, three for a quadratic, four for a cubic.

```ts
curvePoint([p0, p1, p2, p3], 0.5); // { x, y }
curveTangent(segments(path)[0], 0); // { x, y }
```

They use the same evaluation as `measure`. Note that `t` is the curve's own
parameter, not a fraction of its length; equal steps in `t` aren't equal
distances along it (use `measure` for that).

### `measure(path, options?)`

Measures the path once, for its length and points along it:

```ts
const m = measure(path);
m.length; // the total length (a close line counts)
m.subpathLengths; // each subpath's length
m.pointAtLength(120); // { x, y, angle }: 120 along the path, angle in radians
m.pointAtFraction(0.5); // halfway
```

Lines are measured exactly; curves with a 24-point Gauss–Legendre quadrature
(from stroke-outline, based on bezierjs), split where needed until within
`options.tolerance` of the curve's length (default 1e-10). Points at a distance
are solved within the same tolerance, so the results don't depend on the
coordinate units: against kurbo's, lengths and points agree within 1e-9 at
every scale. Subpaths continue one into the next (the jump at a `moveTo` counts
as 0), as SVG's `getPointAtLength` does; distances outside 0…length are clamped.
`pointAtLength` is `null` if the path draws nothing.

### `pointsAlong(path, spacing, options?)`

Points about `spacing` apart along each subpath, with their directions, one
array per subpath, as p5's `textToPoints` does for glyphs. Each subpath's
spacing is adjusted slightly so its points are even and reach its end; a
closed subpath doesn't repeat its start.

### `bounds(path)`

The exact bounding box of what the path draws, `{ minX, minY, maxX, maxY }`, or
`null` if it draws nothing. Curves count by their extremes, not their control
points, and a `moveTo` with nothing drawn after it adds nothing.

### `contains(path, x, y, options?)`

Whether the point is inside the path's fill, exactly for curves too.
`options.fillRule` is `'nonzero'` (default) or `'evenodd'`, and decides how
overlapping and nested subpaths combine (holes, for example). `options.method`:

- `'skia'` (default): Skia's `SkPath::contains`. Every subpath counts as
  closed, as canvas and SVG fill them.
- `'fonttools'`: fontTools' `PointInsidePen`. Every subpath counts as closed.

Points exactly on the boundary: `'skia'` counts them as inside, as canvas's
`isPointInPath` does, which suits hit testing. `'fonttools'` counts some edges
in and the opposite ones out, so when shapes share an edge, each point on it
belongs to exactly one of them. `'skia'` also counts points within 1/4096 of
the curve (in path units) as on it, which shows at very small coordinate
scales; `'fonttools'` has no such tolerance.

### `toQuadratics(path, tolerance?, options?)`

The path with every cubic replaced by quadratics within `tolerance`. Lines and
quadratics are kept as they are. `options.method`:

- `'kurbo'` (default): kurbo's `CubicBez::to_quads`.
- `'fonttools'`: fontTools' cu2qu `curve_to_quadratic`, a smooth quadratic
  spline. Throws `ApproxNotFoundError` when 100 quadratics aren't enough.
- `'colomitchi-half'`, `'colomitchi-adaptive'`, `'colomitchi-symmetric'`:
  Adrian Colomitchi's half-splitting, simple adaptive division and symmetric
  adaptive division, ported from his bezier-utils Java code with three bugs fixed
  to match his article (see the notes in `src/caffeineowl/bezier-utils.ts`); the simple
  adaptive division is written from the article. `options.detectInflections`
  (default false) divides each cubic at its inflection points first.

`tolerance` defaults to what each original suggests: 1 for `'fonttools'` (0.001
em at 1000 units per em) and 0.5 for Colomitchi's methods (0.5 px at the least).
kurbo suggests no value, so it is required for `'kurbo'`.

### `flatten(path, tolerance?, options?)`

The path with every curve replaced by lines within `tolerance` of the curve
(for `'adaptive'`, see the table). `tolerance` is in path units: for drawing on
screen, about 0.25 pixels divided by the zoom. It defaults to 0.25, as both
originals suggest (Skia: 1/4 pixel; kurbo: 0.25 for antialiased rendering).
`moveTo`, `lineTo` and `close` are kept, and every curve's end point is kept
exactly.

`options.method` chooses where the lines go:

| Method                | How                                                                                                           | Within the tolerance                           | Lines on cubics | Time     |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------- | -------- |
| `'uniform'` (default) | Equal steps along each curve, as many as Wang's formula needs (Skia's `WangsFormula`)                         | Proven                                         | 100%            | 1×       |
| `'adaptive'`          | Lines spaced by how much the curve bends: kurbo's `flatten` (Raph Levien's method; cubics through quadratics) | Not guaranteed (measured up to 2.6× on cubics) | 52–54%          | 1.3–1.9× |

Measured on random cubics. `'uniform'` uses the segment count of Skia's stroke
tessellation and evaluates its points the way Skia's tessellation shader does.
kurbo spreads one line count over a cubic's quadratics, so on cubics
`'adaptive'` can go past the tolerance ("not absolutely guaranteed", in kurbo's
words); on quadratics it stays within about 6%.

### `arcTo(x0, y0, rx, ry, xAxisRotation, largeArc, sweep, x, y)`

An SVG elliptical arc (the `A` command) from (x0, y0) to (x, y) as path
commands, cubics from svg-arc-to-cubic-bezier, so paths with arcs can use
every function here. `xAxisRotation` is in degrees. As the SVG spec says,
identical end points give no commands and a zero radius gives a `lineTo`.

```ts
const path = [
  { type: 'moveTo', x: 0, y: 0 },
  ...arcTo(0, 0, 50, 50, 0, false, true, 100, 0), // a half circle
];
```

## Credits

- **Uniform flattening**: [Skia](https://skia.org) (BSD-3-Clause): Wang's
  formula (`WangsFormula.h`) and the curve evaluation of its tessellation
  shader.
- **Cubics to quadratics**: [kurbo](https://github.com/linebender/kurbo)
  (MIT), [fontTools](https://github.com/fonttools/fonttools) cu2qu
  (Apache-2.0), and Adrian Colomitchi's bezier-utils (MIT) and articles
  ["Approximating cubic Bezier curves by quadratic ones"](https://web.archive.org/web/20150403003715/http://www.caffeineowl.com/graphics/2d/vectorial/cubic2quad01.html)
  (2006) and
  ["Inflection points of a cubic Bezier"](https://web.archive.org/web/20150425075200/http://www.caffeineowl.com/graphics/2d/vectorial/cubic-inflexion.html)
  (2004).
- **Containment**: [Skia](https://skia.org) (BSD-3-Clause) and
  [fontTools](https://github.com/fonttools/fonttools) (MIT).
- **Lengths**: stroke-outline's arc length, based on
  [bezierjs](https://github.com/Pomax/bezierjs) (MIT), with error control and
  points at a distance added here.
- **Arcs**: [svg-arc-to-cubic-bezier](https://github.com/colinmeinke/svg-arc-to-cubic-bezier)
  (ISC).
- **Adaptive flattening**: [kurbo](https://github.com/linebender/kurbo) (MIT),
  based on Raph Levien,
  ["Flattening quadratic Béziers"](https://raphlinus.github.io/graphics/curves/2019/12/23/flatten-quadbez.html)
  (2019).

See THIRD_PARTY_NOTICES for the licenses.

## Development

```sh
npm install
npm test          # build and run the tests
npm run format    # Prettier
cd site && npm install && npm run dev   # docs site
```

The reference outputs in `test/fixtures` are generated from the
originals; each generator's header says how to run it (fontTools with Python,
kurbo with Rust, bezier-utils with Java, Skia with C++, svg-arc-to-cubic-bezier
with Node). `node test/fixtures/measure-arclen.mjs` (after `npm run build`)
measures the arc-length code against kurbo and Skia.

## License

[MIT](LICENSE)
