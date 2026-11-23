#!/bin/sh
# Generates pathops-skia.json: Skia's PathOps (Op) on the cases in
# boolean-inputs.txt (see skia-gen/pathops.cpp), a reference for booleanOp.
# Uses the Skia build generate-skia.sh makes (without a path, the one in
# test/fixtures/.cache/skia), adding PathOps: its own target, which the core
# library doesn't include.
#   sh test/fixtures/generate-skia-pathops.sh [/path/to/skia] < test/fixtures/boolean-inputs.txt > test/fixtures/pathops-skia.json
set -e
here=$(cd "$(dirname "$0")" && pwd)
skia=$(cd "${1:-$here/.cache/skia}" && pwd)
out="$skia/out/vector-path-tools"
"$skia/third_party/ninja/ninja" -C "$out" skia pathops >&2
clang++ -std=c++20 -O2 -DNDEBUG -I"$skia" "$here/skia-gen/pathops.cpp" \
  "$out"/obj/src/pathops/*.o "$out/libskia.a" \
  -framework CoreFoundation -framework CoreGraphics -framework CoreText \
  -framework CoreServices -o "$out/skia-pathops"
"$out/skia-pathops"
