// Projects somebody else changed while you had them open.
//
// WHY THIS EXISTS. Per-project concurrency (038–040) means an edit to a project you are not touching no
// longer collides with your save — which is the point, and which also means nothing tells you it
// happened. Your screen keeps showing their project as it was when you loaded, indefinitely. The
// conflict that used to obstruct the save was also, accidentally, the notification; removing it removed
// both.
//
// IT DOES NOT UPDATE ANYTHING BY ITSELF. Replacing a project on screen while somebody is reading it is
// how a number changes under a cursor mid-sentence — and this application's whole output is a number
// people quote to boards. The new body is already in hand, so loading it is one click and no round
// trip; taking that click is the person's decision.
import React, { useEffect, useState } from "react";
import { onStaleProjects } from "../../state/storage";

const ago = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

const who = (email) => (email ? email.split("@")[0] : "Somebody");

export function StaleProjects({ doc, onLoad }) {
  const [stale, setStale] = useState({});

  useEffect(() => onStaleProjects((map) => {
    // MERGED, NOT REPLACED. Two saves a minute apart can each report a different project, and dropping
    // the first would lose a notice the person had not acted on yet.
    setStale(prev => ({ ...prev, ...map }));
  }), []);

  const ids = Object.keys(stale);
  if (!ids.length) return null;

  const nameOf = (id) =>
    (doc?.projects || []).find(p => p.id === id)?.name || stale[id]?.body?.name || "a project";

  const load = (id) => {
    const body = stale[id]?.body;
    if (body) onLoad?.(id, body);
    setStale(({ [id]: _gone, ...rest }) => rest);
  };

  const dismiss = (id) => setStale(({ [id]: _gone, ...rest }) => rest);

  return (
    <div className="stale-note">
      {ids.map(id => (
        <div className="stale-row" key={id}>
          <div>
            <b>{nameOf(id)}</b> was changed by {who(stale[id]?.updated_by)} {ago(stale[id]?.updated_at)}.
            {" "}You are looking at your own copy.
          </div>
          <div className="stale-actions">
            <button className="linkbtn" onClick={() => load(id)}>Load their version</button>
            <button className="linkbtn" onClick={() => dismiss(id)}>Keep mine</button>
          </div>
        </div>
      ))}
    </div>
  );
}
