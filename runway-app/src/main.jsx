import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.jsx";

// ---------------------------------------------------------------- hosted sync --
// The ONE place @supabase/supabase-js is used. Everything else — the auth adapter, the backend, the
// write cadence — is dependency-free and tested without a network. The SDK is here and only here
// because session handling and refresh rotation are genuinely worth a library, and reimplementing them
// would be a bad trade.
//
// TO TURN SYNC ON:
//   1. npm install @supabase/supabase-js      (already declared in package.json)
//   2. put your values in .env  (see .env.example) and set VITE_SYNC_ENABLED=true
//   3. uncomment the four lines below
//
// With this commented out, or with the env vars unset, the app runs entirely local-first against
// IndexedDB — which stays the supported fallback, not a broken state.
//
import { createClient } from "@supabase/supabase-js";
import { enableHostedSync } from "./state/sync.js";
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
enableHostedSync({ getSession: async () => (await supabase.auth.getSession()).data.session });
//
// `getSession()` is called on every request rather than cached, which is exactly what makes refresh
// rotation work: the SDK hands back a fresh token when the old one is near expiry, with no refresh
// logic anywhere in this repo.

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
