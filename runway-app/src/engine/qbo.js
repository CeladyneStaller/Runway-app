// QBO-PLAN Stage 2 — a QuickBooks report becomes a Grid.
//
// The ONLY step a live source replaces:
//
//     fileToGrid → applyProfile → mergeImport
//          ^ this one
//
// So this file emits `Grid = { headers, rows }` and stops. It decides nothing about MEANING — which
// column is the code, whether an amount is revenue or cost, how dates are ordered — because those
// answers differ per company and the app already has a place for them: the mapping screen, the saved
// profile, and `applyProfile`. Deciding here would be deciding for everyone.
//
// WHY THAT MATTERS CONCRETELY. A landscaping firm's accounts ARE its categories, so `code` should come
// from the account. A nonprofit running four federal awards through one payroll account cannot use the
// account — it just says "Salaries" — and carries the award in a Class or a Customer. Both are one
// dropdown apart in a UI that already exists, and neither is a branch in this file.
//
// PURE, and tested against saved fixtures in `test/engine/qbo.test.js`. Nothing here touches the
// network; fetching is Stage 3's problem and belongs nowhere near the engine.

/** QBO report rows are a TREE. Sections nest, and a line's ACCOUNT is in the enclosing section's
 *  header rather than on the line — so a naive flatten loses the single most important field. This
 *  walk carries two of them down:
 *
 *    Account       — the NEAREST enclosing header. What the transaction was booked to.
 *    Section Path  — every ancestor, joined. Where it sits in the report.
 *
 *  AN EARLIER VERSION EMITTED "Section" AS THE OUTERMOST HEADER, meaning it to be a clean
 *  Income/Expenses column that `profile.kindColumn` could match on. Against a real sandbox report it
 *  produced NINETEEN distinct values: live reports nest deeper and unevenly — sub-accounts inside
 *  sub-groups inside a wrapper — so "outermost" resolves to a different depth on different branches.
 *
 *  Worse, the wrapper Intuit puts at the top is called "Ordinary Income/Expenses". Any rule deciding
 *  revenue-vs-cost by looking for "Income" in the ancestry marks EVERY row as revenue. So this file
 *  emits the path and derives nothing from it; what a name means is not knowable from the name.
 *
 *  The kind question is therefore still open and belongs to the mapping screen, where a person can
 *  see their own accounts. `columnValues(grid, "Account")` is there to show them.
 */
function walk(node, trail, out) {
  for (const row of node?.Row ?? []) {
    // A section's own Summary is a TOTAL, not a transaction. Importing those would double the report
    // and then some. Only leaf rows carrying ColData are data.
    const header = row.Header?.ColData?.map(c => c?.value).filter(Boolean).join(" ") || null;

    if (Array.isArray(row.ColData) && row.type !== "Section") {
      out.push({
        cells: row.ColData.map(c => c?.value ?? ""),
        account: trail.length ? trail[trail.length - 1] : null,
        path: trail.join(" > "),
      });
    }
    // An UNNAMED section still deepens the tree but adds no name — pass the trail through unchanged
    // rather than letting a null push the next level up to the root. That was how a sub-group ended
    // up looking like a top-level one.
    if (row.Rows) walk(row.Rows, header ? [...trail, header] : trail, out);
  }
  return out;
}

/** Duplicate headers break profile mapping SILENTLY: `applyProfile` resolves a column by
 *  `headers.indexOf(name)`, which returns the first match, so a second "Account" would be mapped and
 *  then never read. GeneralLedger really does return a column titled "Account", and we synthesise one
 *  too — so this cannot be left to chance. */
