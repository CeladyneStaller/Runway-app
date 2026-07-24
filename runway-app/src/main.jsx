import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.jsx";
import { syncConfigured } from "./state/storage.js";

// ---------------------------------------------------------------- hosted sync --
// The ONE place @supabase/supabase-js is used. Everything else — the auth adapter, the backend, the
// write cadence — is dependency-free and tested without a network. The SDK is here and only here
// because session handling and refresh rotation are worth a library.
//
// TO TURN SYNC ON:
//   1. npm install @supabase/supabase-js      (already declared in package.json)
//   2. cp .env.example .env   then put your values in .env  — NOT in .env.example, which is the
//      committed template; Vite does not read it, and anything pasted there lands in version control
//   3. set VITE_SYNC_ENABLED=true in .env
//   4. uncomment the block below
//
// NOTE the syncConfigured() guard around createClient(). It is not decoration: createClient() throws
// "supabaseUrl is required" on an undefined URL, and because this runs before render, that throw takes
// the whole app down to a blank page. A missing or misplaced .env is a CONFIGURATION mistake, not a
// reason to lose the app — so it falls back to local, which is a supported mode, not a broken one.
//
// import { createClient } from "@supabase/supabase-js";
// import { enableHostedSync } from "./state/sync.js";
//
// if (syncConfigured()) {
//   const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
//   enableHostedSync({ getSession: async () => (await supabase.auth.getSession()).data.session });
// } else {
//   console.info("[runway] hosted sync not configured — running local-first against IndexedDB");
// }
//
// `getSession()` is called on every request rather than cached, which is what makes refresh rotation
// work: the SDK hands back a fresh token near expiry, with no refresh logic anywhere in this repo.

if (!syncConfigured()) {
  // Visible in the console rather than silent, so "why is my data not syncing" has an answer.
  console.info("[runway] hosted sync not configured — running local-first against IndexedDB");
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
