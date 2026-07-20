

// Parse a File (CSV or Excel) into a raw grid { headers, rows }. SheetJS reads both to the same
// array-of-arrays, so one path covers every format. Dynamically imports xlsx (it's 60% of the bundle;
// only load it when someone actually imports). Async because both the file read and the xlsx import
// are async.
export async function fileToGrid(file) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  // first non-empty row is the header; the rest are data
  let hi = 0;
  while (hi < aoa.length && aoa[hi].every(c => c === "" || c == null)) hi++;
  const headers = (aoa[hi] || []).map(h => String(h).trim());
  const rows = aoa.slice(hi + 1).filter(r => r.some(c => c !== "" && c != null));
  return { headers, rows };
}

// ---- column-mapping profile: a raw grid -> ImportRow[] ----
//
// The whole point of Piece 4: the app never assumes column names. A file becomes a raw grid (headers +
// rows of cells; SheetJS parses CSV and Excel to this identically), and a PROFILE says which column
// feeds which field. Map once, save the profile, reuse it. That makes this a general expense importer
// that QuickBooks — or Xero, or a bank export, or a hand spreadsheet — happens to feed.
//
//   Grid    = { headers: string[], rows: (string|number)[][] }
//   Profile = { columns: { date, amount, code?, customer?, category?, period?, kind?, note? },
//               dateFormat: "YMD" | "MDY" | "DMY",   // resolves 03/04 ambiguity — the user declares it
//               amountMode: "signed" | "expensesPositive" | "debitCredit",
//               kindColumn?, kindRevenueValue? }      // how to tell revenue rows from cost rows

// Amount parsing. QuickBooks writes money several ways; the profile says which, so we never guess.
// Returns { amount: magnitude>=0, kind: "cost"|"revenue" } or null if unparseable.
export function parseAmount(raw, mode = "signed") {
  if (raw == null || raw === "") return null;
  let str = String(raw).trim();
  const paren = /^\(.*\)$/.test(str);        // (1,234.00) => negative, accounting style
  str = str.replace(/[()$£€,\s]/g, "");
  let n = Number(str);
  if (!Number.isFinite(n)) return null;
  if (paren) n = -Math.abs(n);
  // interpret sign by mode
  if (mode === "expensesPositive") return { amount: Math.abs(n), kind: "cost" };
  // signed / debitCredit: a positive number is cost (money out), negative is revenue (money in).
  // This matches a typical expense-register export; the profile's kindColumn can override per-row.
  return n >= 0 ? { amount: n, kind: "cost" } : { amount: -n, kind: "revenue" };
}

// Date parsing under a declared format. No inference — 03/04/2026 is March 4 or April 3 depending
// ENTIRELY on the profile, because a column of valid dates cannot disambiguate itself. Returns a
// Date (local, noon to dodge DST edges) or null.
export function parseDateWith(raw, format = "YMD") {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const str = String(raw).trim();
  const parts = str.match(/(\d+)[-/.](\d+)[-/.](\d+)/);
  if (!parts) { const d = new Date(str); return Number.isNaN(d.getTime()) ? null : d; }
  let [, a, b, c] = parts.map(Number ? (x) => x : (x) => x);
  a = +parts[1]; b = +parts[2]; c = +parts[3];
  let y, mo, day;
  if (format === "YMD") { y = a; mo = b; day = c; }
  else if (format === "MDY") { mo = a; day = b; y = c; }
  else { day = a; mo = b; y = c; }                 // DMY
  if (y < 100) y += 2000;                            // two-digit year
  const d = new Date(y, mo - 1, day, 12);            // noon local
  return Number.isNaN(d.getTime()) ? null : d;
}

// Apply a profile to a raw grid -> ImportRow[]. Pure and fully testable without any real file.
export function applyProfile(grid, profile) {
  const idx = {};
  const H = (grid.headers || []).map(h => String(h).trim());
  for (const [field, colName] of Object.entries(profile.columns || {})) {
    if (colName == null || colName === "") continue;
    const i = H.indexOf(String(colName).trim());
    if (i >= 0) idx[field] = i;
  }
  const cell = (row, field) => (idx[field] != null ? row[idx[field]] : undefined);
  const out = [];
  for (const row of grid.rows || []) {
    const parsedAmt = parseAmount(cell(row, "amount"), profile.amountMode || "signed");
    const date = parseDateWith(cell(row, "date"), profile.dateFormat || "YMD");
    // rows that don't yield a date+amount are subtotals/blank lines; mergeImport already counts them
    if (!date || !parsedAmt) { out.push({ date: date || null, amount: parsedAmt ? parsedAmt.amount : NaN }); continue; }
    let kind = parsedAmt.kind;
    if (profile.kindColumn) {
      const kv = String(cell(row, "kind") ?? "").trim().toLowerCase();
      if (kv) kind = (kv === String(profile.kindRevenueValue ?? "revenue").toLowerCase()) ? "revenue" : "cost";
    }
    const period = cell(row, "period");
    out.push({
      date,
      amount: parsedAmt.amount,
      kind,
      code: cell(row, "code") != null ? String(cell(row, "code")).trim() : undefined,
      customer: cell(row, "customer") != null ? String(cell(row, "customer")).trim() : undefined,
      category: cell(row, "category") != null ? String(cell(row, "category")).trim().toLowerCase() : undefined,
      period: Number.isFinite(+period) && period !== "" && period != null ? +period : undefined,
      note: cell(row, "note") != null ? String(cell(row, "note")).trim() : undefined,
    });
  }
  return out;
}

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
