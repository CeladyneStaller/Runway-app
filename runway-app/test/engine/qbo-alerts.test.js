// Whether a keep-alive run should wake somebody. Tested rather than written inline because every
// wrong call in this phase was a one-line verdict nobody exercised, and this one decides between an
// email and silence.
import { describe, it, expect } from "vitest";
import { alertsFrom, exitCodeFor } from "../../scripts/qbo-alerts.mjs";

const codes = (s, h) => alertsFrom(s, h).map(a => a.code);
const fails = (s, h) => exitCodeFor(alertsFrom(s, h)) === 1;

const clean = { considered: 3, rotated: 3, needs_reauth: 0, failed: 0 };
const healthy = { total: 3, active: 3, needs_reauth: 0, never_synced: 0, stale_syncs: 0, reauth_due_90d: 0 };

describe("a quiet month says nothing and passes", () => {
  it("no alerts at all", () => {
    expect(alertsFrom(clean, healthy)).toEqual([]);
    expect(fails(clean, healthy)).toBe(false);
  });

  it("survives being called with nothing", () => {
    expect(alertsFrom()).toEqual([]);
    expect(exitCodeFor([])).toBe(0);
  });
});

describe("what must wake somebody", () => {
  it("a connection that died during this run", () => {
    expect(codes({ ...clean, needs_reauth: 1 }, healthy)).toContain("needs_reauth");
    expect(fails({ ...clean, needs_reauth: 1 }, healthy)).toBe(true);
  });

  it("a connection still waiting to be reconnected from an EARLIER run", () => {
    // The first alert may have been missed, and the sync has been stale ever since. Repeating it is
    // the point — an alert that fires once and never again is indistinguishable from a fixed problem.
    expect(codes(clean, { ...healthy, needs_reauth: 2 })).toContain("still_disconnected");
    expect(fails(clean, { ...healthy, needs_reauth: 2 })).toBe(true);
  });

  it("a healthy connection that has stopped syncing", () => {
    // THE FAILURE THIS JOB EXISTS FOR. Nothing is broken, the token is fine, and the numbers on
    // somebody's dashboard stopped being true.
    expect(codes(clean, { ...healthy, stale_syncs: 1 })).toContain("stale");
    expect(fails(clean, { ...healthy, stale_syncs: 1 })).toBe(true);
  });
});

describe("what must NOT wake somebody", () => {
  it("a transient refresh failure, which the next run retries", () => {
    // An alert that cries wolf monthly is filtered into a folder within a quarter, and then the real
    // one is invisible too.
    expect(codes({ ...clean, failed: 2 }, healthy)).toEqual(["transient"]);
    expect(fails({ ...clean, failed: 2 }, healthy)).toBe(false);
  });

  it("a re-authorization ceiling still 90 days out", () => {
    expect(codes(clean, { ...healthy, reauth_due_90d: 1 })).toEqual(["reauth_due"]);
    expect(fails(clean, { ...healthy, reauth_due_90d: 1 })).toBe(false);
  });

  it("a connection that has never synced", () => {
    expect(codes(clean, { ...healthy, never_synced: 1 })).toEqual(["never_synced"]);
    expect(fails(clean, { ...healthy, never_synced: 1 })).toBe(false);
  });
});

describe("the two disconnection alerts do not double up", () => {
  it("reports only the fresh one when a connection died during this run", () => {
    const c = codes({ ...clean, needs_reauth: 1 }, { ...healthy, needs_reauth: 1 });
    expect(c).toContain("needs_reauth");
    expect(c).not.toContain("still_disconnected");
  });
});

describe("everything at once", () => {
  it("reports each item and fails the run", () => {
    const s = { considered: 9, rotated: 4, needs_reauth: 2, failed: 1 };
    const h = { total: 9, active: 6, needs_reauth: 2, never_synced: 1, stale_syncs: 3, reauth_due_90d: 1 };
    const c = codes(s, h);
    expect(c).toEqual(["needs_reauth", "stale", "reauth_due", "transient", "never_synced"]);
    expect(fails(s, h)).toBe(true);
  });

  it("every alert carries text a person can act on without reading the code", () => {
    for (const a of alertsFrom({ needs_reauth: 1, failed: 1 },
                               { needs_reauth: 1, stale_syncs: 1, never_synced: 1, reauth_due_90d: 1 })) {
      expect(a.text.length).toBeGreaterThan(30);
      expect(["act", "warn", "note"]).toContain(a.level);
    }
  });
});
