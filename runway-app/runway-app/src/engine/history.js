import { monthTotal } from "./coding.js";
// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.

export const tripCost = (t) => (t.travelers || 0) * ((t.flight || 0) + (t.vehicle || 0) + (t.days || 0) * ((t.lodging || 0) + (t.perDiem || 0)));

export function linReg(points) {
  const n = points.length; if (n < 2) return { predict: () => points[0]?.y || 0 };
  const sx = points.reduce((a, p) => a + p.x, 0), sy = points.reduce((a, p) => a + p.y, 0);
  const sxx = points.reduce((a, p) => a + p.x * p.x, 0), sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intr = (sy - slope * sx) / n;
  return { predict: (x) => intr + slope * x, slope };
}

// Derive the comprehensive run-rate from measured months; auto-flag months that mismatch the expected
// line-item total.
// `hist` is a PARAMETER, not an import. It used to read the seed's HIST straight out of the module,
// which meant every model — including an empty one — was handed the demo company's six months of
// spend. A new user with $100k and nothing else got a $78k/mo baseline and a 1.3-month runway built
// from a company they had never heard of. The engine takes data; it does not know where data lives.
export function burnStats(hist, expected, overrides, method) {
  const HIST = hist || [];
  const vars = HIST.map(h => monthTotal(h) - expected);
  const sorted = [...vars].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
  const band = Math.max(expected * 0.2, 8000);
  const rows = HIST.map((h, i) => {
    const variance = monthTotal(h) - expected;
    const auto = Math.abs(variance - median) > band;
    const flagged = overrides[i] !== undefined ? overrides[i] : auto;
    return { ...h, i, v: monthTotal(h), variance, auto, flagged };
  });
  const included = rows.filter(r => !r.flagged);
  const vals = included.map(r => r.v);   // r.v set below from monthTotal
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const trailing = vals.length ? vals.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, vals.length) : 0;
  const reg = linReg(included.map(r => ({ x: r.i, y: r.v })));
  const trend = reg.predict(HIST.length);
  const applied = method === "simple" ? avg : method === "trailing" ? trailing : trend;
  return { rows, avg, trailing, trend, applied, flaggedCount: rows.filter(r => r.flagged).length };
}
