// Hosted backend: the company's document in Postgres, reached over PostgREST.
//
// NO SDK DEPENDENCY, deliberately. The document layer needs exactly two calls — read the row, call the
// save RPC — and doing them with fetch keeps this file dependency-free, testable without a network, and
// adds nothing to the bundle for anyone running local-only.
//
// AUTH IS NOT THIS FILE'S JOB. Magic links, OAuth redirects and refresh rotation are genuinely hard and
// are exactly what @supabase/supabase-js is good at, so they sit behind the `auth` interface:
//
//   auth.getAccessToken() -> Promise<string>   the current user's JWT
//   auth.getCompanyId()   -> Promise<string>   which company's document to read/write
//
// Every write goes through the save_document RPC rather than a bare PATCH. That is what makes the
// version precondition and the schema-skew refusal unskippable: there is no code path here that can
// blind-write over a newer document, because this file cannot issue one.

import {
  BackendError, ERR_COMPANY_DELETED, ERR_CONFLICT, ERR_FORBIDDEN, ERR_NO_SEAT, ERR_PAYMENT_REQUIRED, ERR_PROJECT_CONFLICT,
  ERR_STALE_CLIENT, ERR_UNREACHABLE,
} from "./errors.js";
import { assembleFromStorage, stableStringify } from "../sections.js";
import { reportError } from "../errors.js";

// PostgREST surfaces a raised exception's SQLSTATE, which is how the RPC's three refusals are told
// apart from an ordinary failure. The message is a fallback for gateways that drop the code.
function classify(status, payload) {
  const code = payload?.code || "";
  const msg = String(payload?.message || "");
  // FIRST, because the generic conflict branch below matches on the SUBSTRING "conflict" and
  // "project_conflict" contains it. Every other specific check in this function sits above the generic
  // one it would lose to; this one has to sit above the very first line, which is where the general
  // case happens to live. A loose substring fallback is only safe while nothing more specific shares
  // the word.
  if (code === "P0018" || msg.includes("project_conflict")) return ERR_PROJECT_CONFLICT;
  if (code === "P0002" || msg.includes("conflict")) return ERR_CONFLICT;
  if (code === "P0001" || msg.includes("stale_client")) return ERR_STALE_CLIENT;
  // Checked BEFORE the 403 branch: PostgREST reports a raised exception as 400 with the SQLSTATE, but
  // a gateway that drops the code would otherwise land this on forbidden and tell somebody they lack
  // permission when what they lack is a subscription.
  if (code === "P0003" || msg.includes("payment_required")) return ERR_PAYMENT_REQUIRED;
  // Also before the 403 branch, and for the same reason: `can_edit` refuses a deleted company too, so
  // without this the specific answer loses to the generic one.
  if (code === "P0004" || msg.includes("company_deleted")) return ERR_COMPANY_DELETED;
  // Also above the 403 branch: the seat check sits behind `can_edit`, so a generic permission mapping
  // would swallow the specific answer exactly as it did for a deleted company.
  if (code === "P0013" || msg.includes("no_seat")) return ERR_NO_SEAT;
  if (code === "42501" || status === 401 || status === 403) return ERR_FORBIDDEN;
  return ERR_UNREACHABLE;
}

async function body(res) {
  try { return await res.json(); } catch { return null; }
}

export const HOSTED_SAVE_DEBOUNCE_MS = 2500;

