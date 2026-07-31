// The hosted backend, exercised without a network. What matters here is not that the happy path works
// but that each failure is told apart correctly: "no document yet" must never look like "couldn't
// reach the server", and a conflict must never look like a retryable blip.
import { describe, it, expect, vi } from "vitest";
import { createSupabaseBackend } from "../../src/state/backends/supabase.js";
import {
  BackendError, ERR_CONFLICT, ERR_FORBIDDEN, ERR_PROJECT_CONFLICT, ERR_STALE_CLIENT, ERR_UNREACHABLE, isRetryable,
} from "../../src/state/backends/errors.js";

const auth = { getAccessToken: async () => "jwt-abc", getCompanyId: async () => "co-1" };
const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const bad = (status, payload) => ({ ok: false, status, json: async () => payload });

const make = (fetchImpl) => createSupabaseBackend({
  url: "https://proj.supabase.co/", anonKey: "anon-key", auth, fetchImpl,
});

describe("reading", () => {
  it("returns null when the company has no document yet — that is not an error", async () => {
    const b = make(async () => ok([]));
    expect(await b.read()).toBeNull();
  });

  it("returns the document and remembers the version", async () => {
    const b = make(async () => ok([{ body: { cash: 42 }, schema_version: 3, version: 7 }]));
    const r = await b.read();
    expect(r.raw).toEqual({ cash: 42 });
    expect(r.meta.version).toBe(7);
    expect(b._version()).toBe(7);
  });

  it("sends the anon key and the user's token, scoped to the company", async () => {
    // The read moved from a direct table select to `load_document` (036), so the company travels in
    // the body rather than the query string. One RPC, because fetching the blob and the project rows
    // separately would put a save between them.
    let seen;
    const b = make(async (u, i) => { seen = { u, i }; return ok([]); });
    await b.read();
    expect(seen.u).toContain("/rest/v1/rpc/load_document");
    expect(JSON.parse(seen.i.body).p_company_id).toBe("co-1");
    expect(seen.i.headers.apikey).toBe("anon-key");
    expect(seen.i.headers.Authorization).toBe("Bearer jwt-abc");
  });

  it("a network failure is UNREACHABLE, never an empty document", async () => {
    const b = make(async () => { throw new TypeError("Failed to fetch"); });
    await expect(b.read()).rejects.toMatchObject({ kind: ERR_UNREACHABLE });
  });
});

describe("writing", () => {
  it("goes through the RPC carrying the version it loaded", async () => {
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) {
        return ok([{ body: {}, schema_version: 3, version: 4, projects: [] }]);
      }
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5, out_updated_at: "2026-07-23T00:00:00Z" }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, cash: 1 });
    expect(sent.p_company_id).toBe("co-1");
    expect(sent.p_schema_version).toBe(3);
    expect(sent.p_base_version).toBe(4);       // the precondition — this is what stops a blind write
    expect(b._version()).toBe(5);              // and it advances
  });

  it("a first write for a new company carries a null base version", async () => {
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("/documents")) return ok([]);
      sent = JSON.parse(i.body);
      return ok([{ out_version: 1 }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3 });
    expect(sent.p_base_version).toBeNull();
  });

  it("P0002 is a CONFLICT, and conflicts are not retryable", async () => {
    const b = make(async () => bad(400, { code: "P0002", message: "conflict" }));
    const e = await b.write({ schemaVersion: 3 }).catch(x => x);
    expect(e).toBeInstanceOf(BackendError);
    expect(e.kind).toBe(ERR_CONFLICT);
    expect(isRetryable(e)).toBe(false);        // retrying would overwrite the other device's work
  });

  it("P0001 is a STALE_CLIENT, and is not retryable", async () => {
    const b = make(async () => bad(400, { code: "P0001", message: "stale_client" }));
    const e = await b.write({ schemaVersion: 2 }).catch(x => x);
    expect(e.kind).toBe(ERR_STALE_CLIENT);
    expect(isRetryable(e)).toBe(false);
  });

  it("401/403 is FORBIDDEN, and is not retryable", async () => {
    for (const status of [401, 403]) {
      const b = make(async () => bad(status, { message: "no" }));
      const e = await b.write({ schemaVersion: 3 }).catch(x => x);
      expect(e.kind).toBe(ERR_FORBIDDEN);
      expect(isRetryable(e)).toBe(false);
    }
  });

  it("a dropped connection IS retryable — that one is just a blip", async () => {
    const b = make(async () => { throw new TypeError("Failed to fetch"); });
    const e = await b.write({ schemaVersion: 3 }).catch(x => x);
    expect(e.kind).toBe(ERR_UNREACHABLE);
    expect(isRetryable(e)).toBe(true);
  });
});

describe("configuration", () => {
  it("refuses to construct without a url and key, rather than silently doing nothing", () => {
    expect(() => createSupabaseBackend({ auth })).toThrow();
    expect(() => createSupabaseBackend({ url: "https://x", auth })).toThrow();
  });

  it("tolerates a trailing slash on the url", async () => {
    let seen;
    const b = make(async (u) => { seen = u; return ok([]); });
    await b.read();
    expect(seen).not.toContain("//rest");
  });
});

