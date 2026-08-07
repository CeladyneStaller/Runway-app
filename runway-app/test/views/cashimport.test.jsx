import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { CashImport } from "../../src/views/chrome/CashImport";

afterEach(cleanup);

const accounts = [
  { id: "35", name: "Operating checking", balance: 412806 },
  { id: "36", name: "Payroll reserve", balance: 88000 },
  { id: "37", name: "Stripe holding", balance: 6204 },
];
const draw = (over = {}) => {
  const onAccept = vi.fn(), onChoose = vi.fn();
  const v = render(<CashImport month={4} monthLabel="Nov 2026" current={500000}
                               onPull={() => Promise.resolve({ accounts, asOf: "2026-07-31" })}
                               onAccept={onAccept} onChoose={onChoose} {...over} />);
  return { ...v, onAccept, onChoose };
};
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

describe("choosing which accounts are cash", () => {
  it("LISTS THEM RATHER THAN SUMMING", async () => {
    // QuickBooks' Bank type includes a merchant holding account, a foreign-currency account, an
    // escrow. Summing every Bank account is the obvious rule and quietly wrong for some companies.
    const v = draw();
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.querySelectorAll(".cashio-row").length).toBe(3));
    expect(v.container.textContent).toMatch(/Stripe holding/);
  });

  it("the total follows the ticks", async () => {
    const v = draw();
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.querySelector(".cashio-row")).toBeTruthy());
    expect(btn(v.container, /^Use /).textContent).toMatch(/507,010/);
    fireEvent.click(v.container.querySelectorAll(".cashio-row input")[2]);   // untick Stripe
    expect(btn(v.container, /^Use /).textContent).toMatch(/500,806/);
  });

  it("REMEMBERS THE CHOICE BY ACCOUNT ID, so it survives a rename", async () => {
    const v = draw({ chosen: ["35"] });
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.querySelector(".cashio-row")).toBeTruthy());
    const boxes = [...v.container.querySelectorAll(".cashio-row input")];
    expect(boxes.map(b => b.checked)).toEqual([true, false, false]);
  });

  it("still SHOWS every account when a choice is remembered", async () => {
    // An account added since would otherwise be invisible — the remembered choice pre-ticks, it does
    // not filter.
    const v = draw({ chosen: ["35"] });
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.querySelectorAll(".cashio-row").length).toBe(3));
  });
});

describe("accepting, not overwriting", () => {
  it("SHOWS WHAT IS RECORDED BESIDE WHAT IT FOUND", async () => {
    // A hand-entered figure may be the better number — reconciliation lags, and somebody who looked at
    // their bank this morning knows something QuickBooks does not.
    const v = draw();
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.textContent).toMatch(/currently recorded/));
    expect(v.container.textContent).toMatch(/500,000/);
    expect(v.container.textContent).toMatch(/difference/);
  });

  it("changes nothing until it is accepted", async () => {
    const v = draw();
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.querySelector(".cashio")).toBeTruthy());
    expect(v.onAccept).not.toHaveBeenCalled();
    fireEvent.click(btn(v.container, /Cancel/));
    expect(v.onAccept).not.toHaveBeenCalled();
  });

  it("writes the month and the chosen total on accept", async () => {
    const v = draw();
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.querySelector(".cashio")).toBeTruthy());
    fireEvent.click(btn(v.container, /^Use /));
    expect(v.onAccept).toHaveBeenCalledWith(4, 507010);
    expect(v.onChoose).toHaveBeenCalledWith(["35", "36", "37"]);
  });

  it("refuses to accept nothing", async () => {
    const v = draw();
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.querySelector(".cashio-row")).toBeTruthy());
    [...v.container.querySelectorAll(".cashio-row input")].forEach(b => fireEvent.click(b));
    expect(btn(v.container, /^Use /).disabled).toBe(true);
  });
});

describe("when it cannot", () => {
  it("says so and offers a retry", async () => {
    const v = draw({ onPull: () => Promise.reject(new Error("nope")) });
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.textContent).toMatch(/could not be reached/));
    expect(btn(v.container, /Try again/)).toBeTruthy();
  });

  it("says so when the company has no bank accounts", async () => {
    const v = draw({ onPull: () => Promise.resolve({ accounts: [] }) });
    fireEvent.click(btn(v.container, /Pull cash/));
    await waitFor(() => expect(v.container.textContent).toMatch(/No bank accounts/));
  });

  it("a viewer is offered nothing", () => {
    expect(draw({ canWrite: false }).container.textContent).toBe("");
  });
});

describe("where it is offered", () => {
  const src = require("node:fs").readFileSync("src/views/History.jsx", "utf8");
  const app = require("node:fs").readFileSync("src/App.jsx", "utf8");

  it("SITS ON THE CASH SUB-TAB, beside the column it fills", () => {
    // The ledger synced and the bank balance did not — this column has been typed by hand every month
    // while the spend history beside it filled itself in.
    const cash = src.slice(src.indexOf('tab === "cash"'));
    expect(cash.slice(0, 2000)).toMatch(/<CashImport/);
  });

  it("⚠️ IS ABSENT UNLESS QUICKBOOKS IS ACTUALLY CONNECTED", () => {
    // A "pull cash" button that opens a connection flow is a different promise from one that reads a
    // balance. `onPullCash` being null is how the panel knows not to render at all.
    expect(app).toMatch(/api\?\.qboSync && cid \?/);
    expect(src).toMatch(/\{onPullCash && \(/);
  });

  it("reads the connection at render, like the payables pull", () => {
    // A connection made in another tab should not need a reload.
    expect(app).toMatch(/const api = getAccountApi\(\), cid = getAuthAdapter\(\)/);
  });

  it("remembers the account choice on the document, not in component state", () => {
    // Component state would ask the same question every month.
    expect(src).toMatch(/qboCashAccounts/);
  });
});
