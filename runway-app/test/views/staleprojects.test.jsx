// The notice that somebody else changed a project you have open. It exists because per-project
// concurrency removed the only thing that used to report a concurrent edit — the conflict, which
// obstructed the save wrongly but notified correctly.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import React from "react";
import { StaleProjects } from "../../src/views/chrome/StaleProjects";
import * as storage from "../../src/state/storage";

afterEach(cleanup);

const doc = { projects: [{ id: "p1", name: "Catalyst" }, { id: "p2", name: "Sensor SBIR" }] };

const entry = (over = {}) => ({
  version: 4, body: { id: "p1", name: "Catalyst", budget: 999 },
  updated_at: new Date(Date.now() - 5 * 60000).toISOString(),
  updated_by: "dana@sharpecfo.com", ...over,
});

/** A stand-in for the module-level store the real one keeps, so the component is exercised the way it
 *  actually runs: seeded on mount, told on change, and clearing through the same store. */
let listeners = [];
let store = {};
const publish = () => { for (const fn of listeners) fn(store); };

vi.spyOn(storage, "staleProjects").mockImplementation(() => store);
vi.spyOn(storage, "onStaleProjects").mockImplementation((fn) => {
  listeners.push(fn);
  fn(store);
  return () => { listeners = listeners.filter(f => f !== fn); };
});
vi.spyOn(storage, "clearStaleProject").mockImplementation((id) => {
  const { [id]: _gone, ...rest } = store;
  store = rest;
  publish();
});

const push = async (map) => {
  await act(async () => { store = { ...store, ...map }; publish(); });
};

afterEach(() => { store = {}; listeners = []; });

describe("when nothing has changed", () => {
  it("renders nothing at all", () => {
    const v = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    expect(v.container.textContent).toBe("");
  });
});

describe("when somebody else changed a project", () => {
  it("names the project, the person, and how long ago", async () => {
    // "Somebody changed something" is not actionable. The name and the person are what let you decide
    // whether to look.
    const v = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    await push({ p1: entry() });
    expect(v.container.textContent).toMatch(/Catalyst/);
    expect(v.container.textContent).toMatch(/dana/);
    expect(v.container.textContent).toMatch(/5 min ago/);
  });

  it("says plainly that you are looking at your own copy", async () => {
    const v = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    await push({ p1: entry() });
    expect(v.container.textContent).toMatch(/looking at your own copy/i);
  });

  it("does NOT change anything by itself", async () => {
    // Replacing a project on screen while somebody reads it is how a number moves under a cursor
    // mid-sentence, and this application's output is a number people quote to boards.
    const onLoad = vi.fn();
    render(<StaleProjects doc={doc} onLoad={onLoad} />);
    await push({ p1: entry() });
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("hands up the new body when asked, with no second round trip", async () => {
    const onLoad = vi.fn();
    const v = render(<StaleProjects doc={doc} onLoad={onLoad} />);
    await push({ p1: entry() });
    fireEvent.click(v.getByText("Load their version"));
    expect(onLoad).toHaveBeenCalledWith("p1", { id: "p1", name: "Catalyst", budget: 999 });
    await waitFor(() => expect(v.container.textContent).toBe(""));
  });

  it("lets you keep yours, and stops telling you", async () => {
    const onLoad = vi.fn();
    const v = render(<StaleProjects doc={doc} onLoad={onLoad} />);
    await push({ p1: entry() });
    fireEvent.click(v.getByText("Keep mine"));
    expect(onLoad).not.toHaveBeenCalled();
    await waitFor(() => expect(v.container.textContent).toBe(""));
  });
});

describe("several notices", () => {
  it("MERGES rather than replacing, so an unacted notice is not lost", async () => {
    // Two saves a minute apart can each report a different project. Dropping the first would lose a
    // notice the person had not answered yet.
    const v = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    await push({ p1: entry() });
    await push({ p2: entry({ body: { id: "p2", name: "Sensor SBIR" } }) });
    expect(v.container.textContent).toMatch(/Catalyst/);
    expect(v.container.textContent).toMatch(/Sensor SBIR/);
  });

  it("dismisses one without dismissing the other", async () => {
    const v = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    await push({ p1: entry(), p2: entry({ body: { id: "p2", name: "Sensor SBIR" } }) });
    fireEvent.click(v.getAllByText("Keep mine")[0]);
    await waitFor(() => expect(v.container.textContent).not.toMatch(/Catalyst/));
    expect(v.container.textContent).toMatch(/Sensor SBIR/);
  });
});

describe("degrading", () => {
  it("names a project that is no longer in this client's document", async () => {
    // It can be reported for something this client deleted locally, or never had. Falls back to the
    // name in the body rather than rendering "undefined was changed".
    const v = render(<StaleProjects doc={{ projects: [] }} onLoad={() => {}} />);
    await push({ px: entry({ body: { id: "px", name: "Ghost" } }) });
    expect(v.container.textContent).toMatch(/Ghost/);
  });

  it("survives a missing author and timestamp", async () => {
    const v = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    await push({ p1: { version: 2, body: { id: "p1", name: "Catalyst" } } });
    expect(v.container.textContent).toMatch(/Somebody/);
    expect(v.container.textContent).toMatch(/Catalyst/);
  });
});

describe("surviving a tab change", () => {
  it("shows what is outstanding when it MOUNTS, not only what arrives after", async () => {
    // THE BUG. This lives on the Projects tab and unmounts the moment somebody looks at Payroll. With
    // the notices in component state, a glance elsewhere silently answered them — and the next save
    // overwrote the other person's work with no warning ever having been visible.
    store = { p1: entry() };
    const v = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    expect(v.container.textContent).toMatch(/Catalyst/);
  });

  it("still shows it after unmounting and remounting", async () => {
    const first = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    await push({ p1: entry() });
    expect(first.container.textContent).toMatch(/Catalyst/);

    cleanup();                                     // the tab changed
    const second = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    expect(second.container.textContent).toMatch(/Catalyst/);
  });

  it("and stays gone once answered", async () => {
    const first = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    await push({ p1: entry() });
    fireEvent.click(first.getByText("Keep mine"));

    cleanup();
    const second = render(<StaleProjects doc={doc} onLoad={() => {}} />);
    expect(second.container.textContent).toBe("");
  });
});
