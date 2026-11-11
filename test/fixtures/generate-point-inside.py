# Generates point-inside.json: fontTools' PointInsidePen on random paths of
# lines, quadratics and cubics (some subpaths closed, some left open), at
# random points and at every on-curve point, under both fill rules: the
# reference the port in src/fonttools/point-inside-pen.ts must match.
#   python3 test/fixtures/generate-point-inside.py /path/to/fonttools > test/fixtures/point-inside.json
import json
import random
import sys

sys.path.insert(0, sys.argv[1] + "/Lib")
from fontTools.pens.pointInsidePen import PointInsidePen

random.seed(11)


def point():
    return (random.uniform(-100, 100), random.uniform(-100, 100))


cases = []
for i in range(200):
    commands = []
    on_curve = []
    for _ in range(1 + i % 3):
        p = point()
        commands.append(["M", *p])
        on_curve.append(p)
        for _ in range(random.randint(2, 5)):
            kind = random.randrange(3)
            p = point()
            if kind == 0:
                commands.append(["L", *p])
            elif kind == 1:
                commands.append(["Q", *point(), *p])
            else:
                commands.append(["C", *point(), *point(), *p])
            on_curve.append(p)
        if random.random() < 0.7:
            commands.append(["Z"])
    points = [point() for _ in range(60)] + on_curve
    results = {}
    for even_odd in (False, True):
        out = []
        for pt in points:
            pen = PointInsidePen(None, pt, evenOdd=even_odd)
            for c in commands:
                if c[0] == "M":
                    pen.moveTo(tuple(c[1:3]))
                elif c[0] == "L":
                    pen.lineTo(tuple(c[1:3]))
                elif c[0] == "Q":
                    pen.qCurveTo(tuple(c[1:3]), tuple(c[3:5]))
                elif c[0] == "C":
                    pen.curveTo(tuple(c[1:3]), tuple(c[3:5]), tuple(c[5:7]))
                else:
                    pen.closePath()
            out.append(pen.getResult())
        results["evenodd" if even_odd else "nonzero"] = out
    cases.append({"commands": commands, "points": [list(p) for p in points], **results})
json.dump(cases, sys.stdout)
