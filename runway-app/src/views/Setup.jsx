import React, { useMemo, useState } from "react";
import { TRIAL_DAYS } from "../state/plans";
import { docFromSetup, missingSalaries, setupHasSubstance, num, classifyRunway } from "../state/setup";
import { buildModelFromDoc } from "../engine/buildmodel";
import { SHAPE_QUESTIONS, stepsFor } from "../engine/setupshape";
import { buildProjection } from "../engine/projection";
import { moneyFull } from "../engine/money";
import { HORIZON } from "../engine/time";

// The setup wizard. Replaces "here is an empty model, go and find the eight tabs".
//
// EVERY STEP IS SKIPPABLE and the whole thing is escapable, because the first person who doesn't have
// salary figures to hand must not be trapped in it. Skipping everything writes no document at all,
// which leaves the account exactly as new as it was found — so the wizard can be offered again rather
// than having quietly consumed its own trigger.
//
// THE RUNNING RUNWAY FIGURE IS THE POINT. It is the number people came for, assembling as they type,
// and it is the reason to finish rather than abandon. It also means the wizard is honest about the
// consequence of a blank salary: the number visibly fails to move.

// ⚠️ THE STEPS ARE DERIVED FROM THE ANSWERS NOW, not a constant. Somebody who says they do not run
// projects must not then be asked to enter one — **a wizard that asks about work you have just said you
// do not do teaches people the questions were not listened to.**
// `stepsFor` owns the rule; this file only renders what it returns.

const blankEmployee = () => ({ name: "", title: "", salary: "" });
const blankProject = () => ({ name: "", type: "internal", budget: "" });
const blankRound = () => ({ name: "", kind: "safe", status: "planning", amount: "" });

/** Rows always end in one blank, so there is somewhere to type without hunting for an add button.
 *  `docFromSetup` drops unnamed rows, so the trailing blank never reaches the document. */
function useRows(seed) {
  const [rows, setRows] = useState([seed()]);
  const set = (i, patch) => setRows(rs => {
    const next = rs.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === rs.length - 1 && String(patch.name ?? rs[i].name).trim()) next.push(seed());
    return next;
  });
  const remove = (i) => setRows(rs => (rs.length === 1 ? [seed()] : rs.filter((_, j) => j !== i)));
  return [rows, set, remove];
}

