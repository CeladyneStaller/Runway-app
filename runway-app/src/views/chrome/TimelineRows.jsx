// The timelines, as rows, for a screen too narrow to draw an axis on.
//
// AN AXIS IS NOT THE POINT. What the goals and milestones charts carry is a list of dated things and a
// verdict on each — and at 328px the axis costs everything and buys nothing: 34 characters of label
// have nowhere to go, and the dot's position along a 276px line resolves to a fortnight either way.
//
// SO THE DATE MOVES INTO THE ROW. Every chart already states its own date rather than relying on the
// axis, which is exactly what makes this substitution lossless — the axis was never carrying that
// information, and dropping it removes nothing a reader was using.
//
// The cliff becomes a divider rather than a shaded region, because "everything below this line is
// after the money runs out" is the same statement a shaded band makes, in a form that survives being
// one column wide.
import React from "react";
import { money } from "../../engine/money";

const TONE = {
  signal: "var(--signal)", muted: "var(--muted-2)", danger: "var(--danger)",
  caution: "var(--caution)", raise: "var(--raise)",
};

function Row({ r, phase }) {
  const stranded = !!r.stranded;
  const colour = r.negative ? TONE.danger
    : r.misfiled ? TONE.caution
    : r.short ? TONE.caution
    : stranded ? TONE.danger
    : TONE.signal;

  // The same sentence the wide chart puts beside the dot. Kept identical on purpose: two phrasings of
  // one verdict is how a reader on a phone and a reader at a desk end up describing different things.
  const detail = [];
  if (r.strandedBeforeRound) {
    detail.push(`the round never lands${r.bridge ? `, needs ${money(r.bridge)} first` : ""}`);
  } else if (stranded && r.bridge) detail.push(`needs ${money(r.bridge)} to reach`);
  else if (stranded) detail.push("unreachable without bridging");
  else if (r.short) detail.push(`${money(r.bal)}, ${money(r.shortBy)} short`);
  else if (r.misfiled) detail.push(phase === "pre" ? "after the close" : "before the close");
  else if (r.target > 0) detail.push(`${money(r.bal)}, target ${money(r.target)}`);
  else if (Number.isFinite(r.bal)) detail.push(money(r.bal));

  return (
    <li className="chr">
      <span className="chr-dot" style={{ background: colour }} aria-hidden="true" />
      <span className="chr-body">
        <span className="chr-name">{r.label}</span>
        <span className="chr-meta" style={{ color: colour }}>
          {r.dueLabel}{detail.length ? ` · ${detail.join(" · ")}` : ""}
        </span>
      </span>
    </li>
  );
}

export function TimelineRows({ spec }) {
  const groups = spec.kind === "goals"
    ? [["Pre-raise · your money", spec.pre, "pre"], ["Post-raise · their money", spec.post, "post"]]
    : [["Dates you set", spec.mine, null], ["From rounds", spec.fromRound, null]];

  const cliff = spec.cashOutLabel && !spec.cashOutEndless ? spec.cashOutLabel : null;

  return (
    <div className="chrows">
      {cliff && (
        <p className="chr-cliff">
          Cash out · {cliff}
          {spec.recoversLabel ? ` · recovers ${spec.recoversLabel}` : ""}
        </p>
      )}
      {groups.map(([title, rows, phase]) => (
        (rows?.length || 0) > 0 && (
          <section key={title}>
            <h4 className="chr-h">{title}</h4>
            <ul className="chr-list">
              {rows.map(r => <Row key={r.id} r={r} phase={phase} />)}
            </ul>
          </section>
        )
      ))}
    </div>
  );
}
