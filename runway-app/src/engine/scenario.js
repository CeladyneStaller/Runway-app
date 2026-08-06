import { moneyFull } from "./money.js";
import { monthLabel, HORIZON } from "./time.js";
import { buildModelFromDoc } from "./buildmodel.js";
import { buildProjection, zeroInfo } from "./projection.js";

// Scenarios (Architecture 1: overlay patches over a base document, no reducer).
//
// A scenario is a set of PATCHES applied to a deep copy of the base document; the existing, tested
// projection engine then runs on the result. The engine is untouched and the golden number cannot
// move, because a base document with no scenario applied is byte-identical to itself.
//
// A patch targets exactly one of three things, which together cover the interesting what-ifs:
//   { kind: "field",  path: "cash",                       value }   top-level field
//   { kind: "toggle", path: "speculative",                value }   settings.toggles.<path>
//   { kind: "item",   collection: "employees", id, field, value }   one item in a collection, by id
//
// Examples:
//   delay a hire two months     -> { kind:"item", collection:"employees", id:"e3", field:"start", value:5 }
//   land a speculative grant     -> { kind:"item", collection:"projects", id:"g2", field:"stage", value:"awarded" }
//   turn on speculative revenue  -> { kind:"toggle", path:"speculative", value:true }
//   model a cash injection       -> { kind:"field", path:"cash", value:900000 }

let _sid = 0;
export const newScenarioId = () => `scn_${Date.now()}_${_sid++}`;

export const emptyScenario = (name = "New scenario") => ({
  id: newScenarioId(), name, patches: [], saved: false,
});

// The collections a patch may target, and the human label for each — also what the UI offers.
// Deep clone that's enough for our plain-data document (no functions, no cycles). structuredClone is
// available in the runtime; fall back to JSON for older environments.
const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

// Apply a single patch to a (already-cloned) doc, mutating it in place. Returns the doc for chaining.
// Unknown targets are ignored rather than throwing — a patch referring to a since-deleted item simply
// does nothing, so a stale scenario degrades gracefully instead of breaking the projection.
export function applyPatch(doc, patch) {
  if (!patch) return doc;
  if (patch.kind === "field") {
    if (patch.path in doc) doc[patch.path] = patch.value;
    return doc;
  }
  if (patch.kind === "toggle") {
    doc.settings = doc.settings || {};
    doc.settings.toggles = { ...(doc.settings.toggles || {}), [patch.path]: patch.value };
    return doc;
  }
  if (patch.kind === "item") {
    const coll = doc[patch.collection];
    if (Array.isArray(coll)) {
      const item = coll.find(x => x.id === patch.id);
      if (item) item[patch.field] = patch.value;
    }
    return doc;
  }
  // PUTTING SOMETHING IN THAT ISN'T IN THE PLAN AT ALL. The counterpart to "remove", and the thing
  // every other patch kind assumed away: they all edit an item that already exists, so "what if we
  // raised a round" could not be asked unless you had already entered the round you were unsure about.
  //
  // The item carries its OWN id, generated when the change was made and never regenerated here.
  // Minting one on each apply would give the same round a different identity on every render, which
  // breaks React keys and any later patch that refers to it.
  if (patch.kind === "add") {
    if (!patch.item?.id) return doc;
    const coll = doc[patch.collection];
    if (Array.isArray(coll)) coll.push({ ...patch.item });
    else doc[patch.collection] = [{ ...patch.item }];
    return doc;
  }

  // TAKING SOMETHING OUT ENTIRELY, which the field-patch model could not express. "Don't hire Sam" had
  // to be written as a start month past the horizon — a workaround that reads as a delay, survives into
  // the description, and quietly breaks if the horizon ever moves again.
  if (patch.kind === "remove") {
    const coll = doc[patch.collection];
    if (Array.isArray(coll)) doc[patch.collection] = coll.filter(x => x.id !== patch.id);
    return doc;
  }
  return doc;
}

// Apply a whole scenario to the base doc, returning a NEW document (base is never mutated). With no
// patches this is a faithful deep copy — same projection, same golden number.
export function applyScenario(baseDoc, scenario) {
  const d = clone(baseDoc);
  for (const p of (scenario?.patches || [])) applyPatch(d, p);
  return d;
}

