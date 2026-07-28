#!/usr/bin/env node
// QBO-PLAN Stage 1a — the data question, asked of a real QuickBooks company.
//
//   QBO_ACCESS_TOKEN=... QBO_REALM_ID=... node scripts/qbo-probe.mjs
//   node scripts/qbo-probe.mjs --fixture qbo-fixture-2026-07-28.json      # replay, no network
//
// Optional: QBO_ENV=production (default sandbox), QBO_START=2026-01-01, QBO_END=2026-07-28.
//
// THIS IS A PROBE, NOT PRODUCT CODE. Its job is to answer one question — can `ImportRow.code` be
// recovered from what QuickBooks returns — and to say so plainly rather than to work. Stage 2 promotes
// the mapping into `src/engine/` with the saved response as a fixture; nothing here is meant to survive.
//
// IT REPORTS WHAT CAME BACK RATHER THAN ASSUMING. Intuit's Reports API answers a request for a column
// that does not exist with an empty cell rather than an error, so a probe that trusted its own column
// list would print convincing nulls and prove nothing.
//
// THE SAME CODE PATH RUNS LIVE AND FROM A FIXTURE, so what gets tested offline is what runs online.

const args = process.argv.slice(2);
const fixtureAt = args.indexOf("--fixture");
const FIXTURE = fixtureAt >= 0 ? args[fixtureAt + 1] : null;
const reportAt = args.indexOf("--report");
// DEFAULT CHANGED FROM GeneralLedger AFTER THE FIRST RUN. A GL is DOUBLE-ENTRY: every transaction
// appears under both accounts it touches, so importing it counts everything twice with opposite signs,
// and the account a row is filed under is as likely to be "Checking" as a category. `importer.js` was
// built for an expense register — one row per transaction — and ProfitAndLossDetail is that: grouped
// by income and expense account, balance-sheet noise and opening balances excluded.
const REPORT = reportAt >= 0 ? args[reportAt + 1] : "ProfitAndLossDetail";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(2); }
  return v;
};

const BASE = process.env.QBO_ENV === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

const today = new Date().toISOString().slice(0, 10);
const START = process.env.QBO_START || `${new Date().getFullYear()}-01-01`;
const END = process.env.QBO_END || today;

// FEW COLUMNS ON PURPOSE. Detail reports asked for 25+ columns start returning 504s and truncated
// payloads, and every column here has to earn its place by being a candidate source for attribution.
const COLUMNS = ["tx_date", "txn_type", "doc_num", "name", "memo", "account_name", "subt_nat_amount",
                 "klass_name", "cust_name"];

