#!/usr/bin/env node
// Computes and stores one aggregate-statistics snapshot.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/compute-stats.mjs
//
// SERVICE ROLE. This key bypasses RLS and must never be in the browser bundle, a VITE_ variable, or
// anything committed. Run it from a scheduled CI job with the key in a secret store.
//
// Safe to run repeatedly: each run appends one snapshot and `public_stats` serves the newest
// unsuppressed one.
import { makeStatsClient, runStatsJob } from "./stats-job.mjs";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(2); }
  return v;
};

if (process.env.VITE_SUPABASE_SERVICE_KEY) {
  console.error("Refusing to run: the service key must not be a VITE_ variable — those are inlined "
    + "into the browser bundle at build time. Rename it to SUPABASE_SERVICE_KEY.");
  process.exit(2);
}

const client = makeStatsClient({
  url: need("SUPABASE_URL"),
  serviceKey: need("SUPABASE_SERVICE_KEY"),
});

const { row, scanned, contributed } = await runStatsJob({ client, log: (m) => console.log(m) });

console.log(`\nscanned ${scanned} documents, ${contributed} contributed`);
if (row.suppressed) {
  console.log(`SUPPRESSED: ${row.companies} companies is below the floor of ${row.minCohort}. `
    + `Snapshot stored with figures absent; public_stats stays empty.`);
} else {
  console.log(`companies              ${row.companies}`);
  console.log(`total cash             ${row.totalCash}`);
  console.log(`total funding raised   ${row.totalFundingRaised}`);
  console.log(`median runway (months) ${row.medianRunwayMonths}  across ${row.runwaySampleSize}`);
  console.log(`beyond horizon         ${row.companiesBeyondHorizon}`);
}
