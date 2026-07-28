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

// ---- run --------------------------------------------------------------------
async function main() {
  CLIENT_ID = requireReal("QBO_CLIENT_ID", cfg("QBO_CLIENT_ID"));
  CLIENT_SECRET = requireReal("QBO_CLIENT_SECRET", cfg("QBO_CLIENT_SECRET"));
  REALM = requireReal("QBO_REALM_ID", cfg("QBO_REALM_ID"));

  const before = loadTokens();
  console.log(`stored refresh token: ${short(before.refresh_token)}`);
  const t = await refresh(before);
  console.log(`rotated to:           ${short(t.refresh_token)}  ` +
              `${t.refresh_token === before.refresh_token ? "(UNCHANGED — unexpected)" : "(new, old is dead)"}`);
  console.log(`access token expires: ${Math.round((t.access_expires_at - Date.now()) / 60000)} min`);
  console.log(`refresh token expires: ${days(t.refresh_expires_at - Date.now())} days ` +
              `-> a connection left idle past that needs the customer back`);
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
  console.log(`Connected to: ${name}   (realm ${REALM})\n`);

  const END = String(flag("until", new Date().toISOString().slice(0, 10)));
  const START = String(flag("since", `${new Date().getFullYear() - 1}-01-01`));
  const MONTHS = Number(flag("window", 3)) || 3;
  const windows = dateWindows(START, END, MONTHS);
  console.log(`${windows.length} window(s) of ${MONTHS} month(s), ${START} -> ${END}`);

  const grids = [];
  let truncated = 0;
  const t0 = Date.now();
  for (const w of windows) {
    const q = new URLSearchParams({
      start_date: w.start, end_date: w.end,
      columns: "tx_date,txn_type,doc_num,name,memo,subt_nat_amount,klass_name",
    });
    const report = await api(`/reports/ProfitAndLossDetail?${q}`, t.access_token);
    if (JSON.stringify(report).includes("Unable to display more data")) {
      truncated += 1;
      console.log(`  ${w.start}..${w.end}  TRUNCATED — narrow --window`);
    }
    const g = quickbooksSource(report);
    grids.push(g);
    console.log(`  ${w.start}..${w.end}  ${String(g.rows.length).padStart(5)} rows`);
  }

  const grid = mergeGrids(grids);
  console.log(`\n${grid.rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s across ` +
              `${windows.length} request(s)${truncated ? `, ${truncated} TRUNCATED` : ""}`);
  console.log(`headers: ${grid.headers.join(" | ")}`);
  for (const h of ["Account", "Class", "Section Path"]) {
    const v = columnValues(grid, h);
    if (v.length) console.log(`${h}: ${v.length} distinct`);
  }
  if (truncated) {
    console.log("\nTRUNCATION IS SILENT — the API returns 200 and appends a sentence. Any sync that");
    console.log("does not check for it imports a partial year and reports a confident wrong number.");
  }
}

// The config check runs INSIDE main, so a placeholder is reported the same way as any other failure
// and nothing is torn down mid-request.
main().catch((e) => {
  console.error(`\n${e instanceof Fail ? e.message : e}`);
  process.exitCode = 1;
});
