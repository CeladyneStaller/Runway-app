// ── Transforms of a measure, not measures of their own ───────────────────────────────────────────
//
// ⚠️ "MODEL" APPEARS ON FIVE TABS AND "CUMULATIVE" ON FOUR. As registry entries that is roughly fifteen
// hand-written duplicates, and it cannot express "cumulative model" or "variance of cumulative" — which
// somebody will want the day after launch. As modifiers it is 7 measures x 3 toggles from 10
// declarations, and the combinations come free.
//
// VARIANCE IS DEFINITIONALLY THE GAP THE MODEL TOGGLE DRAWS, so it is not a third thing to build: turn
// on Model, turn on Variance, and you get the difference rather than the two lines.

/** A running total. */
export const cumulate = (vals) => {
  let run = 0;
  return (vals || []).map(v => (run += Number(v) || 0));
};

/** ⚠️ CUMULATIVE IS MEANINGLESS ON A STOCK. Headcount summed over months gives person-months, which is
 *  a real unit and never what anybody meant. A balance summed gives nothing at all. Declared per
 *  measure rather than guessed, so the control can say why. */
export const canCumulate = (m) => !!m && !m.position && m.unit !== "people";

/** ⚠️ THE MODEL TOGGLE PAIRS A MEASURE WITH ITS COUNTERPART — projected against recorded — and works
 *  from EITHER side. On Spend history the measures read history and it adds the projection; on Cash
 *  flow they read the projection and it adds the actuals. **The person should not have to know which
 *  side they started on**, which is why it is "show both" rather than "add the model".
 */
export const canModel = (m) => !!m?.hasActual;

/** The label for a paired series, so a legend of six reads as three pairs. */
export const pairLabel = (label, which) => `${label} · ${which === "model" ? "model" : "actual"}`;

/**
 * Apply the toggles to one dataset's values.
 *
 * @returns [{ suffix, values, dashed }] — one entry per series this dataset should draw.
 */
export function applyModifiers(spec, m, values, actual) {
  const out = [];
  const cum = spec?.cumulative && canCumulate(m);
  const shape = (v) => (cum ? cumulate(v) : v);

  // ⚠️ VARIANCE REPLACES BOTH SERIES RATHER THAN ADDING A THIRD. Drawing model, actual AND their
  // difference on one chart states the same fact twice and invites reading the gap in two places.
  if (spec?.variance && canModel(m) && actual) {
    const a = shape(actual), b = shape(values);
    return [{ suffix: "variance", label: `${m.label} · variance`,
              values: a.map((v, i) => v - (b[i] ?? 0)) }];
  }

  out.push({ suffix: null, label: cum ? `${m.label} · cumulative` : m.label, values: shape(values) });
  if (spec?.model && canModel(m) && actual) {
    // DASHED, LIKE EVERY OTHER PROJECTION IN THIS PRODUCT — the actuals/projection divide already uses
    // solid-becomes-dashed, so a modelled series reads the same way without a new convention.
    out[0].label = pairLabel(m.label, "actual");
    out.push({ suffix: "model", label: pairLabel(m.label, "model"),
               values: shape(values), dashed: true });
    out[0].values = shape(actual);
  }
  return out;
}
