import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React, { useState } from "react";
import { RunwayApp } from "../../src/App";
import { canaryDoc as demoDoc } from "../../src/state/document";

function H(props = {}) {
  const [d, s] = useState(demoDoc());
  return <RunwayApp doc={d} setDoc={s} {...props} />;
}

describe("the left rail", () => {
  const rail = () => render(<H demo />).container.querySelector(".rail");

  it("ORDERS THE TABS AS SOMEBODY WORKS", () => {
    // What happened, what is happening, what brings money in, what it costs, what is promised, what
    // might change.
    const labels = [...rail().querySelectorAll(".nav")]
      .map(b => b.textContent.replace(/[^\w /-]/g, "").trim())
      .filter(t => t && !/settings|portfolio/i.test(t));
    expect(labels).toEqual([
      "Dashboard", "Spend history", "Cash flow", "Sales", "Payroll",
      "Projects", "Milestones", "Investment", "Commitments", "Scenarios",
    ]);
  });

  it("COMPANY SETTINGS IS INSIDE THE FOOT, not above it", () => {
    // `.railfoot` carries `margin-top:auto`, so a button placed ABOVE it is pushed to the top of the
    // gap — sitting under the last tab while the meta line sits at the bottom. Markup order said
    // "bottom"; the layout said otherwise.
    const v = render(<H />);
    const foot = v.container.querySelector(".railfoot");
    expect(foot).toBeTruthy();
    expect(foot.textContent).toMatch(/Company settings/);
  });

  it("and it sits above the projection-start line", () => {
    const foot = render(<H />).container.querySelector(".railfoot");
    const txt = foot.textContent;
    expect(txt.indexOf("Company settings")).toBeLessThan(txt.indexOf("Projection start"));
  });

  it("a demo has no company to configure", () => {
    expect(rail().textContent).not.toMatch(/Company settings/);
  });
});

describe("tab icons", () => {
  const src = require("node:fs").readFileSync("src/App.jsx", "utf8");
  const block = /const NAV = \[([\s\S]*?)\n  \];/.exec(src)?.[1] ?? "";
  const icons = [...block.matchAll(/I\.(\w+)\]/g)].map(m => m[1]);

  it("EVERY TAB HAS ITS OWN GLYPH", () => {
    // Investment, Commitments and Scenarios all rendered `invest` — I reached for the nearest thing
    // when adding the last two. In a ten-tab rail a repeated mark is worse than none: it implies a
    // relationship between tabs that have none.
    expect(icons.length).toBe(10);
    expect(new Set(icons).size).toBe(10);
  });

  it("the two new ones exist and are drawn to match the set", () => {
    // Same 24x24 box, same 2px stroke, same round caps — so they do not read as imported from
    // somewhere else.
    const ic = require("node:fs").readFileSync("src/views/chrome/icons.jsx", "utf8");
    for (const name of ["promise", "fork"]) {
      const m = new RegExp(`\\n  ${name}: (<svg[\\s\\S]*?</svg>)`).exec(ic);
      expect(m, name).toBeTruthy();
      expect(m[1]).toMatch(/viewBox="0 0 24 24"/);
      expect(m[1]).toMatch(/strokeWidth="2"/);
      expect(m[1]).toMatch(/stroke="currentColor"/);
    }
  });

  it("renders both in the rail", () => {
    const v = render(<H demo />);
    const svgs = [...v.container.querySelectorAll(".rail .nav svg")];
    expect(svgs.length).toBeGreaterThanOrEqual(10);
    // `fork` is the only glyph in the set with two circles at y=4.
    expect(v.container.innerHTML).toMatch(/cy="4" r="1.5"/);
  });
});
