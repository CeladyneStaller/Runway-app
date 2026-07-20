// The import seam. Turns already-parsed transaction rows into ledger months and merges them into the
// existing history. Deliberately format-agnostic: a QuickBooks CSV parser, an Excel parser, or a hand
// mock all produce the same ImportRow[]; only they differ. Everything below is pure and testable.
//
//   ImportRow = { date, code?, customer?, category?, period?, kind?, amount, note? }
//   (only date + amount are required; everything else is optional and defaults as in coding.js)
//
// Downstream, coded rows flow through codeMap -> codedActuals -> project actuals, all already built.
// This file's only job is: calendar date -> month index, group, merge.

// Month index of a calendar date relative to the model start (startY, startM). Jul 2026 start:
// Jul 2026 -> 0, Aug 2026 -> 1, Jun 2026 -> -1. Rows before the start keep negative indices; the
// caller decides whether to keep or drop them (we surface them rather than silently dropping).
export function monthIndexOf(date, startY, startM) {
  const parsed = parseLocalDate(date);
  if (!parsed) return null;
  return (parsed.y - startY) * 12 + (parsed.m - startM);
}

// Parse a date to { y, m } (0-based month) in LOCAL terms. The trap: `new Date("2026-08-01")` parses
// an ISO date-only string as UTC midnight, so in any timezone behind UTC (all of the Americas) that
// instant is the evening of July 31 — and getMonth() reads local, so Aug 1 silently becomes July.
// A day-10 date has enough slack to survive; a day-1 date does not. For a runway tool that buckets
// spend by month, that would misfile the 1st of every month for every US user. So: pull Y/M/D out of
// the STRING directly when it looks like a date-only value, and only fall back to Date parsing (which
// is fine for real timestamps and Date objects) otherwise.
function parseLocalDate(date) {
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? null : { y: date.getFullYear(), m: date.getMonth() };
  const str = String(date).trim();
  // ISO-ish date only: 2026-08-01 or 2026/8/1, optionally with a time we can ignore for month bucketing
  const iso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return { y: +iso[1], m: +iso[2] - 1 };
  // US-style: 8/1/2026 or 08-01-2026 (month first — the common QuickBooks-US export)
  const us = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (us) return { y: +us[3], m: +us[1] - 1 };
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : { y: d.getFullYear(), m: d.getMonth() };
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
    const line = { amount };
    if ((r.code || "").trim()) line.code = r.code.trim();
    if ((r.customer || "").trim()) line.customer = r.customer.trim();
    if ((r.note || "").trim()) line.note = r.note.trim();
    if (r.kind === "revenue") line.kind = "revenue";
    if ((r.category || "").trim && (r.category || "").trim()) line.category = r.category.trim();
    if (Number.isFinite(r.period)) line.period = r.period;
    byMonth.get(mi).lines.push(line);
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
