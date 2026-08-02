// QuickBooks: connect, sync, disconnect — and the reconnection prompt.
//
// The sync button does not import anything. It fetches a GRID and hands it to the same import screen
// a file goes through, so a person still sees the mapping, the preview and the merge report before
// anything touches their model. An integration that writes straight into the numbers is one nobody
// can check, and this app's entire output is a date computed from those numbers.
import React, { useCallback, useEffect, useState } from "react";
import { I } from "./icons";

/** Intuit sends the browser back to `/?qbo=<status>`. Read once, then cleaned out of the URL so a
 *  refresh does not replay a stale banner. */
function useReturnStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    try {
      const url = new URL(globalThis.location.href);
      const q = url.searchParams.get("qbo");
      if (!q) return;
      setStatus(q);
      url.searchParams.delete("qbo");
      globalThis.history?.replaceState?.({}, "", url.toString());
    } catch { /* no location in a test renderer; nothing to read */ }
  }, []);
  return [status, setStatus];
}

const fmtDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/** The QuickBooks panel, in one of two modes.
 *
 *  CONNECTING AND SYNCING ARE DIFFERENT JOBS and belong in different places. Authorising an
 *  integration is configuration and lives in Company settings; pulling a report is an IMPORT, and the
 *  grid it produces has to land in the import screen — which is on Spend history, beside the CSV
 *  import it is the sibling of.
 *
 *    mode="settings"  connect, disconnect, reconnect, status. No sync: there is nowhere for the grid
 *                     to go from a settings page, and a button that produces data with no destination
 *                     is a button that loses it.
 *    mode="import"    sync only, and only when connected. Somebody who has not connected is pointed
 *                     at settings rather than given a second Connect button — two places to authorise
 *                     one integration is how a half-finished OAuth round trip gets abandoned.
 */
export function QuickBooks({ account, companyId, onGrid, mode = "settings" }) {
  // THREE STATES, NOT TWO. `undefined` = not looked yet; `false` = QuickBooks is not available here
  // at all (local mode, no hosted account); `null` = available and not connected. Collapsing the last
  // two put a Connect button in front of local-mode users that could never do anything.
  const [conn, setConn] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [returned, setReturned] = useState(null);
  const [ret, clearRet] = useReturnStatus();

  useEffect(() => { if (ret) { setReturned(ret); clearRet(null); } }, [ret, clearRet]);

  const load = useCallback(() => {
    if (!account?.qboStatus || !companyId) { setConn(false); return; }
    account.qboStatus(companyId).then(setConn).catch(() => setConn(null));
  }, [account, companyId]);
  useEffect(load, [load, returned]);

  const connect = async () => {
    setMsg(null); setBusy(true);
    try { globalThis.location.href = await account.qboConnect(companyId); }
    catch (e) { setMsg({ bad: true, text: e?.message || "Could not start the connection." }); setBusy(false); }
  };

  const sync = async () => {
    setMsg(null); setBusy(true);
    try {
      const { grid } = await account.qboSync(companyId);
      if (!grid?.rows?.length) setMsg({ text: "QuickBooks returned no transactions for that period." });
      else onGrid(grid, conn?.qbo_company_name || "QuickBooks");
      load();
    } catch (e) {
      // THREE FAILURES, THREE DIFFERENT ACTIONS. Reconnect, wait, or narrow the range — a single
      // "sync failed" would send all three to support.
      const m = String(e?.message || "");
      if (m === "needs_reauth") { setMsg({ bad: true, text: "QuickBooks needs to be reconnected." }); load(); }
      else if (m === "truncated") setMsg({ bad: true, text: "That range is too large for QuickBooks to return at once. Sync a shorter period." });
      else if (m === "not_connected") { setMsg({ bad: true, text: "No QuickBooks connection for this company." }); load(); }
      else setMsg({ bad: true, text: m || "Could not reach QuickBooks." });
    }
    setBusy(false);
  };

  const disconnect = async () => {
    setMsg(null); setBusy(true);
    try { await account.qboDisconnect(companyId); setConn(null); setMsg({ text: "QuickBooks disconnected." }); }
    catch (e) { setMsg({ bad: true, text: e?.message || "Could not disconnect." }); }
    setBusy(false);
  };

  if (conn === undefined || conn === false) return null;

  const needsReauth = !!conn?.needs_reauth || conn?.status === "needs_reauth";

  return (
    <div className="qbo">
      <div className="qbo-h">
        <div>
          <b>QuickBooks</b>
          {conn && <span className="qbo-co">{conn.qbo_company_name || `realm ${conn.realm_id}`}</span>}
        </div>
        <div className="qbo-actions">
          {mode === "import" && conn && !needsReauth && (
            <button className="linkbtn" disabled={busy} onClick={sync}>{I.download} Sync now</button>
          )}
          {mode === "settings" && (conn
            ? <button className="linkbtn" disabled={busy} onClick={disconnect}>Disconnect</button>
            : <button className="addbtn ghost" disabled={busy} onClick={connect}>Connect QuickBooks</button>)}
        </div>
      </div>

      {/* THE REASON IS PART OF THE MESSAGE. A reconnect prompt with no explanation reads as "this app
          broke", and the customer's next move is support rather than the button. */}
      {mode === "import" && !conn && (
        <div className="qbo-note">
          Not connected. QuickBooks is set up in <b>Company settings → Connections</b>.
        </div>
      )}

      {needsReauth && (
        <div className="qbo-note bad">
          <b>Reconnect QuickBooks.</b> QuickBooks requires apps to be re-authorized every five years.
          Your mapping and history are kept — use <em>Connect QuickBooks</em> to reauthorize.
          <button className="linkbtn" disabled={busy} onClick={connect}>Connect QuickBooks</button>
        </div>
      )}

      {conn && !needsReauth && (
        <div className="qbo-note">
          {conn.last_sync_at ? `Last synced ${fmtDay(conn.last_sync_at)}.` : "Never synced."}
          {conn.reauth_due_at && ` Re-authorization due ${fmtDay(conn.reauth_due_at)}.`}
          {" Syncing opens the usual import screen — nothing changes until you commit it."}
        </div>
      )}

      {returned === "connected" && <div className="qbo-note ok">QuickBooks connected.</div>}
      {returned === "cancelled" && <div className="qbo-note">Connection cancelled — nothing changed.</div>}
      {returned === "failed" && <div className="qbo-note bad">That connection attempt did not complete. Try again.</div>}
      {msg && <div className={"qbo-note " + (msg.bad ? "bad" : "")}>{msg.text}</div>}
    </div>
  );
}