describe("syncConfigured", () => {
  it("is opt-in: all three of flag, url and key, or it stays local", async () => {
    const { syncConfigured } = await import("../../src/state/storage.js");
    expect(syncConfigured({})).toBe(false);
    expect(syncConfigured({ VITE_SUPABASE_URL: "u", VITE_SUPABASE_ANON_KEY: "k" })).toBe(false);
    expect(syncConfigured({ VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "u" })).toBe(false);
    expect(syncConfigured({ VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "u", VITE_SUPABASE_ANON_KEY: "k" })).toBe(true);
  });
});

describe("reading, after the split (stage 3)", () => {
  it("takes projects from the ROWS, not from the blob", async () => {
    const b = make(async () => ok([{
      body: { cash: 10, projects: [{ id: "stale" }] }, schema_version: 3, version: 1,
      projects: [{ id: "fresh", name: "Fresh" }],
    }]));
    const r = await b.read();
    expect(r.raw.projects.map(p => p.id)).toEqual(["fresh"]);
    expect(r.raw.cash).toBe(10);
  });

  it("FALLS BACK to the blob when the rows are empty and the blob is not", async () => {
    // The load-time data loss this guards against: a company whose backfill never ran would otherwise
    // open with every project silently gone, and nothing would say so.
    const b = make(async () => ok([{
      body: { cash: 10, projects: [{ id: "a" }, { id: "b" }] }, schema_version: 3, version: 1,
      projects: [],
    }]));
    const r = await b.read();
    expect(r.raw.projects.map(p => p.id)).toEqual(["a", "b"]);
  });

  it("treats a genuinely empty document as empty, not as a fallback", async () => {
    const b = make(async () => ok([{ body: { cash: 10, projects: [] }, schema_version: 3,
                                     version: 1, projects: [] }]));
    expect((await b.read()).raw.projects).toEqual([]);
  });

  it("still reports no document at all as null", async () => {
    const b = make(async () => ok([]));
    expect(await b.read()).toBeNull();
  });
});

describe("per-project concurrency (stage 5)", () => {
  const loaded = (projects, versions) => ok([{
    body: { cash: 10 }, schema_version: 3, version: 4,
    projects, project_versions: versions,
  }]);

  it("sends back the project versions it loaded", async () => {
    // Without this the server cannot tell an edit to a stale project from an edit to a fresh one — and
    // cannot tell a project the client never saw from one it deleted.
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) return loaded([{ id: "a" }, { id: "b" }], { a: 2, b: 7 });
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5 }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, cash: 1 });
    expect(sent.p_known_projects).toEqual({ a: 2, b: 7 });
  });

  it("KEEPS the map after a write, taking the new versions from the response", async () => {
    // REVERSED, AND THE ORIGINAL ASSERTION WAS A DATA-LOSS BUG. This used to assert the map was
    // discarded, reasoning that guessing the new versions would assert a precondition nobody checked.
    // True — but a null map does not mean "check nothing" on the server, it means the pre-040
    // behaviour: no version checks and every project treated as changed. So the second save after a
    // load rewrote every project from this client's own copy, including stale ones somebody else had
    // edited. Observed in the wild: A edits project 1, B edits project 2 twice, A's work is gone.
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) return loaded([{ id: "a" }], { a: 2 });
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5, out_project_versions: { a: 3 } }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, cash: 1 });
    await b.write({ schemaVersion: 3, cash: 2 });
    expect(sent.p_known_projects).toEqual({ a: 3 });
  });

  it("does NOT adopt the version of a project somebody else changed", async () => {
    // Adopting it would say "my copy is based on their version" about a copy this client has never
    // seen — and the next edit to that project would overwrite them with no conflict and no question.
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) return loaded([{ id: "a" }, { id: "b" }], { a: 1, b: 1 });
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5, out_project_versions: { b: 2 },
                   out_stale_projects: { a: { version: 7, body: { id: "a" } } } }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, cash: 1 });
    await b.write({ schemaVersion: 3, cash: 2 });
    expect(sent.p_known_projects).toEqual({ a: 1, b: 2 });   // a stays at 1, so editing it conflicts
  });

  it("sends an empty map for a company with no projects, not null", async () => {
    // Null means "this client does not do per-project checking" and keeps the OLD behaviour, including
    // deleting rows it never saw. An empty map means "I loaded, there were none" — a different claim.
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) return loaded([], {});
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5 }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, cash: 1 });
    expect(sent.p_known_projects).toEqual({});
  });

  it("classifies a project conflict as its own kind, not a document conflict", async () => {
    const b = make(async (u) => {
      if (u.includes("load_document")) return loaded([{ id: "a" }], { a: 2 });
      return { ok: false, status: 409,
               json: async () => ({ code: "P0018", message: "project_conflict:a" }) };
    });
    await b.read();
    await expect(b.write({ schemaVersion: 3, cash: 1 }))
      .rejects.toMatchObject({ kind: ERR_PROJECT_CONFLICT });
  });
});

