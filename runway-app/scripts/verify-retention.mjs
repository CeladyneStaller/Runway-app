#!/usr/bin/env node
// Runs the version-retention checks against a REAL Supabase project.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   TEST_A_EMAIL=... TEST_A_PASSWORD=... TEST_A_COMPANY=<uuid> \
//   node scripts/verify-retention.mjs
//
// IT WRITES ~40 saves into that company's document. Use a staging project or a throwaway company.
// Exits non-zero on failure so it can gate a deploy.
import { makeClient } from "./isolation-checks.mjs";
import { runRetentionChecks } from "./retention-checks.mjs";
import { loadEnvFiles, requireEnv } from "./env-file.mjs";

// Same env-file handling as verify-isolation: run months apart, by hand, from memory.
const loadedFrom = loadEnvFiles();
const need = (k) => requireEnv([k, k.replace(/^SUPABASE_/, "SUPABASE_TEST_").replace(/^TEST_A_EMAIL$/, "TEST_USER_A").replace(/^TEST_A_PASSWORD$/, "TEST_PASS_A")], { loadedFrom });

const client = makeClient({ url: need("SUPABASE_URL"), anonKey: need("SUPABASE_ANON_KEY") });

const { pass, results } = await runRetentionChecks({
  client,
  user: { email: need("TEST_A_EMAIL"), password: need("TEST_A_PASSWORD") },
  companyId: need("TEST_A_COMPANY"),
});

for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(pass ? "\nRetention is bounded." : "\nRETENTION FAILURE — document_versions is unbounded.");
process.exit(pass ? 0 : 1);
