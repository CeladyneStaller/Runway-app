// What a keep-alive run MEANS — separated from running it, and tested.
//
// Every wrong call made during this phase was in a verdict rather than in the data: a double-entry
// tripwire that failed a clean report on four rows in 123, an "outermost section" that meant to yield
// two values and yielded nineteen, a sign test that answered "separates" for two branches that were
// both positive. Each was a one-line judgement written inline and never exercised.
//
// This one decides whether a human gets woken up, so it is a function with tests rather than an `if`
// inside a script.

/** Should this run be treated as a FAILURE by whatever scheduled it?
 *
 *  The answer is yes for anything a person must act on, because the only alerting channel here is the
 *  scheduler's own "this run failed" notification. Being strict costs an email; being lenient costs a
 *  customer whose numbers quietly stopped updating.
 *
 *  It is deliberately NOT yes for transient failures. A network blip that resolves on the next run is
 *  not something anybody should be paged about, and an alert that cries wolf monthly is one that gets
 *  filtered into a folder within a quarter — at which point the real one is invisible too.
 */
export function alertsFrom(summary = {}, health = {}) {
  const alerts = [];

  if (summary.needs_reauth > 0) {
    alerts.push({
      level: "act",
      code: "needs_reauth",
      text: `${summary.needs_reauth} connection(s) died and cannot be repaired by retrying — ` +
            "the customer must reconnect. They see a banner; nothing else will tell them.",
    });
  }

  if (health.needs_reauth > 0 && !summary.needs_reauth) {
    // Died on an EARLIER run and still nobody has reconnected. Worth repeating, because the first
    // alert may have been missed and the connection has been stale ever since.
    alerts.push({
      level: "act",
      code: "still_disconnected",
      text: `${health.needs_reauth} connection(s) have been waiting to be reconnected since before ` +
            "this run.",
    });
  }

  if (health.stale_syncs > 0) {
    alerts.push({
      level: "act",
      code: "stale",
      text: `${health.stale_syncs} connection(s) are healthy but have not synced recently — ` +
            "the numbers look current and are not, which is the failure mode this job exists for.",
    });
  }

  if (health.reauth_due_90d > 0) {
    alerts.push({
      level: "warn",
      code: "reauth_due",
      text: `${health.reauth_due_90d} connection(s) hit the five-year re-authorization ceiling ` +
            "within 90 days. Rotation does not reset it.",
    });
  }

  if (summary.failed > 0) {
    // TRANSIENT, and deliberately not an alert. Retried next run.
    alerts.push({
      level: "note",
      code: "transient",
      text: `${summary.failed} refresh(es) failed transiently and will be retried.`,
    });
  }

  if (health.never_synced > 0) {
    alerts.push({
      level: "note",
      code: "never_synced",
      text: `${health.never_synced} connection(s) have never synced — usually somebody who connected ` +
            "and did not finish mapping.",
    });
  }

  return alerts;
}

/** Non-zero only when something needs a person. `warn` and `note` are reported and do not fail. */
export function exitCodeFor(alerts) {
  return alerts.some(a => a.level === "act") ? 1 : 0;
}
