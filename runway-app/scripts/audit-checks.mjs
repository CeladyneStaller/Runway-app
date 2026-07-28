// Audit-log checks against a REAL Supabase project.
//
// The assertions that matter here are the NEGATIVE ones. An audit log's worth is not that it records
// things — any table records things — but that nobody who is audited can change what it says. So
// "cannot insert", "cannot update" and "cannot delete" are the checks that must never regress, and
// they run against the same authenticated client a real user has.
//
// Same shape as `retention-checks.mjs`: a pure module returning results, so the runner and a test can
// both use it, and neither owns the exit code.

export async function runAuditChecks({ client, user }) {
  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail: detail ?? "" }); };

  const token = await client.signIn(user.email, user.password);

  // A throwaway company, so nothing here touches real data.
  const name = `audit probe ${Date.now()}`;
  const made = await client.rpc("create_company", { p_name: name }, token);
  const companyId = typeof made.body === "string" ? made.body : made.body?.[0];
  check("create_company returns an id", !!companyId, `status ${made.status}`);
  if (!companyId) return { pass: false, results };

  await client.rpc("rename_company", { p_company_id: companyId, p_name: `${name} renamed` }, token);

  const rows = await client.get(
    `/rest/v1/audit_log?company_id=eq.${companyId}&select=action,detail&order=id.asc`, token);
  const actions = (rows.body ?? []).map(r => r.action);
  check("company.create is logged", actions.includes("company.create"), actions.join(", "));
  check("company.rename is logged", actions.includes("company.rename"), actions.join(", "));

  const renamed = (rows.body ?? []).find(r => r.action === "company.rename");
  check("the rename records both names",
    renamed?.detail?.from === name && renamed?.detail?.to === `${name} renamed`,
    JSON.stringify(renamed?.detail ?? null));

  // A rename to the same string is not an event.
  await client.rpc("rename_company", { p_company_id: companyId, p_name: `${name} renamed` }, token);
  const again = await client.get(
    `/rest/v1/audit_log?company_id=eq.${companyId}&action=eq.company.rename&select=id`, token);
  check("a no-op rename logs nothing", (again.body ?? []).length === 1,
    `${(again.body ?? []).length} rename rows`);

  // ---- THE ONES THAT MATTER: the log cannot be edited by the audited ---------
  const forged = await client.request("/rest/v1/audit_log", {
    method: "POST",
    body: { company_id: companyId, action: "company.create", detail: { name: "forged" } },
  }, token);
  check("a client CANNOT insert an audit row", forged.status >= 400, `status ${forged.status}`);

  const edited = await client.request(`/rest/v1/audit_log?company_id=eq.${companyId}`, {
    method: "PATCH", body: { action: "something.else" },
  }, token);
  check("a client CANNOT update an audit row", edited.status >= 400, `status ${edited.status}`);

  const wiped = await client.request(`/rest/v1/audit_log?company_id=eq.${companyId}`, {
    method: "DELETE",
  }, token);
  check("a client CANNOT delete an audit row", wiped.status >= 400, `status ${wiped.status}`);

  // ---- the deletion record outlives the thing it describes -------------------
  await client.rpc("delete_company", { p_company_id: companyId }, token);
  const after = await client.get(
    "/rest/v1/audit_log?action=eq.company.delete&select=company_id,detail&order=id.desc&limit=10", token);
  const mine = (after.body ?? []).find(r => r.detail?.company_id === companyId);
  check("company.delete is still readable after the company is gone", !!mine,
    "found via the own-actions clause in the policy");
  check("and its company_id was emptied by the cascade, leaving detail as the only identity",
    mine ? mine.company_id === null : false,
    mine ? `company_id=${mine.company_id}` : "row not found");

  return { pass: results.every(r => r.pass), results };
}
