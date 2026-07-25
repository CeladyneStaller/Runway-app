import React from "react";
import { money, moneyFull } from "../../engine/money";
import { saasSeries, saasCeiling, blankSaas, saasActuals, recordedThroughSaas,
         impliedCustomers, rebaseFromActuals } from "../../engine/saas";
import { TIERS } from "../../engine/projection";
import { monthLabel } from "../../engine/time";
import { useStart } from "../../state/StartCtx";
import { I } from "./icons";

// Subscription revenue, edited alongside the ordinary revenue lines it sits next to.
//
// THE CEILING IS THE FEATURE. Anyone can model subscriptions as a recurring line with a growth
// percentage; what that can't show is that adds and churn fight each other to a standstill at
// adds ÷ churn. A founder entering 20 new customers a month against 10% churn is describing a
// business that tops out at 200 customers, and it is much better to see that here — while the
// assumptions are still on screen and editable — than to notice it eighteen months into the chart.

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** A bare sparkline of the customer curve. Deliberately unlabelled and small: its job is to show the
 *  SHAPE — climbing, flattening, or decaying — not to be read for values. The numbers are in the row. */
function Curve({ s }) {
  const series = saasSeries(s);
  if (series.length < 2) return null;
  const max = Math.max(...series.map(p => p.customers), 1);
  const W = 132, H = 30;
  const step = W / (series.length - 1);
  const at = (p, i) => `${(i * step).toFixed(1)} ${(H - (p.customers / max) * (H - 3)).toFixed(1)}`;
  const d = series.map((p, i) => `${i ? "L" : "M"}${at(p, i)}`).join(" ");
  // Where the record ends, the forecast begins — worth seeing on the curve, not just in the table.
  const through = recordedThroughSaas(s);
  const cut = through == null ? -1 : series.findIndex(p => p.month === through);
  return (
    <svg className="saas-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--signal)" strokeWidth="1.5" />
      {cut >= 0 && <line x1={(cut * step).toFixed(1)} x2={(cut * step).toFixed(1)} y1="0" y2={H}
                         stroke="var(--muted-2)" strokeWidth="1" strokeDasharray="2 2" />}
    </svg>
  );
}

/** Recorded MRR, and what it implies.
 *
 *  Entered DIRECTLY rather than coded from bank history, unlike grant and PO revenue. A grant payment
 *  arrives as a deposit that has to be attributed to something; MRR comes off a billing dashboard and
 *  the founder already knows it. Making them run a coding exercise to tell us a number they can read
 *  off a screen would be the wrong kind of rigour.
 *
 *  The re-base button is separate from all of this ON PURPOSE. Replacing the past is automatic because
 *  a recorded month is a fact. Changing the FORECAST is a decision, and this app's standing rule is
 *  that a discovered disagreement must not silently move the runway — so it happens when somebody
 *  presses it, having seen the gap and the customer count it implies. */
