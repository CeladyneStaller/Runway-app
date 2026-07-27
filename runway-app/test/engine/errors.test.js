// Error reporting, and specifically what it REFUSES to send. This app holds salaries, runway and
// funding status; an error SDK's default generosity is a leak here, so the scrubbing is the feature
// and these are the tests that matter.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scrubMessage, scrubContext, scrubStack, reportError, initErrorReporting,
         _resetErrorReporting, isReportingEnabled, installGlobalHandlers } from "../../src/state/errors";

let quiet;
beforeEach(() => { _resetErrorReporting(); quiet = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { quiet.mockRestore(); _resetErrorReporting(); });

describe("what must not leave the browser", () => {
  it("strips anything that looks like money out of a message", () => {
    // `new Error(\`bad doc \${JSON.stringify(doc)}\`)` is one careless line away at any time.
    expect(scrubMessage("cash 560000 payroll 168,000")).toBe("cash <number> payroll <number>");
  });

  it("strips email addresses, which identify a person on their own", () => {
    expect(scrubMessage("save failed for corey@acme.com")).toBe("save failed for <email>");
  });

  it("truncates, so a serialised document cannot ride along in a message", () => {
    const s = scrubMessage("x".repeat(5000));
    expect(s.length).toBeLessThan(520);
    expect(s.endsWith("…")).toBe(true);
  });

  it("redacts secret-shaped context keys by name", () => {
    const c = scrubContext({ access_token: "eyJhbGc", apiKey: "sk-1", Cookie: "a=b", password: "hunter2" });
    expect(Object.values(c).every(v => v === "<redacted>")).toBe(true);
  });

  it("DROPS objects and arrays rather than truncating them", () => {
    // A partial document is still a document.
    const c = scrubContext({ doc: { cash: 560000, employees: [{ name: "Alex", amount: 168000 }] } });
    expect(c.doc).toBe("<omitted>");
    expect(JSON.stringify(c)).not.toMatch(/Alex|168000|560000/);
  });

  it("keeps small, boring values that are actually useful for debugging", () => {
    expect(scrubContext({ view: "scn", demo: true, count: 3 }))
      .toEqual({ view: "scn", demo: true, count: 3 });
  });

  it("treats a large number as a number, because large numbers here are money", () => {
    expect(scrubContext({ amount: 560000 }).amount).toBe("<number>");
  });

  it("strips query strings and fragments off stack frames", () => {
    // A magic-link token in the address bar would otherwise ride along in every frame.
    const s = scrubStack("at f (https://app.example.com/x.js?token=abc123#t)\nat g (https://a/b.js)");
    expect(s).not.toMatch(/abc123/);
    expect(s).toMatch(/https:\/\/app\.example\.com\/x\.js/);
  });

  it("caps stack depth", () => {
    expect(scrubStack(Array.from({ length: 200 }, (_, i) => `at f${i}`).join("\n")).split("\n"))
      .toHaveLength(20);
  });
});

describe("reporting behaviour", () => {
  it("is OFF until something installs a sink", () => {
    // No DSN, no network call — local development and the test suite stay silent.
    expect(isReportingEnabled()).toBe(false);
    const ev = reportError(new Error("boom"));
    expect(ev.message).toBe("boom");
  });

  it("sends a scrubbed event once installed", () => {
    const sent = [];
    initErrorReporting(e => sent.push(e), { release: "1.2.3" });
    reportError(new Error("cash 560000 for corey@acme.com"), { view: "scn" });
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe("cash <number> for <email>");
    expect(sent[0].context).toMatchObject({ release: "1.2.3", view: "scn" });
  });

  it("still logs locally when reporting is on — the console is the developer's channel", () => {
    initErrorReporting(() => {});
    reportError(new Error("boom"));
    expect(quiet).toHaveBeenCalled();
  });

  it("NEVER throws, even when the sink does", () => {
    // A reporter that can fail is a way of losing the original error.
    initErrorReporting(() => { throw new Error("sentry is down"); });
    expect(() => reportError(new Error("the real bug"))).not.toThrow();
  });

  it("survives being handed something that isn't an Error", () => {
    expect(reportError("just a string").message).toBe("just a string");
    expect(reportError(null).message).toBe("");
    expect(reportError({ weird: true }).name).toBe("Error");
  });
});

describe("catching what escapes React", () => {
  it("picks up uncaught errors and unhandled rejections", () => {
    // Most of the storage and sync layer runs outside the render tree, so ViewBoundary never sees it.
    const sent = [];
    initErrorReporting(e => sent.push(e));
    const handlers = {};
    const target = {
      addEventListener: (k, fn) => { handlers[k] = fn; },
      removeEventListener: (k) => { delete handlers[k]; },
    };
    const off = installGlobalHandlers(target);

    handlers.error({ error: new Error("render escaped") });
    handlers.unhandledrejection({ reason: new Error("save failed") });
    expect(sent.map(e => e.message)).toEqual(["render escaped", "save failed"]);
    expect(sent[0].context.kind).toBe("uncaught");
    expect(sent[1].context.kind).toBe("unhandled-rejection");

    off();
    expect(Object.keys(handlers)).toHaveLength(0);
  });
});
