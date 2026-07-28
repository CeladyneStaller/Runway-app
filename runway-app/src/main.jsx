import React from "react";
import { installGlobalHandlers, initErrorReporting } from "./state/errors";
import { createSentrySink } from "./state/sentry";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.jsx";
import { createClient } from "@supabase/supabase-js";
import { syncConfigured, syncConfigReport, readActiveCompany } from "./state/storage.js";
import { enableHostedSync } from "./state/sync.js";

// HOSTED SYNC BOOTSTRAP — the one place @supabase/supabase-js is used. Everything else (the auth
// adapter, the backend, the write cadence, the account API) is dependency-free and tested without a
// network. The SDK is here and only here because session handling and refresh rotation are worth a
// library and reimplementing them would be a bad trade.
//
// THIS IS LIVE CODE, not a commented-out template. It used to ship commented out, which meant every
// extraction of the project archive silently reverted the person who had enabled it — and an app with
// Supabase settings but no bootstrap falls through to local-first, handing out access with NO SIGN-IN.
// App refuses to render in that state now, but the better fix was to stop shipping it disabled.
//
// TO ENABLE: `npm install @supabase/supabase-js`, then put your values in .env (see .env.example) with
// VITE_SYNC_ENABLED=true, and rebuild. With the env unset the app runs local-first against IndexedDB,
// which is a supported mode, and none of this executes.
//
// The syncConfigured() guard around createClient() is not decoration: createClient() throws
// "supabaseUrl is required" on an undefined URL, and because this runs before render, that throw takes
// the whole app down to a blank page.
if (syncConfigured()) {
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  // supabase.auth is passed whole, not just getSession: the app needs sign-in, sign-out and live auth
  // events too. readActiveCompany() restores which company THIS DEVICE was last looking at.
  // The device's remembered company is read FOR THE SIGNED-IN USER. Without the id it comes back null,
  // and current_company() resolves one properly — which is the right answer, not a degraded one.
  const { data: sess } = await supabase.auth.getSession().catch(() => ({ data: null }));
  enableHostedSync({
    authClient: supabase.auth,
    activeCompany: await readActiveCompany(sess?.session?.user?.id ?? null),
  });
} else {
  console.info(
    "[runway] hosted sync off — running local-first against IndexedDB. Missing:\n  - "
    + syncConfigReport().missing.join("\n  - "),
  );
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);

// ERROR REPORTING. The handlers are always installed — they cost nothing and keep the console
// consistent — but nothing is SENT anywhere until a sink is installed, which requires a DSN. Off by
// default is the right default for an app holding salaries: switching it on should be a deliberate
// act with a reviewable diff, not something that happens because a package was added.
//
// To turn it on, install an adapter here that forwards the already-scrubbed event. Do NOT hand a
// vendor SDK the raw error: `state/errors.js` explains what it strips and why.
installGlobalHandlers();

const release = import.meta.env.VITE_RELEASE || "dev";
const environment = import.meta.env.VITE_ENVIRONMENT || "production";

// SENTRY WITHOUT THE SDK. `state/sentry.js` explains why: `Sentry.init()` installs its own global
// error handlers, which capture RAW errors before `reportError()` is in the call path — so the vendor
// would see an unscrubbed message. Posting the envelope ourselves means the only thing that can reach
// Sentry is what the scrubber produced.
const sink = createSentrySink({ dsn: import.meta.env.VITE_SENTRY_DSN, release, environment })
  // Generic fallback: any endpoint that accepts a POST of the scrubbed JSON.
  || (import.meta.env.VITE_ERROR_SINK_URL
    ? (event) => fetch(import.meta.env.VITE_ERROR_SINK_URL, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      })
    : null);

// SAY SOMETHING WHEN REPORTING IS OFF. This used to fail silently: a missing or malformed DSN
// produced a sink of null, `reportError` logged to the console exactly as it always does, and there
// was no way to tell "scrubbed and sent" from "scrubbed and dropped" without reading the context
// object for absent keys. A setup step that looks identical whether or not it worked is a bad setup
// step.
if (sink) {
  initErrorReporting(sink, { release, environment });
} else if (import.meta.env.VITE_SENTRY_DSN) {
  console.warn("[runway] VITE_SENTRY_DSN is set but could not be parsed — error reporting is OFF. "
    + "Expected the form https://<key>@<host>/<numeric project id>");
} else {
  console.info("[runway] error reporting is OFF — no VITE_SENTRY_DSN in this build. "
    + "Vite inlines VITE_ variables at build time, so setting one requires a rebuild.");
}

// SERVICE WORKER. Registered after load so it never competes with the first paint, and only in
// production — a worker caching a dev server produces confusing staleness during development.
//
// Failure is ignored on purpose: an unregistered worker costs offline support and installability, and
// nothing else. The app must not fail to start because a cache did.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is optional */ });
  });
}