function Reconcile({ x, set, setSaas, START_Y, START_M }) {
  const actuals = saasActuals(x);
  const months = Object.keys(actuals).map(Number).sort((a, b) => a - b);
  const through = recordedThroughSaas(x);
  const imp = impliedCustomers(x);
  const series = saasSeries(x);
  const projAt = (m) => series.find(p => p.month === m)?.mrr || 0;

  const put = (m, v) => set(x.id, { actuals: { ...actuals, [m]: v } });
  const drop = (m) => { const next = { ...actuals }; delete next[m]; set(x.id, { actuals: next }); };
  const addMonth = () => put(through == null ? num(x.start) : through + 1, "");
  const rebase = () => setSaas(xs => xs.map(y => (y.id === x.id ? rebaseFromActuals(y) : y)));

  const off = imp && Math.abs(imp.implied - imp.modelled) > 0.5;

  return (
    <div className="saas-rec">
      <div className="saas-rec-h">
        <span>Recorded MRR</span>
        <button className="linkbtn" onClick={addMonth}>+ Record a month</button>
      </div>

      {months.length === 0 && (
        <p className="saas-rec-empty">Nothing recorded yet. Enter what you actually billed and those
          months stop being a forecast — the runway uses the real number instead.</p>
      )}

      {months.map(m => {
        const projected = projAt(m);
        const delta = num(actuals[m]) - projected;
        return (
          <div className="saas-rec-row" key={m}>
            <span className="saas-rec-m">{monthLabel(m, START_Y, START_M)}</span>
            <input className="inp num" value={actuals[m] ?? ""} inputMode="decimal"
                   aria-label={`Recorded MRR for month ${m}`}
                   onChange={e => put(m, e.target.value)} />
            <span className="saas-rec-p">vs {moneyFull(projected)} projected</span>
            <span className={"saas-rec-d " + (delta < 0 ? "down" : "up")}>
              {Math.abs(delta) < 1 ? "on plan" : `${delta >= 0 ? "+" : "−"}${moneyFull(Math.abs(delta))}`}
            </span>
            <button className="iconbtn" onClick={() => drop(m)} aria-label={`Remove record for month ${m}`}>{I.trash}</button>
          </div>
        );
      })}

      {imp && (
        <div className="saas-rec-foot">
          <div>
            {off
              ? <>Billing implies <b>{Math.round(imp.implied).toLocaleString()}</b> customers,
                  against <b>{Math.round(imp.modelled).toLocaleString()}</b> in the model. Every month
                  after this one is built on the wrong base.</>
              : <>Billing matches the model's <b>{Math.round(imp.modelled).toLocaleString()}</b> customers.</>}
          </div>
          {off && <button className="addbtn ghost" onClick={rebase}>Re-base forecast from recorded</button>}
        </div>
      )}
    </div>
  );
}

export function SaasPanel({ saas = [], setSaas }) {
  const { START_Y, START_M } = useStart();

  const add = () => setSaas(xs => [...(xs || []), blankSaas()]);
  const set = (id, patch) => setSaas(xs => (xs || []).map(x => (x.id === id ? { ...x, ...patch } : x)));
  const del = (id) => setSaas(xs => (xs || []).filter(x => x.id !== id));
  const cycleConf = (x) => set(x.id, { confidence: TIERS[(TIERS.indexOf(x.confidence || "expected") + 1) % TIERS.length] });

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-h">
        <div>
          <h3>Subscription revenue</h3>
          <p>Modelled as a book of customers rather than a growth rate, because churn and new business
            settle at a ceiling that a growth rate can't show. Click a confidence tag to cycle it.</p>
        </div>
        <button className="addbtn ghost" onClick={add}>{I.plus} Subscription</button>
      </div>

      {(saas || []).length === 0 && (
        <div className="saas-empty">
          No subscription products yet. Add one if you bill customers monthly — you'll get the steady
          state your churn implies, which is usually the number worth arguing about.
        </div>
      )}

      {(saas || []).map(x => {
        const ceiling = saasCeiling(x);
        const now = saasSeries(x).find(p => p.month === 0);
        const decaying = num(x.startCustomers) > 0 && num(x.newPerMonth) === 0 && num(x.churnPct) > 0;
        const unbounded = num(x.newPerMonth) > 0 && num(x.churnPct) === 0;

        return (
          <div className={"saas-card" + (x.include === false ? " off" : "")} key={x.id}>
            <div className="saas-top">
              <input className="inp saas-name" value={x.name || ""} aria-label="Subscription name"
                     onChange={e => set(x.id, { name: e.target.value })} placeholder="Subscriptions" />
              <span className={"conf " + (x.confidence || "expected")} onClick={() => cycleConf(x)}
                    role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") cycleConf(x); }}>
                {x.confidence || "expected"}
              </span>
              <label className="saas-inc">
                <input type="checkbox" checked={x.include !== false}
                       onChange={e => set(x.id, { include: e.target.checked })} />
                Count it
              </label>
              <button className="iconbtn" onClick={() => del(x.id)} aria-label="Delete subscription">{I.trash}</button>
            </div>

            <div className="saas-grid">
              <label className="saas-f"><span>Customers now</span>
                <input className="inp num" value={x.startCustomers ?? ""} inputMode="decimal"
                       onChange={e => set(x.id, { startCustomers: e.target.value })} /></label>
              <label className="saas-f"><span>Revenue each, per month</span>
                <input className="inp num" value={x.arpu ?? ""} inputMode="decimal"
                       onChange={e => set(x.id, { arpu: e.target.value })} /></label>
              <label className="saas-f"><span>New per month</span>
                <input className="inp num" value={x.newPerMonth ?? ""} inputMode="decimal"
                       onChange={e => set(x.id, { newPerMonth: e.target.value })} /></label>
              <label className="saas-f"><span>Churn %/mo</span>
                <input className="inp num" value={x.churnPct ?? ""} inputMode="decimal"
                       onChange={e => set(x.id, { churnPct: e.target.value })} /></label>
              <label className="saas-f"><span>New business growth %/mo</span>
                <input className="inp num" value={x.newGrowthPct ?? ""} inputMode="decimal"
                       onChange={e => set(x.id, { newGrowthPct: e.target.value })} /></label>
              <label className="saas-f"><span>Price growth %/mo</span>
                <input className="inp num" value={x.arpuGrowthPct ?? ""} inputMode="decimal"
                       onChange={e => set(x.id, { arpuGrowthPct: e.target.value })} /></label>
              <label className="saas-f"><span>Starts</span>
                <input className="inp num" value={x.start ?? 0} inputMode="numeric"
                       onChange={e => set(x.id, { start: e.target.value })} /></label>
            </div>

            <div className="saas-out">
              <Curve s={x} />
              <div className="saas-figs">
                <div><span>MRR now</span><b className="num">{moneyFull(now?.mrr || 0)}</b></div>
                {ceiling && (
                  <div><span>Settles at</span>
                    <b className="num">{money(ceiling.mrr)}/mo</b>
                    <em>{Math.round(ceiling.customers).toLocaleString()} customers</em></div>
                )}
                {unbounded && (
                  <div className="saas-note">No churn entered, so this grows without limit. Real books
                    lose customers — even 1%/mo changes the shape a lot.</div>
                )}
                {decaying && (
                  <div className="saas-note">Nothing new coming in, so this decays to nothing. That's a
                    real forecast if you've stopped selling; otherwise add new business.</div>
                )}
                <div className="saas-when">Starts {monthLabel(num(x.start), START_Y, START_M)}</div>
              </div>
            </div>

            <Reconcile x={x} set={set} setSaas={setSaas} START_Y={START_Y} START_M={START_M} />
          </div>
        );
      })}
    </div>
  );
}
