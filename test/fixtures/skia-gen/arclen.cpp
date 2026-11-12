// Prints Skia's SkContourMeasure results for the curves in arclen-inputs.txt
// (read from stdin), one JSON object per curve: the length, and at 10%, 20% ...
// 90% of it the point (getPosTan), with resScale 1 (a 0.5-unit tolerance).
// Built and run by ../generate-skia-arclen.sh.
#include "include/core/SkContourMeasure.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"

#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

int main() {
    std::string line;
    bool first = true;
    printf("[");
    while (std::getline(std::cin, line)) {
        std::istringstream in(line);
        std::string kind;
        in >> kind;
        std::vector<double> v;
        for (double d; in >> d;) v.push_back(d);
        SkPathBuilder b;
        b.moveTo((float)v[0], (float)v[1]);
        if (kind == "q")
            b.quadTo((float)v[2], (float)v[3], (float)v[4], (float)v[5]);
        else
            b.cubicTo((float)v[2], (float)v[3], (float)v[4], (float)v[5], (float)v[6], (float)v[7]);
        SkContourMeasureIter iter(b.detach(), false, 1);
        sk_sp<SkContourMeasure> m = iter.next();
        float length = m ? m->length() : 0;
        printf("%s{\"curve\":\"%s\",\"length\":%.17g,\"points\":[", first ? "" : ",", line.c_str(),
               (double)length);
        for (int k = 1; k < 10; k++) {
            SkPoint pos = {0, 0};
            SkVector tan;
            if (m) (void)m->getPosTan(length * k / 10.0f, &pos, &tan);
            printf("%s[%.17g,%.17g]", k > 1 ? "," : "", (double)pos.fX, (double)pos.fY);
        }
        printf("]}");
        first = false;
    }
    printf("]\n");
}
