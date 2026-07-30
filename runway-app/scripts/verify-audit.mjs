#!/usr/bin/env node
// Runs the audit-log checks against a REAL Supabase project.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   TEST_A_EMAIL=... TEST_A_PASSWORD=... \
//   node scripts/verify-audit.mjs
//
// IT CREATES AND DELETES A THROWAWAY COMPANY on that account. Use a staging project.
// Exits non-zero on failure so it can gate a deploy.
import { makeClient } from "./isolation-checks.mjs";
import { runAuditChecks } from "./audit-checks.mjs";
import { loadEnvFiles, requireEnv } from "./env-file.mjs";

// Same env-file handling as verify-isolation: run months apart, by hand, from memory.
const loadedFrom = loadEnvFiles();
const need = (k) => requireEnv([k, k.replace(/^SUPABASE_/, "SUPABASE_TEST_").replace(/^TEST_A_EMAIL$/, "TEST_USER_A").replace(/^TEST_A_PASSWORD$/, "TEST_PASS_A")], { loadedFrom });

const client = makeClient({ url: need("SUPABASE_URL"), anonKey: need("SUPABASE_ANON_KEY") });

const { pass, results } = await runAuditChecks({
  client,
  user: { email: need("TEST_A_EMAIL"), password: need("TEST_A_PASSWORD") },
});

for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(pass ? "\nThe audit log records, and cannot be edited by the audited."
                 : "\nAUDIT FAILURE — see the failing checks above.");
process.exit(pass ? 0 : 1);