async function qbo(path, token, realm) {
  const res = await fetch(`${BASE}/v3/company/${realm}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`\n${path} -> ${res.status}`);
    console.error(text.slice(0, 600));
    if (res.status === 401) console.error("\n401: the access token is past its 60 minutes. Refresh it.");
    process.exit(1);
  }
  try { return JSON.parse(text); } catch { console.error("Not JSON:", text.slice(0, 300)); process.exit(1); }
}

/** QBO report rows are a TREE, not a table: sections nest, and the account a line belongs to lives in
 *  the SECTION HEADER rather than on the line itself. That detail is most of the answer to whether
 *  attribution is recoverable, so the walk carries the enclosing header down to each leaf. */
function flatten(rows, header = null, out = []) {
  for (const r of rows?.Row ?? []) {
    const own = r.Header?.ColData?.map(c => c.value).filter(Boolean).join(" · ") || null;
    if (r.ColData) out.push({ section: header, cells: r.ColData.map(c => c.value ?? "") });
    if (r.Rows) flatten(r.Rows, own || header, out);
  }
  return out;
}

const pct = (n, d) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

async function main() {
  let report, method = "unknown";

  if (FIXTURE) {
    const { readFileSync } = await import("node:fs");
    report = JSON.parse(readFileSync(FIXTURE, "utf8"));
    console.log(`Replaying ${FIXTURE} — no network.\n`);
  } else {
    const token = need("QBO_ACCESS_TOKEN");
    const realm = need("QBO_REALM_ID");

    // ACCOUNTING METHOD FIRST. Cash and accrual are different numbers, and a runway date that disagrees
    // with what somebody sees in their own QuickBooks is a trust problem before it is a data problem.
    const prefs = await qbo("/preferences", token, realm);
    method = prefs?.Preferences?.ReportPrefs?.ReportBasis || "unknown";
    console.log(`Company reports on: ${method}   |   report: ${REPORT}\n`);

    // WHY `klass_name` CAME BACK EMPTY, asked properly. "Not returned" has two very different causes:
    // the report cannot give them, or this company has none to give. Only one of those is a problem,
    // and grant-funded organisations frequently carry their attribution in Classes — so this is the
    // question Stage 1 actually turns on.
    const ai = prefs?.Preferences?.AccountingInfoPrefs || {};
    const tracking = [ai.ClassTrackingPerTxn, ai.ClassTrackingPerTxnLine].some(Boolean);
    let classCount = null;
    try {
      const q = encodeURIComponent("select count(*) from Class");
      const r = await qbo(`/query?query=${q}&minorversion=70`, token, realm);
      classCount = r?.QueryResponse?.totalCount ?? 0;
    } catch { /* the diagnostic failing is not the run failing */ }
    console.log(`Class tracking enabled: ${tracking ? "yes" : "no"}   |   classes defined: ${classCount ?? "?"}`);
    if (!tracking || classCount === 0) {
      console.log("  -> so an empty `klass_name` says NOTHING about the API. This company simply has no");
      console.log("     classes. To answer it: turn on class tracking in the sandbox, tag two");
      console.log("     transactions, and re-run. Until then Classes remain the open question.\n");
    } else {
      console.log("  -> classes EXIST here, so an empty `klass_name` is the report's limit, not the");
      console.log("     company's. Try `--report TransactionList`, which supports different columns.\n");
    }

    const q = new URLSearchParams({
      start_date: START, end_date: END,
      columns: COLUMNS.join(","),
      ...(method !== "unknown" ? { accounting_method: method } : {}),
    });
    report = await qbo(`/reports/${REPORT}?${q}`, token, realm);

    const { writeFileSync } = await import("node:fs");
    const path = `qbo-fixture-${REPORT}-${today}.json`;
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`Raw response saved to ${path} — this is Stage 2's fixture.\n`);
  }

  // ---- what actually came back ------------------------------------------------
  const cols = (report?.Columns?.Column ?? []).map(c => ({
    title: c.ColTitle || "(untitled)",
    type: c.ColType || "?",
  }));
  console.log("COLUMNS RETURNED");
  cols.forEach((c, i) => console.log(`  ${String(i).padStart(2)}  ${c.title.padEnd(22)} ${c.type}`));
  const missing = COLUMNS.filter(c => !cols.some(k => k.type === c));
  if (missing.length) {
    console.log(`\n  ASKED FOR AND NOT RETURNED: ${missing.join(", ")}`);
    console.log("  (empty cells, not an error — this is the silent failure the API is known for)");
  }

  const rows = flatten(report?.Rows);
  console.log(`\n${rows.length} data rows between ${START} and ${END}`);

  const truncated = JSON.stringify(report).includes("Unable to display more data");
  if (truncated) {
    console.log("\n  TRUNCATED. The Reports API caps a response at 400,000 cells and does NOT paginate,");
    console.log("  so the real sync will have to walk the range in chunks. Narrow the dates and re-run.");
  }

  // ---- can attribution be recovered? -----------------------------------------
  const at = (type) => cols.findIndex(c => c.type === type);
  const idx = Object.fromEntries(COLUMNS.map(c => [c, at(c)]));
  const cell = (r, c) => (idx[c] >= 0 ? (r.cells[idx[c]] ?? "") : "");
  const filled = (c) => rows.filter(r => String(cell(r, c)).trim() !== "").length;

  console.log("\nCANDIDATE SOURCES FOR `code` — the field the whole model hangs on");
  for (const c of ["account_name", "klass_name", "cust_name", "memo"]) {
    const n = idx[c] >= 0 ? filled(c) : 0;
    console.log(`  ${c.padEnd(14)} ${idx[c] >= 0 ? `${String(n).padStart(5)} rows  ${pct(n, rows.length)}`
                                                 : "   not returned"}`);
  }
  const sectioned = rows.filter(r => r.section).length;
  console.log(`  section header ${String(sectioned).padStart(5)} rows  ${pct(sectioned, rows.length)}` +
              "   <- the account, carried from the enclosing section");

  // ---- WHICH accounts, not just whether there is one -------------------------
  // The first run scored 100% "attributable" while every code was `Checking`. A bank account is not
  // attribution; it is the other side of the entry. A histogram makes that visible in one glance.
  const bySection = new Map();
  for (const r of rows) bySection.set(r.section || "(none)", (bySection.get(r.section || "(none)") || 0) + 1);
  const top = [...bySection.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\nROWS BY ACCOUNT (${bySection.size} distinct)`);
  for (const [name, n] of top) console.log(`  ${String(n).padStart(5)}  ${name}`);
  const BANKISH = /checking|savings|bank|cash on hand|accounts (receivable|payable)|a\/[rp]|undeposited/i;
  const bankRows = rows.filter(r => BANKISH.test(r.section || "")).length;
  if (bankRows) {
    console.log(`\n  ${bankRows} rows (${pct(bankRows, rows.length)}) are filed under a BALANCE-SHEET`);
    console.log("  account. Those are the cash side of an entry, not a category — if this is a GL,");
    console.log("  the same transactions also appear under their expense account.");
  }

  // ---- is this double-entry? --------------------------------------------------
  // Same day, same document number, equal magnitude, opposite sign = one transaction seen twice.
  // ROWS WITHOUT A DOCUMENT NUMBER ARE EXCLUDED FROM THIS. With `doc_num` blank the key collapses to
  // date+amount, and two unrelated $8.75 discounts on the same day look like one transaction seen
  // twice. The first version counted those and failed a clean report on 4 rows out of 123.
  const pairs = new Map();
  for (const r of rows) {
    const doc = String(cell(r, "doc_num")).trim();
    if (!doc) continue;
    const k = `${cell(r, "tx_date")}|${doc}|${Math.abs(Number(String(cell(r, "subt_nat_amount")).replace(/[^0-9.-]/g, "")) || 0)}`;
    pairs.set(k, (pairs.get(k) || 0) + 1);
  }
  const doubled = [...pairs.values()].filter(n => n > 1).reduce((a, n) => a + n, 0);
  // And a THRESHOLD, not a tripwire. Genuine double entry is most of a report, not a rounding error;
  // a pass/fail on `> 0` turns any coincidence into a stop signal, which is how a useful check gets
  // ignored.
  const doubledPct = doubled / Math.max(rows.length, 1);
  if (doubled) {
    console.log(`\n  DOUBLE-ENTRY SUSPECTED: ${doubled} rows (${pct(doubled, rows.length)}) share a date,`);
    console.log("  document number and magnitude with another row. Importing all of them would count");
    console.log("  those transactions twice. This is what a General Ledger looks like, and it is why");
    console.log("  the default report here is ProfitAndLossDetail.");
  }

  // ---- what an ImportRow would look like --------------------------------------
  console.log("\nFIRST ROWS AS ImportRow[] (date + amount required; the rest is attribution)");
  const sample = rows.slice(0, 8).map(r => ({
    date: cell(r, "tx_date"),
    amount: cell(r, "subt_nat_amount"),
    code: cell(r, "klass_name") || cell(r, "account_name") || r.section || "",
    customer: cell(r, "cust_name") || cell(r, "name"),
    note: cell(r, "memo"),
  }));
  console.log(JSON.stringify(sample, null, 2));

  // ---- the verdict, said out loud ---------------------------------------------
  // USABLY coded, which is a different question from coded. A row filed under a bank account has a
  // string in the code slot and no attribution in it — the first version of this probe counted those
  // and reported 100%, which is how a probe tells you what you hoped instead of what is there.
  const usable = rows.filter(r => {
    const code = cell(r, "klass_name") || cell(r, "account_name") || r.section || "";
    return code && !BANKISH.test(code);
  }).length;
  console.log("\n" + "-".repeat(72));
  console.log(`USABLY CODED ROWS: ${usable} of ${rows.length} (${pct(usable, rows.length)})`);
  console.log(`  (a code that names a bank account does not count — it is the other side of the entry)`);
  const ok = usable / Math.max(rows.length, 1) > 0.9 && doubledPct < 0.1;
  console.log(ok
    ? "\nEvery row carries a category and nothing looks double-counted. The seam holds — Stage 2 is\nworth writing against this fixture."
    : "\nNOT YET. Either rows lack a usable category or the same transactions appear twice. Try\n" +
      "`--report TransactionList` and compare, and check whether this company codes with Classes\n" +
      "at all. An import that looks automatic and allocates wrongly is worse than the file path it\n" +
      "replaces, and this is the stage that is supposed to catch that.");
  console.log("\nREMEMBER: a sandbox proves the MECHANISM. Only a real chart of accounts proves the");
  console.log("MAPPING — and the file importer already eats a GL export, so a prospect's export run");
  console.log("through the existing import screen answers Stage 1b with no code at all.");
}

main().catch((e) => { console.error(e); process.exit(1); });
