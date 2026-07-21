import { useEffect, useState, useCallback } from "react";

// Hash-based routing for a local-first app. The URL hash (#view/tab) is client-only by web design —
// never sent to a server — so it works from a file, any static host, any origin, with zero backend and
// zero config. That matches this app's architecture; a path router (React Router) would need a server
// set up to serve the app for every path, which we don't have.
//
// Everything here goes through parse/format + a hook, so the VIEWS never touch window.location. When a
// backend arrives and clean paths (/projects/grants) become worth it, swapping to React Router is a
// change to THIS FILE's internals, not to the 9 views — they just call route/navigate.

// The valid top-level views. An unknown hash falls back to the default rather than showing nothing.
export const VIEWS = ["dash", "flow", "pay", "proj", "sales", "inv", "hist", "ms", "scn"];
export const DEFAULT_VIEW = "dash";

// #view/tab  <->  { view, tab }. Tab is optional (a view may have no sub-tabs, or be at its default).
export function parseHash(hash) {
  const raw = (hash || "").replace(/^#\/?/, "").trim();
  if (!raw) return { view: DEFAULT_VIEW, tab: null };
  const [view, tab] = raw.split("/");
  const v = VIEWS.includes(view) ? view : DEFAULT_VIEW;
  return { view: v, tab: tab ? decodeURIComponent(tab) : null };
}

export function formatHash({ view, tab }) {
  const v = VIEWS.includes(view) ? view : DEFAULT_VIEW;
  return "#" + v + (tab ? "/" + encodeURIComponent(tab) : "");
}

// The hook App uses. Owns the { view, tab } route, reads the hash on mount, writes it on navigate, and
// listens for hashchange so the browser back/forward buttons and manual URL edits work.
export function useHashRoute() {
  const [route, setRoute] = useState(() =>
    typeof window !== "undefined" ? parseHash(window.location.hash) : { view: DEFAULT_VIEW, tab: null });

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // navigate: update the hash (which fires hashchange -> setRoute). Replacing vs pushing: a tab change
  // within a view replaces (so back doesn't step through every tab), a view change pushes (so back
  // returns to the previous view). Both keep the URL truthful.
  const navigate = useCallback((next, { replace = false } = {}) => {
    const merged = { view: next.view ?? DEFAULT_VIEW, tab: next.tab ?? null };
    const h = formatHash(merged);
    if (typeof window === "undefined") { setRoute(merged); return; }
    if (h === window.location.hash) { setRoute(merged); return; }   // no-op if unchanged
    if (replace) window.history.replaceState(null, "", h);
    else window.location.hash = h;
    setRoute(merged);
  }, []);

  const setView = useCallback((view) => navigate({ view, tab: null }), [navigate]);
  const setTab = useCallback((tab) => navigate({ view: route.view, tab }, { replace: true }), [navigate, route.view]);

  return { view: route.view, tab: route.tab, setView, setTab, navigate };
}

// Helper for a view with sub-tabs: derive the active tab from the route (falling back to the view's
// default when the hash has no tab or an unknown one), and a setter that writes it to the hash. This is
// what each view uses INSTEAD of useState, so its sub-tab lives in the URL without the view knowing how.
export function tabFromRoute(routeTab, validTabs, fallback) {
  return routeTab && validTabs.includes(routeTab) ? routeTab : fallback;
}
