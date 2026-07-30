// Reading the callable surface out of the migrations, and telling a broken function from a refused one.
//
// WHY THIS EXISTS. `test/engine/migrations.test.js` reads SQL and catches ordering mistakes — a column
// referenced before it is added, a return type changed without a drop. It cannot catch anything that
// only happens when a function RUNS. `accept_invitation` was created without complaint and failed on
// its first call with "column reference company_id is ambiguous", because plpgsql defers name
// resolution to execution. Nothing short of calling it would have found that.
//
// So: call every RPC once, with arguments that reach the body and match nothing.
//
// THE TRICK IS THAT REFUSAL IS SUCCESS. `delete_company('<random uuid>')` raising `forbidden` means the
// function parsed, planned and executed — which is the whole question. What we are looking for is the
// other kind of error: an ambiguous column, an undefined table, a function that does not exist.

/** Functions this must NOT call, and why. Every entry is a thing that would change real data rather
 *  than refuse — a random uuid does not protect you from a function that takes no id. */
export const SKIP = new Map([
  ["delete_my_data", "deletes the calling account's companies"],
  ["purge_deleted_companies", "hard-deletes soft-deleted companies past the window"],
  ["purge_expired_invitations", "deletes invitation history"],
  ["purge_funnel_events", "deletes analytics rows"],
  ["record_funnel_event", "would put a fake step in the activation funnel"],
  ["set_advisor", "grants a paid capability"],
  ["create_company", "creates a real company on the account"],
  ["save_document", "writes the document; the write path has its own tests"],
  ["apply_subscription_event", "writes billing state"],
  ["apply_advisor_event", "writes billing state"],
  ["qbo_connect", "stores an OAuth token in the Vault"],
]);

/** Every function the migrations grant to a client role, with its parameters.
 *
 *  Read from the GRANTs rather than from the `create function` statements: what matters is the surface
 *  somebody can actually call. A definer function nobody may execute cannot break a customer. */
export function rpcSurface(files) {
  const defs = new Map();
  const grants = new Map();

  for (const { name: file, sql } of files) {
    const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(([\s\S]*?)\)\s*\n?\s*returns\b/gi;
    let m;
    while ((m = fnRe.exec(sql))) {
      defs.set(m[1], { name: m[1], params: parseParams(m[2]), file });
    }
    const grantRe = /grant\s+execute\s+on\s+function\s+(\w+)\s*\(([^)]*)\)\s+to\s+([\w\s,]+);/gi;
    while ((m = grantRe.exec(sql))) {
      const roles = m[3].split(",").map(r => r.trim()).filter(Boolean);
      grants.set(m[1], roles);
    }
  }

  return [...grants.entries()]
    .filter(([name]) => defs.has(name))
    .map(([name, roles]) => ({ ...defs.get(name), roles }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `p_company_id uuid, p_role member_role default 'editor'` -> the ones without a default.
 *
 *  ONLY THE REQUIRED ONES ARE PASSED. A parameter with a default is a value the author already chose,
 *  and guessing over it is how a smoke test starts testing its own guesses. */
export function parseParams(text) {
  return String(text || "")
    .split(",")
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const hasDefault = /\bdefault\b/i.test(p);
      const [, name, type] = /^(\w+)\s+([\w[\]. ]+?)(?:\s+default\b.*)?$/i.exec(p) || [];
      return name ? { name, type: (type || "").trim().toLowerCase(), hasDefault } : null;
    })
    .filter(Boolean)
    .filter(p => !p.hasDefault);
}

const UUID = () => "00000000-0000-4000-8000-" + String(Date.now()).slice(-12).padStart(12, "0");

/** A value that reaches the body and matches nothing real. */
export function argFor(type) {
  if (type.includes("[]")) return [];
  if (type.startsWith("uuid")) return UUID();
  if (type.startsWith("member_role")) return "viewer";
  if (type.startsWith("jsonb") || type.startsWith("json")) return {};
  if (type.startsWith("bool")) return false;
  if (type.startsWith("int") || type.startsWith("bigint") || type.startsWith("numeric")) return 0;
  if (type.startsWith("timestamp")) return new Date().toISOString();
  if (type.startsWith("interval")) return "30 days";
  return "rpc-smoke";
}

export const argsFor = (fn) =>
  Object.fromEntries(fn.params.map(p => [p.name, argFor(p.type)]));

/** SQLSTATEs that mean the function ran and said no. Anything else means it could not run.
 *
 *  `42501` is our own `forbidden`; `P0001`–`P0017` are the raises this schema defines; `23xxx` are
 *  constraint violations, which are also the function working. */
const REFUSAL = /^(42501|P0[01]\d\d|23\d\d\d|22\d\d\d)$/;

/** The ones that mean somebody shipped a function that cannot execute. */
export const BROKEN = {
  "42702": "ambiguous column — an OUT parameter shadowing a real column",
  "42703": "undefined column",
  "42883": "undefined function",
  "42P01": "undefined table",
  "42601": "syntax error",
  "42P13": "return type changed without a drop",
  "42804": "type mismatch",
};

export function classify({ ok, status, body }) {
  if (ok) return { verdict: "ran", detail: "" };
  const code = body?.code || "";
  if (BROKEN[code]) return { verdict: "broken", detail: `${code}: ${BROKEN[code]} — ${body?.message || ""}` };
  if (REFUSAL.test(code)) return { verdict: "refused", detail: `${code} ${body?.message || ""}`.trim() };
  // 404 from PostgREST means the function is not in the schema cache at all: it was never applied, or
  // its signature differs from the one being called. Broken, and the most likely thing after a
  // migration somebody forgot to run.
  if (status === 404) return { verdict: "broken", detail: "not found — migration not applied?" };
  return { verdict: "unknown", detail: `${status} ${code} ${body?.message || ""}`.trim() };
}
