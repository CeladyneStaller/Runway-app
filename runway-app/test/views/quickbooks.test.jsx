// The QuickBooks connection strip. Most of what matters here is which of four states a person is
// looking at and what each one tells them to do — a sync failure that says only "failed" sends
// everybody to support regardless of which of three different problems they have.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { QuickBooks } from "../../src/views/chrome/QuickBooks";

afterEach(cleanup);

const connected = (over = {}) => ({
  connected: true, realm_id: "9341457611557888", qbo_company_name: "IES Sandbox Company",
  status: "active", authorized_at: "2026-07-28T00:00:00Z", reauth_due_at: "2031-07-28T00:00:00Z",
  needs_reauth: false, last_sync_at: "2026-07-28T00:00:00Z", last_error: null, ...over,
});

const api = (over = {}) => ({
  qboStatus: vi.fn().mockResolvedValue(null),
  qboConnect: vi.fn().mockResolvedValue("https://appcenter.intuit.com/connect/oauth2?x=1"),
  qboSync: vi.fn().mockResolvedValue({ grid: { headers: ["Date"], rows: [["2026-01-01"]] } }),
  qboDisconnect: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const mount = (account, onGrid = () => {}, mode = "import") =>
  // MODE MATTERS NOW. Connecting moved to Company settings and syncing stayed on Spend history, so a
  // test has to say which job it is about — `settings` has no Sync button and `import` has no Connect.
  render(<QuickBooks account={account} companyId="co-1" onGrid={onGrid} mode={mode} />);

describe("when nothing is connected — Company settings", () => {
  // CONNECTING IS CONFIGURATION and moved to Company settings → Connections. Syncing stayed on Spend
  // history, because the grid a sync produces has to land in the import screen. So these tests name
  // `settings` and the sync tests below name `import`.
  it("offers to connect and nothing else", async () => {
    const v = mount(api(), () => {}, "settings");
    await waitFor(() => expect(v.container.textContent).toMatch(/Connect QuickBooks/));
    expect(v.container.textContent).not.toMatch(/Sync now|Disconnect/);
  });

  it("sends the browser to the URL the server signed", async () => {
    const a = api();
    const v = mount(a, () => {}, "settings");
    await waitFor(() => expect(v.container.textContent).toMatch(/Connect QuickBooks/));
    fireEvent.click(v.getByText(/Connect QuickBooks/));
    await waitFor(() => expect(a.qboConnect).toHaveBeenCalledWith("co-1"));
  });
});

describe("when connected", () => {
  it("names the QuickBooks company, so a mis-paired realm is visible", async () => {
    const v = mount(api({ qboStatus: vi.fn().mockResolvedValue(connected()) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/IES Sandbox Company/));
  });

  it("says a sync does not change anything by itself", async () => {
    const v = mount(api({ qboStatus: vi.fn().mockResolvedValue(connected()) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/nothing changes until you commit/i));
  });

  it("hands the grid up rather than importing it", async () => {
    const onGrid = vi.fn();
    const v = mount(api({ qboStatus: vi.fn().mockResolvedValue(connected()) }), onGrid);
    await waitFor(() => expect(v.container.textContent).toMatch(/Sync now/));
    fireEvent.click(v.getByText(/Sync now/));
    await waitFor(() => expect(onGrid).toHaveBeenCalled());
    expect(onGrid.mock.calls[0][0]).toEqual({ headers: ["Date"], rows: [["2026-01-01"]] });
  });

  it("says so when a period came back empty instead of opening an empty import", async () => {
    const onGrid = vi.fn();
    const v = mount(api({ qboStatus: vi.fn().mockResolvedValue(connected()),
                          qboSync: vi.fn().mockResolvedValue({ grid: { headers: ["Date"], rows: [] } }) }), onGrid);
    await waitFor(() => expect(v.container.textContent).toMatch(/Sync now/));
    fireEvent.click(v.getByText(/Sync now/));
    await waitFor(() => expect(v.container.textContent).toMatch(/no transactions/i));
    expect(onGrid).not.toHaveBeenCalled();
  });
});

describe("the three sync failures are told apart", () => {
  const failing = (message) => api({
    qboStatus: vi.fn().mockResolvedValue(connected()),
    qboSync: vi.fn().mockRejectedValue(new Error(message)),
  });

  it("a dead token asks for a reconnection", async () => {
    const v = mount(failing("needs_reauth"));
    await waitFor(() => expect(v.container.textContent).toMatch(/Sync now/));
    fireEvent.click(v.getByText(/Sync now/));
    await waitFor(() => expect(v.container.textContent).toMatch(/needs to be reconnected/i));
  });

  it("too much data asks for a shorter period, not a retry", async () => {
    const v = mount(failing("truncated"));
    await waitFor(() => expect(v.container.textContent).toMatch(/Sync now/));
    fireEvent.click(v.getByText(/Sync now/));
    await waitFor(() => expect(v.container.textContent).toMatch(/shorter period/i));
  });

  it("anything else says try again", async () => {
    const v = mount(failing("network went away"));
    await waitFor(() => expect(v.container.textContent).toMatch(/Sync now/));
    fireEvent.click(v.getByText(/Sync now/));
    await waitFor(() => expect(v.container.textContent).toMatch(/network went away/));
  });
});

describe("the five-year reconnection", () => {
  it("explains WHY, because otherwise it reads as the app being broken", async () => {
    const v = mount(api({ qboStatus: vi.fn().mockResolvedValue(connected({ needs_reauth: true, status: "needs_reauth" })) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/re-authorized every five years/i));
    expect(v.container.textContent).toMatch(/mapping and history are kept/i);
  });

  it("hides Sync while it cannot work, and offers the way back", async () => {
    const v = mount(api({ qboStatus: vi.fn().mockResolvedValue(connected({ needs_reauth: true })) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/Reconnect QuickBooks/));
    expect(v.container.textContent).not.toMatch(/Sync now/);
    expect(v.container.textContent).toMatch(/Connect QuickBooks/);
  });
});

describe("degrading without a server", () => {
  it("renders nothing at all rather than an error when there is no account API", async () => {
    const v = render(<QuickBooks account={undefined} companyId={null} onGrid={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toBe(""));
  });

  it("shows the disconnected state when the status call fails", async () => {
    // A failed status call must not look like "connected" — the Connect button is the safe answer, and
    // it lives in settings mode.
    const v = mount(api({ qboStatus: vi.fn().mockRejectedValue(new Error("offline")) }),
                    () => {}, "settings");
    await waitFor(() => expect(v.container.textContent).toMatch(/Connect QuickBooks/));
  });

  it("points at settings rather than offering a second Connect on the import screen", async () => {
    // Two places to authorise one integration is how a half-finished OAuth round trip gets abandoned:
    // somebody starts it from the wrong screen, comes back, and cannot tell whether it worked.
    const v = mount(api(), () => {}, "import");
    await waitFor(() => expect(v.container.textContent).toMatch(/Company settings/));
    expect(v.container.textContent).not.toMatch(/Connect QuickBooks/);
  });

  it("offers no Sync on the settings page, because the grid would have nowhere to go", async () => {
    const v = mount(api({ qboStatus: vi.fn().mockResolvedValue(connected()) }), () => {}, "settings");
    await waitFor(() => expect(v.container.textContent).toMatch(/Disconnect/));
    expect(v.container.textContent).not.toMatch(/Sync now/);
  });
});