export function createSupabaseBackend({ url, anonKey, auth, fetchImpl }) {
  if (!url || !anonKey) throw new Error("Supabase backend needs a url and an anon key");
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(url).replace(/\/+$/, "");

  // The version this client last saw. It is the precondition on every write: if the row has moved on,
  // the RPC refuses rather than overwriting whatever the other device wrote.
  let version = null;
  let projectVersions = null;
  let loadedProjects = null;

  /** Which projects this client changed since it loaded, by id.
   *
   *  Null when there is nothing to compare against — a fresh company, or the second write after a load
   *  — and null means "treat everything as changed", which is the older, noisier, still-safe behaviour
   *  rather than a claim nothing moved. */
  const changedProjects = (raw) => {
    if (!loadedProjects) return null;
    const out = [];
    for (const p of raw?.projects || []) {
      if (!p?.id) continue;
      const before = loadedProjects.get(p.id);
      if (before === undefined || before !== stableStringify(p)) out.push(p.id);
    }
    return out;
  };

  async function headers() {
    const token = await auth.getAccessToken();
    return {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function call(path, init) {
    let res;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch (e) {
      // Offline, DNS, TLS — never let this look like "there is no document".
      throw new BackendError(ERR_UNREACHABLE, "Could not reach the server", e);
    }
    if (!res.ok) {
      const payload = await body(res);
      throw new BackendError(classify(res.status, payload), payload?.message || `HTTP ${res.status}`, payload);
    }
    return body(res);
  }

  return {
    name: "supabase",
    // 2500, not the local 400. A save here is a 40-300KB body over a network, and at 400ms a person
    // typing a project name generates one per keystroke pause. The cost is that up to 2.5s of work
    // sits only in memory — bounded by MAX_UNSAVED_MS during a continuous stream, and by the flush on
    // pagehide when a tab closes, so the real exposure is a browser dying mid-sentence.
    saveDebounceMs: HOSTED_SAVE_DEBOUNCE_MS,

    async read() {
      const companyId = await auth.getCompanyId();
      // ONE RPC, NOT TWO READS (migration 036). Fetching the blob and then the project rows separately
      // puts a save in between them — the document from one moment and its projects from another,
      // assembled into a model nobody ever had. One statement is one snapshot of the database.
      const rows = await call(`/rest/v1/rpc/load_document`, {
        method: "POST", headers: await headers(),
        body: JSON.stringify({ p_company_id: companyId }),
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row || row.body == null) {
        version = null;
        projectVersions = null;
        loadedProjects = null;
        return null;                       // no document yet — a new company, not a failure
      }
      version = row.version ?? null;
      // WHAT THIS CLIENT LOADED, sent back on the next write so each project's precondition can be
      // checked on its own. Without it the server cannot tell an edit to a stale project from an edit
      // to a fresh one, and cannot tell a project the client never saw from one it deleted.
      projectVersions = row.project_versions ?? {};
      // WHAT EACH PROJECT LOOKED LIKE WHEN IT ARRIVED, so the next write can say which ones this
      // client actually changed. Without it the server sees every project in the payload as an edit —
      // including stale copies of ones somebody else moved on — and conflicts on projects the person
      // never opened.
      loadedProjects = new Map(
        (row.projects || []).filter(p => p?.id).map(p => [p.id, stableStringify(p)]));

      // STAGE 3 SAFETY NET. The blob still carries `projects`, so empty rows beside a non-empty blob
      // means something is wrong rather than that there are no projects — a backfill that never ran,
      // a failed sync, a restore from before the split. Falling back is not optional: taking the empty
      // rows would delete every project from somebody's model, on load, with no error anywhere.
      const raw = assembleFromStorage(row.body, { projects: row.projects }, {
        onFallback: ({ collection, inBlob }) => {
          // `reportError` FROM state/errors.js, imported explicitly. Calling it bare would have hit
          // the BROWSER GLOBAL of the same name — a real Web API that reports to the platform's error
          // handler and never reaches Sentry. `no-undef` cannot catch that, because the global exists.
          reportError(new Error(
            `[storage] ${collection}: 0 rows but ${inBlob} in the document body — using the body. ` +
            "project_docs is behind for this company."
          ), { kind: "section_fallback", companyId, collection, inBlob });
        },
      });

      return { raw, meta: { version, schemaVersion: row.schema_version } };
    },

    async write(raw) {
      const companyId = await auth.getCompanyId();
      const out = await call(`/rest/v1/rpc/save_document`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          p_company_id: companyId,
          p_schema_version: raw.schemaVersion,
          p_body: raw,
          p_base_version: version,
          p_known_projects: projectVersions,
          p_changed_projects: changedProjects(raw),
        }),
      });
      // The RPC returns a single row: the new version and when it landed.
      const row = Array.isArray(out) ? out[0] : out;
      version = row?.out_version ?? row?.version ?? version;

      // WHAT SOMEBODY ELSE CHANGED WHILE THIS CLIENT HELD ITS COPY. Per-project concurrency means those
      // edits no longer collide — which is the point, and which also means nothing would otherwise tell
      // this person about them. The conflict that used to obstruct was also, accidentally, the
      // notification.
      //
      // The versions are adopted immediately so the NEXT write is checked against reality rather than
      // against a copy known to be behind; the bodies are handed up, because deciding whether to load
      // somebody else's version is the person's call and not this layer's.
      const stale = row?.out_stale_projects ?? null;

      // THE VERSIONS THIS WRITE PRODUCED, merged into the map already held. Projects it did not write
      // keep the version THIS CLIENT'S COPY IS BASED ON — which is what makes a later edit to a stale
      // project raise a conflict instead of silently winning.
      //
      // The stale versions are deliberately NOT adopted. Doing so would say "my copy is based on their
      // version" about a copy this client has never seen, and the next edit to that project would
      // overwrite them with no conflict and no question asked. That was the bug.
      const wrote = row?.out_project_versions ?? null;
      if (wrote) projectVersions = { ...(projectVersions || {}), ...wrote };
      // The rows this write created or bumped are now at versions this client does not know. Rather
      // than guess them, forget them: the next write with a stale map is refused by name, and the next
      // LOAD repopulates it. Guessing would be inventing a precondition nobody checked.
      // WHAT THIS CLIENT NOW BELIEVES IS STORED, for the projects it just wrote. Everything else keeps
      // its earlier baseline, so an untouched project is still untouched next time.
      //
      // NEITHER MAP IS EVER SET TO NULL AGAIN. Null does not mean "check nothing" — on the server it
      // means the pre-040 behaviour: no version checks and every project treated as changed. Clearing
      // them after a write is what let a second save overwrite somebody else's project.
      if (loadedProjects && Array.isArray(raw?.projects)) {
        for (const pr of raw.projects) {
          if (pr?.id && wrote && pr.id in wrote) loadedProjects.set(pr.id, stableStringify(pr));
        }
      }
      return { meta: { version, staleProjects: stale && Object.keys(stale).length ? stale : null } };
    },

    // Nothing to park: a document the client cannot read is still intact on the server, and
    // document_versions holds every predecessor regardless.
    async park() {},

    // Exposed so a conflict resolution can adopt the server's version before rewriting.
    _setVersion(v) { version = v; },
    _version() { return version; },
  };
}
