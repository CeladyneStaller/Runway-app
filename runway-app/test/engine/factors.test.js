import { describe, it, expect } from "vitest";
import { FACTORS, factorById, itemsOf, dateRemovable, buildPatches } from "../../src/engine/factors.js";
import { demoDoc } from "../../src/state/document.js";

describe("the factor registry", () => {
  it("COVERS THE EIGHT BUCKETS, plus cash and confidence", () => {
    // The buckets are the vocabulary somebody already has — a scenario built from them is expressed in
    // the same terms as the number it moves.
    const ids = FACTORS.map(f => f.id);
    expect(ids).toEqual(["pay", "cost", "proj", "sales", "cap", "saas", "base", "idx", "cash", "conf"]);
  });

  it("SHOWS BASELINE BURN AND DISABLES IT, with a reason", () => {
    // A missing tile is a question; a disabled one with a reason is an answer.
    const b = factorById("base");
    expect(b.disabled).toBe(true);
    expect(b.why).toMatch(/itemise more/i);
  });

  it("lists a factor's existing items with readable labels", () => {
    const items = itemsOf(factorById("cap"), demoDoc());
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].label).toMatch(/\$\d+k/);
    expect(items[0].label).toMatch(/planning|closed|raising|committed/);
  });

  it("filters a collection when the factor is a subset of it", () => {
    // Indexed obligations live in `commitments` alongside payments and recurring costs.
    const d = demoDoc();
    const all = (d.commitments || []).length;
    const idx = itemsOf(factorById("idx"), d).length;
    expect(idx).toBeLessThan(all);
    expect(idx).toBeGreaterThan(0);
  });

  it("STATUS IS EDITABLE ON CAPITAL — the highest-leverage edit in the app", () => {
    // It decides an instrument's confidence tier, which decides whether it counts at all.
    const f = factorById("cap").fields.find(x => x.k === "status");
// "closed" is deliberately absent from ADD — a closed round emits no cash line, so adding one
    // shows no change and looks broken. It is available when CHANGING an instrument, where it is the
    // whole point of the edit.
    expect(f.opts.map(o => o[0])).toEqual(["committed", "raising", "planning"]);
    expect(f.editOpts.map(o => o[0])).toContain("closed");
  });
});

describe("removal from a date", () => {
  it("IS OFFERED where the model can express an end", () => {
    expect(dateRemovable(factorById("pay"), {}).ok).toBe(true);
    expect(dateRemovable(factorById("proj"), {}).ok).toBe(true);
  });

  it("IS REFUSED ON A CLOSED INSTRUMENT, with a reason", () => {
    // A closed round cannot be un-received — the money is in the bank, so removing it from month 14 is
    // meaningless.
    const r = dateRemovable(factorById("cap"), { status: "closed" });
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/already in the bank/);
  });

  it("is offered on an instrument that has not closed", () => {
    expect(dateRemovable(factorById("cap"), { status: "planning" }).ok).toBe(true);
  });

  it("is refused where the model has no end field at all", () => {
    expect(dateRemovable(factorById("sales"), {}).ok).toBe(false);
  });

  it("A PROJECT WARNS WHAT ELSE GOES WITH IT", () => {
    // Four of the eight factors move from one selection, and "remove the grant" sounds like one change.
    expect(factorById("proj").warn).toMatch(/drawdowns.*cost share.*payroll/);
  });
});

