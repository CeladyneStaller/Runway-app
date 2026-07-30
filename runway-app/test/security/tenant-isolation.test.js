// CROSS-TENANT ISOLATION, verified against a REAL project.
//
// Every other test in this repo runs against fakes, which is right for logic and useless for this: the
// question is not "does my code intend to isolate tenants" but "does the database actually refuse".
// Policies that look correct in a migration file are not evidence. This asks Postgres.
//
// ONE IMPLEMENTATION, in `scripts/isolation-checks.mjs`. This file used to carry its OWN copy of the
// probes under its own env var names, so `npm test` and `npm run verify:isolation` asserted DIFFERENT
// things, and a probe added to one was absent from the other — which is how the QuickBooks connection
// checks came to exist in the script and not here. The same failure as three hand-written CORS header
// lists, and the same fix: the probes live in one module and both entry points drive it.
//
// SKIPPED unless credentials are present, so `npm test` stays offline and fast. Run it deliberately:
//
//   SUPABASE_TEST_URL=https://xxx.supabase.co \
//   SUPABASE_TEST_ANON_KEY=eyJ... \
//   TEST_USER_A=a@example.com TEST_PASS_A=... \
//   TEST_USER_B=b@example.com TEST_PASS_B=... \
//   npm run test:isolation
//
// The `SUPABASE_URL` / `TEST_A_EMAIL` names the shell runner uses are accepted too, so one env file
// drives both. The accounts must be two different people, and email/password sign-in must be enabled —
// magic links are passwordless and cannot be scripted.
//
// IT WRITES a marker document into each account's company. Use throwaway accounts.
import { describe, it, expect, beforeAll } from "vitest";
import { makeClient, runIsolationChecks } from "../../scripts/isolation-checks.mjs";

const env = (...names) => names.map(n => process.env[n]).find(Boolean);

const URL = env("SUPABASE_TEST_URL", "SUPABASE_URL");
const ANON = env("SUPABASE_TEST_ANON_KEY", "SUPABASE_ANON_KEY");
const A = { email: env("TEST_USER_A", "TEST_A_EMAIL"), password: env("TEST_PASS_A", "TEST_A_PASSWORD") };
const B = { email: env("TEST_USER_B", "TEST_B_EMAIL"), password: env("TEST_PASS_B", "TEST_B_PASSWORD") };

const configured = !!(URL && ANON && A.email && A.password && B.email && B.password);

describe.skipIf(!configured)("cross-tenant isolation, against a real database", () => {
  let results = [];
  let failure = null;

  beforeAll(async () => {
    try {
      const client = makeClient({ url: URL, anonKey: ANON });
      ({ results } = await runIsolationChecks({ client, a: A, b: B }));
    } catch (e) {
      // A SIGN-IN FAILURE IS NOT AN ISOLATION RESULT and must not be reported as one. It means the
      // accounts or the auth settings are wrong, which is a different conversation from "the database
      // leaked" — and confusing the two is how somebody concludes the wrong thing at speed.
      failure = e?.message || String(e);
    }
  }, 60_000);

  // ONE TEST, EVERY PROBE. Vitest needs test names at collection time while the probe names live in the
  // module, so one `it()` per probe would mean listing them here — a second copy of exactly the
  // knowledge this consolidation removed. The granularity goes into the failure message instead.
  it("the database refuses every cross-tenant read and write", () => {
    expect(failure, `could not run the probes: ${failure}`).toBeNull();
    expect(results.length, "no probes ran").toBeGreaterThan(0);

    const failed = results.filter(r => !r.pass);
    const report = results.map(r => `${r.pass ? "PASS" : "FAIL"}  ${r.name}` +
                                    (r.detail ? `  (${r.detail})` : "")).join("\n");
    expect(failed, `\n${report}\n`).toEqual([]);
  });
});

// A VISIBLE REMINDER rather than a silent absence. A suite that is skipped and never mentioned is one
// nobody remembers to run, and this is the only test in the repo that asks the database anything.
describe.skipIf(configured)("cross-tenant isolation", () => {
  it("skipped — set SUPABASE_TEST_URL and two test accounts to run it (see the file header)", () => {
    expect(configured).toBe(false);
  });
});
