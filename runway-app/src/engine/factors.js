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
    // ⚠️ THE ADJUSTMENT LIVES HERE, NOT ON THE BASELINE TILE. "How much could I save" is a question
    // about operating costs; that the engine routes it through the derived baseline is an
    // implementation detail nobody should have to know to ask it.
    adjust: {
      l: "Change overall overhead by",
      help: "Without naming a line — the answer to \"how much do I need to save\".",
    },
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
    // ⚠️ DOTTED KEYS REACH INTO `project.grant`. A grant's terms are nested, and a registry that could
    // only patch top-level fields could describe a project's name and nothing that decides its cash.
    fields: [
      { k: "name", t: "text", l: "Name" },
      { k: "type", t: "select", l: "Type",
        opts: [["internal", "Internal"], ["grant", "Grant"], ["fulfillment", "Fulfilment"]] },
      { k: "grant.funder", t: "text", l: "Agency", when: (v) => v.type === "grant" },
      { k: "grant.costSharePct", t: "number", l: "Cost share %", when: (v) => v.type === "grant" },
      { k: "grant.costShareType", t: "select", l: "Cost share type", when: (v) => v.type === "grant",
        opts: [["cash", "Cash"], ["inkind", "In kind"]] },
      { k: "grant.reimburseTiming", t: "select", l: "Reimbursement", when: (v) => v.type === "grant",
        opts: [["arrears", "In arrears"], ["monthly", "Monthly"],
               ["advance", "In advance"], ["milestone", "On milestones"]] },
      { k: "grant.reimburseLagMonths", t: "number", l: "Lag (months)", when: (v) => v.type === "grant" },
      { k: "start", t: "month", l: "Starts" },
      { k: "end", t: "month", l: "Ends" },
    ],
    endField: "end",
    // ⚠️ REMOVING A PROJECT REMOVES WHAT IT PRODUCES — spend, drawdowns, cost share and allocated
    // payroll. Four of the eight factors move from one selection, and the panel says so first.
    warn: "Its spend, drawdowns, cost share and allocated payroll all go with it.",
  },
  {
    id: "sales", name: "Sales orders", blurb: "Customer POs and delivery",
    collection: "pos", count: (d) => (d.pos || []).length,
    // ⚠️ COST TO FULFIL IS NOT A PO FIELD. The model expresses it as a FULFILMENT PROJECT linked by
    // `projectId` — labour on it is your own team's time and belongs in the project, where it can be
    // assigned per person and follow a real salary. I invented a `fulfilCost` field and the key guard
    // caught it; a number on the order would have been a second, disagreeing place for the same cost.
    //
    // So a scenario that adds an order and wants its cost adds a Projects & grants change of type
    // "fulfilment" beside it. Two changes, which is honest — the order and the work are two decisions.
    label: (p) => `${p.customer || p.name || "Order"} — ${p.amount ? `$${Math.round(p.amount).toLocaleString()}` : "—"}`,
    fields: [
      { k: "customer", t: "text", l: "Customer" },
      { k: "po", t: "text", l: "PO number" },
      { k: "amount", t: "number", l: "Amount" },
      { k: "bookedMonth", t: "month", l: "Booked" },
      { k: "deliveryMonth", t: "month", l: "Delivers" },
      { k: "termsDays", t: "number", l: "Payment terms (days)" },
      { k: "depositPct", t: "number", l: "Deposit %" },
      { k: "confidence", t: "tier", l: "Confidence" },
    ],
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
        // DEBT IS OFFERED NOW. It was excluded because the old form could not carry a rate or a term —
        // a facility without them is money that arrives and never leaves. The fields above supply them,
        // so the reason for the exclusion is gone.
        opts: [["safe", "SAFE"], ["equity", "Priced round"], ["note", "Convertible note"],
               ["debt", "Venture debt"]] },
      // ⚠️ WITHOUT TERMS A FACILITY IS MONEY THAT ARRIVES AND NEVER LEAVES. These are what make debt
      // and a repaying note assessable rather than flattering — the reason debt was excluded from the
      // old form was precisely that it could not carry them.
      { k: "rateAPR", t: "number", l: "Rate APR %", when: (v) => v.kind === "debt" || v.kind === "note" },
      { k: "termMonths", t: "number", l: "Term (months)", when: (v) => v.kind === "debt" },
      { k: "maturityMonths", t: "number", l: "Matures after (months)", when: (v) => v.kind === "note" },
      { k: "atMaturity", t: "select", l: "At maturity", when: (v) => v.kind === "note",
        opts: [["convert", "Converts"], ["repay", "Repaid"],
               ["royalty", "Royalty until a cap"]] },
      { k: "royaltyPct", t: "number", l: "Royalty %",
        when: (v) => v.kind === "note" && v.atMaturity === "royalty" },
      { k: "royaltyBase", t: "select", l: "Royalty on",
        when: (v) => v.kind === "note" && v.atMaturity === "royalty",
        opts: [["revenue", "Revenue"], ["profit", "Profit"]] },
      { k: "capMultiple", t: "number", l: "Cap (x principal)",
        when: (v) => v.kind === "note" && v.atMaturity === "royalty" },
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
    // ⚠️ THE COPY CHANGED WITH THE FEATURE. It used to say "itemise more to move it", which became
    // untrue the moment an overhead adjustment could move it from the Operating costs tile. A disabled
    // tile that is secretly adjustable elsewhere is worse than either — so it now says WHERE.
    id: "base", name: "Baseline burn", blurb: "Measured, not itemised",
    disabled: true,
    why: "Derived from your spend history minus everything itemised. Itemise more to reduce it — or "
       + "use Operating costs to change your overall overhead without naming a line.",
  },
  {
    id: "idx", name: "Indexed obligations", blurb: "Royalties, matches, profit shares",
    collection: "commitments", count: (d) => (d.commitments || []).filter(c => c.flavor === "indexed").length,
    label: (c) => `${c.label || "Obligation"} — ${Math.round((c.index?.pct || 0) * 100)}% of ${c.index?.of || "revenue"}`,
    only: (c) => c.flavor === "indexed",
    fields: [
      { k: "label", t: "text", l: "What" },
      { k: "index.pct", t: "number", l: "Rate %" },
      { k: "index.of", t: "select", l: "Of",
        opts: [["revenue", "Revenue"], ["project", "Project spend"], ["profit", "Profit"]] },
      { k: "signedMonth", t: "month", l: "Starts" },
    ],
    // AN INDEXED COMMITMENT IS NOT AN ORDINARY ONE. `addManual` decides the flavour and the shape, so
    // a generic object would create a payment that never scales.
    make: (it) => ({ ...it, flavor: "indexed", kind: "planned", status: "committed",
                     payMonth: null, amount: 0, lineId: null,
                     index: { of: it.index?.of || "revenue", ref: null,
                              pct: (Number(it.index?.pct) || 0) / 100 } }),
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

/** Write a possibly-dotted key. `grant.funder` reaches into the nested object the model actually uses. */
function setPath(obj, key, value) {
  const parts = String(key).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] || {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

export const readPath = (obj, key) =>
  String(key).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Fields that apply given what has been chosen so far.
 *
 *  ⚠️ A ROUND'S TERMS DEPEND ON ITS TYPE. Showing "rate APR" on a SAFE, or "royalty %" on a note that
 *  converts, invites somebody to fill in a field the engine will never read — the same class of bug as
 *  an invented key, arrived at from the other direction.
 */
export function visibleFields(factor, values = {}) {
  return (factor?.fields || []).filter(f => !f.when || f.when(values));
}

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
    for (const f of visibleFields(factor, values)) {
      if (f.required && !(Number(values[f.k]) > 0)) return [];
    }
    const item = { id: `scn_${Math.random().toString(36).slice(2, 9)}` };
    for (const f of visibleFields(factor, values)) {
      const raw = values[f.k];
      if (raw === "" || raw == null) continue;
      setPath(item, f.k, (f.t === "number" || f.t === "month") ? Number(raw) : raw);
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

  if (mode === "adjust") {
    const { amount } = overheadAdjustment(doc, values.adjust);
    if (!amount) return [];
    return [{ kind: "add", collection: "lines", item: {
      id: `adj_${Math.random().toString(36).slice(2, 9)}`,
      label: amount < 0 ? "Overhead reduction" : "Overhead increase",
      cadence: "recurring", kind: "cost", amount, start: 0,
      adjustment: true, confidence: "committed",
    } }];
  }

  if (!targetId) return [];

  if (mode === "edit") {
    // ONE PATCH PER CHANGED FIELD, not one carrying an object. The change list reads a patch at a time
    // and a founder should see "status → committed" and "closes → month 9" as two things they did.
    return visibleFields(factor, values)
      .filter(f => values[f.k] !== "" && values[f.k] != null)
      .map(f => ({ kind: "item", collection: factor.collection, id: targetId, field: f.k,
                   value: (f.t === "number" || f.t === "month") ? Number(values[f.k]) : values[f.k] }));
  }

  // AN ADJUSTMENT IS AN ADD, of a line marked so the baseline ignores it.


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

/** How much overhead there is to cut, and what a requested cut actually does.
 *
 *  ⚠️ A VISIBLE, HONEST BOUND. A large enough reduction makes total costs negative — overhead that
 *  pays you — so the cut is clamped at what is actually being spent. Clamping SILENTLY would be worse
 *  than not clamping: somebody types $80,000, sees a runway built on $52,000, and has no way to know
 *  the difference was refused.
 */
export function overheadHeadroom(doc) {
  const lines = doc?.lines || [];
  const itemised = lines
    .filter(l => l?.kind === "cost" && l.cadence === "recurring" && !l.adjustment
                 && (l.start || 0) <= 0)
    .reduce((a, l) => a + (Number(l.amount) || 0), 0);
  // Existing adjustments count against the headroom, or two cuts of $30k against $50k of overhead
  // would both apply and take it negative between them.
  const already = lines
    .filter(l => l?.adjustment)
    .reduce((a, l) => a + Math.abs(Number(l.amount) || 0), 0);
  return Math.max(0, itemised - already);
}

/** What a requested monthly change to overhead becomes. */
export function overheadAdjustment(doc, requested) {
  const want = Number(requested) || 0;
  if (want === 0) return { amount: 0, clamped: false, max: overheadHeadroom(doc) };
  // AN INCREASE IS NEVER CLAMPED. There is no ceiling on what somebody could choose to spend; the
  // floor exists only because you cannot cut more than you are spending.
  if (want > 0) return { amount: want, clamped: false, max: null };
  const max = overheadHeadroom(doc);
  // `+ 0` NORMALISES NEGATIVE ZERO. `-0` compares unequal to `0` under Object.is, prints as "-0" in
  // any figure derived from it, and is the kind of value that survives a whole pipeline before
  // surfacing somewhere unrelated.
  const amount = Math.max(want, -max) + 0;
  return { amount, clamped: amount !== want, max };
}