describe("building patches from a tile", () => {
  const d = demoDoc();
  const cap = factorById("cap");
  const first = () => itemsOf(cap, d)[0].id;

  it("ADD produces one item patch", () => {
    const out = buildPatches(cap, { mode: "add", values: { name: "Seed", amount: "3000000" } }, d);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "add", collection: "rounds" });
    expect(out[0].item).toMatchObject({ name: "Seed", amount: 3000000 });
  });

  it("EDIT PRODUCES ONE PATCH PER CHANGED FIELD, not one carrying an object", () => {
    // The change list reads a patch at a time, and a founder should see "status → committed" and
    // "closes → month 9" as two things they did.
    const out = buildPatches(cap, { mode: "edit", targetId: first(),
                                    values: { status: "committed", closeMonth: "9" } }, d);
    expect(out).toHaveLength(2);
    expect(out.map(p => p.field).sort()).toEqual(["closeMonth", "status"]);
    expect(out.find(p => p.field === "closeMonth").value).toBe(9);
  });

  it("ignores fields left blank", () => {
    const out = buildPatches(cap, { mode: "edit", targetId: first(),
                                    values: { status: "closed", amount: "" } }, d);
    expect(out).toHaveLength(1);
  });

  it("REMOVE ENTIRELY produces a remove", () => {
    const out = buildPatches(cap, { mode: "del", targetId: first(), until: null }, d);
    expect(out[0]).toMatchObject({ kind: "remove", collection: "rounds" });
  });

  it("REMOVE FROM A DATE IS AN EDIT, not a deletion", () => {
    // Setting the end month leaves everything it produced up to that point intact — which is the point.
    // A deletion that wiped the accrued cost share would flatter every scenario built this way.
    const out = buildPatches(cap, { mode: "del", targetId: first(), until: 14 }, d);
    expect(out[0]).toMatchObject({ kind: "item", field: "closeMonth", value: 14 });
    expect(out[0].op).toBeUndefined();
  });

  it("cash is a field patch and confidence is toggles", () => {
    expect(buildPatches(factorById("cash"), { mode: "add", values: { cash: "250000" } }, d)[0])
      .toMatchObject({ kind: "field", path: "cash", value: 250000 });
    expect(buildPatches(factorById("conf"), { mode: "add", values: { speculative: true } }, d)[0])
      .toMatchObject({ kind: "toggle", path: "speculative", value: true });
  });

  it("a disabled factor produces nothing", () => {
    expect(buildPatches(factorById("base"), { mode: "add", values: { x: 1 } }, d)).toEqual([]);
  });
});

describe("required fields", () => {
  it("A ROUND WITH NO AMOUNT PRODUCES NOTHING", () => {
    // Offering to add one is offering a change that does not change anything. The old dedicated form
    // enforced this and the generic builder lost it.
    const d = demoDoc();
    expect(buildPatches(factorById("cap"), { mode: "add", values: { name: "Seed" } }, d)).toEqual([]);
    expect(buildPatches(factorById("cap"), { mode: "add", values: { name: "Seed", amount: "1" } }, d))
      .toHaveLength(1);
  });
});

describe("factor fields exist on the model", () => {
  it("⚠️ EVERY FIELD KEY IS ONE THE ENGINE ACTUALLY READS", () => {
    // I invented `customers`, `price`, `growth` and `churn` for SaaS from what the UI shows; the engine
    // reads `startCustomers`, `arpu`, `newGrowthPct`, `churnPct`. A patch on an invented key writes a
    // field NOTHING CONSUMES — the scenario saves, applies, and moves no number, which is
    // indistinguishable from the feature being broken.
    const fs = require("node:fs");
    const ENGINE = fs.readdirSync("src/engine")
      .filter(n => n.endsWith(".js"))
      .map(n => fs.readFileSync("src/engine/" + n, "utf8")).join("\n");
    const d = demoDoc();
    for (const f of FACTORS) {
      if (!f.collection || !f.fields) continue;
      const items = d[f.collection] || [];
      if (!items.length) continue;
      for (const fld of f.fields) {
        // ⚠️ ACROSS EVERY ITEM, not just the first. A conditional field like `grant.funder` only exists
        // on a grant project, and the demo's first project is internal — checking one sample would have
        // failed a correct key and, worse, would pass an incorrect one on a collection whose first item
        // happens to be unusual.
        const parts = String(fld.k).split(".");
        const has = (obj) => {
          let cur = obj;
          for (const part of parts) {
            if (cur == null || !Object.prototype.hasOwnProperty.call(cur, part)) return false;
            cur = cur[part];
          }
          return true;
        };
        // ⚠️ OR READ BY THE ENGINE. A field can be genuinely correct and absent from the demo —
        // `maturityMonths` is read by `capital.js` but no seeded round is a maturing note. Checking
        // only the demo would fail correct keys; checking only the source would pass a typo that
        // happens to appear in a comment. Both, and the leaf name is what the engine names.
        const leaf = parts[parts.length - 1];
        const inEngine = ENGINE.includes("." + leaf) || ENGINE.includes(leaf + ":");
        expect(items.some(has) || inEngine,
               `${f.id}.${fld.k} is on no real ${f.collection} item and is read nowhere`).toBe(true);
      }
    }
  });
});
