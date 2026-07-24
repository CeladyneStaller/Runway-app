// The empty model screen. It used to be escapable only by entering cash, loading the demo, or importing
// — and nothing said that typing a number was a way through. Someone who wanted to add their team first,
// or who did not know their balance yet, had no door at all.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { emptyDoc, demoDoc } from "../../src/state/document";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, keys: async () => [], clear: async () => {} }));

function harness(initial) {
  const ref = { current: initial };
  function H() {
    const [d, setD] = useState(initial);
    ref.current = d;
    return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
  }
  const { container } = render(<H />);
  return { container, get: () => ref.current };
}
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

beforeEach(() => {});

describe("the empty model screen", () => {
  it("offers starting from scratch, not only the demo and an import", () => {
    const { container } = harness(emptyDoc());
    expect(container.textContent).toMatch(/Nothing in the model yet/);
    expect(btn(container, /Start from scratch/)).toBeTruthy();
    expect(btn(container, /demo company/)).toBeTruthy();
  });

  it("lets you in with no cash at all, so you can add people first", () => {
    const { container, get } = harness(emptyDoc());
    fireEvent.click(btn(container, /Start from scratch/));
    expect(container.textContent).not.toMatch(/Nothing in the model yet/);
    expect(get().cash).toBe(0);              // nothing invented on the way through
    expect(get().employees).toHaveLength(0);
  });

  it("still lets cash alone be the way through", async () => {
    const { container, get } = harness(emptyDoc());
    fireEvent.change(container.querySelector(".empty-cash input"), { target: { value: "250000" } });
    await waitFor(() => expect(container.textContent).not.toMatch(/Nothing in the model yet/));
    expect(get().cash).toBe(250000);
  });

  it("keeps the demo as an explicitly separate choice", () => {
    const { container, get } = harness(emptyDoc());
    fireEvent.click(btn(container, /demo company/));
    expect(get().employees.length).toBeGreaterThan(0);
  });

  it("does not appear once there is anything in the model", () => {
    const { container } = harness(demoDoc());
    expect(container.textContent).not.toMatch(/Nothing in the model yet/);
  });

  it("promises local-only storage when that is actually true", () => {
    const { container } = harness(emptyDoc());
    expect(container.textContent).toMatch(/lives in this browser/i);
    expect(container.textContent).not.toMatch(/Saved to your account/i);
  });
});
