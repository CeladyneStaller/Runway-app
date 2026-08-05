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
import { empCostAt } from "./payroll.js";
import { debtLines } from "./capital.js";
import { periodEnd } from "./time.js";

const clean = (n) => (Number.isFinite(n) ? n : 0);
const DAY = 86400000;

/** Unpaid, in payment order. Ordering matters: cover is cumulative, so the sequence IS the arithmetic. */
export function unpaidCommitments(doc) {
  // STORED ONLY — cost share is deliberately NOT here.
  //
  // A grant's cost share is not an extra cost. `computeGrant` splits ONE budget into a federal share
  // and your share, and the project's `cashOut` is the WHOLE budget either way: setting `costSharePct`
  // to zero leaves the runway unchanged, because you spend the same and are simply reimbursed less.
  //
  // So that money is ALREADY LEAVING in the projection, month by month, as project spend. Including it
  // here made `commitmentPressure` subtract it a second time when computing covered runway — the same
  // cash counted twice, reading as a 0.15-month gap that did not exist.
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

/** What a wind-down would cost in payroll.
 *
 *  ONE COMPANY-WIDE NOTICE PERIOD, not one per person. A per-employee field would be empty for most
 *  people in most models, and a closure figure computed from mostly-empty fields is worse than one
 *  computed from a stated assumption — so the assumption is stated beside the number instead.
 */
export function windDownCost(doc) {
  const weeks = clean(doc?.settings?.noticeWeeks ?? 4);
  if (weeks <= 0) return 0;
  // `empCostAt` IS THE PAYROLL FUNCTION THE MODEL ALREADY USES — salary, basis, raises applied, fringe
  // on top. My first version read `e.salary / 12`, a field that does not exist, and returned zero for
  // every model: the wind-down cost silently vanished and covered runway read as though nobody worked
  // here. A number that is quietly zero is worse than one that is obviously wrong.
  const fr = clean(doc?.settings?.fringePct ?? 0.3);
  const monthly = (doc?.employees || []).reduce((a, e) => a + clean(empCostAt(e, 0, fr)), 0);
  return monthly * (weeks / 4.33);
}

/** Cost share accrued but not matchable — the clawback AND the unmatchable figure.
 *
 *  ONE NUMBER DOING TWO JOBS, deliberately. It is what a funder would ask for if you closed at `t`, so
 *  it belongs in `closureDebt`; it is also what you cannot currently match, so it belongs in
 *  `uncovered`. Two computations would eventually produce two figures for one fact.
 *
 *  ⚠️ ELIGIBLE FUNDS ARE APPROXIMATED from cumulative non-grant inflow. The engine has no cash
 *  provenance — the projection produces one undifferentiated balance — and giving cash a source class
 *  is a far larger change. This is right in the case that matters (a company funded solely by an award
 *  has zero eligible funds, so the whole accrued match is a shortfall, which is TRUE) and wrong at the
 *  margin where money is fungible in practice. The interface says which it is doing.
 */
export function shortfallAt(doc, rows, month) {
  const accrued = accruedCostShare(doc, month);
  if (accrued <= 0) return 0;
  let eligible = 0;
  for (let m = 0; m <= clean(month) && m < (rows?.length || 0); m++) {
    eligible += clean(rows[m]?.inNonGrant);
  }
  // BOUNDED BY WHAT HAS ACCRUED, never by the award. A company closing in month 3 owes the match on
  // three months of billing — using the award total would be alarmist by the whole remaining term.
  return Math.max(0, accrued - Math.min(accrued, eligible));
}

/** Pressure from everything signed and unpaid.
 *
 *  Returns null when there is nothing committed — the common case, and the one where this must cost
 *  nothing and change nothing.
 */
export function commitmentPressure(doc, rows, { today = new Date() } = {}) {
  if (!doc || !Array.isArray(rows) || !rows.length) return null;
  const list = unpaidCommitments(doc);
  // Cost share alone is still worth a tab: nothing is owed on top of the plan, but the unreimbursed
  // portion is a real figure somebody should see.
  const hasCostShare = costShareCommitments(doc).length > 0;
  if (!list.length && !hasCostShare) return null;

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

  // TWO DISTINCT FAILURES, because they have different remedies and folding them together hides that.
  //
  //   unpayable   — a payment falls due after the cash runs out. Fixed by money, or by moving the date.
  //   unmatchable — cost share you could not meet from ELIGIBLE funds. Fixed by non-grant money
  //                 specifically, and by nothing else: a bank balance made entirely of drawdowns
  //                 against an award cannot match that award.
  //
  // Unpayable counts BOTH debt and planned, unlike the clean-exit date. The questions differ: this one
  // asks "will I be able to pay this", which is true of a patent fee; the exit date asks "can I close
  // cleanly", which is not.
  const unpayable = out.filter(r => !r.covered).reduce((a, r) => a + clean(r.amount), 0);

  // Measured at the moment the cash runs out — by then, this much match is unmet and would be asked
  // for. Measuring at the end of the horizon would report a shortfall for a company that is already
  // long gone.
  const zeroAt = rows.findIndex(r => r.end < 0);
  const unmatchable = shortfallAt(doc, rows, zeroAt >= 0 ? zeroAt : rows.length - 1);

  // Kept as the sum for anything still reading it, and named so the two parts are the real interface.
  const uncovered = unpayable + unmatchable;

  // ── COVERED RUNWAY: THE SOLVENT WIND-DOWN DATE ─────────────────────────────────────────────────
  //
  // NOT "cash minus what you have signed". That was the previous definition and it double-counted: every
  // commitment is ALREADY in the projection — that is what "every commitment owns exactly one outflow"
  // guarantees — so subtracting it again charged the same money twice. The proof was a promoted line:
  // same line, same projection, and covered runway moved from 5.10 to 4.41 purely because somebody
  // marked it signed. No cash had moved.
  //
  // THE RIGHT QUESTION IS DIFFERENT: at each month, could you stop trading and still pay everyone?
  // That is a COMPARISON, not a subtraction, so it cannot double-count by construction — nothing is
  // ever taken off the balance.
  //
  //   closureDebt(t) = payments marked DEBT and not yet paid
  //                  + payments with no due date          (triggered BY closing)
  //                  + shortfall(t)                       (unmet cost share — the clawback)
  //                  + payroll wind-down                  (noticeWeeks of the current payroll)
  //
  // Recurring commitments appear nowhere in it. They are in the projection and they STOP when you do,
  // which is exactly why they need no special handling. A lease's rent is not a closure debt; its break
  // fee is, and that is a payment with no due date.
  const closureDebt = (t) => {
    let owed = 0;
    for (const c of list) {
      if (c.flavor !== "payment") continue;
      // A PLANNED cost is one you would simply not incur. A patent renewal you would abandon is not a
      // reason to think you are heading for bankruptcy; an invoice for goods already received is.
      if (c.kind !== "debt") continue;
      // Already paid by month t in the projection, so it is not outstanding at closure.
      if (c.payMonth != null && c.payMonth <= t) continue;
      owed += clean(c.amount);
    }
    owed += shortfallAt(doc, rows, t);
    owed += windDownCost(doc);
    // Drawn debt: a signed obligation that lived only in the capital stack and never in this figure.
    owed += outstandingDebt(doc, t);
    return owed;
  };

  let coveredMonths = null, coveredAt = null;
  for (let m = 0; m < rows.length; m++) {
    const { bal, date } = cashAtMonthEnd(rows, startY, startM, m);
    if (bal == null) continue;
    const debt = closureDebt(m);
    if (bal < debt) {
      // FRACTIONAL, so it is comparable with runway. Reporting whole months is what produced a covered
      // runway of 6.0 against a runway of 5.6 in the first version — longer, which is nonsense, and a
      // units mismatch reading as a finding. Interpolate across the month in which the cushion is lost.
      const prev = m > 0 ? cashAtMonthEnd(rows, startY, startM, m - 1) : { bal: rows[0]?.start ?? 0 };
      const prevSlack = (prev.bal ?? 0) - closureDebt(Math.max(0, m - 1));
      const slack = bal - debt;
      const frac = prevSlack > 0 && prevSlack !== slack ? prevSlack / (prevSlack - slack) : 0;
      coveredMonths = Math.max(0, m + Math.min(1, Math.max(0, frac)));
      coveredAt = date;
      break;
    }
  }

  const next = out.find(r => !r.overdue) || out[0] || null;

  // Reported, never counted. It belongs on the tab — "of what you are spending, this much is never
  // reimbursed" is worth knowing — but it must not move covered runway, which asks whether the cash can
  // cover what has been promised ON TOP of the plan.
  const costShare = costShareCommitments(doc)
    .map(c => ({ ...c, dueAt: cashAtMonthEnd(rows, startY, startM, c.payMonth).date }))
    .sort((a, b) => a.payMonth - b.payMonth);
  const costShareTotal = costShare.reduce((a, c) => a + clean(c.amount), 0);

  return {
    costShare,
    costShareTotal,
    unpaid,
    unpayable,
    unmatchable,
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
    flavor: "indexed",     // scales with what is billed, and stops when the billing does
    kind: "debt",          // the ACCRUED part survives closure as a clawback
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
    flavor: "payment",
    kind: "debt",                // marking a planned cost SIGNED is what makes it a debt
    lineId,                      // OWNED, not duplicated
    status: "committed",
    paidRef: null,
  };
  return { ...doc, commitments: [...(doc?.commitments || []), c] };
}

/** Add one that was never planned. It CREATES its cost line, so the invariant holds either way. */
export function addManual(doc, draft = {}) {
  const {
    label, signedMonth, payMonth, amount, projectId = null,
    // PROVENANCE IS CARRIED, NOT OVERWRITTEN.
    //
    // `payablesToCommitments` sets `source: "qbo"` and an `extRef`, and this function used to hardcode
    // `source: "manual"` and drop the rest. Two consequences: the "unpaid bill" chip could never
    // render, and — the real bug — `extRef` was lost, so the duplicate check on the NEXT sync would not
    // recognise the bill and would import it again. It has never fired because nobody has synced twice.
    source = "manual", extRef = null, vendor = null, memo = null,
    // A payment unless told otherwise; recurring and indexed obligations are not entered this way.
    flavor = "payment",
    // DEBT BY DEFAULT. An optimistic default makes the closure figure reassuring by omission, and a
    // number about bankruptcy danger that errs towards comfort is not worth having. Over-cautious is
    // visible and one click from correct.
    kind = "debt",
  } = draft;

  const { index = null } = draft;
  const id = `cm_${Math.random().toString(36).slice(2, 9)}`;
  const lineId = `l_${id}`;

  // ── INDEXED: no line here, because `indexedLines` builds them from the model at projection time.
  // Its amount is not known until the thing it indexes is, so a fixed line would be a guess.
  if (flavor === "indexed") {
    return { ...doc, commitments: [...(doc?.commitments || []), {
      id, label: label || "Indexed commitment", signedMonth: clean(signedMonth), payMonth: null,
      amount: 0, index, projectId, source, extRef, vendor, memo,
      flavor: "indexed", kind: "debt",     // the ACCRUED part survives closure
      lineId: null, status: "committed", paidRef: null,
    }] };
  }

  // ── RECURRING: a real recurring cost line, which is what it is. It STOPS when the model stops, so
  // it needs no closure handling at all — that is the whole reason the flavour exists.
  if (flavor === "recurring") {
    const line = {
      id: lineId, label: label || "Recurring commitment", cadence: "recurring", kind: "cost",
      amount: clean(amount), start: clean(signedMonth), confidence: "committed",
      projectId: projectId || undefined,
    };
    return {
      ...doc,
      lines: [...(doc?.lines || []), line],
      commitments: [...(doc?.commitments || []), {
        id, label: label || "Recurring commitment", signedMonth: clean(signedMonth), payMonth: null,
        amount: clean(amount), projectId, source, extRef, vendor, memo,
        flavor: "recurring", kind: "planned",   // stops on closure, so it is never a closure debt
        lineId, status: "committed", paidRef: null,
      }],
    };
  }

  // A PAYMENT WITH NO DUE DATE CREATES NO LINE. It is triggered by closing, so it never appears in a
  // projection of a company that is still trading — putting it in the plan would spend money on a date
  // nobody has chosen.
  const dated = Number.isFinite(clean(payMonth)) && payMonth != null;
  const line = dated ? {
    id: lineId, label: label || "Commitment", cadence: "onetime", kind: "cost",
    amount: clean(amount), start: clean(payMonth), confidence: "committed",
    projectId: projectId || undefined,
  } : null;

  const c = {
    id, label: label || "Commitment", signedMonth: clean(signedMonth),
    payMonth: dated ? clean(payMonth) : null,
    amount: clean(amount), projectId, source, extRef, vendor, memo,
    flavor, kind: dated ? kind : "debt",     // a closure-triggered cost is a debt by construction
    lineId: line ? lineId : null, status: "committed", paidRef: null,
  };
  return {
    ...doc,
    lines: line ? [...(doc?.lines || []), line] : (doc?.lines || []),
    commitments: [...(doc?.commitments || []), c],
  };
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

/** Change a payment between debt and planned.
 *
 *  DEBT survives closure; PLANNED does not. A closure-triggered payment cannot be planned — it exists
 *  BECAUSE you closed — so the change is refused rather than silently ignored, which would leave the
 *  interface showing a state the engine does not hold.
 */
export function setKind(doc, id, kind) {
  return {
    ...doc,
    commitments: (doc?.commitments || []).map(c => (
      c?.id === id && c.payMonth != null && (kind === "debt" || kind === "planned")
        ? { ...c, kind } : c)),
  };
}

// ── indexed commitments ──────────────────────────────────────────────────────────────────────────

/** Turn indexed commitments into cost lines.
 *
 *  An indexed obligation scales with something the model already computes — a royalty on revenue, a
 *  match on project spend, a share of profit. It cannot be a fixed amount because the amount is not
 *  known until the thing it indexes is.
 *
 *  RUNS AFTER THE OTHER LINES ARE BUILT AND BEFORE THE BALANCE WALK, because it needs the lines to
 *  measure against and must not measure against itself.
 *
 *  ⚠️ PROFIT IS PRE-ROYALTY. A share of profit changes the profit it is a share of, which is circular.
 *  Measuring against profit BEFORE this obligation is both the standard commercial definition and the
 *  only one that terminates — and it is stated in the interface, because a founder reading "5% of
 *  profit" is entitled to know which profit.
 */
export function indexedLines(doc, lineItems, horizon = 60) {
  const out = [];
  for (const c of doc?.commitments || []) {
    if (!c || c.flavor !== "indexed" || c.status === "paid") continue;
    const pct = clean(c.index?.pct);
    if (pct <= 0) continue;
    const of = c.index?.of || "revenue";
    const ref = c.index?.ref || null;

    for (let m = 0; m < horizon; m++) {
      let basis = 0;
      for (const li of lineItems || []) {
        if (!li || li.start > m || (li.end != null && li.end < m)) continue;
        if (li.cadence === "onetime" && li.start !== m) continue;
        const amt = clean(li.amount);
        if (of === "revenue" && li.kind === "revenue") {
          if (!ref || li.projectId === ref) basis += amt;
        } else if (of === "project" && li.kind === "cost") {
          if (ref && li.projectId === ref) basis += amt;
        } else if (of === "profit") {
          basis += li.kind === "revenue" ? amt : -amt;
        }
      }
      const amount = Math.max(0, basis) * pct;
      if (amount <= 0.005) continue;
      out.push({
        id: `ixl_${c.id}_${m}`, label: c.label || "Indexed commitment",
        cadence: "onetime", kind: "cost", amount, start: m,
        confidence: "committed", projectId: c.projectId || undefined,
        indexedFrom: c.id,
      });
    }
  }
  return out;
}

/** Index targets offered in the interface, and what each measures. */
export const INDEX_OF = [
  ["revenue", "Revenue", "A royalty or revenue share. Paid on money in, whether or not you profit."],
  ["project", "Project spend", "Cost share and matching obligations. Scales with what a project spends."],
  ["profit", "Profit", "A share of what is left. Measured BEFORE this obligation, which is both standard and the only definition that terminates."],
];

/** What drawn debt would cost you on the way out.
 *
 *  DRAWN VENTURE DEBT IS A SIGNED OBLIGATION and it was not counted anywhere. It moved the runway,
 *  because the repayments are cost lines, and never the clean-exit date — so a company could look able
 *  to close cleanly while owing a lender the balance of a facility.
 *
 *  ⚠️ THIS IS THE REMAINING SCHEDULED REPAYMENTS, not the principal. On acceleration a lender is owed
 *  principal plus accrued interest, which is LESS than the future payments — those include interest not
 *  yet earned. So this is CONSERVATIVE for amortising debt and exact for a fixed-multiple facility
 *  ("pay back 1.5x"), where the multiple is the whole obligation however early you stop.
 *
 *  Conservative is the right direction for a bankruptcy figure, and the interface says which it is.
 */
export function outstandingDebt(doc, month) {
  const m = clean(month);
  let owed = 0;
  for (const x of doc?.rounds || []) {
    // ONLY DRAWN DEBT. A facility you have been offered and not taken is not a debt — counting a
    // commitment letter would make the exit date depend on a decision nobody has made.
    if (!x || x.kind !== "debt" || x.stage !== "closed") continue;
    let lines = [];
    try { lines = debtLines(x, "committed") || []; } catch { lines = []; }
    for (const l of lines) {
      if (l.kind !== "cost") continue;
      const start = clean(l.start), end = l.end == null ? start : clean(l.end);
      if (l.cadence === "onetime") {
        if (start > m) owed += clean(l.amount);
      } else {
        for (let k = Math.max(start, m + 1); k <= end; k++) owed += clean(l.amount);
      }
    }
  }
  return owed;
}
