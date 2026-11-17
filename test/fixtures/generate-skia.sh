#!/bin/sh
# Generates skia.json: Skia's SkPath::contains and Wang's formula on random
# inputs (see skia-gen/main.cpp), for comparing with the ports in src/skia.
# Expects a Skia checkout with its dependencies synced (python3
# tools/git-sync-deps, python3 bin/fetch-ninja); builds into its out/ folder.
# Without a path, clones Skia at commit 50ba8e6d82572c55b146d8c802fe1fc14d47ca1c
# into test/fixtures/.cache/skia and syncs its dependencies.
#   sh test/fixtures/generate-skia.sh [/path/to/skia] > test/fixtures/skia.json
set -e
here=$(cd "$(dirname "$0")" && pwd)
if [ -n "$1" ]; then
  skia=$(cd "$1" && pwd)
else
  . "$here/checkout.sh"
  skia=$(checkout skia https://skia.googlesource.com/skia.git 50ba8e6d82572c55b146d8c802fe1fc14d47ca1c)
  [ -x "$skia/third_party/ninja/ninja" ] ||
    (cd "$skia" && GIT_SYNC_DEPS_SKIP_EMSDK=1 python3 tools/git-sync-deps && python3 bin/fetch-ninja) >&2
fi
out="$skia/out/vector-path-tools"

# Only the core library: no GPU backends, PDF, fonts' shaping or ICU.
"$skia/bin/gn" gen "$out" --root="$skia" --args='is_debug=false is_official_build=false
  skia_use_gl=false skia_use_metal=false skia_enable_ganesh=false skia_enable_graphite=false
  skia_enable_pdf=false skia_use_icu=false skia_use_harfbuzz=false skia_enable_skshaper=false
  skia_enable_skparagraph=false skia_enable_svg=false skia_enable_skottie=false' >&2
"$skia/third_party/ninja/ninja" -C "$out" skia >&2

clang++ -std=c++20 -O2 -DNDEBUG -I"$skia" "$here/skia-gen/main.cpp" "$out/libskia.a" \
  -framework CoreFoundation -framework CoreGraphics -framework CoreText \
  -framework CoreServices -o "$out/skia-gen"
"$out/skia-gen"
