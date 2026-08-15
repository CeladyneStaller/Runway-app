// ── What is under the pointer ────────────────────────────────────────────────────────────────────
//
// ⚠️ IT READS THE SPEC, NOT THE DRAWING. A hover layer that asked each renderer to hit-test what it had
// drawn would need `Lines`, `Bars`, `Stack` and `HBars` to grow a path each — four implementations of
// one question, which is the fault this codebase has produced five times this week (the stack rule, the
// precedence chain, the colour field, the axis field). **The spec already holds every value.**
//
// Pure and DOM-free, so the interesting parts — the stack total, the projected flag, the two axes — are
// testable without rendering anything.

const clean = (n) => (Number.isFinite(n) ? n : 0);

/**
 * @param spec  a built chart spec
 * @param i     index INTO THE WINDOW, not into the projection
 * @param ctx   { todayIndex, band, unitOf }
 *
 * ⚠️ `i` IS A WINDOW INDEX. Series are clipped to `spec.x` — 18 points — while the projection is 37
 * rows. Anything reaching back to the projection with this number reads the wrong month, and that
 * mismatch has already produced one bug in the builder.
 */
export function valueAt(spec, i, ctx = {}) {
  if (!spec || i == null || i < 0) return null;
  const series = (spec.series || []).filter(s => Array.isArray(s.values));
  if (!series.length && !spec.rows) return null;

  const label = spec.ticks?.[i]?.label ?? spec.x?.[i] ?? String(i);
  const categorical = !!spec.ticks?.[i]?.categorical;

  const rows = series.map(s => ({
    id: s.id, label: s.label,
    value: clean(s.values[i]),
    color: s.color || null, tone: s.tone || null,
    // A DIMMED SERIES STILL REPORTS ITS VALUE. Dimming is emphasis, not exclusion — it stays on the
    // axis scale, so it stays here, marked so the tooltip can grey it to match.
    dim: !!s.dim,
    stacked: !!s.stacked,
    // ⚠️ A RIGHT-AXIS SERIES SAYS SO. Two scales are already a compromise; a number lifted off the
    // wrong one is worse than not reading it.
    axis: s.axis === "right" ? "right" : "left",
  }));

  // ⚠️ THE STACK TOTAL IS REQUIRED, NOT OPTIONAL. People read a stack by its HEIGHT, so the number
  // they are usually after is the total — and listing four segments without it makes them add up
  // figures the chart already knows.
  const stacked = rows.filter(r => r.stacked);
  const total = stacked.length > 1
    ? stacked.reduce((a, r) => a + r.value, 0)
    : null;

  return {
    label, categorical, rows, total,
    // ⚠️ "PROJECTED" IS NOT DECORATION. A tooltip that reports a modelled figure the same way it
    // reports a recorded one undoes the actuals/projection divide — and it is worse than the line,
    // because a precise number FEELS like a fact.
    projected: Number.isFinite(ctx.todayIndex) ? i > ctx.todayIndex : false,
    // ⚠️ IF THE CHART DRAWS A RANGE, THE TOOLTIP REPORTS A RANGE. Reporting the centre line alone would
    // use the most precise-feeling surface in the interface to say the one thing this product's whole
    // design exists to avoid saying.
    band: ctx.band && Number.isFinite(ctx.band.lo?.[i]) && Number.isFinite(ctx.band.hi?.[i])
      ? { lo: ctx.band.lo[i], hi: ctx.band.hi[i] } : null,
    format: spec.format || "money",
  };
}

/** Which window index a pointer at `px` is nearest.
 *
 *  ⚠️ NEAREST X, NOT NEAREST MARK. Requiring somebody to hit a 2px line is a chart you can only read
 *  with a mouse and good aim — and it makes the touch case impossible rather than merely awkward.
 */
export function indexAt(px, { left, width, n }) {
  if (!n || n < 1 || !Number.isFinite(px)) return null;
  if (n === 1) return 0;
  const f = (px - left) / (width || 1);
  return Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
}

/** Where the tooltip sits, given the pointer and the box it must stay inside.
 *
 *  ⚠️ IT FLIPS BEFORE THE EDGE AND NEVER COVERS THE HOVERED COLUMN. A tooltip that hides the thing it
 *  describes makes people move the pointer to see what they were reading, which moves the tooltip.
 */
export function placeTip(px, py, { w, h, tipW = 210, tipH = 120, gap = 14 }) {
  const flip = px + gap + tipW > w;
  return {
    x: Math.max(4, flip ? px - gap - tipW : px + gap),
    y: Math.max(4, Math.min(h - tipH - 4, py - tipH / 2)),
    flipped: flip,
  };
}
