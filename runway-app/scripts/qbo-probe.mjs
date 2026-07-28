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
    console.log(`Company reports on: ${method}\n`);

    const q = new URLSearchParams({
      start_date: START, end_date: END,
      columns: COLUMNS.join(","),
      ...(method !== "unknown" ? { accounting_method: method } : {}),
    });
    report = await qbo(`/reports/GeneralLedger?${q}`, token, realm);

    const { writeFileSync } = await import("node:fs");
    const path = `qbo-fixture-${today}.json`;
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
  const codeable = rows.filter(r =>
    cell(r, "klass_name") || cell(r, "account_name") || r.section).length;
  console.log("\n" + "-".repeat(72));
  console.log(`ATTRIBUTABLE ROWS: ${codeable} of ${rows.length} (${pct(codeable, rows.length)})`);
  console.log(codeable / Math.max(rows.length, 1) > 0.9
    ? "Every row can be given a code. The seam holds — Stage 2 is worth writing."
    : "SOME ROWS CANNOT BE CODED. Before going further, find out where those transactions carry\n" +
      "their attribution in the real books. An import that looks automatic and allocates wrongly\n" +
      "is worse than the file path it replaces.");
  console.log("\nREMEMBER: a sandbox proves the MECHANISM. Only a real chart of accounts proves the");
  console.log("MAPPING — and the file importer already eats a GL export, so a prospect's export run");
  console.log("through the existing import screen answers Stage 1b with no code at all.");
}

main().catch((e) => { console.error(e); process.exit(1); });
