// The Sentry transport. The point of writing it by hand is that the vendor never sees a raw error,
// so most of these are about what reaches the wire.
import { describe, it, expect, vi } from "vitest";
import { parseDsn, parseFrames, toSentryEvent, toEnvelope, createSentrySink } from "../../src/state/sentry";
import { reportError, initErrorReporting, _resetErrorReporting } from "../../src/state/errors";

const DSN = "https://abc123@o42.ingest.sentry.io/4507";
const ev = (over = {}) => ({
  message: "Cannot read properties of null", name: "TypeError",
  stack: "at Scenarios (https://app.example.com/assets/index-a1b2.js:482:19)\n    at render (https://app.example.com/assets/index-a1b2.js:12:3)",
  context: { kind: "view-crash", view: "Scenarios", release: "abc" },
  at: "2026-07-27T14:22:09.881Z", ...over,
});

describe("addressing the endpoint", () => {
  it("pulls the key and project id out of a DSN", () => {
    const p = parseDsn(DSN);
    expect(p.key).toBe("abc123");
    expect(p.projectId).toBe("4507");
    expect(p.url).toContain("https://o42.ingest.sentry.io/api/4507/envelope/");
  });

  it("puts auth in the QUERYSTRING, not a custom header", () => {
    // A custom X-Sentry-Auth header triggers a CORS preflight on every single send. Sentry documents
    // the querystring form precisely so browsers can avoid that.
    expect(parseDsn(DSN).url).toMatch(/sentry_key=abc123&sentry_version=7/);
  });

  it("accepts every DSN shape Sentry issues, including regional and trailing-slash", () => {
    // Getting this wrong looks exactly like "the variable was never set": a null sink, a scrubbed
    // console line, and nothing sent. Worth pinning the shapes rather than discovering one at a time.
    for (const d of [
      "https://abc123@o42.ingest.sentry.io/4507",
      "https://abc123@o4507123.ingest.us.sentry.io/4508123456789012",
      "https://abc123@o4507123.ingest.de.sentry.io/4508123456789012",
      "https://abc@sentry.example.com/2",
      "https://abc123@o42.ingest.sentry.io/4507/",
      "  https://abc123@o42.ingest.sentry.io/4507  ",
    ]) expect(parseDsn(d), d).not.toBeNull();
  });

  it("returns null for junk, so a typo disables reporting rather than throwing on every crash", () => {
    expect(parseDsn("not a dsn")).toBeNull();
    expect(parseDsn("https://sentry.io/nokey")).toBeNull();
    expect(parseDsn("https://key@sentry.io/notanumber")).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it("builds no sink at all without a usable DSN", () => {
    expect(createSentrySink({ dsn: "junk" })).toBeNull();
    expect(createSentrySink({})).toBeNull();
  });
});

describe("the event payload", () => {
  it("carries the message, type and searchable tags", () => {
    const e = toSentryEvent(ev(), { release: "abc123", environment: "production" });
    expect(e.exception.values[0]).toMatchObject({ type: "TypeError", value: "Cannot read properties of null" });
    expect(e.tags).toMatchObject({ kind: "view-crash", view: "Scenarios" });
    expect(e.release).toBe("abc123");
    expect(e.event_id).toMatch(/^[0-9a-f]{32}$/);   // 32 hex, no dashes
  });

  it("parses frames OLDEST FIRST, which is the order Sentry groups on", () => {
    const frames = toSentryEvent(ev()).exception.values[0].stacktrace.frames;
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe("render");        // reversed from the stack string
    expect(frames[1]).toMatchObject({ function: "Scenarios", lineno: 482, colno: 19 });
  });

  it("drops unparseable frames rather than guessing at them", () => {
    // A wrong filename groups two different bugs together, which is worse than no frame.
    expect(parseFrames("total gibberish\nno frames here")).toEqual([]);
    expect(toSentryEvent(ev({ stack: "gibberish" })).exception.values[0].stacktrace).toBeUndefined();
  });

  it("survives an event with nothing in it", () => {
    const e = toSentryEvent({});
    expect(e.exception.values[0].type).toBe("Error");
    expect(e.timestamp).toBeTruthy();
  });

  it("wraps in a newline-delimited envelope with matching ids", () => {
    const s = toSentryEvent(ev());
    const lines = toEnvelope(s, DSN).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).event_id).toBe(s.event_id);
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]).event_id).toBe(s.event_id);
  });
});

describe("what actually reaches Sentry", () => {
  it("is the SCRUBBED event, never the raw one", () => {
    // The whole reason for not using @sentry/browser: its own handlers would capture this before the
    // scrubber ever ran.
    const posts = [];
    _resetErrorReporting();
    initErrorReporting(createSentrySink({ dsn: DSN, fetchImpl: async (u, i) => { posts.push(i.body); return { ok: true }; } }));
    reportError(new Error("payroll 480000 for alex@acme.com"), { view: "pay" });
    _resetErrorReporting();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatch(/<number>/);
    expect(posts[0]).toMatch(/<email>/);
    expect(posts[0]).not.toMatch(/480000|alex@acme.com/);
  });

  it("tags only short scalars, because tags are indexed and objects are not scrubbed for it", () => {
    const e = toSentryEvent({ context: { view: "scn", ok: true, blob: { cash: 1 } } });
    expect(e.tags).toMatchObject({ view: "scn", ok: "true" });
    expect(e.tags.blob).toBeUndefined();
  });
});

describe("not burning a month of quota in a minute", () => {
  const sink = (over = {}) => {
    const posts = [];
    const s = createSentrySink({ dsn: DSN, fetchImpl: async () => { posts.push(1); return { ok: true }; }, ...over });
    return { s, posts };
  };

  it("collapses the same error repeating — a render loop is one bug, not five hundred", () => {
    const { s, posts } = sink();
    for (let i = 0; i < 50; i++) s(ev());
    expect(posts).toHaveLength(1);
  });

  it("still reports a DIFFERENT error in the same burst", () => {
    const { s, posts } = sink();
    s(ev());
    s(ev({ message: "something else" }));
    s(ev({ context: { view: "pay" } }));
    expect(posts).toHaveLength(3);
  });

  it("caps the session, so one bad deploy cannot bury the event you needed", () => {
    const { s, posts } = sink({ maxPerSession: 3 });
    for (let i = 0; i < 20; i++) s(ev({ message: `distinct ${i}` }));
    expect(posts).toHaveLength(3);
  });

  it("lets the same error through again once the dedupe window passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00Z"));
    const { s, posts } = sink();
    s(ev());
    vi.setSystemTime(new Date("2026-07-27T00:00:30Z"));
    s(ev());
    expect(posts).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe("a failing send does not become an event", () => {
  it("swallows its own rejection instead of feeding the global handler", async () => {
    // Ad blockers block *.sentry.io outright. If that rejection escapes, the global handler catches
    // it and hands it straight back here — a reporter reporting its own failure to report.
    const s = createSentrySink({ dsn: DSN, fetchImpl: () => Promise.reject(new Error("blocked")) });
    await expect(s(ev())).resolves.toBeUndefined();
  });

  it("survives a fetch that throws synchronously", async () => {
    const s = createSentrySink({ dsn: DSN, fetchImpl: () => { throw new Error("nope"); } });
    expect(() => s(ev())).toThrow();   // reportError's try/catch handles this one
  });
});
