#!/usr/bin/env node
// QBO-PLAN Stage 3 — one real connection, run by hand.
//
//   node scripts/qbo-sync.mjs                 # refresh, fetch, flatten, report
//   node scripts/qbo-sync.mjs --keepalive     # refresh only: what a scheduled job will do
//   node scripts/qbo-sync.mjs --since 2024-01-01 --window 3
//
// Needs, in the environment or in `.env.qbo` beside this repo:
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REALM_ID, QBO_REFRESH_TOKEN   (first run only)
//
// NO DATABASE, NO EDGE FUNCTION, NOTHING USER-FACING. The point of this stage is not to move data —
// Stage 2 already proved the mapping — it is to find out what a connection COSTS TO KEEP, which is
// where QuickBooks integrations rot. Everything here is throwaway except the lessons, which Stage 4
// re-implements against Postgres and Vault.
//
// THE ONE THING THAT MATTERS MOST: A REFRESH TOKEN IS SINGLE-USE. Every refresh returns a NEW one and
// invalidates the old immediately. So the new token is persisted BEFORE the access token is used for
// anything, and persisted atomically — a crash between "received" and "written" disconnects the
// customer, and the only repair is asking them to authorise again.
//
// Tokens are never printed. Prefixes only, so a pasted terminal is not a credential leak.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { quickbooksSource, mergeGrids, dateWindows, columnValues } from "../src/engine/qbo.js";

// NOTHING IN THIS FILE CALLS process.exit(). On Windows, exiting while a fetch socket is still open
// aborts the runtime with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — a libuv crash
// that looks like a bug in the API client and is not. Failures throw; `main()` catches, prints, and
// sets `process.exitCode`, which lets the event loop drain on its own.
class Fail extends Error {}

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : fallback;
};
const KEEPALIVE = args.includes("--keepalive");
const STORE = ".qbo-tokens.json";

// ---- config, from a file or the environment ---------------------------------
function loadEnvFile(path = ".env.qbo") {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const file = loadEnvFile();
const cfg = (k) => process.env[k] || file[k];

let CLIENT_ID, CLIENT_SECRET, REALM;
const BASE = cfg("QBO_ENV") === "production"
  ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";

// PLACEHOLDERS ARE REFUSED BEFORE THE NETWORK IS TOUCHED. A template copied with its dots still in
// produces `401 invalid_client`, which reads as "your app is misconfigured at Intuit" and is really
// "you pasted my example". The Stripe test script already guards its uuid this way; this is the same
// trap wearing different clothes.
const PLACEHOLDER = /^(\.{2,}|<.*>|your[-_ ]|xxx+|todo|changeme|paste)/i;
function requireReal(name, value) {
  if (!value) throw new Fail(`Missing ${name} — set it in .env.qbo or the environment.`);
  if (PLACEHOLDER.test(String(value).trim()) || String(value).trim().length < 6) {
    throw new Fail(`${name} is still a placeholder (${JSON.stringify(String(value).slice(0, 12))}).\n` +
                   "Copy the real value from the Intuit developer portal, with no surrounding characters.");
  }
  return value;
}

// ---- token custody ----------------------------------------------------------
// WRITE THEN RENAME. A half-written token file is a disconnected customer, and rename is the only
// filesystem operation that is atomic. Stage 4 gets this property from a transaction instead.
function saveTokens(t) {
  const tmp = `${STORE}.tmp`;
  writeFileSync(tmp, JSON.stringify(t, null, 2), { mode: 0o600 });
  renameSync(tmp, STORE);
}
function loadTokens() {
  if (existsSync(STORE)) return JSON.parse(readFileSync(STORE, "utf8"));
  const seed = cfg("QBO_REFRESH_TOKEN");
  if (!seed) {
    throw new Fail(`No ${STORE} and no QBO_REFRESH_TOKEN to start from.\n` +
                   "Get one from the OAuth Playground — the REFRESH token, not the access token —\n" +
                   "put it in .env.qbo, and run again.");
  }
  return { refresh_token: requireReal("QBO_REFRESH_TOKEN", seed) };
}
const short = (s) => (s ? `${String(s).slice(0, 8)}…${String(s).slice(-4)}` : "(none)");

async function refresh(tokens) {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    let why = `Refresh failed: ${res.status} ${body.error || ""} ${body.error_description || ""}`;
    // THE TWO FAILURES MEAN COMPLETELY DIFFERENT THINGS and are worth telling apart out loud.
    if (body.error === "invalid_client") {
      why += "\n\ninvalid_client is about the CLIENT ID AND SECRET, not the refresh token. Usually:" +
             "\n  - the values are still placeholders, or have quotes or spaces around them" +
             "\n  - they are from a different app than the one that issued the refresh token" +
             "\n  - they are production keys against the sandbox realm, or the reverse";
    }
    if (body.error === "invalid_grant") {
      why += "\n\ninvalid_grant means the stored refresh token is not the newest one, or it has" +
             "\nexpired. Both are unrecoverable without the customer re-authorising — which is" +
             "\nexactly the failure Stage 4 has to make impossible and Stage 7 has to alert on.";
    }
    throw new Fail(why);
  }

  const now = Date.now();
  const next = {
    refresh_token: body.refresh_token,               // THE NEW ONE. The old is already dead.
    access_token: body.access_token,
    access_expires_at: now + (body.expires_in ?? 3600) * 1000,
    // Intuit returns how long the REFRESH token has left. Storing it is what lets a keep-alive know
    // when it is running out of road, instead of finding out on the day it stops working.
    refresh_expires_at: now + (body.x_refresh_token_expires_in ?? 100 * 86400) * 1000,
    rotated_at: new Date(now).toISOString(),
  };
  saveTokens(next);                                   // BEFORE the access token is used for anything
  return next;
}

