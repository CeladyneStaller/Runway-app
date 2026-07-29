#!/usr/bin/env node
// QBO-PLAN Stage 7 — the monthly keep-alive, run by a scheduler.
//
//   SUPABASE_URL=... QBO_CRON_SECRET=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/qbo-keepalive.mjs
//
// WHY MONTHLY. A refresh token dies after ~100 idle days, and the clock belongs to the TOKEN rather
// than to the call: only a ROTATION issues one with a fresh window, and rotation is roughly daily. So
// monthly catches a rotation with two months to spare, and annually would be a scheduled job pointed
// straight at a dead connection.
//
// WHY THIS EXITS NON-ZERO. The scheduler's own "this run failed" notification is the entire alerting
// channel — no new vendor, no webhook to maintain, and it reaches a person who is already watching
// for it. So anything requiring action fails the run on purpose. Transient failures do not: an alert
// that cries wolf every month is filtered into a folder within a quarter, and then the real one is
// invisible too.
import { alertsFrom, exitCodeFor } from "./qbo-alerts.mjs";

class Fail extends Error {}

// No process.exit() from inside async work — on Windows that aborts the runtime with a libuv
// assertion while a socket is still open. Failures throw; main() sets process.exitCode.
const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Fail(`Missing ${k}`);
  return v;
};

async function main() {
  const base = need("SUPABASE_URL").replace(/\/+$/, "");
  const cron = need("QBO_CRON_SECRET");
  const service = need("SUPABASE_SERVICE_ROLE_KEY");

  const refresh = await fetch(`${base}/functions/v1/qbo-refresh`, {
    method: "POST",
    headers: { "x-cron-secret": cron, "Content-Type": "application/json" },
  });
  if (!refresh.ok) {
    throw new Fail(`qbo-refresh returned ${refresh.status}: ${(await refresh.text()).slice(0, 300)}\n` +
      (refresh.status === 403
        ? "403 means x-cron-secret did not match. The function FAILS CLOSED, which is why an unset\n" +
          "secret refuses everything rather than leaving an open endpoint."
        : ""));
  }
  const summary = await refresh.json();

  const healthRes = await fetch(`${base}/rest/v1/rpc/qbo_health`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!healthRes.ok) throw new Fail(`qbo_health returned ${healthRes.status}`);
  const rows = await healthRes.json();
  const health = Array.isArray(rows) ? (rows[0] ?? {}) : (rows ?? {});

  console.log(`refreshed: ${JSON.stringify(summary)}`);
  console.log(`health:    ${JSON.stringify(health)}`);

  const alerts = alertsFrom(summary, health);
  if (!alerts.length) {
    console.log("\nNothing needs attention.");
    return;
  }
  console.log("");
  for (const a of alerts) console.log(`${a.level.toUpperCase().padEnd(5)} ${a.text}`);

  const code = exitCodeFor(alerts);
  if (code) {
    console.log("\nFailing this run on purpose: the items above need a person, and a failed run is\n" +
                "the only thing that will tell one.");
  }
  process.exitCode = code;
}

main().catch((e) => {
  console.error(`\n${e instanceof Fail ? e.message : e}`);
  process.exitCode = 1;
});
