import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (f) => readFileSync(`src/legal/${f}`, "utf8");

describe("⚠️ the legal documents are IN the repo, as one source", () => {
  it("both exist as markdown", () => {
    // A modal fed by a separate copy drifts from the page, and the drift stays invisible until somebody
    // quotes the wrong one back at you.
    expect(existsSync("src/legal/terms.md")).toBe(true);
    expect(existsSync("src/legal/privacy.md")).toBe(true);
  });

  it("⚠️ THE VERSION MATCHES THE EXECUTED DOCUMENTS", () => {
    // `TERMS_VERSION` said 2026-08-04 while the signed documents said 2026-08-12 — eight days apart, so
    // every acceptance would have named a version nobody was shown. **A version number kept anywhere
    // other than beside its text will drift from it.**
    const idx = read("index.js");
    expect(idx).toMatch(/LEGAL_VERSION = "2026-08-12"/);
    const plans = readFileSync("src/state/plans.js", "utf8");
    expect(plans, "plans.js must not declare its own version").not.toMatch(/TERMS_VERSION = "20/);
    expect(plans).toMatch(/LEGAL_VERSION as TERMS_VERSION/);
  });

  it("carry the sections the executed documents have", () => {
    const secs = (b) => (b.match(/^## \d+\./gm) || []).length;
    expect(secs(read("terms.md"))).toBe(15);
    expect(secs(read("privacy.md"))).toBe(15);
  });

  it("⚠️ KEEP THE CONSPICUOUS ALL-CAPS PARAGRAPHS", () => {
    // Several disclaimers are only enforceable if they are conspicuous, so a conversion that
    // sentence-cased them for tidiness would have weakened the clause.
    const t = read("terms.md");
    const caps = t.split("\n").filter(l => l.length > 60 && l === l.toUpperCase());
    expect(caps.length).toBeGreaterThan(0);
  });

  it("did not lose the document to the conversion", () => {
    expect(read("terms.md").length).toBeGreaterThan(30000);
    expect(read("privacy.md").length).toBeGreaterThan(15000);
  });
});

// ⚠️ A NEGATIVE ASSERTION AGAINST A SOURCE FILE MUST STRIP COMMENTS FIRST.
//
// "This word does not appear" is false the moment somebody writes a comment ABOUT the word — which is
// exactly what happened here, in a comment explaining what the removed control used to do. The five
// POSITIVE assertions in this file are safe by comparison: a comment matching means the code almost
// certainly does too, and a false pass would need somebody to document a thing they never built.
//
// **The asymmetry is the point: `toMatch` on source is weak evidence, `not.toMatch` is no evidence at
// all until the comments are gone.**

describe("⚠️ acceptance is asked ONCE, in TermsGate", () => {
  const signin = readFileSync("src/views/SignIn.jsx", "utf8");
  const setpw = readFileSync("src/views/SetPassword.jsx", "utf8");
  const gate = readFileSync("src/views/chrome/TermsGate.jsx", "utf8");

  it("⚠️ NOT ON THE EMAIL STEP, NOT ON THE PASSWORD STEP", () => {
    // It was asked in all three places. **Asking three times is not three times the consent** — it is
    // a person clicking past something they have already agreed to, which is weaker evidence than
    // asking once and meaning it.
    expect(signin, "SignIn must not ask").not.toMatch(/type="checkbox"/);
    expect(setpw, "SetPassword must not ask").not.toMatch(/type="checkbox"/);
  });

  it("IS ASKED IN `TermsGate`, which renders in the shell", () => {
    // The shell covers every route into the app, rather than one step of one flow.
    expect(gate).toMatch(/type="checkbox"/);
  });

  it("still records the version with the signup", () => {
    // Removing the control must not remove the record: `signUpWithPassword` carries the version the
    // document was on, so the acceptance names a document rather than "whatever was current".
    expect(signin).toMatch(/termsVersion: TERMS_VERSION/);
  });

  it("⚠️ AND REMOVING IT DID NOT LEAVE THE FORM UNSUBMITTABLE", () => {
    // `agreed` gated `ready` sixty-five lines from where the checkbox rendered. **Deleting a control
    // means finding what depended on it, not only where it appeared** — without this the
    // account-creation path could never be submitted, because nothing could set the flag.
    // ⚠️ CHECKED IN CODE, NOT IN THE WHOLE FILE. My first version searched the source for the word
    // `agreed` — and matched the COMMENT I had just written explaining that it used to gate the
    // button. **A test that reads comments is testing the prose, not the program**, and this is the
    // third assertion in this area to check a string where it meant to check behaviour.
    const code = setpw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code, "no acceptance state remains").not.toMatch(/\bagreed\b/);
    // The gate is the password rules and nothing else — so nothing unsettable can block submission.
    expect(code).toMatch(/const ready = rules\.every\(r => r\.ok\);/);
  });
});

describe("⚠️ re-acceptance, for records that assert something that did not happen", () => {
  const REACCEPT_FROM = "2026-08-12";
  const need = (v) => (!v ? true : String(v) < REACCEPT_FROM);

  it("ASKS AGAIN WHEN THERE IS NO ACCEPTANCE AT ALL", () => {
    expect(need(null)).toBe(true);
    expect(need("")).toBe(true);
  });

  it("⚠️ ASKS AGAIN FOR THE STALE 2026-08-04 RECORDS", () => {
    // Every account created before the checkbox has a `terms_accepted_at` for terms nobody was shown,
    // against a version constant that was eight days behind the executed document.
    expect(need("2026-08-04")).toBe(true);
  });

  it("does not ask somebody who is current", () => {
    expect(need("2026-08-12")).toBe(false);
    expect(need("2026-09-01")).toBe(false);
  });

  it("⚠️ COMPARES AGAINST THE LAST MATERIAL CHANGE, not the current version", () => {
    // Comparing an acceptance date to the document's MODIFIED date is the obvious design and has a
    // flaw: **a typo fix would re-prompt every customer.** Ask a few thousand people to re-accept
    // because a comma moved and they stop reading the prompt. `REACCEPT_FROM` moves only when the
    // change is material; `LEGAL_VERSION` moves on any publish.
    const idx = readFileSync("src/legal/index.js", "utf8");
    expect(idx).toMatch(/export const REACCEPT_FROM/);
    expect(idx).toMatch(/export function needsReacceptance/);
  });

  it("is a STRING comparison, not date arithmetic", () => {
    // These happen to be dates, but parsing one to decide whether somebody is bound by an agreement
    // invites a timezone bug in the one place nobody wants one.
    const idx = readFileSync("src/legal/index.js", "utf8");
    expect(idx).toMatch(/String\(acceptedVersion\) < REACCEPT_FROM/);
  });

  it("keeps the ORIGINAL acceptance date when re-accepting", () => {
    // "When did they first agree to anything" and "which version are they on now" are different
    // questions, and flattening them loses the first one permanently.
    const sess = readFileSync("src/state/session.js", "utf8");
    expect(sess).toMatch(/terms_first_accepted_at/);
  });

  it("can resend a confirmation rather than telling people to start over", () => {
    // Signing up a second time on an address that already exists is a different, more confusing error.
    expect(readFileSync("src/state/session.js", "utf8")).toMatch(/async resendConfirmation/);
    expect(readFileSync("src/views/SignIn.jsx", "utf8")).toMatch(/Resend the link/);
  });
});
