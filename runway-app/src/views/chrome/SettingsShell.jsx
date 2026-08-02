// Settings, split in two.
//
// THE RULE IS ONE QUESTION: does changing it affect anybody else?
//
//   PROFILE   follows YOU across every company — password, appearance, your advisor plan, your data.
//             Reached from the avatar, top right. Changing it changes nothing for anybody else.
//
//   COMPANY   belongs to THIS company and is shared — name, plan and seats, people, tabs, connections,
//             deletion. Reached from the rail, because it is scoped to whichever company is active and
//             the switcher is already there. Putting it in the profile menu would place a
//             company-scoped page inside a person-scoped one, which is the confusion this removes.
//
// OWNER-ONLY PAGES ARE SHOWN AND DISABLED, NOT HIDDEN. A member who cannot find billing assumes it is
// broken; one who sees it greyed with "only the owner can change this" knows who to ask. This reverses
// the choice `CompanyTabs` made — it renders nothing for non-owners — and that panel is brought into
// line here rather than left as the exception.
import React from "react";

export function SettingsShell({ title, badge, section, pages, active, onGo, onBack, children }) {
  return (
    <div className="setwrap">
      <div className="topbar">
        <div>
          <span className="eyebrow">{section}</span>
          <h1 className="h1">{title}</h1>
        </div>
        <div className="statuspill">
          {badge}
          <button className="linkbtn" onClick={onBack}>← Back</button>
        </div>
      </div>

      <div className="set">
        <nav className="setnav" aria-label={`${section} settings`}>
          {pages.map(p => (
            <button key={p.id}
                    className={"setnav-i" + (p.id === active ? " on" : "") + (p.locked ? " locked" : "")}
                    aria-current={p.id === active ? "page" : undefined}
                    onClick={() => onGo(p.id)}>
              {p.label}
              {/* The reason, not just the state: "owner only" tells somebody who to ask. */}
              {p.locked && <em>owner only</em>}
            </button>
          ))}
        </nav>
        <div className="setbody">{children}</div>
      </div>
    </div>
  );
}

/** A page somebody may look at and not change.
 *
 *  DISABLED RATHER THAN ABSENT, and it says who can. Hiding it makes the app look broken to the person
 *  who cannot find the thing they were told about. */
export function LockedNotice({ what = "this" }) {
  return (
    <div className="setlock">
      Only the owner of this company can change {what}. You can see it here so you know what to ask for.
    </div>
  );
}
