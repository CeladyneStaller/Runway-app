// ── What the dashboard chart shows ───────────────────────────────────────────────────────────────
//
// ⚠️ PER DEVICE, NOT PER COMPANY. These change what YOU are looking at — the same rule as the chart
// picker's own choice. An owner turning off milestones on their laptop must not remove them from
// everybody's dashboard, and nothing here is worth a permission model.
//
// Every option maps to a prop `RunwayChart` already takes. This exposes what the chart can do; it does
// not ask it to do more.

const KEY = "wl.dashChart";

export const DEFAULTS = Object.freeze({
  band: true,          // the confidence range
  upside: true,        // the speculative curve and its own band
  milestones: true,
  actuals: true,
  axisBreak: true,     // give the operating band most of the height when a raise dwarfs it
  // ⚠️ A LENGTH, NOT A SWITCH. It was "show the full 36 months" — but the window is already ADAPTIVE,
  // fitting the crossing and the last milestone, so the switch only ever meant "stop fitting". A number
  // says what somebody actually wants: how far ahead to look. `null` keeps the fit.
  horizon: null,       // null = fit to the content · 6..36 = that many months
});

/** ⚠️ THE OPTIONS PEOPLE CANNOT SENSIBLY CHANGE ARE ABSENT, NOT DISABLED.
 *
 *  A switch that does nothing teaches people the settings are decorative. Speculative revenue has
 *  nothing to show when there is no gap; the axis break has nothing to do when no raise triggers it.
 *
 *  @param ctx  { hasUpside, wouldBreak }
 */
export function applicable(ctx = {}) {
  return Object.keys(DEFAULTS).filter(k => {
    if (k === "upside") return !!ctx.hasUpside;
    if (k === "axisBreak") return !!ctx.wouldBreak;
    return true;
  });
}

export const LABELS = Object.freeze({
  band: ["Confidence range",
    "The band around the curve. A runway is a range — hiding it shows a single line that looks more certain than the arithmetic is."],
  upside: ["With speculative revenue",
    "The second curve and its own band, if this money lands."],
  milestones: ["Milestones",
    "Deliverables and gates on the timeline, with the cash balance at each."],
  actuals: ["Recorded cash",
    "What the bank actually said, up to today — solid, against the dashed projection after it."],
  axisBreak: ["Break the axis for a large raise",
    "Gives most of the height to the operating band when a raise would otherwise flatten it. Off means one true scale and a very small operating band."],
  horizon: ["How far ahead to look",
    "The chart normally fits the window to the crossing and the last milestone. Set a length to override that — the projection runs to 36 months, and most of the tail is assumption."],
});

export function readOpts() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    // ⚠️ MERGED OVER THE DEFAULTS, NOT USED AS-IS. A stored blob written before an option existed would
    // otherwise leave that option `undefined`, which reads as OFF — so adding an option would silently
    // turn it off for everybody who had ever opened the modal.
    return { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  } catch { return { ...DEFAULTS }; }
}

export function writeOpts(next) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...next })); } catch { /* private mode */ }
  return { ...DEFAULTS, ...next };
}

// ⚠️ `horizon` IS COMPARED BY VALUE, NOT TRUTHINESS. Every other option is a boolean; treating a
// number as one would call `horizon: 24` equal to `horizon: 12` and leave "Reset to defaults" disabled
// on a chart that is not at its defaults.
export const isDefault = (o) => Object.keys(DEFAULTS).every(k =>
  (k === "horizon" ? (o?.[k] ?? null) === DEFAULTS[k] : !!o?.[k] === !!DEFAULTS[k]));

/** Clamped where it is read, so a stored value from a future build cannot draw past the projection. */
export const horizonOf = (o) => {
  const v = Number(o?.horizon);
  return Number.isFinite(v) && v >= 6 ? Math.min(36, Math.round(v)) : null;
};
