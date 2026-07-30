import React, { createContext, useContext } from "react";
import { tabIsVisible } from "../engine/roles";

// Hiding tabs and sub-tabs.
//
// A VIEW PREFERENCE, NOT MODEL DATA. It changes nothing about the projection and must never travel
// with the document: a document is shared between the people who own a company, and one person
// decluttering their own screen must not rearrange somebody else's. It is deliberately NOT in
// `doc.settings` alongside the revenue toggles — those change the numbers, so sharing them is right.
//
// STORED PER DEVICE, in localStorage, keyed by user. That is a real tradeoff and worth stating: it
// does not follow you to another browser. The alternative — a `profiles` column and an RPC — would
// follow you, at the cost of an async read before the chrome can draw, which means the nav flickers
// from "everything" to "your selection" on every load. For a decluttering preference, a stable
// instant render is worth more than cross-device sync. If that trade turns out to be wrong, the seam
// to change is `load`/`save` here and nothing else.
//
// DEFAULT IS EVERYTHING VISIBLE. Hiding is subtractive and opt-in, so a new tab appears for everyone
// automatically instead of silently missing for anyone who saved a preference before it existed.

const KEY = "runway:tabprefs";

/** Every tab and sub-tab that can be hidden.
 *
 *  Duplicated from the views by necessity — each view builds its own `TABS` locally, with live counts,
 *  so there is nothing importable. `test/views/tabprefs.test.jsx` scans the view sources and fails if
 *  this drifts, which is the only failure mode that matters: a sub-tab the settings screen cannot see
 *  is a sub-tab nobody can hide. */
export const TAB_REGISTRY = [
  { view: "dash",  label: "Dashboard",     locked: true, subs: [] },
  { view: "flow",  label: "Cash flow",     subs: [["net", "Net cash flow"], ["revenue", "Revenue"], ["costs", "Costs"]] },
  { view: "pay",   label: "Payroll",       subs: [["total", "Total"], ["employees", "Employees"], ["fringe", "Fringe"], ["alloc", "Allocation"], ["priority", "Prioritization"]] },
  { view: "proj",  label: "Projects",      subs: [["all", "All"], ["internal", "Internal"], ["grants", "Grants"], ["fulfil", "Fulfillment"], ["proposals", "Proposals"]] },
  { view: "sales", label: "Sales",         subs: [["summary", "Summary"], ["orders", "Orders"], ["targets", "Targets"], ["subs", "Subscriptions"]] },
  { view: "inv",   label: "Investment",    subs: [["summary", "Summary"], ["stack", "Capital stack"], ["goals", "Goals"]] },
  { view: "hist",  label: "Spend history", subs: [["summary", "Summary"], ["burn", "Burn"], ["ledger", "Ledger"], ["cash", "Cash on hand"], ["forecasts", "Forecasts"]] },
  { view: "ms",    label: "Milestones",    subs: [] },
  { view: "scn",   label: "Scenarios",     subs: [] },
];

/** The Dashboard cannot be hidden. It is the fallback whenever the current view disappears, so making
 *  it hideable means inventing a second fallback and then protecting THAT — the simpler rule is that
 *  there is always somewhere to go home to. */
export const isLocked = (view) => !!TAB_REGISTRY.find(t => t.view === view)?.locked;

const EMPTY = { views: [], subs: {} };

/** `{ views: [...], subs: { view: [...] } }` — the things that are HIDDEN. */
export function load(store = globalThis.localStorage, userKey = "") {
  try {
    const raw = store?.getItem(userKey ? `${KEY}:${userKey}` : KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw);
    return {
      views: Array.isArray(p?.views) ? p.views.filter(v => !isLocked(v)) : [],
      subs: p?.subs && typeof p.subs === "object" ? p.subs : {},
    };
  } catch { return EMPTY; }   // corrupt or unavailable: show everything, which is the safe direction
}

export function save(prefs, store = globalThis.localStorage, userKey = "") {
  try { store?.setItem(userKey ? `${KEY}:${userKey}` : KEY, JSON.stringify(prefs)); }
  catch { /* private mode or quota — the preference is not worth an error */ }
}

/** Drop hidden entries from a nav array of `[key, label, icon]`.
 *
 *  THREE LAYERS NOW, and the rule lives in `engine/roles.js` so the same answer is available to the
 *  settings UI without importing view code:
 *
 *    company   — the OWNER decides which tabs this company uses. Company configuration, so it is on
 *                the company row rather than in the document: an editor can write the document, and a
 *                setting that editors could change is not an owner's setting.
 *    personal  — each person hides what they do not want from what remains. Per device, as before.
 *    role      — what somebody may not see regardless. Currently only Scenarios.
 *
 *  `ctx` is optional throughout, so every existing caller keeps its old behaviour. */
export const visibleNav = (nav, prefs, ctx = {}) =>
  (nav || []).filter(([k]) => tabIsVisible(k, {
    ...ctx, locked: isLocked(k), personalHidden: prefs?.views || [],
  }));

/** Drop hidden entries from a view's `TABS` array of `[key, label, count?]`.
 *
 *  NEVER RETURNS EMPTY. Hiding every sub-tab of a view would leave a screen with a row of nothing and
 *  no content, so the last one survives being hidden. The settings UI prevents this too, but the
 *  guarantee belongs here, where the rendering actually happens. */
export function visibleTabs(view, tabs, prefs) {
  const hidden = (prefs?.subs || {})[view] || [];
  const out = (tabs || []).filter(([k]) => !hidden.includes(k));
  return out.length ? out : (tabs || []).slice(0, 1);
}

/** Which sub-tab a view should show, given the route and what is hidden.
 *
 *  Falls back to the first VISIBLE tab rather than the view's own default, because the default may
 *  itself be hidden — in which case falling back to it would render a tab the person asked not to see. */
export function resolveTab(view, routeTab, fallback, prefs) {
  // Reads the REGISTRY rather than the view's own TABS array, because the active tab has to be known
  // at the TOP of a component while TABS is built further down from live counts. An earlier version
  // took the array and had to be called late, which moved `const tab` below code that used it — a
  // TDZ error the build accepts and only the test suite catches.
  const all = TAB_REGISTRY.find(t => t.view === view)?.subs || [];
  const vis = visibleTabs(view, all, prefs).map(([k]) => k);
  if (!vis.length) return fallback;
  if (routeTab && vis.includes(routeTab)) return routeTab;
  return vis.includes(fallback) ? fallback : vis[0];
}

/** Where to send someone whose current view has just been hidden. */
export const landingView = (view, prefs, ctx = {}) =>
  tabIsVisible(view, { ...ctx, locked: isLocked(view), personalHidden: prefs?.views || [] })
    ? view : "dash";

const Ctx = createContext(EMPTY);
export const TabPrefsProvider = ({ value, children }) =>
  React.createElement(Ctx.Provider, { value: value || EMPTY }, children);
export const useTabPrefs = () => useContext(Ctx);
