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
    // ⚠️ COPIED, BECAUSE THE SUBTOTAL DEPENDS ON THEM. This hand-written pick is the same shape that
    // dropped `color` in the renderer, `color` again in the legend, and four fields in `saveChart`.
    // **A field produced upstream and omitted from a pick fails silently every time.**
    group: s.group ?? s.id,
    groupLabel: s.groupLabel || null,
    // ⚠️ THE UNIT, PER ROW. The tooltip formatted every row with the CHART's format — so subscribers on
    // a money chart read as "$24". Exactly the fault just fixed on the right axis, in a second consumer
    // that also asked the chart instead of the series.
    unit: s.unit || null,
    // ⚠️ A RIGHT-AXIS SERIES SAYS SO. Two scales are already a compromise; a number lifted off the
    // wrong one is worse than not reading it.
    axis: s.axis === "right" ? "right" : "left",
  }));

  // ⚠️ A BREAKDOWN SUMS WHETHER OR NOT IT IS STACKED. The total was gated on `stacked`, which is a
  // DRAWING choice — but eight projects drawn as eight lines are still eight parts of one measure, and
  // their sum is still that measure's value. **Gating a semantic fact on a visual setting meant the
  // number appeared and disappeared depending on which shape somebody picked.**
  //
  // Subtotalled per GROUP, because that is what "parts of one measure" means here. Several distinct
  // measures each form their own group of one and get no subtotal — summing money in and money out
  // would be arithmetic nobody asked for.
  const byGroup = new Map();
  for (const r of rows) {
    const g = r.group ?? r.id;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(r);
  }
  const groups = [...byGroup.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([g, list]) => ({
      group: g,
      label: list[0].groupLabel || "Total",
      value: list.reduce((a, r) => a + r.value, 0),
    }));

  // ⚠️ AND THE STACK HEIGHT IS A DIFFERENT NUMBER when several MEASURES are stacked together — one
  // group each, so no subtotal above, but the height is what the eye reads. Reported only when it is
  // not already covered by a group subtotal.
  const stacked = rows.filter(r => r.stacked);
  const stackGroups = new Set(stacked.map(r => r.group ?? r.id));
  const total = stacked.length > 1 && stackGroups.size > 1
    ? stacked.reduce((a, r) => a + r.value, 0)
    : null;

  return {
    label, categorical, rows, groups, total,
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
/** @param band  true for BAR charts, whose values occupy slots rather than sitting at points.
 *
 *  ⚠️ LINES AND BARS DO NOT SHARE AN X MODEL, AND THIS ASSUMED THEY DID. A line's point `i` sits AT
 *  `width * i/(n-1)` — first point on the left edge, last on the right. A bar's group `i` OCCUPIES
 *  `[i, i+1) * width/n`, centred half a slot in. Reading a bar chart with the point model puts the
 *  centres in the right place and every BOUNDARY in the wrong one: on a six-bar chart 652px wide the
 *  hover flips 43px away from the bar edge, so a third of each end bar reads as its neighbour.
 *
 *  Point-model default, so every line, area and stack keeps today's behaviour exactly.
 */
export function indexAt(px, { left, width, n, band = false }) {
  if (!n || n < 1 || !Number.isFinite(px)) return null;
  if (n === 1) return 0;
  const f = (px - left) / (width || 1);
  const raw = band ? Math.floor(f * n) : Math.round(f * (n - 1));
  return Math.max(0, Math.min(n - 1, raw));
}

/** Where index `i` sits on the axis, in the same model `indexAt` reads. Used by the keyboard path, so a
 *  guide line arrowed onto a bar lands ON the bar rather than on its edge. */
export const xOfIndex = (i, { width, n, band = false }) =>
  (band ? (width * (i + 0.5)) / Math.max(1, n) : (width * i) / Math.max(1, n - 1));

/** Where the tooltip sits, given the pointer and the box it must stay inside.
 *
 *  ⚠️ IT FLIPS BEFORE THE EDGE AND NEVER COVERS THE HOVERED COLUMN. A tooltip that hides the thing it
 *  describes makes people move the pointer to see what they were reading, which moves the tooltip.
 */
export function placeTip(px, py, { w, h, tipW = 230, tipH = 120, gap = 14 }) {
  // ⚠️ 230, WHICH IS THE `foreignObject`'S ACTUAL WIDTH. It defaulted to 210 while the element was 230,
  // so a tooltip at the far right edge escaped by 20px — harmless while the layer had
  // `overflow:visible` and a horizontal page scroll the moment it did not.
  // **A default that disagrees with the element it positions is a bug waiting for the other thing to
  // change**, which is exactly what happened.
  const flip = px + gap + tipW > w;
  return {
    // Clamped to the canvas at BOTH ends, so no pointer position can push it out.
    x: Math.min(Math.max(4, flip ? px - gap - tipW : px + gap), Math.max(4, w - tipW - 4)),
    y: Math.max(4, Math.min(h - tipH - 4, py - tipH / 2)),
    flipped: flip,
  };
}


/** What one ROW of a row-shaped chart says.
 *
 *  ⚠️ FIVE RENDERERS ARE ROW-SHAPED, NOT SERIES-SHAPED — `HBars`, `Pace`, `Goals`, `Milestones`,
 *  `Diverging`. The time-axis hover does not fit them: there is no index into a month, and the thing
 *  under the pointer is a whole row rather than a column across every series.
 *
 *  **The difference is real, so this is a second function rather than a flag on the first.** Forcing
 *  one shape to answer both questions is how `spec.rows` and `spec.series` got conflated in the lens.
 */
export function rowAt(spec, i) {
  const rows = spec?.rows || [];
  const r = rows[i];
  if (!r) return null;

  // A row carries EITHER `segments` (a share or magnitude bar) or a bare value.
  const segs = Array.isArray(r.segments) ? r.segments : null;
  const parts = segs
    ? segs.filter(sg => Number.isFinite(Number(sg?.value)))
          .map(sg => ({ label: sg.label || sg.id || "", value: Number(sg.value),
                        color: sg.color || null, tone: sg.tone || null }))
    : (Number.isFinite(Number(r.value)) ? [{ label: r.label, value: Number(r.value) }] : []);

  return {
    label: r.label ?? String(i),
    parts,
    // ⚠️ THE TOTAL IS THE MAGNITUDE SUM, matching what the bar actually occupies. A share row whose
    // segments are 60 and 40 reads as 100, which is the number the width represents.
    total: parts.length > 1 ? parts.reduce((a, p) => a + p.value, 0) : null,
    // Carried through for the renderers that have one — `Goals` and `Milestones` have dates, `Pace` a
    // rate. Absent rather than invented where there is none.
    note: r.note || r.sub || null,
    format: spec.format || "money",
  };
}

/** Which row a pointer at `py` is over. Rows are a fixed height, unlike months. */
export const rowIndexAt = (py, { top, rowH, count }) => {
  if (!count || !rowH) return null;
  const i = Math.floor((py - top) / rowH);
  return i >= 0 && i < count ? i : null;
};
