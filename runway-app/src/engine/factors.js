import { scenarioRound } from "./scenario.js";
// ── The eight buckets, as a scenario vocabulary ──────────────────────────────────────────────────
//
// THE OLD BUILDER ASKED SOMEBODY TO NAME A MECHANISM. "Add an item to `rounds`" is a sentence about the
// data model; "Delay a hire" is one of seven hardcoded intents that could not express the eighth thing
// anybody wanted. THE FACTORS ARE THE BUCKETS THE RUNWAY IS MADE OF, so a scenario built from them is
// expressed in the same terms as the number it moves.
//
// ONE REGISTRY, so the scenario form and the real editor cannot diverge into a scenario that produces a
// document the editor cannot open.

export const FACTORS = [
  {
    id: "pay", name: "Payroll", blurb: "Hires, departures, salary changes",
    collection: "employees", count: (d) => (d.employees || []).length,
    label: (e) => `${e.name || "Unnamed"} — ${e.salary ? `$${Math.round(e.salary / 1000)}k` : "no salary"}`,
    fields: [
      { k: "name", t: "text", l: "Who" },
      { k: "amount", t: "number", l: "Salary" },
      { k: "start", t: "month", l: "Starts" },
      { k: "end", t: "month", l: "Ends" },
    ],
    // ⚠️ AN EMPLOYEE CAN END. Removing one "from a date" is a departure, which the model already
    // expresses as an end month — so it is a field edit, not a deletion.
    endField: "end",
  },
  {
    id: "cost", name: "Operating costs", blurb: "Rent, software, insurance",
    collection: "lines", count: (d) => (d.lines || []).length,
    label: (l) => `${l.label || "Untitled"} — ${l.amount ? `$${Math.round(l.amount).toLocaleString()}` : "—"}${l.cadence === "recurring" ? "/mo" : ""}`,
    fields: [
      { k: "label", t: "text", l: "What" },
      { k: "amount", t: "number", l: "Amount" },
      { k: "start", t: "month", l: "Starts" },
      { k: "end", t: "month", l: "Ends" },
    ],
    endField: "end",
  },
  {
    id: "proj", name: "Projects & grants", blurb: "Awards, spend, drawdowns",
    collection: "projects", count: (d) => (d.projects || []).length,
    label: (p) => `${p.name || "Untitled"}${p.type === "grant" ? " — grant" : ""}`,
    fields: [{ k: "name", t: "text", l: "Name" }, { k: "budget", t: "number", l: "Budget" }],
    endField: "end",
    // ⚠️ REMOVING A PROJECT REMOVES WHAT IT PRODUCES — spend, drawdowns, cost share and allocated
    // payroll. Four of the eight factors move from one selection, and the panel says so first.
    warn: "Its spend, drawdowns, cost share and allocated payroll all go with it.",
  },
  {
    id: "sales", name: "Sales orders", blurb: "Customer POs and delivery",
    collection: "pos", count: (d) => (d.pos || []).length,
    label: (p) => `${p.customer || p.name || "Order"} — ${p.amount ? `$${Math.round(p.amount).toLocaleString()}` : "—"}`,
    fields: [{ k: "customer", t: "text", l: "Customer" }, { k: "amount", t: "number", l: "Amount" },
             { k: "deliveryMonth", t: "month", l: "Delivers" },
             { k: "confidence", t: "tier", l: "Confidence" }],
  },
  {
    id: "cap", name: "Capital", blurb: "Rounds, SAFEs, notes, debt",
    collection: "rounds", count: (d) => (d.rounds || []).length,
    make: (it) => scenarioRound(it),
    label: (r) => `${r.name || "Instrument"} — $${Math.round((r.amount || 0) / 1000)}k, ${r.status || "planning"}`,
    fields: [
      { k: "name", t: "text", l: "Name" },
      { k: "amount", t: "number", l: "Amount", required: true },
      { k: "closeMonth", t: "month", l: "Close month" },
      // THE HIGHEST-LEVERAGE EDIT IN THE APP. Status decides an instrument's confidence tier, which
      // decides whether it counts at all — "what if the Series A actually lands" is the scenario
      // founders run most, and it used to take four steps.
      { k: "kind", t: "select", l: "Type",
        // NO DEBT. A facility without terms is money that arrives and never leaves, which flatters the
        // runway in the one direction a founder must not be flattered. Add it on the Investment tab,
        // where the terms can be given.
        opts: [["safe", "SAFE"], ["equity", "Priced round"], ["note", "Convertible note"]] },
      { k: "status", t: "select", l: "Status",
        // NO "CLOSED" WHEN ADDING. A closed round emits no cash line — the money is assumed to be in
        // the opening balance already — so a scenario that adds one shows no change and looks broken.
        // It stays available when CHANGING an existing instrument, where it is the whole point.
        // ⚠️ MOST LIKELY FIRST, not chronological. Somebody adding a round to a scenario is usually
        // asking "what if this lands" — so the default the select opens on should be the one that
        // moves the number, not the one that moves it least. The old form had this ordering and the
        // registry lost it by listing the stages in lifecycle order.
        opts: [["committed", "Commitment letter"], ["raising", "Raising"], ["planning", "Planning"]],
        editOpts: [["committed", "Commitment letter"], ["raising", "Raising"],
                   ["planning", "Planning"], ["closed", "Closed"]] },
    ],
    // ⚠️ A CLOSED INSTRUMENT CANNOT BE UN-RECEIVED. Removing one "from a date" is meaningless — the
    // money is in the bank — so the option is offered only where it means something.
    endField: "closeMonth",
    noDateRemoval: (r) => r.status === "closed",
    noDateWhy: "It has closed — that money is already in the bank.",
  },
  {
    id: "saas", name: "Recurring revenue", blurb: "Subscriptions, growth, churn",
    collection: "saas", count: (d) => (d.saas || []).length,
    // ⚠️ THE REAL FIELD NAMES, read from `saas.js`. I invented `customers`, `price`, `growth` and
    // `churn` from what the UI shows; the engine reads `startCustomers`, `arpu`, `newGrowthPct` and
    // `churnPct`. A patch on an invented key writes a field NOTHING CONSUMES — the scenario would have
    // saved, applied, and moved no number, which is indistinguishable from the feature being broken.
    label: (s) => `${s.name || "Product"} — ${s.startCustomers || 0} customers`,
    fields: [{ k: "name", t: "text", l: "Product" },
             { k: "arpu", t: "number", l: "ARPU" },
             { k: "startCustomers", t: "number", l: "Customers" },
             { k: "newPerMonth", t: "number", l: "New per month" },
             { k: "churnPct", t: "number", l: "Churn" },
             { k: "newGrowthPct", t: "number", l: "Growth" }],
  },
  {
    // ⚠️ SHOWN AND DISABLED, NOT HIDDEN. It is one of the eight and somebody looking for it should find
    // out WHY they cannot change it — it is measured burn minus what you have itemised, so the way to
    // move it is to itemise more. A missing tile is a question; a disabled one with a reason is an
    // answer.
    id: "base", name: "Baseline burn", blurb: "Measured, not itemised",
    disabled: true, why: "Derived from your spend history minus everything itemised. Itemise more to move it.",
  },
  {
    id: "idx", name: "Indexed obligations", blurb: "Royalties, matches, profit shares",
    collection: "commitments", count: (d) => (d.commitments || []).filter(c => c.flavor === "indexed").length,
    label: (c) => `${c.label || "Obligation"} — ${Math.round((c.index?.pct || 0) * 100)}% of ${c.index?.of || "revenue"}`,
    only: (c) => c.flavor === "indexed",
    fields: [{ k: "label", t: "text", l: "What" }],
  },
  // NOT BUCKETS — the opening balance and a filter. Here because they are the two most common things
  // anybody changes, and sending somebody elsewhere to change them would be a purity that costs use.
  // ⚠️ THESE NEED `fields` TOO. The form renders from `factor.fields`, so a factor without them showed
  // a tile that selected and then offered nothing — a dead end where the two most common changes live.
  { id: "cash", name: "Cash on hand", blurb: "The opening balance", field: "cash", kind: "field",
    fields: [{ k: "cash", t: "number", l: "Cash on hand" }] },
  { id: "conf", name: "Confidence", blurb: "Which tiers count", kind: "toggle",
    fields: [{ k: "committed", t: "bool", l: "Committed" }, { k: "expected", t: "bool", l: "Expected" },
             { k: "speculative", t: "bool", l: "Speculative" },
             { k: "financing", t: "bool", l: "Financing" }] },
];

