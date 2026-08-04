// Unpaid bills, from a grid, into commitments.
//
// SHARED BY QUICKBOOKS AND CSV. `qbo-sync` returns a grid and the CSV importer produces one; this maps
// either into commitments, so the ledger integration is one function rather than two that drift.
//
// ⚠️ A BILL IS NOT A SIGNATURE. QuickBooks raises a bill when an INVOICE arrives; a commitment begins
// when you sign. So this finds obligations already invoiced and misses everything signed and not yet
// billed — precisely the long-dated purchase order this whole feature was built for.
//
// It is a FLOOR on what you owe, never the whole of it, and the UI has to say so. An empty list read as
// "nothing outstanding" would be worse than not importing at all, because it would look like an answer.

const clean = (n) => (Number.isFinite(n) ? n : 0);

/** Column names vary between QuickBooks report versions and between CSV exports, so headers are matched
 *  loosely rather than by position — position is what breaks when somebody adds a column. */
const FIELDS = {
  due: [/due.?date/i, /^due$/i],
  date: [/tx.?date/i, /^date$/i, /transaction.?date/i],
  vendor: [/vend/i, /supplier/i, /^name$/i, /payee/i],
  amount: [/open.?bal/i, /amount/i, /balance/i, /total/i],
  ref: [/doc.?num/i, /^ref/i, /number/i, /invoice/i],
  memo: [/memo/i, /descri/i],
};

function indexOfField(headers, patterns) {
  for (const re of patterns) {
    const i = (headers || []).findIndex(h => re.test(String(h || "")));
    if (i >= 0) return i;
  }
  return -1;
}

/** A money string from a report: "1,234.56", "(500)" for a credit, "$1,234". */
function parseMoney(v) {
  if (typeof v === "number") return v;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const neg = /^\(.*\)$/.test(raw);
  const n = Number(raw.replace(/[()$,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** A date string to a month index from the model's start. */
function monthOf(v, startY, startM) {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  // PARSED AS LOCAL, NOT UTC. `new Date("2026-08-01")` is UTC midnight by spec, and reading it back
  // with `getMonth()` in any negative offset gives 31 July — so a bill due on the FIRST of a month
  // landed in the month before it, every time, in every timezone west of Greenwich.
  //
  // Caught by the suite running under TZ=America/Denver, which is the entire reason it does.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  const d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getFullYear() - startY) * 12 + (d.getMonth() - startM);
}

/** Map a payables grid into commitment drafts.
 *
 *  DRAFTS, NOT COMMITMENTS. Nothing is written until somebody confirms — an import that silently added
 *  obligations to a model would change the runway of a company on the strength of a report nobody had
 *  read, and a bill in QuickBooks is not always a bill this business considers outstanding.
 */
export function payablesToCommitments(grid, { startY, startM, existing = [] } = {}) {
  const headers = grid?.headers || [];
  const rows = grid?.rows || [];

  const iDue = indexOfField(headers, FIELDS.due);
  const iDate = indexOfField(headers, FIELDS.date);
  const iVend = indexOfField(headers, FIELDS.vendor);
  const iAmt = indexOfField(headers, FIELDS.amount);
  const iRef = indexOfField(headers, FIELDS.ref);
  const iMemo = indexOfField(headers, FIELDS.memo);

  // WITHOUT AN AMOUNT THERE IS NOTHING TO IMPORT, and saying so beats importing zeroes. A grid whose
  // columns did not match is a mapping problem, not an empty payables list, and the two must not look
  // alike.
  if (iAmt < 0) {
    return { drafts: [], skipped: rows.length, reason: "no amount column found in this report" };
  }

  const seen = new Set((existing || []).map(c => c.paidRef?.ref || c.extRef).filter(Boolean));
  const drafts = [];
  let skipped = 0, noDate = 0, duplicates = 0;

  for (const r of rows) {
    const amount = parseMoney(r[iAmt]);
    // A credit note is a negative open balance. It reduces what you owe rather than adding to it, and
    // importing it as an obligation would overstate the total by twice its value.
    if (!(amount > 0)) { skipped++; continue; }

    const ref = iRef >= 0 ? String(r[iRef] ?? "").trim() : "";
    if (ref && seen.has(ref)) { duplicates++; continue; }

    const payMonth = iDue >= 0 ? monthOf(r[iDue], startY, startM) : null;
    const signedMonth = iDate >= 0 ? monthOf(r[iDate], startY, startM) : null;

    // A BILL WITH NO DUE DATE IS COUNTED AND NOT PLACED. It is money owed with no month to sit in, and
    // guessing one would put a real obligation against a runway at an invented moment. Reported so
    // somebody can fix the export rather than wonder where the rows went.
    if (payMonth == null) { noDate++; continue; }

    const vendor = iVend >= 0 ? String(r[iVend] ?? "").trim() : "";
    const memo = iMemo >= 0 ? String(r[iMemo] ?? "").trim() : "";

    drafts.push({
      label: [vendor, ref].filter(Boolean).join(" · ") || memo || "Unpaid bill",
      signedMonth: signedMonth ?? payMonth,
      payMonth,
      amount: Math.round(amount),
      source: "qbo",
      extRef: ref || null,
      vendor: vendor || null,
      memo: memo || null,
    });
  }

  return {
    drafts: drafts.sort((a, b) => a.payMonth - b.payMonth),
    skipped, noDate, duplicates,
    // Stated every time, not only when the list is short. Somebody reading an import of four bills
    // should know it is four INVOICED obligations, not four obligations.
    note: "Unpaid bills only. Anything signed and not yet invoiced is not in this list.",
  };
}