// WHAT A CHANGE ACTUALLY SAYS.
//
// This used to render "Sam: start -> 5", which is the document schema read aloud: a field name, an
// arrow, and a raw month index. The scenario list then summarised a whole scenario as "3 changes",
// so the one thing a reader wants — what is different, and from what — appeared nowhere at all.
//
// `explainPatch` returns { text, was } so the UI can set the old value quietly beside the new one.
// Knowing the previous value is most of the point: "starts Mar 27" is a fact, "starts Mar 27, was
// Sep 26" is a decision.
export function explainPatch(patch, baseDoc, ctx = {}) {
  if (!patch) return { text: "", was: null };
  const fmtBy = (def, v) => formatValue(v, def, ctx);

  if (patch.kind === "field") {
    const def = TOP_LEVEL_FIELDS[patch.path];
    return {
      text: `${def?.label || patch.path} ${fmtBy(def, patch.value)}`,
      was: baseDoc && patch.path in baseDoc ? fmtBy(def, baseDoc[patch.path]) : null,
    };
  }

  if (patch.kind === "toggle") {
    const label = (TOGGLE_FIELDS.find(([v]) => v === patch.path) || [])[1] || patch.path;
    const wasOn = baseDoc?.settings?.toggles?.[patch.path];
    return {
      text: `${label} ${patch.value ? "on" : "off"}`,
      was: typeof wasOn === "boolean" ? (wasOn ? "on" : "off") : null,
    };
  }

  const coll = baseDoc?.[patch.collection] || [];
  const item = coll.find(x => x.id === patch.id);
  const name = itemLabel(item) || patch.id;

  if (patch.kind === "add") {
    const it = patch.item || {};
    const label = PATCH_SCHEMA[patch.collection]?.label?.toLowerCase() || "item";
    const amount = it.amount != null ? ` ${moneyFull(it.amount)}` : "";
    const when = it.closeMonth != null && ctx.START_Y != null
      ? ` closing ${monthLabel(ctx.START_Y, ctx.START_M, it.closeMonth)}` : "";
    return { text: `${itemLabel(it) || `new ${label}`} added —${amount}${when}`, was: null };
  }

  if (patch.kind === "remove") return { text: `${name} removed`, was: null };

  if (patch.kind === "item") {
    const def = PATCH_SCHEMA[patch.collection]?.fields?.[patch.field];
    const verb = def?.verb || (def?.label || patch.field).toLowerCase();
    return {
      text: `${name} ${verb} ${fmtBy(def, patch.value)}`,
      was: item ? fmtBy(def, item[patch.field]) : null,
    };
  }
  return { text: "", was: null };
}

/** The same thing as one string, for anywhere a single line is wanted. */
export function describePatch(patch, baseDoc, ctx = {}) {
  const e = explainPatch(patch, baseDoc, ctx);
  return e.was != null && e.was !== e.text ? `${e.text}, was ${e.was}` : e.text;
}

/** Items are named by whichever field they happen to carry a name in. */
export const itemLabel = (it) =>
  it ? (it.name || it.title || it.role || it.customer || it.po || it.label || it.id) : null;

/** Render a value the way its field type means it. A month is an INDEX, not a number anybody wants
 *  to read — `ctx` carries the projection start so it can be shown as a date. */
export function formatValue(v, def, ctx = {}) {
  if (v == null || v === "") return "none";
  if (!def) return fmt(v);
  if (def.type === "money") return moneyFull(Number(v) || 0);
  if (def.type === "percent") return `${Number(v) || 0}%/mo`;
  if (def.type === "months") {
    return ctx.START_Y != null ? monthLabel(ctx.START_Y, ctx.START_M, Number(v) || 0) : `month ${v}`;
  }
  if (def.type === "select") {
    const opt = (def.options || []).find(o => String(o[0]) === String(v));
    return opt ? String(opt[1]).toLowerCase() : fmt(v);
  }
  return fmt(v);
}

