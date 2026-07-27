// The retention checks themselves, driven by a fake database so the logic is exercised offline.
// The real verification is `npm run verify:retention` against a live project — this only proves the
// checker can tell a bounded table from an unbounded one, which is the thing that would otherwise
// pass silently against a broken migration.
import { describe, it, expect } from "vitest";
import { runRetentionChecks } from "../../scripts/retention-checks.mjs";

/** A stand-in database whose save/prune behaviour is configurable, so each failure mode is reachable. */
function fakeDb({ keep = Infinity, coalesceWindow = false } = {}) {
  let versions = [];
  let v = 1;
  let body = null;
  let sawBurst = 0;

  return {
    peek: () => ({ versions: versions.length, body }),
    async signIn() { return "tok"; },
    async get(path) {
      if (path.includes("document_versions")) {
        const desc = [...versions].sort((a, b) => b - a);
        const m = /limit=(\d+)/.exec(path);
        return { ok: true, status: 200, body: (m ? desc.slice(0, +m[1]) : desc).map(x => ({ version: x })) };
      }
      return { ok: true, status: 200, body: [{ body, version: v }] };
    },
    async rpc(name, args) {
      if (name !== "save_document") return { ok: false, status: 404, body: null };
      sawBurst++;
      // coalescing: only snapshot every 6th save, standing in for a time window
      if (!coalesceWindow || sawBurst % 6 === 1) {
        versions.push(v);
        if (versions.length > keep) versions = versions.slice(-keep);
      }
      body = args.p_body;
      v += 1;
      return { ok: true, status: 200, body: [{ out_version: v, out_updated_at: "now" }] };
    },
  };
}

const run = (db) => runRetentionChecks({
  client: db, user: { email: "a@x.com", password: "p" }, companyId: "co-1", keep: 20,
});

describe("the retention checker", () => {
  it("passes a database that bounds and coalesces", async () => {
    const { pass, results } = await run(fakeDb({ keep: 20, coalesceWindow: true }));
    expect(results.map(r => r.name)).toContain("history stays inside the keep window");
    expect(pass).toBe(true);
  });

  it("FAILS a database with no migration applied at all — the state this exists for", async () => {
    // Every save snapshots and nothing is ever pruned: both the bound and the coalescing check fail.
    const { pass, results } = await run(fakeDb({ keep: Infinity, coalesceWindow: false }));
    expect(pass).toBe(false);
    expect(results.find(r => r.name === "history stays inside the keep window").pass).toBe(false);
    expect(results.find(r => r.name === "a burst of saves does not snapshot each time").pass).toBe(false);
  });

  it("cannot catch retention-missing-but-coalescing-working in a SHORT run, and that is expected", async () => {
    // Documented rather than papered over: you cannot make 21 snapshots in a minute when coalescing
    // is doing its job, so on a fresh project the bound assertion is close to vacuous. It bites on a
    // project with real history, and the no-migration case above is caught outright either way.
    const { pass } = await run(fakeDb({ keep: Infinity, coalesceWindow: true }));
    expect(pass).toBe(true);
  });

  it("FAILS when every save snapshots, even if the table is bounded", async () => {
    // Bounded storage but unbounded WRITE volume: 20 KB written and deleted on every debounce.
    const { pass, results } = await run(fakeDb({ keep: 20, coalesceWindow: false }));
    expect(pass).toBe(false);
    expect(results.find(r => r.name === "a burst of saves does not snapshot each time").pass).toBe(false);
  });

  it("checks the live document survived the hammering", async () => {
    const { results } = await run(fakeDb({ keep: 20, coalesceWindow: true }));
    expect(results.find(r => r.name === "the current document is still the last thing written").pass).toBe(true);
  });

  it("says so when history cannot be read at all", async () => {
    const db = fakeDb({ keep: 20, coalesceWindow: true });
    db.get = async () => ({ ok: false, status: 403, body: null });
    const { pass, results } = await run(db);
    expect(pass).toBe(false);
    expect(results[0].detail).toMatch(/grant/i);
  });
});
