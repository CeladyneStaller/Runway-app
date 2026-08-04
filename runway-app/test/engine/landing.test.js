import { describe, it, expect } from "vitest";
import { landingFor, defaultCompany, portfolioAllowed, landingChoices, PORTFOLIO }
  from "../../src/engine/landing.js";

const co = (id, over = {}) => ({ id, name: id, role: "editor", joined_at: "2026-01-01", ...over });

describe("where somebody lands", () => {
  it("ONE COMPANY goes straight to it, and the portfolio is blocked", () => {
    // Somebody with one company is not running a portfolio. A list of one is a worse version of that
    // company.
    const r = landingFor({ companies: [co("a")], isAdvisor: false });
    expect(r).toEqual({ view: "company", companyId: "a", blocked: false });
    expect(portfolioAllowed({ isAdvisor: false })).toBe(false);
  });

  it("SEVERAL COMPANIES prefers the one they own", () => {
    // Owning is the strongest signal that a company is theirs rather than one they were invited to.
    const r = landingFor({
      companies: [co("a", { joined_at: "2025-01-01" }), co("b", { role: "owner", joined_at: "2026-06-01" })],
    });
    expect(r.companyId).toBe("b");
  });

  it("falls back to the OLDEST when they own none", () => {
    // Stabler than "most recent": the landing should not move every time somebody adds them to
    // something.
    const r = landingFor({
      companies: [co("new", { joined_at: "2026-06-01" }), co("old", { joined_at: "2024-02-01" })],
    });
    expect(r.companyId).toBe("old");
  });

  it("picks the oldest OWNED when they own several", () => {
    const r = landingFor({
      companies: [co("o2", { role: "owner", joined_at: "2026-01-01" }),
                  co("o1", { role: "owner", joined_at: "2024-01-01" })],
    });
    expect(r.companyId).toBe("o1");
  });

  it("gives an ADVISOR the portfolio by default", () => {
    const r = landingFor({ companies: [co("a"), co("b")], isAdvisor: true });
    expect(r.view).toBe(PORTFOLIO);
  });

  it("still lets an advisor choose a company instead", () => {
    const r = landingFor({ companies: [co("a"), co("b")], isAdvisor: true, preferred: "b" });
    expect(r).toEqual({ view: "company", companyId: "b", blocked: false });
  });

  it("REFUSES a stored portfolio preference from a non-advisor", () => {
    // A preference stored while somebody was an advisor must not survive them ceasing to be one —
    // otherwise losing the flag leaves them on a screen they may no longer have.
    const r = landingFor({ companies: [co("a"), co("b")], isAdvisor: false, preferred: PORTFOLIO });
    expect(r.view).toBe("company");
    expect(r.blocked).toBe(true);
  });

  it("lands somewhere sensible when the preferred company is gone", () => {
    // Being removed from a company is ordinary. It should not produce an error, just a different
    // landing.
    const r = landingFor({ companies: [co("a", { role: "owner" })], isAdvisor: true, preferred: "left" });
    expect(r.companyId).toBe("a");
    expect(r.blocked).toBe(true);
  });

  it("gives an advisor with no clients the portfolio, not an empty company", () => {
    // It is the screen that explains what happens next.
    expect(landingFor({ companies: [], isAdvisor: true }).view).toBe(PORTFOLIO);
  });

  it("survives no companies and no flag", () => {
    const r = landingFor({});
    expect(r.view).toBe("company");
    expect(r.companyId).toBeNull();
  });

  it("survives malformed rows", () => {
    expect(() => landingFor({ companies: [null, {}, co("a")] })).not.toThrow();
    expect(landingFor({ companies: [null, {}, co("a")] }).companyId).toBe("a");
    expect(defaultCompany(null)).toBeNull();
  });

  it("offers the portfolio in settings ONLY to an advisor", () => {
    const companies = [co("a", { name: "Harbor Point" })];
    expect(landingChoices({ companies, isAdvisor: false }).map(c => c.value)).toEqual(["a"]);
    expect(landingChoices({ companies, isAdvisor: true }).map(c => c.value)).toEqual([PORTFOLIO, "a"]);
  });

  it("keeps an advisor's single client on the portfolio if that is their default", () => {
    // The one-company shortcut is for people who CANNOT have a portfolio. An advisor with one client
    // still has one, and taking it away when they lose a client would be surprising.
    const r = landingFor({ companies: [co("a")], isAdvisor: true });
    expect(r.view).toBe(PORTFOLIO);
  });
});

describe("who counts as an advisor", () => {
  // THE BUG THIS CAUGHT. `advisor_usage` returns `{ companies, allowed }`, and `companies` counts
  // EVERY MEMBERSHIP — not companies advised. Testing `companies > 0` made an advisor of anybody with a
  // single company of their own, so a brand-new user landed on a client portfolio containing themselves.
  //
  // `allowed` is the advisor flag or a paid advisor plan, which is the thing being asked about.
  const isAdvisor = (plan) => (plan?.allowed ?? 0) > 0;

  it("a plain user with one company is NOT an advisor", () => {
    expect(isAdvisor({ companies: 1, allowed: 0 })).toBe(false);
  });

  it("a plain user with several companies is still not an advisor", () => {
    expect(isAdvisor({ companies: 4, allowed: 0 })).toBe(false);
  });

  it("an advisor with no clients yet IS one", () => {
    // The flag, not the count. Somebody who just bought an advisor plan has no clients and is an
    // advisor — and the portfolio is the screen that explains what happens next.
    expect(isAdvisor({ companies: 0, allowed: 3 })).toBe(true);
  });

  it("and lands on the portfolio", () => {
    expect(landingFor({ companies: [], isAdvisor: true }).view).toBe(PORTFOLIO);
    expect(landingFor({ companies: [co("a")], isAdvisor: false }).view).toBe("company");
  });

  it("survives a missing or malformed plan", () => {
    expect(isAdvisor(null)).toBe(false);
    expect(isAdvisor({})).toBe(false);
    expect(isAdvisor(undefined)).toBe(false);
  });
});
