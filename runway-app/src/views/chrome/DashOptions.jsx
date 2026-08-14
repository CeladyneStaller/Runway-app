import { DEFAULTS, LABELS, applicable, isDefault } from "../../engine/dashopts";

/** Settings for the runway chart, not a builder.
 *
 *  ⚠️ THE RUNWAY CHART IS ONE SPECIFIC ARGUMENT — cash over time, with its range and what interrupts
 *  it. **A builder invites replacing it, and there is nothing better to replace it with.** What people
 *  want is to turn off the parts that crowd it, which is a different question and a different control.
 */
export function DashOptions({ opts, setOpts, onClose, ctx = {} }) {
  const shown = applicable(ctx);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog"
           aria-label="Chart options">
        <div className="modal-h">
          <span className="modal-t">Chart options</span>
          <span className="meta">Runway · this device</span>
        </div>
        <div className="modal-b">
          {shown.map(k => (
            <label className="dopt" key={k}>
              <input type="checkbox" checked={!!opts[k]}
                     onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
              <span>
                <span className="dopt-n">{LABELS[k][0]}</span>
                <span className="dopt-w">{LABELS[k][1]}</span>
              </span>
            </label>
          ))}
          {/* ⚠️ SAYS WHAT IS ABSENT AND WHY, rather than leaving a shorter list to look arbitrary. An
              option that has nothing to act on is hidden; somebody who remembers seeing it should not
              have to wonder whether they imagined it. */}
          {shown.length < Object.keys(DEFAULTS).length && (
            <p className="meta dopt-abs">
              {!ctx.hasUpside && "Speculative revenue is not shown because every tier is already switched on. "}
              {!ctx.wouldBreak && "The axis break is not shown because nothing on this chart is large enough to need it."}
            </p>
          )}
        </div>
        <div className="modal-f">
          <button className="linkbtn" disabled={isDefault(opts)}
                  onClick={() => setOpts({ ...DEFAULTS })}>Reset to defaults</button>
          <button className="addbtn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
