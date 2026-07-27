import React from "react";
import { installGlobalHandlers, initErrorReporting } from "./state/errors";
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
  enableHostedSync({ authClient: supabase.auth, activeCompany: await readActiveCompany() });
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
if (import.meta.env.VITE_ERROR_SINK_URL) {
  initErrorReporting(
    (event) => {
      // `keepalive` so a crash on unload still reports. Failures are swallowed by reportError.
      fetch(import.meta.env.VITE_ERROR_SINK_URL, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
    },
    { release: import.meta.env.VITE_RELEASE || "dev" },
  );
}
