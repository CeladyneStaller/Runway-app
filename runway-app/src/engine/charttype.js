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

/** Whether stacking may be offered for a selection, and why not when it may not. */
export function stackRefusal(measures = [], overlapping = []) {
  // A BALANCE IS A POSITION. Stacking two positions — in either shape — produces a number with no
  // referent, so this refuses regardless of the shape chosen.
  const position = measures.find(m => m && m.position);
  if (position) return `${position.label} is a balance, not a flow — balances do not sum.`;
  if (overlapping.length) {
    return "These measures overlap, so a stack would not add up.";
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
