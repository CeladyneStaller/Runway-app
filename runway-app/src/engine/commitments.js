// What you have signed for and not yet paid.
//
// THE ONE PLACE THAT COMPUTES THIS, in the same way `solvency()` is the one place that knows about
// insolvency. A second definition of "covered runway" would eventually disagree with this one, and both
// would look authoritative.
//
// RUNWAY DOES NOT CHANGE. `zeroInfo` is untouched and the golden number does not move. What is added is
// a SECOND reading beside cash — how long the money lasts if every signed obligation is honoured —
// because "when do I run out" and "can I sign this" are different questions and the first cannot answer
// the second.
//
// THE INVARIANT EVERYTHING RESTS ON: **every commitment owns exactly one outflow.** A commitment
// promoted from a planned cost line REFERENCES that line and creates nothing, so promoting changes no
// cash at all. A manual one creates its own line. Without this, a lease recorded as both a recurring
// cost and a commitment doubles the burn, and the overstatement is silent.

import { balanceAtDate, zeroInfo } from "./projection.js";

const clean = (n) => (Number.isFinite(n) ? n : 0);
const DAY = 86400000;

/** Unpaid, in payment order. Ordering matters: cover is cumulative, so the sequence IS the arithmetic. */
export function unpaidCommitments(doc) {
  return (doc?.commitments || [])
    .filter(c => c && c.status !== "paid" && clean(c.amount) > 0)
    .slice()
    .sort((a, b) => clean(a.payMonth) - clean(b.payMonth));
}

/** The cash on the day a commitment falls due.
 *
 *  MONTH END, NOT MONTH START. Commitments carry a month index and `balanceAtDate` takes a day; a
 *  payment due in a month is due BY ITS END, and reading the balance on the 1st would call an
 *  obligation covered on the strength of money that leaves later the same month. Being wrong by three
 *  weeks in the safe direction is worse than being right.
 */
function cashAtMonthEnd(rows, startY, startM, month) {
  const m = clean(month);
  // Day 0 of the following month is the last instant of this one.
  const d = new Date(startY, startM + m + 1, 0);
  const b = balanceAtDate(rows, startY, startM, d.getFullYear(), d.getMonth(), d.getDate());
  return { bal: b?.bal ?? null, date: d };
}

/** Pressure from everything signed and unpaid.
 *
 *  Returns null when there is nothing committed — the common case, and the one where this must cost
 *  nothing and change nothing.
 */
export function commitmentPressure(doc, rows, { today = new Date() } = {}) {
  if (!doc || !Array.isArray(rows) || !rows.length) return null;
  const list = unpaidCommitments(doc);
  if (!list.length) return null;

  const startY = doc.startY, startM = doc.startM;

  // CUMULATIVE, NOT PER-COMMITMENT. Checking each against the cash on its own day lets two obligations
  // both read "covered" while together they are not — the same failure the milestones chart had, where
  // two dates were individually fine and jointly impossible.
  let running = 0;
  const out = list.map(c => {
    running += clean(c.amount);
    const { bal, date } = cashAtMonthEnd(rows, startY, startM, c.payMonth);
    const spare = bal == null ? null : bal - running;
    const past = date < today && c.status !== "paid";
    return {
      ...c,
      dueAt: date,
      cashOnDay: bal,
      // What is left AFTER honouring this and everything before it.
      spare,
      covered: spare != null && spare >= 0,
      runningTotal: running,
      // Overdue is a different problem from uncovered: the date has passed and nobody marked it paid,
      // which usually means the record is stale rather than the money is missing.
      overdue: past,
      daysPast: past ? Math.round((today - date) / DAY) : null,
    };
  });

  const unpaid = running;
  const uncovered = out.filter(r => !r.covered).reduce((a, r) => a + clean(r.amount), 0);

  // COVERED RUNWAY IS `zeroInfo` ON ADJUSTED ROWS, not a hand-rolled month scan.
  //
  // The first version counted WHOLE MONTHS while `zeroInfo` interpolates within one, and produced a
  // covered runway of 6.0 against a runway of 5.6 — LONGER, which is nonsense. It was a units mismatch
  // reading as a finding, and the sort of number somebody would have repeated in a board meeting.
  //
  // Running the same function over the same rows, with the running obligation subtracted, makes the two
  // numbers comparable by construction: it is still not a second projection, just the same one read
  // against a lower floor.
  const byMonth = new Map();
  for (const c of list) byMonth.set(clean(c.payMonth), (byMonth.get(clean(c.payMonth)) || 0) + clean(c.amount));

  let owed = 0;
  const adjusted = rows.map((r, m) => {
    const before = owed;
    owed += byMonth.get(m) || 0;
    // `start` carries the obligation as at the start of the month; `end` includes anything falling due
    // within it, because a payment due in a month is due by its end.
    return { ...r, start: r.start - before, end: r.end - owed };
  });

  let covered = null;
  try { covered = zeroInfo(adjusted, startY, startM); } catch { covered = null; }
  const coveredMonths = covered?.months ?? null;
  const coveredAt = covered?.date ?? null;

  const next = out.find(r => !r.overdue) || out[0] || null;

  return {
    unpaid,
    uncovered,
    coveredMonths,
    coveredAt,
    // Null means the cash outlasts every obligation inside the horizon — the opposite of a problem, and
    // it must not render as "no answer".
    coveredEndless: coveredMonths == null,
    nextDue: next ? { label: next.label, amount: next.amount, dueAt: next.dueAt } : null,
    overdue: out.filter(r => r.overdue).length,
    rows: out,
  };
}