async function api(path, token) {
  const res = await fetch(`${BASE}/v3/company/${REALM}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Fail(`${path} -> ${res.status}\n${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const days = (ms) => Math.round(ms / 86400000);
const monthsIn = (w) => {
  const [ay, am] = w.start.split("-").map(Number);
  const [by, bm] = w.end.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
};

// ---- run --------------------------------------------------------------------
async function main() {
  CLIENT_ID = requireReal("QBO_CLIENT_ID", cfg("QBO_CLIENT_ID"));
  CLIENT_SECRET = requireReal("QBO_CLIENT_SECRET", cfg("QBO_CLIENT_SECRET"));
  REALM = requireReal("QBO_REALM_ID", cfg("QBO_REALM_ID"));

  const before = loadTokens();
  console.log(`stored refresh token: ${short(before.refresh_token)}`);
  const t = await refresh(before);
  // ROTATION IS ROUGHLY DAILY, NOT PER CALL. Intuit returns the SAME refresh token for repeated calls
  // inside about 24 hours. An earlier version of this line called that "unexpected"; it is the normal
  // case. Write-before-use is still right — the window in which a crash costs the connection is just
  // narrower than it first appeared.
  const rotated = t.refresh_token !== before.refresh_token;
  console.log(`rotated to:           ${short(t.refresh_token)}  ` +
              `${rotated ? "(NEW — the old one is now dead)" : "(same token: rotation is ~daily, not per call)"}`);
  console.log(`access token expires: ${Math.round((t.access_expires_at - Date.now()) / 60000)} min`);
  // THE CLOCK BELONGS TO THE TOKEN, NOT THE CALL. Refreshing does not push this out; only a rotation
  // issues a token with a fresh window. So a keep-alive has to run often enough to CATCH a rotation,
  // which means comfortably inside the window rather than just before it expires.
  console.log(`refresh token expires: ${days(t.refresh_expires_at - Date.now())} days ` +
              `${rotated ? "(reset by this rotation)" : "(unchanged — this call did not rotate)"}`);
  console.log(`saved to ${STORE} (0600) before any request was made with it\n`);

  if (KEEPALIVE) {
    console.log("Keep-alive only. This is the whole of what a scheduled job has to do, and not doing it");
    console.log("is how a quarterly user comes back to a dead connection.");
    return;
  }

  // WHOSE BOOKS ARE THESE? One Intuit login can own several companies, and this app is multi-company
  // too, so the realm-to-company pairing is a thing a person can get wrong. The name goes on screen.
  const info = await api("/companyinfo/" + REALM, t.access_token);
  const name = info?.CompanyInfo?.CompanyName || "(unnamed)";
  const founded = info?.CompanyInfo?.CompanyStartDate || null;
  console.log(`Connected to: ${name}   (realm ${REALM})` + (founded ? `   books start ${founded}` : ""));

  const END = String(flag("until", new Date().toISOString().slice(0, 10)));
  const asked = String(flag("since", `${new Date().getFullYear() - 1}-01-01`));
  // CLAMPED TO WHEN THE BOOKS BEGIN. A first run asking for "everything since 2020" against this
  // sandbox made 27 requests to find 126 rows, 24 of them returning nothing — six seconds of round
  // trips through years that cannot contain data. The company knows when it started; ask it.
  const START = founded && founded > asked ? founded : asked;
  if (START !== asked) console.log(`  (asked from ${asked}; clamped to the company's start date)`);

  // WIDE BY DEFAULT, SPLIT ONLY WHEN PUNISHED. The 400,000-cell cap is the only reason to chunk at
  // all, and it depends on transaction volume — which is unknown until a request comes back. Twelve
  // months costs one request for a quiet company and is halved for a busy one, which is the right way
  // round: a fixed small window taxes everybody for the busiest customer's data.
  const MONTHS = Number(flag("window", 12)) || 12;
  const windows = dateWindows(START, END, MONTHS);
  console.log(`\n${windows.length} window(s) of up to ${MONTHS} month(s), ${START} -> ${END}`);

  const grids = [];
  let requests = 0, splits = 0, unresolved = 0;
  const t0 = Date.now();

  async function fetchWindow(w, depth = 0) {
    const q = new URLSearchParams({
      start_date: w.start, end_date: w.end,
      columns: "tx_date,txn_type,doc_num,name,memo,subt_nat_amount,klass_name",
    });
    const report = await api(`/reports/ProfitAndLossDetail?${q}`, t.access_token);
    requests += 1;

    // TRUNCATION IS SILENT: the API returns 200 and appends a sentence. Splitting on it is the only
    // way a wide default is safe — without this, "wide by default" would just mean "quietly partial".
    if (JSON.stringify(report).includes("Unable to display more data")) {
      const halves = dateWindows(w.start, w.end, Math.max(1, Math.floor(monthsIn(w) / 2)));
      if (depth >= 4 || halves.length < 2) {
        unresolved += 1;
        console.log(`  ${w.start}..${w.end}  TRUNCATED and cannot be split further`);
        grids.push(quickbooksSource(report));
        return;
      }
      splits += 1;
      console.log(`  ${w.start}..${w.end}  truncated -> splitting into ${halves.length}`);
      for (const h of halves) await fetchWindow(h, depth + 1);
      return;
    }

    const g = quickbooksSource(report);
    grids.push(g);
    console.log(`  ${w.start}..${w.end}  ${String(g.rows.length).padStart(5)} rows`);
  }

  for (const w of windows) await fetchWindow(w);

  const grid = mergeGrids(grids);
  console.log(`\n${grid.rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s across ` +
              `${requests} request(s)` + (splits ? `, ${splits} window(s) split` : "") +
              (unresolved ? `, ${unresolved} STILL TRUNCATED` : ""));
  console.log(`headers: ${grid.headers.join(" | ")}`);
  for (const h of ["Account", "Class", "Section Path"]) {
    const v = columnValues(grid, h);
    if (v.length) console.log(`${h}: ${v.length} distinct`);
  }
  if (unresolved) {
    console.log("\nSTILL TRUNCATED AFTER SPLITTING. Truncation is silent — the API returns 200 and");
    console.log("appends a sentence — so those windows are PARTIAL and the row count above is wrong.");
    console.log("A month that cannot fit in one response needs a different report or a narrower");
    console.log("column list, and Stage 5 has to treat it as an error rather than a warning.");
  }
}

// The config check runs INSIDE main, so a placeholder is reported the same way as any other failure
// and nothing is torn down mid-request.
main().catch((e) => {
  console.error(`\n${e instanceof Fail ? e.message : e}`);
  process.exitCode = 1;
});
