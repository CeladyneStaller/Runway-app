// The avatar, top right, and what is behind it.
//
// EVERYTHING HERE FOLLOWS YOU across every company — password, appearance, your advisor plan, your
// data. Nothing in it changes anything for anybody else, which is the rule that decides what belongs
// here rather than in Company settings.
import React, { useEffect, useRef, useState } from "react";
import { getSessionProvider } from "../../state/sync";

/** Two letters from whatever name we have. Falls back to the email, then to a neutral mark — an
 *  avatar reading "??" looks like a fault rather than a missing display name. */
function initials(name, email) {
  const from = (name || "").trim() || (email || "").split("@")[0] || "";
  const parts = from.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "·";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
}

const ITEMS = [
  ["profile", "Profile", "name, password"],
  ["appearance", "Appearance", "tabs, charts"],
  ["advisor", "Advisor plan", "clients, billing"],
  ["data", "Your data", "export, delete"],
];

export function ProfileMenu({ onGo }) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    getSessionProvider()?.getUser?.().then(u => { if (alive) setMe(u); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // CLOSES ON OUTSIDE CLICK AND ON ESCAPE. A menu that only closes by picking something traps somebody
  // who opened it by accident, and Escape is what people try first.
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const email = me?.email || "";
  const name = me?.user_metadata?.name || me?.name || "";

  return (
    <div className="pmenu" ref={box}>
      <button className="avatar" aria-haspopup="menu" aria-expanded={open}
              aria-label="Your account" onClick={() => setOpen(o => !o)}>
        {initials(name, email)}
      </button>

      {open && (
        <div className="pdrop" role="menu">
          <div className="pwho">
            <b>{name || email.split("@")[0] || "Signed in"}</b>
            <span>{email}</span>
          </div>
          {ITEMS.map(([id, label, hint]) => (
            <button key={id} role="menuitem" className="pitem"
                    onClick={() => { setOpen(false); onGo?.(id); }}>
              {label}<em>{hint}</em>
            </button>
          ))}
          <button role="menuitem" className="pitem psep"
                  onClick={() => { setOpen(false); getSessionProvider()?.signOut?.(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
