// Ported from Skia (https://skia.googlesource.com/skia), at commit
// 50ba8e6d82572c55b146d8c802fe1fc14d47ca1c: the cubic evaluation in the
// middle-out tessellation shader in
// src/gpu/ganesh/tessellate/GrPathTessellationShader.cpp, and
// PatchWriter::writeQuadPatch in src/gpu/tessellate/PatchWriter.h.
// Copyright 2021 Google LLC. Use of this source code is governed by a
// BSD-style license: see THIRD_PARTY_NOTICES.

import type { Point } from '../path.js';

/** The shader's mix(): x·(1 − a) + y·a. */
function mix(a: Point, b: Point, t: number): Point {
	return { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t };
}

/** PatchWriter::mix: (b - a)·T + a. */
function patchMix(a: Point, b: Point, t: number): Point {
	return { x: (b.x - a.x) * t + a.x, y: (b.y - a.y) * t + a.y };
}

export function evalCubic(p0: Point, p1: Point, p2: Point, p3: Point, T: number): Point {
	// Evaluate at T. Use De Casteljau's for its accuracy and stability.
	const ab = mix(p0, p1, T);
	const bc = mix(p1, p2, T);
	const cd = mix(p2, p3, T);
	const abc = mix(ab, bc, T);
	const bcd = mix(bc, cd, T);
	return mix(abc, bcd, T);
}

/** writeQuadPatch: the quadratic's three control points as an equivalent cubic. */
export function quadToCubic(p0: Point, p1: Point, p2: Point): [Point, Point, Point, Point] {
	return [p0, patchMix(p0, p1, 2 / 3), patchMix(p2, p1, 2 / 3), p2];
}
