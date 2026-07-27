// Sentry transport.
//
// NO `@sentry/browser`, DELIBERATELY, and not primarily for bundle size.
//
// `Sentry.init()` installs its own `window.onerror` and `unhandledrejection` handlers, plus breadcrumb
// instrumentation that records fetch bodies, console arguments and DOM text. Those capture RAW errors
// at the source — before `reportError()` exists in the call path — so the vendor would see an
// unscrubbed message containing whatever a thrown object happened to serialise to. Disabling all of
// that is possible (`defaultIntegrations: false`, no `autoSessionTracking`, a `beforeSend` hook) but
// it is a configuration you have to keep getting right forever, against a dependency that adds
// integrations in minor versions.
//
// Posting the envelope ourselves means there is no bypass path to misconfigure. The only thing that
// can reach Sentry is what `reportError()` hands to this sink, which is already scrubbed.
//
// Format per https://develop.sentry.dev/sdk/data-model/envelopes/ — the `/store/` endpoint is
// deprecated. AUTH GOES IN THE QUERYSTRING rather than the `X-Sentry-Auth` header: a custom header
// triggers a CORS preflight on every send, and Sentry documents the querystring form precisely so
// browsers can avoid it.

const CLIENT = "runway/1.0";

/** DSN -> the pieces needed to address the envelope endpoint. Null for anything malformed, so a typo
 *  disables reporting rather than throwing on every crash. */
export function parseDsn(dsn) {
  try {
    const u = new URL(String(dsn || "").trim());
    const key = u.username;
    const projectId = u.pathname.replace(/^\//, "").split("/").filter(Boolean).pop();
    if (!key || !projectId || !/^\d+$/.test(projectId)) return null;
    return {
      key,
      projectId,
      url: `${u.protocol}//${u.host}/api/${projectId}/envelope/`
         + `?sentry_key=${encodeURIComponent(key)}&sentry_version=7`
         + `&sentry_client=${encodeURIComponent(CLIENT)}`,
    };
  } catch { return null; }
}

/** Sentry wants 32 hex characters with no dashes. */
const eventId = () => {
  try { return crypto.randomUUID().replace(/-/g, ""); }
  catch { return Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""); }
};

/** Turn an already-scrubbed stack string into Sentry frames.
 *
 *  Grouping is the entire reason for choosing Sentry over a table, and grouping is much better with
 *  frames than with a message alone. Frames are sent OLDEST FIRST, which is the order Sentry expects
 *  and the reverse of how a stack string reads. Anything unparseable is dropped rather than guessed
 *  at — a wrong filename groups two different bugs together, which is worse than no frame. */
export function parseFrames(stack) {
  if (!stack) return [];
  const out = [];
  for (const line of String(stack).split("\n")) {
    const m = /at\s+(?:(.+?)\s+\()?(\S+?):(\d+):(\d+)\)?\s*$/.exec(line.trim());
    if (!m) continue;
    out.push({
      function: m[1] || "?",
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules/.test(m[2]),
    });
  }
  return out.reverse();
}

/** A scrubbed event -> a Sentry event payload.
 *
 *  `context` becomes TAGS, not `extra`, because tags are searchable and filterable — being able to ask
 *  "every crash in the Scenarios view" is most of the value. It is safe to do this precisely because
 *  `scrubContext()` has already reduced it to short scalars; tagging arbitrary values would be a leak. */
export function toSentryEvent(event, { release, environment } = {}) {
  const frames = parseFrames(event?.stack);
  const tags = {};
  for (const [k, v] of Object.entries(event?.context || {})) {
    if (v != null && typeof v !== "object") tags[k] = String(v).slice(0, 200);
  }
  return {
    event_id: eventId(),
    timestamp: event?.at || new Date().toISOString(),
    platform: "javascript",
    level: "error",
    logger: "runway",
    ...(release ? { release } : {}),
    ...(environment ? { environment } : {}),
    tags,
    exception: {
      values: [{
        type: event?.name || "Error",
        value: event?.message || "",
        ...(frames.length ? { stacktrace: { frames } } : {}),
      }],
    },
  };
}

/** Envelope = newline-delimited JSON: envelope header, item header, item payload. */
export function toEnvelope(sentryEvent, dsn) {
  const header = { event_id: sentryEvent.event_id, sent_at: new Date().toISOString(), dsn };
  const item = { type: "event" };
  return `${JSON.stringify(header)}\n${JSON.stringify(item)}\n${JSON.stringify(sentryEvent)}\n`;
}

/** Build the sink `initErrorReporting()` expects. Returns null when the DSN is missing or malformed,
 *  which leaves reporting switched off rather than half-configured. */
export function createSentrySink({ dsn, release, environment, fetchImpl, maxPerSession = 25 } = {}) {
  const parsed = parseDsn(dsn);
  if (!parsed) return null;
  const post = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!post) return null;

  // FLOOD PROTECTION. A crash inside a render loop can fire hundreds of times a second, and without a
  // cap the first bad deploy would burn a month of quota in a minute and bury the one event anybody
  // needed to read. Client SDKs do this too; doing it ourselves means it cannot be forgotten.
  let sent = 0;
  const seen = new Map();
  const DEDUPE_MS = 5000;

  return (event) => {
    if (sent >= maxPerSession) return;

    // The same error repeating is one bug, not fifty. Keyed on message+view so two different crashes
    // are never collapsed together.
    const key = `${event?.name}|${event?.message}|${event?.context?.view || ""}`;
    const now = Date.now();
    if (seen.has(key) && now - seen.get(key) < DEDUPE_MS) return;
    seen.set(key, now);

    sent += 1;
    const body = toEnvelope(toSentryEvent(event, { release, environment }), dsn);
    // `keepalive` so a crash during unload still reports.
    //
    // THE .catch IS LOAD-BEARING. `reportError` calls this inside a try/catch, which catches a
    // synchronous throw and does nothing about a rejected PROMISE. An ad blocker, a CORS failure or
    // an offline browser rejects this fetch, that rejection is unhandled, the global handler catches
    // it, and it comes straight back here as a new event — a reporter reporting its own failure to
    // report. The dedupe and session cap bound it, but the right answer is not to start.
    return post(parsed.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
      keepalive: true,
    }).catch(() => { /* a failed send must never become an event */ });
  };
}
