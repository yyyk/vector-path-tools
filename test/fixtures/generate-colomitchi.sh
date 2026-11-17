#!/bin/sh
# Generates colomitchi.json: Adrian Colomitchi's bezier-utils (BezierUtils.java,
# from bezier-utils-src.jar on caffeineowl.com) with the three fixes described in
# src/caffeineowl/bezier-utils.ts, the reference the port must match bit for bit.
# Without a path, uses colomitchi-gen/bezier-utils-src.zip (the jar's sources),
# extracted into test/fixtures/.cache/bezier-utils-src the first time.
#   sh test/fixtures/generate-colomitchi.sh [/path/to/extracted/bezier-utils-src] > test/fixtures/colomitchi.json
# Uses JAVA_HOME's javac and java if set, else the ones on PATH.
set -e
here=$(cd "$(dirname "$0")" && pwd)
src=${1:-$here/.cache/bezier-utils-src}
if [ -z "$1" ] && [ ! -d "$src" ]; then
  mkdir -p "$here/.cache"
  unzip -q "$here/colomitchi-gen/bezier-utils-src.zip" -d "$here/.cache"
fi
bin=${JAVA_HOME:+$JAVA_HOME/bin/}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$src/com" "$work/"
f="$work/com/caffeineowl/graphics/bezier/BezierUtils.java"

# Replaces a literal line in BezierUtils.java, failing unless it was there.
replace() {
  grep -qF "$1" "$f"
  OLD=$1 NEW=$2 perl -pi -e 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$f"
  grep -qF "$2" "$f"
}

# Fix 1: MidPointApproxSubdivCriterion.shouldSplit, `<=` -> `>`.
old='return (sqDist*BezierUtils.v3div_sq36) <= this.sqTol;'
new='return (sqDist*BezierUtils.v3div_sq36) > this.sqTol;'
replace "$old" "$new"

# Fix 2: doAdaptiveDegreeReduction's defect, precision * 18/sqrt(3) / D0-1.
old='double defect=BezierUtils.v18div_sqrt3*Math.hypot(p1x-p0x, p1y-p0y);'
new='double defect=precision*BezierUtils.v18div_sqrt3/Math.hypot(p1x-p0x, p1y-p0y);'
replace "$old" "$new"

# Fix 3: computeInflexion, count the second root when it is stored first.
old='params[1]=params[0];'
new='params[1]=params[0]; toRet++;'
replace "$old" "$new"

mkdir "$work/classes"
"${bin}javac" -nowarn -d "$work/classes" -sourcepath "$work" \
  "$f" "$here/colomitchi-gen/Harness.java" 2>/dev/null
"${bin}java" -cp "$work/classes" Harness
