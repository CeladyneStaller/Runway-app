// App must refuse to hand over an editable company when the document could not be read, and must not
// write anything. The old behaviour rendered demoDoc() and then saved it over the user's real model.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const saves = [];
let loadResult;

vi.mock("../../src/state/storage", async () => {
  const actual = await vi.importActual("../../src/state/storage");
  return {
    ...actual,
    load: async () => loadResult,
    save: async (d) => { saves.push(d); },
  };
});

const { default: App } = await import("../../src/App");
const { emptyDoc, demoDoc } = await import("../../src/state/document");

beforeEach(() => { saves.length = 0; });

describe("when the document cannot be read", () => {
  it("shows an explicit error and writes NOTHING", async () => {
    loadResult = { state: "failed", doc: emptyDoc(), error: new Error("Storage unavailable") };
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Couldn't open your model/i));
    expect(container.textContent).toMatch(/Nothing has been overwritten/i);
    // give the old 400ms debounce more than enough time to have fired
    await new Promise(r => setTimeout(r, 600));
    expect(saves).toEqual([]);
  });

  it("tells the user to reload when the model is from a newer build", async () => {
    loadResult = { state: "stale", doc: emptyDoc(), error: new Error("Document is v4; this build understands v3") };
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/needs a newer version/i));
    await new Promise(r => setTimeout(r, 600));
    expect(saves).toEqual([]);
  });

  it("a successful load renders the app and DOES save", async () => {
    loadResult = { state: "ok", doc: demoDoc() };
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".stat.hero")).toBeTruthy());
    await new Promise(r => setTimeout(r, 600));
    expect(saves.length).toBeGreaterThan(0);
  });

  it("a brand-new document is a successful load, so a first-time user can save", async () => {
    loadResult = { state: "ok", doc: emptyDoc(), isNew: true };
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Loading your model/i));
    await new Promise(r => setTimeout(r, 600));
    expect(saves.length).toBeGreaterThan(0);
  });
});
