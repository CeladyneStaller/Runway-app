// The QuickBooks report flattener lives in `supabase/functions/_shared/` and is re-exported here.
//
// ONE IMPLEMENTATION, TWO RUNTIMES. The Edge Function that syncs runs in Deno and can only bundle
// what sits under `supabase/functions/`; the browser build imports from `src/engine/`. Copying it
// would mean a mapping fix landing in one runtime and not the other — and the two disagreeing about
// what a row means is precisely the failure this whole phase has been finding and fixing.
//
// `_shared/` is already where plain, testable, cross-runtime code lives here: `stripe-signature.js`
// and `cors.js` are both imported by `index.ts` files AND by the vitest suite. This is the same
// arrangement, pointed the other way.
export { quickbooksSource, columnValues, dateWindows, mergeGrids }
  from "../../supabase/functions/_shared/qbo-report.js";
