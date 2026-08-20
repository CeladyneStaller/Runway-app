import { priceOn } from "../../state/plans";

/** The screen between choosing a plan and Stripe taking the money.
 *
 *  ⚠️ IT EXISTS BECAUSE BILLING IS IMMEDIATE. `stripe-checkout` passes no `trial_period_days`, so the
 *  charge lands on click — **"Choose Connected" on yearly moves $1,788 with no intermediate screen**,
 *  and the card that button sat on advertised "$149/mo".
 *
 *  A per-month price on a button that takes a year's payment is the largest gap between expectation and
 *  event anywhere in this product. One screen closes it.
 */
export function ConfirmPlan({ plan, cadence, trialDaysLeft = null, onConfirm, onCadence, onCancel,
                              busy = false }) {
  const p = priceOn(plan, cadence);
  const money = (n) => "$" + Math.round(n).toLocaleString();
  const other = cadence === "monthly" ? "yearly" : "monthly";
  const renews = cadence === "monthly" ? "every month" : "once a year";

  // ⚠️ TAKEN FROM THE CALLER, NOT PARSED AGAIN. The billing page already computes and displays days
  // remaining; deriving it a second way here is how two numbers on one screen come to disagree.
  const trialLeft = Number.isFinite(trialDaysLeft) && trialDaysLeft > 0 ? trialDaysLeft : null;

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onCancel}>
      <div className="modal-card cp-card" role="dialog" aria-label="Confirm your plan"
           onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span className="modal-t">Confirm your plan</span>
          <span className="modal-s">You will be charged when you continue.</span>
        </div>

        <div className="modal-b">
          <div className="cp-box">
            <div className="cp-line">
              <span className="cp-plan"><b>{plan.name}</b> · {cadence}</span>
              <span className="cp-amt">{money(p.billed)}</span>
            </div>
            <div className="cp-sub">
              {money(p.perMonth)}/mo, billed {renews}
              {cadence === "yearly" && p.saves > 0 && <> · saves {money(p.saves)} a year</>}
            </div>

            {/* ⚠️ THE ALTERNATIVE IS OFFERED AT THE MOMENT OF DOUBT, which is when it is worth most.
                Somebody hesitating at a year's payment either takes the smaller commitment or leaves,
                and one of those is a customer. */}
            {onCadence && (
              <div className="cp-alt">
                Prefer {money(priceOn(plan, other).perMonth)} {other === "monthly" ? "a month" : "a month, billed yearly"}?{" "}
                <button className="linkbtn" disabled={busy}
                        onClick={() => onCadence(other)}>Switch to {other}</button>
              </div>
            )}
          </div>

          {/* ⚠️ THE QUESTION THIS ORDERING CREATES, ANSWERED BEFORE IT IS ASKED. The trial starts at
              company creation, so somebody paying on day three reasonably wonders whether they have
              just thrown away the rest of it. They have not — checkout sends Stripe a `trial_end`, so
              the paid period begins when the free one ends. */}
          {trialLeft != null && (
            <p className="cp-trial">
              Your trial has {trialLeft} {trialLeft === 1 ? "day" : "days"} left. Paying now does not
              shorten it — your {cadence === "yearly" ? "year" : "first month"} starts when the trial
              ends.
            </p>
          )}
        </div>

        <div className="cp-foot">
          <button className="addbtn ghost" disabled={busy} onClick={onCancel}>Back</button>
          {/* ⚠️ THE BUTTON SAYS THE AMOUNT. "Continue" on a click that moves $1,788 is the gap this
              screen exists to close — **and if the number makes somebody hesitate, that hesitation was
              going to be a refund request instead.** */}
          <button className="addbtn" disabled={busy} onClick={onConfirm}>
            {busy ? "Opening…" : `Pay ${money(p.billed)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
