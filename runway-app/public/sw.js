/* eslint-disable no-restricted-globals -- this file runs as a SERVICE WORKER, where `self` is the
   global scope rather than a stray window reference. The rule is right everywhere else. */
// Service worker. Makes the app installable and survivable offline.
//
// THE ONE RULE: CACHE THE APP, NEVER THE DATA.
//
// Everything under /assets/ is content-hashed by Vite, so it is safe to cache forever — a new build
// produces new filenames. Anything that talks to Supabase is NEVER cached, in either direction. A
// stale runway number is far worse than an error: an error is obviously wrong and a cached number
// from last week looks exactly like this week's, and somebody makes a hiring decision on it.
//
// Deliberately hand-written rather than generated. The generated kind ships a precache manifest and a
// set of routing rules that are easy to adopt without reading, and the failure mode here is silently
// serving stale financial data.

const VERSION = "v2";   // bumped: the shell now precaches /site.webmanifest, not the old one
const SHELL = `waterline-shell-${VERSION}`;

self.addEventListener("install", (e) => {
  // Only the entry point is precached. The hashed asset files are picked up on first fetch, which
  // avoids maintaining a build-time manifest for very little benefit at this size.
  // `/site.webmanifest`, not `/manifest.webmanifest`. The page carried BOTH for a while and browsers
  // take the first `<link rel="manifest">`, so the old one won and the new PNG icon set — the whole
  // reason for the brand assets — was never read. Precaching the wrong name would have kept a dead
  // file alive in the shell cache long after the page stopped asking for it.
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(["/", "/index.html", "/site.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Drop older shells so a deploy cannot leave a half-old app running.
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // NEVER TOUCH ANYTHING THAT IS NOT OURS. Supabase, Stripe and Sentry all go straight to the
  // network — no cache read, no cache write, no offline fallback. Serving a cached document, auth
  // response or subscription state would be a correctness bug with financial consequences.
  if (url.origin !== self.location.origin) return;

  // Content-hashed assets: cache first, because the filename changes when the content does.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Navigations: network first so a deploy is picked up immediately, falling back to the cached
  // shell when offline. The app then loads and reads whatever the local backend holds.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
  }
});
