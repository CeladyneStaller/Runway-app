// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.

export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export function monthLabel(y, m, idx) {
  return new Date(y, m + idx, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

export const monthLong = (y, m, idx = 0) => new Date(y, m + idx, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

export const dateStamp = (y, m, idx = 0) => new Date(y, m + idx, 1).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const HORIZON = 36;

export const uid = () => Math.random().toString(36).slice(2, 8);

/** How many months a budget period actually runs.
 *
 *  A NO-COST EXTENSION ADDS TIME AND NO MONEY. The same budget spreads over a longer window, so the
 *  monthly draw falls, reimbursements arrive later, and the cost-share deadline moves with the period
 *  end — which is exactly what an NCE does in the world.
 *
 *  PUT HERE, in the one place a period's length is decided, so everything downstream follows without
 *  being told: spend spreading, reimbursement timing, the burn split, the pace charts. A second
 *  definition of "how long is this period" is how an extension gets honoured in one place and not
 *  another.
 */
export const nMon = (p) => (p.end - p.start + 1 + (Number(p.nceMonths) || 0));

/** The last month of a period, extension included. */
export const periodEnd = (p) => (p.end + (Number(p.nceMonths) || 0));

export const clampM = (m) => Math.max(0, Math.min(HORIZON, Math.round(m)));

// Same floor, no ceiling: for placing money in time. Past the horizon a line simply never fires,
// which is honest — the projection does not run that far. Clamping instead would move the money.
export const floorM = (m) => Math.max(0, Math.round(m) || 0);

export const dateShort = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

export const dateLong = (d) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
