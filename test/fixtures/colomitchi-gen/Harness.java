import java.awt.geom.CubicCurve2D;
import java.awt.geom.QuadCurve2D;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

import com.caffeineowl.graphics.bezier.BezierUtils;
import com.caffeineowl.graphics.bezier.QuadSegmentConsumer;

/**
 * Prints colomitchi.json: bezier-utils' computeInflexion,
 * adaptiveHalvingDegreeReduction and adaptiveDegreeReduction (with the three
 * fixes applied by generate-colomitchi.sh) on random cubics, with and without
 * splitting at the inflection points first (splitCurve).
 */
public class Harness {
  static String num(double v) {
    if (Double.isNaN(v) || Double.isInfinite(v)) throw new IllegalStateException("" + v);
    return Double.toString(v);
  }

  static String quads(List<QuadCurve2D> qs) {
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < qs.size(); i++) {
      QuadCurve2D q = qs.get(i);
      if (i > 0) b.append(',');
      b.append("[[").append(num(q.getX1())).append(',').append(num(q.getY1())).append("],[")
        .append(num(q.getCtrlX())).append(',').append(num(q.getCtrlY())).append("],[")
        .append(num(q.getX2())).append(',').append(num(q.getY2())).append("]]");
    }
    return b.append(']').toString();
  }

  static List<QuadCurve2D> run(String method, CubicCurve2D c, double prec, boolean inflections) {
    List<QuadCurve2D> out = new ArrayList<>();
    QuadSegmentConsumer consumer = (q, t0, t1) -> out.add(q);
    CubicCurve2D[] parts = { c };
    if (inflections) {
      double[] params = new double[2];
      int n = BezierUtils.computeInflexion(c, params);
      parts = BezierUtils.splitCurve(c, Arrays.copyOf(params, n), null);
    }
    for (CubicCurve2D part : parts) {
      if (method.equals("half")) BezierUtils.adaptiveHalvingDegreeReduction(part, prec, consumer);
      else BezierUtils.adaptiveDegreeReduction(part, prec, consumer);
    }
    return out;
  }

  public static void main(String[] args) {
    Random rnd = new Random(7);
    double[] tols = { 0.01, 0.1, 0.5, 2 };
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < 300; i++) {
      double[] p = new double[8];
      for (int k = 0; k < 8; k++) p[k] = rnd.nextDouble() * 200 - 100;
      if (i % 50 == 0) { p[6] = p[0]; p[7] = p[1]; } // closed loops
      if (i % 37 == 0) p = new double[] { 0, 0, 1, 1, 2, 2, 3, 3 }; // collinear
      if (i % 43 == 0) p = new double[] { 0, 0, 100, 100, 0, 100, 100, 0 }; // cusp
      double tol = i % 61 == 0 ? 1e-6 : tols[i % 4]; // 1e-6: below the criterion's floor
      CubicCurve2D c = new CubicCurve2D.Double(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
      double[] params = new double[2];
      int n = BezierUtils.computeInflexion(c, params);
      if (i > 0) b.append(',');
      b.append("{\"curve\":[[").append(num(p[0])).append(',').append(num(p[1])).append("],[")
        .append(num(p[2])).append(',').append(num(p[3])).append("],[")
        .append(num(p[4])).append(',').append(num(p[5])).append("],[")
        .append(num(p[6])).append(',').append(num(p[7])).append("]],\"tol\":").append(num(tol))
        .append(",\"inflexions\":[");
      for (int k = 0; k < n; k++) b.append(k > 0 ? "," : "").append(num(params[k]));
      b.append(']');
      for (String m : new String[] { "half", "symmetric" })
        for (boolean infl : new boolean[] { false, true })
          b.append(",\"").append(m).append(infl ? "Inflections" : "").append("\":")
            .append(quads(run(m, c, tol, infl)));
      b.append('}');
    }
    System.out.println(b.append(']'));
  }
}
