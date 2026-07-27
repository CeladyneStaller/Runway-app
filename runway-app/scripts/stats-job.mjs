// The aggregate-statistics job.
//
// Runs on a schedule with the SERVICE ROLE, which bypasses RLS. That makes it the single most
// dangerous piece of code in the product, so the constraints are structural rather than advisory:
//
//   * It reads only what it needs, and it reads it ONCE. `select body` on documents belonging to
//     companies that have not opted out. No joins to memberships, no user ids, no email addresses.
//   * OPT-OUT IS APPLIED IN THE QUERY. Fetching everything and filtering in JavaScript would mean an
//     opted-out company's document was read anyway, which is precisely what opting out means it
//     should not be.
//   * It holds nothing. Each document is reduced to scalars by `companyStats()` and dropped; the only
//     thing that outlives the run is one row of anonymous totals.
//   * It never logs a document, a company name, or an id.
//
// The client is injected so this can be driven by a fake in tests. `scripts/compute-stats.mjs` is the
// thin runner that supplies a real one.

import { companyStats, aggregate, MIN_COHORT } from "../src/engine/stats.js";

/** Page size for the document read. Documents are ~20 KB, so a thousand at a time is ~20 MB — large
 *  enough to be efficient and small enough not to hold the whole customer base in memory at once. */
const PAGE = 250;

/**
 * @param client  { getDocuments(offset, limit), insertStats(row) }
 * @returns       { row, scanned, contributed }
 */
export async function runStatsJob({ client, minCohort = MIN_COHORT, log = () => {} } = {}) {
  const stats = [];
  let scanned = 0;

  for (let offset = 0; ; offset += PAGE) {
    const batch = await client.getDocuments(offset, PAGE);
    if (!Array.isArray(batch) || batch.length === 0) break;
    scanned += batch.length;

    for (const doc of batch) {
      const s = companyStats(doc);
      // Non-contributing companies — empty models, unparseable bodies — are skipped rather than
      // counted as zeros. See `contributes()` for why that matters to the published averages.
      if (s) stats.push(s);
    }
    // Counts only. Never a name, an id, or a body.
    log(`scanned ${scanned}, contributing ${stats.length}`);

    if (batch.length < PAGE) break;
  }

  const row = aggregate(stats, { minCohort });
  await client.insertStats(row);
  return { row, scanned, contributed: stats.length };
}

/** PostgREST client for the job. Service-role key: this is the one place it is used, and it must
 *  never reach the browser bundle. */
export function makeStatsClient({ url, serviceKey, fetchImpl = fetch }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const base = url.replace(/\/$/, "");

  return {
    async getDocuments(offset, limit) {
      // THE OPT-OUT IS HERE, in the query. An embedded filter on the parent means an opted-out
      // company's document is never returned, rather than returned and discarded.
      const path = `/rest/v1/documents?select=body,companies!inner(stats_optout)`
        + `&companies.stats_optout=is.false`
        + `&order=id.asc&offset=${offset}&limit=${limit}`;
      const r = await fetchImpl(`${base}${path}`, { headers });
      if (!r.ok) throw new Error(`documents read failed: ${r.status}`);
      const rows = await r.json();
      return (Array.isArray(rows) ? rows : []).map(x => x.body);
    },

    async insertStats(row) {
      const r = await fetchImpl(`${base}/rest/v1/company_stats`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          computed_at: row.computedAt,
          companies: row.companies,
          sample_size: row.sampleSize,
          min_cohort: row.minCohort,
          suppressed: row.suppressed,
          total_cash: row.totalCash,
          total_funding_raised: row.totalFundingRaised,
          total_annual_revenue: row.totalAnnualRevenue,
          total_headcount: row.totalHeadcount,
          median_runway_months: row.medianRunwayMonths,
          mean_runway_months: row.meanRunwayMonths,
          runway_sample_size: row.runwaySampleSize,
          companies_beyond_horizon: row.companiesBeyondHorizon,
          horizon_months: row.horizonMonths,
        }),
      });
      if (!r.ok) throw new Error(`stats write failed: ${r.status}`);
    },
  };
}
