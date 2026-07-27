// The aggregate-statistics job. It runs with the service role and therefore bypasses RLS, which makes
// it the most dangerous code in the product — so these tests are mostly about restraint: what it
// refuses to read, what it refuses to publish, and what it refuses to log.
import { describe, it, expect } from "vitest";
import { runStatsJob } from "../../scripts/stats-job.mjs";
import { makeStatsClient } from "../../scripts/stats-job.mjs";
import { emptyDoc } from "../../src/state/document";
import { MIN_COHORT } from "../../src/engine/stats";

const emp = (name, amount) => ({
  id: "e" + name, name, title: "Engineer", basis: "annual", amount,
  start: 0, end: null, raises: [], promotions: [],
});
const co = (over = {}) => ({ ...emptyDoc(), cash: 600000, employees: [emp("Alex Rivera", 480000)], ...over });

/** A fake database that hands out documents in pages and records what was written. */
function fakeClient(docs) {
  const written = [];
  return {
    written,
    async getDocuments(offset, limit) { return docs.slice(offset, offset + limit); },
    async insertStats(row) { written.push(row); },
  };
}

describe("running the job", () => {
  it("reduces every contributing company to one anonymous row", async () => {
    const c = fakeClient(Array.from({ length: MIN_COHORT }, () => co()));
    const { row, scanned, contributed } = await runStatsJob({ client: c });
    expect(scanned).toBe(MIN_COHORT);
    expect(contributed).toBe(MIN_COHORT);
    expect(c.written).toHaveLength(1);
    expect(row.totalCash).toBe(600000 * MIN_COHORT);
  });

  it("pages through more companies than fit in one read", async () => {
    // 600 documents at ~20 KB is 12 MB; the whole customer base at once eventually is not fine.
    const c = fakeClient(Array.from({ length: 600 }, () => co()));
    const { scanned, contributed } = await runStatsJob({ client: c });
    expect(scanned).toBe(600);
    expect(contributed).toBe(600);
  });

  it("skips companies that signed up and never typed anything", async () => {
    const docs = [...Array.from({ length: MIN_COHORT }, () => co()), emptyDoc(), emptyDoc(), null];
    const { row, scanned, contributed } = await runStatsJob({ client: fakeClient(docs) });
    expect(scanned).toBe(MIN_COHORT + 3);
    expect(contributed).toBe(MIN_COHORT);
    expect(row.companies).toBe(MIN_COHORT);   // not MIN_COHORT + 3
  });

  it("still writes a snapshot when the cohort is too small — with the figures absent", async () => {
    // Storing the run matters operationally: you can see the job ran and why nothing was published.
    const c = fakeClient([co(), co()]);
    const { row } = await runStatsJob({ client: c });
    expect(c.written).toHaveLength(1);
    expect(row.suppressed).toBe(true);
    expect(row.companies).toBe(2);
    expect(row.totalCash).toBeNull();
  });

  it("writes nothing identifying, at any cohort size", async () => {
    const docs = Array.from({ length: MIN_COHORT }, (_, i) =>
      co({ name: `Celadyne ${i}`, pos: [{ id: "p", customer: "Northwind", amount: 1000 }] }));
    const c = fakeClient(docs);
    await runStatsJob({ client: c });
    const blob = JSON.stringify(c.written);
    expect(blob).not.toMatch(/Celadyne|Northwind|Alex Rivera|Engineer/);
  });

  it("logs counts, never names or bodies", async () => {
    // A job that logs what it reads has re-created the leak it was written to avoid.
    const lines = [];
    await runStatsJob({ client: fakeClient([co({ name: "Celadyne Energy" })]), log: (m) => lines.push(m) });
    expect(lines.join("\n")).not.toMatch(/Celadyne/);
    expect(lines.join("\n")).toMatch(/scanned 1/);
  });
});

describe("what the client asks the database for", () => {
  const capture = () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => [] };
    };
    return { calls, client: makeStatsClient({ url: "https://p.supabase.co", serviceKey: "svc", fetchImpl }) };
  };

  it("applies the OPT-OUT IN THE QUERY, so an opted-out document is never read", async () => {
    // Fetching everything and filtering in JavaScript would mean reading the document of a company
    // that asked not to be read, which is exactly what opting out means it should not do.
    const { calls, client } = capture();
    await client.getDocuments(0, 250);
    expect(calls[0].url).toMatch(/companies\.stats_optout=is\.false/);
    expect(calls[0].url).toMatch(/companies!inner/);
  });

  it("asks for bodies only — no user ids, no emails, no memberships", async () => {
    const { calls, client } = capture();
    await client.getDocuments(0, 250);
    expect(calls[0].url).toMatch(/select=body/);
    expect(calls[0].url).not.toMatch(/memberships|user_id|email/);
  });

  it("orders and pages deterministically, so a long run cannot skip or double-count", async () => {
    const { calls, client } = capture();
    await client.getDocuments(500, 250);
    expect(calls[0].url).toMatch(/order=id\.asc/);
    expect(calls[0].url).toMatch(/offset=500&limit=250/);
  });

  it("sends ONLY allowlisted aggregate columns, whatever it is handed", async () => {
    // The invariant is the allowlist, not exact presence: the point is that an extra field appearing
    // on the aggregate row can never reach the database by accident.
    const ALLOWED = new Set([
      "computed_at", "companies", "sample_size", "min_cohort", "suppressed",
      "total_cash", "total_funding_raised", "total_annual_revenue", "total_headcount",
      "median_runway_months", "mean_runway_months", "runway_sample_size",
      "companies_beyond_horizon", "horizon_months",
    ]);
    const { calls, client } = capture();
    await client.insertStats({
      companies: 3, sampleSize: 3, minCohort: 10, suppressed: true, computedAt: "2026-07-26T00:00:00Z",
      // things that must not be forwarded even when present on the object handed in
      companyName: "Celadyne Energy", topEarner: "Alex Rivera", rawDocs: [{ cash: 1 }],
    });
    const body = JSON.parse(calls[0].init.body);
    for (const k of Object.keys(body)) expect(ALLOWED.has(k), `unexpected column ${k}`).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/Celadyne|Alex Rivera/);
  });
});
