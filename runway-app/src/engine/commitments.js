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
import { computeGrant, isMsBilled } from "./grant.js";
import { lastActualMonth } from "./summary.js";
import { periodEnd } from "./time.js";

const clean = (n) => (Number.isFinite(n) ? n : 0);
const DAY = 86400000;

/** Unpaid, in payment order. Ordering matters: cover is cumulative, so the sequence IS the arithmetic. */
export function unpaidCommitments(doc) {
  return allCommitments(doc)
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

/** Cost-share obligations, derived from the awards themselves.
 *
 *  A COST-SHARE AWARD COMMITS YOU TO SPENDING YOUR OWN MONEY to unlock theirs — an obligation the model
 *  already knows the size of, and which appears nowhere today. `costSharePct` of the budget is money you
 *  have agreed to put in, and failing to put it in does not just cost you the match, it can claw back
 *  what was already drawn.
 *
 *  DERIVED, NOT STORED, so it cannot drift from the award it comes from. Editing the budget moves the
 *  obligation; nobody has to remember to update a second record. The cost is ALREADY in the plan as
 *  project spend, so these create no outflow — same invariant as a promoted line, reached differently.
 */
export function costShareCommitments(doc) {
  const out = [];

  /** Make a project's obligations sum EXACTLY to the award's own cost-share figure.
   *
   *  Rounding each row independently left the total a dollar under — true of every timing, because the
   *  drift comes from rounding parts rather than from any one schedule. Small, and exactly the kind of
   *  discrepancy that becomes "your match is $1 short" in somebody's reconciliation with a funder.
   *
   *  The LAST row absorbs it, because the last row is where a real reconciliation happens. */
  const settle = (rows, target) => {
    if (!rows.length) return;
    const sum = rows.reduce((a, r) => a + r.amount, 0);
    rows[rows.length - 1].amount += Math.round(target) - sum;
  };

  for (const proj of doc?.projects || []) {
    if (!proj || proj.stage === "prospective" || !proj.grant) continue;

    const g = proj.grant;
    let R = null;
    try { R = computeGrant(g); } catch { R = null; }
    if (!R?.per?.length) continue;

    const timing = g.reimburseTiming || "arrears";
    const name = proj.name || "Award";
    const before = out.length;         // where this project's rows begin, for the settle pass

    // BILLED, NOT PLANNED, WHERE WE KNOW IT.
    //
    // Cost share is a percentage of what has ACTUALLY been billed to the award. Dividing a period's
    // share evenly across its months assumes billing runs to plan, and a grant that under-bills for two
    // months then catches up owes a different amount at each point than the even split says.
    //
    // PAST FROM ACTUALS, FUTURE FROM PLAN — the same hybrid the projection itself uses via
    // `anchorToActuals`. Months up to the last recorded actual use what was really billed; beyond it
    // there is nothing to use but the plan, and pretending otherwise would be inventing a figure.
    //
    // This is what the QuickBooks and CSV ledgers feed. Neither is connected here: both write
    // `project.actuals`, and reading that is the whole integration.
    const actuals = proj.actuals || {};
    const lastReal = lastActualMonth(actuals);
    const billedAt = (m) => {
      const v = Number(actuals[m]);
      return Number.isFinite(v) ? v : null;
    };

    // COST SHARE IS DUE AT THE REPRESENTATIVE PERIOD — the period a bill represents. It is verified
    // against what you BILLED, so it falls due on the rhythm you bill on, not on a calendar of its own.
    // A monthly-billed award with an annual cost-share obligation would be twelve small proofs of match,
    // not one large one; treating them all as period-end understated how soon the money was needed.
    //
    // NOTE the lag is deliberately NOT applied. `reimburseLagMonths` is how long the FUNDER takes to
    // pay you; your match is due when you bill, not when they settle. Applying it would push every
    // obligation later by the funder's own slowness, which is backwards.

    if (isMsBilled(g)) {
      // Billed against delivered milestones, so the match is proven per milestone, in proportion to
      // what that milestone draws.
      const ms = (g.milestones || []).filter(m => clean(m.payment) > 0);
      const totalPay = ms.reduce((a, m) => a + clean(m.payment), 0);
      const share = clean(R.grand?.costShare);
      if (share <= 0) continue;
      // A MILESTONE-BILLED AWARD WITH NO MILESTONES YET still owes its match — we simply do not know
      // the rhythm. Falling through to period ends keeps the obligation visible; dropping it would make
      // a real liability vanish because a schedule had not been filled in, which is the same silent
      // disappearance this whole feature exists to prevent.
      if (totalPay <= 0) {
        (g.periods || []).forEach((p, i) => {
          const sh = clean(R.per[i]?.costShare);
          if (sh <= 0) return;
          out.push(mk(proj, g, {
            key: `p${i}`,
            label: `${name} — cost share, period ${i + 1}`,
            signedMonth: clean(p.start), payMonth: periodEnd(p), amount: Math.round(sh),
            accrualFrom: clean(p.start),
          }));
        });
        settle(out.slice(before), clean(R.grand?.costShare));
        continue;
      }

      ms.forEach((m, k) => {
        const amt = share * (clean(m.payment) / totalPay);
        if (amt <= 0) return;
        out.push(mk(proj, g, {
          key: `ms${k}`,
          label: `${name} — cost share, ${m.label || `milestone ${k + 1}`}`,
          signedMonth: clean((g.periods || [])[0]?.start),
          payMonth: clean(m.month),
          amount: Math.round(amt),
          accrualFrom: clean((g.periods || [])[0]?.start),
        }));
      });
      settle(out.slice(before), clean(R.grand?.costShare));
      continue;
    }

    (g.periods || []).forEach((p, i) => {
      const share = clean(R.per[i]?.costShare);
      if (share <= 0) return;
      const start = clean(p.start);
      const end = periodEnd(p);
      const n = Math.max(1, end - start + 1);

      if (timing === "monthly") {
        // Billed as incurred, so matched as incurred: one obligation per month of the period.
        //
        // THE LAST MONTH ABSORBS THE REMAINDER. Rounding each of twelve rows independently left the
        // total a dollar short of the award's own cost-share figure — small, and exactly the kind of
        // discrepancy that turns into "your match is $1 under" in somebody's reconciliation.
        // WEIGHTED BY WHAT WAS BILLED, where a month has a real figure. A period that billed nothing
        // in month one owes nothing for month one — the obligation follows the draw, which is the whole
        // point of doing this against a ledger rather than a calendar.
        //
        // Months with no actual yet fall back to the MEAN OF THE MONTHS THAT DO have one, or to an even
        // split when none do. That is the least invented assumption available: it says "we expect the
        // rest to look like what we have seen", rather than weighting a future month by a guess.
        const billed = [];
        for (let m = start; m <= end; m++) {
          billed.push(lastReal != null && m <= lastReal ? billedAt(m) : null);
        }
        const known = billed.filter(b => b != null);
        const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
        const weights = billed.map(b => (b != null ? Math.max(0, b) : mean));
        const totalW = weights.reduce((a, w) => a + w, 0) || 1;

        let placed = 0;
        for (let m = start, k = 0; m <= end; m++, k++) {
          // The last month absorbs the remainder: rounding each row independently left the total short
          // of the award's own figure, which becomes "your match is $1 under" in a reconciliation.
          const amount = m === end
            ? Math.round(share) - placed
            : Math.round(share * (weights[k] / totalW));
          placed += amount;
          out.push(mk(proj, g, {
            key: `p${i}m${m}`,
            label: `${name} — cost share, ${monthLabel(i, m, start)}`,
            signedMonth: start, payMonth: m, amount, accrualFrom: m,
          }));
        }
        return;
      }

      // `arrears` and `advance` both reconcile at the period's end — arrears because that is when you
      // bill, advance because that is when the funder checks what the advance was spent on. Being paid
      // up front does not move when the match is PROVEN.
      out.push(mk(proj, g, {
        key: `p${i}`,
        label: `${name} — cost share, period ${i + 1}`,
        signedMonth: start, payMonth: end, amount: Math.round(share), accrualFrom: start,
      }));
    });
    settle(out.slice(before), clean(R.grand?.costShare));
  }
  return out;
}

const monthLabel = (periodIdx, m, start) => `BP${periodIdx + 1} month ${m - start + 1}`;

function mk(proj, g, { key, label, signedMonth, payMonth, amount, accrualFrom }) {
  return {
    id: `cs_${proj.id}_${key}`,
    label, signedMonth, payMonth, amount,
    projectId: proj.id,
    source: "grant",
    lineId: null,          // no line of its own: the spend is already in the project
    status: "committed",
    paidRef: null,
    derived: true,         // change the award, not this
    timing: g.reimburseTiming || "arrears",
    // ACCRUES WITH BILLING rather than appearing whole on the due date.
    accrual: { start: accrualFrom, end: payMonth },
  };
}

/** How much cost share has ALREADY accrued by a given month.
 *
 *  The obligation grows with what has been billed: a period half elapsed with spend running to plan has
 *  half its cost share already owed, whatever the due date says. This is what the tab shows beside the
 *  total so an obligation reads as a rising line rather than a future cliff.
 */
export function accruedCostShare(doc, month) {
  const m = clean(month);
  let owed = 0;
  for (const c of costShareCommitments(doc)) {
    // SUMS THE ROWS RATHER THAN INTERPOLATING. The rows are already weighted by what was billed, so
    // interpolating across a period would undo that and hand back a straight line — the exact even
    // split this change exists to replace.
    if (c.payMonth <= m) { owed += c.amount; continue; }
    // The row currently in flight accrues within itself, because a period half elapsed with spend
    // running to plan has half its match already owed whatever the due date says.
    const { start, end } = c.accrual || {};
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (m <= start) continue;
    owed += c.amount * Math.max(0, Math.min(1, (m - start) / (end - start)));
  }
  return owed;
}


/** Everything committed, stored and derived, as one list. */
export function allCommitments(doc) {
  return [...(doc?.commitments || []), ...costShareCommitments(doc)];
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
