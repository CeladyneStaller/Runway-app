import { useState } from "react";
import { ARCHETYPES } from "../../state/archetypes";

/** Which sample company to look around.
 *
 *  ⚠️ ONE COMPONENT, TWO ENTRY POINTS — the landing screen and the demo banner. Somebody exploring a
 *  second archetype should not meet a different chooser than the one that got them in.
 *
 *  Opened from the banner it arrives with the current company selected, **so the radio shows where you
 *  ARE, not only where you could go.**
 */
export function DemoPicker({ current = null, onPick, onClose }) {
  const [sel, setSel] = useState(current || ARCHETYPES[0].id);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card demo-pick" role="dialog" aria-label="Pick a demo company"
           onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>
            <span className="modal-t">Pick a company to look around</span>
            {/* ⚠️ AT THE TOP, NOT THE BOTTOM. It is the thing that makes somebody willing to click
                anything at all — at the foot of a modal it is read after the decision it was meant to
                inform. */}
            <span className="meta" style={{ display: "block", marginTop: 2 }}>
              Sample data. Nothing you do is saved.
            </span>
          </span>
        </div>

        <div className="modal-b">
          {ARCHETYPES.map(a => (
            <label className={"demo-opt" + (sel === a.id ? " on" : "")} key={a.id}>
              <input type="radio" name="demo" checked={sel === a.id}
                     onChange={() => setSel(a.id)} />
              <span>
                <span className="demo-n">{a.label}</span>
                <span className="demo-w">
                  {a.blurb} <b>{a.shows}</b>
                </span>
                <span className="demo-m">{a.company}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="modal-f">
          <span className="meta">You can switch at any time.</span>
          <span style={{ display: "flex", gap: 9 }}>
            <button className="addbtn ghost" onClick={onClose}>Cancel</button>
            <button className="addbtn" onClick={() => onPick(sel)}>Open it</button>
          </span>
        </div>
      </div>
    </div>
  );
}