const fmt = (v) => typeof v === "boolean" ? (v ? "yes" : "no") : String(v);

// ---- patch schema: which fields are patchable per collection, and how to edit each ----
// Drives the generic builder. Each field declares a type so the UI shows the right input:
//   "months" -> a month-index number; "money" -> a dollar amount; "select" -> options[]; "number".
// Kept to the high-value, cleanly-typed fields; the engine's applyPatch can set ANY field, so this
// list can grow without touching the apply logic.
export const PATCH_SCHEMA = {
  employees: {
    label: "Employee",
    fields: {
      start: { label: "Start month", type: "months", verb: "starts" },
      end: { label: "End month", type: "months", verb: "ends" },
      amount: { label: "Salary", type: "money", verb: "paid" },
    },
  },
  projects: {
    label: "Project",
    fields: {
      stage: { label: "Stage", type: "select", options: [["prospective", "Prospective"], ["awarded", "Awarded"], ["active", "Active"], ["complete", "Complete"]] },
      budget: { label: "Budget", type: "money", verb: "budget" },
      include: { label: "Include in projection", type: "select", options: [[true, "Yes"], [false, "No"]] },
    },
  },
  rounds: {
    label: "Funding round",
    fields: {
      amount: { label: "Amount", type: "money" },
      status: { label: "Status", type: "select", options: [["planning", "Planning"], ["raising", "Raising"], ["closed", "Closed"]] },
      closeMonth: { label: "Close month", type: "months", verb: "closes" },
    },
  },
  // SUBSCRIPTIONS. Added late: SaaS revenue shipped without any of it being patchable, so the two
  // most natural what-ifs a subscription business has — churn doubling, new business drying up —
  // could not be asked at all.
  saas: {
    label: "Subscriptions",
    fields: {
      churnPct: { label: "Churn", type: "percent", verb: "churn" },
      newPerMonth: { label: "New per month", type: "number", verb: "adds" },
      arpu: { label: "Revenue each", type: "money", verb: "bills each" },
      newGrowthPct: { label: "New business growth", type: "percent", verb: "new business growth" },
      arpuGrowthPct: { label: "Price growth", type: "percent", verb: "price growth" },
      include: { label: "Count it", type: "select", options: [[true, "Yes"], [false, "No"]], verb: "counted" },
    },
  },
  pos: {
    label: "Purchase order",
    fields: {
      amount: { label: "Amount", type: "money" },
    },
  },
};

// Top-level (non-collection) patch targets.
export const TOP_LEVEL_FIELDS = {
  cash: { label: "Cash on hand", type: "money" },
};
export const TOGGLE_FIELDS = [
  ["committed", "Committed revenue"],
  ["expected", "Expected revenue"],
  ["speculative", "Speculative revenue"],
  ["financing", "Financing"],
];

// ---- what a scenario actually does ------------------------------------------------------------------
//
// The tab used to show two runway numbers side by side and leave the subtraction to the reader, which
// is the wrong way round: the DELTA is the thing being decided about, and the runway is context for it.

/** Runway in months, or null when the balance never crosses zero inside the horizon. */
const runwayOf = (doc) => {
  const rows = buildProjection(buildModelFromDoc(doc), doc.settings?.toggles);
  const z = zeroInfo(rows);
  return { rows, months: z && z.months != null ? z.months : null };
};

/** A single number that orders outcomes from worse to better, and IS DEFINED EVEN WHEN THERE IS NO
 *  ZERO DATE. Attribution has to rank alternatives, and a scenario comfortably past the horizon has
 *  `months: null` for every variant — which would leave the most interesting scenarios with no driver
 *  at all. Past the horizon, cash left over stands in for months survived. The units above HORIZON are
 *  fictional and this value is NEVER displayed: it exists only to sort. */
const score = (r) => (r.months != null ? r.months : HORIZON + (r.rows[r.rows.length - 1]?.end || 0) / 1e6);

/** Average monthly net flow across the horizon — the burn, signed. */
const netPerMonth = (rows) =>
  rows.length ? rows.reduce((a, r) => a + (r.net || 0), 0) / rows.length : 0;

