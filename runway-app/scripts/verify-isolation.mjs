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

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(2); }
  return v;
};

const client = makeClient({ url: need("SUPABASE_URL"), anonKey: need("SUPABASE_ANON_KEY") });

const { pass, results } = await runIsolationChecks({
  client,
  a: { email: need("TEST_A_EMAIL"), password: need("TEST_A_PASSWORD") },
  b: { email: need("TEST_B_EMAIL"), password: need("TEST_B_PASSWORD") },
});

for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(pass ? "\nAll isolation checks passed." : "\nISOLATION FAILURE — do not ship.");
process.exit(pass ? 0 : 1);