export const factorById = (id) => FACTORS.find(f => f.id === id) || null;

/** The existing items a factor can edit or remove. */
export function itemsOf(factor, doc) {
  if (!factor?.collection) return [];
  const all = doc?.[factor.collection] || [];
  return (factor.only ? all.filter(factor.only) : all)
    .map(it => ({ id: it.id, label: factor.label ? factor.label(it) : (it.name || it.label || it.id), raw: it }));
}

/** Can this item be removed FROM A DATE, or only entirely? */
export function dateRemovable(factor, item) {
  if (!factor) return { ok: false, why: "This can only be removed entirely." };
  // ⚠️ THE INSTRUMENT-SPECIFIC REFUSAL RUNS FIRST. Capital has no `end` field, but "remove from a date"
  // still means something for an instrument that has NOT closed — it stops before it arrives. Checking
  // `endField` first refused the whole factor and never reached the reason worth giving.
  if (factor.noDateRemoval) {
    return factor.noDateRemoval(item) ? { ok: false, why: factor.noDateWhy } : { ok: true };
  }
  if (!factor.endField) return { ok: false, why: "This can only be removed entirely." };
  return { ok: true };
}

// ── building a patch from a factor choice ────────────────────────────────────────────────────────

const num = (v) => (v === "" || v == null ? null : Number(v));

