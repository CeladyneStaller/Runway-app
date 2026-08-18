import { describe, it, expect } from "vitest";
import { compileInstrument, instConf } from "../../src/engine/capital.js";
import { canaryDoc as demoDoc } from "../../src/state/document.js";

describe("a round marked closed", () => {
  const r = (demoDoc().rounds || []).find(x => x.kind === "equity");
  const rev = (o) => compileInstrument({ ...r, ...o }, [])
    .filter(l => l.kind === "revenue").reduce((a, l) => a + l.amount, 0);

  it("STILL LANDS ITS CASH when the close is in the future", () => {
    // THE BUG. The guard skipped the draw for ANY closed round, on the reasoning that closed money is
    // already in cash on hand. True of a round closed last month; false of one closing in month four.
    //
    // So marking a future round "closed" DELETED its money — no line, no warning, and the runway
    // shortened as though the raise had never happened. A destructive no-op triggered by recording
    // good news is the worst shape a bug can take, because the user's instinct is that they did
    // something wrong.
    expect(rev({ status: "closed", closeMonth: 2 })).toBe(6000000);
  });

  it("does not double-count one that closed at or before the start", () => {
    // That money IS on the balance sheet. Adding it again would inflate every model whose founder
    // recorded their last raise.
    expect(rev({ status: "closed", closeMonth: 0 })).toBe(0);
    expect(rev({ status: "closed", closeMonth: -3 })).toBe(0);
  });

  it("is unchanged for a round that has not closed", () => {
    expect(rev({ status: "planning", closeMonth: 2 })).toBe(6000000);
  });

  it("carries the committed tier once closed", () => {
    // And it is the only status that does — which is why the money vanishing was invisible in the
    // committed trace specifically.
    expect(instConf({ ...r, status: "closed" })).toBe("committed");
    expect(instConf({ ...r, status: "committed" })).toBe("expected");
  });

  it("still repays a drawn facility either way", () => {
    // The obligations were never skipped, only the draw — a drawn loan still has to be repaid.
    const debt = (demoDoc().rounds || []).find(x => x.kind === "debt");
    const costs = compileInstrument({ ...debt, status: "closed", closeMonth: -2 }, [])
      .filter(l => l.kind === "cost");
    expect(costs.length).toBeGreaterThan(0);
  });
});
