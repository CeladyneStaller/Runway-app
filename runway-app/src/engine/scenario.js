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
export const PATCHABLE_COLLECTIONS = [
  ["employees", "Employee"],
  ["projects", "Project"],
  ["rounds", "Funding round"],
  ["pos", "Purchase order"],
  ["milestones", "Milestone"],
];

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
  return doc;
}

// Apply a whole scenario to the base doc, returning a NEW document (base is never mutated). With no
// patches this is a faithful deep copy — same projection, same golden number.
export function applyScenario(baseDoc, scenario) {
  const d = clone(baseDoc);
  for (const p of (scenario?.patches || [])) applyPatch(d, p);
  return d;
}

// A short human description of a patch, for chips/labels in the UI. Needs the base doc to name items.
export function describePatch(patch, baseDoc) {
  if (!patch) return "";
  if (patch.kind === "field") return `${patch.path} → ${fmt(patch.value)}`;
  if (patch.kind === "toggle") return `${patch.path} ${patch.value ? "on" : "off"}`;
  if (patch.kind === "item") {
    const coll = baseDoc?.[patch.collection] || [];
    const item = coll.find(x => x.id === patch.id);
    const name = item?.name || item?.title || item?.role || patch.id;
    return `${name}: ${patch.field} → ${fmt(patch.value)}`;
  }
  return "";
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
      start: { label: "Start month", type: "months" },
      end: { label: "End month", type: "months" },
      amount: { label: "Salary", type: "money" },
    },
  },
  projects: {
    label: "Project",
    fields: {
      stage: { label: "Stage", type: "select", options: [["prospective", "Prospective"], ["awarded", "Awarded"], ["active", "Active"], ["complete", "Complete"]] },
      budget: { label: "Budget", type: "money" },
      include: { label: "Include in projection", type: "select", options: [[true, "Yes"], [false, "No"]] },
    },
  },
  rounds: {
    label: "Funding round",
    fields: {
      amount: { label: "Amount", type: "money" },
      status: { label: "Status", type: "select", options: [["planning", "Planning"], ["raising", "Raising"], ["closed", "Closed"]] },
      closeMonth: { label: "Close month", type: "months" },
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