/** Planned cost lines that could be promoted.
 *
 *  THE PANEL THAT MAKES THE TAB POPULATE ITSELF. Without it somebody has to re-enter costs the model
 *  already holds, and they will not — a tab you fill by hand is a tab nobody fills.
 *
 *  One-time costs only: a recurring line is a lease or a salary, and its whole remaining term being
 *  "uncovered" is true and useless — six figures of unavoidable rent permanently at the top of a list
 *  meant for discrete decisions.
 */
export function promotable(doc) {
  const claimed = new Set((doc?.commitments || []).map(c => c.lineId).filter(Boolean));
  const out = [];
  for (const l of doc?.lines || []) {
    if (!l || l.cadence !== "onetime") continue;
    if (l.kind === "revenue") continue;
    if (claimed.has(l.id)) continue;
    if (clean(l.amount) <= 0) continue;
    out.push({ lineId: l.id, label: l.label || "Cost", amount: clean(l.amount), payMonth: clean(l.start) });
  }
  return out.sort((a, b) => a.payMonth - b.payMonth);
}

/** Promote a planned line. CREATES NO CASH — the line already exists and already moves the money. */
export function promote(doc, lineId, { signedMonth = 0 } = {}) {
  const line = (doc?.lines || []).find(l => l?.id === lineId);
  if (!line) return doc;
  const c = {
    id: `cm_${lineId}`,
    label: line.label || "Cost",
    signedMonth: clean(signedMonth),
    payMonth: clean(line.start),
    amount: clean(line.amount),
    projectId: line.projectId || null,
    source: "plan",
    lineId,                      // OWNED, not duplicated
    status: "committed",
    paidRef: null,
  };
  return { ...doc, commitments: [...(doc?.commitments || []), c] };
}

/** Add one that was never planned. It CREATES its cost line, so the invariant holds either way. */
export function addManual(doc, { label, signedMonth, payMonth, amount, projectId = null }) {
  const id = `cm_${Math.random().toString(36).slice(2, 9)}`;
  const lineId = `l_${id}`;
  const line = {
    id: lineId, label: label || "Commitment", cadence: "onetime", kind: "cost",
    amount: clean(amount), start: clean(payMonth), confidence: "committed",
    projectId: projectId || undefined,
  };
  const c = {
    id, label: label || "Commitment", signedMonth: clean(signedMonth), payMonth: clean(payMonth),
    amount: clean(amount), projectId, source: "manual", lineId, status: "committed", paidRef: null,
  };
  return { ...doc, lines: [...(doc?.lines || []), line], commitments: [...(doc?.commitments || []), c] };
}

/** Remove one. Deletes its cost line ONLY if the commitment created it — a promoted line was in the
 *  plan before the commitment existed and must survive it. */
export function removeCommitment(doc, id) {
  const c = (doc?.commitments || []).find(x => x?.id === id);
  if (!c) return doc;
  const commitments = (doc.commitments || []).filter(x => x.id !== id);
  const lines = c.source === "manual" && c.lineId
    ? (doc.lines || []).filter(l => l?.id !== c.lineId)
    : (doc.lines || []);
  return { ...doc, commitments, lines };
}

/** Mark paid. The obligation stops counting; the cost line stays, because the money still left. */
export function markPaid(doc, id, paidRef = null) {
  return {
    ...doc,
    commitments: (doc?.commitments || []).map(c =>
      (c?.id === id ? { ...c, status: "paid", paidRef } : c)),
  };
}
