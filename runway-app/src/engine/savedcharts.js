// ── Saved charts, and which one a tab opens on ───────────────────────────────────────────────────
//
// ⚠️ SAVING ADDS; IT NEVER OVERWRITES. An earlier draft of the proposal had one saved chart per tab, on
// the reasoning that it kept the tab from becoming a gallery. That was wrong in a way worth naming: the
// curated charts are ALREADY a menu, so the tab is already a gallery — and a single slot would have
// made every save a silent replacement of a colleague's work.
//
// ⚠️ AND SAVING IS NOT THE SAME ACT AS SETTING THE DEFAULT. Saving makes a chart AVAILABLE; setting the
// default makes it the one people LAND ON. Different scopes, different permissions — anyone may save,
// only an owner may set the default.

const uid = () => `chart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function saveChart(doc, tab, cfg, { name, savedBy } = {}) {
  const trimmed = String(name || "").trim();
  // ⚠️ A NAME IS REQUIRED TO SAVE, AND ONLY TO SAVE. Not for tidiness — being made to name what a chart
  // shows is the cheapest available check that the person knows. An unsaved view needs none, because
  // nobody else will read it.
  if (!trimmed) return { doc, error: "Give the chart a name before saving it." };

  const chart = {
    id: uid(), tab, name: trimmed,
    // ⚠️ THE WHOLE DATASET, NOT `{ id, type }`. This kept exactly two fields — and `type` is the one
    // deleted when shape and stacking replaced it — so **every per-dataset setting was discarded at the
    // moment of saving**: mixed shapes collapsed to one, negation was undone, sign colouring was
    // undone. The chart drew correctly right up until it was made permanent.
    //
    // Written as an explicit pick rather than a spread, because a saved chart is a stored SHAPE: a
    // spread would silently persist whatever transient state the builder happened to be holding.
    measures: (cfg?.measures || []).map(m => ({
      id: m.id,
      by: m.by ?? null,
      shape: m.shape || "lines",
      stacked: !!m.stacked,
      axis: m.axis || null,
      negate: !!m.negate,
      signColor: !!m.signColor,
    })),
    across: cfg?.across || "month", orient: cfg?.orient || "x",
    savedBy: savedBy || null, savedAt: new Date().toISOString(),
  };
  return {
    doc: { ...doc, settings: { ...(doc.settings || {}),
      savedCharts: [...(doc.settings?.savedCharts || []), chart] } },
    chart, error: null,
  };
}

export const savedFor = (doc, tab) =>
  (doc?.settings?.savedCharts || []).filter(c => c.tab === tab);

export const savedById = (doc, id) =>
  (doc?.settings?.savedCharts || []).find(c => c.id === id) || null;

/** ⚠️ ONE FIELD HOLDING EITHER KIND OF ID — a curated chart id or a saved chart id.
 *
 *  A separate "is it custom" flag would be a second thing to keep in step with the first, and the two
 *  would disagree the first time somebody deleted a saved chart.
 */
export function setDefaultChart(doc, tab, id, { isOwner } = {}) {
  // OWNER ONLY. It is the one control here that changes what another person sees.
  if (!isOwner) return { doc, error: "Only an owner can change the default chart." };
  return {
    doc: { ...doc, settings: { ...(doc.settings || {}),
      chartDefault: { ...(doc.settings?.chartDefault || {}), [tab]: id } } },
    error: null,
  };
}

export const defaultChartId = (doc, tab) => doc?.settings?.chartDefault?.[tab] ?? null;

/** What deleting a saved chart takes with it, so the question can be answered rather than discovered. */
export function deleteImpact(doc, id) {
  const chart = savedById(doc, id);
  if (!chart) return null;
  const isDefault = defaultChartId(doc, chart.tab) === id;
  return { name: chart.name, tab: chart.tab, isDefault };
}

/** ⚠️ DELETING THE DEFAULT FALLS BACK TO THE CURATED ONE, and the caller is told so BEFORE the delete.
 *
 *  Same rule as deleting a thrust with milestones under it: an outcome somebody should answer, not
 *  discover.
 */
export function deleteChart(doc, id) {
  const chart = savedById(doc, id);
  if (!chart) return { doc, error: "That chart no longer exists." };
  const settings = { ...(doc.settings || {}) };
  settings.savedCharts = (settings.savedCharts || []).filter(c => c.id !== id);
  if (settings.chartDefault?.[chart.tab] === id) {
    const next = { ...settings.chartDefault };
    delete next[chart.tab];
    settings.chartDefault = next;
  }
  return { doc: { ...doc, settings }, error: null };
}

/** ⚠️ A SAVED CHART OUTLIVES THE MEASURES IT NAMES.
 *
 *  Fields get added and removed as the engine changes. An unrecognised measure is DROPPED AND REPORTED
 *  rather than crashing the tab or leaving a silent gap in the chart.
 */
export function resolveSaved(chart, knownMeasureIds = []) {
  const kept = (chart?.measures || []).filter(m => knownMeasureIds.includes(m.id));
  const lost = (chart?.measures || []).filter(m => !knownMeasureIds.includes(m.id)).map(m => m.id);
  return { ...chart, measures: kept, lost };
}

/** Update a saved chart in place, keeping its id, its place in the menu, and its default status.
 *
 *  ⚠️ THIS IS A DIFFERENT ACT FROM SAVING A NEW ONE, and the difference matters to other people. An
 *  edit that saved a copy would leave the original as the company default while the person who fixed it
 *  looked at their corrected version — two charts with almost the same name and no way to tell which
 *  one everybody else lands on.
 *
 *  Keeping the id means a chart that IS the default stays the default, which is what somebody
 *  correcting a mistake in it expects.
 */
export function updateChart(doc, id, cfg, { name } = {}) {
  const existing = savedById(doc, id);
  if (!existing) return { doc, error: "That chart no longer exists." };
  const trimmed = String(name ?? existing.name).trim();
  if (!trimmed) return { doc, error: "Give the chart a name before saving it." };
  const next = {
    ...existing, name: trimmed,
    // ⚠️ THE WHOLE DATASET, NOT `{ id, type }`. This kept exactly two fields — and `type` is the one
    // deleted when shape and stacking replaced it — so **every per-dataset setting was discarded at the
    // moment of saving**: mixed shapes collapsed to one, negation was undone, sign colouring was
    // undone. The chart drew correctly right up until it was made permanent.
    //
    // Written as an explicit pick rather than a spread, because a saved chart is a stored SHAPE: a
    // spread would silently persist whatever transient state the builder happened to be holding.
    measures: (cfg?.measures || []).map(m => ({
      id: m.id,
      by: m.by ?? null,
      shape: m.shape || "lines",
      stacked: !!m.stacked,
      axis: m.axis || null,
      negate: !!m.negate,
      signColor: !!m.signColor,
    })),
    across: cfg?.across || "month", orient: cfg?.orient || "x",
    editedAt: new Date().toISOString(),
  };
  return {
    doc: { ...doc, settings: { ...(doc.settings || {}),
      savedCharts: (doc.settings?.savedCharts || []).map(c => (c.id === id ? next : c)) } },
    chart: next, error: null,
  };
}
