//! Prints kurbo's arc lengths for the curves in arclen-inputs.txt (read from
//! stdin), one JSON object per curve, as the reference for measuring
//! src/stroke-outline/arc-length.ts: the length, and at 10%, 20% ... 90% of
//! it the parameter t (inv_arclen) and the point there. Accuracy is 1e-12 of
//! the curve's control-polygon length, so the results are close to exact.
//!   cargo run --release --manifest-path test/fixtures/kurbo-gen/Cargo.toml --bin arclen < test/fixtures/arclen-inputs.txt
use kurbo::{CubicBez, ParamCurve, ParamCurveArclen, Point, QuadBez};
use std::io::BufRead;

fn main() {
    let mut out = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        let mut it = line.split(' ');
        let kind = it.next().unwrap();
        let v: Vec<f64> = it.map(|s| s.parse().unwrap()).collect();
        let p: Vec<Point> = v.chunks(2).map(|c| Point::new(c[0], c[1])).collect();
        let polygon: f64 = p.windows(2).map(|w| (w[1] - w[0]).hypot()).sum();
        let accuracy = 1e-12 * polygon.max(f64::MIN_POSITIVE);
        let (len, ts, pts): (f64, Vec<f64>, Vec<Point>) = if kind == "q" {
            let q = QuadBez::new(p[0], p[1], p[2]);
            let len = q.arclen(accuracy);
            let ts: Vec<f64> = (1..10).map(|k| q.inv_arclen(len * k as f64 / 10.0, accuracy)).collect();
            let pts = ts.iter().map(|&t| q.eval(t)).collect();
            (len, ts, pts)
        } else {
            let c = CubicBez::new(p[0], p[1], p[2], p[3]);
            let len = c.arclen(accuracy);
            let ts: Vec<f64> = (1..10).map(|k| c.inv_arclen(len * k as f64 / 10.0, accuracy)).collect();
            let pts = ts.iter().map(|&t| c.eval(t)).collect();
            (len, ts, pts)
        };
        let list = |xs: &[f64]| xs.iter().map(|x| format!("{x:?}")).collect::<Vec<_>>().join(",");
        let points: Vec<String> = pts.iter().map(|q| format!("[{:?},{:?}]", q.x, q.y)).collect();
        out.push(format!(
            "{{\"curve\":\"{line}\",\"length\":{len:?},\"t\":[{}],\"points\":[{}]}}",
            list(&ts),
            points.join(",")
        ));
    }
    println!("[{}]", out.join(","));
}
