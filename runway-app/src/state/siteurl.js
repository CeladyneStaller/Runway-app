// Where an emailed auth link should come back to.
//
// THE BUG THIS EXISTS FOR: `redirectTo` was `window.location.origin`, so a magic link returned to
// whatever host you happened to be on when you asked for it. Request one from a Vercel PREVIEW
// deployment — `runway-app-git-branch-you.vercel.app` — and the link in your inbox points back at that
// preview. Vercel's Deployment Protection guards preview deployments behind a Vercel account, so the
// link opens a Vercel login wall instead of this app. The email is fine, the token is fine, the
// destination is wrong.
//
// It also fails in a quieter way. Supabase keeps an ALLOW-LIST of redirect URLs, and an
// `emailRedirectTo` that isn't on it is not rejected — it is silently ignored, and the link falls back
// to the project's configured Site URL. So a redirect can be perfectly well-formed, perfectly sent, and
// still land somewhere else entirely, with no error anywhere to say so.
//
// Both failures share a shape: nothing is broken, the link just points at the wrong host, and nothing
// in the product ever says which host that is. Hence `VITE_SITE_URL` to pin it, and `linkDestination`
// so the "check your email" screen can name the place the link will actually open.

/** Strip a trailing slash and anything after the origin — Supabase wants a bare origin, and
 *  "https://app.example.com/" and "https://app.example.com" are different strings to an allow-list. */
const normalise = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch { return null; }   // not a URL; treat as unset rather than sending people somewhere invalid
};

/** The origin auth links should return to: the configured canonical site if there is one, else
 *  wherever we are now. Falling back to the current origin keeps local dev and preview builds working
 *  without configuration — the fallback is the RIGHT answer there, and only wrong in the one case
 *  where a canonical domain exists and hasn't been named. */
export function siteOrigin(env = import.meta.env, loc = typeof window !== "undefined" ? window.location : null) {
  return normalise(env?.VITE_SITE_URL) || (loc ? loc.origin : null) || null;
}

/** Hosts that hand out per-deployment URLs, which are exactly the ones that end up behind a login wall
 *  or outside an allow-list. Not an error — a preview build SHOULD work — but worth saying out loud. */
const EPHEMERAL = /\.vercel\.app$|\.netlify\.app$|\.pages\.dev$|\.onrender\.com$/i;

/** What to tell somebody about where their link will open.
 *  `{ origin, ephemeral }` — `ephemeral` meaning "this is a per-deployment host, so if the link asks
 *  you to log in to something that isn't this app, that's why". */
export function linkDestination(env = import.meta.env, loc = typeof window !== "undefined" ? window.location : null) {
  const origin = siteOrigin(env, loc);
  if (!origin) return null;
  let host = origin;
  try { host = new URL(origin).host; } catch { /* already bare */ }
  return { origin, host, ephemeral: EPHEMERAL.test(host) && !normalise(env?.VITE_SITE_URL) };
}
