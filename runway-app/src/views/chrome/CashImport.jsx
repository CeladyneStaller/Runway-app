import { useState } from "react";
import { moneyFull as money } from "../../engine/money";

/** Pulling cash on hand from QuickBooks.
 *
 *  ⚠️ TWO DECISIONS THE APP DOES NOT MAKE FOR ANYBODY.
 *
 *  WHICH ACCOUNTS ARE CASH. QuickBooks' Bank type includes a merchant holding account, a
 *  foreign-currency account, an escrow — things a founder may not count as runway. Summing every Bank
 *  account is the obvious rule and quietly wrong for some companies, so the list is shown and the
 *  person ticks. The choice is remembered by ACCOUNT ID, so it survives a rename in QuickBooks.
 *
 *  WHETHER IT REPLACES WHAT IS THERE. A hand-entered figure may be more accurate than the ledger —
 *  reconciliation lags, and somebody who looked at their bank this morning knows something QuickBooks
 *  does not. So the import shows what it found beside what is recorded and waits.
 */
export function CashImport({ month, monthLabel, current, onPull, onAccept, chosen = [], onChoose,
                             canWrite = true }) {
  const [state, setState] = useState(null);     // null | "loading" | {accounts, asOf} | {error}
  const [picked, setPicked] = useState(new Set(chosen));

  const pull = async () => {
    setState("loading");
    try {
      const r = await onPull();
      if (!r?.accounts?.length) { setState({ error: "No bank accounts found in QuickBooks." }); return; }
      // A REMEMBERED CHOICE IS PRE-TICKED, so month two is one click rather than the same decision
      // again — but it is still shown, because an account added since would otherwise be invisible.
      setPicked(new Set(chosen.length ? chosen : r.accounts.map(a => a.id)));
      setState(r);
    } catch { setState({ error: "QuickBooks could not be reached." }); }
  };

  if (!canWrite) return null;
  if (state === null) {
    return <button className="linkbtn" onClick={pull}>Pull cash from QuickBooks</button>;
  }
  if (state === "loading") return <span className="meta">Reading your balance sheet…</span>;
  if (state.error) {
    return (
      <p className="cashio-err">{state.error}{" "}
        <button className="linkbtn" onClick={() => setState(null)}>Try again</button></p>
    );
  }

  const total = state.accounts.filter(a => picked.has(a.id)).reduce((n, a) => n + a.balance, 0);
  const toggle = (id) => setPicked(p => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <div className="cashio">
      <p className="meta">
        Balances at {state.asOf}. Tick the accounts that are your runway.
      </p>
      <div className="cashio-list">
        {state.accounts.map(a => (
          <label key={a.id} className="cashio-row">
            <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
            <span className="cashio-nm">{a.name}</span>
            <span className="cashio-amt">{money(a.balance)}</span>
          </label>
        ))}
      </div>

      <div className="cashio-foot">
        <div>
          <div className="meta">{monthLabel} · from QuickBooks</div>
          <div className="cashio-total">{money(total)}</div>
        </div>
        {/* ⚠️ WHAT IS RECORDED SITS BESIDE IT. A hand-entered figure may be the better number, and
            showing only the imported one asks somebody to accept a change they cannot see. */}
        {Number.isFinite(current) && (
          <div>
            <div className="meta">currently recorded</div>
            <div className="cashio-total was">{money(current)}</div>
            {Math.abs(current - total) > 0.5 && (
              <div className="cashio-delta">
                {total > current ? "+" : ""}{money(total - current)} difference
              </div>
            )}
          </div>
        )}
        <div className="cashio-acts">
          <button className="linkbtn" onClick={() => setState(null)}>Cancel</button>
          <button className="addbtn" disabled={!picked.size}
                  onClick={() => { onChoose?.([...picked]); onAccept(month, total); setState(null); }}>
            Use {money(total)}
          </button>
        </div>
      </div>
    </div>
  );
}
