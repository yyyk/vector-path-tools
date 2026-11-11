# Generates cu2qu.json: fontTools' curve_to_quadratic on random cubics, the
# reference the port in src/fonttools/cu2qu.ts must match bit for bit.
#   python3 test/fixtures/generate-cu2qu.py /path/to/fonttools > test/fixtures/cu2qu.json
import json
import random
import sys

sys.path.insert(0, sys.argv[1] + "/Lib")
from fontTools.cu2qu import curve_to_quadratic

random.seed(7)
cases = []
for i in range(200):
    c = [(random.uniform(-100, 100), random.uniform(-100, 100)) for _ in range(4)]
    if i % 50 == 0:
        c[3] = c[0]  # closed loops
    if i % 37 == 0:
        c = [(0, 0), (1, 1), (2, 2), (3, 3)]  # collinear
    if i % 41 == 0:
        c = [(0, 0), (0, 0), (10, 10), (10, 10)]  # coincident control points
    tol = [0.01, 0.1, 0.5, 2][i % 4]
    out = curve_to_quadratic(c, tol)
    cases.append({"curve": [list(p) for p in c], "tol": tol, "out": [list(p) for p in out]})
json.dump(cases, sys.stdout)