function unique(headers) {
  const seen = new Map();
  return headers.map((h) => {
    const name = String(h ?? "").trim() || "Column";
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

/**
 * Flatten a QuickBooks report response into the grid the importer already understands.
 *
 * @param   {object} report  the parsed response from /v3/company/{realm}/reports/{Name}
 * @returns {{headers: string[], rows: (string|number)[][]}}
 */
export function quickbooksSource(report) {
  const cols = report?.Columns?.Column ?? [];
  // The report's own columns keep their order and their titles, so a grid lines up with the raw
  // response when somebody is comparing the two at 2am. The synthesised pair goes on the end.
  const reported = cols.map((c, i) => c?.ColTitle || `Column ${i + 1}`);
  const headers = unique([...reported, "Account", "Section Path"]);

  const found = walk(report?.Rows, [], []);
  const width = reported.length;

  const rows = found.map(({ cells, account, path }) => {
    // Pad or trim to the declared width. A report that returns fewer cells than columns would
    // otherwise shift the synthesised columns left onto a different field, which is the kind of fault
    // that produces plausible numbers in the wrong place.
    const fixed = Array.from({ length: width }, (_, i) => cells[i] ?? "");
    return [...fixed, account ?? "", path ?? ""];
  });

  return { headers, rows };
}

/** Every distinct value in a column, in first-seen order. For showing somebody what their accounts
 *  or classes actually look like before they choose which one means `code`. */
export function columnValues(grid, header) {
  const i = (grid?.headers ?? []).indexOf(header);
  if (i < 0) return [];
  const seen = new Set();
  for (const row of grid.rows ?? []) {
    const v = String(row[i] ?? "").trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

// ---------------------------------------------------------------- windows --
// The Reports API caps a response at 400,000 cells and DOES NOT PAGINATE. Past the cap it appends
// "Unable to display more data. Please reduce the date range" — and returns 200, so a caller that
// checks only the status silently imports a truncated year.
//
// The answer is to ask for less at a time, which makes date arithmetic part of the sync. Done on the
// STRING, deliberately: `new Date("2026-01-01")` parses as UTC midnight and then reports a local date,
// so in a negative-offset timezone it is the 31st of December. This project has already been bitten by
// that class of bug and its tests run under TZ=America/Denver to keep it visible.

const pad = (n) => String(n).padStart(2, "0");
const partsOf = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return { y, m, d };
};
const lastDayOf = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
                             31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** Split an inclusive date range into consecutive windows of at most `months` calendar months.
 *  No gaps, no overlaps, and the last window ends exactly on `end`. */
export function dateWindows(start, end, months = 3) {
  const a = partsOf(start), b = partsOf(end);
  if (!a.y || !b.y || months < 1) return [];
  const out = [];
  let y = a.y, m = a.m, d = a.d;
  for (;;) {
    // last day of the window: advance `months`, step back one day
    let ey = y, em = m + months - 1;
    ey += Math.floor((em - 1) / 12); em = ((em - 1) % 12) + 1;
    let ed = lastDayOf(ey, em);
    const windowEnd = `${ey}-${pad(em)}-${pad(ed)}`;
    const stop = windowEnd >= end;
    out.push({ start: `${y}-${pad(m)}-${pad(d)}`, end: stop ? end : windowEnd });
    if (stop) break;
    // next window starts the day after
    m = em + 1; y = ey; d = 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 600) break;   // a runaway loop is worse than a partial answer
  }
  return out;
}

/** Combine grids from several windows into one. Headers are unioned rather than assumed identical:
 *  a quarter with no Class on any transaction returns no Class column, and concatenating positionally
 *  would file its amounts under someone else's heading. */
export function mergeGrids(grids) {
  const list = (grids || []).filter(g => g && Array.isArray(g.headers));
  if (!list.length) return { headers: [], rows: [] };

  const headers = [];
  for (const g of list) for (const h of g.headers) if (!headers.includes(h)) headers.push(h);

  const rows = [];
  for (const g of list) {
    const at = headers.map(h => g.headers.indexOf(h));
    for (const row of g.rows || []) rows.push(at.map(i => (i < 0 ? "" : row[i] ?? "")));
  }
  return { headers, rows };
}
