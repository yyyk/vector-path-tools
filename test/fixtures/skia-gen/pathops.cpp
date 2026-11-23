// Prints Skia's PathOps results (Op) for the cases in boolean-inputs.txt (read
// from stdin), one JSON object per case. Each result is its path data (in the
// same compact form), the fill rule it is meant to be filled with, or
// ok: false where Skia gives up.
// Skia may turn curves into lower-degree ones, so compare results by fill.
// Built and run by ../generate-skia-pathops.sh.
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/pathops/SkPathOps.h"

#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>

static SkPath parse(const std::string& d, const std::string& rule) {
    SkPathBuilder b(rule == "evenodd" ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding);
    std::istringstream in(d);
    std::string op;
    const auto f = [&]() {
        double v;
        in >> v;
        return (float)v;
    };
    while (in >> op) {
        if (op == "M") {
            float x = f(), y = f();
            b.moveTo(x, y);
        } else if (op == "L") {
            float x = f(), y = f();
            b.lineTo(x, y);
        } else if (op == "Q") {
            float cx = f(), cy = f(), x = f(), y = f();
            b.quadTo(cx, cy, x, y);
        } else if (op == "C") {
            float c1x = f(), c1y = f(), c2x = f(), c2y = f(), x = f(), y = f();
            b.cubicTo(c1x, c1y, c2x, c2y, x, y);
        } else if (op == "Z")
            b.close();
    }
    return b.detach();
}

static std::string num(float v) {
    char buf[40];
    snprintf(buf, sizeof buf, "%.9g", (double)v);
    return buf;
}

static std::string format(const SkPath& path) {
    std::string d;
    const auto add = [&](const char* op, const SkPoint* pts, int n) {
        d += d.empty() ? "" : " ";
        d += op;
        for (int i = 0; i < n; i++) d += " " + num(pts[i].fX) + " " + num(pts[i].fY);
    };
    SkPath::RawIter iter(path);
    SkPoint pts[4];
    for (SkPath::Verb verb; (verb = iter.next(pts)) != SkPath::kDone_Verb;) {
        switch (verb) {
            case SkPath::kMove_Verb: add("M", pts, 1); break;
            case SkPath::kLine_Verb: add("L", pts + 1, 1); break;
            case SkPath::kQuad_Verb: add("Q", pts + 1, 2); break;
            case SkPath::kCubic_Verb: add("C", pts + 1, 3); break;
            case SkPath::kClose_Verb: add("Z", pts, 0); break;
            default: return "";  // conics never come out of lines and Béziers
        }
    }
    return d;
}

int main() {
    std::string line;
    bool first = true;
    printf("[");
    while (std::getline(std::cin, line)) {
        const auto bar1 = line.find('|');
        const auto bar2 = line.find('|', bar1 + 1);
        std::istringstream head(line.substr(0, bar1));
        std::string op, ruleA, ruleB;
        head >> op >> ruleA >> ruleB;
        const SkPath a = parse(line.substr(bar1 + 1, bar2 - bar1 - 1), ruleA);
        const SkPath b = parse(line.substr(bar2 + 1), ruleB);
        const std::optional<SkPath> result =
            Op(a, b,
               op == "union"          ? kUnion_SkPathOp
               : op == "intersection" ? kIntersect_SkPathOp
               : op == "difference"   ? kDifference_SkPathOp
                                      : kXOR_SkPathOp);
        printf("%s", first ? "" : ",\n");
        first = false;
        if (result)
            printf("{\"ok\":true,\"fillRule\":\"%s\",\"d\":\"%s\"}",
                   result->getFillType() == SkPathFillType::kEvenOdd ? "evenodd" : "nonzero",
                   format(*result).c_str());
        else
            printf("{\"ok\":false}");
    }
    printf("]\n");
}
