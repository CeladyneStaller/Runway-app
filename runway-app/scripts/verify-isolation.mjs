#!/usr/bin/env node
// Runs the cross-tenant isolation checks against a REAL Supabase project.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   TEST_A_EMAIL=... TEST_A_PASSWORD=... TEST_B_EMAIL=... TEST_B_PASSWORD=... \
//   node scripts/verify-isolation.mjs
//
// Exits non-zero on any failure, so it can gate a deploy. Run it against a STAGING project, or with
// throwaway accounts: it writes a marker document into B's company.
import { makeClient, runIsolationChecks } from "./isolation-checks.mjs";
import { loadEnvFiles, requireEnv } from "./env-file.mjs";

// READS AN ENV FILE, and accepts both naming conventions. The vitest suite grew `SUPABASE_TEST_URL`
// while these runners grew `SUPABASE_URL`; requiring somebody to know which is which, months later,
// for a task that takes an hour, is how the task keeps not happening.
const loadedFrom = loadEnvFiles();

async function main() {
  const opts = { loadedFrom };
  const client = makeClient({
    url: requireEnv(["SUPABASE_URL", "SUPABASE_TEST_URL"], opts),
    anonKey: requireEnv(["SUPABASE_ANON_KEY", "SUPABASE_TEST_ANON_KEY"], opts),
  });

  const { pass, results } = await runIsolationChecks({
    client,
    a: { email: requireEnv(["TEST_A_EMAIL", "TEST_USER_A"], opts),
         password: requireEnv(["TEST_A_PASSWORD", "TEST_PASS_A"], opts) },
    b: { email: requireEnv(["TEST_B_EMAIL", "TEST_USER_B"], opts),
         password: requireEnv(["TEST_B_PASSWORD", "TEST_PASS_B"], opts) },
  });

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  }
  console.log(pass ? "\nAll isolation checks passed." : "\nISOLATION FAILURE — do not ship.");
  process.exitCode = pass ? 0 : 1;
}

// No process.exit() from inside async work: on Windows that aborts the runtime with a libuv assertion
// while a socket is still open, which reads as a broken client and is not.
main().catch((e) => { console.error(`\n${e.message || e}`); process.exitCode = 2; });
