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
  fullHorizon: false,  // 36 months rather than 18
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
  fullHorizon: ["Show the full 36 months",
    "The chart normally fits the window to the crossing and the last milestone. This shows the whole 36-month projection instead — most of the tail is assumption."],
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

export const isDefault = (o) => Object.keys(DEFAULTS).every(k => !!o?.[k] === !!DEFAULTS[k]);