/** What this scenario does to the plan, and WHICH CHANGE DID IT.
 *
 *  The driver is found by LEAVE-ONE-OUT: run the scenario again with each change taken out in turn,
 *  and whichever removal moves the runway furthest is the one carrying the scenario. That is more
 *  honest than ranking changes by size — a $200k line item that lands after you are already dead
 *  moves nothing, and a small salary that starts in month two moves a lot. It costs one extra
 *  projection per change, and scenarios have a handful.
 *
 *  `months: null` means no zero date inside the horizon, which is NOT the same as cash-flow positive —
 *  `cashFlowPositive` tells the two apart so the UI never claims the wrong one. */
export function scenarioImpact(baseDoc, scenario) {
  const base = runwayOf(baseDoc);
  const scn = runwayOf(applyScenario(baseDoc, scenario));
  const patches = scenario?.patches || [];

  let driver = null;
  if (patches.length > 1) {
    const here = score(scn);
    for (let i = 0; i < patches.length; i++) {
      const without = score(runwayOf(applyScenario(baseDoc, { patches: patches.filter((_, j) => j !== i) })));
      const swing = Math.abs(without - here);
      if (Number.isFinite(swing) && (!driver || swing > driver.swing)) driver = { patch: patches[i], swing };
    }
  } else if (patches.length === 1) {
    driver = { patch: patches[0], swing: Math.abs(score(scn) - score(base)) };
  }

  const lastNet = scn.rows.length ? scn.rows[scn.rows.length - 1].net : 0;
  return {
    months: scn.months,
    baseMonths: base.months,
    delta: scn.months != null && base.months != null ? scn.months - base.months : null,
    burnDelta: netPerMonth(scn.rows) - netPerMonth(base.rows),
    cashFlowPositive: scn.months == null && lastNet >= 0,
    driver: driver?.patch || null,
  };
}

/** A copy somebody can edit without losing the original. Scenarios are nearly always variations on
 *  each other, and re-entering five changes to try a sixth is how people stop using the feature. */
export const duplicateScenario = (scn, name) => ({
  ...scn,
  id: newScenarioId(),
  name: name || `${scn.name} copy`,
  patches: (scn.patches || []).map(p => ({ ...p })),
});

/** A funding instrument built from a scenario's answers, in the shape `capital.js` expects.
 *
 *  DEBT IS DELIBERATELY NOT OFFERED here. A debt instrument needs a rate, a term, interest-only
 *  months and fees before it means anything; created without them it models as money arriving and
 *  never being repaid, which is not a raise — it is a gift, and it would quietly overstate the runway.
 *  Debt belongs on the Investment tab where those terms live.
 *
 *  STATUS DEFAULTS TO `committed`, and getting this right took reading `compileInstrument`. The two
 *  obvious-looking choices are both wrong:
 *    - `closed` emits NO cash line at all (capital.js:101), because a closed round's money is already
 *      sitting in `cash` — adding a line would double-count it. A "what if we raise" scenario built
 *      that way moves the runway not one day.
 *    - `planning` and `raising` map to `speculative` via INST_CONF, which is OFF under the default
 *      toggles, so those show no change either.
 *  `committed` maps to `expected`, which is on. It is also the honest description of what a scenario
 *  is asserting: money that will arrive and has not yet.
 *
 *  Note this is still not sufficient on its own — FINANCING is a separate axis from the revenue tiers
 *  and also defaults to off. The caller has to turn it on; the scenario UI emits that as its own
 *  visible change so the reason the numbers moved is on screen.
 */
export const scenarioRound = ({ name, amount, closeMonth, kind = "safe", status = "committed" } = {}) => ({
  id: newScenarioId().replace("scn_", "rnd_"),
  kind: ["safe", "equity", "note"].includes(kind) ? kind : "safe",
  name: String(name || "").trim() || "New round",
  status: ["planning", "raising", "committed", "closed"].includes(status) ? status : "committed",
  amount: Number(amount) || 0,
  closeMonth: Math.max(0, Math.round(Number(closeMonth) || 0)),
  capType: "post",
  confAuto: true,
  goals: [],
});

