// An advisor's own plan — bought by them, for them.
//
// SEPARATE FROM `BillingSection`, which is scoped to a company. These are two products sold to two
// people for two things: a company plan buys seats in one company, an advisor plan buys the ability to
// work across many without taking a seat in any. Sharing a panel would mean one screen answering "what
// does this company pay" and "what do I pay" at once, and the reason 024 split the tables is that those
// stopped being the same question.
import React, { useCallback, useEffect, useState } from "react";
import { ADVISOR_PLANS, advisorSummary , priceOn, savingLabel} from "../../state/plans";
import { money } from "../../engine/money";
import { ConfirmPlan } from "./ConfirmPlan";

export function AdvisorBilling({ account, onError }) {
  const [cadence, setCadence] = useState("yearly");
  const [confirm, setConfirm] = useState(null);

  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    if (!account?.advisorPlan) return;
    account.advisorPlan().then(setRow).catch(() => setRow(null));
  }, [account]);
  useEffect(load, [load]);

  // SHOWN TO EVERYBODY SIGNED IN. The gate that used to be here gave this section only to somebody
  // already on a plan or already in several companies — which meant the one person the product is FOR,
  // a fractional CFO evaluating it before any client has invited them, was the one person who could not
  // see it. Hiding a product until somebody already needs it is a decision that only makes sense from
  // the inside.
  //
  // A founder with one company is not confused by it. They read the first line, which says who it is
  // for rather than what it costs, and skip it.
  const has = row?.allowed > 0;
  if (!row) return null;

  // MAPPED EXPLICITLY, not spread. `advisor_usage()` returns `companies`; `advisorSummary` speaks
  // `used`, because "used of allowed" is what a seat-style limit reads like. Spreading the row meant
  // `used` defaulted to 0 and the panel reported "0 of 3 companies" to somebody in three.
  const s = advisorSummary({
    plan: row.plan, status: has ? "active" : "none",
    used: row.companies ?? 0, allowed: row.allowed ?? 0,
    cancel_at_period_end: row.cancel_at_period_end,
  });

  const go = async (fn, key) => {
    setBusy(key); onError?.(null);
    try { globalThis.location.href = await fn(); }
    catch (e) { onError?.(e?.message || String(e)); setBusy(null); }
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h3>{has ? "Your advisor plan" : "Advise several companies?"}</h3>
          <p>{has ? s.text
                  : "For accountants and fractional CFOs. Be invited into any number of companies " +
                    "without taking one of their seats, keep your own scenarios in each, and see " +
                    "every client's runway in one place."}</p>
        </div>
        {has && (
          <button className="linkbtn" disabled={busy === "portal"}
                  onClick={() => go(() => account.advisorPortal(), "portal")}>
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>

      {/* THE OFFER IS ONLY SHOWN WHEN THERE IS SOMETHING TO CHANGE. Somebody already on Unlimited has
          nothing to buy, and a card marked "Your plan" beside one that is not is how a pricing page
          gets read as an upsell. */}
      {confirm && (
        <ConfirmPlan plan={confirm} cadence={cadence} busy={busy === confirm.id}
                     onCadence={(c) => setCadence(c)}
                     onCancel={() => setConfirm(null)}
                     onConfirm={() => go(() => account.checkoutAdvisor(confirm.id, cadence),
                                         confirm.id)} />
      )}

      {/* ⚠️ THE SAME CONTROL AS THE COMPANY PAGE, so an advisor who has seen one already knows this
          one. The layout differs — rows here, cards there — but the question and its default do not. */}
      <div className="cad-row">
        <div className="seg cad-seg" role="tablist" aria-label="Billing cadence">
          <button role="tab" aria-selected={cadence === "monthly"}
                  className={"seg-b" + (cadence === "monthly" ? " on" : "")}
                  onClick={() => setCadence("monthly")}>Monthly</button>
          <button role="tab" aria-selected={cadence === "yearly"}
                  className={"seg-b" + (cadence === "yearly" ? " on" : "")}
                  onClick={() => setCadence("yearly")}>Yearly</button>
        </div>
        {/* ⚠️ ONLY ON YEARLY. The chip is an argument FOR the cadence being shown — beside a monthly
            price it reads as a claim about what you are looking at, which is untrue, or as a
            nag, which is worse. **A saving that does not apply to the selected option is
            noise at the moment somebody is deciding.** */}
        {cadence === "yearly" && <span className="cad-chip">{savingLabel(ADVISOR_PLANS)}</span>}
      </div>

      {ADVISOR_PLANS.filter(p => p.id !== row.plan).map(p => (
        <div className="acct-row" key={p.id}>
          <div>
            <div className="acct-row-t">{p.name} · {money(priceOn(p, cadence).perMonth)}/mo</div>
            {/* The annual total, because checkout charges immediately and this is the number that
                leaves the account today. */}
            <div className="acct-row-s">
              {cadence === "yearly"
                ? `${money(priceOn(p, cadence).billed)} billed yearly · save ${money(priceOn(p, cadence).saves)}`
                : `${money(priceOn(p, cadence).annual)} a year, billed monthly`}
            </div>
            <div className="acct-row-s">{p.blurb}</div>
          </div>
          <div className="acct-row-a">
            <button className="addbtn ghost" disabled={busy === p.id}
                    onClick={() => setConfirm(p)}>
              {busy === p.id ? "Opening…" : has ? `Switch to ${p.name}` : `Choose ${p.name}`}
            </button>
          </div>
        </div>
      ))}

      {/* THE CONSEQUENCE NOBODY EXPECTS, said before it happens rather than after. An advisor who
          lapses stops being exempt and starts consuming a seat in every company they are in — which
          can push several companies over capacity at once, and their owners will see people lose write
          access without having changed anything. */}
      {has && row.companies > 0 && (
        <p className="acct-row-s">
          If this plan ends you will take a seat in each of the {row.companies}{" "}
          {row.companies === 1 ? "company" : "companies"} you are in, which may put some of them over
          their limit.
        </p>
      )}
    </section>
  );
}
