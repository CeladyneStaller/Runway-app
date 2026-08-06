import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React, { useState } from "react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

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
