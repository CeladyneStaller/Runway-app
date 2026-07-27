// Resolving a conflict. The storage layer already refuses to guess; these cover the two answers a user
// can give and, most importantly, that NEITHER of them silently destroys the version they didn't pick.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { BackendError, ERR_CONFLICT } from "../../src/state/backends/errors.js";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, keys: async () => [], clear: async () => {} }));

let S, ConflictDialog, demoDoc;
let server;            // what the "other device" has stored
let writes;
let failNextWrite;

const backend = () => ({
  name: "fake",
  async read() { return server ? { raw: server, meta: { version: 9 } } : null; },
  async write(raw) {
    if (failNextWrite) { failNextWrite = false; throw new BackendError(ERR_CONFLICT, "conflict"); }
    writes.push(raw);
    server = raw;                       // a successful write becomes what the server holds
    return { meta: { version: 10 } };
  },
  async park() {},
});

beforeEach(async () => {
  vi.resetModules();
  S = await import("../../src/state/storage.js");
  ({ demoDoc } = await import("../../src/state/document.js"));
  ({ ConflictDialog } = await import("../../src/views/chrome/ConflictDialog.jsx"));
  S._resetWriteState();
  writes = []; failNextWrite = false;
  server = { ...demoDoc(), cash: 111111 };
  S.setBackend(backend());
});

const provokeConflict = async (mineDoc) => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  failNextWrite = true;
  S.save(mineDoc);
  await S.flush();
  spy.mockRestore();
  expect(S.status().state).toBe("conflict");
};

describe("resolveConflict", () => {
  it("'mine' re-reads first, so the retry carries a current version and actually lands", async () => {
    const mine = { ...demoDoc(), cash: 222222 };
    await provokeConflict(mine);
    await S.resolveConflict("mine");
    expect(writes.at(-1).cash).toBe(222222);
    expect(S.status().state).toBe("saved");
    expect(S.isHalted()).toBe(false);
  });

  it("'theirs' hands back the server's document and drops the halt", async () => {
    await provokeConflict({ ...demoDoc(), cash: 222222 });
    const { adopted } = await S.resolveConflict("theirs");
    expect(adopted.cash).toBe(111111);
    expect(S.status().state).toBe("saved");
    expect(S.hasUnsavedWork()).toBe(false);
  });

  it("'theirs' does not immediately rewrite what it just adopted", async () => {
    await provokeConflict({ ...demoDoc(), cash: 222222 });
    const before = writes.length;
    const { adopted } = await S.resolveConflict("theirs");
    S.save(adopted);                       // the app re-renders and reports the adopted document
    await S.flush();
    expect(writes.length).toBe(before);     // unchanged == no write
  });

  it("stays halted and loses nothing if resolving fails", async () => {
    const mine = { ...demoDoc(), cash: 222222 };
    await provokeConflict(mine);
    S.setBackend({ ...backend(), async read() { throw new Error("offline"); } });
    await expect(S.resolveConflict("mine")).rejects.toThrow();
    expect(S.hasUnsavedWork()).toBe(true);   // the work is still held
  });
});

describe("the dialog", () => {
  it("shows both versions side by side, so the choice is informed", async () => {
    await provokeConflict({ ...demoDoc(), cash: 222222 });
    const { container } = render(<ConflictDialog />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Fetching the other version/));
    expect(container.textContent).toMatch(/This device/);
    expect(container.textContent).toMatch(/Saved elsewhere/);
    expect(container.textContent).toMatch(/222,222/);   // mine
    expect(container.textContent).toMatch(/111,111/);   // theirs
  });

  it("highlights only the rows that actually differ", async () => {
    await provokeConflict({ ...demoDoc(), cash: 222222 });
    const { container } = render(<ConflictDialog />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    const differing = [...container.querySelectorAll("tr.cf-differs")].map(r => r.textContent);
    expect(differing.some(t => /Cash on hand/.test(t))).toBe(true);
    expect(differing.some(t => /People/.test(t))).toBe(false);   // same in both
  });

  it("keeping this device's version writes it and closes", async () => {
    await provokeConflict({ ...demoDoc(), cash: 222222 });
    let done = false;
    const { container } = render(<ConflictDialog onDone={() => { done = true; }} />);
    await waitFor(() => expect(container.textContent).toMatch(/Keep this device/));
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Keep this device/.test(b.textContent)));
    await waitFor(() => expect(done).toBe(true));
    expect(writes.at(-1).cash).toBe(222222);
  });

  it("using the other version hands it up to be adopted", async () => {
    await provokeConflict({ ...demoDoc(), cash: 222222 });
    let adopted = null;
    const { container } = render(<ConflictDialog onAdopt={(d) => { adopted = d; }} onDone={() => {}} />);
    await waitFor(() => expect(container.textContent).toMatch(/Use the other version/));
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Use the other version/.test(b.textContent)));
    await waitFor(() => expect(adopted).not.toBeNull());
    expect(adopted.cash).toBe(111111);
  });

  it("offers an export before the destructive choice", async () => {
    await provokeConflict({ ...demoDoc(), cash: 222222 });
    const { container } = render(<ConflictDialog />);
    await waitFor(() => expect(container.textContent).toMatch(/export them first/));
  });
});
