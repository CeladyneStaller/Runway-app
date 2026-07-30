#!/usr/bin/env node
// Call every RPC once against a real database, to catch what only fails when a function RUNS.
//
//   node scripts/rpc-smoke.mjs
//
// Reads `.env.isolation` like the other verification runners, and needs the same values plus a service
// key for the service-role functions:
//   SUPABASE_URL, SUPABASE_ANON_KEY, TEST_A_EMAIL, TEST_A_PASSWORD, SUPABASE_SERVICE_ROLE_KEY
//
// RUN IT AFTER EVERY MIGRATION. `test/engine/migrations.test.js` catches ordering mistakes by reading
// SQL; this catches the other half. Between them they cover the three failures this schema has actually
// had — a column referenced before it existed, a return type changed without a drop, and an OUT
// parameter shadowing a column, which was invisible until the function was called.
//
// IT WRITES ALMOST NOTHING. Every id passed is a uuid that matches no row, so the functions refuse and
// that refusal is the pass. The handful that would change data regardless of their arguments are named
// in `SKIP`, with a reason each.
import { readFileSync, readdirSync } from "node:fs";
import { loadEnvFiles, requireEnv, envAny } from "./env-file.mjs";
import { rpcSurface, argsFor, classify, SKIP } from "./rpc-smoke-checks.mjs";

class Fail extends Error {}

async function main() {
  const loadedFrom = loadEnvFiles();
  const opts = { loadedFrom };
  const base = requireEnv(["SUPABASE_URL", "SUPABASE_TEST_URL"], opts).replace(/\/+$/, "");
  const anon = requireEnv(["SUPABASE_ANON_KEY", "SUPABASE_TEST_ANON_KEY"], opts);
  const email = requireEnv(["TEST_A_EMAIL", "TEST_USER_A"], opts);
  const password = requireEnv(["TEST_A_PASSWORD", "TEST_PASS_A"], opts);
  const service = envAny("SUPABASE_SERVICE_ROLE_KEY");

  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort()
    .map(name => ({ name, sql: readFileSync(`${dir}/${name}`, "utf8") }));
  const surface = rpcSurface(files);

  const auth = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!auth.ok) throw new Fail(`could not sign in as ${email}: ${auth.status}`);
  const token = (await auth.json()).access_token;

  const call = async (fn, key, bearer) => {
    const res = await fetch(`${base}/rest/v1/rpc/${fn.name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(argsFor(fn)),
    });
    const body = await res.json().catch(() => ({}));
    return classify({ ok: res.ok, status: res.status, body });
  };

  let broken = 0, skipped = 0, ran = 0, unknown = 0;
  console.log(`${surface.length} callable function(s) across ${files.length} migration(s)\n`);

  for (const fn of surface) {
    if (SKIP.has(fn.name)) {
      console.log(`SKIP     ${fn.name.padEnd(30)} ${SKIP.get(fn.name)}`);
      skipped += 1;
      continue;
    }
    // Service-role functions are called with the service key; everything else as the signed-in user.
    const serviceOnly = fn.roles.length === 1 && fn.roles[0] === "service_role";
    if (serviceOnly && !service) {
      console.log(`SKIP     ${fn.name.padEnd(30)} needs SUPABASE_SERVICE_ROLE_KEY`);
      skipped += 1;
      continue;
    }
    const { verdict, detail } = serviceOnly
      ? await call(fn, service, service)
      : await call(fn, anon, token);

    const tag = { ran: "ok      ", refused: "ok      ", broken: "BROKEN  ", unknown: "?       " }[verdict];
    console.log(`${tag} ${fn.name.padEnd(30)} ${verdict === "refused" ? "refused: " : ""}${detail}`);
    if (verdict === "broken") broken += 1;
    else if (verdict === "unknown") unknown += 1;
    else ran += 1;
  }

  console.log(`\n${ran} executed, ${skipped} skipped, ${unknown} unclear, ${broken} BROKEN`);
  if (broken) {
    console.log("\nA BROKEN function cannot run at all. It was created without complaint — plpgsql");
    console.log("resolves names when a function is CALLED, not when it is defined — so nothing before");
    console.log("this point would have said so.");
  }
  process.exitCode = broken ? 1 : 0;
}

main().catch((e) => { console.error(`\n${e.message || e}`); process.exitCode = 2; });
