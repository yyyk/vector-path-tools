// Prints skia.json: Skia's SkPath::contains on random paths (both fill
// types) and Wang's formula (skgpu::wangs_formula::quadratic and cubic) on
// random curves, for comparing with the ports in src/skia. Built and run by
// ../generate-skia.sh.
//
// Skia works in 32-bit floats, so every input is a float; numbers are printed
// with 17 digits, which JavaScript reads back as exactly the same values.

#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "src/gpu/tessellate/WangsFormula.h"

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

// xorshift64*, so the cases are the same on every run.
static uint64_t state = 0x9E3779B97F4A7C15ull;
static double next() {
    state ^= state >> 12;
    state ^= state << 25;
    state ^= state >> 27;
    uint64_t r = state * 0x2545F4914F6CDD1Dull;
    return (double)(r >> 11) / (double)(1ull << 53);
}
static SkPoint point() {
    return {(float)(next() * 200 - 100), (float)(next() * 200 - 100)};
}

static std::string num(float v) {
    char buf[40];
    snprintf(buf, sizeof buf, "%.17g", (double)v);
    return buf;
}
static std::string pt(SkPoint p) { return "[" + num(p.fX) + "," + num(p.fY) + "]"; }

int main() {
    std::string out = "{\"contains\":[";
    for (int i = 0; i < 200; i++) {
        SkPathBuilder builder;
        std::string cmds;
        std::vector<SkPoint> onCurve;
        auto cmd = [&](const std::string& s) { cmds += (cmds.empty() ? "" : ",") + s; };
        int subpaths = 1 + i % 3;
        for (int s = 0; s < subpaths; s++) {
            SkPoint p = point();
            builder.moveTo(p);
            cmd("[\"M\"," + num(p.fX) + "," + num(p.fY) + "]");
            onCurve.push_back(p);
            int n = 2 + (int)(next() * 4);
            for (int k = 0; k < n; k++) {
                int kind = (int)(next() * 3);
                SkPoint q = point();
                if (kind == 0) {
                    builder.lineTo(q);
                    cmd("[\"L\"," + num(q.fX) + "," + num(q.fY) + "]");
                } else if (kind == 1) {
                    SkPoint c = point();
                    builder.quadTo(c, q);
                    cmd("[\"Q\"," + num(c.fX) + "," + num(c.fY) + "," + num(q.fX) + "," +
                        num(q.fY) + "]");
                } else {
                    SkPoint c1 = point();
                    SkPoint c2 = point();
                    builder.cubicTo(c1, c2, q);
                    cmd("[\"C\"," + num(c1.fX) + "," + num(c1.fY) + "," + num(c2.fX) + "," +
                        num(c2.fY) + "," + num(q.fX) + "," + num(q.fY) + "]");
                }
                onCurve.push_back(q);
            }
            if (next() < 0.7) {
                builder.close();
                cmd("[\"Z\"]");
            }
        }
        std::vector<SkPoint> points;
        for (int k = 0; k < 60; k++) points.push_back(point());
        points.insert(points.end(), onCurve.begin(), onCurve.end());

        std::string pts, nonzero, evenodd;
        SkPath winding = builder.snapshot();
        builder.setFillType(SkPathFillType::kEvenOdd);
        SkPath evenOdd = builder.snapshot();
        for (size_t k = 0; k < points.size(); k++) {
            const char* sep = k ? "," : "";
            pts += sep + pt(points[k]);
            nonzero += std::string(sep) + (winding.contains(points[k]) ? "true" : "false");
            evenodd += std::string(sep) + (evenOdd.contains(points[k]) ? "true" : "false");
        }
        out += std::string(i ? "," : "") + "{\"commands\":[" + cmds + "],\"points\":[" + pts +
               "],\"nonzero\":[" + nonzero + "],\"evenodd\":[" + evenodd + "]}";
    }

    out += "],\"wang\":[";
    const float precisions[] = {4, 1, 0.25f, 20};
    for (int i = 0; i < 400; i++) {
        bool cubic = i % 2;
        SkPoint p[4] = {point(), point(), point(), point()};
        float precision = precisions[i % 4];
        float n = cubic ? skgpu::wangs_formula::cubic(precision, p)
                        : skgpu::wangs_formula::quadratic(precision, p);
        std::string curve = pt(p[0]) + "," + pt(p[1]) + "," + pt(p[2]);
        if (cubic) curve += "," + pt(p[3]);
        out += std::string(i ? "," : "") + "{\"curve\":[" + curve + "],\"precision\":" +
               num(precision) + ",\"n\":" + num(n) + "}";
    }
    out += "]}";
    puts(out.c_str());
}