export function Setup({ initialName = "", onDone, onCancel, onImport, mode = "model" }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [cash, setCash] = useState("");
  const [employees, setEmployee, dropEmployee] = useRows(blankEmployee);
  const [projects, setProject, dropProject] = useRows(blankProject);
  const [rounds, setRound, dropRound] = useRows(blankRound);

  // ⚠️ THE PARENTS DEFAULT TO YES AND THE CHILDREN FOLLOW THEM. Somebody who skips this step gets the
  // whole app, which is the only safe default: hiding a tab somebody never asked to hide is a worse
  // error than showing one they do not need.
  const [shape, setShape] = useState(() => ({
    projects: true, internal: true, grants: true, preproduction: true,
    sales: true, orders: true, subs: true,
    investment: true,
  }));
  const setShapeAnswer = (id, on) => setShape(sh => {
    const next = { ...sh, [id]: on };
    // Unticking a parent unticks its children, so the stored answers cannot say "no projects, but yes
    // to grants" — a state no question asked for and nothing downstream would know how to read.
    const q = SHAPE_QUESTIONS.find(x => x.id === id);
    if (q && !on) for (const c of q.children || []) next[c.id] = false;
    if (q && on) for (const c of q.children || []) next[c.id] = sh[c.id] ?? true;
    return next;
  });

  const STEPS = stepsFor(shape);

  // ⚠️ THE BODIES ARE KEYED BY NAME, NOT BY INDEX. With a derived step list `step === 2` means a
  // different screen depending on the answers, so an inserted step would silently show the wrong body.
  // `at` asks which step this IS, which stays true however the list is built.
  const at = (label) => STEPS[step] === label;

  const answers = { name, cash, employees, projects, rounds, shape };

  // The live figure.
  //
  // zeroInfo returns NULL — not { months: null } — when the balance never crosses zero, and that ONE
  // null covers TWO completely different situations which this used to label identically as
  // "cash-positive":
  //   the money genuinely never runs out, because revenue covers costs; or
  //   the money is running out, just not inside the 36 months we model.
  // Telling somebody who is burning steadily that they are cash-flow positive, purely because their
  // pile outlasts our window, is the kind of wrong answer that gets believed. So the sign of the net
  // flow in the final modelled month decides which of the two it is.
  //
  // A REAL ZERO DATE STILL WINS over both. If the cash runs out at month 5, "cash-flow positive at
  // month 30" is not the answer to give — you don't reach month 30.
  const runway = useMemo(() => {
    if (num(cash) <= 0) return null;
    try {
      const doc = docFromSetup(answers);
      return classifyRunway(buildProjection(buildModelFromDoc(doc), doc.settings.toggles));
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cash, employees, projects, rounds, name]);

  const noSalary = missingSalaries(answers);
  // Creating a company from nothing needs a name to create it UNDER; setting up an existing one does
  // not, because that company already has a name and this only defaults the model's.
  const needsName = mode === "company" && at("Basics") && !name.trim();
  const last = step === STEPS.length - 1;

  // The NAME is passed separately and unconditionally. A wizard skipped from the first step still has
  // to name the company it is about to create, and `docFromSetup` returns null when there is nothing
  // else to record — so the name cannot ride inside the document.
  // ⚠️ THE SHAPE TRAVELS AS A THIRD ARGUMENT. It is not part of the DOCUMENT — it decides which tabs a
  // company shows, which is stored per company by `set_company_tabs` — so folding it into `docFromSetup`
  // would put a display preference inside the financial model.
  const finish = () => onDone(setupHasSubstance(answers) ? docFromSetup(answers) : null,
                              name.trim(), shape);

  return (
    <div className="rw"><div className="splash setup">
      <span className="eyebrow">{mode === "company" ? "New company" : "Set up your company"}</span>

      <div className="setup-rail" role="list">
        {STEPS.map((s, i) => (
          <div key={s} role="listitem" className={"setup-step" + (i === step ? " on" : "") + (i < step ? " done" : "")}>{s}</div>
        ))}
      </div>

      {at("Basics") && (
        <div className="setup-body">
          <h2>The basics</h2>
          <p>Two things, and the forecast starts working. Everything else can wait.</p>
          <label className="signin-label" htmlFor="su-name">Company name</label>
          <input id="su-name" className="signin-input" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Robotics" />
          <label className="signin-label" htmlFor="su-cash">Cash on hand</label>
          <input id="su-cash" className="signin-input" value={cash} onChange={e => setCash(e.target.value)} placeholder="500,000" inputMode="decimal" />
          <p className="setup-fine">What's in the bank today. You can correct it any time.</p>
          {/* SAID AT THE MOMENT OF CREATION, not on a billing page they have to find. Creating a
              company is what starts the clock — and under the one-trial rule it is a decision, not a
              free action, so the person taking it should know that while they are taking it. */}
          {mode === "company" && (
            <p className="setup-fine setup-trial">
              This starts your {TRIAL_DAYS}-day free trial. No card needed, and you can export your
              model at any time.
            </p>
          )}
          {onImport && (
            <div className="setup-alt">
              <span>Already have a model in a file?</span>
              <label className="linkbtn setup-import">Import it instead
                <input type="file" accept="application/json,.json" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
              </label>
            </div>
          )}
        </div>
      )}

      {at("What to show") && (
        <div className="setup-step">
          <p className="setup-q">What do you want to keep track of here?</p>
          <p className="setup-qs">Tick what applies. Anything you leave off can be turned on later from
            Company settings, and nothing is deleted either way.</p>

          {SHAPE_QUESTIONS.map(q => (
            <div className={"shape-grp" + (shape[q.id] ? " on" : "")} key={q.id}>
              <label className="shape-row">
                <input type="checkbox" checked={!!shape[q.id]}
                       onChange={e => setShapeAnswer(q.id, e.target.checked)} />
                <span>
                  <span className="shape-n">{q.q}</span>
                  {q.hint && <span className="shape-w">{q.hint}</span>}
                </span>
              </label>
              {/* ⚠️ THE CHILDREN DISAPPEAR WITH THEIR PARENT. Somebody who has said they do not run
                  projects should not then be asked three questions about kinds of project — it is the
                  same fault as a control with nothing to act on, and it makes a short form feel long. */}
              {shape[q.id] && (q.children || []).length > 0 && (
                <div className="shape-kids">
                  {q.children.map(c => (
                    <label className="shape-row" key={c.id}>
                      <input type="checkbox" checked={!!shape[c.id]}
                             onChange={e => setShapeAnswer(c.id, e.target.checked)} />
                      <span className="shape-n sub">{c.q}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {at("People") && (
        <div className="setup-body">
          <h2>Who's on payroll?</h2>
          <p>Payroll is usually most of the burn, so this is the step that makes the forecast real.
            Rough salaries are fine — and you can leave them blank for now.</p>
          <div className="setup-rows">
            <div className="setup-head"><span>Name</span><span>Title</span><span>Annual salary</span><span /></div>
            {employees.map((e, i) => (
              <div className="setup-row" key={i}>
                <input className="inp" value={e.name} onChange={x => setEmployee(i, { name: x.target.value })} placeholder="Alex Rivera" aria-label={`Person ${i + 1} name`} />
                <input className="inp" value={e.title} onChange={x => setEmployee(i, { title: x.target.value })} placeholder="CEO" aria-label={`Person ${i + 1} title`} />
                <input className="inp" value={e.salary} onChange={x => setEmployee(i, { salary: x.target.value })} placeholder="168,000" inputMode="decimal" aria-label={`Person ${i + 1} salary`} />
                <button className="linkbtn" onClick={() => dropEmployee(i)} aria-label={`Remove person ${i + 1}`}>×</button>
              </div>
            ))}
          </div>
          {noSalary.length > 0 && (
            <div className="setup-warn" role="status">
              No salary yet for {noSalary.join(", ")} — they'll sit in the model at zero, so your burn
              is understated until you fill it in. That's fine for now; the runway below just won't be true yet.
            </div>
          )}
        </div>
      )}

      {at("Projects") && (
        <div className="setup-body">
          <h2>Any projects running?</h2>
          <p>Grants, builds, customer work. A name and a rough budget is enough — the costs get coded
            to them later.</p>
          <div className="setup-rows">
            <div className="setup-head"><span>Name</span><span>Type</span><span>Budget</span><span /></div>
            {projects.map((p, i) => (
              <div className="setup-row" key={i}>
                <input className="inp" value={p.name} onChange={x => setProject(i, { name: x.target.value })} placeholder="Mobile app launch" aria-label={`Project ${i + 1} name`} />
                <select className="inp" value={p.type} onChange={x => setProject(i, { type: x.target.value })} aria-label={`Project ${i + 1} type`}>
                  <option value="internal">Internal</option>
                  <option value="grant">Grant</option>
                  <option value="fulfillment">Customer work</option>
                </select>
                <input className="inp" value={p.budget} onChange={x => setProject(i, { budget: x.target.value })} placeholder="95,000" inputMode="decimal" aria-label={`Project ${i + 1} budget`} />
                <button className="linkbtn" onClick={() => dropProject(i)} aria-label={`Remove project ${i + 1}`}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {at("Funding") && (
        <div className="setup-body">
          <h2>Money raised, or being raised?</h2>
          <p>Anything already closed counts as cash you have. Anything still in progress stays switched
            off in the forecast until you turn it on — so a round you're hoping for can't quietly
            lengthen your runway.</p>
          <div className="setup-rows">
            <div className="setup-head"><span>Name</span><span>Type</span><span>Amount</span><span /></div>
            {rounds.map((r, i) => (
              <div className="setup-row" key={i}>
                <input className="inp" value={r.name} onChange={x => setRound(i, { name: x.target.value })} placeholder="2026 SAFE" aria-label={`Instrument ${i + 1} name`} />
                <select className="inp" value={r.status} onChange={x => setRound(i, { status: x.target.value })} aria-label={`Instrument ${i + 1} status`}>
                  <option value="closed">Closed</option>
                  <option value="committed">Committed</option>
                  <option value="raising">Raising</option>
                  <option value="planning">Planning</option>
                </select>
                <input className="inp" value={r.amount} onChange={x => setRound(i, { amount: x.target.value })} placeholder="1,000,000" inputMode="decimal" aria-label={`Instrument ${i + 1} amount`} />
                <button className="linkbtn" onClick={() => dropRound(i)} aria-label={`Remove instrument ${i + 1}`}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="setup-readout">
        <span>Runway so far</span>
        <b className="num">
          {runway == null ? "—"
            : runway.kind === "runway" ? `${runway.months.toFixed(1)} mo`
            : runway.kind === "beyond" ? `${HORIZON}+ mo`
            : "cash-flow positive"}
        </b>
      </div>
      {runway?.kind === "idle" && (
        <div className="setup-fine">Nothing is burning yet, so the cash never runs out. Add people or
          costs and this becomes a real date.</div>
      )}
      {runway?.kind === "positive" && (
        <div className="setup-fine">Revenue covers costs by the end of the window, so the cash stops
          going down rather than merely lasting a long time.</div>
      )}
      {runway?.kind === "beyond" && (
        <div className="setup-fine">Still spending more than you bring in — but the cash outlasts the
          {" "}{HORIZON} months modelled here, so there's no date to show yet.</div>
      )}
      {num(cash) > 0 && <div className="setup-fine">Starting from {moneyFull(num(cash))}.</div>}

      <div className="setup-nav">
        <button className="addbtn ghost" onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </button>
        <div className="setup-nav-r">
          {!(mode === "company" && at("Basics")) && (
            <button className="linkbtn" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Finish without this" : "Skip this step"}
            </button>
          )}
          <button className="addbtn" disabled={needsName} onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div></div>
  );
}
