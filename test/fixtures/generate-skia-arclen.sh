#!/bin/sh
# Generates arclen-skia.json: Skia's SkContourMeasure on the curves in
# arclen-inputs.txt (see skia-gen/arclen.cpp), for measuring
# src/stroke-outline/arc-length.ts. Uses the Skia build generate-skia.sh makes
# (without a path, the one in test/fixtures/.cache/skia).
#   sh test/fixtures/generate-skia-arclen.sh [/path/to/skia] < test/fixtures/arclen-inputs.txt > test/fixtures/arclen-skia.json
set -e
here=$(cd "$(dirname "$0")" && pwd)
skia=$(cd "${1:-$here/.cache/skia}" && pwd)
out="$skia/out/vector-path-tools"
"$skia/third_party/ninja/ninja" -C "$out" skia >&2
clang++ -std=c++20 -O2 -DNDEBUG -I"$skia" "$here/skia-gen/arclen.cpp" "$out/libskia.a" \
  -framework CoreFoundation -framework CoreGraphics -framework CoreText \
  -framework CoreServices -o "$out/skia-arclen"
"$out/skia-arclen"
