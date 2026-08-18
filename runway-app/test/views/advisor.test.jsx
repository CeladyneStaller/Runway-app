// The two advisor screens the owner and the advisor each see. What matters in both is what happens
// when something is unknown or fails — a runway panel that reports a company as fine because its model
// would not load is the exact failure it exists to prevent.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { OfferedScenarios } from "../../src/views/chrome/OfferedScenarios";
import { Portfolio } from "../../src/views/chrome/Portfolio";
import { canaryDoc as demoDoc } from "../../src/state/document";

afterEach(cleanup);

// ---------------------------------------------------------------- offered --

const offer = (over = {}) => ({
  id: "s1", name: "Delay two hires", shared_at: "2026-07-27T00:00:00Z",
  author_email: "dana@sharpecfo.com",
  body: { name: "Delay two hires", patches: [] },
  ...over,
});

const ownerApi = (rows, over = {}) => ({
  offeredScenarios: vi.fn().mockResolvedValue(rows),
  decideScenario: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const drawOffered = async (a, { role = "owner", onImport = vi.fn() } = {}) => {
  const doc = demoDoc();
  const v = render(<OfferedScenarios account={a} companyId="co-1" role={role} doc={doc}
                                     onImport={onImport} />);
  if (role === "owner") await waitFor(() => expect(a.offeredScenarios).toHaveBeenCalled());
  return { ...v, onImport };
};

describe("who reviews an offered scenario", () => {
  it("owners only — 028 makes deciding an ownership question", async () => {
    const a = ownerApi([offer()]);
    const v = await drawOffered(a, { role: "admin" });
    expect(v.container.textContent).toBe("");
    expect(a.offeredScenarios).not.toHaveBeenCalled();
  });

  it("renders nothing at all when nothing is waiting", async () => {
    // A heading with no content under it is a thing people learn to scroll past.
    const v = await drawOffered(ownerApi([]));
    expect(v.container.textContent).toBe("");
  });
});

describe("what the review shows", () => {
  it("says accepting does not change the live figures", async () => {
    const v = await drawOffered(ownerApi([offer()]));
    expect(v.container.textContent).toMatch(/does not change your live figures/i);
  });

  it("states the DELTA, not two numbers to subtract", async () => {
    const v = await drawOffered(ownerApi([offer()]));
    await waitFor(() => expect(v.container.textContent).toMatch(/Runway now/));
    expect(v.container.textContent).toMatch(/Difference/);
  });

  it("says plainly when a scenario changes nothing", async () => {
    const v = await drawOffered(ownerApi([offer()]));
    expect(v.container.textContent).toMatch(/changes nothing/i);
  });
});

describe("deciding", () => {
  it("declining records the answer and imports nothing", async () => {
    const a = ownerApi([offer()]);
    const { onImport, ...v } = await drawOffered(a);
    fireEvent.click(v.getByText("Decline"));
    await waitFor(() => expect(a.decideScenario).toHaveBeenCalledWith("s1", false));
    expect(onImport).not.toHaveBeenCalled();
  });

  it("accepting records it AND hands the scenario up to be saved", async () => {
    const a = ownerApi([offer()]);
    const { onImport, ...v } = await drawOffered(a);
    fireEvent.click(v.getByText("Accept"));
    await waitFor(() => expect(a.decideScenario).toHaveBeenCalledWith("s1", true));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0][0].name).toBe("Delay two hires");
  });

  it("mints a fresh id so an imported scenario cannot collide with an existing one", async () => {
    const a = ownerApi([offer({ body: { id: "scn_from_advisor", name: "X", patches: [] } })]);
    const { onImport, ...v } = await drawOffered(a);
    fireEvent.click(v.getByText("Accept"));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0][0].id).toBeUndefined();
  });

  it("reports an import that failed AFTER the decision was recorded", async () => {
    // The two operations can come apart: recorded, then the save conflicts. Saying so is the only
    // honest option, because the offer is already marked decided and will not reappear.
    const a = ownerApi([offer()]);
    const onImport = vi.fn().mockRejectedValue(new Error("version conflict"));
    const doc = demoDoc();
    const v = render(<OfferedScenarios account={a} companyId="co-1" role="owner" doc={doc}
                                       onImport={onImport} />);
    await waitFor(() => expect(a.offeredScenarios).toHaveBeenCalled());
    fireEvent.click(v.getByText("Accept"));
    await waitFor(() => expect(v.container.textContent).toMatch(/could not be added/i));
    expect(v.container.textContent).toMatch(/will not be offered again/i);
  });
});

// -------------------------------------------------------------- portfolio --

const client = (id, name, over = {}) => ({ id, name, role: "viewer", joined_at: "2026-01-01",
                                           has_document: true, ...over });

const pfApi = (companies, docs = {}) => ({
  listAdvisedCompanies: vi.fn().mockResolvedValue(companies),
  advisorUsage: vi.fn().mockResolvedValue({ companies: companies.length, allowed: 3 }),
  readCompanyDocument: vi.fn(async (id) => {
    if (docs[id] instanceof Error) throw docs[id];
    return docs[id] ?? null;
  }),
});

const docWith = (cash) => ({ ...demoDoc(), cash });

describe("the portfolio", () => {
  it("does not appear for somebody in a single company", async () => {
    // A list of one is a screen that exists to justify a price.
    const a = pfApi([client("c1", "Only Co")]);
    const v = render(<Portfolio account={a} onOpen={() => {}} />);
    await waitFor(() => expect(a.listAdvisedCompanies).toHaveBeenCalled());
    expect(v.container.textContent).toBe("");
  });

  it("lists clients and says how much of the plan is used", async () => {
    const a = pfApi([client("c1", "Harbor Point"), client("c2", "Halden")],
                    { c1: docWith(400000), c2: docWith(900000) });
    const v = render(<Portfolio account={a} onOpen={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/Harbor Point/));
    expect(v.container.textContent).toMatch(/2 of 3 companies/);
  });

  it("sorts by who runs out first", async () => {
    const a = pfApi([client("c1", "Rich Co"), client("c2", "Poor Co")],
                    { c1: docWith(5_000_000), c2: docWith(50_000) });
    const v = render(<Portfolio account={a} onOpen={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/Rich Co/));
    await waitFor(() => {
      const text = v.container.textContent;
      expect(text.indexOf("Poor Co")).toBeLessThan(text.indexOf("Rich Co"));
    });
  });

  it("does NOT report a company as healthy when its model would not load", async () => {
    // The failure this panel exists to prevent, arriving from inside the panel.
    const a = pfApi([client("c1", "Broken Co"), client("c2", "Fine Co")],
                    { c1: new Error("offline"), c2: docWith(400000) });
    const v = render(<Portfolio account={a} onOpen={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/Could not read this model/i));
  });

  it("says so when a client has no model yet", async () => {
    const a = pfApi([client("c1", "New Co", { has_document: false }), client("c2", "Fine Co")],
                    { c2: docWith(400000) });
    const v = render(<Portfolio account={a} onOpen={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/No model yet/i));
  });

  it("opens a client when its name is clicked", async () => {
    const onOpen = vi.fn();
    const a = pfApi([client("c1", "Harbor Point"), client("c2", "Halden")],
                    { c1: docWith(400000), c2: docWith(900000) });
    const v = render(<Portfolio account={a} onOpen={onOpen} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/Harbor Point/));
    fireEvent.click(v.getByText("Harbor Point"));
    expect(onOpen).toHaveBeenCalledWith("c1");
  });
});
