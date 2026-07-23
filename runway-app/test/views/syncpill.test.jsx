// The app had no concept of unsaved work. That is survivable when writes are local and instant, and
// is not once they cross a network — so the state has to be visible, not remembered.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const store = new Map();
let failWrites = 0;

vi.mock("idb-keyval", () => ({
  get: async (k) => store.get(k),
  set: async (k, v) => {
    if (failWrites > 0) { failWrites -= 1; throw new Error("write failed"); }
    store.set(k, v);
  },
  keys: async () => [...store.keys()],
  clear: async () => store.clear(),
}));

const { RunwayApp } = await import("../../src/App");
const S = await import("../../src/state/storage");
const { demoDoc } = await import("../../src/state/document");

beforeEach(() => { store.clear(); failWrites = 0; S._resetWriteState(); });

const pill = (c) => c.querySelector("[data-sync]");

describe("sync indicator", () => {
  it("is present in the shell", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    expect(pill(container)).toBeTruthy();
  });

  it("shows unsaved work, then saved once it lands", async () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    S.save({ ...demoDoc(), cash: 123 });
    await waitFor(() => expect(pill(container).getAttribute("data-sync")).toBe("unsaved"));
    await S.flush();
    await waitFor(() => expect(pill(container).getAttribute("data-sync")).toBe("saved"));
  });

  it("says so when a write fails, rather than claiming saved", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    failWrites = 1;
    S.save({ ...demoDoc(), cash: 999 });
    await S.flush();
    await waitFor(() => expect(pill(container).getAttribute("data-sync")).toBe("error"));
    expect(container.textContent).toMatch(/Couldn't save/i);
    spy.mockRestore();
  });
});
