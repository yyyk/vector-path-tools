# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (while the version is 0.x, minor
versions may change the API).

## [0.1.0] - unreleased

First release.

### Added

- `bounds(path)`: the exact bounding box of what a path draws. Curves count by
  their extremes, not their control points.
- `contains(path, x, y, options?)`: whether a point is inside the path's fill,
  under the nonzero or even-odd rule, by Skia's `SkPath::contains` (default) or
  fontTools' `PointInsidePen`.
- `flatten(path, tolerance?, options?)`: curves replaced by lines within
  `tolerance` (default 0.25), with two methods:
  - `'uniform'` (default): equal steps per curve, as many as Wang's formula
    needs, with points evaluated as in Skia's tessellation shader. A proven
    bound; the fastest.
  - `'adaptive'`: kurbo's `flatten` (Raph Levien's method), lines spaced by how
    much the curve bends. About half the lines on cubics; not guaranteed to
    stay within the tolerance on cubics.
- `toQuadratics(path, tolerance?, options?)`: cubics replaced by quadratics within
  `tolerance` (default 1 for fontTools, 0.5 for Colomitchi's methods, required
  for kurbo), by kurbo's `to_quads` (default), fontTools' cu2qu, or one of
  Adrian Colomitchi's three methods (with optional inflection detection),
  ported from his bezier-utils with three bugs fixed. `ApproxNotFoundError` when
  fontTools' method needs more than 100 quadratics.
- `arcTo(x0, y0, rx, ry, xAxisRotation, largeArc, sweep, x, y)`: an SVG arc as
  cubic commands, ported from svg-arc-to-cubic-bezier.
- `measure(path, options?)`: a path's length (and each subpath's), and points
  with directions at a distance or a fraction of it, accurate to 1e-10 of each
  curve's length at any scale.
- `pointsAlong(path, spacing, options?)`: evenly spaced points with directions
  along each subpath, as for p5's `textToPoints`.
- `curvePoint(curve, t)` and `curveTangent(curve, t)`: a curve's point and
  derivative at its parameter `t`, for lines, quadratics and cubics.
- `offsetCurve(curve, distance, options?)`: a curve's offset (parallel) curve,
  as segments of the same kind within `options.tolerance` (default 0.25) of the
  exact offset, split where the offset folds into a cusp. stroke-outline's curve
  offsetting, based on bezierjs.
- `segments(path)`: the drawn pieces of a path, each with its start point, and
  `close` as its closing line.
- Path commands in the same format as stroke-outline's, so its outlines can be
  passed in directly. Invalid input (no leading `moveTo`, unknown commands, NaN or
  infinite coordinates) is a `TypeError`.

[0.1.0]: https://github.com/yyyk/vector-path-tools/releases/tag/v0.1.0
