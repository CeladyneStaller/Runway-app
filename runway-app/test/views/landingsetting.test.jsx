import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { LandingSetting } from "../../src/views/chrome/LandingSetting";

afterEach(cleanup);
const api = () => ({ setLanding: vi.fn().mockResolvedValue(undefined) });
const co = (id, name, role = "editor") => ({ id, name, role, joined_at: "2026-01-01" });

describe("the landing setting", () => {
  it("is ABSENT when there is only one possible answer", () => {
    // One company and no advisor flag means one landing. A dropdown with a single option is a control
    // pretending to be a decision.
    const v = render(<LandingSetting account={api()} companies={[co("a", "Harbor Point")]} />);
    expect(v.container.textContent).toBe("");
  });

  it("appears once there is a choice to make", () => {
    const v = render(<LandingSetting account={api()}
                       companies={[co("a", "Harbor Point"), co("b", "Halden")]} />);
    expect(v.container.querySelector("select")).toBeTruthy();
  });

  it("offers the portfolio ONLY to an advisor", () => {
    // A feature advertising itself to people who cannot use it.
    const companies = [co("a", "Harbor Point"), co("b", "Halden")];
    const plain = render(<LandingSetting account={api()} companies={companies} />);
    expect(plain.container.textContent).not.toMatch(/portfolio/i);
    cleanup();
    const adv = render(<LandingSetting account={api()} companies={companies} isAdvisor />);
    expect(adv.container.textContent).toMatch(/portfolio/i);
  });

  it("SAYS WHAT THE DEFAULT RESOLVES TO", () => {
    // A setting reading "Default" without saying what the default IS makes somebody change it just to
    // find out what it was.
    const v = render(<LandingSetting account={api()}
                       companies={[co("a", "Harbor Point"), co("b", "Halden", "owner")]} />);
    expect(v.container.textContent).toMatch(/Currently opens/);
    expect(v.container.textContent).toMatch(/Halden/);   // the owned one
  });

  it("explains the rule when nothing is chosen", () => {
    const v = render(<LandingSetting account={api()}
                       companies={[co("a", "Harbor Point"), co("b", "Halden")]} />);
    expect(v.container.textContent).toMatch(/own, or the one you have been in longest/i);
    cleanup();
    const adv = render(<LandingSetting account={api()} isAdvisor
                         companies={[co("a", "Harbor Point"), co("b", "Halden")]} />);
    expect(adv.container.textContent).toMatch(/Advisors start on their portfolio/);
  });

  it("saves the choice", async () => {
    const account = api();
    const v = render(<LandingSetting account={account}
                       companies={[co("a", "Harbor Point"), co("b", "Halden")]} />);
    fireEvent.change(v.container.querySelector("select"), { target: { value: "b" } });
    await waitFor(() => expect(account.setLanding).toHaveBeenCalledWith("b"));
  });

  it("clears back to the rule rather than storing an empty string", async () => {
    const account = api();
    const v = render(<LandingSetting account={account} value="b"
                       companies={[co("a", "Harbor Point"), co("b", "Halden")]} />);
    fireEvent.change(v.container.querySelector("select"), { target: { value: "" } });
    await waitFor(() => expect(account.setLanding).toHaveBeenCalledWith(null));
  });
});
