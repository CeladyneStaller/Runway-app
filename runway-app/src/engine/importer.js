// The import seam. Turns already-parsed transaction rows into ledger months and merges them into the
// existing history. Deliberately format-agnostic: a QuickBooks CSV parser, an Excel parser, or a hand
// mock all produce the same ImportRow[]; only they differ. Everything below is pure and testable.
//
//   ImportRow = { date: Date | string, code: string, amount: number, note?: string }
//
// Downstream, coded rows flow through codeMap -> codedActuals -> project actuals, all already built.
// This file's only job is: calendar date -> month index, group, merge.

// Month index of a calendar date relative to the model start (startY, startM). Jul 2026 start:
// Jul 2026 -> 0, Aug 2026 -> 1, Jun 2026 -> -1. Rows before the start keep negative indices; the
// caller decides whether to keep or drop them (we surface them rather than silently dropping).
export function monthIndexOf(date, startY, startM) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getFullYear() - startY) * 12 + (d.getMonth() - startM);
}

// Merge parsed rows into an existing ledger (array of { month, lines }). Rows are grouped by month
// index; each becomes a ledger line { code, amount, note }. Existing months are appended to, not
// replaced — an import adds transactions, it doesn't wipe what's there. Returns a NEW ledger plus a
// report of what happened, so the UI can show "42 rows imported, 3 before the start date, skipped".
export function mergeImport(history, rows, startY, startM, { dropBeforeStart = false } = {}) {
  const byMonth = new Map();
  for (const m of history || []) byMonth.set(m.month, { ...m, lines: [...(m.lines || [])] });

  const report = { imported: 0, beforeStart: 0, badDate: 0, badAmount: 0, months: new Set() };

  for (const r of rows || []) {
    const amount = Number(r.amount);
    if (!Number.isFinite(amount)) { report.badAmount++; continue; }
    const mi = monthIndexOf(r.date, startY, startM);
    if (mi == null) { report.badDate++; continue; }
    if (mi < 0) {
      report.beforeStart++;
      if (dropBeforeStart) continue;
    }
    if (!byMonth.has(mi)) byMonth.set(mi, { month: mi, lines: [] });
    byMonth.get(mi).lines.push({
      code: (r.code || "").trim(),
      amount,
      note: (r.note || "").trim(),
    });
    report.imported++;
    report.months.add(mi);
  }

  const merged = [...byMonth.values()].sort((a, b) => a.month - b.month);
  return { history: merged, report: { ...report, months: report.months.size } };
}

// Distinct codes appearing in a set of parsed rows — lets the UI show "these codes will need mapping"
// before committing the import, reusing the same codeMap machinery the manual ledger uses.
export const codesInRows = (rows) => {
  const seen = [];
  for (const r of rows || []) {
    const c = (r.code || "").trim();
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen;
};
