// ── Shape, stacking, orientation, axis ───────────────────────────────────────────────────────────
//
// ⚠️ FOUR OUTCOMES FROM THREE CONTROLS. As four mutually exclusive buttons — line / bar / stack / area
// — "stacked" could only ever mean stacked BARS, and a stacked filled LINE was unexpressible. It is the
// composition-over-time chart, and the renderer could already draw it: `Stack` emits filled paths, not
// rects. **The shape existed; only the way to ask for it was missing.**

export const SHAPES = [["lines", "Line"], ["bars", "Bar"]];

/** What the renderer should be handed, from what the person chose. */
export function renderKind({ shape = "lines", stacked = false, orient = "x" } = {}) {
  // HORIZONTAL BARS ARE THEIR OWN RENDERER, and stacking them is not offered — `hbars` draws one bar
  // per category, which is the shape that makes long names readable in the first place.
  if (orient === "y") return "hbars";
  if (stacked) return "stack";        // filled areas for lines, stacked rects for bars
  return shape === "bars" ? "bars" : "lines";
}

/** ⚠️ TIME RUNS LEFT TO RIGHT, AND THAT IS NOT A PREFERENCE.
 *
 *  Months down the Y axis with values running left is legal SVG and unreadable to anybody. The
 *  orientation control is offered only when the x axis is a category.
 */
export const canOrientY = (across) => across && across !== "month";

/** Whether THIS dataset may be stacked, given what else is stacked beside it.
 *
 *  ⚠️ THE RULE IS ABOUT SAME-STACK CONTAINMENT, AND THIS IS ITS ONE HOME. It lived in three places —
 *  `allowedTypes`, `buildCustom`, and the builder's checkbox — and narrowing two of them left the third
 *  broad, which made the feature ORDER-DEPENDENT: stacking two measures worked before a third overlapping
 *  one was added and was refused after, because the checkbox consulted a rule the engine no longer used.
 *
 *  **A rule with three implementations is a rule with three chances to disagree**, and the disagreement
 *  presents as "it works if you do it in this order", which is the hardest kind to report.
 *
 *  @param me        the measure being asked about
 *  @param overlaps  every containment in the selection, as {outer, inner}
 *  @param stackedIds  ids of the datasets currently stacked — EXCLUDING this one
 */
export function stackRefusal(me, overlaps = [], stackedIds = []) {
  // A BALANCE IS A POSITION. Stacking two positions produces a number with no referent, in any shape.
  if (me?.position) return `${me.label} is a balance, not a flow — balances do not sum.`;

  const others = new Set(stackedIds.filter(id => id !== me?.id));
  const clash = overlaps.find(o =>
    (o.outer === me?.id && others.has(o.inner)) || (o.inner === me?.id && others.has(o.outer)));
  if (clash) {
    const otherId = clash.outer === me?.id ? clash.inner : clash.outer;
    // NAMES THE MEASURE IT WOULD DOUBLE-COUNT WITH, because "these overlap" leaves the reader to work
    // out which of four datasets is meant.
    return `Already counted together with ${otherId} — stacking both would not add up.`;
  }
  return null;
}

/** ⚠️ AT MOST TWO VALUE AXES, AND THE PERSON MAY NOW CHOOSE WHICH SIDE.
 *
 *  The builder assigned the second unit to the right automatically. That is the right DEFAULT and a
 *  poor rule: with two money measures at very different magnitudes — headcount against payroll cost,
 *  or a $6M raise against a $40k line — the reader wants the choice even though the units agree.
 */
export function axesFor(measures = []) {
  const units = [...new Set(measures.map(m => m?.unit).filter(Boolean))];
  return measures.map(m => ({
    id: m.id,
    // an explicit choice wins; otherwise the second unit goes right
    axis: m.axis || (units.length > 1 && m.unit === units[1] ? "right" : "left"),
    unit: m.unit,
  }));
}
