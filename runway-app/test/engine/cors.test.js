// The Edge Function allow-list. `delete-account` deletes an account, so the interesting assertions
// here are the NEGATIVE ones: what must never be allowed, and what an unconfigured deployment does.
//
// This exists because the rule previously lived inside `index.ts`, which imports Deno globals and
// remote esm.sh modules and therefore cannot be imported by this suite at all — so a clause that
// allowed every origin until a secret was set sat in the file under a comment saying the opposite.
// Extracting it into a plain module is what makes the rule checkable.
import { describe, it, expect } from "vitest";
import { parseOrigins, allowedOrigin, corsHeaders }
  from "../../supabase/functions/_shared/cors.js";

const APP = "https://runway.example.com";

describe("parseOrigins", () => {
  it("splits, trims and drops blanks", () => {
    expect(parseOrigins(" https://a.com , https://b.com ,, ")).toEqual(["https://a.com", "https://b.com"]);
  });

  it("normalises a trailing slash and casing, which are the same origin", () => {
    // A configured value with a trailing slash is a plausible mistake whose only symptom is a CORS
    // error in somebody else's browser.
    expect(parseOrigins("https://App.Example.com/")).toEqual(["https://app.example.com"]);
  });

  it("treats unset, empty and whitespace as no origins at all", () => {
    for (const v of [undefined, null, "", "   ", ","]) expect(parseOrigins(v)).toEqual([]);
  });
});

describe("allowedOrigin — fails CLOSED", () => {
  it("allows nothing when the list is empty", () => {
    // THE REGRESSION. The previous implementation returned the caller's origin here.
    expect(allowedOrigin(APP, [])).toBe("");
    expect(allowedOrigin("https://evil.example", [])).toBe("");
  });

  it("allows nothing when the list is missing entirely", () => {
    expect(allowedOrigin(APP, undefined)).toBe("");
    expect(allowedOrigin(APP, null)).toBe("");
  });

  it("echoes a listed origin", () => {
    expect(allowedOrigin(APP, [APP])).toBe(APP);
  });

  it("refuses an origin that is not listed", () => {
    expect(allowedOrigin("https://evil.example", [APP])).toBe("");
  });

  it("refuses a lookalike rather than matching on a prefix", () => {
    expect(allowedOrigin("https://runway.example.com.evil.test", [APP])).toBe("");
    expect(allowedOrigin("https://evil.test?x=" + APP, [APP])).toBe("");
  });

  it("refuses when there is no Origin header", () => {
    expect(allowedOrigin(null, [APP])).toBe("");
    expect(allowedOrigin("", [APP])).toBe("");
  });

  it("matches a listed origin despite a trailing slash in the config", () => {
    expect(allowedOrigin(APP, parseOrigins(APP + "/"))).toBe(APP);
  });
});

describe("corsHeaders", () => {
  it("OMITS the header entirely when refusing, rather than sending an empty one", () => {
    const h = corsHeaders("https://evil.example", [APP]);
    expect("Access-Control-Allow-Origin" in h).toBe(false);
  });

  it("treats a literal * in the config as NOTHING, not as everything", () => {
    // Somebody setting ALLOWED_ORIGINS=* means "allow all", which is the one answer this module
    // refuses. It lands on an empty list, so the deployment is loudly refused rather than open.
    expect(parseOrigins("*")).toEqual([]);
    expect(allowedOrigin("https://evil.example", parseOrigins("*"))).toBe("");
  });

  it("never sends a wildcard, for any input", () => {
    for (const list of [[], [APP], ["*"]]) {
      for (const origin of [APP, "https://evil.example", "*", null]) {
        expect(corsHeaders(origin, list)["Access-Control-Allow-Origin"]).not.toBe("*");
      }
    }
  });

  it("always varies on Origin, allowed or not", () => {
    expect(corsHeaders(APP, [APP]).Vary).toBe("Origin");
    expect(corsHeaders(APP, []).Vary).toBe("Origin");
  });

  it("echoes the allowed origin and keeps the preflight headers", () => {
    const h = corsHeaders(APP, [APP]);
    expect(h["Access-Control-Allow-Origin"]).toBe(APP);
    expect(h["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(h["Access-Control-Allow-Methods"]).toContain("OPTIONS");
  });
});