/** The patches a factor + mode + values produce.
 *
 *  ONE PLACE, so the form and the engine cannot disagree about what a tile means. The form collects
 *  values; this decides what they patch.
 */
export function buildPatches(factor, { mode, targetId, values = {}, until = null }, doc) {
  if (!factor || factor.disabled) return [];

  // Cash is a top-level field; confidence is a set of toggles. Neither is a collection.
  if (factor.kind === "field") {
    const v = num(values[factor.field]);
    return v == null ? [] : [{ kind: "field", path: factor.field, value: v }];
  }
  if (factor.kind === "toggle") {
    return Object.entries(values)
      .filter(([, v]) => v !== "" && v != null)
      .map(([path, v]) => ({ kind: "toggle", path, value: v === true || v === "true" }));
  }

  if (mode === "add") {
    // A REQUIRED FIELD MUST CARRY A VALUE. Without this, entering only a name enables "Add this
    // change" and produces a patch that moves no number.
    for (const f of factor.fields || []) {
      if (f.required && !(Number(values[f.k]) > 0)) return [];
    }
    const item = { id: `scn_${Math.random().toString(36).slice(2, 9)}` };
    for (const f of factor.fields || []) {
      const raw = values[f.k];
      if (raw === "" || raw == null) continue;
      item[f.k] = (f.t === "number" || f.t === "month") ? Number(raw) : raw;
    }
    if (Object.keys(item).length <= 1) return [];
    // ⚠️ A ROUND NEEDS MORE THAN ITS TYPED FIELDS. `scenarioRound` fills in `capType`, `confAuto` and
    // `goals` — without them the instrument compiles to nothing and the scenario shows "no change",
    // which reads as the feature being broken rather than as a missing default. The factor may name a
    // `make` to build its item properly; a generic object is only correct where there is nothing to
    // derive.
    const out = [{ kind: "add", collection: factor.collection,
                   item: factor.make ? factor.make(item) : item }];

    // ⚠️ FINANCING IS A SEPARATE AXIS FROM THE CONFIDENCE TIERS. A scenario that adds a round and
    // nothing else shows NO CHANGE WHATSOEVER at any status when the toggle is off — somebody asking
    // "what if we raise" plainly means the money to arrive. Emitted as its OWN visible change rather
    // than folded into the round, so the reason the number moved is on screen and can be taken back
    // off. This was in the old fundraise form and would have been lost with it.
    if (factor.collection === "rounds" && doc?.settings?.toggles?.financing === false) {
      out.push({ kind: "toggle", path: "financing", value: true });
    }
    return out;
  }

  if (!targetId) return [];

  if (mode === "edit") {
    // ONE PATCH PER CHANGED FIELD, not one carrying an object. The change list reads a patch at a time
    // and a founder should see "status → committed" and "closes → month 9" as two things they did.
    return (factor.fields || [])
      .filter(f => values[f.k] !== "" && values[f.k] != null)
      .map(f => ({ kind: "item", collection: factor.collection, id: targetId, field: f.k,
                   value: (f.t === "number" || f.t === "month") ? Number(values[f.k]) : values[f.k] }));
  }

  if (mode === "del") {
    // ⚠️ REMOVAL FROM A DATE IS AN EDIT, NOT A DELETION. Setting the item's end month leaves everything
    // it produced up to that point intact — which is the point. A deletion that wiped the accrued cost
    // share would flatter every scenario built this way, in the direction founders least need it.
    if (until != null && factor.endField) {
      return [{ kind: "item", collection: factor.collection, id: targetId,
                field: factor.endField, value: Number(until) }];
    }
    return [{ kind: "remove", collection: factor.collection, id: targetId }];
  }
  return [];
}
