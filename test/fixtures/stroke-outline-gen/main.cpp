// Prints stroke-outline's arc lengths, dash tables and curve offsets on random
// curves as JSON: the reference src/stroke-outline/arc-length.ts and
// src/stroke-outline/offset.ts must match bit for bit. Built and run by
// generate-stroke-outline.sh.
//
// The length ranges and the dash table are internal to their files, so those
// files are included here rather than linked.
#include "bezier/arc_length.cpp"
#include "stroke/dash.cpp"

#include <cstdio>
#include <random>
#include <string>
#include <vector>

using namespace stroke_outline;
using namespace stroke_outline::bezier;

namespace
{
	std::string num(double v)
	{
		char buf[32];
		std::snprintf(buf, sizeof buf, "%.17g", v);
		return buf;
	}

	std::string points(const std::vector<Vec2>& ps)
	{
		std::string s = "[";
		for (std::size_t i = 0; i < ps.size(); ++i)
			s += (i ? ",[" : "[") + num(ps[i].x) + "," + num(ps[i].y) + "]";
		return s + "]";
	}
}

int main()
{
	std::mt19937_64 rng(9);
	std::uniform_real_distribution<double> u(-100, 100);
	const double scales[] = { 0.01, 1, 100, 10000 };
	const double offsets[] = { -8, -1, 0.5, 3, 20 };

	std::vector<std::vector<Vec2>> curves;
	for (int i = 0; i < 200; ++i)
	{
		const double s = scales[i % 4];
		std::vector<Vec2> p(i % 2 ? 4 : 3);
		for (auto& q: p)
			q = Vec2 { u(rng) * s, u(rng) * s };
		if (i % 37 == 0)
			p[1] = p[0];  // a control point on its end
		if (i % 41 == 0 && p.size() == 4)
		{
			// straight, with its controls along the line
			p[1] = Vec2::lerp(p[0], p[3], 0.3);
			p[2] = Vec2::lerp(p[0], p[3], 0.7);
		}
		curves.push_back(p);
	}
	// A cusp, and an arch whose offset folds on its inner side.
	curves.push_back({ { 0, 0 }, { 100, 100 }, { 0, 100 }, { 100, 0 } });
	curves.push_back({ { 0, 0 }, { 0, 100 }, { 100, 100 }, { 100, 0 } });

	std::printf("{\"arcLength\":[");
	for (std::size_t i = 0; i < curves.size(); ++i)
	{
		const auto& p = curves[i];
		const bool cubic = p.size() == 4;
		std::string s = (i ? ",{" : "{") + std::string("\"p\":") + points(p);
		s += ",\"length\":"
			+ num(cubic ? arc_length_cubic(p[0], p[1], p[2], p[3])
						: arc_length_quadratic(p[0], p[1], p[2]));
		s += ",\"range\":"
			+ num(cubic ? arc_length_cubic_range(p[0], p[1], p[2], p[3], 0.2, 0.7)
						: arc_length_quadratic_range(p[0], p[1], p[2], 0.2, 0.7));
		const auto lut = cubic ? ArcLengthLUT::from_cubic(p[0], p[1], p[2], p[3], 100)
							   : ArcLengthLUT::from_quadratic(p[0], p[1], p[2], 100);
		s += ",\"lutLength\":" + num(lut.total_length) + ",\"lutT\":[";
		for (int k = 1; k < 10; ++k)
			s += (k > 1 ? "," : "") + num(lut.t_at_distance(lut.total_length * k / 10.0));
		std::printf("%s]}", s.c_str());
	}

	std::printf("],\"offset\":[");
	bool first = true;
	for (std::size_t i = 0; i < curves.size(); ++i)
	{
		const auto& p = curves[i];
		const double size = (i < 200 ? scales[i % 4] : 1.0);
		std::vector<double> ds = { offsets[i % 5] * size };
		if (i >= 200)
			ds = { -50, -5, 5, 50 };  // the arch folds at -50
		for (const double d: ds)
		{
			std::string s = (first ? "{" : ",{") + std::string("\"p\":") + points(p);
			first = false;
			s += ",\"d\":" + num(d) + ",\"out\":[";
			std::vector<std::vector<Vec2>> pieces;
			if (p.size() == 4)
				for (const auto& c: offset_cubic_bezier(p[0], p[1], p[2], p[3], d))
					pieces.push_back({ c.p0, c.p1, c.p2, c.p3 });
			else
				for (const auto& c: offset_quadratic_bezier(p[0], p[1], p[2], d))
					pieces.push_back({ c.p0, c.p1, c.p2 });
			for (std::size_t k = 0; k < pieces.size(); ++k)
				s += (k ? "," : "") + points(pieces[k]);
			std::printf("%s]}", s.c_str());
		}
	}
	std::printf("]}\n");
}
