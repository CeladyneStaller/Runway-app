# Layer 2 — withholding data from advisors

**Status:** not built. This document exists so it can be built later without rediscovering why it is
shaped this way.

**The one-line summary:** an advisor's browser currently receives the entire model. Making a field
genuinely private means the *server* must not send it, which means the field must first stop living
inside a JSON blob the server sends whole.

---

## 1 · Why Layer 1 is not enough

`load_document` returns `body` — one JSONB blob — plus `projects` as rows. Everything else is in the
blob: `employees`, `cash`, `rounds`, `saas`, `history`, `milestones`.

An advisor with any access at all gets that blob. Hiding the Payroll tab in the browser hides the tab.
The salaries are in the payload, visible in dev-tools, in the network panel, in an export.

**So Layer 1 is focus and must be labelled as focus.** The failure mode is not that Layer 1 is weak —
it is that a user believing it is strong never asks for the feature that would be.

---

## 2 · What people actually want hidden

Worth confirming with a real customer before building any of it. My expectation, in order:

1. **Individual salaries** — near-universal. An outside CFO needs total payroll; they rarely need to
   know what the CTO earns, and the founder often cannot share it.
2. **Cap table and ownership** — occasional, usually where the advisor is close to an investor.
3. **Customer names** — rare, and usually a competitive concern rather than a privacy one.

Nobody asks to hide the milestone list. **Build for salaries first**; everything else is the same
machinery applied to a different collection.

---

## 3 · The shape of the fix

### 3.1 · Move `employees` out of the blob

Exactly what migration 034 did for `projects`, and the reason that pattern is already proven here.

```
employee_docs (
  company_id  uuid    not null references companies(id) on delete cascade,
  employee_id text    not null,
  position    int     not null,
  body        jsonb   not null,
  version     int     not null default 1,
  snapshot_id uuid    references document_snapshots(id),
  primary key (company_id, employee_id)
)
```

`src/state/sections.js` already has the seam. It becomes:

```js
export const COLLECTIONS = Object.freeze([
  { key: "projects",  table: "project_docs",  idOf: (i) => i?.id },
  { key: "employees", table: "employee_docs", idOf: (i) => i?.id },
]);
```

**Everything the projects split learned applies again**, and skipping any of it will reproduce the same
bugs:

- A **dual-write stage** before the blob stops carrying `employees`, with a fallback that reports via
  `reportError` when rows are empty but the blob has data. That safety net stayed until
  `documents_still_carrying_projects()` returned 0, and the equivalent is needed here.
- **Per-employee concurrency**, or two people editing different employees will conflict. Migrations
  038–042 were four attempts at this for projects; reuse `p_changed_*` rather than rebuild it.
- **`out_project_versions` has an exact analogue.** The bug where the server did not return written
  versions, the client set the map to null, and the next save deleted anything not in the body — that
  was data loss, and the same code path exists for any new collection.

⚠️ **Employees are referenced by id elsewhere.** `codeMap` and `customerMap` values are project ids or
the `"overhead"` sentinel; check whether anything holds an *employee* id before assuming the split is
as clean as projects was.

### 3.2 · `load_document` becomes role-aware

One function, two shapes. A second read path is how two answers to "what is payroll" get created.

```sql
create or replace function load_document(p_company_id uuid)
returns table (...)
language plpgsql security definer as $$
declare
  v_role text;
  v_private text[];
begin
  select role, coalesce(private_from_advisors, '{}')
    into v_role, v_private
    from memberships m join companies c on c.id = m.company_id
   where m.company_id = p_company_id and m.user_id = auth.uid();

  -- The aggregate is ALWAYS returned. Without it the runway cannot be computed, and an advisor who
  -- cannot see a runway is not an advisor.
  ...
end $$;
```

For an advisor with `salaries` private, `employees` comes back as **one synthetic row**:

```json
{ "id": "__aggregate__", "count": 9, "monthlyTotal": 45600, "byMonth": [45600, 45600, 51200, ...] }
```

**`byMonth` is not optional.** Payroll changes when people start and leave, and a single total would
make every projection wrong from the first hire onward. The aggregate has to carry the same shape the
projection consumes, which is a series.

### 3.3 · The engine accepts an aggregate

This is where the risk is. `buildModelParts` builds `employeeLines` by iterating `doc.employees`, and
several places downstream assume one line per person.

