# Waterline HQ

A staff-only status hub. **Its own Vercel project** — deliberately not a route inside the app, so it
shares the identity without shipping staff tooling in the customer bundle.

## What is here

    index.html    the whole hub. No build step.

## What is NOT here, and where it lives

⚠️ **The Edge Function and the migration belong to the app repo**, because that is where the Supabase
project is managed from. Putting them here would mean two repos that both look like they own the
Supabase project, and the one you edited would not be the one that deployed.

    runway-app/supabase/functions/hub-status/index.ts   the proxy
    runway-app/supabase/migrations/048_is_staff.sql     the RPC it calls

## Before this page works

1. Apply `048_is_staff.sql`
2. `insert into staff` for yourself
3. `supabase functions deploy hub-status` — **from the app repo**
4. Set `STRIPE_KEY`, `VERCEL_TOKEN`, `VERCEL_PROJECT`, `VERCEL_TEAM_ID`
5. Deploy this folder to Vercel: no build command, output is this directory

## The one edit this page needs

`index.html` reads `window.WATERLINE_ANON_KEY` and nothing sets it. Add before the main script:

    <script>window.WATERLINE_ANON_KEY = "sb_publishable_...";</script>

⚠️ The **anon/publishable** key, which is already in the customer app's bundle and safe in client
source. **The service key never goes here.**

## Checking it works

Sign in, follow the link, load status. Then **sign out and confirm status fails** — a hub that works
signed out means the proxy is not checking, and that is the failure that looks like success.
