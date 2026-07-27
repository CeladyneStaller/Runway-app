// VERSION RETENTION CHECKS.
//
// `document_versions` used to grow without bound: a full ~20 KB copy of the document on every
// debounced save, never deleted. 005_version_retention.sql added a keep-window and a coalescing
// window. Neither can be verified by reading the migration — a function can be replaced by a later
// migration, applied to the wrong project, or simply never run.
//
// Like the isolation checks, this drives the real API and asserts on what the database actually did.
// Pure function of an injected client so it can be unit-tested without a network.
//
// IT WRITES. Run it against a staging project or a throwaway company: it saves the document many
// times to force the bound, and leaves the last body in place.

/** Save the same document `n` times in a row, returning the final version token. */
async function hammer(client, token, companyId, n, bodyOf) {
  let version = null;
  for (let i = 0; i < n; i++) {
    const r = await client.rpc("save_document", {
      p_company_id: companyId,
      p_schema_version: 3,
      p_body: bodyOf(i),
      p_base_version: version,
    }, token);
    if (!r.ok) throw new Error(`save ${i} failed: ${JSON.stringify(r.body)}`);
    const row = Array.isArray(r.body) ? r.body[0] : r.body;
    version = row?.out_version ?? null;
  }
  return version;
}

export async function runRetentionChecks({ client, user, companyId, keep = 20 }) {
  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); return pass; };

  const token = await client.signIn(user.email, user.password);

  // A body big enough to be representative, so a pass here means something about real documents.
  const bodyOf = (i) => ({ schemaVersion: 3, cash: 100000 + i, _pad: "x".repeat(4000) });

  const countVersions = async () => {
    const r = await client.get(
      `/rest/v1/document_versions?select=version&order=version.desc`, token);
    return Array.isArray(r.body) ? r.body.length : null;
  };

  const before = await countVersions();
  check("can read version history at all", before !== null,
        before === null ? "no rows returned — is the grant missing?" : `${before} rows`);

  await hammer(client, token, companyId, keep + 12, bodyOf);

  // THE INVARIANT, asserted as an upper bound.
  //
  // BE CLEAR ABOUT WHAT A SHORT RUN CAN PROVE. Coalescing and retention fight each other here: to
  // exercise the keep window you need more than N snapshots, and coalescing is what stops a burst
  // from producing them. On a FRESH project this assertion is close to vacuous — you cannot make 21
  // snapshots in a minute, by design. On a project with real history it is the real thing.
  //
  // The failure it does catch reliably is the one that matters: NO MIGRATION APPLIED AT ALL. Without
  // it every save snapshots, so `keep + 12` saves produce `keep + 12` rows and this fails immediately,
  // as does the coalescing check below.
  const after = await countVersions();
  check("history stays inside the keep window", after !== null && after <= keep,
        `${after} rows, limit ${keep}`);

  // COALESCING. WHICH SIGNAL IS VALID DEPENDS ON WHETHER THE TABLE IS AT ITS CAP, and the first
  // version of this check got that wrong in the most embarrassing direction: it demanded at least
  // three snapshots to compare version numbers, so a project where coalescing worked PERFECTLY — 40
  // saves producing one snapshot — failed for having too few rows to inspect. It failed on the best
  // possible outcome.
  //
  //   BELOW THE CAP, the row count is meaningful: a burst that adds one row or none has coalesced,
  //     and a burst that adds ten has not.
  //   AT THE CAP, the count cannot move at all — ten rows inserted and ten pruned leaves twenty —
  //     so the VERSION NUMBERS are the only tell. `documents.version` increments on every save, so
  //     snapshots taken on consecutive saves carry consecutive numbers and coalesced ones are sparse.
  const pre = await countVersions();
  await hammer(client, token, companyId, 10, (i) => bodyOf(1000 + i));
  const post = await countVersions();

  const top = await client.get(
    `/rest/v1/document_versions?select=version&order=version.desc&limit=5`, token);
  const vs = (Array.isArray(top.body) ? top.body : []).map(x => Number(x.version));
  const consecutive = vs.length >= 3 && vs.every((v, i) => i === 0 || vs[i - 1] - v === 1);

  const atCap = post >= keep;
  check("a burst of saves does not snapshot each time",
        atCap ? (vs.length >= 3 && !consecutive) : (post - pre <= 1),
        atCap ? `at the ${keep}-row cap; newest versions ${vs.join(", ")}`
              : `${pre} -> ${post} rows across 10 saves`);

  // The live document must still be correct after all that.
  const doc = await client.get(
    `/rest/v1/documents?select=body,version&company_id=eq.${companyId}`, token);
  const live = Array.isArray(doc.body) ? doc.body[0] : null;
  check("the current document is still the last thing written",
        live?.body?.cash === 100000 + 1009,
        `cash=${live?.body?.cash}`);

  return { pass: results.every(r => r.pass), results };
}