// ── staleness ────────────────────────────────────────────────────────────────────────────────────
//
// A SCENARIO IS A DIFF AGAINST A DOCUMENT THAT KEEPS MOVING. When the thing a patch touches changes
// underneath it, the patch stops meaning what it said — and today it either applies to a value nobody
// intended or silently does nothing.
//
// ⚠️ THE FINGERPRINT IS STORED; THE FLAG IS DERIVED. The fingerprint records what a patch READ at build
// time and cannot be recomputed later — the past is gone. The comparison is a pure function of
// (fingerprint, doc) and is computed at render, because a cached staleness flag would be a SECOND
// source of truth about the document. This session has already produced three bugs of exactly that
// shape: a dashboard and a tab disagreeing on one figure, a workbook writer re-deriving a cell and
// drifting, and a chart recomputing a verdict and keeping a false green.

/** What a patch reads, so it can tell later whether that has moved. */
export function fingerprintFor(doc, patch) {
  if (!doc || !patch) return null;
  if (patch.kind === "field") return { path: patch.path, was: doc[patch.path] };
  if (patch.kind === "toggle") return { path: patch.path, was: doc?.settings?.toggles?.[patch.path] };
  if (patch.kind === "item") {
    const item = (doc[patch.collection] || []).find(x => x?.id === patch.id);
    // AN ADD READS NOTHING — there is no existing item, so there is nothing to go stale.
    if (patch.op === "add" || !item) return item ? null : { missing: true, collection: patch.collection };
    // ONLY THE FIELDS THIS PATCH CARES ABOUT. Recording the whole item would flag a scenario every time
    // somebody edited a note, and a warning that fires on everything is one people learn to ignore.
    const keys = patch.field ? [patch.field] : Object.keys(patch.values || {});
    const was = {};
    for (const k of keys) was[k] = item[k];
    // The label fields, so the flag can say WHICH thing moved rather than just that something did.
    return { collection: patch.collection, id: patch.id, was, name: item.name || item.label || item.title };
  }
  return null;
}

export function withFingerprints(doc, scenario) {
  return {
    ...scenario,
    patches: (scenario?.patches || []).map(p => (p.fp === undefined ? { ...p, fp: fingerprintFor(doc, p) } : p)),
  };
}

const same = (a, b) => (a === b) || (a == null && b == null) || String(a) === String(b);

/** Which patches no longer match the model, and how. Derived — never stored. */
export function staleness(doc, scenario) {
  const out = [];
  for (const p of scenario?.patches || []) {
    const fp = p.fp;
    if (!fp) continue;                                   // nothing was read, so nothing can move

    if (fp.missing) { out.push({ patch: p, kind: "gone", detail: "it no longer exists in the model" }); continue; }

    if (p.kind === "field" || p.kind === "toggle") {
      const now = p.kind === "field" ? doc?.[fp.path] : doc?.settings?.toggles?.[fp.path];
      if (!same(now, fp.was)) out.push({ patch: p, kind: "moved", field: fp.path, was: fp.was, now });
      continue;
    }

    const item = (doc?.[fp.collection] || []).find(x => x?.id === fp.id);
    if (!item) { out.push({ patch: p, kind: "gone", name: fp.name, detail: "it no longer exists in the model" }); continue; }
    for (const [k, was] of Object.entries(fp.was || {})) {
      if (!same(item[k], was)) out.push({ patch: p, kind: "moved", name: fp.name, field: k, was, now: item[k] });
    }
  }
  return out;
}

/** One line per stale patch, for the flag. */
export function stalenessText(entry) {
  // REUSES THE FILE'S OWN `fmt`. A second formatter is how the same value ends up printing two ways in
  // two places — the shape of bug this session has already produced three times.
  const show = (v) => (v === undefined || v === null || v === "" ? "empty" : fmt(v));
  if (entry.kind === "gone") {
    return `${entry.name ? `${entry.name} ` : ""}no longer exists in the model — this change does nothing.`;
  }
  const who = entry.name ? `${entry.name}: ` : "";
  return `${who}${entry.field} was ${show(entry.was)} when this was built; it is now ${show(entry.now)}.`;
}

