// Password rules, as data rather than as a score.
//
// A strength meter tells you that you failed without telling you what to change. A checklist tells you
// what to do, which is the only thing a person standing at this screen actually wants. The meter in the
// UI is a summary OF these rules, not a separate judgement that might disagree with them.
//
// These run in the browser, so they are a courtesy, not enforcement — the real minimum lives in the
// Supabase project settings. Client validation exists to stop someone submitting a password the server
// will reject; it is not a security control and this file should not be mistaken for one.

export const MIN_LENGTH = 10;

// The short head of the distribution. A full list belongs on the server (or in a breach-corpus check);
// this catches the handful that would otherwise sail through a pure length rule.
const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "letmein", "welcome", "welcome1",
  "qwerty", "qwerty123", "qwertyuiop", "123456", "1234567", "12345678", "123456789", "1234567890",
  "111111", "000000", "abc123", "monkey", "dragon", "sunshine", "princess", "football", "baseball",
  "iloveyou", "admin", "administrator", "login", "master", "hello", "freedom", "whatever",
  "trustno1", "starwars", "superman", "batman", "changeme", "secret", "summer", "winter",
  "companyname", "startup", "runway", "money", "finance",
]);

const norm = (s) => String(s || "").trim().toLowerCase();

/** The local part of an email — "corey@acme.com" -> "corey". Also the bit people put in passwords. */
const emailStem = (email) => norm(email).split("@")[0] || "";

/**
 * Every rule, each with whether it currently passes. Order is the order they appear on screen.
 * @returns {{ id, label, ok }[]}
 */
export function passwordRules(password, { email = "", confirm = null } = {}) {
  const p = String(password || "");
  const stem = emailStem(email);
  const rules = [
    { id: "length", label: `At least ${MIN_LENGTH} characters`, ok: p.length >= MIN_LENGTH },
    { id: "common", label: "Not a commonly used password", ok: p.length > 0 && !COMMON.has(norm(p)) },
    {
      id: "email",
      label: "Doesn't contain your email",
      // Only meaningful once the stem is long enough to be a real clue; "al@x.com" should not ban "al".
      ok: p.length > 0 && (stem.length < 4 || !norm(p).includes(stem)),
    },
  ];
  if (confirm !== null) {
    rules.push({ id: "match", label: "Both entries match", ok: p.length > 0 && p === confirm });
  }
  return rules;
}

export const passwordOk = (password, opts) => passwordRules(password, opts).every(r => r.ok);

/** How many rules pass, for the summary bar. Never a separate opinion from the checklist. */
export function passwordScore(password, opts) {
  const rules = passwordRules(password, opts);
  return { passed: rules.filter(r => r.ok).length, total: rules.length };
}
