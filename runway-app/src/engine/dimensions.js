// ── What a measure can be broken down BY ─────────────────────────────────────────────────────────
//
// A dimension turns ONE measure into as many series as the data has values. That is what makes this a
// builder rather than a series picker — money out by spend code is eight series nobody had to tick.
//
// ⚠️ EVERY DIMENSION MUST NAME A FIELD THE LINES ACTUALLY CARRY. A grouper that reads a key nothing
// sets puts every line in one bucket labelled "Unassigned", which looks like a company with no
// projects rather than a broken dimension.

export const DIMENSIONS = [
  { id: "code", tab: ["hist", "flow"], label: "Spend code",
    // Ledger lines carry a code; compiled projection lines do not, so this reads history.
    of: (l) => l?.code ?? null,
    labelOf: (k, doc) => (doc?.codeMap?.[k]?.label) || k || "Uncoded" },

  { id: "project", tab: ["flow", "proj", "hist"], label: "Project",
    of: (l) => l?.projectId ?? null,
    labelOf: (k, doc) => (doc?.projects || []).find(p => p.id === k)?.name || "Unassigned",
    // ⚠️ PROJECTS HAVE A TYPE WORTH PRESERVING. "This one is a grant" is information the chart should
    // not delete — so hue carries the type and lightness separates the members.
    typeOf: (k, doc) => (doc?.projects || []).find(p => p.id === k)?.type || "other" },

  { id: "employee", tab: ["pay"], label: "Employee",
    of: (l) => l?.empId ?? null,
    labelOf: (k, doc) => (doc?.employees || []).find(e => e.id === k)?.name || "Unassigned" },

  { id: "customer", tab: ["sales"], label: "Customer",
    of: (l) => l?.poId ?? null,
    labelOf: (k, doc) => (doc?.pos || []).find(p => p.id === k)?.customer || "Unassigned" },

  { id: "instrument", tab: ["inv"], label: "Instrument",
    of: (l) => l?.roundId ?? null,
    labelOf: (k, doc) => (doc?.rounds || []).find(r => r.id === k)?.name || "Unassigned" },

  // SEMANTIC AND FIXED, not allocated from a ramp — a tier means the same thing on every chart.
  // ⚠️ AWARD AND BUDGET PERIOD EXIST NOWHERE ELSE, and they are why this tab needs its own dimensions
  // rather than borrowing the Projects ones. **Cost share is owed per award per period** — that is how
  // a funder audits it, and how the tab already groups its rows.
  { id: "award", tab: ["cmt"], label: "Award",
    of: (c) => c?.projectId ?? c?.source ?? null,
    labelOf: (k, doc) => (doc?.projects || []).find(p => p.id === k)?.name || "Not tied to an award",
    typeOf: (k, doc) => (doc?.projects || []).find(p => p.id === k)?.type || "other" },

  { id: "period", tab: ["cmt"], label: "Budget period",
    of: (c) => (c?.periodIndex != null ? String(c.periodIndex) : null),
    labelOf: (k) => (k == null ? "No period" : `Period ${Number(k) + 1}`) },

  { id: "flavour", tab: ["cmt"], label: "Flavour",
    of: (c) => c?.flavor ?? null,
    labelOf: (k) => ({ payment: "Payment", recurring: "Recurring", indexed: "Indexed" })[k] || k },

  { id: "cmtKind", tab: ["cmt"], label: "Kind",
    of: (c) => c?.kind ?? null,
    // ⚠️ DEBT SURVIVES CLOSURE AND PLANNED DOES NOT — the distinction the clean-exit figure turns on.
    labelOf: (k) => ({ debt: "Survives closure", planned: "Does not survive" })[k] || k },

  { id: "confidence", tab: ["flow", "sales", "inv"], label: "Confidence tier",
    of: (l) => l?.confidence ?? "committed",
    labelOf: (k) => ({ committed: "Committed", expected: "Expected",
                       speculative: "Speculative" })[k] || k },
];

export const dimensionsFor = (tab) => DIMENSIONS.filter(d => d.tab.includes(tab));
export const dimensionById = (id) => DIMENSIONS.find(d => d.id === id) || null;

/** Split a set of lines into monthly series, one per distinct value.
 *
 *  ⚠️ "UNASSIGNED" IS ALWAYS EMITTED WHEN IT HAS VALUE, AND NEVER HIDDEN. Spend belonging to no project
 *  is usually the most interesting series on the chart, and dropping it would make the others sum to
 *  less than the total — a chart that quietly disagrees with the number beside it.
 */
export function splitBy(dim, lines, n, doc) {
  const buckets = new Map();
  for (const l of lines || []) {
    const key = (dim?.of ? dim.of(l) : null) ?? "__none__";
    if (!buckets.has(key)) buckets.set(key, Array.from({ length: n }, () => 0));
    const arr = buckets.get(key);
    const a = Number(l?.amount) || 0;
    const s = Math.max(0, Number(l?.start) || 0);
    const e = l?.end == null ? n - 1 : Number(l.end);
    if (l?.cadence === "onetime") { if (s < n) arr[s] += a; continue; }
    for (let m = s; m <= Math.min(e, n - 1); m++) arr[m] += a;
  }
  return [...buckets.entries()]
    .map(([key, values]) => ({
      id: String(key),
      label: key === "__none__" ? "Unassigned" : (dim?.labelOf ? dim.labelOf(key, doc) : String(key)),
      values,
      unassigned: key === "__none__",
      total: values.reduce((a, b) => a + b, 0),
    }))
    // BIGGEST FIRST, UNASSIGNED LAST. A legend ordered by size matches how somebody reads a stack, and
    // unassigned is an absence rather than a peer.
    .sort((a, b) => (a.unassigned ? 1 : b.unassigned ? -1 : b.total - a.total));
}

/** ⚠️ TOO MANY SERIES IS A CHART NOBODY CAN READ, produced by two reasonable choices.
 *
 *  Three measures by eight spend codes is twenty-four series. The limit is on the RESULT, not on the
 *  number of dropdowns used — two measures against a small dimension is fine.
 */
export const SERIES_LIMIT = 12;
export const tooManySeries = (measureCount, bucketCount) =>
  measureCount * Math.max(1, bucketCount) > SERIES_LIMIT;