```js
// engine/buildmodel.js
const AGGREGATE = "__aggregate__";

export function employeeLines(doc) {
  const emp = doc.employees || [];
  const agg = emp.find(e => e.id === AGGREGATE);
  if (agg) {
    // ONE LINE STANDING FOR ALL OF THEM. `isPayroll` keeps the burn split correct; the label is
    // deliberately plain, because "Payroll (9 people)" is the honest description of what this is.
    return [{
      label: `Payroll · ${agg.count} people`,
      cadence: "recurring", kind: "cost", isPayroll: true,
      amounts: agg.byMonth, aggregate: true,
    }];
  }
  return emp.map(/* … as today … */);
}
```

**Consumers that need auditing**, because each currently assumes per-person lines:

| Consumer | What breaks | Fix |
|---|---|---|
| `Payroll.jsx` | Renders a row per person | Tab is focused off anyway; guard with `aggregate` and say so |
| `labor.js` prioritisation | Ranks individuals to cut | Cannot work on an aggregate. Hide the feature, do not fake it |
| `pay.allocation` chart | Charged vs uncharged per person | Aggregate has no allocation; omit the chart |
| `alerts.js` `unallocatedStaff` | Per-person allocation | Returns null when aggregate |
| `advisorTiles` `payTile` | `payrollNow` / `derivedBurn` | **Already works** — both are totals |
| `runwayMonths`, `zeroInfo`, golden | Sum of lines | **Unaffected**, and the golden test proves it |

**The golden number must not move.** An owner and an advisor computing different runways for the same
company is the failure that makes the whole feature worthless. A test should assert:
`runway(ownerDoc) === runway(advisorDoc)` for the same company, to one decimal.

### 3.4 · Prove it with RLS, not with a claim

```js
it("sends an advisor no salary, ever", async () => {
  const asAdvisor = await signInAs("dana@sharpecfo.com");
  const doc = await asAdvisor.rpc("load_document", { p_company_id: CELADYNE });
  const json = JSON.stringify(doc);
  expect(json).not.toMatch(/Alex Rivera/);
  expect(json).not.toMatch(/18200/);              // a known individual salary
  expect(doc.employees).toHaveLength(1);
  expect(doc.employees[0].id).toBe("__aggregate__");
});
```

**Run against a real project, not a mock.** `qbo-sync` reading over PostgREST without a `service_role`
grant produced a permission error that looked exactly like missing data — a mock would have passed. And
an audit log existed from migration 001 and never wrote a row until somebody checked; a control nobody
verifies is a control that is not there.

---

## 4 · Owner-side storage

```sql
alter table companies
  add column private_from_advisors text[] not null default '{}';
```

Values: `salaries`, `captable`, `customers`. A company-wide setting rather than per-advisor —
**deliberately**. "This advisor may see salaries but that one may not" is a policy most owners cannot
articulate and will get wrong, and it multiplies the shapes `load_document` must return by the number
of advisors.

Per-advisor *focus* stays per-advisor. Per-company *confidentiality* stays per-company. They are
different questions and conflating them is what makes permission systems unusable.

---

## 5 · Order of work

1. `employee_docs` + dual write + fallback net. **Ships alone, changes nothing visible.**
2. Flip the read path; leave the blob writing until `documents_still_carrying_employees()` is 0.
3. Per-employee concurrency, reusing the projects machinery.
4. `private_from_advisors` column and the owner's settings UI.
5. Role-aware `load_document` returning the aggregate.
6. Engine `aggregate` handling and the consumer audit above.
7. The RLS test, against a real project.

**Steps 1–3 are the bulk and carry all the data-loss risk.** They are also independently useful: the
document gets smaller for everybody and employee edits stop conflicting.

---

## 6 · What would make me not build this

Worth writing down while it is cheap to change your mind:

- **If no customer has asked.** This is roughly the size of the document split — four migrations and a
  concurrency fix — and it changes the engine's payroll contract.
- **If the ask is really "don't clutter my advisor's view".** That is Layer 1 and it is a day's work.
- **If the advisor is a firm rather than a person.** A firm that cannot be shown salaries is a firm that
  cannot do payroll planning, and the honest answer may be a narrower engagement rather than a narrower
  UI.

**What would make me build it immediately:** a named prospect declining to sign because their salary
data would leave their control. That is the only evidence that justifies this much machinery, and it is
also the evidence that tells you which fields matter.
