use kurbo::{flatten as kurbo_flatten, BezPath, CubicBez, PathEl, Point};

/// xorshift64*, so the cases are the same on every run.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let r = self.0.wrapping_mul(0x2545F4914F6CDD1D);
        (r >> 11) as f64 / (1u64 << 53) as f64
    }
    fn point(&mut self) -> Point {
        Point::new(self.next() * 200.0 - 100.0, self.next() * 200.0 - 100.0)
    }
}

fn pt(p: Point) -> String {
    format!("[{:?},{:?}]", p.x, p.y)
}

fn pts(ps: &[Point]) -> String {
    format!("[{}]", ps.iter().map(|&p| pt(p)).collect::<Vec<_>>().join(","))
}

fn curve(rng: &mut Rng, i: usize, n: usize) -> Vec<Point> {
    let mut c: Vec<Point> = (0..n).map(|_| rng.point()).collect();
    if i % 50 == 0 {
        c[n - 1] = c[0]; // closed loops
    }
    if i % 37 == 0 {
        c = (0..n).map(|k| Point::new(k as f64, k as f64)).collect(); // collinear
    }
    if i % 41 == 0 && n == 4 {
        c = vec![Point::new(0., 0.), Point::new(0., 0.), Point::new(10., 10.), Point::new(10., 10.)];
    }
    if i % 43 == 0 && n == 4 {
        c = vec![Point::new(0., 0.), Point::new(100., 100.), Point::new(0., 100.), Point::new(100., 0.)]; // cusp
    }
    c
}

fn main() {
    let mut rng = Rng(0x9E3779B97F4A7C15);
    let tols = [0.01, 0.1, 0.25, 1.0, 5.0];

    let mut flatten = Vec::new();
    for n in [3, 4] {
        for i in 0..300 {
            let c = curve(&mut rng, i, n);
            let tol = tols[i % tols.len()];
            let mut path = BezPath::new();
            path.move_to(c[0]);
            if n == 3 {
                path.quad_to(c[1], c[2]);
            } else {
                path.curve_to(c[1], c[2], c[3]);
            }
            let mut out = Vec::new();
            kurbo_flatten(path, tol, |el| {
                if let PathEl::LineTo(p) = el {
                    out.push(p);
                }
            });
            flatten.push(format!("{{\"curve\":{},\"tol\":{:?},\"out\":{}}}", pts(&c), tol, pts(&out)));
        }
    }

    let mut to_quads = Vec::new();
    for i in 0..300 {
        let c = curve(&mut rng, i, 4);
        let acc = tols[i % tols.len()];
        let quads: Vec<String> = CubicBez::new(c[0], c[1], c[2], c[3])
            .to_quads(acc)
            .map(|(t0, t1, q)| format!("[{:?},{:?},{}]", t0, t1, pts(&[q.p0, q.p1, q.p2])))
            .collect();
        to_quads.push(format!(
            "{{\"curve\":{},\"accuracy\":{:?},\"out\":[{}]}}",
            pts(&c),
            acc,
            quads.join(",")
        ));
    }

    println!("{{\"flatten\":[{}],\"toQuads\":[{}]}}", flatten.join(","), to_quads.join(","));
}