describe("the classifier's specific answers beat its general ones", () => {
  // `project_conflict` contains the substring `conflict`, so it was being classified as a whole-
  // document conflict by the generic fallback on the first line. Every refusal that shares a word with
  // a broader one is checked here, because a substring fallback is only safe while nothing more
  // specific shares the word.
  const raise = (code, message) => make(async (u) =>
    u.includes("load_document")
      ? ok([{ body: {}, schema_version: 3, version: 1, projects: [], project_versions: {} }])
      : ({ ok: false, status: 409, json: async () => ({ code, message }) }));

  it.each([
    ["P0018", "project_conflict:abc", ERR_PROJECT_CONFLICT],
    ["P0002", "conflict", ERR_CONFLICT],
  ])("%s -> %s", async (code, message, kind) => {
    const b = raise(code, message);
    await b.read();
    await expect(b.write({ schemaVersion: 3 })).rejects.toMatchObject({ kind });
  });

  it("falls back on the MESSAGE correctly too, when a gateway drops the code", async () => {
    const b = raise("", "project_conflict:abc");
    await b.read();
    await expect(b.write({ schemaVersion: 3 })).rejects.toMatchObject({ kind: ERR_PROJECT_CONFLICT });
  });
});

describe("only the projects this client changed (stage 5, fixed)", () => {
  const P = (id, name) => ({ id, name });
  const loadedWith = (projects, versions) => ok([{
    body: { cash: 10 }, schema_version: 3, version: 4, projects, project_versions: versions,
  }]);

  const sending = async (loaded, versions, toWrite) => {
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) return loadedWith(loaded, versions);
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5 }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, cash: 10, projects: toWrite });
    return sent;
  };

  it("names only the edited one, not the whole list", async () => {
    // THE BUG THIS FIXES. The client sends every project on every save, so a stale copy of one somebody
    // else edited looked like an edit and conflicted on a project this person never opened.
    const sent = await sending([P("x", "X"), P("y", "Y")], { x: 1, y: 1 },
                               [P("x", "X"), P("y", "Y EDITED")]);
    expect(sent.p_changed_projects).toEqual(["y"]);
  });

  it("names nothing when only the document body moved", async () => {
    const sent = await sending([P("x", "X")], { x: 1 }, [P("x", "X")]);
    expect(sent.p_changed_projects).toEqual([]);
  });

  it("names a project that did not exist at load", async () => {
    const sent = await sending([P("x", "X")], { x: 1 }, [P("x", "X"), P("new", "New")]);
    expect(sent.p_changed_projects).toEqual(["new"]);
  });

  it("says nothing about one that was deleted — absence is the signal", async () => {
    // A removed project is not "changed"; it is missing from the body, which with `p_known` is what
    // tells the server to delete the row.
    const sent = await sending([P("x", "X"), P("y", "Y")], { x: 1, y: 1 }, [P("x", "X")]);
    expect(sent.p_changed_projects).toEqual([]);
    expect(sent.p_known_projects).toEqual({ x: 1, y: 1 });
  });

  it("ignores key order, so a re-serialised project is not an edit", async () => {
    // The document is rebuilt on every render. If key order counted, every save would claim every
    // project changed and the fix would achieve nothing.
    const sent = await sending([{ id: "x", name: "X", budget: 10 }], { x: 1 },
                               [{ budget: 10, name: "X", id: "x" }]);
    expect(sent.p_changed_projects).toEqual([]);
  });

  it("sends NULL rather than an empty list when there is nothing to compare against", async () => {
    // Null means "treat everything as changed" — the older, noisier, still-safe behaviour. An empty
    // list would claim nothing moved, which is a different and false statement.
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) return ok([]);      // no document yet
      sent = JSON.parse(i.body);
      return ok([{ out_version: 1 }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, projects: [P("a", "A")] });
    expect(sent.p_changed_projects).toBeNull();
  });
});

describe("reporting what somebody else changed", () => {
  it("hands the stale set up, and adopts the versions it names", async () => {
    // The versions are adopted so the NEXT write is checked against reality rather than against a copy
    // already known to be behind; the bodies go up because whether to load somebody else's version is
    // the person's decision, not this layer's.
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("load_document")) {
        return ok([{ body: { cash: 1 }, schema_version: 3, version: 4,
                     projects: [{ id: "a" }], project_versions: { a: 1 } }]);
      }
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5, out_stale_projects: {
        a: { version: 9, body: { id: "a", name: "Theirs" }, updated_by: "dana@x.com" } } }]);
    });
    await b.read();
    const res = await b.write({ schemaVersion: 3, cash: 2, projects: [{ id: "a" }] });
    expect(res.meta.staleProjects.a.body.name).toBe("Theirs");
    expect(sent.p_known_projects).toEqual({ a: 1 });
  });

  it("reports nothing when nothing moved", async () => {
    const b = make(async (u) =>
      u.includes("load_document")
        ? ok([{ body: {}, schema_version: 3, version: 4, projects: [], project_versions: {} }])
        : ok([{ out_version: 5, out_stale_projects: {} }]));
    await b.read();
    expect((await b.write({ schemaVersion: 3 })).meta.staleProjects).toBeNull();
  });
});
