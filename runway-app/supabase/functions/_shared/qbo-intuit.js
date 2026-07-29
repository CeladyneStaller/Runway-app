// The Intuit calls every QuickBooks function makes, in one place.
//
// Not because it is elegant — because a refresh token ROTATES, and every caller that refreshes has to
// store the new one before doing anything else with the access token. Three functions doing that
// three times is three chances to get the order wrong, and getting it wrong disconnects a customer
// with no repair short of asking them to authorise again.

export const OAUTH_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const OAUTH_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const SCOPE = "com.intuit.quickbooks.accounting";

export const apiBase = (env) =>
  env === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";

const basic = (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`;

/** Exchange an authorization code, or a refresh token, for a token set. Shape is identical either
 *  way, which is why both go through here. */
export async function tokenRequest(params, { clientId, clientSecret, fetchImpl = fetch }) {
  const res = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basic(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `invalid_grant` is TERMINAL — the token is dead and only the customer can issue another. Every
    // other failure is worth retrying. Callers branch on this to decide between `needs_reauth` and
    // "try again later", and getting it backwards either nags a working connection or silently
    // retries a dead one forever.
    return { ok: false, terminal: body.error === "invalid_grant",
             error: body.error || `http_${res.status}`, detail: body.error_description || "" };
  }
  const now = Date.now();
  return {
    ok: true,
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    accessExpiresAt: new Date(now + (body.expires_in ?? 3600) * 1000).toISOString(),
    refreshExpiresAt: new Date(now + (body.x_refresh_token_expires_in ?? 100 * 86400) * 1000).toISOString(),
  };
}

export const exchangeCode = (code, redirectUri, cfg) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, cfg);

export const refreshTokens = (refreshToken, cfg) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, cfg);

/** Tell Intuit the token is dead. Deleting our copy is not revoking it — a discarded token stays
 *  valid at Intuit and we no longer hold it to revoke later. */
export async function revokeToken(token, { clientId, clientSecret, fetchImpl = fetch }) {
  const res = await fetchImpl(OAUTH_REVOKE_URL, {
    method: "POST",
    headers: { Authorization: basic(clientId, clientSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return { ok: res.ok, status: res.status };
}

export function authorizeUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId, response_type: "code", scope: SCOPE,
    redirect_uri: redirectUri, state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}
