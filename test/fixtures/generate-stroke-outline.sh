#!/bin/sh
# Generates stroke-outline.json: stroke-outline's arc lengths, dash tables and
# curve offsets (see stroke-outline-gen/main.cpp), the reference the ports in
# src/stroke-outline/ must match bit for bit. Expects stroke-outline at commit
# 084fd2ca8eb0065951b240a917df5d8d2e616bfd (its arc length code is the same as
# at 16aa4a004971b38280c3dfd9b256724fcb85969e, which
# src/stroke-outline/arc-length.ts cites). Compiled with -ffp-contract=off, so
# that no multiply and add are fused, as in JavaScript.
#   sh test/fixtures/generate-stroke-outline.sh /path/to/stroke-outline > test/fixtures/stroke-outline.json
set -e
so=$(cd "$1" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# The library's sources, but the two that main.cpp includes.
srcs=$(cd "$so" && grep -E '^[[:space:]]+src/.*\.cpp' CMakeLists.txt | awk '{print $1}' |
  grep -v -e 'src/bezier/arc_length.cpp' -e 'src/stroke/dash.cpp')
set --
for s in $srcs; do set -- "$@" "$so/$s"; done
clang++ -std=c++20 -O2 -DNDEBUG -ffp-contract=off -I"$so/include" -I"$so/src" \
  "$here/stroke-outline-gen/main.cpp" "$@" -o "$work/gen"
"$work/gen"
