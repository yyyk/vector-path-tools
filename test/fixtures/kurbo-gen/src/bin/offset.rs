//! Prints kurbo's offset curves for the curves in offset-inputs.txt (read from
//! stdin), one JSON object per curve, as a comparison for measuring
//! src/stroke-outline/offset.ts: the cubics of offset_cubic at a tolerance of
//! 1e-3 and 1e-6 of the curve's size (its control points' bounding-box
//! diagonal). Quadratics are raised to cubics first. kurbo's normal is the
//! tangent turned 90° counterclockwise, as stroke-outline's.
//!   cargo run --release --manifest-path test/fixtures/kurbo-gen/Cargo.toml --bin offset < test/fixtures/offset-inputs.txt
use kurbo::offset::offset_cubic;
use kurbo::{BezPath, CubicBez, PathEl, Point, QuadBez, Rect};
use std::io::BufRead;

fn cubics(path: &BezPath) -> Vec<String> {
    let mut last = Point::ZERO;
    let mut out = Vec::new();
    for el in path.elements() {
        match *el {
            PathEl::MoveTo(p) => last = p,
            PathEl::CurveTo(a, b, p) => {
                out.push(format!(
                    "[{:?},{:?},{:?},{:?},{:?},{:?},{:?},{:?}]",
                    last.x, last.y, a.x, a.y, b.x, b.y, p.x, p.y
                ));
                last = p;
            }
            PathEl::LineTo(p) => {
                out.push(format!(
                    "[{:?},{:?},{:?},{:?},{:?},{:?},{:?},{:?}]",
                    last.x, last.y, last.x, last.y, p.x, p.y, p.x, p.y
                ));
                last = p;
            }
            _ => panic!("unexpected element"),
        }
    }
    out
}

fn main() {
    let mut out = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        let mut it = line.split(' ');
        let _name = it.next().unwrap();
        let kind = it.next().unwrap();
        let v: Vec<f64> = it.map(|s| s.parse().unwrap()).collect();
        let d = *v.last().unwrap();
        let p: Vec<Point> = v[..v.len() - 1].chunks(2).map(|c| Point::new(c[0], c[1])).collect();
        let bbox = p.iter().fold(Rect::from_points(p[0], p[0]), |r, &q| r.union_pt(q));
        let size = bbox.width().hypot(bbox.height());
        let c = if kind == "q" {
            QuadBez::new(p[0], p[1], p[2]).raise()
        } else {
            CubicBez::new(p[0], p[1], p[2], p[3])
        };
        let run = |rel: f64| {
            let mut path = BezPath::new();
            offset_cubic(c, d, rel * size, &mut path);
            cubics(&path).join(",")
        };
        out.push(format!(
            "{{\"curve\":\"{line}\",\"coarse\":[{}],\"fine\":[{}]}}",
            run(1e-3),
            run(1e-6)
        ));
    }
    println!("[{}]", out.join(","));
}
